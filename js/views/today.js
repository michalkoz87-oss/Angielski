// today.js — "Dziś": what to do now, and how fast it is sensible to go.
import * as ui from '../core/ui.js';
import * as model from '../core/model.js';
import * as schedule from '../core/schedule.js';
import * as content from '../core/content.js';
import { buildQueue } from '../core/srs.js';
import { todayKey, toDayNumber } from '../core/platform.js';
import { makeIsDone, dueCount, weekMeta } from './common.js';

const { h } = ui;
export const DAILY_SESSIONS = 2; // sessions a day before the app says "enough for today"
const sessionsPl = (n) => ui.count(n, 'sesja', 'sesje', 'sesji');

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
    const start = () => ctx.navigate('nauka', { sid: plan.sid });

    // Pace: a daily cap, and a brake on starting early while earlier words are not sticking.
    const dueAll = buildQueue(model.allCardStates(), toDayNumber(today)).length;
    const week7 = model.history(7);
    const reviewed = week7.reduce((a, d) => a + d.reviews, 0);
    const kept = week7.reduce((a, d) => a + d.correct, 0);
    const weak = reviewed >= 20 && kept / reviewed < 0.8;
    const backlog = dueAll > profile.maxReviews;
    const capReached = stats.sessions >= DAILY_SESSIONS && !startedAny;
    const brake = !capReached && future && !startedAny && (weak || backlog);
    const confirmStart = async (title, body) => {
      if (await ui.confirmDialog({ title, body, confirmLabel: 'Zaczynam', cancelLabel: 'Wystarczy na dziś' })) start();
    };

    // A level that may be too easy: ahead of the plan and the last two tests at 90% or more.
    const tests = Object.entries(model.allTests()).sort(([a], [b]) => a.localeCompare(b)).map(([, t]) => (t.total ? t.score / t.total : 0));
    const lastTwo = tests.slice(-2);
    if (st.aheadSessions > 0 && lastTwo.length === 2 && lastTwo.every((x) => x >= 0.9) && (profile.levelHintTests ?? 0) < tests.length) {
      const catalog = await content.loadCatalog().catch(() => []);
      const next = catalog[catalog.findIndex((c) => c.id === profile.courseId) + 1];
      if (next && catalog.some((c) => c.id === profile.courseId)) {
        blocks.push(h('div', { id: 'level-hint' }, ui.banner({ kind: 'info', title: 'Ten poziom może być za łatwy', live: false,
          body: `Nauka wyprzedza plan, a dwa ostatnie testy to ${Math.round(lastTwo[0] * 100)}% i ${Math.round(lastTwo[1] * 100)}%. Może warto spróbować poziomu ${next.rangeLabel} (${next.titlePl}). Postęp na obecnym poziomie zostaje zapisany.`,
          action: h('div', { class: 'cluster' },
            ui.button({ label: 'Zobacz poziomy', size: 'sm', id: 'level-hint-go', onClick: async () => {
              if (await ui.confirmDialog({ title: 'Zmienić poziom?', body: 'Postęp na obecnym poziomie zostaje zapisany i można do niego wrócić. Na nowym poziomie nauka zaczyna się od pierwszego tygodnia.', confirmLabel: 'Wybierz poziom' })) model.setCourse(null);
            } }),
            ui.button({ label: 'Nie teraz', kind: 'ghost', size: 'sm', id: 'level-hint-later', onClick: () => { model.setProfile({ levelHintTests: tests.length }); ctx.rerender(); } })) })));
      }
    }

    const steps = h('ol', { class: 'today__steps' }, plan.steps.map((s) => {
      const done = !!model.stepState(plan.sid, s.key)?.done;
      return h('li', { class: ['today__step', done && 'is-done'] },
        h('span', { class: 'today__check', 'aria-hidden': 'true' }, done ? ui.icon('check', { size: 16 }) : ui.icon(ui.stepIcon(s.key), { size: 16 })),
        h('span', { class: 'today__step-label' }, s.key === 'review' ? `${s.labelPl}${due ? ` (${due})` : ''}` : s.labelPl),
        h('span', { class: 'muted small num' }, done ? 'zrobione' : `${s.minutes} min`));
    }));

    let actions;
    if (capReached) {
      actions = [
        h('div', { id: 'pace-cap' }, ui.banner({ kind: 'info', title: 'Na dziś wystarczy', live: false,
          body: `Masz dziś za sobą ${sessionsPl(stats.sessions)}. Nowe słowa potrzebują nocy i powtórek, żeby zostać w pamięci. Powtórki są dostępne bez ograniczeń.` })),
        ui.button({ label: 'Zacznij kolejną sesję mimo to', kind: 'ghost', id: 'start-extra', disabled: !available,
          onClick: () => confirmStart('Kolejna sesja tego samego dnia?', 'Każda sesja dokłada nowe słowa, które wracają w powtórkach. Przy trzech sesjach dziennie powtórek szybko robi się więcej, niż da się spokojnie przerobić. Lepiej wrócić jutro.') }),
      ];
    } else if (brake) {
      actions = [
        h('div', { id: 'pace-brake' }, ui.banner({ kind: 'warn', title: 'Najpierw powtórki', live: false,
          body: weak
            ? `W ostatnich 7 dniach pamiętanych było ${Math.round((kept / reviewed) * 100)}% powtarzanych słów. Zanim dojdą nowe, warto utrwalić te, które już są.`
            : `Na powtórkę czeka ${ui.count(dueAll, 'słowo', 'słowa', 'słów')}, więcej niż dzienny limit (${profile.maxReviews}). Zanim dojdą nowe, warto zmniejszyć tę kolejkę.` })),
        due > 0 && ui.button({ label: 'Najpierw powtórki', kind: 'primary', size: 'lg', block: true, icon: 'refresh', id: 'start-review-first', onClick: () => ctx.navigate('nauka', { mode: 'review' }) }),
        ui.button({ label: 'Zacznij sesję mimo to', kind: 'ghost', id: 'start-session', disabled: !available,
          onClick: () => confirmStart('Zacząć następną sesję wcześniej?', 'Ta sesja jest zaplanowana na później, a wcześniejsze słowa jeszcze się nie utrwaliły. Nowe słowa dołożą powtórek.') }),
      ];
    } else {
      actions = [ui.button({ label: startedAny ? 'Kontynuuj sesję' : future ? 'Zacznij wcześniej' : 'Zacznij sesję', kind: doneToday ? 'secondary' : 'primary', size: 'lg', block: true, icon: 'play', id: 'start-session',
        disabled: !available, onClick: start })];
    }

    if (doneToday && !capReached) blocks.push(ui.banner({ kind: 'correct', title: 'Dzisiejsza sesja ukończona', body: 'Następna jest zaplanowana na ' + ui.fmtDate(planned, 'day') + '.' }));
    else if (!st.isStudyDayToday && future && !capReached) blocks.push(ui.banner({ kind: 'info', title: 'Dziś dzień wolny', body: 'Można zrobić same powtórki albo zacząć następną sesję wcześniej.' }));
    blocks.push(ui.card({ class: 'today__session' },
      h('p', { class: 'label' }, `Tydzień ${week} · dzień ${day}` + (planned ? ` · ${ui.fmtDate(planned, 'rel')}` : '')),
      h('h2', { class: 'today__title' }, plan.labelPl),
      meta && h('p', { class: 'muted' }, `${meta.themePl} · ${meta.grammarPl}`),
      steps,
      st.aheadSessions > 0 && h('p', { class: 'muted small', id: 'pace-lead' }, `Zapas: ${sessionsPl(st.aheadSessions)} przed planem. Opuszczony dzień zużyje zapas, zamiast tworzyć zaległość.`),
      !available && ui.banner({ kind: 'warn', title: 'Ten tydzień jest jeszcze w przygotowaniu', body: 'Materiały do tego tygodnia nie zostały jeszcze dodane. Powtórki są dostępne.' }),
      actions));
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
