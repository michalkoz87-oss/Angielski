// ui.js — DOM helpers and the shared component kit. Owner: SHELL.
//
// Every helper returns a real DOM node (never an HTML string) and never uses innerHTML,
// so dynamic and user text is always safe. Class names are documented at the top of
// css/app.css; `#kit` in the running app shows every component once.
//
// QUICK REFERENCE
// ---------------------------------------------------------------------------------------
// DOM
//   h(tag, props?, ...children)        element builder. props: class (string|array), dataset {},
//                                      style {} (incl. --custom), onClick/onInput/… listeners,
//                                      DOM properties (value, checked, disabled, hidden, …),
//                                      anything else becomes an attribute (aria-*, role, lang, …).
//                                      children: strings, numbers, nodes, arrays; null/false skipped.
//   mount(root, ...nodes)              replace the children of root
//   icon(name, {size=20, label})       inline SVG; names in ICON_NAMES
//   en(text, tag='span')               English learning content: serif + lang="en"
//   md(text)                           **bold** and *italic* only → DocumentFragment
//   markedText(text, {onWord, lookup, tag, class})
//                                      {{surface}} → highlighted <mark>; {{surface|id}} → tappable
//                                      highlight opening the gloss popover. onWord(id, el, item)
//                                      runs first; return false to suppress the popover.
//   announce(text)                     say something to screen readers (polite live region)
// Text
//   plural(n, one, few, many)          Polish plural form only: plural(3,'słowo','słowa','słów') → 'słowa'
//   count(n, one, few, many)           '3 słowa'
//   fmtDate(key, style)                style: 'short' 24 lis | 'day' pon. 24 lis | 'long' poniedziałek,
//                                      24 listopada | 'full' 24 listopada 2026 | 'weekday' poniedziałek |
//                                      'month' listopad 2026 | 'rel' dziś / jutro / wczoraj / za 3 dni / 2 dni temu
//   fmtMinutes(min)                    '45 min' | '1 godz. 5 min'
//   stepIcon(stepKey)                  icon name for review, learn, reading, …
// Layout
//   page({wide, class}, ...children)   the page column every routed view starts with
//   pageHeader({title, eyebrow, sub, actions})
//   section({title, aside, level}, ...children), sectionHeading(text, {aside, level})
//   activityLayout({bar})              → {el, body}: frame for the #nauka host
//   activityBar({title, steps, onClose, closeLabel, aside})  → el, with el.update({title, steps, aside})
//                                      steps: [{key, label, state:'done'|'current'|'todo'}]
//   actionBar(...buttons)              sticky bottom bar for the main button(s) of an exercise
// Actions
//   button({label, kind='secondary', icon, iconRight, onClick, disabled, size, block, type, id, ariaLabel, title})
//                                      kind: 'primary'|'secondary'|'ghost'|'danger'; size: 'sm'|'lg';
//                                      no label + icon → icon-only button (ariaLabel required)
//   setLoading(btn, on, label?)        spinner + aria-busy, blocks clicks
//   linkButton({label, href, external, kind, icon})   an <a> that looks like a button
//   speakButton(text, {rate, long, lang, label, size, showLabel})   hidden while audio is unavailable
//   chip({label, pressed, onClick, en, disabled})     toggle chip (aria-pressed) or static when no onClick
// Forms
//   field({label, hint, error, control})   label + control + hint; wires for/id and aria-describedby
//   textInput({id, value, placeholder, type, english, onInput, onEnter, …})
//   textArea({id, value, rows, english, onInput, …})
//   select({id, value, options:[{value,label}], onChange})
//   segmented({id, label, value, options:[{value,label}], onChange, block})
//   checkbox({id, label, hint, checked, onChange})
//   toggle({id, label, hint, checked, onChange})
// Content
//   card({flash, sunken, class}, ...children)
//   list(...rows), listRow({lead, title, sub, trail, onClick, href, chevron, state, id})
//   badge(text, tone)                  tone: 'neutral'|'accent'|'ok'|'bad'|'warn'
//   levelTag(level)                    'B2' | 'C1'
//   dictEntry(item, {size, speak, def, example, extras, headingLevel})   size: 'compact'|'md'|'lg'
//   disclosure({summary, open, onToggle}, ...children)
//   stat({value, unit, label})
//   brand()                            the wordmark
//   kbd(key)
// Feedback
//   banner({kind, title, body, action, live})   kind: 'correct'|'wrong'|'info'|'warn'
//   feedbackSlot()                     aria-live container: slot.show(bannerOpts | node), slot.clear()
//   progressBar(pct, {label, tone, thin}), progressRing(pct, size=56, {label, tone, stroke})
//   toast(msg, kind)                   kind: 'info'|'ok'|'bad'
//   emptyState({icon, title, body, action, center})
//   skeleton({lines=3, title, block}), loading(label)
//   syncIndicator({label=true})
// Overlays
//   dialog({title, body, actions:[{label, kind, value, autofocus}], dismissable, wide})
//                                      → Promise<value|null>, with .el and .close(value)
//   confirmDialog({title, body, confirmLabel, cancelLabel, danger})   → Promise<boolean>
//   sheet({content, anchor, label, onClose})   bottom sheet on phones, anchored popover otherwise → {el, close()}
//   glossPopover(anchor, item, {surface})      the word gloss (term, IPA, Polish, speaker)

import * as platformNs from './platform.js';
import * as storeNs from './store.js';
import * as contentNs from './content.js';
import * as audioNs from './audio.js';

const store = storeNs.store ?? storeNs.default ?? storeNs;
const audio = audioNs.audio ?? audioNs.default ?? audioNs;

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'title', 'text', 'tspan', 'defs', 'ellipse']);
const DOM_PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'open', 'indeterminate', 'readOnly', 'required', 'multiple', 'tabIndex', 'htmlFor', 'id', 'textContent', 'noValidate']);
const FORBIDDEN_PROPS = new Set(['innerHTML', 'outerHTML', 'html']);

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

// ------------------------------------------------------------------------------------ DOM

function appendChildren(el, children) {
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

export function h(tag, props, ...children) {
  // h('p', 'text') and h('p', node) are allowed: props may be omitted.
  if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  const isSvg = SVG_TAGS.has(tag) && tag !== 'title';
  const el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (FORBIDDEN_PROPS.has(key)) throw new Error(`ui.h: "${key}" is not allowed; build nodes instead`);
      if (key === 'class' || key === 'className') {
        const cls = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
        if (cls) el.setAttribute('class', cls);
      } else if (key === 'dataset') {
        for (const [k, v] of Object.entries(value)) if (v != null) el.dataset[k] = String(v);
      } else if (key === 'style' && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          if (v == null) continue;
          if (k.startsWith('--')) el.style.setProperty(k, String(v));
          else el.style[k] = v;
        }
      } else if (key.length > 2 && key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (!isSvg && DOM_PROPS.has(key)) {
        el[key] = value;
      } else if (key === 'for') {
        el.setAttribute('for', String(value));
      } else {
        el.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }
  appendChildren(el, children);
  return el;
}

export function mount(root, ...nodes) {
  const frag = document.createDocumentFragment();
  appendChildren(frag, nodes);
  root.replaceChildren(frag);
  return nodes.length === 1 ? nodes[0] : nodes;
}

// Icons: 24px grid, stroked with currentColor. Compact shape list per icon:
// p = path d | l = line x1 y1 x2 y2 | c = circle cx cy r | r = rect x y w h rx | pl = polyline | pg = polygon
const ICONS = {
  home: 'p:M3 9.5 12 3l9 6.5V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z;pl:9 22 9 12 15 12 15 22',
  calendar: 'r:3 4 18 18 2;l:16 2 16 6;l:8 2 8 6;l:3 10 21 10',
  book: 'p:M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z;p:M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z',
  chart: 'l:18 20 18 10;l:12 20 12 4;l:6 20 6 14',
  gear: 'c:12 12 3;p:M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z',
  play: 'pg:6 3 20 12 6 21 6 3',
  pause: 'r:6 4 4 16 1;r:14 4 4 16 1',
  stop: 'r:5 5 14 14 2',
  speaker: 'pg:11 5 6 9 2 9 2 15 6 15 11 19 11 5;p:M15.54 8.46a5 5 0 0 1 0 7.07;p:M19.07 4.93a10 10 0 0 1 0 14.14',
  check: 'pl:20 6 9 17 4 12',
  x: 'l:18 6 6 18;l:6 6 18 18',
  'chevron-left': 'pl:15 18 9 12 15 6',
  'chevron-right': 'pl:9 18 15 12 9 6',
  'chevron-down': 'pl:6 9 12 15 18 9',
  'chevron-up': 'pl:18 15 12 9 6 15',
  'arrow-right': 'l:5 12 19 12;pl:12 5 19 12 12 19',
  'arrow-left': 'l:19 12 5 12;pl:12 19 5 12 12 5',
  flame: 'p:M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z',
  clock: 'c:12 12 10;pl:12 6 12 12 16 14',
  sparkle: 'p:M12 3l1.8 5.6a2 2 0 0 0 1.3 1.3L21 12l-5.9 2.1a2 2 0 0 0-1.3 1.3L12 21l-1.8-5.6a2 2 0 0 0-1.3-1.3L3 12l5.9-2.1a2 2 0 0 0 1.3-1.3z',
  pencil: 'p:M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z',
  mic: 'p:M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z;p:M19 10v2a7 7 0 0 1-14 0v-2;l:12 19 12 22;l:8 22 16 22',
  headphones: 'p:M3 18v-6a9 9 0 0 1 18 0v6;p:M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z;p:M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z',
  refresh: 'pl:23 4 23 10 17 10;pl:1 20 1 14 7 14;p:M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  info: 'c:12 12 10;l:12 16 12 12;l:12 8 12.01 8',
  alert: 'p:M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z;l:12 9 12 13;l:12 17 12.01 17',
  download: 'p:M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4;pl:7 10 12 15 17 10;l:12 15 12 3',
  upload: 'p:M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4;pl:17 8 12 3 7 8;l:12 3 12 15',
  search: 'c:11 11 8;l:21 21 16.65 16.65',
  external: 'p:M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6;pl:15 3 21 3 21 9;l:10 14 21 3',
  plus: 'l:12 5 12 19;l:5 12 19 12',
  minus: 'l:5 12 19 12',
  trash: 'pl:3 6 5 6 21 6;p:M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2;l:10 11 10 17;l:14 11 14 17',
  eye: 'p:M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z;c:12 12 3',
  'eye-off': 'p:M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24;l:1 1 23 23',
  cloud: 'p:M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
  'cloud-off': 'p:M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3;l:1 1 23 23',
  skip: 'pg:5 4 15 12 5 20 5 4;l:19 5 19 19',
  target: 'c:12 12 10;c:12 12 6;c:12 12 2',
  list: 'l:8 6 21 6;l:8 12 21 12;l:8 18 21 18;l:3 6 3.01 6;l:3 12 3.01 12;l:3 18 3.01 18',
  text: 'l:3 6 21 6;l:3 10 17 10;l:3 14 21 14;l:3 18 15 18',
  layers: 'pg:12 2 2 7 12 12 22 7 12 2;pl:2 17 12 22 22 17;pl:2 12 12 17 22 12',
  'check-square': 'pl:9 11 12 14 22 4;p:M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  globe: 'c:12 12 10;l:2 12 22 12;p:M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  message: 'p:M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  send: 'l:22 2 11 13;pg:22 2 15 22 11 13 2 9 22 2',
  filter: 'pg:22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3',
};
const SOLID_ICONS = new Set(['play', 'pause', 'stop']);

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

function shape(spec) {
  const split = spec.indexOf(':');
  const kind = spec.slice(0, split);
  const data = spec.slice(split + 1);
  const n = data.split(' ');
  switch (kind) {
    case 'p': return h('path', { d: data });
    case 'l': return h('line', { x1: n[0], y1: n[1], x2: n[2], y2: n[3] });
    case 'c': return h('circle', { cx: n[0], cy: n[1], r: n[2] });
    case 'r': return h('rect', { x: n[0], y: n[1], width: n[2], height: n[3], rx: n[4] ?? 0 });
    case 'pl': return h('polyline', { points: data });
    case 'pg': return h('polygon', { points: data });
    default: return null;
  }
}

export function icon(name, opts = {}) {
  const { size = 20, label } = opts;
  const spec = ICONS[name] ?? ICONS.info;
  const svg = h('svg', {
    class: ['icon', `icon--${name}`, SOLID_ICONS.has(name) && 'icon--solid'],
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    focusable: 'false',
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }),
  });
  for (const part of spec.split(';')) {
    const node = shape(part);
    if (node) svg.appendChild(node);
  }
  return svg;
}

export function en(text, tag = 'span', props = {}) {
  return h(tag, { ...props, class: ['en', props.class], lang: 'en' }, text);
}

/** `**bold**` and `*italic*` only; everything else stays text. Newlines become line breaks. */
export function md(text) {
  const frag = document.createDocumentFragment();
  const src = String(text ?? '');
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g;
  const pushText = (s) => {
    const lines = s.split('\n');
    lines.forEach((line, i) => {
      if (i > 0) frag.appendChild(document.createElement('br'));
      if (line) frag.appendChild(document.createTextNode(line));
    });
  };
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) pushText(src.slice(last, m.index));
    frag.appendChild(m[1] != null ? h('strong', null, m[1]) : h('em', null, m[2]));
    last = m.index + m[0].length;
  }
  if (last < src.length) pushText(src.slice(last));
  return frag;
}

let liveEl = null;
/** Polite announcement for screen readers (toasts and banners use it). */
export function announce(text) {
  if (!liveEl || !liveEl.isConnected) {
    liveEl = h('div', { class: 'sr-only', id: 'ui-live', 'aria-live': 'polite', 'aria-atomic': 'true' });
    document.body.appendChild(liveEl);
  }
  liveEl.textContent = '';
  // A fresh text node after a tick is what makes screen readers re-announce the same message.
  setTimeout(() => { if (liveEl) liveEl.textContent = String(text ?? ''); }, 60);
}

// ------------------------------------------------------------------------------------ text

export function plural(n, one, few, many) {
  const abs = Math.abs(Number(n) || 0);
  if (!Number.isInteger(abs)) return few;
  if (abs === 1) return one;
  const d = abs % 10;
  const dd = abs % 100;
  if (d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14)) return few;
  return many;
}

export function count(n, one, few, many) {
  return `${n} ${plural(n, one, few, many)}`;
}

const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const MONTHS_NOM = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const WEEKDAYS = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
const WEEKDAYS_SHORT = ['pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.', 'niedz.'];

function parseKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const utc = Date.UTC(y, mo - 1, d);
  const dt = new Date(utc);
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, mo, d, dayNumber: Math.round(utc / 86400000), weekday: (dt.getUTCDay() + 6) % 7 };
}

function localTodayKey() {
  if (typeof platformNs.todayKey === 'function') return platformNs.todayKey();
  const now = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function fmtDate(key, style = 'short') {
  const t = parseKey(key);
  if (!t) return '';
  switch (style) {
    case 'day': return `${WEEKDAYS_SHORT[t.weekday]} ${t.d} ${MONTHS_SHORT[t.mo - 1]}`;
    case 'long': return `${WEEKDAYS[t.weekday]}, ${t.d} ${MONTHS_GEN[t.mo - 1]}`;
    case 'full': return `${t.d} ${MONTHS_GEN[t.mo - 1]} ${t.y}`;
    case 'weekday': return WEEKDAYS[t.weekday];
    case 'month': return `${MONTHS_NOM[t.mo - 1]} ${t.y}`;
    case 'rel': {
      const today = parseKey(localTodayKey());
      const diff = today ? t.dayNumber - today.dayNumber : NaN;
      if (diff === 0) return 'dziś';
      if (diff === 1) return 'jutro';
      if (diff === -1) return 'wczoraj';
      if (diff > 1 && diff <= 14) return `za ${diff} dni`;
      if (diff < -1 && diff >= -14) return `${-diff} dni temu`;
      return `${t.d} ${MONTHS_SHORT[t.mo - 1]}`;
    }
    case 'short':
    default: return `${t.d} ${MONTHS_SHORT[t.mo - 1]}`;
  }
}

export function fmtMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (total < 60) return `${total} min`;
  const hrs = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hrs} godz. ${rest} min` : `${hrs} godz.`;
}

const STEP_ICONS = {
  review: 'refresh', learn: 'book', reading: 'text', grammar: 'layers', listening: 'headphones',
  writing: 'pencil', practice: 'target', speaking: 'mic', test: 'check-square', input: 'globe',
};
export function stepIcon(stepKey) {
  return STEP_ICONS[stepKey] ?? 'info';
}

// ------------------------------------------------------------------------------------ layout

export function page(props, ...children) {
  if (props instanceof Node || typeof props === 'string' || Array.isArray(props)) { children.unshift(props); props = null; }
  const { wide, class: cls, ...rest } = props ?? {};
  return h('div', { ...rest, class: ['page', wide && 'page--wide', cls] }, children);
}

export function pageHeader({ title, eyebrow, sub, actions } = {}) {
  return h('header', { class: 'page-head' },
    eyebrow && h('p', { class: 'page-head__eyebrow' }, eyebrow),
    h('h1', { class: 'page-head__title' }, title),
    sub && h('p', { class: 'page-head__sub' }, sub),
    actions && h('div', { class: 'page-head__actions' }, actions));
}

export function sectionHeading(text, opts = {}) {
  const { aside, level = 2, id } = opts;
  return h('div', { class: 'section-head' },
    h(`h${level}`, { class: 'section-head__title', id }, text),
    aside != null && h('span', { class: 'section-head__aside' }, aside));
}

export function section(props, ...children) {
  const { title, aside, level, class: cls, ...rest } = props ?? {};
  const id = title ? nextId('sec') : null;
  return h('section', { ...rest, class: ['section', cls], 'aria-labelledby': id },
    title && sectionHeading(title, { aside, level, id }),
    children);
}

export function activityLayout({ bar } = {}) {
  const body = h('div', { class: 'activity__body' });
  const el = h('div', { class: 'activity' }, bar, body);
  return { el, body };
}

function renderDots(listEl, steps) {
  const items = (steps ?? []).map((s) => h('li', {
    class: ['dot', s.state === 'done' && 'dot--done', s.state === 'current' && 'dot--current'],
    title: s.label,
  }));
  listEl.replaceChildren(...items);
  const total = steps?.length ?? 0;
  const current = (steps ?? []).findIndex((s) => s.state === 'current');
  listEl.hidden = total < 2;
  return total > 1 && current >= 0 ? `Krok ${current + 1} z ${total}` : '';
}

export function activityBar(opts = {}) {
  const { onClose, closeLabel = 'Zamknij sesję' } = opts;
  const titleEl = h('h1', { class: 'actbar__title' });
  const srStep = h('span', { class: 'sr-only' });
  const dotsEl = h('ol', { class: 'dots', 'aria-hidden': 'true' });
  const asideEl = h('div', { class: 'actbar__aside' });
  const close = button({ kind: 'ghost', icon: 'x', ariaLabel: closeLabel, title: closeLabel, onClick: () => onClose?.(), id: 'activity-close' });
  close.classList.add('actbar__close');
  const el = h('header', { class: 'actbar' },
    h('div', { class: 'actbar__inner' }, close, h('div', { class: 'actbar__main' }, titleEl, srStep, dotsEl), asideEl));
  el.update = (next = {}) => {
    if ('title' in next) titleEl.textContent = next.title ?? '';
    if ('steps' in next) srStep.textContent = renderDots(dotsEl, next.steps);
    if ('aside' in next) {
      if (next.aside instanceof Node) asideEl.replaceChildren(next.aside);
      else asideEl.textContent = next.aside ?? '';
      asideEl.hidden = next.aside == null || next.aside === '';
    }
    return el;
  };
  el.update({ title: opts.title ?? '', steps: opts.steps ?? [], aside: opts.aside ?? null });
  return el;
}

export function actionBar(...buttons) {
  return h('div', { class: 'action-bar' }, buttons);
}

// ------------------------------------------------------------------------------------ actions

export function button(opts = {}) {
  const { label, kind = 'secondary', icon: iconName, iconRight, onClick, disabled = false, size, block, type = 'button', id, ariaLabel, title, class: cls } = opts;
  const iconOnly = !label && !!iconName;
  const btn = h('button', {
    type,
    id,
    title,
    disabled: !!disabled,
    class: ['btn', `btn--${kind}`, size && `btn--${size}`, block && 'btn--block', iconOnly && 'btn--icon', cls],
    'aria-label': ariaLabel ?? (iconOnly ? title : null),
  },
  iconName && icon(iconName, { size: size === 'sm' ? 16 : 20 }),
  label != null && label !== '' && h('span', { class: 'btn__label' }, label),
  iconRight && icon(iconRight, { size: size === 'sm' ? 16 : 20 }));
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

/** Loading state: spinner in front of the label, aria-busy, clicks blocked. Optional temporary label. */
export function setLoading(btn, on, label) {
  if (!btn) return;
  const labelEl = btn.querySelector('.btn__label');
  if (on) {
    if (btn.classList.contains('is-loading')) return;
    btn.classList.add('is-loading');
    btn.setAttribute('aria-busy', 'true');
    btn.dataset.wasDisabled = btn.disabled ? '1' : '';
    btn.disabled = true;
    const first = btn.querySelector('.icon');
    if (first) first.hidden = true;
    btn.prepend(h('span', { class: 'spinner', 'aria-hidden': 'true' }));
    if (label && labelEl) { btn.dataset.label = labelEl.textContent; labelEl.textContent = label; }
  } else {
    if (!btn.classList.contains('is-loading')) return;
    btn.classList.remove('is-loading');
    btn.removeAttribute('aria-busy');
    btn.disabled = btn.dataset.wasDisabled === '1';
    delete btn.dataset.wasDisabled;
    btn.querySelector('.spinner')?.remove();
    const first = btn.querySelector('.icon');
    if (first) first.hidden = false;
    if (btn.dataset.label != null && labelEl) { labelEl.textContent = btn.dataset.label; delete btn.dataset.label; }
  }
}

export function linkButton(opts = {}) {
  const { label, href, external = false, kind = 'secondary', icon: iconName, size, block, id, class: cls } = opts;
  return h('a', {
    href,
    id,
    class: ['btn', `btn--${kind}`, size && `btn--${size}`, block && 'btn--block', cls],
    ...(external ? { target: '_blank', rel: 'noopener' } : {}),
  },
  iconName && icon(iconName),
  h('span', { class: 'btn__label' }, label),
  external && icon('external', { size: 16, label: 'otwiera się w nowej karcie' }));
}

// Speaker buttons share one audio state: CSS hides them all while audio is unavailable
// (:root[data-audio="off"]), and only the button that started playback shows "stop".
let audioWatch = false;
let speakingBtn = null;

function audioAvailable() {
  try { return typeof audio.available === 'function' ? !!audio.available() : false; } catch { return false; }
}

function setSpeaking(btn) {
  if (speakingBtn && speakingBtn !== btn) markSpeaking(speakingBtn, false);
  speakingBtn = btn;
  if (btn) markSpeaking(btn, true);
}

function markSpeaking(btn, on) {
  btn.classList.toggle('is-speaking', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  const old = btn.querySelector('.icon');
  if (old) old.replaceWith(icon(on ? 'stop' : 'speaker', { size: btn.classList.contains('speak--sm') ? 16 : 20 }));
}

function ensureAudioWatch() {
  const root = document.documentElement;
  root.dataset.audio = audioAvailable() ? 'on' : 'off';
  if (audioWatch) return;
  audioWatch = true;
  try {
    audio.onState?.((state) => {
      root.dataset.audio = audioAvailable() ? 'on' : 'off';
      if (state !== 'speaking' && speakingBtn) { markSpeaking(speakingBtn, false); speakingBtn = null; }
    });
  } catch { /* audio module not ready: buttons stay hidden */ }
}

export function speakButton(text, opts = {}) {
  const { label = 'Posłuchaj', size, showLabel = false, rate, long, lang, id } = opts;
  ensureAudioWatch();
  const btn = h('button', {
    type: 'button',
    id,
    class: ['speak', size === 'sm' && 'speak--sm', showLabel && 'speak--label'],
    'aria-label': showLabel ? null : label,
    'aria-pressed': 'false',
    title: showLabel ? null : label,
  }, icon('speaker', { size: size === 'sm' ? 16 : 20 }), showLabel && h('span', null, label));
  btn.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (speakingBtn === btn) { audio.stop?.(); return; }
    const value = typeof text === 'function' ? text() : text;
    if (!value) return;
    setSpeaking(btn);
    try {
      const speakOpts = {};
      if (rate != null) speakOpts.rate = rate;
      if (long != null) speakOpts.long = long;
      if (lang != null) speakOpts.lang = lang;
      if (Array.isArray(value) && typeof audio.speakLines === 'function') await audio.speakLines(value, speakOpts);
      else await audio.speak(Array.isArray(value) ? value.join(' ') : value, speakOpts);
    } catch { /* audio.speak never throws by contract */ }
    if (speakingBtn === btn) { markSpeaking(btn, false); speakingBtn = null; }
    document.documentElement.dataset.audio = audioAvailable() ? 'on' : 'off';
  });
  return btn;
}

export function chip(opts = {}) {
  const { label, pressed = false, onClick, en: english = false, disabled = false, id } = opts;
  if (!onClick) return h('span', { class: ['chip', english && 'chip--en'], lang: english ? 'en' : null, id }, label);
  const btn = h('button', {
    type: 'button',
    id,
    class: ['chip', english && 'chip--en'],
    lang: english ? 'en' : null,
    disabled: !!disabled,
    'aria-pressed': pressed ? 'true' : 'false',
  }, label);
  btn.addEventListener('click', (event) => {
    const next = btn.getAttribute('aria-pressed') !== 'true';
    const result = onClick(next, event);
    if (result !== false) btn.setAttribute('aria-pressed', next ? 'true' : 'false');
  });
  return btn;
}

// ------------------------------------------------------------------------------------ forms

const ENGLISH_ATTRS = { autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', lang: 'en' };

export function field({ label, hint, error, control, id } = {}) {
  const target = control?.matches?.('input, select, textarea') ? control : control?.querySelector?.('input, select, textarea');
  const controlId = id ?? target?.id ?? nextId('f');
  if (target && !target.id) target.id = controlId;
  const hintId = hint ? `${controlId}-hint` : null;
  const errorId = `${controlId}-error`;
  const errorEl = h('p', { class: 'field__error', id: errorId, role: 'alert', hidden: !error }, error ?? '');
  if (target && (hintId || error)) target.setAttribute('aria-describedby', [hintId, error && errorId].filter(Boolean).join(' '));
  const el = h('div', { class: 'field' },
    label && h('label', { class: 'field__label', for: controlId }, label),
    control,
    hint && h('p', { class: 'field__hint', id: hintId }, hint),
    errorEl);
  el.setError = (message) => {
    errorEl.textContent = message ?? '';
    errorEl.hidden = !message;
    if (target) {
      if (message) target.setAttribute('aria-invalid', 'true'); else target.removeAttribute('aria-invalid');
      target.setAttribute('aria-describedby', [hintId, message && errorId].filter(Boolean).join(' '));
    }
  };
  return el;
}

export function textInput(opts = {}) {
  const { id, value = '', placeholder, type = 'text', english = false, onInput, onEnter, onChange, disabled, ariaLabel, name, inputmode, maxlength, min, max, step, class: cls } = opts;
  const input = h('input', {
    class: ['input', english && 'input--en', cls],
    id: id ?? nextId('in'),
    type,
    name,
    placeholder,
    inputmode,
    maxlength,
    min,
    max,
    step,
    disabled: !!disabled,
    'aria-label': ariaLabel,
    ...(english ? ENGLISH_ATTRS : {}),
  });
  input.value = value ?? '';
  if (onInput) input.addEventListener('input', () => onInput(input.value, input));
  if (onChange) input.addEventListener('change', () => onChange(input.value, input));
  if (onEnter) input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); onEnter(input.value, input); } });
  return input;
}

export function textArea(opts = {}) {
  const { id, value = '', placeholder, rows = 5, english = false, onInput, onChange, disabled, ariaLabel, name, maxlength, class: cls } = opts;
  const area = h('textarea', {
    class: ['input', 'input--area', english && 'input--en', cls],
    id: id ?? nextId('ta'),
    name,
    rows,
    placeholder,
    maxlength,
    disabled: !!disabled,
    'aria-label': ariaLabel,
    ...(english ? ENGLISH_ATTRS : {}),
  });
  area.value = value ?? '';
  if (onInput) area.addEventListener('input', () => onInput(area.value, area));
  if (onChange) area.addEventListener('change', () => onChange(area.value, area));
  return area;
}

export function select(opts = {}) {
  const { id, value, options = [], onChange, disabled, ariaLabel, name } = opts;
  const sel = h('select', { class: 'input', id: id ?? nextId('sel'), name, disabled: !!disabled, 'aria-label': ariaLabel },
    options.map((o) => {
      const opt = typeof o === 'object' ? o : { value: o, label: String(o) };
      return h('option', { value: String(opt.value), selected: String(opt.value) === String(value) }, opt.label ?? String(opt.value));
    }));
  if (onChange) sel.addEventListener('change', () => onChange(sel.value, sel));
  const wrap = h('span', { class: 'select' }, sel, h('span', { class: 'select__chev' }, icon('chevron-down', { size: 18 })));
  wrap.control = sel;
  return wrap;
}

/** Single choice from 2–4 short options (native radios underneath, so arrow keys work). */
export function segmented(opts = {}) {
  const { id, label, value, options = [], onChange, block = false, disabled } = opts;
  const name = id ?? nextId('seg');
  const el = h('fieldset', { class: ['seg', block && 'seg--block'], id: name, disabled: !!disabled },
    label && h('legend', { class: 'sr-only' }, label),
    options.map((o, i) => {
      const opt = typeof o === 'object' ? o : { value: o, label: String(o) };
      const input = h('input', { class: 'seg__input', type: 'radio', name, id: `${name}-${i}`, value: String(opt.value), checked: String(opt.value) === String(value) });
      input.addEventListener('change', () => { if (input.checked) onChange?.(opt.value, input); });
      return h('label', { class: 'seg__opt' }, input, h('span', { class: 'seg__label' }, opt.label ?? String(opt.value)));
    }));
  el.getValue = () => el.querySelector('input:checked')?.value ?? null;
  return el;
}

export function checkbox(opts = {}) {
  const { id, label, hint, checked = false, onChange, disabled, name } = opts;
  const input = h('input', { class: 'check__input', type: 'checkbox', id: id ?? nextId('chk'), name, checked: !!checked, disabled: !!disabled });
  if (onChange) input.addEventListener('change', () => onChange(input.checked, input));
  const el = h('label', { class: 'check' },
    input,
    h('span', { class: 'check__box', 'aria-hidden': 'true' }, icon('check', { size: 16 })),
    h('span', { class: 'check__text' }, label, hint && h('span', { class: 'check__hint' }, hint)));
  return el;
}

export function toggle(opts = {}) {
  const { id, label, hint, checked = false, onChange, disabled, name } = opts;
  const input = h('input', { class: 'switch__input', type: 'checkbox', role: 'switch', id: id ?? nextId('sw'), name, checked: !!checked, disabled: !!disabled });
  if (onChange) input.addEventListener('change', () => onChange(input.checked, input));
  const el = h('label', { class: 'switch' },
    h('span', { class: 'switch__text' }, label, hint && h('span', { class: 'switch__hint' }, hint)),
    input,
    h('span', { class: 'switch__track', 'aria-hidden': 'true' }));
  return el;
}

// ------------------------------------------------------------------------------------ content

export function card(props, ...children) {
  if (props instanceof Node || typeof props === 'string' || Array.isArray(props)) { children.unshift(props); props = null; }
  const { flash, sunken, class: cls, tag = 'div', ...rest } = props ?? {};
  return h(tag, { ...rest, class: ['card', flash && 'card--flash', sunken && 'card--sunken', cls] }, children);
}

export function list(...rows) {
  const items = rows.flat().filter(Boolean).map((row) => (row instanceof HTMLLIElement ? row : h('li', null, row)));
  return h('ul', { class: 'list' }, items);
}

export function listRow(opts = {}) {
  const { lead, title, sub, trail, onClick, href, external, chevron, state, id, class: cls } = opts;
  const leadNode = typeof lead === 'string' ? icon(lead) : lead;
  const content = [
    leadNode && h('span', { class: 'row__lead' }, leadNode),
    h('span', { class: 'row__body' },
      h('span', { class: 'row__title' }, title),
      sub != null && sub !== '' && h('span', { class: 'row__sub' }, sub)),
    (trail != null || chevron) && h('span', { class: 'row__trail' }, trail, chevron && icon('chevron-right', { size: 18 })),
  ];
  const classes = ['row', state && `is-${state}`, cls];
  if (href) return h('a', { class: classes, href, id, ...(external ? { target: '_blank', rel: 'noopener' } : {}) }, content);
  if (onClick) return h('button', { class: classes, type: 'button', id, onClick }, content);
  return h('div', { class: classes, id }, content);
}

export function badge(text, tone = 'neutral') {
  return h('span', { class: ['badge', tone && tone !== 'neutral' && `badge--${tone}`] }, text);
}

export function levelTag(level) {
  const value = String(level ?? '').toUpperCase();
  return h('span', { class: ['level', value === 'C1' && 'level--c1'], title: `Poziom ${value}` },
    h('span', { class: 'sr-only' }, 'poziom '), value);
}

const POS_LABELS = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', 'phr v': 'phrasal verb', phrase: 'phrase', idiom: 'idiom', prep: 'preposition', conj: 'conjunction' };

// {{surface}} / {{surface|id}} → [{text}] | [{text, mark:true, id?}]
function parseMarks(text) {
  const src = String(text ?? '');
  const out = [];
  const re = /\{\{([^{}|]+)(?:\|([^{}]+))?\}\}/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) out.push({ text: src.slice(last, m.index) });
    out.push({ text: m[1], mark: true, id: m[2]?.trim() || null });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out;
}

function lookupItem(id) {
  try { return typeof contentNs.itemById === 'function' ? contentNs.itemById(id) : null; } catch { return null; }
}

/**
 * Text with course markers. `{{surface}}` → <mark class="hl">; `{{surface|id}}` → a tappable highlight
 * that opens the gloss popover. Options: onWord(id, el, item) — called on tap, return false to keep the
 * popover closed; lookup(id) — custom item lookup (default content.itemById); tag/class for the wrapper;
 * interactive:false renders ids as plain marks.
 */
export function markedText(text, opts = {}) {
  const { onWord, lookup = lookupItem, tag = 'span', class: cls, interactive = true, lang = 'en' } = opts;
  const root = h(tag, { class: cls, lang });
  for (const part of parseMarks(text)) {
    if (!part.mark) { root.appendChild(document.createTextNode(part.text)); continue; }
    if (!part.id || !interactive) { root.appendChild(h('mark', { class: 'hl' }, part.text)); continue; }
    const word = h('span', {
      class: 'hl hl--tap',
      role: 'button',
      tabindex: '0',
      'aria-haspopup': 'dialog',
      dataset: { id: part.id },
    }, part.text);
    const open = () => {
      const item = lookup(part.id) ?? null;
      if (onWord?.(part.id, word, item) === false) return;
      glossPopover(word, item, { surface: part.text });
    };
    word.addEventListener('click', open);
    word.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    root.appendChild(word);
  }
  return root;
}

/**
 * Dictionary entry for a vocabulary item ({term, pos, level, ipa, pl, def, example, examplePl,
 * collocations, family, note}). size: 'compact' (list rows: head + Polish), 'md' (default), 'lg' (learn
 * screen). Flags (default true for md/lg): speak, def, example. extras:true adds collocations,
 * family and note. headingLevel: heading tag for the headword (default 3).
 */
export function dictEntry(item, opts = {}) {
  const size = opts.size ?? 'md';
  const compact = size === 'compact';
  const { speak = true, def = !compact, example = !compact, extras = false, headingLevel = 3, ipa = true, pl = true } = opts;
  const it = item ?? {};
  const head = h('div', { class: 'entry__head' },
    h(`h${headingLevel}`, { class: 'entry__term', lang: 'en' }, it.term ?? ''),
    it.pos && h('span', { class: 'entry__pos', lang: 'en', title: POS_LABELS[it.pos] ?? it.pos }, it.pos),
    it.level && levelTag(it.level));
  const speakBtn = speak && it.term ? speakButton(it.term, { label: `Posłuchaj: ${it.term}`, size: 'sm' }) : null;
  const ipaRow = (ipa && it.ipa) || speakBtn
    ? h('div', { class: 'entry__ipa-row' }, ipa && it.ipa && h('span', { class: 'ipa', lang: 'en' }, it.ipa), speakBtn)
    : null;
  const el = h('article', { class: ['entry', size !== 'md' && `entry--${size}`], dataset: { id: it.id } },
    head,
    ipaRow,
    pl && it.pl && h('p', { class: 'entry__pl' }, it.pl),
    def && it.def && h('p', { class: 'entry__def', lang: 'en' }, it.def),
    example && it.example && h('div', { class: 'entry__example' },
      markedText(it.example, { tag: 'p', class: 'entry__ex-en', interactive: false }),
      it.examplePl && h('p', { class: 'entry__ex-pl' }, it.examplePl)),
    extras && entryExtras(it));
  return el;
}

function entryExtras(it) {
  const blocks = [];
  if (it.collocations?.length) {
    blocks.push(h('div', { class: 'entry__extra' }, h('span', { class: 'label' }, 'Połączenia'),
      h('ul', { class: 'entry__extra-list', lang: 'en' }, it.collocations.map((c) => h('li', null, c)))));
  }
  if (it.family?.length) {
    blocks.push(h('div', { class: 'entry__extra' }, h('span', { class: 'label' }, 'Rodzina wyrazów'),
      h('ul', { class: 'entry__extra-list', lang: 'en' }, it.family.map((c) => h('li', null, c)))));
  }
  if (it.note) {
    blocks.push(h('div', { class: 'entry__extra' }, h('span', { class: 'label' }, 'Uwaga'), h('p', { class: 'entry__note' }, md(it.note))));
  }
  return blocks.length ? h('div', { class: 'entry__extras' }, blocks) : null;
}

export function disclosure(props, ...children) {
  const { summary, open = false, onToggle, id, class: cls } = props ?? {};
  const el = h('details', { class: ['disclosure', cls], id, open: !!open },
    h('summary', null, h('span', { class: 'disclosure__summary' }, summary), h('span', { class: 'disclosure__chev' }, icon('chevron-down', { size: 18 }))),
    h('div', { class: 'disclosure__body' }, children));
  if (onToggle) el.addEventListener('toggle', () => onToggle(el.open, el));
  return el;
}

export function stat({ value, unit, label } = {}) {
  return h('div', { class: 'stat' },
    h('span', { class: 'stat__value' }, value, unit && h('span', { class: 'stat__unit' }, unit)),
    h('span', { class: 'stat__label' }, label));
}

export function brand() {
  return h('span', { class: 'brand' }, 'Angielski ', h('mark', { class: 'hl' }, 'krok po kroku'));
}

export function kbd(key) {
  return h('kbd', { class: 'kbd' }, key);
}

// ------------------------------------------------------------------------------------ feedback

const BANNER_KINDS = {
  correct: { cls: 'ok', icon: 'check' },
  ok: { cls: 'ok', icon: 'check' },
  wrong: { cls: 'bad', icon: 'x' },
  bad: { cls: 'bad', icon: 'x' },
  info: { cls: 'info', icon: 'info' },
  warn: { cls: 'warn', icon: 'alert' },
};

/** Feedback banner. `live:false` when it is shown through feedbackSlot() (the slot is the live region). */
export function banner(opts = {}) {
  const { kind = 'info', title, body, action, live = true, icon: iconName } = opts;
  const def = BANNER_KINDS[kind] ?? BANNER_KINDS.info;
  const bodyNode = typeof body === 'string' ? h('p', { class: 'banner__body' }, body) : body && h('div', { class: 'banner__body' }, body);
  return h('div', { class: ['banner', `banner--${def.cls}`], role: live ? 'status' : null },
    h('span', { class: 'banner__icon' }, icon(iconName ?? def.icon)),
    h('div', { class: 'banner__main' }, title && h('p', { class: 'banner__title' }, title), bodyNode),
    action && h('div', { class: 'banner__action' }, action));
}

/** A live region for answer feedback: create it once per exercise, then slot.show(...) / slot.clear(). */
export function feedbackSlot(props = {}) {
  const el = h('div', { class: ['feedback', props.class], 'aria-live': 'polite', 'aria-atomic': 'true', id: props.id });
  el.show = (content) => {
    const node = content instanceof Node ? content : banner({ ...content, live: false });
    el.replaceChildren(node);
    return node;
  };
  el.clear = () => el.replaceChildren();
  return el;
}

const clampPct = (pct) => Math.min(100, Math.max(0, Number(pct) || 0));

export function progressBar(pct, opts = {}) {
  const { label = 'Postęp', tone, thin } = opts;
  const fill = h('div', { class: 'bar__fill' });
  const el = h('div', { class: ['bar', tone && `bar--${tone}`, thin && 'bar--thin'], role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
  el.set = (value) => {
    const v = clampPct(value);
    fill.style.width = `${v}%`;
    el.setAttribute('aria-valuenow', String(Math.round(v)));
  };
  el.set(pct);
  return el;
}

export function progressRing(pct, size = 56, opts = {}) {
  const { label, tone, stroke = Math.max(4, Math.round(size / 10)), ariaLabel } = opts;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const value = h('circle', { class: 'ring__value', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke, 'stroke-dasharray': c.toFixed(2) });
  const svg = h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true', focusable: 'false' },
    h('circle', { class: 'ring__track', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke }), value);
  const labelEl = h('span', { class: 'ring__label' });
  const el = h('span', { class: ['ring', tone && `ring--${tone}`], role: 'img' }, svg, labelEl);
  el.set = (next, nextLabel) => {
    const v = clampPct(next);
    value.setAttribute('stroke-dashoffset', (c * (1 - v / 100)).toFixed(2));
    value.style.visibility = v === 0 ? 'hidden' : '';
    const text = nextLabel === undefined ? (label === undefined ? `${Math.round(v)}%` : label) : nextLabel;
    labelEl.textContent = text ?? '';
    labelEl.hidden = text == null || text === '' || size < 40;
    el.setAttribute('aria-label', ariaLabel ?? `${Math.round(v)}%`);
  };
  el.set(pct);
  return el;
}

let toastRegion = null;
const TOAST_ICONS = { ok: 'check', bad: 'alert', info: 'info' };

export function toast(msg, kind = 'info', opts = {}) {
  if (!toastRegion || !toastRegion.isConnected) {
    toastRegion = h('div', { class: 'toasts', id: 'toasts', role: 'region', 'aria-label': 'Powiadomienia' });
    document.body.appendChild(toastRegion);
  }
  const duration = opts.duration ?? (kind === 'bad' ? 6000 : 3500);
  const el = h('div', { class: ['toast', `toast--${kind}`] }, icon(TOAST_ICONS[kind] ?? 'info', { size: 18 }), h('span', null, msg));
  const remove = () => { clearTimeout(timer); el.remove(); };
  const timer = setTimeout(remove, duration);
  el.addEventListener('click', remove);
  while (toastRegion.children.length >= 3) toastRegion.firstElementChild.remove();
  toastRegion.appendChild(el);
  announce(msg);
  return { el, dismiss: remove };
}

export function emptyState(opts = {}) {
  const { icon: iconName, title, body, action, center = false } = opts;
  return h('div', { class: ['empty', center && 'empty--center'] },
    iconName && h('span', { class: 'empty__icon' }, icon(iconName, { size: 28 })),
    title && h('h2', { class: 'empty__title' }, title),
    body && h('p', { class: 'empty__body' }, body),
    action && h('div', { class: 'empty__action' }, action));
}

export function skeleton(opts = {}) {
  const { lines = 3, title = false, block = false } = opts;
  const widths = ['100%', '92%', '78%', '96%', '64%'];
  return h('div', { class: 'stack', 'aria-hidden': 'true' },
    title && h('span', { class: 'skel skel--title' }),
    block && h('span', { class: 'skel skel--block' }),
    Array.from({ length: lines }, (_, i) => h('span', { class: 'skel', style: { width: widths[i % widths.length] } })));
}

export function loading(label = 'Wczytywanie…') {
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', null, label));
}

export const SYNC_LABELS = Object.freeze({
  local: 'Zapis w tej przeglądarce',
  connecting: 'Łączenie z kontem…',
  synced: 'Zsynchronizowano',
  saving: 'Zapisywanie…',
  offline: 'Brak połączenia, zapis lokalny',
});

function currentSyncStatus() {
  try { return typeof store.syncStatus === 'function' ? store.syncStatus() : 'local'; } catch { return 'local'; }
}

/** Dot (+ label) that follows store.syncStatus(). Unsubscribes itself once removed from the page. */
export function syncIndicator(opts = {}) {
  const { label = true } = opts;
  const text = h('span', { class: ['sync__label', !label && 'sr-only'] });
  const el = h('span', { class: 'sync', role: 'status' }, h('span', { class: 'sync__dot', 'aria-hidden': 'true' }), text);
  let wasConnected = false;
  let off = null;
  const apply = (status) => {
    if (el.isConnected) wasConnected = true;
    else if (wasConnected) { off?.(); off = null; return; }
    const s = SYNC_LABELS[status] ? status : 'local';
    el.dataset.status = s;
    text.textContent = SYNC_LABELS[s];
  };
  apply(currentSyncStatus());
  try { off = store.on?.('sync', (status) => apply(typeof status === 'string' ? status : currentSyncStatus())) ?? null; } catch { off = null; }
  return el;
}

// ------------------------------------------------------------------------------------ overlays

function openModal(dlg) {
  document.body.appendChild(dlg);
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}

/**
 * Modal dialog on the native <dialog> (focus is trapped and restored by the browser).
 * actions: [{label, kind, value, autofocus}] — each closes the dialog with its value.
 * Resolves with the chosen value, or null when dismissed (Esc / backdrop). The returned promise
 * also carries `.el` (the dialog) and `.close(value)`.
 */
export function dialog(opts = {}) {
  const { title, body, actions = [{ label: 'OK', kind: 'primary', value: true }], dismissable = true, id, class: cls } = opts;
  const titleId = nextId('dlg-title');
  const bodyNodes = (Array.isArray(body) ? body : [body]).filter((b) => b != null && b !== false).map((b) => (typeof b === 'string' ? h('p', null, b) : b));
  const dlg = h('dialog', { class: ['dialog', cls], id, 'aria-labelledby': title ? titleId : null });
  let settle;
  let done = false;
  const result = new Promise((resolve) => { settle = resolve; });
  const close = (value = null) => {
    if (done) return;
    done = true;
    if (dlg.open && typeof dlg.close === 'function') dlg.close();
    dlg.remove();
    settle(value);
  };
  const buttons = actions.map((a) => {
    const btn = button({ label: a.label, kind: a.kind ?? 'secondary', icon: a.icon, id: a.id, onClick: () => close(a.value) });
    if (a.autofocus) btn.setAttribute('autofocus', '');
    return btn;
  });
  dlg.appendChild(h('div', { class: 'dialog__box' },
    title && h('h2', { class: 'dialog__title', id: titleId }, title),
    bodyNodes.length > 0 && h('div', { class: 'dialog__body' }, bodyNodes),
    buttons.length > 0 && h('div', { class: 'dialog__actions' }, buttons)));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (dismissable) close(null); });
  dlg.addEventListener('close', () => close(null));
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', (e) => { if (dismissable && downOnBackdrop && e.target === dlg) close(null); });
  openModal(dlg);
  result.el = dlg;
  result.close = close;
  return result;
}

export function confirmDialog(opts = {}) {
  const { title, body, confirmLabel = 'Tak', cancelLabel = 'Anuluj', danger = false } = opts;
  return dialog({
    title,
    body,
    actions: [
      { label: cancelLabel, kind: 'secondary', value: false, autofocus: danger },
      { label: confirmLabel, kind: danger ? 'danger' : 'primary', value: true, autofocus: !danger },
    ],
  }).then((value) => value === true);
}

let openSheet = null;

/**
 * Small floating panel: a bottom sheet on phones (< 600px), a popover anchored to `anchor` otherwise.
 * Modal <dialog> underneath: Esc and a tap outside close it, focus returns to the anchor.
 */
export function sheet(opts = {}) {
  const { content, anchor, label, onClose, class: cls } = opts;
  openSheet?.close();
  const bottom = window.innerWidth < 600 || !anchor;
  const dlg = h('dialog', { class: ['sheet', bottom && 'sheet--bottom', cls], 'aria-label': label ?? 'Szczegóły' });
  let closed = false;
  const onScroll = (e) => { if (!(e.target instanceof Node && dlg.contains(e.target))) close(); };
  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', onScroll, true);
    if (dlg.open && typeof dlg.close === 'function') dlg.close();
    dlg.remove();
    if (openSheet === handle) openSheet = null;
    try { anchor?.focus?.({ preventScroll: true }); } catch { /* anchor is gone */ }
    onClose?.();
  };
  const closeBtn = button({ kind: 'ghost', icon: 'x', size: 'sm', ariaLabel: 'Zamknij', onClick: close });
  closeBtn.classList.add('sheet__close');
  dlg.appendChild(h('div', { class: 'sheet__box' }, content, closeBtn));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('close', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  const handle = { el: dlg, close };
  openSheet = handle;
  openModal(dlg);
  if (!bottom) {
    const a = anchor.getBoundingClientRect();
    const d = dlg.getBoundingClientRect();
    const margin = 12;
    const left = Math.min(Math.max(margin, a.left + a.width / 2 - d.width / 2), window.innerWidth - d.width - margin);
    const below = a.bottom + 8;
    const top = below + d.height + margin <= window.innerHeight ? below : Math.max(margin, a.top - d.height - 8);
    dlg.style.left = `${Math.round(left)}px`;
    dlg.style.top = `${Math.round(top)}px`;
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
  }
  return handle;
}

/** The word gloss: headword, part of speech, level, IPA, speaker, Polish. `item` may be null (unknown id). */
export function glossPopover(anchor, item, opts = {}) {
  const content = item
    ? dictEntry(item, { size: 'md', example: false, def: opts.def ?? true, headingLevel: 2 })
    : h('div', { class: 'entry' },
      h('h2', { class: 'entry__term', lang: 'en' }, opts.surface ?? ''),
      h('p', { class: 'muted small' }, 'Tego hasła nie ma jeszcze w słowniku.'));
  return sheet({ content, anchor, label: item?.term ? `Hasło: ${item.term}` : 'Hasło' });
}
