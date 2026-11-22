// practice.js — vocabulary in use: gap-fill with a word bank, matching, word formation.
import * as ui from '../../core/ui.js';
import * as model from '../../core/model.js';
import { shuffle, seededRng } from '../../core/exercises.js';
import { runQuestions, scoreSummary } from './exercise-ui.js';

const { h } = ui;

function matching(root, pairs, seed, onFinish) {
  const rng = seededRng(seed);
  const lefts = shuffle(pairs.map((p, i) => ({ i, text: p.left })), rng);
  const rights = shuffle(pairs.map((p, i) => ({ i, text: p.right })), rng);
  let picked = null;
  let solved = 0;
  let mistakes = 0;
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' }, 'Wybierz element z lewej, potem pasujący z prawej.');
  const mk = (side, o) => {
    const btn = h('button', { class: 'match__item en', type: 'button', lang: 'en', onClick: () => {
      if (btn.disabled) return;
      if (side === 'L') {
        picked?.classList.remove('is-picked');
        picked = btn;
        btn.classList.add('is-picked');
        return;
      }
      if (!picked) { status.textContent = 'Najpierw wybierz element z lewej kolumny.'; return; }
      if (picked.pair === o.i) {
        for (const b of [picked, btn]) { b.disabled = true; b.classList.remove('is-picked'); b.classList.add('is-right'); }
        picked = null;
        solved++;
        status.textContent = `Dobrze. Zostało: ${pairs.length - solved}.`;
        if (solved === pairs.length) onFinish({ score: Math.max(0, pairs.length - mistakes), total: pairs.length });
      } else {
        mistakes++;
        status.textContent = 'To nie ta para. Spróbuj jeszcze raz.';
        btn.classList.add('is-wrong');
        setTimeout(() => btn.classList.remove('is-wrong'), 500);
      }
    } }, o.text);
    btn.pair = o.i;
    return btn;
  };
  ui.mount(root, h('div', { class: 'stack' }, h('h2', { class: 'q-run__title' }, 'Połącz w pary'), status,
    h('div', { class: 'match' }, h('div', { class: 'match__col' }, lefts.map((o) => mk('L', o))), h('div', { class: 'match__col' }, rights.map((o) => mk('R', o))))));
}

export function mount(root, ctx) {
  const p = ctx.lessons.practice;
  const key = `w${String(ctx.week).padStart(2, '0')}-practice`;
  let score = 0;
  let total = 0;
  const add = (r) => { score += r.score; total += r.total; };
  const end = () => {
    model.saveResult(key, { score, total });
    ui.mount(root, scoreSummary({ score, total, title: 'Słowa w użyciu: ukończone',
      actions: [ui.button({ label: 'Dalej', kind: 'primary', size: 'lg', id: 'step-done', onClick: () => ctx.onDone({ score, total }) })] }));
  };
  const formation = () => {
    if (!p.wordFormation?.length) return end();
    const box = h('div');
    ui.mount(root, h('div', { class: 'stack' }, h('h2', { class: 'q-run__title' }, 'Słowotwórstwo'), box));
    runQuestions(box, p.wordFormation.map((x) => ({ ...x, type: 'gap' })), { seed: key + 'wf', label: 'Zdanie', onFinish: (r) => { add(r); end(); } });
  };
  const match = () => matching(root, p.matching, key + 'm', (r) => { add(r); formation(); });
  const gapFill = () => {
    const used = new Set(p.gapFill.map((x) => x.answerId));
    const extra = ctx.vocab.filter((it) => !used.has(it.id)).slice(0, 2).map((it) => it.term);
    const bank = shuffle([...p.gapFill.map((x) => x.answers[0]), ...extra], seededRng(key));
    const box = h('div');
    ui.mount(root, h('div', { class: 'stack' }, h('h2', { class: 'q-run__title' }, 'Uzupełnij zdania'),
      h('p', { class: 'muted small' }, 'Wpisz pasujące wyrażenie z ramki. Dwa są dodatkowe.'),
      h('div', { class: 'cluster bank' }, bank.map((w) => ui.chip({ label: w, en: true }))), box));
    runQuestions(box, p.gapFill.map((x) => ({ ...x, type: 'gap' })), { seed: key + 'gf', label: 'Zdanie', onFinish: (r) => { add(r); match(); } });
  };
  gapFill();
  return { destroy() {} };
}
