// exercises.js — answer checking and question builders (pure: no DOM, no storage, no clock).
//
// Details the spec leaves open, decided here:
//  * normalize(s): NFC, lower case, every apostrophe variant → ', curly quotes → ", invisible characters
//    removed, runs of white space → one space, trimmed, trailing . ? ! … , ; : removed.
//  * isCorrect(input, answers) compares "canonical readings": on top of normalize() it ignores commas,
//    quotes, brackets and sentence punctuation, treats a hyphen as a space (well-known = well known,
//    but not wellknown) and expands contractions. Unambiguous ones map one-to-one (don't → do not,
//    can't / cannot → can not, won't → will not, I'm, 're, 've, 'll, let's → let us). Ambiguous ones
//    ('d = would | had, 's = is | has) are expanded to every reading on the LEARNER's side, but on the
//    ANSWER side (known-good English) the reading is narrowed by the next word where that is certain:
//    "I'd better" / "I'd gone" → had, "I'd go" / "I'd rather" → would, "it's been" / "he's got" → has.
//    So "I would go" matches "I'd go", but "I had go" and "I would better go" do not match.
//    A possessive 's is never expanded ("its" ≠ "it's", "Tom's car" ≠ "Tom is car"); after a noun
//    's becomes "has" only before been / got.
//  * shuffle() returns a NEW array and never touches its input (course content is frozen).
//  * diffWords() compares words without case, edge punctuation, hyphens and unambiguous contractions.
//    Entries: {word, status} where a 'wrong' entry also has `got` (what the learner typed instead).
//    ok / wrong / missing entries carry the expected word, 'extra' entries the learner's word.
//  * Question objects use the vocabulary of the course content (docs/CONTENT.md) so one widget can
//    render both: {type:'mc', prompt, options, answer:index} and {type:'gap', prompt with ___, answers}.
//    vocabQuestion() adds mode, itemId, optionIds and the fields listed at the function.
//  * buildTest() returns an ARRAY of questions that also carries, as non-enumerable properties,
//    kind ('weekly'|'module'), week, weeks, total, passMark (0.7) and `questions` (the array itself),
//    so both `test.length` and `test.questions.length` work. Options of mc questions are already
//    shuffled. With less content than a full week (the test fixtures) it returns fewer questions.
//  * checkAnswer(question, response) and answerText(question) are small extras for the test and
//    exercise screens.

import { moduleWeeks, isModuleTestWeek } from './schedule.js';

// ---------------------------------------------------------------- random

/** Deterministic PRNG in [0, 1) from a seed string. */
export function seededRng(seedString) {
  const str = String(seedString ?? '');
  let h = 1779033703 ^ str.length;
  for (let k = 0; k < str.length; k++) {
    h = Math.imul(h ^ str.charCodeAt(k), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  let a = (h ^ (h >>> 16)) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rngOf = (rng) => (typeof rng === 'function' ? rng : Math.random);

function randInt(rng, n) {
  const x = rng();
  const k = Math.floor((Number.isFinite(x) ? x : 0) * n);
  return k < 0 ? 0 : k >= n ? n - 1 : k;
}

/** Fisher–Yates on a copy; the input array is left untouched. */
export function shuffle(arr, rng) {
  const out = Array.isArray(arr) ? arr.slice() : Array.from(arr ?? []);
  const rand = rngOf(rng);
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rand, i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

// ---------------------------------------------------------------- normalisation

const APOSTROPHES = /[‘’‚‛ʼʹ`´′＇]/g;
const DOUBLE_QUOTES = /[“”„‟«»″＂]/g;
const HYPHENS = /[‐‑⁃﹣－]/g;
const DASHES = /[‒-―−]/g;
const INVISIBLE = /[​-‍⁠﻿­]/g;

/** Lower case, trimmed, single spaces, straight apostrophes, no trailing . ? ! … , ; : */
export function normalize(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(APOSTROPHES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(HYPHENS, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.?!…,;:]+$/u, '');
}

const CLITIC_TOKENS = new Set(["'s", "'d", "'ll", "'ve", "'re", "'m", "n't"]);

/** Words of a text for comparison: no punctuation, hyphen = space, apostrophes kept. */
function tokenize(s) {
  const t = normalize(s)
    .replace(DASHES, ' ')
    .replace(/["()[\]{}<>]/g, ' ')
    .replace(/[,;:!?…]/g, ' ')
    .replace(/\.(?=\s|$)/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return [];
  let words = t.split(' ');
  // Single quotes around the whole answer or around one word are quotation marks, not apostrophes.
  const last = words.length - 1;
  if (words[0].length > 1 && words[0].startsWith("'") && !CLITIC_TOKENS.has(words[0]) && words[last].length > 1 && words[last].endsWith("'") && last > 0) {
    words[0] = words[0].slice(1);
    words[last] = words[last].slice(0, -1);
  }
  words = words.map((w) => (w.length > 2 && w.startsWith("'") && w.endsWith("'") ? w.slice(1, -1) : w));
  return words.filter(Boolean);
}

// ---------------------------------------------------------------- contractions

const NEG_SPECIAL = { "can't": ['can', 'not'], cannot: ['can', 'not'], "won't": ['will', 'not'], "shan't": ['shall', 'not'] };
const NEG_AUX = new Set([
  'do', 'does', 'did', 'is', 'are', 'was', 'were', 'have', 'has', 'had', 'would', 'should', 'could',
  'must', 'need', 'might', 'ought', 'dare', 'may', 'used',
]);
// Bases after which 's can only be "is"/"has" (never a possessive).
const S_BASES = new Set(['he', 'she', 'it', 'that', 'there', 'here', 'what', 'who', 'where', 'when', 'why', 'how']);
const D_BASES = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they', 'there', 'that', 'who', 'what', 'where', 'when', 'why', 'how']);
const WH = new Set(['who', 'what', 'where', 'when', 'why', 'how']);

// Words that may stand between an auxiliary and its verb.
const MID_ADVERBS = new Set([
  'not', 'never', 'ever', 'always', 'just', 'already', 'also', 'only', 'even', 'still', 'often', 'sometimes',
  'almost', 'long', 'since', 'all', 'both', 'each', 'once', 'twice', 'now', 'then', 'soon', 'yet', 'so', 'quite',
  'indeed', 'perhaps', 'maybe',
]);
// Past participles that differ from the base form of their verb.
const PARTICIPLES = new Set(
  (
    'been borne born beaten begun bent bitten bled blown broken bred brought built burnt bought caught chosen clung ' +
    'crept dealt dug done drawn dreamt drunk driven eaten fallen fed felt fought found fled flown forbidden forgotten ' +
    'forgiven frozen got gotten given gone ground grown hung had heard hidden held kept knelt known laid led leant ' +
    'leapt learnt left lent lain lit lost made meant met mistaken paid proven ridden rung risen said seen sought sold ' +
    'sent sewn shaken shone shot shown shrunk sung sunk sat slept slid smelt sown spoken sped spelt spent spilt spun ' +
    'spoilt sprung stood stolen stuck stung stunk struck sworn swept swollen swum swung taken taught torn told thought ' +
    'thrown understood woken worn woven wept won wound withdrawn written undergone undertaken overtaken foreseen ' +
    'outgrown rebuilt retold rewritten undone upheld withheld awoken arisen bound bidden slain striven sawn shorn ' +
    'strewn trodden mown overheard overslept misunderstood repaid resold'
  ).split(' '),
);
// Verbs whose past participle equals the base form: after 'd both readings stay possible.
const SAME_FORM = new Set(
  ('come become overcome run outrun put cut hit let set reset shut hurt cost read quit spread bet burst cast ' +
    'broadcast forecast fit split upset beat bid rid shed wed slit thrust').split(' '),
);
// Base verbs that merely end in -ed.
const BASE_ED = new Set('need feed speed bleed breed exceed proceed succeed heed seed weed embed shred sled bed'.split(' '));

function headWord(rest) {
  for (const w of rest) {
    if (MID_ADVERBS.has(w) || (w.length > 3 && w.endsWith('ly'))) continue;
    return w;
  }
  return null;
}

const looksParticiple = (w) => PARTICIPLES.has(w) || (w.length > 3 && w.endsWith('ed') && !BASE_ED.has(w));

/** Readings of 'd before `rest`. strict = narrow by the next word (answer side). */
function readingsOfD(base, rest, strict) {
  const all = WH.has(base) ? ['would', 'had', 'did'] : ['would', 'had'];
  if (!strict) return all;
  const head = headWord(rest);
  if (head === null) return all;
  if (head === 'better' || head === 'best') return ['had'];
  if (SAME_FORM.has(head)) return all;
  if (looksParticiple(head)) return ['had'];
  return WH.has(base) ? ['would', 'did'] : ['would'];
}

/** Readings of 's after a pronoun-like base. strict = narrow by the next word (answer side). */
function readingsOfS(rest, strict) {
  if (!strict) return ['is', 'has'];
  const head = headWord(rest);
  if (head === null) return ['is', 'has'];
  if (head === 'been' || head === 'got' || head === 'had') return ['has'];
  // "he's finished", "she's gone", "he's come": both readings are real English.
  if (looksParticiple(head) || SAME_FORM.has(head)) return ['is', 'has'];
  return ['is'];
}

/**
 * Alternatives for one token; each alternative is an array of words.
 * `rest` = the following tokens (context for narrowing), `strict` = answer side.
 */
function expandToken(tok, rest, strict) {
  if (NEG_SPECIAL[tok]) return [NEG_SPECIAL[tok]];
  if (tok === "n't") return [['not']];

  let m = /^(.*)'(ve|ll|re|m|d|s)$/.exec(tok);
  if (m && /^[a-z']*$/.test(m[1])) {
    const base = m[1];
    const clitic = m[2];
    let tails = null;
    if (clitic === 've') tails = ['have'];
    else if (clitic === 're') tails = ['are'];
    else if (clitic === 'm') tails = base === 'i' || base === '' ? ['am'] : null;
    else if (clitic === 'll') tails = base === 'i' || base === 'we' ? ['will', 'shall'] : ['will'];
    else if (clitic === 'd') tails = base === '' || D_BASES.has(base) ? readingsOfD(base, rest, strict) : null;
    else if (clitic === 's') {
      if (base === 'let') tails = ['us'];
      else if (base === '' || S_BASES.has(base)) tails = readingsOfS(rest, strict);
      else {
        // After a noun 's is a possessive unless the next word proves it is "has".
        const head = headWord(rest);
        tails = head === 'been' || head === 'got' ? ['has'] : null;
      }
    }
    if (tails) {
      // A clitic stacked on another one ("I'd've"): the inner one is followed by this word.
      const bases = base === '' ? [[]] : expandToken(base, [tails[0], ...rest], strict);
      const out = [];
      for (const b of bases) for (const t of tails) out.push([...b, t]);
      return out;
    }
    return [[tok]];
  }

  m = /^([a-z]+)n't$/.exec(tok);
  if (m && NEG_AUX.has(m[1])) return [[m[1], 'not']];
  return [[tok]];
}

const MAX_READINGS = 48;

/** Set of canonical readings (space-joined words) of a text. */
function readings(text, strict) {
  const toks = tokenize(text);
  if (toks.length === 0) return new Set();
  let acc = [[]];
  for (let k = 0; k < toks.length; k++) {
    let alts = expandToken(toks[k], toks.slice(k + 1), strict);
    if (acc.length * alts.length > MAX_READINGS) alts = alts.slice(0, 1);
    const next = [];
    for (const a of acc) for (const alt of alts) next.push(a.concat(alt));
    acc = next;
  }
  return new Set(acc.map((words) => words.join(' ')));
}

/**
 * True when the learner's input is one of the accepted answers, ignoring case, spacing,
 * apostrophe type, punctuation and contracted vs full forms (see the notes at the top).
 * `answers` is a list of strings (a single string is accepted too). Empty input is never correct.
 */
export function isCorrect(input, answers) {
  const list = Array.isArray(answers) ? answers : answers === undefined || answers === null ? [] : [answers];
  const mine = readings(input, false);
  if (mine.size === 0) return false;
  for (const ans of list) {
    if (typeof ans !== 'string' && typeof ans !== 'number') continue;
    for (const r of readings(ans, true)) if (mine.has(r)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- word diff

function diffTokens(text) {
  const raw = String(text ?? '')
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(DASHES, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const words = [];
  for (const piece of raw) {
    const key = normalize(piece)
      .replace(/^[^\p{L}\p{N}']+/u, '')
      .replace(/[^\p{L}\p{N}']+$/u, '');
    if (!key) continue;
    const display = piece.replace(/^[^\p{L}\p{N}'’]+/u, '').replace(/[^\p{L}\p{N}'’]+$/u, '') || piece;
    words.push({ display, key });
  }
  // Split every word into comparison parts: hyphen parts and unambiguous contractions.
  const keys = words.map((w) => w.key);
  const parts = [];
  words.forEach((w, index) => {
    const pieces = w.key.split('-').filter(Boolean);
    const rest = keys.slice(index + 1);
    for (const p of pieces) {
      const alts = expandToken(p, rest, true);
      const list = alts.length === 1 ? alts[0] : [p];
      for (const key of list) parts.push({ key, word: index });
    }
  });
  return { words, parts };
}

/**
 * Word-level diff for dictation feedback (LCS based).
 * Returns [{word, status:'ok'|'wrong'|'missing'|'extra', got?}] in reading order.
 */
export function diffWords(expected, actual) {
  const exp = diffTokens(expected);
  const act = diffTokens(actual);
  const a = exp.parts;
  const b = act.parts;
  const n = a.length;
  const m = b.length;

  // LCS table over the comparison parts.
  const w = m + 1;
  const table = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * w + j] = a[i].key === b[j].key ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    }
  }

  // Per expected word: how many of its parts matched, and what the learner typed in its place.
  const info = exp.words.map(() => ({ parts: 0, matched: 0, got: [] }));
  for (const p of a) info[p.word].parts++;
  const out = [];
  const usedActual = new Set(); // typed words already accounted for
  let emitted = 0; // expected words already written to `out`

  const flushExpected = (upTo) => {
    for (; emitted < upTo; emitted++) {
      const e = info[emitted];
      const word = exp.words[emitted].display;
      if (e.matched === e.parts) out.push({ word, status: 'ok' });
      else if (e.matched > 0 || e.got.length) out.push({ word, status: 'wrong', got: e.got.join(' ') });
      else out.push({ word, status: 'missing' });
    }
  };

  // Unmatched runs between two anchors: pair them up as substitutions, the rest is missing / extra.
  let missRun = [];
  let extraRun = [];
  const closeGap = (nextExpectedWord) => {
    const miss = [...new Set(missRun)];
    const extra = [...new Set(extraRun)].filter((idx) => !usedActual.has(idx));
    const pairs = Math.min(miss.length, extra.length);
    for (let k = 0; k < pairs; k++) info[miss[k]].got.push(act.words[extra[k]].display);
    for (const idx of extra) usedActual.add(idx);
    if (extra.length > pairs) {
      flushExpected(nextExpectedWord);
      for (let k = pairs; k < extra.length; k++) out.push({ word: act.words[extra[k]].display, status: 'extra' });
    }
    missRun = [];
    extraRun = [];
  };

  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i].key === b[j].key) {
      closeGap(a[i].word);
      info[a[i].word].matched++;
      usedActual.add(b[j].word);
      i++;
      j++;
    } else if (j < m && (i === n || table[i * w + j + 1] >= table[(i + 1) * w + j])) {
      extraRun.push(b[j].word);
      j++;
    } else {
      missRun.push(a[i].word);
      i++;
    }
  }
  closeGap(exp.words.length);
  flushExpected(exp.words.length);
  return out;
}

// ---------------------------------------------------------------- vocabulary questions

const MARK = /\{\{([^{}|]+)(?:\|([^{}|]+))?\}\}/;
const MARK_ALL = /\{\{([^{}|]+)(?:\|([^{}|]+))?\}\}/g;
const stripMarks = (s) => String(s ?? '').replace(MARK_ALL, '$1');
const GAP = '___';

/** {before, answer, after} from item.example (its {{surface}} marker is the answer). */
export function cloze(item) {
  const example = typeof item?.example === 'string' ? item.example : '';
  const term = typeof item?.term === 'string' ? item.term : '';
  const m = MARK.exec(example);
  if (m) {
    return {
      before: stripMarks(example.slice(0, m.index)),
      answer: m[1].trim(),
      after: stripMarks(example.slice(m.index + m[0].length)),
    };
  }
  // No marker (content error): fall back to the term itself where it occurs in the sentence.
  const at = term ? example.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (at >= 0) return { before: example.slice(0, at), answer: example.slice(at, at + term.length), after: example.slice(at + term.length) };
  return { before: '', answer: term, after: '' };
}

const weekOfId = (id) => {
  const m = /^w(\d{2})-\d{2}$/.exec(String(id ?? ''));
  return m ? Number(m[1]) : null;
};

/** Normalised Polish variants of a `pl` field ("niezawodny, godny zaufania" → 2 variants). */
function plVariants(pl) {
  return String(pl ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[,;/]/)
    .map((v) => v.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function pickDistractors(item, pool, rng, valueOf) {
  const week = weekOfId(item.id);
  const termKey = normalize(item.term);
  const meanings = new Set(plVariants(item.pl));
  const taken = new Set([normalize(valueOf(item))]);
  const candidates = [];
  for (const c of Array.isArray(pool) ? pool : []) {
    if (!c || typeof c !== 'object' || c.id === item.id) continue;
    const value = valueOf(c);
    if (typeof value !== 'string' || !value.trim()) continue;
    // Never offer something that would also be a right answer.
    if (normalize(c.term) === termKey) continue;
    if (plVariants(c.pl).some((v) => meanings.has(v))) continue;
    const score = (weekOfId(c.id) === week ? 8 : 0) + (c.pos === item.pos ? 2 : 0) + (c.type === item.type ? 1 : 0);
    candidates.push({ c, value, score, tie: rng() });
  }
  candidates.sort((x, y) => y.score - x.score || x.tie - y.tie);
  const picked = [];
  for (const cand of candidates) {
    const key = normalize(cand.value);
    if (taken.has(key)) continue;
    taken.add(key);
    picked.push(cand);
    if (picked.length === 3) break;
  }
  return picked;
}

/**
 * One question about a vocabulary item.
 *  'choose-pl'   {type:'mc', mode, itemId, prompt: term, ipa, options: Polish meanings, optionIds, answer}
 *  'choose-term' {type:'mc', mode, itemId, prompt: definition, sentence: example with ___, cloze, hintPl, options: terms, optionIds, answer}
 *  'type-term'   {type:'gap', mode, itemId, prompt: example with ___, cloze, hintPl, def, answers:[surface form]}
 * Distractors come from `pool` (same week first, then same part of speech / type); an item with the
 * same term or an overlapping Polish meaning is never used. Four options when the pool allows.
 */
export function vocabQuestion(item, pool, mode, rng) {
  if (!item || typeof item !== 'object') throw new TypeError('vocabQuestion: item is required');
  const rand = rngOf(rng);
  const gap = cloze(item);
  const sentence = `${gap.before}${GAP}${gap.after}`;

  if (mode === 'type-term') {
    return {
      type: 'gap',
      mode,
      itemId: item.id,
      prompt: sentence,
      cloze: gap,
      hintPl: item.pl,
      def: item.def,
      answers: [gap.answer],
    };
  }
  if (mode !== 'choose-pl' && mode !== 'choose-term') throw new TypeError(`vocabQuestion: unknown mode ${String(mode)}`);

  const valueOf = mode === 'choose-pl' ? (it) => it.pl : (it) => it.term;
  const distractors = pickDistractors(item, pool, rand, valueOf);
  const entries = shuffle([{ id: item.id, value: valueOf(item) }, ...distractors.map((d) => ({ id: d.c.id, value: d.value }))], rand);
  const base = {
    type: 'mc',
    mode,
    itemId: item.id,
    options: entries.map((e) => e.value),
    optionIds: entries.map((e) => e.id),
    answer: entries.findIndex((e) => e.id === item.id),
  };
  if (mode === 'choose-pl') return { ...base, prompt: item.term, ipa: item.ipa };
  return { ...base, prompt: item.def, sentence, cloze: gap, hintPl: item.pl };
}

// ---------------------------------------------------------------- tests

function lookup(byWeek, week) {
  if (!byWeek) return undefined;
  if (byWeek instanceof Map) return byWeek.get(week) ?? byWeek.get(String(week));
  return byWeek[week] ?? byWeek[String(week)] ?? byWeek[`w${String(week).padStart(2, '0')}`];
}

function itemsOfWeek(vocabByWeek, week) {
  if (Array.isArray(vocabByWeek)) return vocabByWeek.filter((it) => weekOfId(it?.id) === week);
  const v = lookup(vocabByWeek, week);
  const list = Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : [];
  return list.filter((it) => it && typeof it === 'object' && typeof it.term === 'string');
}

/** Take up to `count` entries, one list after another in turn, so every week is represented. */
function drawAcross(lists, count) {
  const out = [];
  const pos = lists.map(() => 0);
  let progressed = true;
  while (out.length < count && progressed) {
    progressed = false;
    for (let k = 0; k < lists.length && out.length < count; k++) {
      if (pos[k] < lists[k].length) {
        out.push(lists[k][pos[k]++]);
        progressed = true;
      }
    }
  }
  return out;
}

const cleanAnswers = (answers) => (Array.isArray(answers) ? answers.filter((x) => typeof x === 'string' && x.trim()) : []);

function grammarQuestion(raw, week, n, rand) {
  if (!raw || typeof raw !== 'object' || typeof raw.prompt !== 'string') return null;
  const common = { id: `g-w${String(week).padStart(2, '0')}-${n}`, section: 'grammar', week, prompt: raw.prompt, explanationPl: raw.explanationPl ?? '' };
  if (raw.type === 'mc') {
    if (!Array.isArray(raw.options) || !Number.isInteger(raw.answer) || raw.answer < 0 || raw.answer >= raw.options.length) return null;
    const entries = shuffle(raw.options.map((text, index) => ({ text, right: index === raw.answer })), rand);
    return { ...common, type: 'mc', options: entries.map((e) => e.text), answer: entries.findIndex((e) => e.right) };
  }
  if (raw.type === 'gap' || raw.type === 'transform') {
    const answers = cleanAnswers(raw.answers);
    if (!answers.length) return null;
    const q = { ...common, type: raw.type, answers };
    if (raw.type === 'transform') {
      q.keyword = raw.keyword;
      q.gapped = raw.gapped;
    }
    return q;
  }
  return null;
}

/**
 * Weekly test: 12 vocabulary + 5 grammar test items + 3 word formation = 20 questions.
 * Module test (the last week of a module: 4, 8, …, 24): 20 vocabulary across the module's weeks,
 * 8 grammar test items and 4 word formation = 32.
 * vocabByWeek / lessonsByWeek: {week: items[] | lessons} keyed by week number (a Map works too;
 * vocabByWeek may also be a flat item array). Deterministic for a given rng.
 * Every question: {id, section:'vocab'|'grammar'|'wordFormation', week, type, …} — see the notes
 * at the top of the file for the array's extra properties.
 */
export function buildTest({ week, program, vocabByWeek, lessonsByWeek, rng } = {}) {
  if (!Number.isInteger(week)) throw new TypeError(`buildTest: week must be an integer, got ${String(week)}`);
  const rand = rngOf(rng);
  const isModule = isModuleTestWeek(program, week);
  const weeks = isModule ? moduleWeeks(program, week) : [week];
  const want = isModule ? { vocab: 20, grammar: 8, wordFormation: 4 } : { vocab: 12, grammar: 5, wordFormation: 3 };

  // Vocabulary: spread over the weeks, then a fixed mix of the three question modes.
  const pools = new Map(weeks.map((wk) => [wk, itemsOfWeek(vocabByWeek, wk)]));
  const chosen = drawAcross(weeks.map((wk) => shuffle(pools.get(wk), rand)), want.vocab);
  const third = Math.floor(chosen.length / 3);
  const order = shuffle(chosen, rand);
  const vocab = order.map((item, k) => {
    const mode = k < third ? 'choose-pl' : k < chosen.length - third ? 'choose-term' : 'type-term';
    const wk = weekOfId(item.id) ?? week;
    const q = vocabQuestion(item, pools.get(wk) ?? [], mode, rand);
    return { id: `v-${item.id}`, section: 'vocab', week: wk, ...q };
  });

  // Grammar: the testItems of each week.
  const grammarLists = weeks.map((wk) => {
    const items = lookup(lessonsByWeek, wk)?.grammar?.testItems;
    const list = (Array.isArray(items) ? items : []).map((raw, n) => ({ raw, wk, n }));
    return shuffle(list, rand);
  });
  const grammar = drawAcross(grammarLists, want.grammar)
    .map(({ raw, wk, n }) => grammarQuestion(raw, wk, n + 1, rand))
    .filter(Boolean);

  // Word formation.
  const wfLists = weeks.map((wk) => {
    const items = lookup(lessonsByWeek, wk)?.practice?.wordFormation;
    const list = (Array.isArray(items) ? items : []).map((raw, n) => ({ raw, wk, n }));
    return shuffle(list, rand);
  });
  const wordFormation = drawAcross(wfLists, want.wordFormation)
    .map(({ raw, wk, n }) => {
      const answers = cleanAnswers(raw?.answers);
      if (!raw || typeof raw.sentence !== 'string' || !answers.length) return null;
      return {
        id: `wf-w${String(wk).padStart(2, '0')}-${n + 1}`,
        section: 'wordFormation',
        week: wk,
        type: 'wordFormation',
        prompt: raw.sentence,
        sentence: raw.sentence,
        base: raw.base,
        answers,
      };
    })
    .filter(Boolean);

  const questions = [...shuffle(vocab, rand), ...grammar, ...wordFormation];
  Object.defineProperties(questions, {
    kind: { value: isModule ? 'module' : 'weekly' },
    week: { value: week },
    weeks: { value: weeks.slice() },
    total: { value: questions.length },
    passMark: { value: 0.7 },
    questions: { value: questions },
  });
  return questions;
}

// ---------------------------------------------------------------- checking helpers

const typedTypes = new Set(['gap', 'transform', 'wordFormation', 'gapFill']);

/**
 * True when `response` answers `question` correctly.
 *  mc: the option index (or the option text); tf: 'true' | 'false' | 'not_given';
 *  typed questions (gap, transform, wordFormation, gapFill): isCorrect() against `answers`, and the
 *  whole sentence with the gap filled in is accepted as well.
 */
export function checkAnswer(question, response) {
  if (!question || typeof question !== 'object') return false;
  const type = question.type ?? (Array.isArray(question.options) ? 'mc' : Array.isArray(question.answers) ? 'gap' : 'tf');
  if (type === 'mc') {
    if (typeof response === 'number') return response === question.answer;
    if (typeof response === 'string' && Array.isArray(question.options)) {
      const right = question.options[question.answer];
      return typeof right === 'string' && normalize(response) === normalize(right);
    }
    return false;
  }
  if (type === 'tf') {
    if (typeof response === 'boolean') return String(response) === String(question.answer);
    return typeof response === 'string' && response.trim().toLowerCase() === String(question.answer).toLowerCase();
  }
  if (typedTypes.has(type) || Array.isArray(question.answers)) {
    const answers = cleanAnswers(question.answers);
    if (isCorrect(response, answers)) return true;
    const frame = [question.gapped, question.sentence, question.prompt].find((s) => typeof s === 'string' && /_{3,}/.test(s));
    if (!frame) return false;
    return isCorrect(response, answers.map((ans) => frame.replace(/_{3,}/, () => ans)));
  }
  return false;
}

/** The right answer as text, for the review after a test ('' when unknown). */
export function answerText(question) {
  if (!question || typeof question !== 'object') return '';
  if (Array.isArray(question.options) && Number.isInteger(question.answer)) return String(question.options[question.answer] ?? '');
  if (Array.isArray(question.answers) && question.answers.length) return String(question.answers[0]);
  if (typeof question.answer === 'string') return question.answer;
  return '';
}
