// Test dymny: dodanie osoby, wybór poziomu, plan, pełne sesje wybranego kursu i wszystkie strony.
//   node tests/e2e/smoke.mjs [kurs=a2b1] [liczba dni=1] [katalog zrzutów|-] [pace]
// Z dopiskiem "pace" sprawdza też tempo: drugą sesję tego samego dnia, limit dzienny, zapas,
// podpowiedź o wyższym poziomie i przyspieszenie planu.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const course = process.argv[2] ?? 'a2b1';
const days = Number(process.argv[3] ?? 1);
const shots = process.argv[4] && process.argv[4] !== '-' ? process.argv[4] : null;
const pace = process.argv[5] === 'pace';
const port = 5200 + Math.floor(Math.random() * 80);
const server = spawn('node', [join(root, 'scripts', 'dev-server.mjs'), '--port', String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
let shotNo = 0;
let glossChecked = false;
const shot = async (name) => { if (shots) await page.screenshot({ path: join(shots, `${String(++shotNo).padStart(2, '0')}-${name}.png`), fullPage: true }); };
const visible = async (sel) => (await page.locator(sel).first().isVisible().catch(() => false));
const expect = async (sel, what, want = true) => { if ((await visible(sel)) !== want) errors.push(`${what}: ${sel} ${want ? 'is not' : 'is still'} visible`); };
const overflow = async (where) => {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (wide) errors.push(`overflow: ${where}`);
};
const goto = async (route, ready) => {
  await page.evaluate((r) => { if (location.hash === '#' + r) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = '#' + r; }, route);
  await page.waitForSelector(ready);
  await page.waitForTimeout(300);
};

// Drives one whole session from "Dziś" to its summary, answering everything.
async function runSession(tag) {
  await page.waitForSelector('#start-session');
  await page.click('#start-session');
  let last = '';
  for (let i = 0; i < 400; i++) {
    await page.waitForTimeout(60);
    const title = (await page.locator('.actbar__title').textContent().catch(() => '')) ?? '';
    if (title !== last) { last = title; await overflow(title); await shot(`${tag}-${title.replace(/\W+/g, '-').toLowerCase()}`); }
    if (await visible('#session-finish')) { await shot(`${tag}-summary`); await page.click('#session-finish'); break; }
    if (await visible('dialog[open] .btn--primary')) { await page.click('dialog[open] .btn--primary'); continue; }
    if (await visible('#reveal')) { await page.click('#reveal'); await page.click('#grade-good'); continue; }
    if (await visible('.grades .grade')) { await page.locator('.grades .grade').last().click(); continue; }
    if (await visible('.q__opt:not(:disabled)')) { await page.locator('.q__opt:not(:disabled)').first().click(); continue; }
    if (await visible('.q__typed input:not([readonly])')) { await page.locator('.q__typed input').fill('test'); await page.locator('.q__typed input').press('Enter'); continue; }
    if (await visible('.match__col:first-child .match__item:not(:disabled)')) {
      await page.locator('.match__col:first-child .match__item:not(:disabled)').first().click();
      const rights = page.locator('.match__col:last-child .match__item:not(:disabled)');
      const n = await rights.count();
      for (let k = 0; k < n; k++) { await rights.nth(k).click().catch(() => {}); if (!(await visible('.match__item.is-picked'))) break; }
      continue;
    }
    if (await visible('#dictation:not([readonly])')) { await page.fill('#dictation', 'I like music'); await page.click('#dictation-check'); continue; }
    if (await visible('#writing-text') && !(await page.inputValue('#writing-text'))) { await page.fill('#writing-text', 'This is my short text about my free time. I like it very much.'); await shot(`${tag}-writing`); }
    if (await visible('#read-questions') && await visible('.read__w') && !glossChecked) {
      // every word of the reading text opens its translation; a word inside an expression also shows the expression
      glossChecked = true;
      await page.locator('.read__w').first().click();
      await expect('.read__pop .read__pop-pl', 'reading: translation of a tapped word');
      await page.keyboard.press('Escape');
      if (await visible('.read__ph .read__w')) {
        await page.locator('.read__ph .read__w').first().click();
        await expect('.read__pop-phrase', 'reading: translation of an expression');
        await shot(`${tag}-reading-gloss`);
        await page.keyboard.press('Escape');
      } else errors.push('reading: no expression is marked in the text');
    }
    let clicked = false;
    for (const id of ['#learn-next', '#read-questions', '#gram-exercises', '#test-start', '#dictation-next', '#listen-questions', '#shadow-next', '#speak-next', '#review-next', '#review-continue', '#step-done']) {
      if (await visible(id)) { await page.click(id); clicked = true; break; }
    }
    if (clicked) continue;
    if (await visible('.action-bar .btn--primary:not([hidden])')) { await page.locator('.action-bar .btn--primary:not([hidden])').first().click(); continue; }
  }
  await page.waitForSelector('.app[data-route="dzis"] .stats--3');
  await page.waitForTimeout(200);
}

try {
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector('#profile-name');
  await shot('who');
  await page.fill('#profile-name', 'Test');
  await page.click('#profile-save');
  await page.waitForSelector(`#level-${course}`);
  await shot('level'); await overflow('level');
  await page.click(`#level-${course}`);
  await page.waitForSelector('#plan-save');
  await shot('plan');
  await page.click('#plan-save');
  await page.waitForSelector('#start-session');
  await shot('today'); await overflow('today');

  for (let day = 1; day <= days; day++) {
    await runSession(`d${day}`);
    await shot(`d${day}-today-after`);
    if (day < days) {
      // move the clock by one day so that reviews come due and the next session opens
      await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 86400000; });
      await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    }
  }

  if (pace) {
    // A second session on the same day: allowed without fuss, then the daily cap and the lead appear.
    await expect('#pace-cap', 'pace: no cap after one session', false);
    await runSession('pace');
    await expect('#pace-cap', 'pace: daily cap after two sessions');
    await expect('#start-extra', 'pace: extra session only on request');
    await expect('#pace-lead', 'pace: lead shown on Today');
    await shot('pace-cap');
    // Two tests at 90%+ while ahead of the plan: the hint about a higher level (not on the top level).
    await page.evaluate((c) => {
      const key = Object.keys(localStorage).find((k) => k.endsWith(`.${c}.progress`));
      const doc = JSON.parse(localStorage.getItem(key));
      doc.tests = { w01: { score: 19, total: 20, at: Date.now() }, w02: { score: 18, total: 20, at: Date.now() } };
      doc.updatedAt = Date.now();
      localStorage.setItem(key, JSON.stringify(doc));
    }, course);
    await page.reload();
    await page.waitForSelector('.stats');
    await page.waitForTimeout(300);
    if (course === 'b2c1') await expect('#level-hint', 'pace: no level hint on the top level', false);
    else {
      await expect('#level-hint', 'pace: level hint');
      await shot('pace-level-hint');
      await page.click('#level-hint-later');
      await page.waitForTimeout(300);
      await expect('#level-hint', 'pace: level hint dismissed', false);
    }
    // Speeding the plan up turns the lead into an earlier end date.
    await goto('plan', '.app[data-route="plan"] .page-head');
    await expect('#plan-lead', 'pace: lead shown in the plan');
    await page.click('#plan-speed-up');
    await page.waitForSelector('dialog[open] .btn--primary');
    await shot('pace-speed-up');
    await page.click('dialog[open] .btn--primary');
    await page.waitForTimeout(400);
    await expect('#plan-lead', 'pace: lead gone after speeding up', false);
  }

  for (const route of ['plan', 'slownik', 'postepy', 'ustawienia']) {
    await goto(route, `.app[data-route="${route}"] .page-head`);
    await shot(route); await overflow(route);
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await goto('dzis', '.stats');
  await shot('today-dark');
  const state = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ang:')).length);
  console.log(`documents stored: ${state}`);
} catch (err) {
  errors.push('test: ' + err.message.split('\n')[0]);
  await shot('failure');
} finally {
  await browser.close();
  server.kill();
}
console.log(errors.length ? `FAILED\n${[...new Set(errors)].join('\n')}` : 'OK: no errors');
process.exit(errors.length ? 1 : 0);
