// plan.js — the whole course at a glance: modules, weeks, sessions with planned dates.
import * as ui from '../core/ui.js';
import * as model from '../core/model.js';
import * as schedule from '../core/schedule.js';
import * as content from '../core/content.js';
import { todayKey } from '../core/platform.js';
import { makeIsDone } from './common.js';

const { h } = ui;

export async function render(root, ctx) {
  ui.mount(root, ui.page(null, ui.loading()));
  let program;
  try {
    program = await content.loadProgram();
  } catch {
    ui.mount(root, ui.page(null, ui.emptyState({ icon: 'alert', title: 'Nie udało się wczytać planu', body: 'Sprawdź połączenie i odśwież stronę.' })));
    return;
  }
  const profile = model.getProfile();
  const today = todayKey();
  const isDone = makeIsDone(program);
  const st = schedule.status(profile, isDone, today);
  const currentWeek = st.currentSid ? schedule.parseSid(st.currentSid).week : null;
  const me = model.activeProfile();

  const rhythm = h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, h('th', null, 'Dzień'), h('th', null, 'Sesja'))),
    h('tbody', null, program.dayTemplate.map((d) => h('tr', null, h('td', { class: 'num' }, d.day), h('td', null, `Powtórki${d.learnSet ? ', nowe słowa' : ''}, ${d.labelPl.toLowerCase()}`))))));

  const weekRow = (w) => {
    const sessions = program.dayTemplate.map((d) => {
      const sid = schedule.sid(w.week, d.day);
      const date = schedule.plannedDate(profile, w.week, d.day);
      const done = isDone(sid);
      return ui.listRow({ lead: done ? ui.icon('check', { size: 18 }) : h('span', { class: 'num muted' }, d.day), title: d.labelPl,
        sub: date ? ui.fmtDate(date, 'day') : '', trail: done ? ui.badge('zrobione', 'ok') : sid === st.currentSid ? ui.badge('teraz', 'accent') : null });
    });
    const doneCount = program.dayTemplate.filter((d) => isDone(schedule.sid(w.week, d.day))).length;
    const from = schedule.plannedDate(profile, w.week, 1);
    return ui.disclosure({ open: w.week === currentWeek, id: `plan-week-${w.week}`, summary: h('span', { class: 'plan__week' },
      h('span', { class: 'plan__no num' }, w.week),
      h('span', { class: 'plan__body' }, h('span', { class: 'plan__theme' }, w.themePl), h('span', { class: 'muted small' }, w.grammarPl)),
      h('span', { class: 'muted small num nowrap' }, doneCount === program.dayTemplate.length ? 'ukończony' : doneCount ? `${doneCount}/${program.dayTemplate.length}` : from ? ui.fmtDate(from, 'short') : '')) },
      h('p', { class: 'en muted small', lang: 'en' }, `${w.themeEn} · ${w.grammarEn}`), ui.list(...sessions));
  };

  const calendar = schedule.calendarUrl({ ...profile, sessionMinutes: program.sessionMinutes }, { appUrl: location.href.split('#')[0], today, isDoneFn: isDone });
  ui.mount(root, ui.page(null,
    ui.pageHeader({ title: 'Plan', eyebrow: `${program.rangeLabel} · ${program.title}`, sub: `${program.weeks} tygodnie, ${program.daysPerWeek} sesji w tygodniu, około ${program.sessionMinutes} minut dziennie` }),
    ui.section({ title: 'Rytm tygodnia' }, rhythm),
    ui.section({ title: 'Kalendarz' },
      h('p', { class: 'muted' }, `Nauka w dni: ${profile.studyDays.map((d) => ['pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.', 'niedz.'][d - 1]).join(', ')} o ${profile.studyTime}. Dni i godzinę zmienisz w Ustawieniach.`),
      h('div', { class: 'cluster' },
        ui.linkButton({ label: 'Dodaj do Kalendarza Google', href: calendar, external: true, icon: 'calendar' }),
        !st.finished && st.behindSessions > 0 && ui.button({ label: 'Dopasuj plan do dzisiaj', id: 'plan-realign', onClick: async () => {
          if (await ui.confirmDialog({ title: 'Przesunąć plan?', body: 'Bieżąca sesja zostanie zaplanowana na najbliższy dzień nauki, a kolejne odpowiednio później.', confirmLabel: 'Przesuń plan' })) {
            model.setProfile({ startDate: schedule.realign(profile, isDone, today) });
            ctx.rerender();
          }
        } })),
      h('p', { class: 'muted small' }, `Przycisk otwiera Kalendarz Google z gotowym, powtarzającym się wydarzeniem${me ? ` dla: ${me.name}` : ''}. Wystarczy je zapisać.`)),
    program.modules.map((m) => ui.section({ title: `Moduł ${m.n}: ${m.titlePl}` }, h('div', { class: 'plan__weeks' }, program.weekList.filter((w) => m.weeks.includes(w.week)).map(weekRow))))));
}
