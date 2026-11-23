// Test dymny: przechodzi przez dodanie osoby, wybór poziomu, plan i pełne sesje wybranego kursu.
//   node tests/e2e/smoke.mjs [kurs=a2b1] [liczba dni=1] [katalog zrzutów]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const course = process.argv[2] ?? 'a2b1';
const days = Number(process.argv[3] ?? 1);
const shots = process.argv[4] ?? null;
const port = 5200 + Math.floor(Math.random() * 80);
const server = spawn('node', [join(root, 'scripts', 'dev-server.mjs'), '--port', String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
let shotNo = 0;
const shot = async (name) => { if (shots) await page.screenshot({ path: join(shots, `${String(++shotNo).padStart(2, '0')}-${name}.png`), fullPage: true }); };
const visible = async (sel) => (await page.locator(sel).first().isVisible().catch(() => false));
const overflow = async (where) => {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (wide) errors.push(`overflow: ${where}`);
};

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
    await page.waitForSelector('#start-session');
    await page.click('#start-session');
    let last = '';
    for (let i = 0; i < 400; i++) {
      await page.waitForTimeout(60);
      const title = (await page.locator('.actbar__title').textContent().catch(() => '')) ?? '';
      if (title !== last) { last = title; await overflow(title); await shot(`d${day}-${title.replace(/\W+/g, '-').toLowerCase()}`); }
      if (await visible('#session-finish')) { await shot(`d${day}-summary`); await page.click('#session-finish'); break; }
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
      if (await visible('#writing-text') && !(await page.inputValue('#writing-text'))) { await page.fill('#writing-text', 'This is my short text about my free time. I like it very much.'); await shot(`d${day}-writing`); }
      if (await visible('#read-questions') && await visible('.read__w') && !page.__glossChecked) {
        // every word of the reading text opens its translation; a word inside an expression also shows the expression
        page.__glossChecked = true;
        await page.locator('.read__w').first().click();
        if (!(await visible('.read__pop .read__pop-pl'))) errors.push('reading: a tapped word shows no translation');
        await page.keyboard.press('Escape');
        if (await visible('.read__ph .read__w')) {
          await page.locator('.read__ph .read__w').first().click();
          if (!(await visible('.read__pop-phrase'))) errors.push('reading: a word inside an expression shows no expression translation');
          await shot(`d${day}-reading-gloss`);
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
    await page.waitForSelector('.stats');
    await shot(`d${day}-today-after`);
    if (day < days) {
      // move the clock by one day so that reviews come due and the next session opens
      await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 86400000; });
      await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    }
  }
  for (const route of ['plan', 'slownik', 'postepy', 'ustawienia']) {
    await page.evaluate((r) => { location.hash = '#' + r; }, route);
    await page.waitForSelector(`.app[data-route="${route}"] .page-head`);
    await page.waitForTimeout(300);
    await shot(route); await overflow(route);
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => { location.hash = '#dzis'; });
  await page.waitForSelector('.stats');
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
