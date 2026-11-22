// level.js — choose the level (course) for the active learner.
import * as ui from '../core/ui.js';
import * as model from '../core/model.js';
import { loadCatalog } from '../core/content.js';

const { h } = ui;

export async function render(root) {
  ui.mount(root, ui.page(null, ui.loading()));
  let courses;
  try {
    courses = await loadCatalog();
  } catch {
    ui.mount(root, ui.page(null, ui.emptyState({ icon: 'alert', title: 'Nie udało się wczytać listy poziomów', body: 'Sprawdź połączenie i odśwież stronę.' })));
    return;
  }
  const started = model.enrolments();
  const me = model.activeProfile();
  const cards = courses.map((c) => ui.card({ class: 'level-card' },
    h('div', { class: 'level-card__head' },
      h('span', { class: 'level-card__range' }, c.rangeLabel),
      h('h2', { class: 'level-card__title' }, c.titlePl),
      started[c.id]?.startDate && ui.badge('rozpoczęty', 'accent')),
    h('p', null, c.descPl),
    h('p', { class: 'muted small' }, c.forWhomPl),
    h('p', { class: 'small num' }, `${c.weeks} tygodnie · ok. ${c.sessionMinutes} min dziennie · ${c.vocabPerWeek} nowych słów tygodniowo`),
    ui.button({ label: started[c.id]?.startDate ? 'Wróć do tego poziomu' : 'Wybieram ten poziom', kind: 'primary', id: `level-${c.id}`, onClick: () => model.setCourse(c.id) })));
  ui.mount(root, ui.page(null,
    h('div', { class: 'gate gate--wide' },
      h('h1', { class: 'gate__title' }, me ? `${me.name}, wybierz poziom` : 'Wybierz poziom'),
      h('p', { class: 'muted' }, 'Wybierz poziom, którego opis brzmi jak rzeczy do nauczenia, a nie jak rzeczy już opanowane. Poziom można zmienić w Ustawieniach; postęp na każdym poziomie zapisuje się osobno.'),
      h('div', { class: 'stack' }, cards),
      model.listProfiles().length > 1 && ui.button({ label: 'Zmień osobę', kind: 'ghost', onClick: () => model.switchProfile(null) }))));
}
