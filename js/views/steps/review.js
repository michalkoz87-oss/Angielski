// review.js — spaced-repetition review of due cards.
import * as ui from '../../core/ui.js';
import * as model from '../../core/model.js';
import * as content from '../../core/content.js';
import * as srs from '../../core/srs.js';
import { vocabQuestion, seededRng } from '../../core/exercises.js';
import { todayKey, toDayNumber, nowTs } from '../../core/platform.js';
import { questionView } from './exercise-ui.js';

const { h } = ui;
const GRADES = [['again', 'Nie wiem'], ['hard', 'Trudne'], ['good', 'Dobrze'], ['easy', 'Łatwe']];

export function mount(root, ctx) {
  let dead = false;
  let onKey = null;
  const setKeys = (fn) => { onKey = fn; };
  const keyHandler = (e) => { if (!dead && onKey && !e.target.closest?.('input, textarea')) onKey(e); };
  document.addEventListener('keydown', keyHandler);

  const today = toDayNumber(todayKey());
  const ids = srs.buildQueue(model.allCardStates(), today, model.getProfile().maxReviews);
  const empty = () => ui.mount(root, h('div', { class: 'done' },
    h('h2', { class: 'done__title' }, 'Brak powtórek na dziś'),
    h('p', { class: 'muted' }, 'Wszystkie poznane słowa są na bieżąco. Kolejne powtórki pojawią się w dniu, w którym pamięć zacznie ich potrzebować.'),
    ui.actionBar(ui.button({ label: ctx.standalone ? 'Wróć' : 'Dalej', kind: 'primary', size: 'lg', id: 'review-next', onClick: () => ctx.onDone({ reviews: 0 }) }))));
  if (!ids.length) { empty(); return { destroy() { dead = true; document.removeEventListener('keydown', keyHandler); } }; }

  ui.mount(root, ui.loading('Przygotowuję powtórki…'));
  (async () => {
    const weeks = [...new Set(ids.map(content.weekOfItem).filter(Boolean))];
    const pool = (await Promise.allSettled(weeks.map((w) => content.loadVocab(w)))).flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    // Pack cards: distractors come from the same pack, never from the general course.
    const packPools = {};
    for (const packId of [...new Set(ids.map(content.packOfItem).filter(Boolean))]) {
      try { packPools[packId] = (await content.loadPack(packId)).items; } catch { /* pack file missing: its cards are skipped */ }
    }
    const poolFor = (item) => packPools[content.packOfItem(item.id)] ?? pool;
    if (dead) return;
    const queue = ids.filter((id) => content.itemById(id)).map((id) => ({ id, repeat: false }));
    if (!queue.length) return empty();
    const rng = seededRng(`review-${todayKey()}`);
    const total = queue.length;
    let done = 0;
    let correct = 0;
    let i = 0;

    const apply = (entry, rating) => {
      if (!entry.repeat) {
        model.setCardState(entry.id, srs.grade(model.cardState(entry.id), rating, today, nowTs(), entry.id));
        model.logActivity({ reviews: 1, correct: rating === 'again' ? 0 : 1 });
        done++;
        if (rating !== 'again') correct++;
      }
      if (rating === 'again') queue.splice(Math.min(queue.length, i + 4), 0, { id: entry.id, repeat: true });
      i++;
      show();
    };

    const gradeButtons = (entry, kinds) => h('div', { class: 'grades' }, kinds.map(([rating, label], n) => {
      const st = model.cardState(entry.id);
      const hint = entry.repeat ? '' : rating === 'again' ? 'jutro' : `${srs.grade(st, rating, today, nowTs(), entry.id).i} d`;
      return h('button', { class: ['grade', `grade--${rating}`], type: 'button', id: `grade-${rating}`, onClick: () => apply(entry, rating) },
        h('span', { class: 'grade__label' }, label), h('span', { class: 'grade__hint num' }, hint), h('span', { class: 'grade__key', 'aria-hidden': 'true' }, String(n + 1)));
    }));

    const show = () => {
      if (dead) return;
      setKeys(null);
      if (i >= queue.length) {
        const pct = done ? Math.round((correct / done) * 100) : 0;
        ui.mount(root, h('div', { class: 'done' },
          h('h2', { class: 'done__title' }, 'Powtórki ukończone'),
          h('p', { class: 'done__score num' }, ui.count(done, 'karta', 'karty', 'kart'), h('span', { class: 'muted' }, ` · ${pct}% pamiętanych`)),
          ui.actionBar(ui.button({ label: ctx.standalone ? 'Wróć do „Dziś”' : 'Dalej', kind: 'primary', size: 'lg', id: 'review-next', onClick: () => ctx.onDone({ reviews: done }) }))));
        return;
      }
      const entry = queue[i];
      const item = content.itemById(entry.id);
      const mode = entry.repeat ? 'recognize' : srs.promptMode(model.cardState(entry.id));
      const head = h('div', { class: 'q-run__head' }, h('span', { class: 'label' }, entry.repeat ? 'Jeszcze raz' : `Karta ${Math.min(done + 1, total)} z ${total}`), ui.progressBar((done / total) * 100, { thin: true }));

      if (mode === 'recognize') {
        const answer = h('div', { class: 'flash__back', hidden: true }, ui.dictEntry(item, { size: 'md', speak: false, ipa: false, headingLevel: 3 }));
        const actions = h('div', { class: 'action-bar' });
        const reveal = () => {
          answer.hidden = false;
          ui.mount(actions, gradeButtons(entry, entry.repeat ? [['again', 'Nie wiem'], ['good', 'Już pamiętam']] : GRADES));
          setKeys((e) => { const g = (entry.repeat ? ['again', 'good'] : ['again', 'hard', 'good', 'easy'])[Number(e.key) - 1]; if (g) apply(entry, g); });
        };
        ui.mount(actions, ui.button({ label: 'Pokaż odpowiedź', kind: 'primary', size: 'lg', block: true, id: 'reveal', onClick: reveal }));
        setKeys((e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); reveal(); } });
        ui.mount(root, h('div', { class: 'q-run' }, head,
          ui.card({ flash: true, class: 'flash' },
            h('p', { class: 'flash__term en' }, item.term),
            h('div', { class: 'cluster flash__meta' }, h('span', { class: 'ipa', lang: 'en' }, item.ipa), ui.speakButton(item.term, { size: 'sm', label: `Posłuchaj: ${item.term}` })),
            answer),
          actions));
        return;
      }

      const q = vocabQuestion(item, poolFor(item), mode === 'choose' ? (rng() < 0.5 ? 'choose-pl' : 'choose-term') : 'type-term', rng);
      const actions = h('div', { class: 'action-bar' });
      const view = questionView(q, { seed: `rev-${entry.id}`, onAnswer: (ok) => {
        const more = h('div', { class: 'flash__back' }, ui.dictEntry(item, { size: 'md', headingLevel: 3 }));
        view.el.appendChild(more);
        if (mode === 'choose') ui.mount(actions, ui.button({ label: 'Dalej', kind: 'primary', size: 'lg', block: true, id: 'review-continue', onClick: () => apply(entry, ok ? 'good' : 'again') }));
        else ui.mount(actions, gradeButtons(entry, ok ? [['good', 'Dobrze'], ['easy', 'Łatwe']] : [['again', 'Nie wiem'], ['hard', 'Literówka, zaliczam']]));
        actions.querySelector('button')?.focus({ preventScroll: true });
      } });
      ui.mount(root, h('div', { class: 'q-run' }, head, view.el, actions));
      view.focus();
    };
    show();
  })();

  return { destroy() { dead = true; document.removeEventListener('keydown', keyHandler); } };
}
