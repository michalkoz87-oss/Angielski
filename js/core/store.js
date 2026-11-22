// store.js — local-first document store. Documents are plain JSON objects kept in memory,
// mirrored to localStorage (prefix "ang:") and, inside a Claude Artifact, synced through the
// remote adapter in sync-claude.js. Every write is a merge, so two devices always converge.
//
// Document ids (the last dot-separated segment decides the merge rule):
//   profiles                      {list: {pid: {id, name, ageGroup, createdAt, updatedAt, deleted?}}}
//   <pid>.profile                 settings of one learner (whole document: newest wins)
//   <pid>.log-YYYY-MM             {days: {DD: {deviceId: {reviews, correct, newCards, seconds, sessions}}}}
//   <pid>.<course>.progress       {steps: {key: {.., at}}, results: {key: {.., at}}, tests: {key: {.., at}}}
//   <pid>.<course>.srs-wNN        {cards: {id: state}}   (newest review wins per card)
//   <pid>.<course>.journal-wNN    {entries: {key: {.., at}}}

import { isArtifact, nowTs, makeId, stableStringify } from './platform.js';
import { createClaudeRemote } from './sync-claude.js';

const PREFIX = 'ang:';
const DEVICE_KEY = 'ang-device';
const EMPTY = Object.freeze({});
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function kindOf(docId) {
  if (typeof docId !== 'string' || !/^[A-Za-z0-9_.-]{1,120}$/.test(docId)) return null;
  if (docId === 'profiles') return 'profiles';
  const last = docId.split('.').pop();
  if (last === 'profile') return 'profile';
  if (last === 'progress') return 'progress';
  if (/^srs-w\d{2}$/.test(last)) return 'srs';
  if (/^log-\d{4}-\d{2}$/.test(last)) return 'log';
  if (/^journal-w\d{2}$/.test(last)) return 'journal';
  return null;
}

// Pick the entry with the larger stamp; ties are broken by content so the result never depends on order.
function pick(x, y, field) {
  if (x === undefined) return y;
  if (y === undefined) return x;
  const a = Number(x?.[field]) || 0;
  const b = Number(y?.[field]) || 0;
  if (a !== b) return b > a ? y : x;
  return stableStringify(y) > stableStringify(x) ? y : x;
}

function mergeMap(a, b, field) {
  const out = {};
  for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) out[k] = clone(pick(a?.[k], b?.[k], field));
  return out;
}

/** Pure, commutative, associative, idempotent merge of two versions of one document. */
export function mergeDoc(docId, a, b) {
  const A = isObj(a) ? a : {};
  const B = isObj(b) ? b : {};
  if (!Object.keys(A).length) return clone(B);
  if (!Object.keys(B).length) return clone(A);
  const kind = kindOf(docId);
  const updatedAt = Math.max(Number(A.updatedAt) || 0, Number(B.updatedAt) || 0);
  if (kind === 'profiles') return { list: mergeMap(A.list, B.list, 'updatedAt'), updatedAt };
  if (kind === 'progress') {
    return { steps: mergeMap(A.steps, B.steps, 'at'), results: mergeMap(A.results, B.results, 'at'), tests: mergeMap(A.tests, B.tests, 'at'), updatedAt };
  }
  if (kind === 'srs') return { cards: mergeMap(A.cards, B.cards, 't'), updatedAt };
  if (kind === 'journal') return { entries: mergeMap(A.entries, B.entries, 'at'), updatedAt };
  if (kind === 'log') {
    const days = {};
    for (const dd of new Set([...Object.keys(A.days ?? {}), ...Object.keys(B.days ?? {})])) {
      const x = A.days?.[dd] ?? {};
      const y = B.days?.[dd] ?? {};
      days[dd] = {};
      for (const dev of new Set([...Object.keys(x), ...Object.keys(y)])) {
        const out = {};
        for (const k of new Set([...Object.keys(x[dev] ?? {}), ...Object.keys(y[dev] ?? {})])) {
          out[k] = Math.max(Number(x[dev]?.[k]) || 0, Number(y[dev]?.[k]) || 0);
        }
        days[dd][dev] = out;
      }
    }
    return { days, updatedAt };
  }
  return clone(pick(A, B, 'updatedAt')); // profile and anything unknown: newest whole document
}

const docs = new Map();
const listeners = { change: new Set(), sync: new Set() };
let status = 'local';
let remote = null;
let started = null;

function emit(event, payload) {
  for (const fn of [...listeners[event]]) {
    try {
      fn(payload);
    } catch (err) {
      console.error(err);
    }
  }
}

function persist(docId) {
  const ls = storage();
  if (!ls) return;
  try {
    ls.setItem(PREFIX + docId, JSON.stringify(docs.get(docId) ?? {}));
  } catch {
    /* quota or private mode: the state stays in memory and on the remote */
  }
}

function loadLocal() {
  const ls = storage();
  if (!ls) return;
  try {
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      const id = key.slice(PREFIX.length);
      if (!kindOf(id)) continue;
      try {
        const value = JSON.parse(ls.getItem(key));
        if (isObj(value) && Object.keys(value).length) docs.set(id, Object.freeze(value));
      } catch {
        /* a corrupted entry is ignored; the remote copy (if any) restores it */
      }
    }
  } catch {
    /* storage unavailable */
  }
}

function deviceId() {
  const ls = storage();
  try {
    let id = ls?.getItem(DEVICE_KEY);
    if (!id) {
      id = 'd' + makeId().slice(0, 8);
      ls?.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'd' + makeId().slice(0, 8);
  }
}

function setDoc(docId, value, source) {
  docs.set(docId, Object.freeze(value));
  persist(docId);
  emit('change', { docId, source });
}

function setStatus(next) {
  if (next === status) return;
  status = next;
  emit('sync', status);
}

function attachRemote() {
  let resolve;
  const ready = new Promise((r) => (resolve = r));
  remote = createClaudeRemote();
  const hooks = {
    accepts: (id) => kindOf(id) !== null,
    docIds: () => [...docs.keys()],
    read: (id) => docs.get(id) ?? EMPTY,
    receive(batch) {
      for (const entry of batch ?? []) {
        if (!entry || kindOf(entry.id) === null || !isObj(entry.data)) continue;
        const local = docs.get(entry.id) ?? EMPTY;
        const merged = mergeDoc(entry.id, local, entry.data);
        if (stableStringify(merged) !== stableStringify(local)) setDoc(entry.id, merged, 'remote');
      }
    },
    ready: () => resolve(),
    status(next, detail) {
      setStatus(next);
      if (next === 'local' || detail?.terminal) resolve();
    },
  };
  try {
    remote.attach(hooks);
  } catch (err) {
    console.error(err);
    remote = null;
    setStatus('local');
    resolve();
  }
  return ready;
}

export const store = {
  deviceId: deviceId(),

  /** Load local state and connect the remote. Resolves when it is safe to render. */
  init() {
    if (started) return started;
    loadLocal();
    if (!isArtifact) {
      status = 'local';
      started = Promise.resolve();
      return started;
    }
    status = 'connecting';
    const ready = attachRemote();
    const flush = () => {
      try {
        remote?.flush();
      } catch {
        /* nothing to do */
      }
    };
    try {
      document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
      window.addEventListener('pagehide', flush);
      window.addEventListener('online', flush);
    } catch {
      /* no DOM */
    }
    const hasLocal = Object.keys(docs.get('profiles')?.list ?? {}).length > 0;
    // A device that already holds profiles renders at once; a fresh one waits for the first remote read.
    started = hasLocal ? Promise.resolve() : Promise.race([ready, new Promise((r) => setTimeout(r, 8000))]);
    return started;
  },

  get(docId) {
    return docs.get(docId) ?? EMPTY;
  },

  /** fn(draft) mutates a deep copy; the store stamps it, saves it and queues the remote write. */
  update(docId, fn) {
    if (kindOf(docId) === null) throw new TypeError(`store: unknown document ${docId}`);
    const draft = clone(docs.get(docId) ?? {});
    fn(draft);
    draft.updatedAt = nowTs();
    setDoc(docId, draft, 'local');
    try {
      remote?.push(docId);
    } catch (err) {
      console.error(err);
    }
    return docs.get(docId);
  },

  on(event, fn) {
    if (!listeners[event] || typeof fn !== 'function') return () => {};
    listeners[event].add(fn);
    return () => listeners[event].delete(fn);
  },

  syncStatus() {
    return status;
  },

  exportAll() {
    const out = {};
    for (const [id, doc] of docs) out[id] = doc;
    return { app: 'angielski-krok-po-kroku', version: 1, exportedAt: nowTs(), docs: clone(out) };
  },

  /** Merge a backup into the current state. Returns the number of documents that changed. */
  importAll(backup) {
    if (!isObj(backup) || backup.app !== 'angielski-krok-po-kroku' || !isObj(backup.docs)) throw new TypeError('To nie jest plik kopii zapasowej tej aplikacji.');
    let changed = 0;
    for (const [id, data] of Object.entries(backup.docs)) {
      if (kindOf(id) === null || !isObj(data)) continue;
      const local = docs.get(id) ?? EMPTY;
      const merged = mergeDoc(id, local, data);
      if (stableStringify(merged) === stableStringify(local)) continue;
      setDoc(id, merged, 'remote');
      try {
        remote?.push(id);
      } catch {
        /* retried on the next change */
      }
      changed++;
    }
    return changed;
  },
};

export default store;
