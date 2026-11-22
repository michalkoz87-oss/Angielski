// progress.js — numbers that show the work done: words, sessions, streak, activity, forecast, tests.
import * as ui from '../core/ui.js';
import * as model from '../core/model.js';
import * as schedule from '../core/schedule.js';
import * as content from '../core/content.js';
import * as srs from '../core/srs.js';
import { todayKey, toDayNumber, weekdayOf } from '../core/platform.js';
import { makeIsDone } from './common.js';

const { h } = ui;

function bars(values, labels, { title, unit }) {
  const max = Math.max(1, ...values);
  return h('figure', { class: 'chart' }, h('figcaption', { class: 'label' }, title),
    h('div', { class: 'chart__bars', role: 'img', 'aria-label': `${title}: ${values.map((v, i) => `${labels[i]} ${v}`).join(', ')}` },
      values.map((v, i) => h('div', { class: 'chart__col', title: `${labels[i]}: ${v} ${unit}` },
        h('span', { class: 'chart__val num' }, v || ''), h('span', { class: 'chart__bar', style: { height: `${Math.round((v / max) * 100)}%` } }), h('span', { class: 'chart__lab num' }, labels[i])))));
}

export async function render(root) {
  ui.mount(root, ui.page(null, ui.loading()));
  let program;
  try {
    program = await content.loadProgram();
  } catch {
    ui.mount(root, ui.page(null, ui.emptyState({ icon: 'alert', title: 'Nie udało się wczytać danych', body: 'Sprawdź połączenie i odśwież stronę.' })));
    return;
  }
  const states = model.allCardStates();
  const today = toDayNumber(todayKey());
  const isDone = makeIsDone(program);
  const st = schedule.status(model.getProfile(), isDone, todayKey());
  const total = program.weeks * program.vocabPerWeek;
  const groups = { learning: 0, young: 0, mature: 0 };
  for (const s of states.values()) groups[srs.maturity(s)] = (groups[srs.maturity(s)] ?? 0) + 1;
  const hist = model.history(84);
  const seconds = hist.reduce((a, d) => a + d.seconds, 0);
  const last14 = hist.slice(-14);
  const reviews = last14.reduce((a, d) => a + d.reviews, 0);
  const correct = last14.reduce((a, d) => a + d.correct, 0);
  const forecast = srs.forecast(states, today, 14);
  const dayLabels = Array.from({ length: 14 }, (_, i) => (i === 0 ? 'dziś' : `+${i}`));
  const level = (d) => { const n = d.reviews + d.newCards * 2 + d.sessions * 10; return n === 0 ? 0 : n < 15 ? 1 : n < 40 ? 2 : n < 80 ? 3 : 4; };
  const pad = weekdayOf(hist[0].key) - 1;
  const heat = h('div', { class: 'heat', role: 'img', 'aria-label': `Aktywność w ostatnich 12 tygodniach: ${hist.filter((d) => level(d)).length} dni z nauką` },
    Array.from({ length: pad }, () => h('span', { class: 'heat__cell heat__cell--pad' })),
    hist.map((d) => h('span', { class: 'heat__cell', dataset: { l: level(d) }, title: `${ui.fmtDate(d.key, 'day')}: ${ui.count(d.reviews, 'powtórka', 'powtórki', 'powtórek')}, ${ui.count(d.newCards, 'nowe słowo', 'nowe słowa', 'nowych słów')}` })));
  const tests = Object.entries(model.allTests()).sort(([a], [b]) => a.localeCompare(b));
  const empty = states.size === 0 && st.doneSessions === 0;

  ui.mount(root, ui.page(null,
    ui.pageHeader({ title: 'Postępy', eyebrow: `${program.rangeLabel} · ${program.title}` }),
    h('div', { class: 'stats' },
      ui.stat({ value: states.size, unit: `/ ${total}`, label: 'poznanych słów' }),
      ui.stat({ value: st.doneSessions ?? 0, unit: `/ ${program.weeks * program.daysPerWeek}`, label: 'ukończonych sesji' }),
      ui.stat({ value: model.streak(), label: 'dni z rzędu' }),
      ui.stat({ value: Math.round(seconds / 3600 * 10) / 10, unit: 'godz.', label: 'nauki w 12 tygodni' })),
    empty && ui.banner({ kind: 'info', title: 'Tu pojawią się Twoje postępy', body: 'Po pierwszej sesji zobaczysz tutaj poznane słowa, aktywność dzień po dniu i prognozę powtórek.', live: false }),
    ui.section({ title: 'Słownictwo' },
      ui.progressBar((states.size / total) * 100, { label: 'Poznane słowa kursu' }),
      h('ul', { class: 'legend' },
        h('li', null, h('span', { class: 'legend__dot', dataset: { k: 'learning' } }), `w nauce: ${groups.learning}`),
        h('li', null, h('span', { class: 'legend__dot', dataset: { k: 'young' } }), `utrwalane: ${groups.young}`),
        h('li', null, h('span', { class: 'legend__dot', dataset: { k: 'mature' } }), `opanowane: ${groups.mature}`)),
      h('p', { class: 'muted small' }, 'Słowo jest opanowane, gdy odstęp między powtórkami przekroczy trzy tygodnie.')),
    ui.section({ title: 'Aktywność' }, heat,
      h('p', { class: 'muted small num' }, reviews ? `Ostatnie 14 dni: ${ui.count(reviews, 'powtórka', 'powtórki', 'powtórek')}, ${Math.round((correct / reviews) * 100)}% pamiętanych.` : 'W ostatnich 14 dniach nie było powtórek.')),
    ui.section({ title: 'Prognoza powtórek' }, states.size ? bars(forecast, dayLabels, { title: 'Karty do powtórki w kolejnych dniach', unit: 'kart' }) : h('p', { class: 'muted' }, 'Prognoza pojawi się po poznaniu pierwszych słów.')),
    ui.section({ title: 'Testy' }, tests.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, 'Tydzień'), h('th', null, 'Wynik'), h('th', null, 'Data'))),
        h('tbody', null, tests.map(([key, t]) => h('tr', null, h('td', { class: 'num' }, `${Number(key.slice(1))}${t.module ? ' (moduł)' : ''}`), h('td', { class: 'num' }, `${t.score}/${t.total} · ${Math.round((t.score / t.total) * 100)}%`), h('td', { class: 'num' }, ui.fmtDate(todayKey(new Date(t.at)), 'short')))))))
      : h('p', { class: 'muted' }, 'Wyniki testów tygodnia pojawią się po pierwszej sobocie kursu.'))));
}
