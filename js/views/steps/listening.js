// listening.js — dictation and a short monologue with questions. Works without audio as a
// read-and-remember exercise.
import * as ui from '../../core/ui.js';
import * as model from '../../core/model.js';
import { audio } from '../../core/audio.js';
import { diffWords } from '../../core/exercises.js';
import { runQuestions, scoreSummary } from './exercise-ui.js';

const { h } = ui;

export function mount(root, ctx) {
  const l = ctx.lessons.listening;
  const key = `w${String(ctx.week).padStart(2, '0')}-listening`;
  let dead = false;
  let timer = null;
  let okWords = 0;
  let allWords = 0;

  const end = (q) => {
    const score = Math.round((allWords ? okWords / allWords : 1) * l.dictation.length) + q.score;
    const total = l.dictation.length + q.total;
    model.saveResult(key, { score, total });
    ui.mount(root, scoreSummary({ score, total, title: 'Słuchanie ukończone',
      actions: [ui.button({ label: 'Dalej', kind: 'primary', size: 'lg', id: 'step-done', onClick: () => ctx.onDone({ score, total }) })] }),
    ui.disclosure({ summary: 'Zapis nagrania' }, h('div', { class: 'prose prose--en' }, l.monologue.script.map((p) => h('p', { lang: 'en' }, p)))));
  };

  const monologue = () => {
    const m = l.monologue;
    const hasAudio = audio.available();
    const box = h('div');
    const startQuestions = () => { audio.stop(); runQuestions(box, m.questions, { seed: key, onFinish: end }); };
    ui.mount(root, h('div', { class: 'stack' },
      h('h2', { class: 'q-run__title' }, 'Nagranie'), h('p', { class: 'en', lang: 'en' }, m.title), h('p', { class: 'muted small' }, `Mówi: ${m.speaker}`),
      hasAudio
        ? h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Posłuchaj raz lub dwa razy, potem odpowiedz na pytania. Tekst zobaczysz na końcu.'),
          h('div', { class: 'cluster' }, ui.speakButton(m.script, { long: true, showLabel: true, label: 'Odtwórz nagranie' }), ui.button({ label: 'Zatrzymaj', kind: 'ghost', icon: 'stop', onClick: () => audio.stop() })))
        : h('div', { class: 'stack' }, ui.banner({ kind: 'info', title: 'Dźwięk jest niedostępny na tym urządzeniu', body: 'Przeczytaj tekst uważnie jeden raz, potem odpowiedz na pytania.', live: false }),
          h('div', { class: 'prose prose--en' }, m.script.map((p) => h('p', { lang: 'en' }, p)))),
      box));
    ui.mount(box, ui.actionBar(ui.button({ label: 'Przejdź do pytań', kind: 'primary', size: 'lg', id: 'listen-questions', onClick: startQuestions })));
  };

  const dictation = (i) => {
    if (dead) return;
    if (i >= l.dictation.length) return monologue();
    const sentence = l.dictation[i].text;
    const hasAudio = audio.available();
    const input = ui.textInput({ id: 'dictation', english: true, placeholder: 'Wpisz usłyszane zdanie', ariaLabel: 'Usłyszane zdanie', onEnter: () => check() });
    const result = h('div', { 'aria-live': 'polite' });
    const peek = h('p', { class: 'en dict__peek', lang: 'en', hidden: true }, sentence);
    const actions = h('div', { class: 'action-bar' });
    const check = () => {
      if (input.readOnly) return;
      if (!input.value.trim()) return input.focus();
      input.readOnly = true;
      const diff = diffWords(sentence, input.value);
      const good = diff.filter((d) => d.status === 'ok').length;
      const needed = diff.filter((d) => d.status !== 'extra').length;
      okWords += good;
      allWords += needed;
      ui.mount(result, h('p', { class: 'dict__diff en', lang: 'en' }, diff.map((d) => [h('span', { class: `dict__w dict__w--${d.status}` }, d.word), ' '])),
        h('p', { class: 'en', lang: 'en' }, sentence), h('p', { class: 'muted small num' }, `Poprawnie: ${good} z ${needed}`));
      const next = ui.button({ label: i === l.dictation.length - 1 ? 'Przejdź do nagrania' : 'Następne zdanie', kind: 'primary', size: 'lg', id: 'dictation-next', onClick: () => { audio.stop(); dictation(i + 1); } });
      ui.mount(actions, next);
      next.focus({ preventScroll: true });
    };
    ui.mount(actions, ui.button({ label: 'Sprawdź', kind: 'primary', size: 'lg', id: 'dictation-check', onClick: check }));
    const controls = hasAudio
      ? h('div', { class: 'cluster' }, ui.speakButton(sentence, { showLabel: true, label: 'Odtwórz' }), ui.speakButton(sentence, { rate: 0.75, showLabel: true, label: 'Wolniej' }))
      : ui.button({ label: 'Pokaż zdanie na 4 sekundy', icon: 'clock', onClick: () => { peek.hidden = false; clearTimeout(timer); timer = setTimeout(() => { peek.hidden = true; input.focus(); }, 4000); } });
    ui.mount(root, h('div', { class: 'q-run' },
      h('div', { class: 'q-run__head' }, h('span', { class: 'label' }, `Dyktando ${i + 1} z ${l.dictation.length}`), ui.progressBar((i / l.dictation.length) * 100, { thin: true })),
      h('p', { class: 'muted small' }, hasAudio ? 'Posłuchaj zdania i zapisz je. Można odtwarzać kilka razy.' : 'Dźwięk jest niedostępny: przeczytaj zdanie, zapamiętaj je i zapisz z pamięci.'),
      controls, peek, input, result, actions));
  };

  dictation(0);
  return { destroy() { dead = true; clearTimeout(timer); audio.stop(); } };
}
