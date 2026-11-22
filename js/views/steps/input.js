// input.js — extensive listening/reading outside the app: three suggestions and a short checklist.
import * as ui from '../../core/ui.js';
import * as model from '../../core/model.js';
import { loadResources } from '../../core/content.js';

const { h } = ui;
const KINDS = [['podcast', 'Do słuchania'], ['video', 'Do oglądania'], ['reading', 'Do czytania']];

export function mount(root, ctx) {
  let dead = false;
  const saved = model.journalGet(ctx.week, 'input') ?? {};
  const notes = ui.textArea({ id: 'input-notes', rows: 3, value: saved.notes ?? '', english: true, placeholder: 'np. to get the hang of sth' });
  const done = ui.checkbox({ id: 'input-done', label: 'Mam za sobą co najmniej 20 minut angielskiego poza aplikacją', checked: !!saved.done });
  const list = h('div', { class: 'stack' }, ui.loading());
  ui.mount(root, h('div', { class: 'stack' },
    h('h2', { class: 'q-run__title' }, 'Kontakt z językiem'),
    h('p', null, 'Słowa z kart zostają w głowie dopiero wtedy, gdy spotykasz je w prawdziwych tekstach i rozmowach. Wybierz jedną rzecz i spędź z nią co najmniej 20 minut. Może to być też dowolny film, książka albo gra po angielsku.'),
    list, done,
    ui.field({ label: 'Trzy wyrażenia, które zwróciły Twoją uwagę', control: notes }),
    ui.actionBar(ui.button({ label: 'Zakończ', kind: 'primary', size: 'lg', id: 'step-done', onClick: () => {
      model.journalSet(ctx.week, 'input', { notes: notes.value, done: !!done.control?.checked });
      ctx.onDone({});
    } }))));
  loadResources().then((res) => {
    if (dead) return;
    const course = ctx.program.id;
    const fits = (it) => !it.courses || it.courses.includes(course);
    const rows = KINDS.map(([kind, label]) => {
      const pool = res.items.filter((it) => it.kind === kind && fits(it));
      const it = pool.length ? pool[(ctx.week - 1) % pool.length] : null;
      return it && ui.card(null, h('p', { class: 'label' }, `${label} · ${it.level}`), h('h3', { class: 'en' }, it.title), h('p', null, it.descPl), h('p', { class: 'muted small' }, it.howPl),
        it.url && ui.linkButton({ label: 'Otwórz', href: it.url, external: true, kind: 'secondary' }));
    });
    ui.mount(list, rows);
  }).catch(() => ui.mount(list, h('p', { class: 'muted' }, 'Nie udało się wczytać propozycji. Wybierz dowolny materiał po angielsku.')));
  return { destroy() { dead = true; } };
}
