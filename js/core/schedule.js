// schedule.js — sessions, planned dates, calendar link (pure: no DOM, no storage).
//
// Dates are 'YYYY-MM-DD' keys; all arithmetic runs on whole UTC day numbers computed locally, so it
// is immune to DST and to the time zone of the device. Weekdays: 1 = Monday … 7 = Sunday.
//
// Details the spec leaves open, decided here:
//  * studyDays may be any non-empty subset of 1…7 in any order (duplicates and junk are dropped);
//    an empty or missing list means Monday–Saturday.
//  * plannedDate() returns null when profile.startDate is missing or not a real date (before
//    onboarding). status() then reports plannedForCurrent: null and behindSessions: 0.
//  * status() and realign() need `today` (a dateKey) and throw a TypeError without a valid one —
//    a wrong date here would silently move the whole plan.
//  * behindSessions = sessions planned for days BEFORE today that are not done. Today's own session
//    does not count until the day is over.
//  * isStudyDayToday looks only at the weekday (also before the start date).
//  * sessionPlan() follows the day table of the spec. Besides the documented fields every step also
//    carries `labelPl` and `minutes`, the test step of a module-test week carries `module: true`,
//    and the plan carries `moduleTest`. Day 5 has no learn step in the plan (the catch-up block for
//    words not yet introduced is the session host's decision).
//  * calendarUrl(profile, { appUrl, today?, isDoneFn?, remaining? }): the spec signature has no
//    `today`; pass it (and isDoneFn) to keep the call pure. Without `today` the device's local date
//    is used — the only place in this module that reads the clock. COUNT is `remaining` when given,
//    else the number of sessions not done (with isDoneFn), else the number of planned dates that are
//    today or later. The first occurrence is the first planned date >= today; when the whole plan
//    lies in the past it is the next study day >= today.

export const WEEKS = 24;
export const DAYS_PER_WEEK = 6;
export const TOTAL_SESSIONS = WEEKS * DAYS_PER_WEEK;
export const DEFAULT_STUDY_DAYS = Object.freeze([1, 2, 3, 4, 5, 6]);
export const TIME_ZONE = 'Europe/Warsaw';

export const STEP_LABELS_PL = Object.freeze({
  review: 'Powtórki',
  learn: 'Nowe słowa',
  reading: 'Czytanie',
  grammar: 'Gramatyka',
  listening: 'Słuchanie',
  writing: 'Pisanie',
  practice: 'Słowa w użyciu',
  speaking: 'Mówienie',
  test: 'Test tygodnia',
  input: 'Kontakt z językiem',
});

// Used only when program.json has no dayTemplate (it always has one).
const FALLBACK_TEMPLATE = Object.freeze([
  { day: 1, kind: 'reading', labelPl: 'Czytanie', learnSet: 1 },
  { day: 2, kind: 'grammar', labelPl: 'Gramatyka', learnSet: 2 },
  { day: 3, kind: 'listening', labelPl: 'Słuchanie', learnSet: 3 },
  { day: 4, kind: 'writing', labelPl: 'Pisanie', learnSet: 4 },
  { day: 5, kind: 'speaking', labelPl: 'Słowa w użyciu i mówienie', learnSet: null },
  { day: 6, kind: 'test', labelPl: 'Test tygodnia i kontakt z językiem', learnSet: null },
]);

const DAY_MS = 86400000;
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const pad2 = (n) => String(n).padStart(2, '0');
const mod = (a, b) => ((a % b) + b) % b;

// ---------------------------------------------------------------- local date helpers

function keyToNum(key) {
  if (typeof key !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.round(dt.getTime() / DAY_MS);
}

function numToKey(n) {
  const dt = new Date(n * DAY_MS);
  return `${String(dt.getUTCFullYear()).padStart(4, '0')}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

// Day 0 (1970-01-01) was a Thursday.
const weekdayOfNum = (n) => mod(n + 3, 7) + 1;

function reqToday(today, who) {
  const n = keyToNum(today);
  if (n === null) throw new TypeError(`schedule.${who}: today must be a 'YYYY-MM-DD' date key, got ${String(today)}`);
  return n;
}

function localTodayKey() {
  const d = new Date();
  return `${String(d.getFullYear()).padStart(4, '0')}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// ---------------------------------------------------------------- sessions

/** 'w01d1' for (1, 1). */
export function sid(week, day) {
  return `w${pad2(week)}d${day}`;
}

/** {week, day} for 'w01d1'; null for anything that is not a session id of this course. */
export function parseSid(value) {
  if (typeof value !== 'string') return null;
  const m = /^w(\d{2})d([1-6])$/.exec(value);
  if (!m) return null;
  const week = Number(m[1]);
  const day = Number(m[2]);
  if (week < 1 || week > WEEKS) return null;
  return { week, day };
}

/** 0-based position of a session in the course (0…143), or -1. */
export function sessionIndex(value) {
  const p = parseSid(value);
  return p ? (p.week - 1) * DAYS_PER_WEEK + (p.day - 1) : -1;
}

let sessionsCache = null;

/** [{sid, week, day}] × 144, in course order. A new array each call; the entries are frozen. */
export function allSessions() {
  if (!sessionsCache) {
    const list = [];
    for (let week = 1; week <= WEEKS; week++) {
      for (let day = 1; day <= DAYS_PER_WEEK; day++) list.push(Object.freeze({ sid: sid(week, day), week, day }));
    }
    sessionsCache = Object.freeze(list);
  }
  return sessionsCache.slice();
}

/** The weeks of the module that contains `week` (from program.modules; else blocks of four). */
export function moduleWeeks(program, week) {
  const mods = Array.isArray(program?.modules) ? program.modules : [];
  for (const m of mods) {
    if (Array.isArray(m?.weeks) && m.weeks.includes(week)) return m.weeks.slice().sort((a, b) => a - b);
  }
  const first = Math.floor((week - 1) / 4) * 4 + 1;
  return [first, first + 1, first + 2, first + 3];
}

/** True when the test of this week is a module test (the last week of its module; weeks 4, 8, …, 24). */
export function isModuleTestWeek(program, week) {
  const weeks = moduleWeeks(program, week);
  return weeks[weeks.length - 1] === week;
}

const STEP_MINUTES = Object.freeze({
  review: 8,
  learn: 12,
  reading: 20,
  grammar: 20,
  listening: 20,
  writing: 20,
  practice: 12,
  speaking: 15,
  test: 15,
  input: 12,
});

/**
 * Plan of one session:
 * {sid, week, day, kind, labelPl, steps:[{key, labelPl, minutes, set?, module?}], minutes, moduleTest}
 * Returns null for a week/day outside the course.
 */
export function sessionPlan(program, week, day) {
  if (!Number.isInteger(week) || !Number.isInteger(day) || week < 1 || week > WEEKS || day < 1 || day > DAYS_PER_WEEK) return null;
  const template = Array.isArray(program?.dayTemplate) && program.dayTemplate.length ? program.dayTemplate : FALLBACK_TEMPLATE;
  const tpl = template.find((t) => t && t.day === day) ?? FALLBACK_TEMPLATE[day - 1];
  const kind = tpl.kind;
  const moduleTest = kind === 'test' && isModuleTestWeek(program, week);

  const step = (key, extra) => ({ key, labelPl: STEP_LABELS_PL[key] ?? key, minutes: STEP_MINUTES[key] ?? 10, ...extra });
  const steps = [step('review')];
  if (Number.isInteger(tpl.learnSet) && tpl.learnSet > 0) steps.push(step('learn', { set: tpl.learnSet }));
  if (kind === 'speaking') {
    steps.push(step('practice'), step('speaking'));
  } else if (kind === 'test') {
    steps.push(moduleTest ? step('test', { module: true, labelPl: 'Test modułu' }) : step('test'), step('input'));
  } else {
    steps.push(step(kind));
  }

  let labelPl = typeof tpl.labelPl === 'string' && tpl.labelPl ? tpl.labelPl : (STEP_LABELS_PL[kind] ?? kind);
  if (moduleTest) labelPl = labelPl.replace('Test tygodnia', 'Test modułu');

  const minutes = Number.isFinite(tpl.minutes) && tpl.minutes > 0 ? tpl.minutes : steps.reduce((sum, s) => sum + s.minutes, 0);
  return { sid: sid(week, day), week, day, kind, labelPl, steps, minutes, moduleTest };
}

const doneFn = (isDoneFn) => (typeof isDoneFn === 'function' ? (id) => !!isDoneFn(id) : () => false);

/** Number of sessions done from the start without a gap (= index of the current session). */
function doneCount(isDoneFn) {
  const done = doneFn(isDoneFn);
  const sessions = allSessions();
  for (let k = 0; k < sessions.length; k++) if (!done(sessions[k].sid)) return k;
  return sessions.length;
}

/** The first session that is not done, or null when the course is finished. */
export function currentSid(isDoneFn) {
  const k = doneCount(isDoneFn);
  return k >= TOTAL_SESSIONS ? null : allSessions()[k].sid;
}

// ---------------------------------------------------------------- planned dates

/** Sorted unique weekdays (1…7) the learner studies; Monday–Saturday when the list is unusable. */
export function studyDaysOf(profile) {
  const raw = Array.isArray(profile?.studyDays) ? profile.studyDays : [];
  const set = new Set();
  for (const v of raw) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (Number.isInteger(n) && n >= 1 && n <= 7) set.add(n);
  }
  return set.size ? [...set].sort((a, b) => a - b) : DEFAULT_STUDY_DAYS.slice();
}

/** Day number of the study day that is `n` study days after (n < 0: before) the first study day on/after fromNum. */
function nthStudyDay(fromNum, days, n) {
  const wd = weekdayOfNum(fromNum);
  const monday = fromNum - (wd - 1);
  let idx = days.findIndex((d) => d >= wd);
  let weekOffset = 0;
  if (idx === -1) {
    idx = 0;
    weekOffset = 1;
  }
  const total = idx + n;
  return monday + 7 * (weekOffset + Math.floor(total / days.length)) + (days[mod(total, days.length)] - 1);
}

/** The first study day that is `dateKey` or later (a dateKey), or null for an invalid date. */
export function nextStudyDate(profile, dateKey) {
  const n = keyToNum(dateKey);
  return n === null ? null : numToKey(nthStudyDay(n, studyDaysOf(profile), 0));
}

/**
 * Planned date of a session: the n-th study day on/after profile.startDate
 * (n = (week-1)*6 + day). null without a valid start date or for a session outside the course.
 */
export function plannedDate(profile, week, day) {
  if (!Number.isInteger(week) || !Number.isInteger(day) || week < 1 || week > WEEKS || day < 1 || day > DAYS_PER_WEEK) return null;
  const start = keyToNum(profile?.startDate);
  if (start === null) return null;
  return numToKey(nthStudyDay(start, studyDaysOf(profile), (week - 1) * DAYS_PER_WEEK + (day - 1)));
}

/**
 * Where the learner stands on `today`:
 * {currentSid, plannedForCurrent, behindSessions, isStudyDayToday, finished,
 *  doneSessions, aheadSessions, nextStudyDate}
 */
export function status(profile, isDoneFn, today) {
  const todayNum = reqToday(today, 'status');
  const days = studyDaysOf(profile);
  const done = doneCount(isDoneFn);
  const finished = done >= TOTAL_SESSIONS;
  const sessions = allSessions();
  const start = keyToNum(profile?.startDate);

  let plannedBeforeToday = 0;
  let plannedThroughToday = 0;
  if (start !== null) {
    for (let k = 0; k < TOTAL_SESSIONS; k++) {
      const p = nthStudyDay(start, days, k);
      if (p < todayNum) plannedBeforeToday++;
      if (p <= todayNum) plannedThroughToday++;
      else break;
    }
  }

  return {
    currentSid: finished ? null : sessions[done].sid,
    plannedForCurrent: finished || start === null ? null : numToKey(nthStudyDay(start, days, done)),
    behindSessions: finished ? 0 : Math.max(0, plannedBeforeToday - done),
    isStudyDayToday: days.includes(weekdayOfNum(todayNum)),
    finished,
    doneSessions: done,
    aheadSessions: Math.max(0, done - plannedThroughToday),
    nextStudyDate: numToKey(nthStudyDay(todayNum, days, 0)),
  };
}

/**
 * New startDate such that the current session falls on the next study day >= today
 * (earlier sessions then lie on the study days before it). Returns the unchanged
 * startDate (or today when there is none) once the course is finished.
 */
export function realign(profile, isDoneFn, today) {
  const todayNum = reqToday(today, 'realign');
  const days = studyDaysOf(profile);
  const done = doneCount(isDoneFn);
  if (done >= TOTAL_SESSIONS) return keyToNum(profile?.startDate) === null ? numToKey(todayNum) : profile.startDate;
  const target = nthStudyDay(todayNum, days, 0);
  return numToKey(nthStudyDay(target, days, -done));
}

// ---------------------------------------------------------------- calendar

function parseTime(value) {
  const m = typeof value === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(value.trim()) : null;
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h <= 23 && min <= 59) return h * 60 + min;
  }
  return 19 * 60;
}

const stamp = (dayNum, minutes) =>
  `${numToKey(dayNum + Math.floor(minutes / 1440)).replace(/-/g, '')}T${pad2(Math.floor(mod(minutes, 1440) / 60))}${pad2(mod(minutes, 60))}00`;

/**
 * Google Calendar "TEMPLATE" link: a weekly recurring event on the study days at studyTime for
 * sessionMinutes (wall time, ctz=Europe/Warsaw), COUNT = remaining sessions.
 * options: { appUrl, today?, isDoneFn?, remaining? } — see the notes at the top of the file.
 */
export function calendarUrl(profile, options = {}) {
  const { appUrl, today, isDoneFn, remaining } = options ?? {};
  const days = studyDaysOf(profile);
  const todayNum = keyToNum(today) ?? keyToNum(localTodayKey());
  const start = keyToNum(profile?.startDate);

  let first = null;
  let plannedFromToday = 0;
  if (start !== null) {
    for (let k = 0; k < TOTAL_SESSIONS; k++) {
      const p = nthStudyDay(start, days, k);
      if (p >= todayNum) {
        if (first === null) first = p;
        plannedFromToday++;
      }
    }
  }
  if (first === null) first = nthStudyDay(todayNum, days, 0);

  let count;
  if (typeof remaining === 'number' && Number.isFinite(remaining)) count = Math.floor(remaining);
  else if (typeof isDoneFn === 'function') count = TOTAL_SESSIONS - doneCount(isDoneFn);
  else count = start === null ? TOTAL_SESSIONS : plannedFromToday;
  count = Math.min(TOTAL_SESSIONS, Math.max(1, count));

  const startMin = parseTime(profile?.studyTime);
  const rawLen = Number(profile?.sessionMinutes);
  const length = Number.isFinite(rawLen) && rawLen >= 5 ? Math.min(240, Math.round(rawLen)) : 40;

  const text = 'Angielski: Droga do C1';
  const detailLines = [`Sesja nauki angielskiego, około ${length} min: powtórki i lekcja dnia.`];
  if (typeof appUrl === 'string' && appUrl.trim()) detailLines.push(`Otwórz kurs: ${appUrl.trim()}`);

  const params = [
    ['action', 'TEMPLATE'],
    ['text', text],
    ['details', detailLines.join('\n')],
    ['dates', `${stamp(first, startMin)}/${stamp(first, startMin + length)}`],
    ['ctz', TIME_ZONE],
    ['recur', `RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d - 1]).join(',')};COUNT=${count}`],
  ];
  return `https://calendar.google.com/calendar/render?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}
