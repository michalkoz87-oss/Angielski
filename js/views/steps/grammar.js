// grammar.js — the explanation of the week's grammar, then exercises (wrong ones come back once).
import * as ui from '../../core/ui.js';
import * as model from '../../core/model.js';
import { runQuestions, scoreSummary } from './exercise-ui.js';

const { h } = ui;

export function explanation(g) {
  return h('div', { class: 'stack gram' },
    h('h2', { class: 'gram__title' }, g.titlePl), h('p', { class: 'en muted' }, g.title), h('p', null, ui.md(g.summaryPl)),
    g.sections.map((s) => h('section', { class: 'gram__section' },
      h('h3', null, s.heading), h('p', null, ui.md(s.bodyPl)),
      h('ul', { class: 'gram__examples' }, s.examples.map((e) => h('li', null, h('span', { class: 'en', lang: 'en' }, e.en), h('span', { class: 'muted small' }, e.pl)))))),
    h('section', { class: 'gram__section' }, h('h3', null, 'Typowe błędy'),
      h('ul', { class: 'gram__pitfalls' }, g.pitfallsPl.map((p) => h('li', null,
        h('span', { class: 'gram__wrong en', lang: 'en' }, p.wrong), h('span', { class: 'gram__right en', lang: 'en' }, p.right), h('span', { class: 'muted small' }, ui.md(p.whyPl)))))));
}

export function mount(root, ctx) {
  const g = ctx.lessons.grammar;
  const key = `w${String(ctx.week).padStart(2, '0')}-grammar`;
  const exercises = () => {
    const box = h('div');
    ui.mount(root, h('div', { class: 'stack' }, ui.disclosure({ summary: 'Pokaż wyjaśnienie' }, explanation(g)), box));
    runQuestions(box, g.exercises, { seed: key, repeatWrong: true, label: 'Zadanie', onFinish: ({ score, total }) => {
      model.saveResult(key, { score, total });
      ui.mount(root, scoreSummary({ score, total, title: 'Gramatyka ukończona', body: score < total ? 'Zadania z błędem wróciły na koniec, żeby je utrwalić.' : 'Wszystko dobrze za pierwszym razem.',
        actions: [ui.button({ label: 'Dalej', kind: 'primary', size: 'lg', id: 'step-done', onClick: () => ctx.onDone({ score, total }) })] }));
    } });
  };
  ui.mount(root, h('div', { class: 'stack' }, explanation(g),
    ui.actionBar(ui.button({ label: 'Przejdź do zadań', kind: 'primary', size: 'lg', id: 'gram-exercises', onClick: exercises }))));
  return { destroy() {} };
}
