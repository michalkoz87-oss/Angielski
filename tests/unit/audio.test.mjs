// Browser speech with a fake speechSynthesis: fallbacks and failures.
import test from 'node:test';
import assert from 'node:assert/strict';

const spoken = [];
let voices = [];
let behaviour = () => 'ok'; // (utterance) => 'ok' | 'silent' | 'error'
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) { this.text = text; }
};
globalThis.speechSynthesis = {
  speaking: false,
  pending: false,
  getVoices: () => voices,
  addEventListener() {},
  cancel() {},
  speak(u) {
    spoken.push({ text: u.text, voice: u.voice?.name ?? null, lang: u.lang, rate: u.rate });
    const what = behaviour(u);
    if (what === 'ok') setTimeout(() => { u.onstart?.(); u.onend?.(); }, 5);
    else if (what === 'error') setTimeout(() => u.onerror?.({ error: 'synthesis-failed' }), 5);
    // 'silent': nothing ever happens (a voice that never starts)
  },
};
const { audio } = await import('../../js/core/audio.js');
const v = (name, lang, localService = true) => ({ name, lang, localService });
const reset = () => { spoken.length = 0; behaviour = () => 'ok'; };

test('speaks with the best English voice at the learner pace', async () => {
  reset();
  voices = [v('Zosia', 'pl-PL'), v('Eddy (English (UK))', 'en-GB'), v('Daniel', 'en-GB')];
  audio.setPrefs({ accent: 'en-GB', speechRate: 0.9 });
  assert.equal(audio.available(), true);
  await audio.speak('reliable');
  assert.deepEqual(spoken.map((s) => s.voice), ['Daniel']);
  assert.equal(spoken[0].rate, 0.9);
  assert.equal(audio.diagnostics().lastError, '');
});

test('a voice that fails is replaced and audio stays available', async () => {
  reset();
  voices = [v('Google UK English Female', 'en-GB', false), v('Microsoft Zira', 'en-US')];
  behaviour = (u) => (u.voice?.name === 'Google UK English Female' ? 'error' : 'ok');
  await audio.speak('reliable');
  assert.deepEqual(spoken.map((s) => s.voice), ['Google UK English Female', 'Microsoft Zira']);
  assert.equal(audio.available(), true);
  reset();
  await audio.speak('again');
  assert.equal(spoken.length >= 1, true);
});

test('when every voice fails the error is reported, not hidden, and the next tap tries again', async () => {
  reset();
  voices = [v('Daniel', 'en-GB')];
  behaviour = () => 'error';
  await audio.speak('reliable');
  assert.match(audio.diagnostics().lastError, /synthesis-failed/);
  assert.equal(audio.available(), true);
  behaviour = () => 'ok';
  spoken.length = 0;
  await audio.speak('reliable');
  assert.equal(audio.diagnostics().lastError, '');
});

test('a device with voices but no English voice is reported as such', () => {
  voices = [v('Zosia', 'pl-PL'), v('Anna', 'de-DE')];
  assert.equal(audio.available(), false);
  assert.equal(audio.problem(), 'no-english-voice');
  assert.equal(audio.diagnostics().english, 0);
});

test('a browser that lists no voices at all still speaks, in English', async () => {
  reset();
  voices = [];
  assert.equal(audio.available(), true);
  await audio.speak('reliable');
  assert.deepEqual(spoken.map((s) => [s.voice, s.lang]), [[null, 'en-GB']]);
});
