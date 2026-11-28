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
  const packCatalog = await content.loadPackCatalog();
  const packSet = model.packSettings();
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

  const diagText = () => {
    const d = audio.diagnostics();
    return `Diagnostyka: głosy w urządzeniu: ${d.voices}, angielskie: ${d.english}` + (d.chosen ? `, wybrany: ${d.chosen}` : '') + (d.claudeVoice ? ', głos Claude: dostępny' : '')
      + (d.lastVoice ? `, ostatnio użyty: ${d.lastVoice}` : '') + (d.lastError ? `, ostatni błąd: ${d.lastError}` : '') + '.';
  };
  const diagEl = h('p', { class: 'muted small', id: 'audio-diag' }, diagText());
  const offAudio = audio.onState(() => { diagEl.textContent = diagText(); });
  const problem = audio.problem();

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
    packCatalog.length > 0 && ui.section({ title: 'Słownictwo specjalistyczne' },
      h('p', { class: 'muted' }, 'Dodatkowe słownictwo z wybranej dziedziny, niezależne od poziomu kursu. Nowe hasła pojawiają się na ekranie „Dziś”, a potem wracają w zwykłych powtórkach.'),
      packCatalog.map((meta) => {
        const s = packSet[meta.id] ?? {};
        const known = model.packCardStates(meta.id).size;
        const total = meta.sets * meta.setSize;
        const perDay = ui.select({ id: `set-pack-per-day-${meta.id}`, value: String(s.newPerDay ?? 5), ariaLabel: `Nowe słowa dziennie: ${meta.titlePl}, ${meta.levelPl}`,
          options: [3, 5, 8, 10].map((n) => ({ value: String(n), label: `${n} nowych słów dziennie` })),
          onChange: (v) => { model.setPack(meta.id, { newPerDay: Number(v) }); saved(); } });
        perDay.hidden = !s.on;
        return h('div', { class: 'pack-set' },
          ui.toggle({ id: `set-pack-${meta.id}`, label: `${meta.titlePl}: ${meta.levelPl} (${meta.rangeLabel})`, hint: `${meta.descPl} ${total} haseł${known ? `, poznane: ${known}` : ''}.`, checked: !!s.on,
            onChange: (on) => { model.setPack(meta.id, { on }); perDay.hidden = !on; saved(); } }),
          perDay);
      })),
    ui.section({ title: 'Plan nauki' },
      ui.field({ label: 'Pierwszy dzień kursu', hint: 'Zmiana przesuwa planowane daty wszystkich sesji.', control: start }),
      h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Dni nauki'), chips),
      ui.field({ label: 'Pora nauki', control: time }),
      ui.field({ label: 'Dzienny limit powtórek', control: limit })),
    ui.section({ title: 'Dźwięk' },
      problem === 'no-english-voice' && ui.banner({ kind: 'warn', live: false, title: 'To urządzenie nie ma angielskiego głosu',
        body: 'Dlatego wymowa jest wyłączona, a ćwiczenia ze słuchu działają w wersji do czytania. Android: Ustawienia telefonu → System → Języki → Zamiana tekstu na mowę → Usługi mowy Google → zainstaluj dane głosowe „angielski”. iPhone: Ustawienia → Dostępność → Zawartość mówiona → Głosy → Angielski. Windows: Ustawienia → Czas i język → Mowa → dodaj głos angielski. Potem odśwież tę stronę.' }),
      problem === 'no-api' && ui.banner({ kind: 'warn', live: false, title: 'Ta przeglądarka nie potrafi czytać na głos',
        body: 'Otwórz aplikację w Chrome (Android, komputer) albo w Safari (iPhone).' }),
      problem === 'blocked' && ui.banner({ kind: 'info', live: false, title: 'Czytanie na głos jest wyłączone dla tej strony',
        body: 'Można je włączyć ponownie w menu uprawnień tej strony w Claude.' }),
      ui.segmented({ id: 'set-accent', label: 'Wymowa', value: p.accent, options: [{ value: 'en-GB', label: 'Brytyjska' }, { value: 'en-US', label: 'Amerykańska' }],
        onChange: (v) => { model.setProfile({ accent: v }); audio.setPrefs(model.getProfile()); saved(); } }),
      audio.hasClaudeVoice() && ui.segmented({ id: 'set-voice', label: 'Głos', value: p.voice, options: [{ value: 'auto', label: 'Automatycznie' }, { value: 'browser', label: 'Przeglądarka' }, { value: 'claude', label: 'Claude' }],
        onChange: (v) => { model.setProfile({ voice: v }); audio.setPrefs(model.getProfile()); saved(); } }),
      audio.voices().length > 1 && ui.field({ label: 'Lektor (głos tego urządzenia)', hint: 'Jeśli głos jest niewyraźny, wybierz inny z listy i posłuchaj próbki. Wybór dotyczy tego urządzenia.',
        control: ui.select({ id: 'set-voice-name', value: audio.voices().some((v) => v.name === p.voiceName) ? p.voiceName : '',
          options: [{ value: '', label: 'Automatycznie (najwyraźniejszy dostępny)' }, ...audio.voices().map((v) => ({ value: v.name, label: `${v.name} (${v.lang.replace('_', '-')})` }))],
          onChange: (v) => { model.setProfile({ voiceName: v }); audio.setPrefs(model.getProfile()); saved(); } }) }),
      ui.segmented({ id: 'set-rate', label: 'Tempo mowy', value: String(p.speechRate), options: [{ value: '0.7', label: 'Wolno' }, { value: '0.9', label: 'Normalnie' }, { value: '1.05', label: 'Szybko' }],
        onChange: (v) => { model.setProfile({ speechRate: Number(v) }); audio.setPrefs(model.getProfile()); saved(); } }),
      h('div', { class: 'cluster' }, audio.available() ? ui.speakButton('This is how the lessons will sound. I usually get up early and have breakfast with my family.', { showLabel: true, label: 'Posłuchaj próbki' }) : h('p', { class: 'muted' }, 'Na tym urządzeniu dźwięk jest niedostępny. Ćwiczenia ze słuchu działają w wersji do czytania.')),
      h('p', { class: 'muted small' }, 'Jeśli po naciśnięciu „Posłuchaj próbki” nic nie słychać, sprawdź głośność multimediów i tryb cichy telefonu, a potem przepisz poniższą linijkę osobie, która pomaga z aplikacją.'),
      diagEl),
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
  return offAudio;
}
