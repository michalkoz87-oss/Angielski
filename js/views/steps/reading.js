// reading.js — the text of the week with tappable target words, then comprehension questions.
import * as ui from '../../core/ui.js';
import * as model from '../../core/model.js';
import { stripMarks, parseMarked } from '../../core/content.js';
import { runQuestions, scoreSummary } from './exercise-ui.js';

const { h } = ui;

const WORD = /\p{L}+(?:[-'’]\p{L}+)*/gu;

// A paragraph in which target words keep their highlighted gloss and every other word can be
// tapped for its Polish meaning (from reading.wordGloss).
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Append `text` to `parent` with every word wrapped in a tappable span.
function appendWords(parent, text) {
  let last = 0;
  for (const m of text.matchAll(WORD)) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    parent.appendChild(h('span', { class: 'read__w', dataset: { w: m[0].toLowerCase().replace(/’/g, "'") } }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

// Non-overlapping occurrences of the listed expressions in a piece of text, longest first.
function phraseRanges(text, phrases) {
  const taken = [];
  const sorted = (phrases ?? []).map((p, index) => ({ ...p, index })).sort((a, b) => b.text.length - a.text.length);
  for (const p of sorted) {
    const re = new RegExp(`(?<!\\p{L})${escapeRe(p.text.trim()).replace(/['’]/g, "['’]").replace(/\s+/g, '\\s+')}(?!\\p{L})`, 'giu');
    for (const m of text.matchAll(re)) {
      const from = m.index;
      const to = m.index + m[0].length;
      if (!taken.some((t) => from < t.to && to > t.from)) taken.push({ from, to, index: p.index });
    }
  }
  return taken.sort((a, b) => a.from - b.from);
}

// A paragraph in which target words keep their highlighted gloss, every other word can be tapped
// for its Polish meaning (reading.wordGloss) and listed expressions are grouped (reading.phrases).
function paragraph(text, gloss, phrases) {
  if (!gloss) return ui.markedText(text, { tag: 'p' });
  const p = h('p');
  for (const seg of parseMarked(text)) {
    if (seg.mark) {
      p.appendChild(ui.markedText(`{{${seg.text}${seg.id ? `|${seg.id}` : ''}}}`, { tag: 'span' }));
      continue;
    }
    let last = 0;
    for (const r of phraseRanges(seg.text, phrases)) {
      appendWords(p, seg.text.slice(last, r.from));
      const group = h('span', { class: 'read__ph', dataset: { ph: r.index } });
      appendWords(group, seg.text.slice(r.from, r.to));
      p.appendChild(group);
      last = r.to;
    }
    appendWords(p, seg.text.slice(last));
  }
  return p;
}

export function mount(root, ctx) {
  const r = ctx.lessons.reading;
  const key = `w${String(ctx.week).padStart(2, '0')}-reading`;
  const text = () => {
    const article = h('article', { class: 'prose prose--en prose--lg read__text' },
      h('h2', { class: 'read__title en' }, r.title),
      r.paragraphs.map((p) => paragraph(p, r.wordGloss, r.phrases)));
    article.addEventListener('click', (e) => {
      const el = e.target.closest?.('.read__w');
      if (!el) return;
      const word = el.textContent;
      const group = el.closest('.read__ph');
      const phrase = group ? r.phrases?.[Number(group.dataset.ph)] : null;
      const lit = group ?? el;
      lit.classList.add('is-open');
      ui.sheet({ anchor: el, label: `Tłumaczenie: ${word}`, onClose: () => lit.classList.remove('is-open'),
        content: h('div', { class: 'read__pop' },
          h('p', { class: 'read__pop-en' }, h('span', { class: 'en', lang: 'en' }, word), ui.speakButton(word, { size: 'sm', label: `Posłuchaj: ${word}` })),
          h('p', { class: 'read__pop-pl' }, r.wordGloss?.[el.dataset.w] ?? 'Brak tłumaczenia tego słowa.'),
          phrase && h('div', { class: 'read__pop-phrase' },
            h('p', { class: 'label' }, 'Całe wyrażenie'),
            h('p', { class: 'read__pop-en' }, h('span', { class: 'en', lang: 'en' }, group.textContent), ui.speakButton(group.textContent, { size: 'sm', label: 'Posłuchaj wyrażenia' })),
            h('p', { class: 'read__pop-pl' }, phrase.pl))) });
    });
    return article;
  };
  const glossary = () => ui.disclosure({ summary: 'Słowniczek do tekstu' },
    h('dl', { class: 'read__gloss' }, r.glossary.flatMap((g) => [h('dt', { lang: 'en', class: 'en' }, g.term), h('dd', null, g.pl)])));

  const questions = () => {
    const box = h('div');
    ui.mount(root, h('div', { class: 'stack' }, ui.disclosure({ summary: 'Pokaż tekst' }, text()), box));
    runQuestions(box, r.questions, { seed: key, onFinish: ({ score, total }) => {
      model.saveResult(key, { score, total });
      ui.mount(root, scoreSummary({ score, total, title: 'Czytanie ukończone',
        body: 'Na koniec pytania do przemyślenia. Odpowiedz na głos po angielsku, choćby dwoma zdaniami.',
        actions: [ui.button({ label: 'Dalej', kind: 'primary', size: 'lg', id: 'step-done', onClick: () => ctx.onDone({ score, total }) })] }),
      h('ul', { class: 'prose prose--en' }, r.discussion.map((d) => h('li', { lang: 'en' }, d))));
    } });
  };

  ui.mount(root, h('div', { class: 'stack' },
    ctx.lessons.intro && ctx.day === 1 && ui.banner({ kind: 'info', title: `Tydzień ${ctx.week}: ${ctx.weekMeta?.themePl ?? ''}`, body: ctx.lessons.intro, live: false }),
    h('p', { class: 'muted small' }, r.wordGloss ? 'Przeczytaj tekst. Dotknij dowolnego słowa lub wyrażenia, aby zobaczyć tłumaczenie. Wyrażenia są podkreślone kropkami, a zaznaczone kolorem słowa to słownictwo tego tygodnia.' : 'Przeczytaj tekst. Zaznaczone słowa to słownictwo tego tygodnia: dotknij, aby zobaczyć znaczenie.'),
    ui.speakButton(r.paragraphs.map(stripMarks), { long: true, showLabel: true, label: 'Posłuchaj tekstu' }),
    text(), glossary(),
    ui.actionBar(ui.button({ label: 'Przejdź do pytań', kind: 'primary', size: 'lg', id: 'read-questions', onClick: questions }))));
  return { destroy() {} };
}
