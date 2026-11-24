// audio.js — speech output. Two providers: the browser's Web Speech voices and, inside a Claude
// Artifact, the `tts` capability. Short items use the browser voice when there is one; long texts
// prefer the Claude voice. If the viewer switched reading aloud off (not_granted), audio is
// treated as unavailable for this page load and no other voice is used instead.
//
// Browser speech is unreliable in the field, so: a voice that does not start within a few seconds
// is replaced by the next best one; one failed utterance never switches audio off; and
// diagnostics() says what this device offers, so a problem can be read off the Settings screen.

import { cap } from './platform.js';

let tts = null;
let blocked = false;
let state = 'idle';
let prefs = { accent: 'en-GB', voice: 'auto', voiceName: '', rate: 0.9 };
let started = false;
let runId = 0;
let lastError = '';
let lastVoice = '';
let keep = null; // the utterance being spoken: Chrome drops events of garbage-collected utterances
const listeners = new Set();

const synth = () => {
  try {
    return typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  } catch {
    return null;
  }
};
const hasApi = () => !!synth() && typeof SpeechSynthesisUtterance !== 'undefined';
const isEnglish = (v) => /^en([-_]|$)/i.test(v?.lang ?? '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

/** Why browser speech cannot be used: '' (it can), 'no-api', or 'no-english-voice'. */
function webProblem() {
  if (!hasApi()) return 'no-api';
  const all = allVoices();
  // A device that lists voices but none in English would read English text with a foreign voice.
  if (all.length > 0 && !all.some(isEnglish)) return 'no-english-voice';
  return '';
}
const webOk = () => webProblem() === '';

function setState(next) {
  if (next === state) return;
  state = next;
  notify();
}
function notify() {
  for (const fn of [...listeners]) {
    try {
      fn(available() ? state : 'unavailable');
    } catch (err) {
      console.error(err);
    }
  }
}

// One attempt with one voice. Resolves {ok, started, err}; never rejects.
function speakOnce(text, rate, voice) {
  return new Promise((resolve) => {
    const s = synth();
    let settled = false;
    let begun = false;
    let watchdog = null;
    const done = (ok, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      resolve({ ok, started: begun, err: err ?? '' });
    };
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = String(voice?.lang ?? prefs.accent).replace('_', '-');
      u.rate = Math.min(1.5, Math.max(0.5, rate));
      u.onstart = () => {
        begun = true;
        clearTimeout(watchdog);
        // some browsers never fire `end`: do not leave the button stuck in "speaking"
        watchdog = setTimeout(() => done(true), 8000 + text.length * 150);
      };
      u.onend = () => done(true);
      u.onerror = (e) => done(false, e?.error || 'error');
      keep = u;
      s.speak(u);
      watchdog = setTimeout(() => {
        if (begun) return;
        try {
          s.cancel();
        } catch {
          /* nothing to cancel */
        }
        done(false, 'no-start');
      }, 4000);
    } catch (err) {
      done(false, 'exception');
    }
  });
}

async function webSpeak(text, rate, myRun) {
  const s = synth();
  if (!s) return false;
  if (s.speaking || s.pending) {
    try {
      s.cancel();
    } catch {
      /* nothing to cancel */
    }
    await sleep(80); // speaking right after cancel() is dropped by some browsers
    if (myRun !== runId) return false;
  }
  const ranked = rankVoices(allVoices(), prefs.accent);
  const chosen = (prefs.voiceName && ranked.find((v) => v.name === prefs.voiceName)) || ranked[0] || null;
  const backup = ranked.find((v) => v !== chosen && v.localService !== false) ?? ranked.find((v) => v !== chosen) ?? null;
  const candidates = [chosen, backup, null].filter((v, i, a) => a.indexOf(v) === i);
  for (const voice of candidates) {
    const result = await speakOnce(text, rate, voice);
    if (myRun !== runId) return false; // stopped or replaced by a newer request
    lastVoice = voice?.name ?? 'głos domyślny';
    if (result.ok) {
      lastError = '';
      return true;
    }
    if (result.started || ['interrupted', 'canceled'].includes(result.err)) return false; // it was speaking and got cut off
    lastError = `${lastVoice}: ${result.err}`;
  }
  return false;
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
  const myRun = ++runId;
  const preferTts = prefs.voice === 'claude' || (prefs.voice === 'auto' && (long || !webOk()));
  setState('speaking');
  try {
    if (tts && (preferTts || !webOk())) {
      const what = texts.length === 1 ? texts[0].slice(0, 2000) : texts.map((text) => ({ text: text.slice(0, 2000) }));
      const result = await ttsSpeak(what, Math.min(1.5, Math.max(0.7, rate)));
      if (result !== 'failed' || !webOk() || myRun !== runId) return;
    }
    if (webOk()) for (const text of texts) if (!(await webSpeak(text, rate, myRun))) break;
  } finally {
    if (myRun === runId) setState('idle');
    else notify();
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
      synth()?.addEventListener?.('voiceschanged', notify);
    } catch {
      /* no browser voices */
    }
    cap('tts').then((ns) => {
      tts = ns;
      notify();
    });
  },
  setPrefs(next) {
    prefs = { accent: next?.accent ?? 'en-GB', voice: next?.voice ?? 'auto', voiceName: next?.voiceName ?? '', rate: Number(next?.speechRate) || 0.9 };
  },
  available,
  hasClaudeVoice: () => !!tts && !blocked,
  /** English voices this device offers, best first: [{name, lang}] (empty when the browser lists none). */
  voices: () => rankVoices(allVoices(), prefs.accent).map((v) => ({ name: v.name, lang: v.lang })),
  /** '' when speech can work; otherwise 'blocked', 'no-api' or 'no-english-voice'. */
  problem: () => (blocked ? 'blocked' : tts ? '' : webProblem()),
  /** What this device offers, for the Settings screen. */
  diagnostics() {
    const all = allVoices();
    const ranked = rankVoices(all, prefs.accent);
    const chosen = (prefs.voiceName && ranked.find((v) => v.name === prefs.voiceName)) || ranked[0] || null;
    return { api: hasApi(), voices: all.length, english: ranked.length, chosen: chosen ? `${chosen.name} (${String(chosen.lang).replace('_', '-')})` : '', claudeVoice: !!tts && !blocked, lastVoice, lastError };
  },
  speak: (text, opts) => run([text], opts),
  speakLines: (lines, opts) => run(lines, { long: true, ...opts }),
  stop() {
    runId++;
    try {
      synth()?.cancel();
    } catch {
      /* nothing playing */
    }
    tts?.stop?.().catch?.(() => {});
    setState('idle');
  },
  onState(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export default audio;
