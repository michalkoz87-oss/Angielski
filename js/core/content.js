// content.js — loads course data (data/courses.json, data/courses/<id>/program.json and the
// weekly files). One course is active at a time (set by the model when the learner changes).

let courseId = null;
const cache = new Map(); // path -> Promise<json>
const items = new Map(); // "<course>/<itemId>" -> item

function base() {
  if (typeof globalThis.__DATA_BASE__ === 'string') return globalThis.__DATA_BASE__;
  return new URL('../../data/', import.meta.url).href;
}

const pad = (n) => String(n).padStart(2, '0');

function getJson(path) {
  if (!cache.has(path)) {
    const pending = fetch(base() + path).then((res) => {
      if (!res.ok) throw Object.assign(new Error(`Brak pliku ${path}`), { code: 'missing', path });
      return res.json();
    });
    pending.catch(() => cache.delete(path)); // a failed load may be retried later
    cache.set(path, pending);
  }
  return cache.get(path);
}

export function setCourse(id) {
  courseId = id || null;
}

export function currentCourse() {
  return courseId;
}

/** The list of courses (levels) from data/courses.json, ordered from the easiest. */
export async function loadCatalog() {
  const data = await getJson('courses.json');
  return [...(data.courses ?? [])].sort((a, b) => a.order - b.order);
}

export function loadProgram(course = courseId) {
  return getJson(`courses/${course}/program.json`);
}

export async function loadVocab(week, course = courseId) {
  const data = await getJson(`courses/${course}/weeks/w${pad(week)}-vocab.json`);
  for (const it of data.items ?? []) items.set(`${course}/${it.id}`, it);
  return data.items ?? [];
}

export function loadLessons(week, course = courseId) {
  return getJson(`courses/${course}/weeks/w${pad(week)}-lessons.json`);
}

/** Weeks of a course that have content (from the catalogue). */
export async function availableWeeks(course = courseId) {
  const list = await loadCatalog();
  return list.find((c) => c.id === course)?.availableWeeks ?? [];
}

/** True when the content of a week has been published. */
export async function hasWeek(week, course = courseId) {
  try {
    return (await availableWeeks(course)).includes(week);
  } catch {
    return false;
  }
}

/** All items of the published weeks from..to. */
export async function loadVocabRange(from, to, course = courseId) {
  const weeks = (await availableWeeks(course)).filter((w) => w >= from && w <= to);
  const loaded = await Promise.allSettled(weeks.map((w) => loadVocab(w, course)));
  return loaded.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

export function itemById(id, course = courseId) {
  return items.get(`${course}/${id}`) ?? null;
}

export function weekOfItem(id) {
  const m = /^w(\d{2})-/.exec(id ?? '');
  return m ? Number(m[1]) : null;
}

export function loadResources() {
  return getJson('resources.json');
}

/** "{{surface|id}}" / "{{surface}}" → [{text}, {text, id?, mark:true}] */
export function parseMarked(text) {
  const out = [];
  const re = /\{\{([^{}|]+)(?:\|([^{}|]+))?\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(text ?? ''))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[1], id: m[2] ?? null, mark: true });
    last = m.index + m[0].length;
  }
  if (last < (text ?? '').length) out.push({ text: text.slice(last) });
  return out;
}

export const stripMarks = (text) => (text ?? '').replace(/\{\{([^{}|]+)(?:\|[^{}|]+)?\}\}/g, '$1');
