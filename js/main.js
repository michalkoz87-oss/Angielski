// main.js — boot, hash router, navigation chrome. Owner: SHELL.
//
// Routes are plain hash names (the Artifact host passes nothing else): #dzis, #plan, #slownik,
// #postepy, #ustawienia, #nauka (activity; its parameters live in memory only) and the hidden
// developer route #kit. Views export `render(root, ctx)` and may return a cleanup function.
//   ctx = { route, params, navigate(name, params?), rerender() }
// A view is rendered on a route change and, debounced, when the store reports a change that came
// from another device — except #nauka, which is never re-rendered from outside.

import * as ui from './core/ui.js';
import * as storeNs from './core/store.js';
import * as modelNs from './core/model.js';
import * as audioNs from './core/audio.js';
import * as aiNs from './core/ai.js';
import * as profiles from './views/profiles.js';
import * as level from './views/level.js';
import * as onboarding from './views/onboarding.js';
import * as today from './views/today.js';
import * as session from './views/session.js';
import * as plan from './views/plan.js';
import * as dictionary from './views/dictionary.js';
import * as progress from './views/progress.js';
import * as settings from './views/settings.js';

const store = storeNs.store ?? storeNs.default ?? storeNs;
const model = modelNs;
const audio = audioNs.audio ?? audioNs.default ?? audioNs;
const ai = aiNs.ai ?? aiNs.default ?? aiNs;

const { h, icon } = ui;

const HOME = 'dzis';
const ROUTES = {
  dzis: { view: today, title: 'Dziś' },
  plan: { view: plan, title: 'Plan' },
  slownik: { view: dictionary, title: 'Słownik' },
  postepy: { view: progress, title: 'Postępy' },
  ustawienia: { view: settings, title: 'Ustawienia' },
  nauka: { view: session, title: 'Sesja', chrome: 'none', needsParams: true },
};
const TABS = [
  { route: 'dzis', label: 'Dziś', icon: 'home' },
  { route: 'plan', label: 'Plan', icon: 'calendar' },
  { route: 'slownik', label: 'Słownik', icon: 'book' },
  { route: 'postepy', label: 'Postępy', icon: 'chart' },
  { route: 'ustawienia', label: 'Ustawienia', icon: 'gear' },
];
const APP_TITLE = 'Angielski krok po kroku';

let appEl = null;
let viewEl = null;
let navEl = null;
let navDot = null;
let booted = false;
let cleanup = null;
let shown = null;          // { name, onboarding } of what is on screen
let params = {};           // parameters of the current route (memory only)
let pendingParams = null;  // set by navigate(), consumed by the next render
let remoteTimer = null;
let renderSeq = 0;

// ------------------------------------------------------------------------------------ public API

/** Go to a route. `routeParams` stay in memory (never in the URL) and reach the view as ctx.params. */
export function navigate(name, routeParams) {
  const target = ROUTES[name] ? name : HOME;
  pendingParams = routeParams ? { ...routeParams } : {};
  if (hashName() === target) renderRoute({ userInitiated: true });
  else location.hash = `#${target}`;   // → hashchange → renderRoute
}

export function currentParams() {
  return params;
}

export function currentRoute() {
  return shown?.name ?? null;
}

// ------------------------------------------------------------------------------------ helpers

function hashName() {
  return decodeURIComponent(location.hash.replace(/^#/, '')).trim();
}

function safe(fn, fallback) {
  try { return fn(); } catch (err) { console.error(err); return fallback; }
}

// Before the routed app there are up to three gates: who is learning, which level, the plan.
function gate() {
  return safe(() => {
    if (!model.activeProfileId()) return { name: 'profiles', view: profiles };
    if (!model.courseId()) return { name: 'level', view: level };
    if (!model.isOnboarded()) return { name: 'onboarding', view: onboarding };
    return null;
  }, null);
}

// ------------------------------------------------------------------------------------ chrome

function buildChrome() {
  appEl = document.getElementById('app');
  if (!appEl) {
    appEl = h('div', { id: 'app', class: 'app' });
    document.body.appendChild(appEl);
  }
  appEl.dataset.chrome = 'none';
  viewEl = h('main', { class: 'view', id: 'view', tabindex: '-1' });

  const skip = ui.button({ label: 'Przejdź do treści', kind: 'primary', size: 'sm', id: 'skip-link', onClick: () => viewEl.focus() });
  skip.classList.add('skip-link');

  navDot = h('span', { class: 'nav__dot', dataset: { status: 'local' } });
  const items = TABS.map((tab) => h('li', null,
    h('a', { class: 'nav__item', href: `#${tab.route}`, id: `nav-${tab.route}`, dataset: { route: tab.route } },
      h('span', { class: 'nav__icon' }, icon(tab.icon, { size: 22 }), tab.route === 'ustawienia' && navDot),
      h('span', { class: 'nav__label' }, tab.label))));
  navEl = h('nav', { class: 'nav', id: 'nav', 'aria-label': 'Główna nawigacja' },
    h('a', { class: 'nav__brand', href: `#${HOME}`, 'aria-label': `${APP_TITLE}: strona główna` }, ui.brand()),
    h('ul', { class: 'nav__list' }, items),
    h('div', { class: 'nav__foot' }, ui.syncIndicator({ label: true })));

  // A tap on the tab that is already open scrolls back to the top (no hashchange fires for it).
  navEl.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href^="#"]');
    if (link && link.getAttribute('href') === `#${shown?.name}`) window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  ui.mount(appEl, skip, navEl, viewEl);
}

function setChrome(mode, routeName) {
  appEl.dataset.chrome = mode;
  appEl.dataset.route = routeName;
  for (const link of navEl.querySelectorAll('.nav__item')) {
    if (link.dataset.route === routeName) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function updateSyncDot(status) {
  if (!navDot) return;
  const value = typeof status === 'string' ? status : safe(() => store.syncStatus?.(), 'local');
  navDot.dataset.status = value ?? 'local';
}

// ------------------------------------------------------------------------------------ rendering

function teardown() {
  const fn = cleanup;
  cleanup = null;
  if (typeof fn === 'function') safe(fn);
}

function showError(err, retry) {
  console.error(err);
  ui.mount(viewEl, ui.page(null,
    ui.emptyState({
      icon: 'alert',
      title: 'Coś poszło nie tak',
      body: 'Nie udało się wyświetlić tego ekranu. Twoje postępy są bezpieczne.',
      action: ui.button({ label: 'Spróbuj ponownie', kind: 'primary', icon: 'refresh', onClick: retry }),
    })));
}

function mountView(view, ctx) {
  teardown();
  const seq = ++renderSeq;
  const retry = () => renderRoute({ userInitiated: true });
  viewEl.replaceChildren();
  try {
    const result = view.render(viewEl, ctx);
    // A view may navigate while rendering; then a newer render owns the screen and this result is stale.
    const stale = () => seq !== renderSeq;
    if (typeof result === 'function') {
      if (stale()) safe(result); else cleanup = result;
    } else if (result && typeof result.then === 'function') {
      result.then((fn) => {
        if (typeof fn !== 'function') return;
        if (stale()) safe(fn); else cleanup = fn;
      }, (err) => { if (!stale()) showError(err, retry); });
    }
  } catch (err) {
    if (seq === renderSeq) showError(err, retry);
    else console.error(err);
  }
}

function renderRoute({ userInitiated = false, keepScroll = false } = {}) {
  if (!booted) return;
  let name = hashName();
  const known = !!ROUTES[name];
  if (!known) name = HOME;
  const route = ROUTES[name];

  // Until a learner, a level and a plan are chosen every route shows the matching gate screen.
  const g = gate();
  if (g) {
    const gateParams = pendingParams ?? {};
    pendingParams = null;
    params = {};
    shown = { name: g.name, onboarding: true };
    setChrome('none', g.name);
    document.title = APP_TITLE;
    mountView(g.view, { route: g.name, params: gateParams, navigate, rerender: () => renderRoute({ keepScroll: true }) });
    window.scrollTo(0, 0);
    return;
  }

  const nextParams = pendingParams ?? (userInitiated && shown?.name === name ? params : {});
  pendingParams = null;

  // The activity cannot be rebuilt from the URL: without parameters (reload, shared link) go home.
  if (route.needsParams && Object.keys(nextParams).length === 0) {
    location.hash = `#${HOME}`;
    return;
  }

  params = nextParams;
  shown = { name, onboarding: false };
  setChrome(route.chrome ?? 'nav', name);
  document.title = name === HOME ? APP_TITLE : `${route.title} · ${APP_TITLE}`;
  mountView(route.view, { route: name, params, navigate, rerender: () => renderRoute({ keepScroll: true, userInitiated: true }) });
  if (!keepScroll) window.scrollTo(0, 0);
  if (userInitiated && !keepScroll) viewEl.focus({ preventScroll: true });
}

function onHashChange() {
  renderRoute({ userInitiated: true });
}

function onStoreChange(event) {
  if (!booted || event?.source !== 'remote') return;
  clearTimeout(remoteTimer);
  remoteTimer = setTimeout(() => {
    if (!shown) return;
    if (shown.onboarding) {
      // Another device may have added learners or finished the set-up: refresh the gate when nobody is typing.
      const el = document.activeElement;
      if (el && viewEl.contains(el) && el.matches('input, textarea, select')) return;
      safe(() => { if (!model.activeProfileId()) model.boot(); });
      renderRoute();
      return;
    }
    if (shown.name === 'nauka') return;            // never rebuild an exercise in progress
    if (document.querySelector('dialog[open]')) return; // nor a screen with an open dialog
    const active = document.activeElement;
    if (active && viewEl.contains(active) && active.matches('input, textarea, select')) return; // nor while typing
    pendingParams = params;
    renderRoute({ keepScroll: true });
  }, 400);
}

// ------------------------------------------------------------------------------------ boot

async function boot() {
  document.documentElement.lang = 'pl';
  buildChrome();
  ui.mount(viewEl, ui.page(null, ui.loading('Wczytywanie…')));

  try {
    await store.init?.();
  } catch (err) {
    console.error(err); // storage unavailable: the app still renders, nothing is saved
  }

  // Capabilities light up later; never block the first render on them.
  Promise.resolve().then(() => audio.init?.()).catch((err) => console.error(err));
  Promise.resolve().then(() => ai.init?.()).catch((err) => console.error(err));

  safe(() => model.boot());
  const syncPrefs = () => safe(() => audio.setPrefs?.(model.getProfile()));
  safe(() => model.onScope(() => { syncPrefs(); if (booted) renderRoute({ userInitiated: true }); }));
  syncPrefs();
  safe(() => store.on?.('change', onStoreChange));
  safe(() => store.on?.('sync', updateSyncDot));
  updateSyncDot();

  booted = true;
  window.addEventListener('hashchange', onHashChange);
  renderRoute();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
