// test.js — the weekly test (module test in the last week of a module): no feedback until the end.
import * as ui from '../../core/ui.js';
import * as model from '../../core/model.js';
import * as content from '../../core/content.js';
import * as srs from '../../core/srs.js';
import { buildTest, seededRng, answerText } from '../../core/exercises.js';
import { moduleWeeks } from '../../core/schedule.js';
import { todayKey, toDayNumber, nowTs } from '../../core/platform.js';
import { runQuestions } from './exercise-ui.js';

const { h } = ui;
const PASS = 70;

export function mount(root, ctx) {
  let dead = false;
  const key = `w${String(ctx.week).padStart(2, '0')}`;
  ui.mount(root, ui.loading('Przygotowuję test…'));
  (async () => {
    const weeks = ctx.moduleTest ? moduleWeeks(ctx.program, ctx.week) : [ctx.week];
    const vocabByWeek = {};
    const lessonsByWeek = {};
    for (const w of weeks) {
      try {
        [vocabByWeek[w], lessonsByWeek[w]] = await Promise.all([content.loadVocab(w), content.loadLessons(w)]);
      } catch { /* a missing week is left out of the test */ }
    }
    if (dead) return;
    const questions = buildTest({ week: ctx.week, program: ctx.program, vocabByWeek, lessonsByWeek, rng: seededRng(`test-${ctx.sid}-${todayKey()}`) });
    const start = () => {
      const box = h('div');
      ui.mount(root, box);
      runQuestions(box, questions, { feedback: false, seed: `test-${ctx.sid}`, onFinish: ({ score, total, results }) => {
        const pct = total ? Math.round((score / total) * 100) : 0;
        model.saveTest(key, { score, total, module: !!ctx.moduleTest });
        const wrong = questions.map((q, i) => ({ q, r: results[i] })).filter((x) => !x.r?.ok);
        const wrongIds = [...new Set(wrong.map((x) => x.q.itemId).filter(Boolean))];
        const again = ui.button({ label: `Dodaj błędne słowa do jutrzejszych powtórek (${wrongIds.length})`, id: 'test-again', onClick: () => {
          const today = toDayNumber(todayKey());
          for (const id of wrongIds) if (model.cardState(id)) model.setCardState(id, srs.grade(model.cardState(id), 'again', today, nowTs(), id));
          again.disabled = true;
          ui.toast('Dodano do powtórek', 'ok');
        } });
        ui.mount(root, h('div', { class: 'stack' },
          h('div', { class: 'done' },
            h('h2', { class: 'done__title' }, pct >= PASS ? 'Test zaliczony' : 'Test do poprawy'),
            h('p', { class: 'done__score num' }, `${score} / ${total}`, h('span', { class: 'muted' }, ` · ${pct}% (próg ${PASS}%)`)),
            pct < PASS && h('p', { class: 'muted' }, 'To informacja, co wymaga powtórki, a nie ocena. Kurs idzie dalej, a błędne słowa wrócą w powtórkach.')),
          wrong.length > 0 && ui.section({ title: 'Do przejrzenia' },
            h('ul', { class: 'test__review' }, wrong.map(({ q, r }) => h('li', null,
              h('p', { class: 'en', lang: 'en' }, q.q ?? q.gapped ?? q.sentence ?? q.prompt ?? ''),
              h('p', { class: 'small' }, h('span', { class: 'muted' }, 'Poprawnie: '), h('strong', { class: 'en', lang: 'en' }, answerText(q)),
                r?.response !== undefined && r.response !== '' && typeof r.response === 'string' ? h('span', { class: 'muted' }, ` · Twoja odpowiedź: ${r.response}`) : null),
              q.explanationPl && h('p', { class: 'muted small' }, ui.md(q.explanationPl))))),
            wrongIds.length > 0 && again),
          ui.actionBar(ui.button({ label: 'Dalej', kind: 'primary', size: 'lg', id: 'step-done', onClick: () => ctx.onDone({ score, total }) }))));
        window.scrollTo(0, 0);
      } });
    };
    ui.mount(root, h('div', { class: 'done' },
      h('h2', { class: 'done__title' }, ctx.moduleTest ? 'Test modułu' : 'Test tygodnia'),
      h('p', { class: 'muted' }, `${ui.count(questions.length, 'pytanie', 'pytania', 'pytań')}: słownictwo i gramatyka${ctx.moduleTest ? ' z czterech tygodni modułu' : ' z tego tygodnia'}. Odpowiedzi pojawią się dopiero po zakończeniu.`),
      ui.actionBar(ui.button({ label: 'Zaczynam test', kind: 'primary', size: 'lg', id: 'test-start', onClick: start }))));
  })();
  return { destroy() { dead = true; } };
}
