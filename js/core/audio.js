// audio.js — speech output. Two providers: the browser's Web Speech voices and, inside a Claude
// Artifact, the `tts` capability. Short items use the browser voice when there is one; long texts
// prefer the Claude voice. If the viewer switched reading aloud off (not_granted), audio is
// treated as unavailable for this page load and no other voice is used instead.

import { cap } from './platform.js';

let tts = null;
let blocked = false;
let webBroken = false;
let state = 'idle';
let prefs = { accent: 'en-GB', voice: 'auto', voiceName: '', rate: 0.9 };
let started = false;
const listeners = new Set();

const synth = () => {
  try {
    return typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  } catch {
    return null;
  }
};
const isEnglish = (v) => /^en([-_]|$)/i.test(v?.lang ?? '');
// Voices that are known to be clear, and voices that are novelty effects or old robotic synthesisers.
const GOOD = /(Google (UK|US) English|Natural|Online|Neural|Enhanced|Premium|Siri|Daniel|Arthur|Kate|Serena|Martha|Oliver|Stephanie|Samantha|Ava|Allison|Alex|Susan|Karen|Moira|Tessa|Libby|Sonia|Ryan|Aria|Jenny|Guy|Hazel|George|Zira|David)/i;
const BAD = /(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Zarvox|Deranged|Hysterical|Fred|Junior|Kathy|Ralph|Princess|Bruce|Agnes|Vicki|Eddy|Flo\b|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|eSpeak)/i;

/** English voices of a voice list, best first (pure; exported for tests). */
export function rankVoices(voices, accent = 'en-GB') {
  const want = accent.toLowerCase();
  const score = (v) => {
    const lang = String(v.lang ?? '').replace('_', '-').toLowerCase();
    let s = lang === want ? 100 : lang.slice(0, 2) === 'en' ? 40 : 0;
    if (GOOD.test(v.name ?? '')) s += 50;
    if (BAD.test(v.name ?? '')) s -= 300;
    return s;
  };
  return (voices ?? []).filter(isEnglish).map((v, i) => ({ v, i, s: score(v) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.v);
}

const allVoices = () => {
  try {
    return synth()?.getVoices?.() ?? [];
  } catch {
    return [];
  }
};
// If the device lists voices but none of them is English, speaking would read English text with a
// foreign voice (gibberish): then browser speech counts as unavailable.
const webOk = () => {
  if (!synth() || webBroken || typeof SpeechSynthesisUtterance === 'undefined') return false;
  const all = allVoices();
  return all.length === 0 || all.some(isEnglish);
};

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
  const ranked = rankVoices(allVoices(), prefs.accent);
  return (prefs.voiceName && ranked.find((v) => v.name === prefs.voiceName)) || ranked[0] || null;
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
      u.rate = Math.min(1.5, Math.max(0.5, rate));
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

async function run(lines, { rate: speed = 1, long = false } = {}) {
  const rate = speed * prefs.rate;
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
    prefs = { accent: next?.accent ?? 'en-GB', voice: next?.voice ?? 'auto', voiceName: next?.voiceName ?? '', rate: Number(next?.speechRate) || 0.9 };
  },
  available,
  hasClaudeVoice: () => !!tts && !blocked,
  /** English voices this device offers, best first: [{name, lang}] (empty when the browser lists none). */
  voices: () => rankVoices(allVoices(), prefs.accent).map((v) => ({ name: v.name, lang: v.lang })),
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
