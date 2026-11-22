// common.js — small helpers shared by the screens.
import * as model from '../core/model.js';
import * as schedule from '../core/schedule.js';
import { todayKey, toDayNumber } from '../core/platform.js';
import { buildQueue } from '../core/srs.js';

/** isDone(sid) for the active course: every step of the session's plan is done. */
export function makeIsDone(program) {
  return (sid) => {
    const p = schedule.parseSid(sid);
    const plan = p && schedule.sessionPlan(program, p.week, p.day);
    return !!plan && model.sessionDone(sid, plan.steps.map((s) => s.key));
  };
}

/** Number of cards due today (capped by the learner's daily limit). */
export function dueCount() {
  return buildQueue(model.allCardStates(), toDayNumber(todayKey()), model.getProfile().maxReviews).length;
}

export const weekMeta = (program, week) => program.weekList?.find((w) => w.week === week) ?? null;
export const setSize = (program) => Math.max(1, Math.round((program.vocabPerWeek ?? 40) / 4));
export const initial = (name) => (String(name ?? '').trim()[0] ?? '?').toUpperCase();
