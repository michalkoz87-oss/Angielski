#!/usr/bin/env node
// Walidator treści kursów. Limity (liczba haseł, długości tekstów itd.) pochodzą z pola "content"
// w data/courses/<kurs>/program.json, więc każdy poziom ma własne wymagania.
//
//   node scripts/validate-content.mjs                         – wszystkie kursy w data/courses
//   node scripts/validate-content.mjs --course b2c1           – jeden kurs
//   node scripts/validate-content.mjs --course b2c1 --week 7  – jeden tydzień
//   node scripts/validate-content.mjs --dir <katalog> [--program <plik>]  – inny katalog z plikami wNN-*.json
//   --relaxed       bez limitów ilościowych (dane testowe)
//   --vocab-only    przy --week: nie wymagaj pliku lekcji
//   --require-all   błąd, jeśli brakuje któregokolwiek tygodnia kursu
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const relaxed = args.includes('--relaxed');
const requireAll = args.includes('--require-all');
const vocabOnly = args.includes('--vocab-only');
const onlyWeek = opt('--week') ? Number(opt('--week')) : null;

const DEFAULT_LIMITS = {
  levels: ['B2', 'C1'],
  vocabPerWeek: 40,
  typeRange: { word: [20, 24], phrasal: [7, 9], collocation: [5, 7], idiom: [3, 5] },
  exampleWords: [6, 26],
  mcOptions: [4, 4],
  reading: { paragraphs: [3, 7], words: [300, 460], minTargets: 12, glossary: [4, 8], questions: 6, minMc: 3 },
  grammar: { sections: [3, 6], examplesPerSection: [2, 5], pitfalls: [3, 5], exercises: 12, minTyped: 4, testItems: 5, allowTransform: true },
  listening: { dictation: 6, dictationWords: [6, 16], monologueParagraphs: [2, 5], monologueWords: [170, 260], questions: 4 },
  writing: { minWords: [80, 180], maxWords: [120, 220], minTargets: 5, checklist: [3, 5], phrases: [5, 8] },
  speaking: { prompts: 5, shadowing: 5, shadowingWords: [8, 18] },
  practice: { gapFill: 10, matching: 8, wordFormation: 6 },
};

const TYPES = ['word', 'phrasal', 'collocation', 'idiom'];
const POS = ['n', 'v', 'adj', 'adv', 'phr v', 'phrase', 'idiom', 'prep', 'conj', 'pron', 'det', 'num', 'excl'];
const ALL_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];

let errors = 0;
let warnings = 0;
let checked = 0;
let prefix = '';
const err = (file, msg) => {
  errors++;
  console.log(`BŁĄD  ${prefix}${file}: ${msg}`);
};
const warn = (file, msg) => {
  warnings++;
  console.log(`uwaga ${prefix}${file}: ${msg}`);
};

const pad = (n) => String(n).padStart(2, '0');
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isArr = (v) => Array.isArray(v);
const inRange = (n, [lo, hi]) => n >= lo && n <= hi;
const rangeText = ([lo, hi]) => (lo === hi ? `${lo}` : `${lo}–${hi}`);
const words = (s) => (s.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
const MARK = /\{\{([^{}|]+)(?:\|([^{}|]+))?\}\}/g;
const stripMarks = (s) => s.replace(MARK, '$1');
const marks = (s) => [...s.matchAll(MARK)].map((m) => ({ surface: m[1], id: m[2] || null }));
const gaps = (s) => (s.match(/_{3,}/g) || []).length;
const normTerm = (t) =>
  t
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(sb|sth|somebody|something|someone|one's|your|sb's)\b/g, ' ')
    .replace(/^to\s+/, '')
    .replace(/[^a-z' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function mergeLimits(custom) {
  const out = structuredClone(DEFAULT_LIMITS);
  if (!custom) return out;
  for (const [k, v] of Object.entries(custom)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = { ...out[k], ...v };
    else out[k] = v;
  }
  return out;
}

function readJson(dir, file) {
  const path = join(dir, file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    err(file, `niepoprawny JSON: ${e.message}`);
    return undefined;
  }
}

function checkBadText(file, where, s) {
  if (typeof s !== 'string') return;
  if (/<[a-z/][^>]*>/i.test(s)) err(file, `${where}: HTML jest niedozwolony`);
  if (/�/.test(s)) err(file, `${where}: uszkodzony znak (U+FFFD)`);
}

function checkMc(file, where, q, [minOpts, maxOpts]) {
  if (!isStr(q.q ?? q.prompt)) err(file, `${where}: brak treści pytania`);
  if (!isArr(q.options) || q.options.length < minOpts || q.options.length > maxOpts) {
    err(file, `${where}: options musi mieć ${rangeText([minOpts, maxOpts])} pozycji`);
  } else {
    if (q.options.some((o) => !isStr(o))) err(file, `${where}: pusta opcja`);
    const set = new Set(q.options.map((o) => String(o).trim().toLowerCase()));
    if (set.size !== q.options.length) err(file, `${where}: powtórzone opcje`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) err(file, `${where}: answer musi być indeksem opcji`);
    if (q.options.some((o) => /all of the above|none of the above|both a and b/i.test(String(o)))) err(file, `${where}: opcja typu „all of the above” jest niedozwolona`);
  }
  if (!isStr(q.explanationPl)) err(file, `${where}: brak explanationPl`);
}

function checkAnswers(file, where, answers) {
  if (!isArr(answers) || answers.length === 0 || answers.some((a) => !isStr(a))) {
    err(file, `${where}: answers musi być niepustą listą tekstów`);
    return false;
  }
  return true;
}

function checkGrammarItem(file, where, ex, allowed) {
  if (!allowed.includes(ex.type)) {
    err(file, `${where}: type musi być jednym z ${allowed.join('/')}`);
    return;
  }
  if (ex.type === 'mc') {
    checkMc(file, where, ex, [3, 4]);
    if (isStr(ex.prompt) && gaps(ex.prompt) > 1) err(file, `${where}: najwyżej jedna luka ___ w prompt`);
  } else if (ex.type === 'gap') {
    if (!isStr(ex.prompt) || gaps(ex.prompt) !== 1) err(file, `${where}: prompt musi zawierać dokładnie jedno ___`);
    checkAnswers(file, where, ex.answers);
    if (!isStr(ex.explanationPl)) err(file, `${where}: brak explanationPl`);
  } else if (ex.type === 'transform') {
    if (!isStr(ex.prompt)) err(file, `${where}: brak prompt`);
    if (!isStr(ex.keyword) || ex.keyword !== ex.keyword.toUpperCase()) err(file, `${where}: keyword wielkimi literami`);
    if (!isStr(ex.gapped) || gaps(ex.gapped) !== 1) err(file, `${where}: gapped musi zawierać dokładnie jedno ___`);
    if (checkAnswers(file, where, ex.answers) && isStr(ex.keyword)) {
      const kw = ex.keyword.toLowerCase();
      for (const a of ex.answers) {
        const n = words(a);
        if (!relaxed && (n < 2 || n > 6)) err(file, `${where}: odpowiedź „${a}” powinna mieć 2–5 słów`);
        if (!a.toLowerCase().replace(/’/g, "'").includes(kw)) err(file, `${where}: odpowiedź „${a}” nie zawiera słowa kluczowego ${ex.keyword}`);
      }
    }
    if (!isStr(ex.explanationPl)) err(file, `${where}: brak explanationPl`);
  }
}

function validateVocab(week, data, L, weekMeta) {
  const file = `w${pad(week)}-vocab.json`;
  const ids = new Set();
  if (data.week !== week) err(file, `week = ${data.week}, oczekiwano ${week}`);
  if (!isStr(data.theme)) err(file, 'brak theme');
  if (!isArr(data.items)) {
    err(file, 'brak items');
    return { ids, terms: [] };
  }
  if (!relaxed && data.items.length !== L.vocabPerWeek) err(file, `items: ${data.items.length}, oczekiwano ${L.vocabPerWeek}`);
  const counts = { word: 0, phrasal: 0, collocation: 0, idiom: 0 };
  const levels = {};
  const terms = [];
  const seenTerms = new Set();
  data.items.forEach((it, i) => {
    const where = `items[${i}] (${it?.term ?? '?'})`;
    const expectId = `w${pad(week)}-${pad(i + 1)}`;
    if (it.id !== expectId) err(file, `${where}: id = ${it.id}, oczekiwano ${expectId}`);
    ids.add(it.id);
    if (!isStr(it.term)) err(file, `${where}: brak term`);
    else {
      if (/^to\s/i.test(it.term)) err(file, `${where}: term bez „to”`);
      const nt = normTerm(it.term);
      if (seenTerms.has(nt)) err(file, `${where}: hasło powtórzone w tygodniu`);
      seenTerms.add(nt);
      terms.push({ id: it.id, term: it.term, norm: nt });
    }
    if (!TYPES.includes(it.type)) err(file, `${where}: type ${it.type}`);
    else counts[it.type]++;
    if (!POS.includes(it.pos)) err(file, `${where}: pos ${it.pos}`);
    if (!(relaxed ? ALL_LEVELS : L.levels).includes(it.level)) err(file, `${where}: level ${it.level} (dozwolone ${L.levels.join(', ')})`);
    else levels[it.level] = (levels[it.level] || 0) + 1;
    if (!isStr(it.ipa) || !/^\/[^/]+\/$/.test(it.ipa.trim())) err(file, `${where}: ipa w ukośnikach /…/`);
    for (const f of ['pl', 'def', 'example', 'examplePl']) {
      if (!isStr(it[f])) err(file, `${where}: brak ${f}`);
      checkBadText(file, `${where}.${f}`, it[f]);
    }
    if (isStr(it.example)) {
      const ms = marks(it.example);
      if (ms.length !== 1) err(file, `${where}: example musi mieć dokładnie jeden znacznik {{…}} (jest ${ms.length})`);
      else if (ms[0].id) err(file, `${where}: znacznik w example bez |id`);
      const n = words(stripMarks(it.example));
      if (!relaxed && !inRange(n, L.exampleWords)) err(file, `${where}: example ma ${n} słów (dozwolone ${rangeText(L.exampleWords)})`);
      if (/_{3,}/.test(it.example)) err(file, `${where}: example nie może zawierać ___`);
    }
    if (isStr(it.def) && isStr(it.term) && it.type === 'word') {
      const re = new RegExp(`\\b${it.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(it.def)) warn(file, `${where}: definicja zawiera samo hasło`);
    }
    if (!isArr(it.collocations) || it.collocations.length > 3 || it.collocations.some((c) => !isStr(c))) err(file, `${where}: collocations: lista 0–3 tekstów`);
    else if (it.collocations.length === 0 && it.type === 'word') err(file, `${where}: collocations puste (dla type "word" wymagane 1–3)`);
    if (it.family !== undefined && (!isArr(it.family) || it.family.length > 4 || it.family.some((c) => !isStr(c)))) err(file, `${where}: family: lista do 4 tekstów`);
    if (it.note !== undefined && !isStr(it.note)) err(file, `${where}: note pusty – usuń pole`);
    const known = ['id', 'term', 'type', 'pos', 'level', 'ipa', 'pl', 'def', 'example', 'examplePl', 'collocations', 'family', 'note'];
    for (const k of Object.keys(it)) if (!known.includes(k)) err(file, `${where}: nieznane pole ${k}`);
  });
  if (!relaxed) {
    for (const t of TYPES) {
      const r = L.typeRange[t];
      if (!inRange(counts[t], r)) err(file, `liczba haseł typu ${t}: ${counts[t]} (dozwolone ${rangeText(r)})`);
    }
    const setSize = L.vocabPerWeek / 4;
    const minKinds = L.vocabPerWeek >= 40 ? 3 : 2;
    for (let d = 0; d < 4; d++) {
      const slice = data.items.slice(d * setSize, d * setSize + setSize);
      const kinds = new Set(slice.map((x) => x.type));
      if (slice.length === setSize && kinds.size < minKinds) err(file, `zestaw dnia ${d + 1} ma za mało typów haseł (${[...kinds].join(', ')})`);
    }
    if (weekMeta?.mix) {
      for (const [lvl, target] of Object.entries(weekMeta.mix)) {
        const got = levels[lvl] || 0;
        if (Math.abs(got - target) > 5) warn(file, `poziom ${lvl}: ${got} haseł, plan zakładał ${target}`);
      }
    }
  }
  return { ids, terms };
}

function checkMarkedIds(file, where, text, ids, minDistinct) {
  const ms = marks(text);
  const distinct = new Set();
  for (const m of ms) {
    if (!m.id) err(file, `${where}: znacznik {{${m.surface}}} bez |id`);
    else if (!ids.has(m.id)) err(file, `${where}: znacznik wskazuje nieistniejące hasło ${m.id}`);
    else distinct.add(m.id);
  }
  if (/\{\{|\}\}/.test(text.replace(MARK, ''))) err(file, `${where}: uszkodzony znacznik {{…}}`);
  if (distinct.size < minDistinct) err(file, `${where}: ${distinct.size} różnych haseł tygodnia, wymagane co najmniej ${minDistinct}`);
}

function validateLessons(week, data, ids, L) {
  const file = `w${pad(week)}-lessons.json`;
  if (data.week !== week) err(file, `week = ${data.week}, oczekiwano ${week}`);
  if (!isStr(data.intro)) err(file, 'brak intro');
  else if (!relaxed && (data.intro.length < 60 || data.intro.length > 600)) err(file, `intro: ${data.intro.length} znaków (dozwolone 60–600)`);

  // reading
  const r = data.reading;
  const RL = L.reading;
  if (!r) err(file, 'brak reading');
  else {
    if (!isStr(r.title)) err(file, 'reading: brak title');
    if (!isArr(r.paragraphs) || r.paragraphs.some((p) => !isStr(p))) err(file, 'reading.paragraphs: lista tekstów');
    else {
      const full = r.paragraphs.join('\n');
      const n = words(stripMarks(full));
      if (!relaxed) {
        if (!inRange(r.paragraphs.length, RL.paragraphs)) err(file, `reading: ${r.paragraphs.length} akapitów (dozwolone ${rangeText(RL.paragraphs)})`);
        if (!inRange(n, RL.words)) err(file, `reading: ${n} słów (dozwolone ${rangeText(RL.words)})`);
      }
      checkMarkedIds(file, 'reading', full, ids, relaxed ? 1 : RL.minTargets);
      checkBadText(file, 'reading.paragraphs', stripMarks(full).replace(/\n/g, ' '));
    }
    if (isArr(r.paragraphs) && !relaxed) {
      // Słowa tekstu poza znacznikami {{…}} (te mają pełne hasła): każde potrzebuje tłumaczenia w wordGloss.
      const plain = r.paragraphs.filter(isStr).join('\n').replace(MARK, ' ');
      const tokens = [...new Set((plain.match(/\p{L}+(?:[-'’]\p{L}+)*/gu) || []).map((w) => w.toLowerCase().replace(/’/g, "'")))];
      const wg = r.wordGloss;
      if (wg === undefined) err(file, `reading.wordGloss: brak. Potrzebne tłumaczenia ${tokens.length} słów: ${tokens.join(', ')}`);
      else if (wg === null || typeof wg !== 'object' || Array.isArray(wg)) err(file, 'reading.wordGloss: obiekt {słowo: tłumaczenie}');
      else {
        const missing = tokens.filter((w) => !isStr(wg[w]));
        if (missing.length) err(file, `reading.wordGloss: brak tłumaczeń ${missing.length} słów: ${missing.join(', ')}`);
        const long = Object.entries(wg).filter(([, v]) => isStr(v) && v.length > 80).map(([k]) => k);
        if (long.length) err(file, `reading.wordGloss: tłumaczenia dłuższe niż 80 znaków: ${long.join(', ')}`);
      }
      // Wyrażenia z tekstu (poza znacznikami), których nie da się zrozumieć słowo po słowie.
      if (!isArr(r.phrases) || r.phrases.some((p) => !isStr(p?.text) || !isStr(p?.pl))) err(file, 'reading.phrases: lista {text, pl} (wyrażenia z tekstu z tłumaczeniem)');
      else {
        if (r.phrases.length < 3) err(file, `reading.phrases: ${r.phrases.length}, wymagane co najmniej 3`);
        const low = plain.toLowerCase().replace(/’/g, "'");
        for (const p of r.phrases) {
          const n = words(p.text);
          if (n < 2 || n > 7) err(file, `reading.phrases: „${p.text}” ma ${n} słów (dozwolone 2–7)`);
          if (!low.includes(p.text.toLowerCase().replace(/’/g, "'").trim())) err(file, `reading.phrases: „${p.text}” nie występuje dosłownie w tekście (poza znacznikami {{…}})`);
        }
      }
    }
    if (!isArr(r.glossary) || r.glossary.some((g) => !isStr(g?.term) || !isStr(g?.pl))) err(file, 'reading.glossary: lista {term, pl}');
    else if (!relaxed && !inRange(r.glossary.length, RL.glossary)) err(file, `reading.glossary: ${r.glossary.length} pozycji (dozwolone ${rangeText(RL.glossary)})`);
    if (!isArr(r.questions)) err(file, 'reading.questions: brak');
    else {
      if (!relaxed && r.questions.length !== RL.questions) err(file, `reading.questions: ${r.questions.length}, oczekiwano ${RL.questions}`);
      let mc = 0;
      r.questions.forEach((q, i) => {
        const where = `reading.questions[${i}]`;
        if (q.type === 'mc') {
          mc++;
          checkMc(file, where, q, L.mcOptions);
        } else if (q.type === 'tf') {
          if (!isStr(q.q)) err(file, `${where}: brak q`);
          if (!['true', 'false', 'not_given'].includes(q.answer)) err(file, `${where}: answer musi być "true", "false" albo "not_given"`);
          if (!isStr(q.explanationPl)) err(file, `${where}: brak explanationPl`);
        } else err(file, `${where}: type mc albo tf`);
      });
      if (!relaxed && mc < RL.minMc) err(file, `reading.questions: tylko ${mc} pytań mc (wymagane ≥${RL.minMc})`);
    }
    if (!isArr(r.discussion) || r.discussion.length < 2 || r.discussion.length > 3 || r.discussion.some((d) => !isStr(d))) err(file, 'reading.discussion: 2–3 pytania');
  }

  // grammar
  const g = data.grammar;
  const GL = L.grammar;
  const exTypes = GL.allowTransform ? ['mc', 'gap', 'transform'] : ['mc', 'gap'];
  if (!g) err(file, 'brak grammar');
  else {
    for (const f of ['title', 'titlePl', 'summaryPl']) if (!isStr(g[f])) err(file, `grammar: brak ${f}`);
    if (!isArr(g.sections)) err(file, 'grammar.sections: brak');
    else {
      if (!relaxed && !inRange(g.sections.length, GL.sections)) err(file, `grammar.sections: ${g.sections.length} (dozwolone ${rangeText(GL.sections)})`);
      g.sections.forEach((s, i) => {
        const where = `grammar.sections[${i}]`;
        if (!isStr(s.heading) || !isStr(s.bodyPl)) err(file, `${where}: heading i bodyPl wymagane`);
        checkBadText(file, `${where}.bodyPl`, s.bodyPl);
        if (!isArr(s.examples) || s.examples.some((e) => !isStr(e?.en) || !isStr(e?.pl))) err(file, `${where}.examples: lista {en, pl}`);
        else if (!relaxed && !inRange(s.examples.length, GL.examplesPerSection)) err(file, `${where}.examples: ${s.examples.length} (dozwolone ${rangeText(GL.examplesPerSection)})`);
      });
    }
    if (!isArr(g.pitfallsPl) || g.pitfallsPl.some((p) => !isStr(p?.wrong) || !isStr(p?.right) || !isStr(p?.whyPl))) err(file, 'grammar.pitfallsPl: lista {wrong, right, whyPl}');
    else if (!relaxed && !inRange(g.pitfallsPl.length, GL.pitfalls)) err(file, `grammar.pitfallsPl: ${g.pitfallsPl.length} (dozwolone ${rangeText(GL.pitfalls)})`);
    if (!isArr(g.exercises)) err(file, 'grammar.exercises: brak');
    else {
      if (!relaxed && g.exercises.length !== GL.exercises) err(file, `grammar.exercises: ${g.exercises.length}, oczekiwano ${GL.exercises}`);
      g.exercises.forEach((ex, i) => checkGrammarItem(file, `grammar.exercises[${i}]`, ex, relaxed ? ['mc', 'gap', 'transform'] : exTypes));
      const typed = g.exercises.filter((e) => e.type === 'gap' || e.type === 'transform').length;
      if (!relaxed && typed < GL.minTyped) err(file, `grammar.exercises: tylko ${typed} zadań wpisywanych (wymagane ≥${GL.minTyped})`);
      const prompts = new Set(g.exercises.map((e) => (e.prompt || '') + '|' + (e.gapped || '')));
      if (prompts.size !== g.exercises.length) err(file, 'grammar.exercises: powtórzone zadania');
    }
    if (!isArr(g.testItems)) err(file, 'grammar.testItems: brak');
    else {
      if (!relaxed && g.testItems.length !== GL.testItems) err(file, `grammar.testItems: ${g.testItems.length}, oczekiwano ${GL.testItems}`);
      g.testItems.forEach((ex, i) => checkGrammarItem(file, `grammar.testItems[${i}]`, ex, ['mc', 'gap']));
      const ep = new Set((g.exercises || []).map((e) => e.prompt));
      g.testItems.forEach((t, i) => {
        if (ep.has(t.prompt)) err(file, `grammar.testItems[${i}]: zadanie powtórzone z exercises`);
      });
    }
  }

  // listening
  const l = data.listening;
  const LL = L.listening;
  if (!l) err(file, 'brak listening');
  else {
    if (!isArr(l.dictation) || l.dictation.some((d) => !isStr(d?.text))) err(file, 'listening.dictation: lista {text}');
    else {
      if (!relaxed && l.dictation.length !== LL.dictation) err(file, `listening.dictation: ${l.dictation.length}, oczekiwano ${LL.dictation}`);
      l.dictation.forEach((d, i) => {
        const n = words(d.text);
        if (!relaxed && !inRange(n, LL.dictationWords)) err(file, `listening.dictation[${i}]: ${n} słów (dozwolone ${rangeText(LL.dictationWords)})`);
        if (/\d/.test(d.text)) err(file, `listening.dictation[${i}]: bez cyfr`);
        if (/\{\{/.test(d.text)) err(file, `listening.dictation[${i}]: bez znaczników`);
      });
    }
    const m = l.monologue;
    if (!m) err(file, 'listening.monologue: brak');
    else {
      for (const f of ['title', 'speaker']) if (!isStr(m[f])) err(file, `listening.monologue: brak ${f}`);
      if (!isArr(m.script) || m.script.some((p) => !isStr(p))) err(file, 'listening.monologue.script: lista akapitów');
      else {
        const n = words(m.script.join(' '));
        if (!relaxed && !inRange(m.script.length, LL.monologueParagraphs)) err(file, `listening.monologue.script: ${m.script.length} akapitów (dozwolone ${rangeText(LL.monologueParagraphs)})`);
        if (!relaxed && !inRange(n, LL.monologueWords)) err(file, `listening.monologue.script: ${n} słów (dozwolone ${rangeText(LL.monologueWords)})`);
        if (/\{\{/.test(m.script.join(' '))) err(file, 'listening.monologue.script: bez znaczników');
      }
      if (!isArr(m.questions)) err(file, 'listening.monologue.questions: brak');
      else {
        if (!relaxed && m.questions.length !== LL.questions) err(file, `listening.monologue.questions: ${m.questions.length}, oczekiwano ${LL.questions}`);
        m.questions.forEach((q, i) => {
          if (q.type !== 'mc') err(file, `listening.monologue.questions[${i}]: type mc`);
          else checkMc(file, `listening.monologue.questions[${i}]`, q, L.mcOptions);
        });
      }
    }
  }

  // writing
  const w = data.writing;
  const WL = L.writing;
  if (!w) err(file, 'brak writing');
  else {
    for (const f of ['taskEn', 'taskPl', 'genre', 'modelAnswer']) if (!isStr(w[f])) err(file, `writing: brak ${f}`);
    if (!Number.isInteger(w.minWords) || !Number.isInteger(w.maxWords) || w.minWords >= w.maxWords) err(file, 'writing: minWords < maxWords (liczby całkowite)');
    else if (!relaxed) {
      if (!inRange(w.minWords, WL.minWords)) err(file, `writing.minWords: ${w.minWords} (dozwolone ${rangeText(WL.minWords)})`);
      if (!inRange(w.maxWords, WL.maxWords)) err(file, `writing.maxWords: ${w.maxWords} (dozwolone ${rangeText(WL.maxWords)})`);
    }
    if (!isArr(w.checklistPl) || w.checklistPl.some((c) => !isStr(c))) err(file, 'writing.checklistPl: lista tekstów');
    else if (!relaxed && !inRange(w.checklistPl.length, WL.checklist)) err(file, `writing.checklistPl: ${w.checklistPl.length} (dozwolone ${rangeText(WL.checklist)})`);
    if (!isArr(w.usefulPhrases) || w.usefulPhrases.some((c) => !isStr(c))) err(file, 'writing.usefulPhrases: lista tekstów');
    else if (!relaxed && !inRange(w.usefulPhrases.length, WL.phrases)) err(file, `writing.usefulPhrases: ${w.usefulPhrases.length} (dozwolone ${rangeText(WL.phrases)})`);
    if (isStr(w.modelAnswer)) {
      const n = words(stripMarks(w.modelAnswer));
      if (!relaxed && Number.isInteger(w.minWords) && (n < w.minWords || n > w.maxWords)) err(file, `writing.modelAnswer: ${n} słów (limit ${w.minWords}–${w.maxWords})`);
      checkMarkedIds(file, 'writing.modelAnswer', w.modelAnswer, ids, relaxed ? 1 : WL.minTargets);
    }
  }

  // speaking
  const s = data.speaking;
  const SL = L.speaking;
  if (!s) err(file, 'brak speaking');
  else {
    if (!isArr(s.prompts) || s.prompts.some((p) => !isStr(p?.q) || !isStr(p?.followUp))) err(file, 'speaking.prompts: lista {q, followUp}');
    else if (!relaxed && s.prompts.length !== SL.prompts) err(file, `speaking.prompts: ${s.prompts.length}, oczekiwano ${SL.prompts}`);
    if (!isArr(s.shadowing) || s.shadowing.some((p) => !isStr(p))) err(file, 'speaking.shadowing: lista tekstów');
    else {
      if (!relaxed && s.shadowing.length !== SL.shadowing) err(file, `speaking.shadowing: ${s.shadowing.length}, oczekiwano ${SL.shadowing}`);
      s.shadowing.forEach((t, i) => {
        const n = words(t);
        if (!relaxed && !inRange(n, SL.shadowingWords)) err(file, `speaking.shadowing[${i}]: ${n} słów (dozwolone ${rangeText(SL.shadowingWords)})`);
      });
    }
    const rp = s.roleplay;
    if (!rp) err(file, 'speaking.roleplay: brak');
    else {
      for (const f of ['titlePl', 'scenarioPl', 'yourRole', 'partnerRole', 'opening']) if (!isStr(rp[f])) err(file, `speaking.roleplay: brak ${f}`);
      if (!isArr(rp.goalsPl) || rp.goalsPl.length < 2 || rp.goalsPl.length > 4 || rp.goalsPl.some((x) => !isStr(x))) err(file, 'speaking.roleplay.goalsPl: 2–4 cele');
    }
  }

  // practice
  const p = data.practice;
  const PL = L.practice;
  if (!p) err(file, 'brak practice');
  else {
    if (!isArr(p.gapFill)) err(file, 'practice.gapFill: brak');
    else {
      if (!relaxed && p.gapFill.length !== PL.gapFill) err(file, `practice.gapFill: ${p.gapFill.length}, oczekiwano ${PL.gapFill}`);
      const used = new Set();
      p.gapFill.forEach((x, i) => {
        const where = `practice.gapFill[${i}]`;
        if (!isStr(x.sentence) || gaps(x.sentence) !== 1) err(file, `${where}: sentence z dokładnie jednym ___`);
        if (!ids.has(x.answerId)) err(file, `${where}: answerId ${x.answerId} nie istnieje w słownictwie tygodnia`);
        if (used.has(x.answerId)) err(file, `${where}: hasło ${x.answerId} użyte drugi raz`);
        used.add(x.answerId);
        checkAnswers(file, where, x.answers);
      });
    }
    if (!isArr(p.matching) || p.matching.some((x) => !isStr(x?.left) || !isStr(x?.right))) err(file, 'practice.matching: lista {left, right}');
    else {
      if (!relaxed && p.matching.length !== PL.matching) err(file, `practice.matching: ${p.matching.length}, oczekiwano ${PL.matching}`);
      const Ls = new Set(p.matching.map((x) => x.left.trim().toLowerCase()));
      const Rs = new Set(p.matching.map((x) => x.right.trim().toLowerCase()));
      if (Ls.size !== p.matching.length || Rs.size !== p.matching.length) err(file, 'practice.matching: powtórzone elementy');
    }
    if (!isArr(p.wordFormation)) err(file, 'practice.wordFormation: brak (pusta lista, jeśli kurs jej nie przewiduje)');
    else {
      if (!relaxed && p.wordFormation.length !== PL.wordFormation) err(file, `practice.wordFormation: ${p.wordFormation.length}, oczekiwano ${PL.wordFormation}`);
      p.wordFormation.forEach((x, i) => {
        const where = `practice.wordFormation[${i}]`;
        if (!isStr(x.sentence) || gaps(x.sentence) !== 1) err(file, `${where}: sentence z dokładnie jednym ___`);
        if (!isStr(x.base) || x.base !== x.base.toUpperCase()) err(file, `${where}: base wielkimi literami`);
        if (checkAnswers(file, where, x.answers) && isStr(x.base) && x.answers.some((a) => a.trim().toLowerCase() === x.base.toLowerCase())) err(file, `${where}: odpowiedź identyczna z base`);
      });
    }
  }
}

function validateProgram(file, program) {
  if (!program) return;
  const n = program.weeks ?? 24;
  if (!isArr(program.weekList) || program.weekList.length !== n) return err(file, `weekList: ${program.weekList?.length ?? 0} tygodni, oczekiwano ${n}`);
  if (!isArr(program.modules) || program.modules.length === 0) err(file, 'brak modules');
  const lim = mergeLimits(program.content);
  program.weekList.forEach((w, i) => {
    const where = `weekList[${i}]`;
    if (w.week !== i + 1) err(file, `${where}: week = ${w.week}, oczekiwano ${i + 1}`);
    for (const f of ['themeEn', 'themePl', 'focus', 'grammarEn', 'grammarPl', 'grammarScope', 'writingGenre']) if (!isStr(w[f])) err(file, `${where}: brak ${f}`);
    if (!w.mix || Object.values(w.mix).reduce((a, b) => a + b, 0) !== lim.vocabPerWeek) err(file, `${where}: mix musi sumować się do ${lim.vocabPerWeek}`);
    else if (Object.keys(w.mix).some((k) => !lim.levels.includes(k))) err(file, `${where}: mix zawiera poziom spoza ${lim.levels.join(', ')}`);
    const mod = (program.modules || []).find((m) => isArr(m.weeks) && m.weeks.includes(w.week));
    if (!mod) err(file, `${where}: tydzień nie należy do żadnego modułu`);
    else if (w.module !== mod.n) err(file, `${where}: module = ${w.module}, a tydzień jest w module ${mod.n}`);
  });
  for (const m of program.modules || []) if (!isStr(m.titlePl) || !isStr(m.titleEn)) err(file, `modules[${m.n}]: brak titlePl/titleEn`);
}

function validateDir(dir, program, label) {
  prefix = label ? `[${label}] ` : '';
  if (!existsSync(dir)) {
    err('', `brak katalogu ${dir}`);
    return;
  }
  const L = mergeLimits(program?.content);
  const total = program?.weeks ?? 24;
  const present = new Set(
    readdirSync(dir)
      .map((f) => /^w(\d{2})-(vocab|lessons)\.json$/.exec(f))
      .filter(Boolean)
      .map((m) => Number(m[1])),
  );
  const weeks = onlyWeek ? [onlyWeek] : [...present].sort((a, b) => a - b);
  const allTerms = new Map();
  for (const wk of [...present].sort((a, b) => a - b)) {
    if (weeks.includes(wk)) continue;
    const v = readJson(dir, `w${pad(wk)}-vocab.json`);
    if (v && isArr(v.items)) for (const it of v.items) if (isStr(it?.term)) allTerms.set(normTerm(it.term), it.id);
  }
  for (const wk of weeks) {
    const vf = `w${pad(wk)}-vocab.json`;
    const lf = `w${pad(wk)}-lessons.json`;
    const meta = program?.weekList?.find((x) => x.week === wk);
    const v = readJson(dir, vf);
    let ids = new Set();
    if (v === null) err(vf, 'brak pliku');
    else if (v) {
      const res = validateVocab(wk, v, L, meta);
      ids = res.ids;
      for (const t of res.terms) {
        if (allTerms.has(t.norm) && allTerms.get(t.norm) !== t.id) err(vf, `hasło „${t.term}” (${t.id}) powtarza się z ${allTerms.get(t.norm)}`);
        else allTerms.set(t.norm, t.id);
      }
      checked++;
    }
    const l = readJson(dir, lf);
    if (l === null) {
      if (!(onlyWeek && vocabOnly)) err(lf, 'brak pliku');
    } else if (l) {
      validateLessons(wk, l, ids, L);
      checked++;
    }
  }
  if (requireAll) for (let wk = 1; wk <= total; wk++) if (!present.has(wk)) err(`w${pad(wk)}`, 'brak tygodnia');
}

// --- main ---
const loadProgram = (path) => {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    err(path, `niepoprawny JSON: ${e.message}`);
    return null;
  }
};

if (opt('--dir')) {
  const dir = resolve(opt('--dir'));
  const programPath = opt('--program') ? resolve(opt('--program')) : join(dir, '..', 'program.json');
  validateDir(dir, loadProgram(programPath), '');
} else {
  const coursesDir = join(root, 'data', 'courses');
  const courseIds = opt('--course') ? [opt('--course')] : existsSync(coursesDir) ? readdirSync(coursesDir).sort() : [];
  if (courseIds.length === 0) {
    console.log('Brak kursów w data/courses');
    process.exit(1);
  }
  for (const id of courseIds) {
    const program = loadProgram(join(coursesDir, id, 'program.json'));
    prefix = `[${id}] `;
    if (!program) {
      err('program.json', 'brak pliku');
      continue;
    }
    if (!onlyWeek) validateProgram('program.json', program);
    const dir = join(coursesDir, id, 'weeks');
    const hasFiles = existsSync(dir) && readdirSync(dir).some((f) => /^w\d{2}-/.test(f));
    if (hasFiles || onlyWeek || requireAll) validateDir(dir, program, id);
  }
}

console.log(`\nSprawdzono plików: ${checked}. Błędy: ${errors}. Uwagi: ${warnings}.`);
process.exit(errors ? 1 : 0);
