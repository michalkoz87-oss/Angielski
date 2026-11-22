// reading.js — the text of the week with tappable target words, then comprehension questions.
import * as ui from '../../core/ui.js';
import * as model from '../../core/model.js';
import { stripMarks } from '../../core/content.js';
import { runQuestions, scoreSummary } from './exercise-ui.js';

const { h } = ui;

export function mount(root, ctx) {
  const r = ctx.lessons.reading;
  const key = `w${String(ctx.week).padStart(2, '0')}-reading`;
  const text = () => h('article', { class: 'prose prose--en prose--lg read__text' },
    h('h2', { class: 'read__title en' }, r.title),
    r.paragraphs.map((p) => ui.markedText(p, { tag: 'p' })));
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
    h('p', { class: 'muted small' }, 'Przeczytaj tekst. Zaznaczone słowa to słownictwo tego tygodnia: dotknij, aby zobaczyć znaczenie.'),
    ui.speakButton(r.paragraphs.map(stripMarks), { long: true, showLabel: true, label: 'Posłuchaj tekstu' }),
    text(), glossary(),
    ui.actionBar(ui.button({ label: 'Przejdź do pytań', kind: 'primary', size: 'lg', id: 'read-questions', onClick: questions }))));
  return { destroy() {} };
}
