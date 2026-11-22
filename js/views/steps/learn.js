// learn.js — introduce the new words of the day, then a quick check.
import * as ui from '../../core/ui.js';
import * as model from '../../core/model.js';
import * as srs from '../../core/srs.js';
import { vocabQuestion, shuffle, seededRng } from '../../core/exercises.js';
import { todayKey, toDayNumber, nowTs } from '../../core/platform.js';
import { runQuestions } from './exercise-ui.js';
import { setSize } from '../common.js';

const { h } = ui;

export function mount(root, ctx) {
  const size = setSize(ctx.program);
  const items = ctx.vocab.slice((ctx.set - 1) * size, ctx.set * size);
  let i = 0;

  const finish = () => {
    const today = toDayNumber(todayKey());
    let fresh = 0;
    for (const it of items) {
      if (model.cardState(it.id)) continue;
      model.setCardState(it.id, srs.initialState(today, nowTs()));
      fresh++;
    }
    if (fresh) model.logActivity({ newCards: fresh });
    ctx.onDone({ newCards: fresh });
  };

  const check = () => {
    const rng = seededRng(`learn-${ctx.sid}`);
    const questions = shuffle(items, rng).map((it, n) => vocabQuestion(it, ctx.vocab, n % 2 ? 'choose-term' : 'choose-pl', rng));
    runQuestions(root, questions, { seed: `learn-${ctx.sid}`, repeatWrong: true, label: 'Szybkie sprawdzenie', onFinish: finish });
  };

  const show = () => {
    if (i >= items.length) return check();
    const it = items[i];
    const next = ui.button({ label: i === items.length - 1 ? 'Sprawdź, co zostało w głowie' : 'Następne słowo', kind: 'primary', size: 'lg', block: true, id: 'learn-next', onClick: () => { i++; show(); } });
    ui.mount(root, h('div', { class: 'q-run' },
      h('div', { class: 'q-run__head' }, h('span', { class: 'label' }, `Nowe słowo ${i + 1} z ${items.length}`), ui.progressBar((i / items.length) * 100, { thin: true })),
      ui.card({ flash: true }, ui.dictEntry(it, { size: 'lg', extras: true, headingLevel: 2 })),
      h('p', { class: 'muted small' }, 'Przeczytaj hasło i zdanie na głos. Głośne powtórzenie pomaga zapamiętać brzmienie i pisownię.'),
      ui.actionBar(i > 0 && ui.button({ label: 'Wstecz', kind: 'ghost', onClick: () => { i--; show(); } }), next)));
    window.scrollTo(0, 0);
    next.focus({ preventScroll: true });
  };

  if (!items.length) ui.mount(root, ui.emptyState({ title: 'Brak nowych słów w tym zestawie', action: ui.button({ label: 'Dalej', kind: 'primary', onClick: () => ctx.onDone({}) }) }));
  else show();
  return { destroy() {} };
}
