// today.js — "Dziś": what to do now.
import * as ui from '../core/ui.js';
import * as model from '../core/model.js';
import * as schedule from '../core/schedule.js';
import * as content from '../core/content.js';
import { todayKey } from '../core/platform.js';
import { makeIsDone, dueCount, weekMeta } from './common.js';

const { h } = ui;

export async function render(root, ctx) {
  ui.mount(root, ui.page(null, ui.loading()));
  let program;
  try {
    program = await content.loadProgram();
  } catch {
    ui.mount(root, ui.page(null, ui.emptyState({ icon: 'alert', title: 'Nie udało się wczytać kursu', body: 'Sprawdź połączenie i odśwież stronę.' })));
    return;
  }
  const today = todayKey();
  const profile = model.getProfile();
  const me = model.activeProfile();
  const isDone = makeIsDone(program);
  const st = schedule.status(profile, isDone, today);
  const due = dueCount();
  const stats = model.dayStats(today);

  const head = ui.pageHeader({
    eyebrow: ui.fmtDate(today, 'long'),
    title: `Cześć, ${me?.name ?? ''}`,
    sub: `${program.rangeLabel} · ${program.title}`,
    actions: model.listProfiles().length > 1 ? ui.button({ label: 'Zmień osobę', kind: 'ghost', size: 'sm', id: 'switch-person', onClick: () => model.switchProfile(null) }) : null,
  });
  const numbers = h('div', { class: 'stats stats--3' },
    ui.stat({ value: model.streak(), label: 'dni z rzędu' }),
    ui.stat({ value: model.allCardStates().size, label: 'poznanych słów' }),
    ui.stat({ value: due, label: 'powtórek na dziś' }));

  const blocks = [head, numbers];

  if (st.finished) {
    blocks.push(ui.banner({ kind: 'correct', title: 'Kurs ukończony', body: 'Wszystkie sesje tego poziomu są zaliczone. Powtórki nadal utrwalają słownictwo, a w Ustawieniach można przejść na wyższy poziom.' }));
  } else {
    const { week, day } = schedule.parseSid(st.currentSid);
    const plan = schedule.sessionPlan(program, week, day);
    const meta = weekMeta(program, week);
    const available = await content.hasWeek(week);
    const startedAny = plan.steps.some((s) => model.stepState(plan.sid, s.key)?.done);
    const planned = st.plannedForCurrent;
    const future = planned && planned > today;
    const doneToday = stats.sessions > 0 && future;
    const steps = h('ol', { class: 'today__steps' }, plan.steps.map((s) => {
      const done = !!model.stepState(plan.sid, s.key)?.done;
      return h('li', { class: ['today__step', done && 'is-done'] },
        h('span', { class: 'today__check', 'aria-hidden': 'true' }, done ? ui.icon('check', { size: 16 }) : ui.icon(ui.stepIcon(s.key), { size: 16 })),
        h('span', { class: 'today__step-label' }, s.key === 'review' ? `${s.labelPl}${due ? ` (${due})` : ''}` : s.labelPl),
        h('span', { class: 'muted small num' }, done ? 'zrobione' : `${s.minutes} min`));
    }));
    const startBtn = ui.button({ label: startedAny ? 'Kontynuuj sesję' : future ? 'Zacznij wcześniej' : 'Zacznij sesję', kind: doneToday ? 'secondary' : 'primary', size: 'lg', block: true, icon: 'play', id: 'start-session',
      disabled: !available, onClick: () => ctx.navigate('nauka', { sid: plan.sid }) });
    if (doneToday) blocks.push(ui.banner({ kind: 'correct', title: 'Dzisiejsza sesja ukończona', body: 'Następna jest zaplanowana na ' + ui.fmtDate(planned, 'day') + '.' }));
    else if (!st.isStudyDayToday && future) blocks.push(ui.banner({ kind: 'info', title: 'Dziś dzień wolny', body: 'Można zrobić same powtórki albo zacząć następną sesję wcześniej.' }));
    blocks.push(ui.card({ class: 'today__session' },
      h('p', { class: 'label' }, `Tydzień ${week} · dzień ${day}` + (planned ? ` · ${ui.fmtDate(planned, 'rel')}` : '')),
      h('h2', { class: 'today__title' }, plan.labelPl),
      meta && h('p', { class: 'muted' }, `${meta.themePl} · ${meta.grammarPl}`),
      steps,
      !available && ui.banner({ kind: 'warn', title: 'Ten tydzień jest jeszcze w przygotowaniu', body: 'Materiały do tego tygodnia nie zostały jeszcze dodane. Powtórki są dostępne.' }),
      startBtn));
    if (st.behindSessions >= 2) {
      blocks.push(ui.banner({ kind: 'warn', title: `Plan wyprzedza naukę o ${ui.count(st.behindSessions, 'sesję', 'sesje', 'sesji')}`,
        body: 'Nic straconego. Plan można przesunąć tak, żeby bieżąca sesja wypadała dziś.',
        action: ui.button({ label: 'Dopasuj plan do dzisiaj', size: 'sm', id: 'realign', onClick: async () => {
          const next = schedule.realign(profile, isDone, today);
          if (await ui.confirmDialog({ title: 'Przesunąć plan?', body: 'Bieżąca sesja zostanie zaplanowana na najbliższy dzień nauki, a kolejne odpowiednio później. Zaliczone sesje i powtórki się nie zmienią.', confirmLabel: 'Przesuń plan' })) {
            model.setProfile({ startDate: next });
            ctx.rerender();
          }
        } }) }));
    }
  }

  if (due > 0) {
    blocks.push(ui.section({ title: 'Powtórki' },
      h('p', { class: 'muted' }, `${ui.count(due, 'słowo czeka', 'słowa czekają', 'słów czeka')} na powtórkę. To kilka minut, które decydują o tym, ile zostaje w pamięci.`),
      ui.button({ label: 'Tylko powtórki', kind: 'secondary', icon: 'refresh', id: 'review-only', onClick: () => ctx.navigate('nauka', { mode: 'review' }) })));
  }
  ui.mount(root, ui.page(null, blocks));
}
