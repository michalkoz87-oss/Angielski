// platform.js — host detection, dates, ids, files.
//
// Runs unchanged in a browser (ES module or bundled IIFE) and under Node (unit tests):
// every use of window/document is guarded and nothing here touches the DOM at import time.
//
// Decisions where the spec left a detail open:
// - Dates: a "dateKey" is 'YYYY-MM-DD' in the learner's LOCAL calendar. Arithmetic never goes
//   through local midnight: keys are converted to an integer day number computed at UTC noon,
//   so the 23-hour and 25-hour days of Europe/Warsaw DST changes cannot shift a date.
// - Bad input never throws: toDayNumber() of a malformed key is NaN, weekdayOf() is then NaN and
//   fromDayNumber()/addDays() return '' — callers can test for that instead of catching.
// - cap(name) looks at window.claude at call time (not only at import time) and never rejects.
// - saveFile() in a Claude Artifact uses the `downloads` capability only; when it is missing the
//   answer is 'unavailable' (blob links are inert inside the frame, so there is no fallback).
// - Extra export (not in the spec): stableStringify(value) — canonical JSON with sorted keys,
//   shared by store.js and sync-claude.js to compare documents structurally.

const DAY_MS = 86400000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

let clock = null;

function hostWindow() {
  try {
    return typeof window !== 'undefined' && window ? window : undefined;
  } catch {
    return undefined;
  }
}

function claudeHost() {
  try {
    const c = hostWindow()?.claude;
    return c && typeof c.use === 'function' ? c : null;
  } catch {
    return null;
  }
}

/** True when the page runs as a Claude Artifact (window.claude.use exists). */
export const isArtifact = claudeHost() !== null;

/**
 * Resolve a runtime capability namespace, or null. Never rejects; null when the page is not a
 * Claude Artifact, when the capability is not served, or when the host throws.
 */
export function cap(name) {
  let pending;
  try {
    const c = claudeHost();
    if (!c) return Promise.resolve(null);
    pending = c.use(name);
  } catch {
    return Promise.resolve(null);
  }
  return Promise.resolve(pending).then(
    (ns) => (ns === undefined || ns === null ? null : ns),
    () => null,
  );
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

/** Milliseconds since the epoch (overridable in tests through setClock). */
export function nowTs() {
  if (clock) {
    const v = Number(clock());
    if (Number.isFinite(v)) return v;
  }
  return Date.now();
}

/** Tests only: override "now". `fn` returns ms since the epoch (or a Date). Pass null to reset. */
export function setClock(fn) {
  clock = typeof fn === 'function' ? fn : null;
}

/** 'YYYY-MM-DD' of `date` (a Date or ms epoch; default: now) in LOCAL time. */
export function todayKey(date) {
  let d;
  if (date instanceof Date) d = date;
  else if (typeof date === 'number') d = new Date(date);
  else d = new Date(nowTs());
  if (Number.isNaN(d.getTime())) d = new Date(nowTs());
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Integer day count for a dateKey (days since 1970-01-01, taken at UTC noon). NaN if malformed. */
export function toDayNumber(key) {
  const m = KEY_RE.exec(typeof key === 'string' ? key : '');
  if (!m) return NaN;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) / DAY_MS);
}

/** dateKey for an integer day number ('' when the number is not finite). */
export function fromDayNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const d = new Date(Math.floor(n) * DAY_MS + DAY_MS / 2);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** dateKey `n` days after (or before, for negative n) `key`. */
export function addDays(key, n) {
  return fromDayNumber(toDayNumber(key) + Math.trunc(Number(n) || 0));
}

/** ISO weekday of a dateKey: 1 = Monday … 7 = Sunday (NaN if malformed). */
export function weekdayOf(key) {
  const n = toDayNumber(key);
  if (Number.isNaN(n)) return NaN;
  // Day 0 (1970-01-01) was a Thursday.
  return ((((n + 3) % 7) + 7) % 7) + 1;
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short random id (12 chars of [0-9a-z]); safe as a JSON key and as a db path segment. */
export function makeId() {
  let out = '';
  try {
    const bytes = new Uint8Array(12);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) out += ID_ALPHABET[b % 36];
    return out;
  } catch {
    out = '';
  }
  for (let i = 0; i < 12; i++) out += ID_ALPHABET[Math.floor(Math.random() * 36)];
  return out;
}

/**
 * Canonical JSON: object keys sorted recursively, `undefined` members dropped (as JSON does).
 * Two values are structurally equal exactly when their canonical strings are equal, whatever
 * the key order a storage backend happened to return.
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value);
    return s === undefined ? 'null' : s;
  }
  if (Array.isArray(value)) {
    let out = '[';
    for (let i = 0; i < value.length; i++) out += (i ? ',' : '') + stableStringify(value[i]);
    return out + ']';
  }
  if (typeof value.toJSON === 'function') return stableStringify(value.toJSON());
  const keys = Object.keys(value).sort();
  let out = '{';
  let first = true;
  for (const k of keys) {
    const v = value[k];
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
    out += (first ? '' : ',') + JSON.stringify(k) + ':' + stableStringify(v);
    first = false;
  }
  return out + '}';
}

const MIME = { json: 'application/json', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown' };

/**
 * Offer `text` to the learner as a file. Resolves 'saved' | 'declined' | 'unavailable'; never
 * rejects. Artifact: the `downloads` capability (the viewer confirms). Standalone: a Blob and a
 * temporary <a download> (the only place in the app where that is allowed).
 */
export async function saveFile(filename, text) {
  const name = typeof filename === 'string' && filename ? filename : 'plik.txt';
  const data = typeof text === 'string' ? text : String(text ?? '');
  try {
    if (claudeHost()) {
      const downloads = await cap('downloads');
      if (!downloads || typeof downloads.save !== 'function') return 'unavailable';
      try {
        // The capability rejects empty contents; a backup is never empty, but stay safe.
        await downloads.save({ filename: name, data: data === '' ? '\n' : data });
        return 'saved';
      } catch (err) {
        return err && err.code === 'declined' ? 'declined' : 'unavailable';
      }
    }
    if (
      typeof document === 'undefined' ||
      typeof Blob === 'undefined' ||
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      return 'unavailable';
    }
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    const blob = new Blob([data], { type: `${MIME[ext] || 'text/plain'};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* nothing to release */
      }
    }, 30000);
    return 'saved';
  } catch {
    return 'unavailable';
  }
}
