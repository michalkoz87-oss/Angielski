// dictionary.js — all vocabulary of the course with search, filters and learning status.
import * as ui from '../core/ui.js';
import * as model from '../core/model.js';
import * as content from '../core/content.js';
import * as srs from '../core/srs.js';
import { ai } from '../core/ai.js';
import { todayKey, toDayNumber, fromDayNumber } from '../core/platform.js';

const { h } = ui;
const PAGE = 40;
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
const STATUS = { new: 'nowe', learning: 'w nauce', young: 'utrwalane', mature: 'opanowane' };

export async function render(root) {
  ui.mount(root, ui.page(null, ui.loading()));
  let program, items, packCatalog = [];
  try {
    program = await content.loadProgram();
    items = await content.loadVocabRange(1, program.weeks);
    packCatalog = (await content.loadPackCatalog()).filter((p) => model.enabledPacks().includes(p.id));
    for (const meta of packCatalog) {
      try { items = items.concat((await content.loadPack(meta.id)).items); } catch { /* pack file missing */ }
    }
  } catch {
    ui.mount(root, ui.page(null, ui.emptyState({ icon: 'alert', title: 'Nie udało się wczytać słownika', body: 'Sprawdź połączenie i odśwież stronę.' })));
    return;
  }
  const states = model.allCardStates();
  const packName = Object.fromEntries(packCatalog.map((p) => [p.id, `${p.titlePl} (${p.levelPl})`]));
  const where = (it) => {
    const info = content.packInfo(it.id);
    return info ? `${packName[info.packId] ?? 'Pakiet'} · zestaw ${info.set}: ${info.setTitlePl}` : `Tydzień ${content.weekOfItem(it.id)}`;
  };
  const today = toDayNumber(todayKey());
  let query = '';
  let filter = 'all';
  let shown = PAGE;
  const listEl = h('div', { class: 'dict' });
  const countEl = h('p', { class: 'muted small num', 'aria-live': 'polite' });

  const entry = (it) => {
    const st = states.get(it.id);
    const m = srs.maturity(st);
    const more = h('div', { class: 'dict__more' });
    const explainBox = h('div');
    const details = ui.disclosure({ summary: h('span', { class: 'dict__row' },
      h('span', { class: 'dict__term en', lang: 'en' }, it.term), h('span', { class: 'dict__pl' }, it.pl), ui.badge(STATUS[m] ?? 'nowe', m === 'mature' ? 'ok' : m === 'new' ? 'neutral' : 'accent')),
      onToggle: (open) => {
        if (!open || more.childNodes.length) return;
        ui.mount(more, ui.dictEntry(it, { size: 'md', extras: true, headingLevel: 3 }),
          h('p', { class: 'muted small' }, where(it) + (st ? ` · następna powtórka: ${ui.fmtDate(fromDayNumber(Math.max(st.d, today)), 'rel')}` : ' · jeszcze nie w powtórkach')),
          ai.available() && model.isAdult() && ui.button({ label: 'Wyjaśnij szerzej', icon: 'sparkle', size: 'sm', onClick: async (e) => {
            const btn = e.currentTarget;
            ui.setLoading(btn, true, 'Claude pisze…');
            try {
              ui.mount(explainBox, h('p', { class: 'prose dict__explain' }, await ai.explain(it, { level: program.levelFrom })));
              btn.hidden = true;
            } catch (err) {
              ui.mount(explainBox, h('p', { class: 'field__error' }, err?.messagePl ?? 'Nie udało się pobrać wyjaśnienia.'));
            } finally { ui.setLoading(btn, false); }
          } }), explainBox);
      } }, more);
    return details;
  };

  const draw = () => {
    const q = fold(query.trim());
    const match = items.filter((it) => {
      if (q && !fold(it.term).includes(q) && !fold(it.pl).includes(q)) return false;
      if (filter === 'all') return true;
      const m = srs.maturity(states.get(it.id));
      if (filter === 'course') return !content.packOfItem(it.id);
      if (filter.startsWith('pack:')) return content.packOfItem(it.id) === filter.slice(5);
      return filter === 'learned' ? m !== 'new' : filter === 'due' ? !!states.get(it.id) && states.get(it.id).d <= today : it.type === filter;
    });
    countEl.textContent = `${ui.count(match.length, 'hasło', 'hasła', 'haseł')}`;
    const more = match.length > shown ? ui.button({ label: 'Pokaż więcej', id: 'dict-more', onClick: () => { shown += PAGE; draw(); } }) : null;
    ui.mount(listEl, match.length ? match.slice(0, shown).map(entry) : ui.emptyState({ title: 'Brak haseł', body: items.length ? 'Zmień wyszukiwanie lub filtr.' : 'Słownictwo tego poziomu jest jeszcze w przygotowaniu.' }), more);
  };

  const search = ui.textInput({ id: 'dict-search', type: 'search', placeholder: 'Szukaj po angielsku lub po polsku', ariaLabel: 'Szukaj w słowniku', onInput: (v) => { query = v; shown = PAGE; draw(); } });
  const filters = ui.select({ id: 'dict-filter', value: filter, onChange: (v) => { filter = v; shown = PAGE; draw(); },
    options: [{ value: 'all', label: 'Wszystkie' }, { value: 'learned', label: 'Poznane' }, { value: 'due', label: 'Do powtórki' }, { value: 'word', label: 'Słowa' }, { value: 'phrasal', label: 'Phrasal verbs' }, { value: 'collocation', label: 'Kolokacje' }, { value: 'idiom', label: 'Idiomy' },
      ...(packCatalog.length ? [{ value: 'course', label: 'Tylko słownictwo kursu' }, ...packCatalog.map((p) => ({ value: `pack:${p.id}`, label: `${p.titlePl}: ${p.levelPl}` }))] : [])] });
  ui.mount(root, ui.page(null,
    ui.pageHeader({ title: 'Słownik', eyebrow: `${program.rangeLabel} · ${program.title}`, sub: `Poznane: ${model.courseCardStates().size} z ${program.weeks * program.vocabPerWeek} haseł kursu` }),
    h('div', { class: 'dict__tools' }, search, filters), countEl, listEl));
  draw();
}
