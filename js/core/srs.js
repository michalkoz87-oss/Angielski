// srs.js — spaced repetition (pure: no DOM, no storage, no clock).
//
// A "day" is the integer from platform.toDayNumber(dateKey). Card state:
//   { s:'learning'|'review', d: dueDay, i: intervalDays, e: ease, r: successful reps in a row,
//     n: total reviews, l: lapses, t: lastReviewTs }
// A card with no state is "new".
//
// Details the spec leaves open, decided here:
//  * grade(state, rating, nowDay, nowTs, id) — the card id is the optional 5th argument. With an id,
//    intervals of 8 days or more get a deterministic ±10 % fuzz (hash of id + review count), so the
//    ten cards learned on one day do not come back as one block for ever. No id → no fuzz.
//  * grade() never mutates its input (store documents are frozen) and always returns a fresh object.
//  * 'hard' keeps `r` and `s`; 'good'/'easy' graduate a learning card to 'review'.
//  * A REVIEW BEFORE THE DUE DAY (nowDay < d) with a passing grade cannot shorten anything and cannot
//    inflate the schedule either: the candidate interval is computed from the days that really passed
//    since the last review (not from the scheduled interval), the result is never below the current
//    interval, the due day never moves earlier, and ease / streak / learning status stay as they are.
//    So grading the same card twice on one day (two devices, a stale queue) is harmless.
//    'again' is different on purpose: it always resets to 1 day and is due tomorrow, early or not.
//  * `t` is strictly increasing per card (max(nowTs, previous t + 1)), so a new review always wins
//    the "larger t" merge even when a device clock runs behind.
//  * `e` is kept rounded to 2 decimals; `i` is an integer in 1…180; `d` is always later than nowDay.
//  * Invalid arguments (unknown rating, nowDay that is not an integer, nowTs that is not a finite
//    number) throw a TypeError instead of writing a corrupt state. A damaged stored state is repaired
//    field by field; grading a card that has no state treats it as just introduced.

export const MAX_INTERVAL = 180;
export const MIN_EASE = 1.3;
export const DEFAULT_EASE = 2.5;
export const RATINGS = Object.freeze(['again', 'hard', 'good', 'easy']);

const FUZZ_FROM = 8;

function reqDay(nowDay) {
  if (typeof nowDay !== 'number' || !Number.isInteger(nowDay)) {
    throw new TypeError(`srs: nowDay must be an integer day number, got ${String(nowDay)}`);
  }
  return nowDay;
}

function reqTs(nowTs) {
  if (typeof nowTs !== 'number' || !Number.isFinite(nowTs)) {
    throw new TypeError(`srs: nowTs must be a finite timestamp, got ${String(nowTs)}`);
  }
  return nowTs;
}

const round2 = (x) => Math.round(x * 100) / 100;
const clampEase = (e) => round2(Math.max(MIN_EASE, e));
const clampInterval = (i) => Math.min(MAX_INTERVAL, Math.max(1, Math.round(i)));
const nonNegInt = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** A repaired copy of a stored state, or null when there is nothing usable (a new card). */
function sanitize(state, nowDay) {
  if (!state || typeof state !== 'object') return null;
  const i = typeof state.i === 'number' && Number.isFinite(state.i) ? clampInterval(state.i) : 1;
  const e = typeof state.e === 'number' && Number.isFinite(state.e) ? clampEase(state.e) : DEFAULT_EASE;
  const r = nonNegInt(state.r);
  const d = typeof state.d === 'number' && Number.isFinite(state.d) ? Math.round(state.d) : nowDay;
  const s = state.s === 'review' || state.s === 'learning' ? state.s : r > 0 ? 'review' : 'learning';
  return {
    s,
    d,
    i,
    e,
    r,
    n: nonNegInt(state.n),
    l: nonNegInt(state.l),
    t: typeof state.t === 'number' && Number.isFinite(state.t) ? state.t : 0,
  };
}

function hash32(str) {
  let h = 0x811c9dc5;
  for (let k = 0; k < str.length; k++) {
    h ^= str.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic factor in [0.9, 1.1) from the card id and its review count; 1 without an id. */
function fuzzFactor(id, n) {
  if (id === undefined || id === null || id === '') return 1;
  return 0.9 + (hash32(`${String(id)}#${n}`) / 4294967296) * 0.2;
}

const fuzzed = (raw, id, n) => (raw >= FUZZ_FROM ? Math.round(raw * fuzzFactor(id, n)) : raw);

/** State of a card right after the learn step: due tomorrow. */
export function initialState(nowDay, nowTs) {
  const day = reqDay(nowDay);
  return { s: 'learning', d: day + 1, i: 1, e: DEFAULT_EASE, r: 0, n: 0, l: 0, t: reqTs(nowTs) };
}

/**
 * New state after a review.
 * @param {object|null|undefined} state  current state (not mutated); null/undefined = a card never introduced
 * @param {'again'|'hard'|'good'|'easy'} rating
 * @param {number} nowDay  integer day number of the review
 * @param {number} nowTs   ms epoch of the review
 * @param {string} [id]    card id; enables the deterministic fuzz
 */
export function grade(state, rating, nowDay, nowTs, id) {
  if (!RATINGS.includes(rating)) throw new TypeError(`srs: unknown rating ${String(rating)}`);
  const now = reqDay(nowDay);
  const ts = reqTs(nowTs);
  const prev = sanitize(state, now) ?? { s: 'learning', d: now, i: 1, e: DEFAULT_EASE, r: 0, n: 0, l: 0, t: 0 };

  const next = {
    s: prev.s,
    d: prev.d,
    i: prev.i,
    e: prev.e,
    r: prev.r,
    n: prev.n + 1,
    l: prev.l,
    t: Math.max(ts, prev.t + 1),
  };

  if (rating === 'again') {
    if (prev.s === 'review') next.l = prev.l + 1;
    next.s = 'learning';
    next.r = 0;
    next.i = 1;
    next.e = clampEase(prev.e - 0.2);
    next.d = now + 1;
    return next;
  }

  const early = now < prev.d;
  if (early) {
    // Credit only for the days that really passed; never shorter, never earlier, nothing else changes.
    const elapsed = Math.max(0, now - (prev.d - prev.i));
    const mult = rating === 'hard' ? 1.2 : rating === 'good' ? prev.e : prev.e * 1.3;
    const candidate = fuzzed(Math.round(elapsed * mult), id, prev.n);
    next.i = Math.min(MAX_INTERVAL, Math.max(prev.i, candidate));
    next.d = Math.max(prev.d, now + next.i);
    return next;
  }

  let raw;
  if (rating === 'hard') {
    raw = Math.max(1, Math.round(prev.i * 1.2));
    next.e = clampEase(prev.e - 0.15);
  } else if (rating === 'good') {
    next.r = prev.r + 1;
    next.s = 'review';
    // First success of a learning card (r becomes 1): the fixed 3-day step.
    raw = prev.s === 'learning' || next.r === 1 ? 3 : Math.round(prev.i * prev.e);
  } else {
    next.r = prev.r + 1;
    next.s = 'review';
    raw = Math.round(Math.max(4, prev.i * prev.e * 1.3));
    next.e = clampEase(prev.e + 0.15);
  }

  let interval = clampInterval(fuzzed(raw, id, prev.n));
  // The fuzz must not turn a pass into a shorter (hard) or an unchanged (good/easy) interval.
  const floor = rating === 'hard' || prev.s === 'learning' ? prev.i : prev.i + 1;
  interval = Math.min(MAX_INTERVAL, Math.max(interval, floor));
  next.i = interval;
  next.d = now + interval;
  return next;
}

/** True when the card has a state and its due day is today or earlier. A new card is never due. */
export function isDue(state, nowDay) {
  return !!state && typeof state.d === 'number' && state.d <= nowDay;
}

/** 'new' | 'learning' (interval < 7) | 'young' (7–20) | 'mature' (>= 21) */
export function maturity(state) {
  if (!state || typeof state !== 'object') return 'new';
  const i = typeof state.i === 'number' && Number.isFinite(state.i) ? state.i : 1;
  if (i < 7) return 'learning';
  if (i < 21) return 'young';
  return 'mature';
}

/** How to ask: fewer than 2 reviews → 'recognize'; fewer than 5 → 'choose'; otherwise 'produce'. */
export function promptMode(state) {
  const n = state && typeof state.n === 'number' && Number.isFinite(state.n) ? state.n : 0;
  if (n < 2) return 'recognize';
  if (n < 5) return 'choose';
  return 'produce';
}

function entriesOf(statesMap) {
  if (!statesMap) return [];
  if (statesMap instanceof Map) return [...statesMap.entries()];
  if (typeof statesMap[Symbol.iterator] === 'function') return [...statesMap];
  if (typeof statesMap === 'object') return Object.entries(statesMap);
  return [];
}

/**
 * Ids of the cards due on nowDay, most overdue first (ties: shorter interval first, then id),
 * capped at `limit`. A limit that is not a finite number >= 0 means "no cap".
 * statesMap: Map<id, state> (model.allCardStates()), a plain object, or [id, state] pairs.
 */
export function buildQueue(statesMap, nowDay, limit) {
  const now = reqDay(nowDay);
  const due = [];
  for (const [id, st] of entriesOf(statesMap)) {
    if (isDue(st, now)) due.push({ id: String(id), d: st.d, i: typeof st.i === 'number' ? st.i : 1 });
  }
  due.sort((a, b) => a.d - b.d || a.i - b.i || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const cap = typeof limit === 'number' && Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : due.length;
  return due.slice(0, cap).map((x) => x.id);
}

/**
 * Number of cards coming due on each of the next `days` days.
 * Index 0 = today including everything overdue; index k = cards due exactly k days from now.
 */
export function forecast(statesMap, nowDay, days) {
  const now = reqDay(nowDay);
  const len = typeof days === 'number' && Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
  const out = new Array(len).fill(0);
  if (len === 0) return out;
  for (const [, st] of entriesOf(statesMap)) {
    if (!st || typeof st.d !== 'number' || !Number.isFinite(st.d)) continue;
    const k = Math.max(0, Math.round(st.d) - now);
    if (k < len) out[k] += 1;
  }
  return out;
}
