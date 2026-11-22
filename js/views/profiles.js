// profiles.js — "Kto się uczy?": pick a learner or add one.
import * as ui from '../core/ui.js';
import * as model from '../core/model.js';
import { loadCatalog } from '../core/content.js';
import { initial } from './common.js';

const { h } = ui;

export function render(root) {
  let courses = [];
  const show = (adding) => {
    const list = model.listProfiles();
    if (adding || list.length === 0) return form(list.length === 0);
    const rows = list.map((p) => {
      const c = courses.find((x) => x.id === model.profileCourseId(p.id));
      return h('button', { class: 'who__row', type: 'button', id: `who-${p.id}`, onClick: () => model.switchProfile(p.id) },
        h('span', { class: 'who__avatar', 'aria-hidden': 'true' }, initial(p.name)),
        h('span', { class: 'who__body' },
          h('span', { class: 'who__name' }, p.name),
          h('span', { class: 'muted small' }, c ? `${c.rangeLabel} · ${c.titlePl}` : 'Poziom do wybrania')),
        ui.icon('chevron-right'));
    });
    ui.mount(root, ui.page(null,
      h('div', { class: 'gate' },
        ui.brand(),
        h('h1', { class: 'gate__title' }, 'Kto się uczy?'),
        h('div', { class: 'who' }, rows),
        ui.button({ label: 'Dodaj osobę', kind: 'secondary', id: 'who-add', onClick: () => show(true) }))));
  };

  const form = (first) => {
    let ageGroup = 'adult';
    const name = ui.textInput({ id: 'profile-name', placeholder: 'np. Michał', maxlength: 30, onEnter: () => submit() });
    const error = h('p', { class: 'field__error', role: 'alert', hidden: true }, 'Wpisz imię lub pseudonim.');
    const submit = () => {
      const value = name.value.trim();
      error.hidden = !!value;
      if (!value) return name.focus();
      const id = model.createProfile({ name: value, ageGroup });
      model.switchProfile(id);
    };
    ui.mount(root, ui.page(null,
      h('div', { class: 'gate' },
        ui.brand(),
        h('h1', { class: 'gate__title' }, first ? 'Zacznijmy od Ciebie' : 'Nowa osoba'),
        first && h('p', { class: 'muted' }, 'Każda osoba ma własny poziom, plan nauki, powtórki i postępy. Kolejne osoby można dodać później.'),
        h('form', { class: 'stack', onSubmit: (e) => { e.preventDefault(); submit(); } },
          ui.field({ label: 'Imię lub pseudonim', control: name }),
          error,
          ui.segmented({ id: 'profile-age', label: 'Kto to jest?', value: ageGroup, block: true,
            options: [{ value: 'adult', label: 'Osoba dorosła' }, { value: 'minor', label: 'Dziecko lub nastolatek' }],
            onChange: (v) => { ageGroup = v; } }),
          h('p', { class: 'muted small' }, 'W profilach dzieci i nastolatków funkcje korzystające z Claude (sprawdzanie tekstów, rozmowa) są wyłączone.'),
          h('div', { class: 'cluster' },
            ui.button({ label: 'Dalej', kind: 'primary', type: 'submit', id: 'profile-save' }),
            !first && ui.button({ label: 'Anuluj', kind: 'ghost', onClick: () => show(false) }))))));
    name.focus();
  };

  show(false);
  loadCatalog().then((c) => { courses = c; if (root.querySelector('.who')) show(false); }).catch(() => {});
}
