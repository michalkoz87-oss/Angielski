// audio.js — speech output. Two providers: the browser's Web Speech voices and, inside a Claude
// Artifact, the `tts` capability. Short items use the browser voice when there is one; long texts
// prefer the Claude voice. If the viewer switched reading aloud off (not_granted), audio is
// treated as unavailable for this page load and no other voice is used instead.

import { cap } from './platform.js';

let tts = null;
let blocked = false;
let webBroken = false;
let state = 'idle';
let prefs = { accent: 'en-GB', voice: 'auto' };
let started = false;
const listeners = new Set();

const synth = () => {
  try {
    return typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  } catch {
    return null;
  }
};
const webOk = () => !!synth() && !webBroken && typeof SpeechSynthesisUtterance !== 'undefined';

function setState(next) {
  if (next === state) return;
  state = next;
  for (const fn of [...listeners]) {
    try {
      fn(state);
    } catch (err) {
      console.error(err);
    }
  }
}

function pickVoice() {
  const voices = (synth()?.getVoices?.() ?? []).filter((v) => /^en[-_]/i.test(v.lang) || v.lang === 'en');
  const want = prefs.accent.toLowerCase();
  return voices.find((v) => v.lang.replace('_', '-').toLowerCase() === want) ?? voices[0] ?? null;
}

function webSpeak(text, rate) {
  return new Promise((resolve) => {
    const s = synth();
    if (!s) return resolve(false);
    try {
      s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickVoice();
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? prefs.accent;
      u.rate = rate;
      u.onend = () => resolve(true);
      u.onerror = (e) => {
        if (e?.error && !['interrupted', 'canceled'].includes(e.error)) webBroken = true;
        resolve(false);
      };
      s.speak(u);
    } catch {
      webBroken = true;
      resolve(false);
    }
  });
}

async function ttsSpeak(what, rate) {
  try {
    await tts.speak(what, { rate, language: prefs.accent });
    return 'ok';
  } catch (err) {
    const code = err?.code;
    if (code === 'not_granted') {
      blocked = true;
      return 'blocked';
    }
    return code === 'stopped' ? 'stopped' : 'failed';
  }
}

async function run(lines, { rate = 1, long = false } = {}) {
  const texts = lines.map((t) => String(t ?? '').trim()).filter(Boolean);
  if (!texts.length || blocked) return;
  const preferTts = prefs.voice === 'claude' || (prefs.voice === 'auto' && (long || !webOk()));
  setState('speaking');
  try {
    if (tts && (preferTts || !webOk())) {
      const what = texts.length === 1 ? texts[0].slice(0, 2000) : texts.map((text) => ({ text: text.slice(0, 2000) }));
      const result = await ttsSpeak(what, rate);
      if (result !== 'failed' || !webOk()) return;
    }
    if (webOk()) for (const text of texts) if (!(await webSpeak(text, rate))) break;
  } finally {
    setState(available() ? 'idle' : 'unavailable');
  }
}

function available() {
  return !blocked && (webOk() || !!tts);
}

export const audio = {
  init() {
    if (started) return;
    started = true;
    try {
      synth()?.getVoices?.();
      synth()?.addEventListener?.('voiceschanged', () => setState(state));
    } catch {
      /* no browser voices */
    }
    cap('tts').then((ns) => {
      tts = ns;
      for (const fn of [...listeners]) fn(available() ? state : 'unavailable');
    });
  },
  setPrefs(next) {
    prefs = { accent: next?.accent ?? 'en-GB', voice: next?.voice ?? 'auto' };
  },
  available,
  hasClaudeVoice: () => !!tts && !blocked,
  speak: (text, opts) => run([text], opts),
  speakLines: (lines, opts) => run(lines, { long: true, ...opts }),
  stop() {
    try {
      synth()?.cancel();
    } catch {
      /* nothing playing */
    }
    tts?.stop?.().catch?.(() => {});
    setState(available() ? 'idle' : 'unavailable');
  },
  onState(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export default audio;
