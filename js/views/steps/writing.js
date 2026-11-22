// writing.js — a short writing task with autosave, a model answer and (for adult learners inside
// Claude) feedback from Claude.
import * as ui from '../../core/ui.js';
import * as model from '../../core/model.js';
import { ai } from '../../core/ai.js';
import { stripMarks } from '../../core/content.js';

const { h } = ui;
const countWords = (s) => (s.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

function feedbackView(f) {
  return h('div', { class: 'stack fb' },
    h('h3', null, 'Informacja zwrotna'),
    f.cefr && h('p', null, ui.badge(`Poziom tekstu: ${f.cefr}`, 'accent')),
    f.summaryPl && h('p', null, f.summaryPl),
    f.mistakes.length > 0 && h('div', null, h('p', { class: 'label' }, 'Do poprawy'),
      h('ul', { class: 'fb__list' }, f.mistakes.map((m) => h('li', null,
        h('span', { class: 'gram__wrong en', lang: 'en' }, m.original), h('span', { class: 'gram__right en', lang: 'en' }, m.correction), h('span', { class: 'muted small' }, m.whyPl))))),
    f.corrected && ui.disclosure({ summary: 'Tekst po poprawkach' }, h('p', { class: 'prose prose--en', lang: 'en' }, f.corrected)),
    f.strengthsPl.length > 0 && h('div', null, h('p', { class: 'label' }, 'Mocne strony'), h('ul', null, f.strengthsPl.map((s) => h('li', null, s)))),
    f.usedTargets.length > 0 && h('p', { class: 'small' }, h('span', { class: 'muted' }, 'Użyte słowa tygodnia: '), h('span', { class: 'en', lang: 'en' }, f.usedTargets.join(', '))),
    f.suggestionsPl.length > 0 && h('div', null, h('p', { class: 'label' }, 'Na następny raz'), h('ul', null, f.suggestionsPl.map((s) => h('li', null, s)))));
}

export function mount(root, ctx) {
  const w = ctx.lessons.writing;
  const saved = model.journalGet(ctx.week, 'writing') ?? {};
  let feedback = saved.feedback ?? null;
  let saveTimer = null;
  let controller = null;
  const canAi = () => ai.available() && model.isAdult();

  const area = ui.textArea({ id: 'writing-text', rows: 9, english: true, value: saved.text ?? '', placeholder: 'Write your text here…' });
  const counter = h('span', { class: 'num small' });
  const savedNote = h('span', { class: 'muted small', 'aria-live': 'polite' });
  const fbBox = h('div');
  const note = h('p', { class: 'field__error', role: 'alert', hidden: true });
  const modelBox = h('div');
  const save = () => { model.journalSet(ctx.week, 'writing', { text: area.value, feedback }); savedNote.textContent = 'Zapisano'; };
  const refresh = () => {
    const n = countWords(area.value);
    counter.textContent = `${n} / ${w.minWords}–${w.maxWords} słów`;
    counter.classList.toggle('is-ok', n >= w.minWords && n <= w.maxWords);
  };
  area.addEventListener('input', () => { refresh(); savedNote.textContent = ''; clearTimeout(saveTimer); saveTimer = setTimeout(save, 1200); });

  const showModel = () => ui.mount(modelBox, ui.disclosure({ summary: 'Tekst wzorcowy', open: true }, h('div', { class: 'prose prose--en' }, w.modelAnswer.split(/\n\s*\n/).map((para) => ui.markedText(para, { tag: 'p' })))));
  const checkBtn = ui.button({ label: 'Sprawdź z Claude', icon: 'sparkle', id: 'writing-check', onClick: async () => {
    if (countWords(area.value) < 10) { note.textContent = 'Napisz najpierw przynajmniej kilka zdań.'; note.hidden = false; return; }
    note.hidden = true;
    save();
    controller = new AbortController();
    ui.setLoading(checkBtn, true, 'Claude czyta tekst…');
    try {
      feedback = await ai.checkWriting({ taskEn: w.taskEn, text: area.value, targets: ctx.vocab.map((it) => ({ term: it.term })), grammarTitle: ctx.lessons.grammar?.title, level: ctx.program.levelFrom }, { signal: controller.signal });
      save();
      ui.mount(fbBox, feedbackView(feedback));
    } catch (err) {
      if (err?.code !== 'cancelled') { note.textContent = err?.messagePl ?? 'Nie udało się sprawdzić tekstu.'; note.hidden = false; }
      if (!ai.available()) checkBtn.hidden = true;
    } finally {
      ui.setLoading(checkBtn, false);
    }
  } });
  checkBtn.hidden = !canAi();

  const doneBtn = ui.button({ label: 'Gotowe', kind: 'primary', size: 'lg', id: 'step-done', onClick: async () => {
    const n = countWords(area.value);
    if (n < w.minWords && !(await ui.confirmDialog({ title: 'Tekst jest krótszy niż w poleceniu', body: `Polecenie zakłada co najmniej ${w.minWords} słów, a tekst ma ${n}. Zakończyć mimo to?`, confirmLabel: 'Zakończ', cancelLabel: 'Piszę dalej' }))) return;
    save();
    ctx.onDone({});
  } });

  ui.mount(root, h('div', { class: 'stack' },
    h('h2', { class: 'q-run__title' }, 'Pisanie'),
    h('p', { class: 'en', lang: 'en' }, w.taskEn), h('p', { class: 'muted' }, w.taskPl),
    ui.disclosure({ summary: 'Wskazówki i przydatne zwroty' },
      h('ul', null, w.checklistPl.map((c) => h('li', null, c))),
      h('ul', { class: 'en', lang: 'en' }, w.usefulPhrases.map((c) => h('li', null, c)))),
    ui.disclosure({ summary: 'Słowa tygodnia do wykorzystania' }, h('div', { class: 'cluster' }, ctx.vocab.map((it) => ui.chip({ label: it.term, en: true })))),
    area, h('div', { class: 'spread' }, counter, savedNote),
    note,
    h('div', { class: 'cluster' }, checkBtn, ui.button({ label: 'Pokaż tekst wzorcowy', kind: 'ghost', id: 'writing-model', onClick: showModel })),
    fbBox, modelBox,
    !canAi() && h('p', { class: 'muted small' }, 'Po napisaniu porównaj swój tekst z wzorcowym: struktura, słownictwo tygodnia, czasy.'),
    ui.actionBar(doneBtn)));
  refresh();
  if (feedback) ui.mount(fbBox, feedbackView(feedback));
  return { destroy() { clearTimeout(saveTimer); controller?.abort(); if (area.value !== (saved.text ?? '')) save(); } };
}
