// Test synchronizacji: dwa "urządzenia" (osobne konteksty przeglądarki) i atrapa bazy Claude.
// Wymaga zbudowanej strony: node scripts/build-artifact.mjs --preview
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'artifact');
const db = new Map();
let writes = 0;
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__db') {
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { id, data } = JSON.parse(body);
      db.set(id, data);
      writes++;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(Object.fromEntries(db)));
  }
  try {
    const file = normalize(join(dist, url.pathname === '/' ? 'preview.html' : url.pathname));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

// The fake `window.claude`: db (collection get / onSnapshot by polling / doc.set) and user.id().
const mock = () => {
  const snap = (all) => ({ metadata: { fromCache: false, hasPendingWrites: false },
    docs: Object.entries(all).map(([id, data]) => ({ id, exists: true, data: () => JSON.parse(JSON.stringify(data)), metadata: { fromCache: false, hasPendingWrites: false } })) });
  const fetchAll = () => fetch('/__db').then((r) => r.json());
  const collection = () => ({
    get: () => fetchAll().then(snap),
    onSnapshot(next) {
      let last = '';
      const tick = () => fetchAll().then((all) => { const s = JSON.stringify(all); if (s !== last) { last = s; next(snap(all)); } }).catch(() => {});
      const t = setInterval(tick, 500);
      tick();
      return () => clearInterval(t);
    },
    doc: (id) => ({ set: (data) => fetch('/__db', { method: 'POST', body: JSON.stringify({ id, data }) }).then(() => undefined) }),
  });
  const caps = { db: { collection }, user: { id: async () => 'u_test' } };
  window.claude = { use: (name) => new Promise((r) => setTimeout(() => r(caps[name] ?? null), 150)) };
};

const errors = [];
const browser = await chromium.launch();
const device = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(mock);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  return page;
};
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) errors.push(what); };

try {
  // 1. Device A: add a learner, choose a level, set the plan.
  const a = await device('A');
  await a.goto(base);
  await a.waitForSelector('#profile-name');
  await a.fill('#profile-name', 'Ala');
  await a.click('#profile-save');
  await a.click('#level-a2b1');
  await a.click('#plan-save');
  await a.waitForSelector('#start-session');
  await a.waitForTimeout(3000);
  check(db.has('profiles') && [...db.keys()].some((k) => k.endsWith('.profile')), 'device A wrote the learner and the plan to the remote store');
  const pid = Object.keys(db.get('profiles')?.list ?? {})[0];

  // 2. Device B (fresh browser): must show A's plan instead of the first-run form.
  const b = await device('B');
  await b.goto(base);
  await b.waitForSelector('#start-session', { timeout: 15000 }).catch(() => {});
  check(await b.locator('#start-session').isVisible(), 'a fresh device opens straight on "Dziś" with the synced plan');
  check((await b.locator('.page-head__title').textContent())?.includes('Ala'), 'the fresh device shows the same learner');

  // 3. B studies (learns words); A receives the change without reload.
  await b.click('#start-session');
  for (let i = 0; i < 80 && !(await b.locator('#read-questions').isVisible().catch(() => false)); i++) {
    await b.waitForTimeout(60);
    for (const sel of ['#review-next', '#learn-next', '.q__opt:not(:disabled)', '.action-bar .btn--primary:not([hidden])']) {
      if (await b.locator(sel).first().isVisible().catch(() => false)) { await b.locator(sel).first().click(); break; }
    }
  }
  await b.waitForTimeout(3500);
  const srsId = `${pid}.a2b1.srs-w01`;
  check(Object.keys(db.get(srsId)?.cards ?? {}).length === 8, 'device B saved 8 new cards to the remote store');
  const onA = await a.evaluate((id) => Object.keys(JSON.parse(localStorage.getItem('ang:' + id) ?? '{}').cards ?? {}).length, srsId);
  check(onA === 8, 'device A received the cards without a reload');
  await a.waitForTimeout(1000);
  check((await a.locator('.stat__value').nth(1).textContent())?.trim() === '8', 'device A shows the new word count on screen');

  // 4. Nothing is written when nothing changes.
  const before = writes;
  await a.waitForTimeout(5000);
  check(writes === before, `no writes while idle (total writes so far: ${writes})`);

  // 5. Both change different things at the same time: both survive.
  await a.evaluate(() => { location.hash = '#ustawienia'; });
  await a.waitForSelector('#set-time');
  await a.fill('#set-time', '07:30');
  await a.dispatchEvent('#set-time', 'change');
  await b.waitForTimeout(3500);
  check(db.get(`${pid}.profile`)?.studyTime === '07:30', 'a setting changed on A reached the remote store');
  check(Object.keys(db.get(srsId)?.cards ?? {}).length === 8, 'the cards from B are still there');
} catch (err) {
  errors.push('test: ' + err.message.split('\n')[0]);
} finally {
  await browser.close();
  server.close();
}
console.log(errors.length ? `FAILED\n${[...new Set(errors)].join('\n')}` : 'OK: sync works');
process.exit(errors.length ? 1 : 0);
