// exercise-ui.js — shared question widgets and a sequential runner.
//   questionView(q, {seed, feedback, onAnswer})  → {el, focus()}
//   runQuestions(root, questions, {feedback, repeatWrong, seed, onFinish({score,total,results})})
//   scoreSummary({score, total, title, body, actions})  → element
// Question shapes: {type:'mc', q|prompt, sentence?, options, answer}, {type:'tf', q, answer},
// typed ({type:'gap'|'transform', prompt|sentence|gapped, answers, keyword?, base?, hintPl?}).
import * as ui from '../../core/ui.js';
import { checkAnswer, answerText, shuffle, seededRng } from '../../core/exercises.js';

const { h } = ui;
const TF = [['true', 'Prawda'], ['false', 'Fałsz'], ['not_given', 'Brak informacji']];

export function questionView(q, { seed = 'q', feedback = true, onAnswer } = {}) {
  let answered = false;
  let focusEl = null;
  const slot = ui.feedbackSlot();
  const finish = (ok, response) => {
    if (answered) return;
    answered = true;
    if (feedback) {
      const right = answerText(q);
      slot.show({ kind: ok ? 'correct' : 'wrong', title: ok ? 'Dobrze' : right ? `Poprawna odpowiedź: ${right}` : 'Niestety nie',
        body: q.explanationPl ? ui.md(q.explanationPl) : null });
    }
    onAnswer?.(ok, response);
  };

  const head = [];
  if (q.type === 'transform') {
    head.push(h('p', { class: 'q__text en' }, q.prompt), h('p', { class: 'muted small' }, 'Dokończ drugie zdanie tak, aby znaczyło to samo. Użyj słowa: ', h('strong', { lang: 'en' }, q.keyword)), h('p', { class: 'q__text en' }, q.gapped));
  } else {
    const main = q.q ?? q.prompt ?? q.sentence ?? '';
    head.push(h('p', { class: 'q__text en' }, main));
    if (q.sentence && q.sentence !== main) head.push(h('p', { class: 'q__text q__text--sub en' }, q.sentence));
    if (q.base) head.push(h('p', { class: 'muted small' }, 'Utwórz właściwą formę od słowa: ', h('strong', { lang: 'en' }, q.base)));
    if (q.hintPl) head.push(h('p', { class: 'muted small' }, `Podpowiedź: ${q.hintPl}`));
  }

  let body;
  if (q.type === 'mc' || q.type === 'tf') {
    const opts = q.type === 'tf' ? TF.map(([value, label]) => ({ value, label })) : shuffle(q.options.map((label, value) => ({ value, label })), seededRng(seed));
    const buttons = opts.map((o) => {
      const btn = h('button', { class: ['q__opt', q.type === 'mc' && q.mode !== 'choose-pl' && 'en'], type: 'button', onClick: () => {
        if (answered) return;
        const ok = checkAnswer(q, o.value);
        for (const b of buttons) {
          b.disabled = true;
          if (feedback && checkAnswer(q, b.optValue)) b.classList.add('is-right');
        }
        btn.classList.add(feedback ? (ok ? 'is-right' : 'is-wrong') : 'is-picked');
        finish(ok, o.value);
      } }, o.label);
      btn.optValue = o.value;
      return btn;
    });
    focusEl = null;
    body = h('div', { class: 'q__opts', role: 'group' }, buttons);
  } else {
    const check = ui.button({ label: feedback ? 'Sprawdź' : 'Dalej', kind: 'primary', onClick: () => submit() });
    const input = ui.textInput({ english: true, placeholder: 'Wpisz odpowiedź', ariaLabel: 'Odpowiedź', onEnter: () => submit() });
    const submit = () => {
      if (answered) return;
      const value = input.value.trim();
      if (!value && feedback) return input.focus();
      const ok = checkAnswer(q, value);
      input.readOnly = true;
      check.hidden = true;
      if (feedback) input.classList.add(ok ? 'is-correct' : 'is-wrong');
      finish(ok, value);
    };
    focusEl = input;
    body = h('div', { class: 'q__typed' }, input, check);
  }
  const el = h('div', { class: 'q' }, head, body, slot);
  return { el, focus: () => focusEl?.focus({ preventScroll: true }) };
}

export function runQuestions(root, questions, { feedback = true, repeatWrong = false, seed = 'run', onFinish, label = 'Pytanie' } = {}) {
  const queue = questions.map((q, idx) => ({ q, idx, retry: false }));
  const results = [];
  let i = 0;
  const show = () => {
    if (i >= queue.length) {
      const score = results.filter((r) => r?.ok).length;
      return onFinish?.({ score, total: questions.length, results });
    }
    const { q, idx, retry } = queue[i];
    const nextBtn = ui.button({ label: i === queue.length - 1 ? 'Zakończ' : 'Dalej', kind: 'primary', size: 'lg', onClick: () => { i++; show(); } });
    nextBtn.hidden = true;
    const view = questionView(q, { seed: `${seed}-${idx}`, feedback, onAnswer: (ok, response) => {
      if (!retry) results[idx] = { ok, response };
      if (!ok && repeatWrong && !retry) queue.push({ q, idx, retry: true });
      if (feedback) { nextBtn.hidden = false; nextBtn.focus({ preventScroll: true }); }
      else { i++; show(); }
    } });
    ui.mount(root, h('div', { class: 'q-run' },
      h('div', { class: 'q-run__head' }, h('span', { class: 'label' }, retry ? 'Jeszcze raz' : `${label} ${Math.min(i + 1, questions.length)} z ${questions.length}`), ui.progressBar((i / queue.length) * 100, { thin: true })),
      view.el, ui.actionBar(nextBtn)));
    view.focus();
  };
  show();
}

export function scoreSummary({ score, total, title = 'Wynik', body, actions = [] }) {
  const pct = total ? Math.round((score / total) * 100) : 0;
  return h('div', { class: 'done' },
    h('h2', { class: 'done__title' }, title),
    h('p', { class: 'done__score num' }, `${score} / ${total}`, h('span', { class: 'muted' }, ` · ${pct}%`)),
    body && h('p', { class: 'muted' }, body),
    ui.actionBar(...actions));
}
