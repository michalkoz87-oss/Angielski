// model.js — the domain API the screens use. Everything is scoped to the active learner
// (profile) and that learner's active course (level); switching either changes the scope.

import { store } from './store.js';
import { nowTs, todayKey, toDayNumber, fromDayNumber, weekdayOf, makeId } from './platform.js';
import * as content from './content.js';

const ACTIVE_KEY = 'ang-active';
const DEFAULT_SETTINGS = { studyDays: [1, 2, 3, 4, 5, 6], studyTime: '17:00', maxReviews: 80, accent: 'en-GB', voice: 'auto' };
const COURSE_KEYS = ['startDate', 'newPerDay', 'levelHintTests'];

let pid = null;
let course = null;
let cardCache = null;
const scopeListeners = new Set();

store.on('change', (event) => {
  if (event?.docId?.includes('.srs-')) cardCache = null;
});

function remember(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* device-local convenience only */
  }
}

function emitScope() {
  cardCache = null;
  for (const fn of [...scopeListeners]) {
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  }
}

const scope = () => `${pid}.${course}`;
const profileDoc = () => (pid ? store.get(`${pid}.profile`) : {});

// ---------------------------------------------------------------- learners

export function listProfiles() {
  return Object.values(store.get('profiles').list ?? {})
    .filter((p) => p && !p.deleted)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export const activeProfileId = () => pid;
export const activeProfile = () => listProfiles().find((p) => p.id === pid) ?? null;
export const isAdult = () => activeProfile()?.ageGroup === 'adult';

export function createProfile({ name, ageGroup }) {
  const id = 'p' + makeId().slice(0, 10);
  const now = nowTs();
  store.update('profiles', (d) => {
    d.list ??= {};
    d.list[id] = { id, name: String(name).trim().slice(0, 30), ageGroup: ageGroup === 'adult' ? 'adult' : 'minor', createdAt: now, updatedAt: now };
  });
  store.update(`${id}.profile`, (d) => Object.assign(d, DEFAULT_SETTINGS, { courses: {} }));
  return id;
}

export function updateProfileMeta(id, patch) {
  store.update('profiles', (d) => {
    if (!d.list?.[id]) return;
    if (typeof patch.name === 'string' && patch.name.trim()) d.list[id].name = patch.name.trim().slice(0, 30);
    if (patch.ageGroup) d.list[id].ageGroup = patch.ageGroup === 'adult' ? 'adult' : 'minor';
    d.list[id].updatedAt = nowTs();
  });
}

export function deleteProfile(id) {
  store.update('profiles', (d) => {
    if (!d.list?.[id]) return;
    d.list[id].deleted = true;
    d.list[id].updatedAt = nowTs();
  });
  if (id === pid) switchProfile(null);
}

/** Make a learner active (null = nobody: the "Kto się uczy?" screen). */
export function switchProfile(id) {
  pid = id && listProfiles().some((p) => p.id === id) ? id : null;
  course = pid ? profileDoc().courseId ?? null : null;
  content.setCourse(course);
  remember(pid);
  emitScope();
}

/** At start: one learner → active at once; several → the picker decides. */
export function boot() {
  const all = listProfiles();
  if (all.length === 1) switchProfile(all[0].id);
  else if (pid && !all.some((p) => p.id === pid)) switchProfile(null);
}

export function onScope(fn) {
  scopeListeners.add(fn);
  return () => scopeListeners.delete(fn);
}

// ---------------------------------------------------------------- course and settings

export const courseId = () => course;

export function setCourse(id) {
  if (!pid) return;
  store.update(`${pid}.profile`, (d) => {
    d.courseId = id || null;
    if (!id) return;
    d.courses ??= {};
    d.courses[id] ??= { startedAt: nowTs() };
  });
  course = id || null;
  content.setCourse(course);
  emitScope();
}

/** Courses this learner has started: {courseId: {startDate, startedAt}}. */
export const enrolments = () => profileDoc().courses ?? {};

export function getProfile() {
  const p = profileDoc();
  const c = (course && p.courses?.[course]) || {};
  return {
    studyDays: Array.isArray(p.studyDays) && p.studyDays.length ? p.studyDays : DEFAULT_SETTINGS.studyDays,
    studyTime: p.studyTime ?? DEFAULT_SETTINGS.studyTime,
    maxReviews: p.maxReviews ?? DEFAULT_SETTINGS.maxReviews,
    accent: p.accent ?? DEFAULT_SETTINGS.accent,
    voice: p.voice ?? DEFAULT_SETTINGS.voice,
    voiceName: p.voiceName ?? '',
    speechRate: p.speechRate ?? 0.9,
    sessionMinutes: p.sessionMinutes ?? null,
    courseId: course,
    startDate: c.startDate ?? null,
    newPerDay: c.newPerDay ?? null,
    levelHintTests: c.levelHintTests ?? 0,
  };
}

export function setProfile(patch) {
  if (!pid) return;
  store.update(`${pid}.profile`, (d) => {
    for (const [k, v] of Object.entries(patch)) {
      if (COURSE_KEYS.includes(k)) {
        if (!course) continue;
        d.courses ??= {};
        d.courses[course] ??= { startedAt: nowTs() };
        d.courses[course][k] = v;
      } else d[k] = v;
    }
  });
}

export const isOnboarded = () => !!pid && !!course && !!getProfile().startDate;

// ---------------------------------------------------------------- cards (spaced repetition)

const srsDoc = (id) => `${scope()}.srs-${String(id).slice(0, 3)}`;

export function cardState(id) {
  return store.get(srsDoc(id)).cards?.[id] ?? null;
}

export function setCardState(id, state) {
  store.update(srsDoc(id), (d) => {
    d.cards ??= {};
    d.cards[id] = state;
  });
  cardCache = null;
}

/** Map<itemId, state> of the active course. */
export function allCardStates() {
  if (cardCache) return cardCache;
  const map = new Map();
  for (let w = 1; w <= 24; w++) {
    const cards = store.get(`${scope()}.srs-w${String(w).padStart(2, '0')}`).cards;
    if (cards) for (const [id, st] of Object.entries(cards)) map.set(id, st);
  }
  cardCache = map;
  return map;
}

// ---------------------------------------------------------------- progress

const progress = () => store.get(`${scope()}.progress`);

export function stepState(sid, step) {
  return progress().steps?.[`${sid}.${step}`] ?? null;
}

export function markStep(sid, step, extra = {}) {
  store.update(`${scope()}.progress`, (d) => {
    d.steps ??= {};
    d.steps[`${sid}.${step}`] = { ...extra, done: true, at: nowTs() };
  });
}

/** A session is done when every step of its plan is done. */
export function sessionDone(sid, stepKeys) {
  const steps = progress().steps ?? {};
  return stepKeys.length > 0 && stepKeys.every((k) => steps[`${sid}.${k}`]?.done);
}

export function doneStepCount() {
  return Object.values(progress().steps ?? {}).filter((s) => s?.done).length;
}

export function saveResult(key, data) {
  store.update(`${scope()}.progress`, (d) => {
    d.results ??= {};
    d.results[key] = { ...data, at: nowTs() };
  });
}
export const getResult = (key) => progress().results?.[key] ?? null;
export const allResults = () => progress().results ?? {};

export function saveTest(key, data) {
  store.update(`${scope()}.progress`, (d) => {
    d.tests ??= {};
    d.tests[key] = { ...data, at: nowTs() };
  });
}
export const getTest = (key) => progress().tests?.[key] ?? null;
export const allTests = () => progress().tests ?? {};

// ---------------------------------------------------------------- activity log

const COUNTERS = ['reviews', 'correct', 'newCards', 'seconds', 'sessions'];

export function logActivity(counters) {
  if (!pid) return;
  const key = todayKey();
  store.update(`${pid}.log-${key.slice(0, 7)}`, (d) => {
    d.days ??= {};
    const day = (d.days[key.slice(8)] ??= {});
    const mine = (day[store.deviceId] ??= {});
    for (const k of COUNTERS) if (counters[k]) mine[k] = (mine[k] ?? 0) + Math.round(counters[k]);
  });
}

export function dayStats(dateKey) {
  const out = { reviews: 0, correct: 0, newCards: 0, seconds: 0, sessions: 0 };
  if (!pid) return out;
  const day = store.get(`${pid}.log-${dateKey.slice(0, 7)}`).days?.[dateKey.slice(8)] ?? {};
  for (const dev of Object.values(day)) for (const k of COUNTERS) out[k] += Number(dev?.[k]) || 0;
  return out;
}

const active = (s) => s.reviews > 0 || s.sessions > 0 || s.newCards > 0;

/** Days in a row with any study. Planned rest days and a not-yet-studied today do not break it. */
export function streak() {
  const days = getProfile().studyDays;
  let n = toDayNumber(todayKey());
  let count = 0;
  for (let i = 0; i < 400; i++, n--) {
    const key = fromDayNumber(n);
    if (active(dayStats(key))) count++;
    else if (i === 0 || !days.includes(weekdayOf(key))) continue;
    else break;
  }
  return count;
}

/** Totals over the last `days` days: [{key, reviews, correct, newCards, seconds, sessions}] oldest first. */
export function history(days) {
  const end = toDayNumber(todayKey());
  const out = [];
  for (let n = end - days + 1; n <= end; n++) {
    const key = fromDayNumber(n);
    out.push({ key, ...dayStats(key) });
  }
  return out;
}

// ---------------------------------------------------------------- journal (texts and notes the learner writes)

const journalDoc = (week) => `${scope()}.journal-w${String(week).padStart(2, '0')}`;
export const journalGet = (week, key) => store.get(journalDoc(week)).entries?.[key] ?? null;
export function journalSet(week, key, value) {
  store.update(journalDoc(week), (d) => {
    d.entries ??= {};
    d.entries[key] = { ...value, at: nowTs() };
  });
}

export const onChange = (fn) => store.on('change', fn);

/** The course a given learner is on (for the "Kto się uczy?" list). */
export const profileCourseId = (id) => store.get(`${id}.profile`).courseId ?? null;
