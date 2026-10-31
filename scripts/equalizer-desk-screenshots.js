// Run: npm run equalizer:desk-screenshots
// Screenshots of the Equalizer on the real desk page (apps-script/Index.html and its includes) in Chromium, with the
// real server files running against the simulated Google Sheet of scripts/lib/desk-sim.js: made-up players only, and
// nothing talks to Google. Saved to docs/equalizer/screenshots/desk-*.png for the pull request and the plan (issue #104).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sim = require('./lib/desk-sim');

const ROOT = path.join(__dirname, '..');
const DESK = path.join(ROOT, 'apps-script');
const OUT = path.join(ROOT, 'docs', 'equalizer', 'screenshots');
const DATE = '2026-11-07';

function pageHtml(date) {
  const read = name => fs.readFileSync(path.join(DESK, name + '.html'), 'utf8');
  return read('Index')
    .replace(/<\?!= include\('(\w+)'\) \?>/g, (match, name) => read(name))
    .replace(/<\?= deskMode \?>/g, 'dev')
    .replace(/<\?= initialDate \?>/g, date);
}

// google.script.run in the page, answered by the simulated server through a Playwright binding.
const SHIM = `
  window.google = { script: { run: (function make(success, failure) {
    return new Proxy({}, { get(target, name) {
      if (name === 'withSuccessHandler') return fn => make(fn, failure);
      if (name === 'withFailureHandler') return fn => make(success, fn);
      if (name === 'withUserObject') return () => make(success, failure);
      return (...args) => { window.__cttcRun(String(name), JSON.parse(JSON.stringify(args))).then(reply => {
        if (reply && reply.error) { if (failure) failure(new Error(reply.error)); }
        else if (success) success(reply ? reply.value : null);
      }); };
    } });
  })(null, null) } };`;

async function main() {
  const { chromium } = require('playwright');
  const world = sim.createWorld({ date: DATE, players: 26 });
  const browser = await chromium.launch();
  const errors = [];
  const shots = [];
  async function open(width, date) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
    await context.exposeBinding('__cttcRun', (source, name, args) => {
      try {
        const value = world.server.run(name, ...args);
        return { value: value === undefined ? null : JSON.parse(JSON.stringify(value)) };
      } catch (error) {
        return { error: error.message };
      }
    });
    await context.addInitScript(SHIM);
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith('https://desk.preview/')) return route.fulfill({ contentType: 'text/html', body: pageHtml(date) });
      if (/sessions\.json/.test(url)) return route.fulfill({ contentType: 'application/json', body: '[]' });
      if (/players\.json/.test(url)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ latestSessionDate: '2026-10-28', players: [] }) });
      return route.fulfill({ status: 404, body: '' });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto('https://desk.preview/');
    // The desk covers itself unless Google or the club site frames it; this preview is neither, so the cover goes.
    await page.evaluate(() => document.querySelectorAll('body > div').forEach(div => { if (/can only be opened directly/.test(div.textContent)) div.remove(); }));
    await page.waitForFunction(() => /No session exists|Session loaded|session/i.test(document.getElementById('status').textContent) && !document.getElementById('status').classList.contains('busy'), null, { timeout: 15000 });
    return page;
  }
  async function add(page, count, from) {
    for (const p of world.players.slice(from || 0, (from || 0) + count)) {
      await page.fill('#search', p.display_name);
      await page.click('[data-add="' + p.player_id + '"]');
    }
    await page.fill('#search', '');
  }
  async function shot(page, name, selector) {
    await page.waitForTimeout(300);
    const file = path.join(OUT, 'desk-' + name + '.png');
    if (selector) await (await page.$(selector)).screenshot({ path: file });
    else await page.screenshot({ path: file, fullPage: false });
    shots.push(path.basename(file));
  }
  async function scoreNext(page, firstGames) {
    const row = await page.$('#equalizer .match.match-pending[data-eq-match]');
    if (!row) return false;
    const id = await row.getAttribute('data-eq-match');
    const need = (await row.$$('[data-side="0"].ball')).length - 1;
    await page.click('#equalizer [data-eq-match="' + id + '"] [data-side="1"][data-games="' + need + '"]');
    await page.click('#equalizer [data-eq-match="' + id + '"] [data-side="0"][data-games="' + (firstGames || 1) + '"]');
    return true;
  }

  try {
    fs.mkdirSync(OUT, { recursive: true });
    // 1. A round robin with players signed in, then the switch: everyone moves to the Equalizer.
    let page = await open(1400, DATE);
    await add(page, 12);
    await page.waitForTimeout(2500);
    await shot(page, '01-round-robin-signed-in');
    await page.click('#event-switch [data-event="equalizer"]');
    await shot(page, '02-switched-to-equalizer');
    // 2. The organizer's options redraw at once.
    await page.click('#eq-options [data-eq-choice="format"][data-value="double"]');
    await page.click('#eq-options [data-eq-choice="play"][data-value="doubles"]');
    await shot(page, '03-double-elimination-doubles');
    await page.click('#eq-options [data-eq-choice="format"][data-value="groups"]');
    await page.click('#eq-options [data-eq-choice="play"][data-value="singles"]');
    // 3. Scoring with head starts, a best-of-5 match cut short with Winner.
    await page.click('#eq-options [data-eq-choice="bestOf"][data-value="5"]');
    const row = await page.$('#equalizer .match.match-pending[data-eq-match]');
    const id = await row.getAttribute('data-eq-match');
    await page.click('#equalizer [data-eq-match="' + id + '"] [data-side="0"][data-games="2"]');
    await shot(page, '04-best-of-5-winner-button', '#equalizer [data-eq-match="' + id + '"]');
    await page.click('#equalizer [data-eq-match="' + id + '"] button.winner-badge[data-side="0"]');
    // During play the organizer folds the player list away (the round robin's own Collapse organizer).
    await page.click('#toggle-organizer');
    for (let i = 0; i < 6; i += 1) await scoreNext(page, i % 2);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '05-scoring-with-head-starts');
    while (await scoreNext(page, 1)) { /* every match */ }
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '06-finished-ready-to-finalize');
    await page.click('#finalize');
    await page.waitForFunction(() => /Finalized/.test(document.getElementById('finalize').textContent), null, { timeout: 15000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '07-finalized');
    await page.context().close();

    // 4. Doubles with an odd number: the desk asks.
    page = await open(1400, '2026-11-14');
    await add(page, 9, 12);
    await page.click('#event-switch [data-event="equalizer"]');
    await page.click('#eq-options [data-eq-choice="format"][data-value="double"]');
    await page.click('#eq-options [data-eq-choice="play"][data-value="doubles"]');
    await page.click('#toggle-organizer');
    await shot(page, '08-odd-player-in-doubles');
    await page.context().close();

    // 5. A phone.
    page = await open(390, '2026-11-21');
    await add(page, 8, 4);
    await page.click('#event-switch [data-event="equalizer"]');
    await scoreNext(page, 1);
    await page.evaluate(() => document.getElementById('equalizer').scrollIntoView());
    await shot(page, '09-phone');
    await page.context().close();
  } finally {
    await browser.close();
  }
  if (errors.length) throw new Error('Page errors: ' + errors.join('; '));
  console.log('Saved ' + shots.length + ' desk screenshots to docs/equalizer/screenshots/: ' + shots.join(', '));
}

main().catch(error => { console.error(error.message); process.exit(1); });
