// onboarding.js — the plan for the chosen level: start date, study days, time, accent.
import * as ui from '../core/ui.js';
import * as model from '../core/model.js';
import * as schedule from '../core/schedule.js';
import { loadProgram } from '../core/content.js';
import { todayKey } from '../core/platform.js';

const { h } = ui;
const DAYS = ['pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.', 'niedz.'];

export async function render(root) {
  ui.mount(root, ui.page(null, ui.loading()));
  let program;
  try {
    program = await loadProgram();
  } catch {
    ui.mount(root, ui.page(null, ui.emptyState({ icon: 'alert', title: 'Nie udało się wczytać kursu', body: 'Sprawdź połączenie i odśwież stronę.',
      action: ui.button({ label: 'Wybierz inny poziom', onClick: () => model.setCourse(null) }) })));
    return;
  }
  const p = model.getProfile();
  let studyDays = [...p.studyDays];
  let accent = p.accent;
  const today = todayKey();
  const start = ui.textInput({ id: 'plan-start', type: 'date', value: schedule.nextStudyDate({ studyDays }, today) ?? today, min: today });
  const time = ui.textInput({ id: 'plan-time', type: 'time', value: p.studyTime });
  const error = h('p', { class: 'field__error', role: 'alert', hidden: true });
  const chips = h('div', { class: 'cluster', role: 'group', 'aria-label': 'Dni nauki' });
  const drawChips = () => ui.mount(chips, DAYS.map((label, i) => ui.chip({ label, pressed: studyDays.includes(i + 1), id: `plan-day-${i + 1}`,
    onClick: () => { studyDays = studyDays.includes(i + 1) ? studyDays.filter((d) => d !== i + 1) : [...studyDays, i + 1].sort(); drawChips(); } })));
  drawChips();
  const submit = () => {
    if (!studyDays.length) { error.textContent = 'Wybierz co najmniej jeden dzień nauki.'; error.hidden = false; return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start.value)) { error.textContent = 'Podaj datę rozpoczęcia.'; error.hidden = false; return; }
    model.setProfile({ studyDays, studyTime: time.value || '17:00', accent, startDate: start.value });
    location.hash = '#dzis';
    if (location.hash === '#dzis') window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
  ui.mount(root, ui.page(null,
    h('div', { class: 'gate' },
      h('p', { class: 'label' }, `${program.rangeLabel} · ${program.title}`),
      h('h1', { class: 'gate__title' }, 'Ustal plan nauki'),
      h('p', { class: 'muted' }, `Kurs ma ${program.weeks} tygodnie po ${program.daysPerWeek} sesji. Jedna sesja trwa około ${program.sessionMinutes} minut: powtórki, nowe słowa i lekcja dnia. Plan można w każdej chwili przesunąć.`),
      h('form', { class: 'stack', onSubmit: (e) => { e.preventDefault(); submit(); } },
        ui.field({ label: 'Pierwszy dzień nauki', control: start }),
        h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Dni nauki'), chips,
          h('p', { class: 'field__hint' }, `Najlepiej ${program.daysPerWeek} dni w tygodniu i jeden dzień wolny.`)),
        ui.field({ label: 'Pora nauki', hint: 'Do przypomnienia w kalendarzu.', control: time }),
        ui.segmented({ id: 'plan-accent', label: 'Wymowa w nagraniach', value: accent, block: true,
          options: [{ value: 'en-GB', label: 'Brytyjska' }, { value: 'en-US', label: 'Amerykańska' }], onChange: (v) => { accent = v; } }),
        error,
        h('div', { class: 'cluster' },
          ui.button({ label: 'Zaczynam naukę', kind: 'primary', type: 'submit', id: 'plan-save' }),
          ui.button({ label: 'Zmień poziom', kind: 'ghost', onClick: () => model.setCourse(null) }))))));
}
