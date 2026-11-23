// settings.js — plan, sound, learner and level, backup.
import * as ui from '../core/ui.js';
import * as model from '../core/model.js';
import * as content from '../core/content.js';
import { store } from '../core/store.js';
import { audio } from '../core/audio.js';
import { ai } from '../core/ai.js';
import { isArtifact, saveFile, todayKey } from '../core/platform.js';

const { h } = ui;
const DAYS = ['pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.', 'niedz.'];

export async function render(root, ctx) {
  const p = model.getProfile();
  const me = model.activeProfile();
  const saved = () => ui.toast('Zapisano', 'ok');
  let courses = [];
  try { courses = await content.loadCatalog(); } catch { /* shown without names */ }
  const course = courses.find((c) => c.id === p.courseId);

  const chips = h('div', { class: 'cluster', role: 'group', 'aria-label': 'Dni nauki' });
  let studyDays = [...p.studyDays];
  const drawChips = () => ui.mount(chips, DAYS.map((label, i) => ui.chip({ label, pressed: studyDays.includes(i + 1), id: `set-day-${i + 1}`, onClick: () => {
    const next = studyDays.includes(i + 1) ? studyDays.filter((d) => d !== i + 1) : [...studyDays, i + 1].sort();
    if (!next.length) return ui.toast('Potrzebny jest co najmniej jeden dzień nauki', 'bad');
    studyDays = next;
    model.setProfile({ studyDays });
    drawChips();
    saved();
  } })));
  drawChips();

  const name = ui.textInput({ id: 'set-name', value: me?.name ?? '', maxlength: 30, onChange: (v) => { if (v.trim()) { model.updateProfileMeta(me.id, { name: v }); saved(); } } });
  const start = ui.textInput({ id: 'set-start', type: 'date', value: p.startDate ?? '', onChange: (v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { model.setProfile({ startDate: v }); saved(); } } });
  const time = ui.textInput({ id: 'set-time', type: 'time', value: p.studyTime, onChange: (v) => { if (v) { model.setProfile({ studyTime: v }); saved(); } } });
  const limit = ui.select({ id: 'set-limit', value: String(p.maxReviews), options: [40, 60, 80, 120, 200].map((n) => ({ value: String(n), label: `${n} kart dziennie` })),
    onChange: (v) => { model.setProfile({ maxReviews: Number(v) }); saved(); } });

  const file = h('input', { type: 'file', accept: '.json,application/json', id: 'set-import', class: 'sr-only', onChange: async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const people = Object.values(data?.docs?.profiles?.list ?? {}).filter((x) => !x.deleted).map((x) => x.name);
      if (!(await ui.confirmDialog({ title: 'Wczytać kopię zapasową?', body: `Plik zawiera postępy osób: ${people.join(', ') || 'brak danych'}. Zostaną połączone z obecnymi: nic nie zostanie usunięte, a przy różnicach wygrywa nowszy zapis.`, confirmLabel: 'Wczytaj' }))) return;
      const n = store.importAll(data);
      ui.toast(n ? 'Kopia wczytana' : 'Kopia nie zawierała nic nowego', 'ok');
      if (!model.activeProfileId()) model.boot();
      ctx.rerender();
    } catch (err) {
      ui.toast(err instanceof TypeError ? err.message : 'Nie udało się odczytać pliku', 'bad');
    }
  } });

  ui.mount(root, ui.page(null,
    ui.pageHeader({ title: 'Ustawienia' }),
    ui.section({ title: 'Osoba i poziom' },
      ui.field({ label: 'Imię lub pseudonim', control: name }),
      h('p', null, h('span', { class: 'muted' }, 'Poziom: '), course ? `${course.rangeLabel} · ${course.titlePl}` : p.courseId),
      h('div', { class: 'cluster' },
        ui.button({ label: 'Zmień poziom', id: 'set-level', onClick: async () => {
          if (await ui.confirmDialog({ title: 'Zmienić poziom?', body: 'Postęp na obecnym poziomie zostaje zapisany i można do niego wrócić. Na nowym poziomie nauka zaczyna się od pierwszego tygodnia.', confirmLabel: 'Wybierz poziom' })) model.setCourse(null);
        } }),
        ui.button({ label: model.listProfiles().length > 1 ? 'Zmień osobę' : 'Dodaj kolejną osobę', id: 'set-switch', onClick: () => model.switchProfile(null) }))),
    ui.section({ title: 'Plan nauki' },
      ui.field({ label: 'Pierwszy dzień kursu', hint: 'Zmiana przesuwa planowane daty wszystkich sesji.', control: start }),
      h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Dni nauki'), chips),
      ui.field({ label: 'Pora nauki', control: time }),
      ui.field({ label: 'Dzienny limit powtórek', control: limit })),
    ui.section({ title: 'Dźwięk' },
      ui.segmented({ id: 'set-accent', label: 'Wymowa', value: p.accent, options: [{ value: 'en-GB', label: 'Brytyjska' }, { value: 'en-US', label: 'Amerykańska' }],
        onChange: (v) => { model.setProfile({ accent: v }); audio.setPrefs(model.getProfile()); saved(); } }),
      audio.hasClaudeVoice() && ui.segmented({ id: 'set-voice', label: 'Głos', value: p.voice, options: [{ value: 'auto', label: 'Automatycznie' }, { value: 'browser', label: 'Przeglądarka' }, { value: 'claude', label: 'Claude' }],
        onChange: (v) => { model.setProfile({ voice: v }); audio.setPrefs(model.getProfile()); saved(); } }),
      h('div', { class: 'cluster' }, audio.available() ? ui.speakButton('This is how the lessons will sound.', { showLabel: true, label: 'Posłuchaj próbki' }) : h('p', { class: 'muted' }, 'Na tym urządzeniu dźwięk jest niedostępny. Ćwiczenia ze słuchu działają w wersji do czytania.'))),
    ui.section({ title: 'Zapis postępów' },
      h('div', { class: 'cluster' }, ui.syncIndicator({ label: true })),
      h('p', { class: 'muted' }, !isArtifact
        ? 'Postęp zapisuje się tylko w tej przeglądarce. Kopię zapasową warto robić regularnie; można ją też wczytać na innym urządzeniu.'
        : ['offline', 'local'].includes(store.syncStatus())
          ? 'Zapis na koncie Claude jest teraz niedostępny, więc postęp zapisuje się tylko w tej przeglądarce. Jeśli ten stan się utrzymuje (na przykład strona jest udostępniona bez prawa zapisu), rób regularnie kopię zapasową.'
          : 'Postęp zapisuje się na Twoim koncie Claude i synchronizuje między urządzeniami, na których otwierasz tę stronę.'),
      h('p', { class: 'muted small' }, ai.available() ? (model.isAdult() ? 'Sprawdzanie tekstów i rozmowy z Claude są dostępne.' : 'Funkcje korzystające z Claude są wyłączone w profilach dzieci i nastolatków.') : 'Sprawdzanie tekstów i rozmowy z Claude działają tylko po otwarciu aplikacji w Claude.'),
      h('div', { class: 'cluster' },
        ui.button({ label: 'Zapisz kopię zapasową', icon: 'download', id: 'set-export', onClick: async () => {
          const result = await saveFile(`angielski-kopia-${todayKey()}.json`, JSON.stringify(store.exportAll()));
          ui.toast(result === 'saved' ? 'Kopia zapisana' : result === 'declined' ? 'Anulowano' : 'Zapis pliku jest niedostępny w tym widoku', result === 'saved' ? 'ok' : 'info');
        } }),
        h('label', { class: 'btn btn--secondary', for: 'set-import' }, ui.icon('upload'), 'Wczytaj kopię'), file)),
    ui.section({ title: 'Usuwanie' },
      h('p', { class: 'muted' }, 'Usunięcie osoby ukrywa jej profil i postępy na wszystkich urządzeniach.'),
      ui.button({ label: `Usuń osobę: ${me?.name ?? ''}`, kind: 'danger', id: 'set-delete', onClick: async () => {
        if (await ui.confirmDialog({ title: `Usunąć osobę „${me?.name}”?`, body: 'Profil, plan i postępy tej osoby znikną z aplikacji. Tej operacji nie można cofnąć.', confirmLabel: 'Usuń', danger: true })) model.deleteProfile(me.id);
      } }))));
}
