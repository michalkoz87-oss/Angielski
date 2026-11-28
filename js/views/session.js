// session.js — the activity host (#nauka): runs the steps of one session in order.
// Step modules export mount(root, ctx) → {destroy()}; they call ctx.onDone(result) or ctx.onSkip().
import * as ui from '../core/ui.js';
import * as model from '../core/model.js';
import * as schedule from '../core/schedule.js';
import * as content from '../core/content.js';
import { audio } from '../core/audio.js';
import { nowTs } from '../core/platform.js';
import { weekMeta } from './common.js';
import * as review from './steps/review.js';
import * as learn from './steps/learn.js';
import * as reading from './steps/reading.js';
import * as grammar from './steps/grammar.js';
import * as practice from './steps/practice.js';
import * as test from './steps/test.js';
import * as input from './steps/input.js';
import * as listening from './steps/listening.js';
import * as writing from './steps/writing.js';
import * as speaking from './steps/speaking.js';

const { h } = ui;
const STEPS = { review, learn, reading, grammar, practice, test, input, listening, writing, speaking };

export async function render(root, ctx) {
  const { sid, mode } = ctx.params;
  let current = null;
  let closed = false;
  const stopStep = () => {
    try { current?.destroy?.(); } catch (err) { console.error(err); }
    current = null;
    audio.stop();
  };
  const leave = () => { closed = true; stopStep(); ctx.navigate('dzis'); };
  const bar = ui.activityBar({ title: 'Sesja', onClose: async () => {
    if (await ui.confirmDialog({ title: 'Przerwać sesję?', body: 'Ukończone kroki są zapisane. Do przerwanego kroku można wrócić z ekranu „Dziś”.', confirmLabel: 'Przerwij', cancelLabel: 'Uczę się dalej' })) leave();
  } });
  const layout = ui.activityLayout({ bar });
  ui.mount(root, layout.el);
  ui.mount(layout.body, ui.loading());

  const fail = (title, body) => ui.mount(layout.body, ui.emptyState({ icon: 'alert', title, body, action: ui.button({ label: 'Wróć do „Dziś”', kind: 'primary', onClick: leave }) }));

  if (mode === 'pack') {
    const packId = ctx.params.pack;
    (async () => {
      let pack, meta;
      try {
        [pack, meta] = await Promise.all([content.loadPack(packId), content.loadPackCatalog().then((c) => c.find((p) => p.id === packId))]);
      } catch {
        return fail('Nie udało się wczytać pakietu', 'Sprawdź połączenie i spróbuj ponownie.');
      }
      if (closed) return;
      const settings = model.packSettings()[packId] ?? {};
      const left = Math.max(0, (settings.newPerDay ?? 5) - model.packIntroducedToday(packId));
      const items = pack.items.filter((it) => !model.cardState(it.id)).slice(0, left);
      bar.update({ title: meta ? `${meta.titlePl}: nowe słowa` : 'Nowe słowa', steps: [] });
      if (!items.length) {
        return ui.mount(layout.body, ui.emptyState({ icon: 'check', title: 'Na dziś to wszystko', body: 'Dzisiejsza porcja nowych słów z tego pakietu jest już za Tobą. Słowa wrócą w powtórkach.',
          action: ui.button({ label: 'Wróć do „Dziś”', kind: 'primary', onClick: leave }) }));
      }
      current = learn.mount(layout.body, { sid: `pack-${packId}`, items, pool: pack.items, onSkip: leave,
        onDone: (result) => {
          stopStep();
          const n = result?.newCards ?? 0;
          ui.mount(layout.body, h('div', { class: 'done' },
            h('h2', { class: 'done__title' }, 'Nowe słowa poznane'),
            h('p', { class: 'muted' }, `${ui.count(n, 'słowo trafiło', 'słowa trafiły', 'słów trafiło')} do powtórek. Wrócą jutro razem z resztą kart.`),
            ui.actionBar(ui.button({ label: 'Wróć do „Dziś”', kind: 'primary', size: 'lg', id: 'session-finish', onClick: leave }))));
        } });
    })();
    return () => { closed = true; stopStep(); };
  }

  if (mode === 'review') {
    bar.update({ title: 'Powtórki', steps: [] });
    current = review.mount(layout.body, { onDone: leave, onSkip: leave, standalone: true });
    return () => { closed = true; stopStep(); };
  }

  const parsed = schedule.parseSid(sid);
  let program, vocab, lessons;
  try {
    program = await content.loadProgram();
    [vocab, lessons] = await Promise.all([content.loadVocab(parsed.week), content.loadLessons(parsed.week)]);
  } catch {
    fail('Ten tydzień jest jeszcze w przygotowaniu', 'Materiały do tej sesji nie zostały jeszcze dodane. Powtórki są dostępne na ekranie „Dziś”.');
    return () => { closed = true; };
  }
  if (closed) return;
  const plan = schedule.sessionPlan(program, parsed.week, parsed.day);
  const isDone = (key) => !!model.stepState(sid, key)?.done;
  const started = nowTs();
  let gained = { newCards: 0, reviews: 0 };

  const dots = (activeKey) => plan.steps.map((s) => ({ key: s.key, label: s.labelPl, state: isDone(s.key) ? 'done' : s.key === activeKey ? 'current' : 'todo' }));

  const summary = () => {
    const minutes = Math.max(1, Math.round((nowTs() - started) / 60000));
    bar.update({ title: 'Sesja ukończona', steps: dots(null) });
    ui.mount(layout.body, h('div', { class: 'done' },
      h('h2', { class: 'done__title' }, 'Sesja ukończona'),
      h('p', { class: 'muted' }, `Tydzień ${plan.week}, dzień ${plan.day}: ${plan.labelPl}.`),
      h('div', { class: 'stats' },
        ui.stat({ value: gained.newCards, label: 'nowych słów' }),
        ui.stat({ value: gained.reviews, label: 'powtórek' }),
        ui.stat({ value: minutes, unit: 'min', label: 'nauki' }),
        ui.stat({ value: model.streak(), label: 'dni z rzędu' })),
      ui.actionBar(ui.button({ label: 'Wróć do „Dziś”', kind: 'primary', size: 'lg', id: 'session-finish', onClick: leave }))));
  };

  const next = () => {
    if (closed) return;
    stopStep();
    const step = plan.steps.find((s) => !isDone(s.key));
    if (!step) return summary();
    const stepStart = nowTs();
    bar.update({ title: step.labelPl, steps: dots(step.key) });
    layout.body.replaceChildren();
    window.scrollTo(0, 0);
    const finish = (result = {}, skipped = false) => {
      if (closed || isDone(step.key)) return;
      if (result.newCards) gained.newCards += result.newCards;
      if (result.reviews) gained.reviews += result.reviews;
      const wasLast = plan.steps.every((s) => s.key === step.key || isDone(s.key));
      model.markStep(sid, step.key, { ...(skipped ? { skipped: true } : {}), ...(Number.isFinite(result.score) ? { score: result.score, total: result.total } : {}) });
      model.logActivity({ seconds: Math.min(1800, (nowTs() - stepStart) / 1000), sessions: wasLast ? 1 : 0 });
      next();
    };
    const stepCtx = { sid, week: plan.week, day: plan.day, program, weekMeta: weekMeta(program, plan.week), vocab, lessons, set: step.set, moduleTest: !!step.module,
      onDone: (result) => finish(result), onSkip: () => finish({}, true) };
    try {
      current = STEPS[step.key].mount(layout.body, stepCtx);
    } catch (err) {
      console.error(err);
      ui.mount(layout.body, ui.emptyState({ icon: 'alert', title: 'Ten krok nie chce się uruchomić', body: 'Postępy są bezpieczne. Można spróbować jeszcze raz albo pominąć ten krok.',
        action: h('div', { class: 'cluster' }, ui.button({ label: 'Spróbuj ponownie', kind: 'primary', onClick: next }), ui.button({ label: 'Pomiń ten krok', onClick: () => finish({}, true) })) }));
    }
  };
  next();
  return () => { closed = true; stopStep(); };
}
