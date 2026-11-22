// sync-claude.js — remote adapter over the Claude Artifact `db` capability.
//
// The store (store.js) owns the documents, the merge and local persistence. This module owns the
// transport only: the first read, the live subscription and the write queue. It is created by
// store.init() in artifact mode and never touches the DOM.
//
// Adapter contract (what store.js expects from any remote):
//   remote.attach(hooks)        start in the background; must not throw synchronously for long
//   remote.push(docId, opts?)   a local document changed (opts.delayMs = lazier write)
//   remote.flush()              write everything pending now (page is being hidden / is back online)
//   remote.detach()             stop without reporting
// Hooks the store provides:
//   hooks.accepts(docId)            is this one of the store's documents?
//   hooks.docIds()                  ids of all local documents
//   hooks.read(docId)               current local document ({} when absent; frozen, never mutated here)
//   hooks.receive([{id, data}], {authoritative})   merge remote documents into the local state
//   hooks.ready()                   the first authoritative remote read has been merged
//   hooks.status(status, detail?)   'local' | 'connecting' | 'synced' | 'saving' | 'offline';
//                                   detail = {code, terminal:true} when syncing stopped for good
//
// Rules implemented here (see db.d.ts and the app spec):
// - Per-viewer private documents: db.collection('data/users/' + uid).doc(docId).
// - On attach: ONE collection.get(), merged through hooks.receive(); then ONE onSnapshot on the
//   collection. Documents are written back only where the merged local state differs from the
//   remote document.
// - THE WRITE GATE: nothing is written before a remote read that the store confirmed
//   (metadata.fromCache !== true) has been merged. A fresh device (empty local state, months of
//   progress on the remote) therefore cannot overwrite anything; whatever it did meanwhile is
//   merged into the remote state first. A cached read is merged too, but does not open the gate.
// - The single test for writing is structural: a document is written only when its canonical JSON
//   differs from the remote document as last seen in a snapshot or last written by us. That one
//   rule gives: no write when nothing changed, no echo loop when a snapshot delivers our own
//   write, write-back only when the merge added something, never a write from a timer for nothing.
// - An absent or empty local document is never written, and documents the store does not own are
//   never touched.
// - Writes: whole document with set(); one in flight per document; changes made meanwhile are
//   coalesced into one following write (latest state wins); debounced ~1.2 s, at most ~10 s after
//   the first unsaved change.
// - Errors: `unavailable` (and unknown codes) → retry once after a short randomized delay; if it
//   still fails the status becomes 'offline' and the document is retried with a slow backoff
//   (5 s … 5 min), on flush(), or on the next change. `resource_exhausted` → backoff without the
//   immediate retry. `invalid_argument`, `revoked`, `not_granted`, `capability_*`,
//   `transform_error`, `quota_exceeded` → stop syncing for this page load and report 'offline'.
// - Listener errors: terminal codes stop syncing; `unavailable` means that listener is dead, so a
//   fresh one is opened after a backoff (10 s … 5 min).
// - A snapshot document with hasPendingWrites is our own unconfirmed write: it is ignored (the
//   set() promise is the confirmation). If a snapshot from another device arrives while our write
//   is in flight we cannot know which one the server applied last, so the remote is assumed to hold
//   the other device's version and our merged state is written once more.

import { cap as platformCap, nowTs, stableStringify } from './platform.js';

const EMPTY = '{}';
const TERMINAL_CODES = new Set([
  'invalid_argument',
  'revoked',
  'not_granted',
  'capability_disabled',
  'capability_removed',
  'transform_error',
  'quota_exceeded',
]);
const RECOVERY_DELAYS = [5000, 15000, 30000, 60000, 120000, 300000];
const RESUBSCRIBE_DELAYS = [10000, 30000, 60000, 120000, 300000];

const codeOf = (err) =>
  err && typeof err === 'object' && typeof err.code === 'string' && err.code ? err.code : 'unavailable';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Create a remote adapter.
 * options (all optional; meant for tests): cap(name), debounceMs, maxWaitMs, connectTimeoutMs,
 * setTimeout, clearTimeout, random, collectionPath(uid).
 */
export function createClaudeRemote(options = {}) {
  const getCap = typeof options.cap === 'function' ? options.cap : platformCap;
  const debounceMs = Number.isFinite(options.debounceMs) ? options.debounceMs : 1200;
  const maxWaitMs = Number.isFinite(options.maxWaitMs) ? options.maxWaitMs : 10000;
  const connectTimeoutMs = Number.isFinite(options.connectTimeoutMs) ? options.connectTimeoutMs : 8000;
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const collectionPath =
    typeof options.collectionPath === 'function' ? options.collectionPath : (uid) => 'data/users/' + uid;
  const setT =
    typeof options.setTimeout === 'function'
      ? options.setTimeout
      : (fn, ms) => {
          const t = setTimeout(fn, ms);
          if (t && typeof t.unref === 'function') t.unref(); // never keep a Node test process alive
          return t;
        };
  const clearT = typeof options.clearTimeout === 'function' ? options.clearTimeout : (t) => clearTimeout(t);

  let hooks = null;
  let col = null;
  let phase = 'idle'; // idle → connecting → live | none (no remote in this view) | stopped
  let gateOpen = false;
  let timedOut = false;
  let readFailed = false;
  let listenerDown = false;
  let lastStatus = null;
  let lastCode = null;

  let unsubscribe = null;
  let subToken = 0;
  let firstSnapshot = true;

  let connectTimer = null;
  let recoveryTimer = null;
  let recoveryAttempt = 0;
  let resubTimer = null;
  let resubAttempt = 0;

  /** docId → canonical JSON of the remote document as last seen in a snapshot or written by us. */
  const known = new Map();
  /** docId → write state. */
  const entries = new Map();

  function entry(id) {
    let e = entries.get(id);
    if (!e) {
      e = { dirty: false, timer: null, since: 0, inFlight: false, again: false, foreign: false, failed: false, writing: null };
      entries.set(id, e);
    }
    return e;
  }

  const remoteOf = (id) => {
    const v = known.get(id);
    return v === undefined ? EMPTY : v;
  };

  const sleep = (ms) => new Promise((resolve) => setT(resolve, ms));
  const jitter = () => 400 + random() * 800;

  function accepts(id) {
    try {
      return typeof id === 'string' && !!hooks && hooks.accepts(id) === true;
    } catch {
      return false;
    }
  }

  function localJson(id) {
    try {
      const doc = hooks.read(id);
      return isPlainObject(doc) ? stableStringify(doc) : EMPTY;
    } catch {
      return EMPTY;
    }
  }

  function computeStatus() {
    if (phase === 'none') return 'local';
    if (phase === 'stopped') return 'offline';
    if (!gateOpen) return timedOut || readFailed ? 'offline' : 'connecting';
    let busy = false;
    for (const e of entries.values()) {
      if (e.failed) return 'offline';
      if (e.dirty || e.inFlight) busy = true;
    }
    if (listenerDown) return 'offline';
    return busy ? 'saving' : 'synced';
  }

  function report(detail) {
    if (!hooks) return;
    const status = computeStatus();
    if (status === lastStatus && !detail) return;
    lastStatus = status;
    try {
      hooks.status(status, detail);
    } catch {
      /* a listener problem in the store must not break the transport */
    }
  }

  function clearTimer(t) {
    if (t !== null && t !== undefined) {
      try {
        clearT(t);
      } catch {
        /* ignore */
      }
    }
  }

  function settle(e) {
    e.dirty = false;
    e.failed = false;
    e.since = 0;
    if (e.timer !== null) {
      clearTimer(e.timer);
      e.timer = null;
    }
  }

  function teardown() {
    const un = unsubscribe;
    unsubscribe = null;
    subToken++;
    if (typeof un === 'function') {
      try {
        un();
      } catch {
        /* ignore */
      }
    }
    clearTimer(connectTimer);
    clearTimer(recoveryTimer);
    clearTimer(resubTimer);
    connectTimer = recoveryTimer = resubTimer = null;
    for (const e of entries.values()) {
      if (e.timer !== null) {
        clearTimer(e.timer);
        e.timer = null;
      }
    }
  }

  /** Syncing is over for this page load (revoked, not granted, a call the store rejects…). */
  function stop(code) {
    if (phase === 'stopped') return;
    phase = 'stopped';
    lastCode = code || null;
    teardown();
    lastStatus = 'offline';
    try {
      hooks && hooks.status('offline', { code: lastCode, terminal: true });
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------- reading

  function ingest(snap, full) {
    if (!snap || phase !== 'live') return;
    const authoritative = !(snap.metadata && snap.metadata.fromCache === true);
    const batch = [];
    const touched = new Set();
    const seen = new Set();

    const noteRemote = (id, json) => {
      const e = entries.get(id);
      if (e && e.inFlight && json !== e.writing) e.foreign = true;
      known.set(id, json);
      touched.add(id);
    };

    const consider = (d, removed) => {
      if (!d || typeof d.id !== 'string') return;
      const id = d.id;
      seen.add(id);
      if (!accepts(id)) return; // not one of ours: never read into the app, never written
      if (!removed && d.metadata && d.metadata.hasPendingWrites === true) return; // our own unconfirmed write
      let data = null;
      if (!removed && d.exists !== false) {
        try {
          data = d.data();
        } catch {
          data = null;
        }
      }
      if (isPlainObject(data)) {
        noteRemote(id, stableStringify(data));
        batch.push({ id, data });
      } else {
        noteRemote(id, EMPTY);
      }
    };

    let changes = null;
    if (!full && typeof snap.docChanges === 'function') {
      try {
        changes = snap.docChanges();
      } catch {
        changes = null;
      }
    }
    if (Array.isArray(changes)) {
      for (const c of changes) if (c) consider(c.doc, c.type === 'removed');
    } else {
      const docs = Array.isArray(snap.docs) ? snap.docs : [];
      for (const d of docs) consider(d, false);
      if (authoritative) {
        // A complete, confirmed view: whatever we knew and is not in it is gone from the remote.
        for (const [id, json] of known) if (!seen.has(id) && json !== EMPTY) noteRemote(id, EMPTY);
      }
    }

    try {
      hooks.receive(batch, { authoritative });
    } catch (err) {
      reportProblem(err);
    }

    if (authoritative && !gateOpen) {
      openGate();
    } else if (gateOpen) {
      for (const id of touched) evaluate(id);
    }
    report();
  }

  function reportProblem(err) {
    try {
      if (typeof console !== 'undefined' && console && typeof console.error === 'function') {
        console.error('[sync] ', err);
      }
    } catch {
      /* ignore */
    }
  }

  function openGate() {
    gateOpen = true;
    timedOut = false;
    readFailed = false;
    clearTimer(connectTimer);
    connectTimer = null;
    try {
      hooks.ready();
    } catch (err) {
      reportProblem(err);
    }
    let ids = [];
    try {
      ids = hooks.docIds() || [];
    } catch {
      ids = [];
    }
    for (const id of new Set([...ids, ...entries.keys()])) evaluate(id);
  }

  /** Compare one document with the remote and queue a write when (and only when) they differ. */
  function evaluate(id) {
    if (!gateOpen || phase !== 'live' || !accepts(id)) return;
    const e = entry(id);
    const local = localJson(id);
    if (local === EMPTY || local === remoteOf(id)) {
      if (!e.inFlight) settle(e);
      return;
    }
    e.dirty = true;
    if (e.timer === null && !e.inFlight) schedule(id, debounceMs);
  }

  async function initialRead() {
    for (let attempt = 0; attempt < 2; attempt++) {
      let snap = null;
      try {
        snap = await col.get();
      } catch (err) {
        if (phase !== 'live') return;
        const code = codeOf(err);
        if (TERMINAL_CODES.has(code)) {
          stop(code);
          return;
        }
        lastCode = code;
        if (attempt === 0 && code === 'unavailable') {
          await sleep(jitter());
          if (phase !== 'live') return;
          continue;
        }
        // Give up on get(); the subscription keeps trying in silence and opens the gate later.
        readFailed = true;
        report();
        return;
      }
      if (phase !== 'live') return;
      ingest(snap, true);
      return;
    }
  }

  function subscribe() {
    if (phase !== 'live' || unsubscribe) return;
    const token = ++subToken;
    firstSnapshot = true;
    let dead = false;
    let un = null;
    const onNext = (snap) => {
      if (phase !== 'live' || token !== subToken) return;
      try {
        const full = firstSnapshot;
        firstSnapshot = false;
        if (listenerDown) {
          listenerDown = false;
          resubAttempt = 0;
        }
        ingest(snap, full);
      } catch (err) {
        reportProblem(err);
      }
    };
    const onError = (err) => {
      if (token !== subToken) return;
      dead = true;
      unsubscribe = null;
      if (phase !== 'live') return;
      const code = codeOf(err);
      if (TERMINAL_CODES.has(code)) {
        stop(code);
        return;
      }
      // This listener is finished; only a fresh one can recover.
      lastCode = code;
      listenerDown = true;
      report();
      scheduleResubscribe();
    };
    try {
      un = col.onSnapshot(onNext, onError);
    } catch (err) {
      onError(err);
      return;
    }
    if (dead || phase !== 'live' || token !== subToken) {
      if (typeof un === 'function') {
        try {
          un();
        } catch {
          /* ignore */
        }
      }
      return;
    }
    unsubscribe = typeof un === 'function' ? un : () => {};
  }

  function scheduleResubscribe() {
    if (resubTimer !== null || phase !== 'live') return;
    const delay = RESUBSCRIBE_DELAYS[Math.min(resubAttempt, RESUBSCRIBE_DELAYS.length - 1)];
    resubAttempt++;
    resubTimer = setT(() => {
      resubTimer = null;
      subscribe();
    }, delay);
  }

  // ---------------------------------------------------------------- writing

  function schedule(id, delay, lazy) {
    const e = entry(id);
    if (lazy && e.timer !== null) return; // a sooner write is already planned
    const now = nowTs();
    if (!e.since) e.since = now;
    if (e.timer !== null) clearTimer(e.timer);
    const latest = e.since + Math.max(maxWaitMs, delay);
    const wait = Math.max(0, Math.min(delay, latest - now));
    e.timer = setT(() => {
      e.timer = null;
      write(id);
    }, wait);
  }

  async function write(id) {
    if (phase !== 'live' || !gateOpen) return;
    const e = entry(id);
    if (e.inFlight) {
      e.again = true; // coalesce: one more write follows the one in flight
      return;
    }
    let json = localJson(id);
    if (json === EMPTY || json === remoteOf(id)) {
      settle(e);
      report();
      return;
    }
    e.inFlight = true;
    e.again = false;
    e.dirty = false;
    e.since = 0;
    e.foreign = false;
    e.writing = json;
    report();

    let failure = null;
    let wrote = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await sleep(jitter());
        if (phase !== 'live') break;
        // Retry with the latest state; there may be nothing left to write by now.
        json = localJson(id);
        if (json === EMPTY || json === remoteOf(id)) {
          failure = null;
          break;
        }
        e.again = false;
        e.dirty = false;
        e.foreign = false;
        e.writing = json;
      }
      try {
        // A fresh plain object: never hand the store's frozen document to the capability.
        await col.doc(id).set(JSON.parse(json));
        failure = null;
        wrote = true;
        break;
      } catch (err) {
        failure = codeOf(err);
        if (failure !== 'unavailable') break;
      }
    }

    e.inFlight = false;
    e.writing = null;
    if (phase !== 'live') return;

    if (failure === null) {
      if (wrote && !e.foreign) known.set(id, json);
      e.foreign = false;
      e.failed = false;
      const again = e.again;
      e.again = false;
      const now = localJson(id);
      if (now !== EMPTY && now !== remoteOf(id)) {
        e.dirty = true;
        if (e.timer === null) schedule(id, again ? 0 : debounceMs);
      } else {
        settle(e);
      }
      let anyFailed = false;
      for (const other of entries.values()) if (other.failed) anyFailed = true;
      if (!anyFailed) recoveryAttempt = 0;
    } else if (TERMINAL_CODES.has(failure)) {
      stop(failure);
      return;
    } else {
      lastCode = failure;
      e.failed = true;
      e.dirty = true;
      scheduleRecovery();
    }
    report();
  }

  function scheduleRecovery() {
    if (recoveryTimer !== null || phase !== 'live') return;
    const delay = RECOVERY_DELAYS[Math.min(recoveryAttempt, RECOVERY_DELAYS.length - 1)];
    recoveryAttempt++;
    recoveryTimer = setT(() => {
      recoveryTimer = null;
      for (const [id, e] of entries) if (e.failed && !e.inFlight && e.timer === null) write(id);
    }, delay);
  }

  // ---------------------------------------------------------------- public

  async function attach(h) {
    if (phase !== 'idle' || !h) return;
    hooks = h;
    phase = 'connecting';
    report();
    connectTimer = setT(() => {
      connectTimer = null;
      if (!gateOpen && (phase === 'connecting' || phase === 'live')) {
        timedOut = true;
        report();
      }
    }, connectTimeoutMs);

    let db = null;
    let user = null;
    let uid = null;
    try {
      [db, user] = await Promise.all([getCap('db'), getCap('user')]);
      if (db && user && typeof user.id === 'function') uid = await user.id();
    } catch {
      uid = null;
    }
    if (phase !== 'connecting') return; // detached while waiting

    if (!db || typeof db.collection !== 'function' || typeof uid !== 'string' || uid === '') {
      // No db in this view, or no identity: the app is local-only for this visit.
      phase = 'none';
      clearTimer(connectTimer);
      connectTimer = null;
      report();
      return;
    }
    try {
      col = db.collection(collectionPath(uid));
    } catch {
      stop('invalid_argument');
      return;
    }
    phase = 'live';
    await initialRead();
    if (phase !== 'live') return;
    subscribe();
  }

  function push(id, opts) {
    if (phase === 'none' || phase === 'stopped' || !hooks) return;
    if (!accepts(id)) return;
    const e = entry(id);
    e.dirty = true;
    if (phase === 'live' && gateOpen) {
      const lazy = !!opts && Number.isFinite(opts.delayMs);
      schedule(id, lazy ? opts.delayMs : debounceMs, lazy);
      report();
    }
    // Before the gate opens the change only waits: openGate() compares every document.
  }

  function flush() {
    if (phase !== 'live') return;
    if (listenerDown && !unsubscribe) {
      clearTimer(resubTimer);
      resubTimer = null;
      subscribe();
    }
    if (!gateOpen) return;
    for (const [id, e] of entries) {
      if ((e.dirty || e.failed) && !e.inFlight) {
        if (e.timer !== null) {
          clearTimer(e.timer);
          e.timer = null;
        }
        write(id);
      }
    }
  }

  function detach() {
    if (phase === 'stopped') return;
    phase = 'stopped';
    teardown();
    hooks = null;
  }

  return {
    attach(h) {
      // Never reject: the store treats a rejected attach as "remote failed".
      return attach(h).catch((err) => {
        reportProblem(err);
        stop('unavailable');
      });
    },
    push,
    flush,
    detach,
    /** Diagnostics (settings screen, tests). */
    state() {
      let pending = 0;
      for (const e of entries.values()) if (e.dirty || e.inFlight) pending++;
      return { phase, gateOpen, status: computeStatus(), lastCode, pending };
    },
  };
}
