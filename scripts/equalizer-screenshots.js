// Run: npm run equalizer:screenshots
// Saves the Equalizer mockup screenshots shown in the plan (GitHub issue #104) to docs/equalizer/screenshots/: a
// simulated Saturday with made-up players, at a wide and a phone width. It starts the local site on its own port,
// so nothing else needs to be running. Uses the pre-installed Playwright, as npm run desk:google does.
'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'equalizer', 'screenshots') + path.sep;
const PORT = String(3200 + Math.floor(Math.random() * 500));
const URL = 'http://localhost:' + PORT + '/equalizer-mockup.html';

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(URL)).ok) return; } catch (error) { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('The local site did not start on port ' + PORT);
}

async function main() {
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: Object.assign({}, process.env, { PORT }), stdio: 'ignore' });
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const errors = [];
  try {
    await waitForServer();
    async function open(width) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(URL);
      // Hide the sticky header so element shots are not covered by it.
      await page.addStyleTag({ content: 'header{position:static !important}' + (width > 1300 ? '.eq-wide{width:1540px !important;margin-left:calc(50% - 770px) !important}' : '') });
      return page;
    }
    async function setup(page, format, play, size, steps) {
      await page.click(`#eq-format button:text-is("${format}")`);
      await page.click(`#eq-play button:text-is("${play}")`);
      await page.click(`#eq-size button:text-is("${size}")`);
      if (steps === 'end') await page.click('#eq-end');
      else for (let i = 0; i < steps; i++) await page.click('#eq-next');
    }
    async function tab(page, name) { await page.click(`[data-tab="${name}"]`); await page.waitForTimeout(150); }
    async function shot(page, selector, file) { await (await page.$(selector)).screenshot({ path: OUT + file }); }
    async function region(page, fromSel, toSel, file) {
      const a = await (await page.$(fromSel)).boundingBox(); const b = await (await page.$(toSel)).boundingBox();
      await page.screenshot({ path: OUT + file, fullPage: true, clip: { x: 0, y: a.y - 10, width: page.viewportSize().width, height: b.y + b.height - a.y + 20 } });
    }
  
    let p = await open(1280);
    await region(p, '.notice', '.eq-steps', '01-how-it-works.png');
    await setup(p, 'Double Elimination', 'Singles', '16', 14);
    await region(p, '.eq-sim', '#eq-tabs', '02-controls-and-live-stats.png');
    await tab(p, 'live'); await shot(p, '#tab-live', '03-de-singles-live.png');
    await tab(p, 'field'); await shot(p, '#tab-field', '05-de-singles-field-midway.png');
    await p.click('#eq-end');
    await tab(p, 'results'); await shot(p, '#tab-results', '07-de-singles-results.png');
    await p.close();
    p = await open(1600);
    await setup(p, 'Double Elimination', 'Singles', '16', 14);
    await tab(p, 'bracket'); await shot(p, '#tab-bracket', '04-de-singles-bracket-midway.png');
    await p.click('#eq-end');
    await tab(p, 'bracket'); await shot(p, '#tab-bracket', '06-de-singles-bracket-final.png');
    await p.close();
  
    p = await open(1280);
    await setup(p, 'RR → Finals', 'Singles', '24', 30);
    await tab(p, 'bracket'); await shot(p, '#tab-bracket', '08-rr-finals-singles-groups-midway.png');
    await p.click('#eq-end');
    await tab(p, 'bracket'); await shot(p, '#tab-bracket .eq-bracket', '09-rr-finals-singles-finals-with-byes.png');
    await tab(p, 'field'); await shot(p, '#tab-field', '10-rr-finals-singles-field-final.png');
    await p.close();
  
    p = await open(1280);
    await setup(p, 'Double Elimination', 'Doubles', '16', 5);
    await tab(p, 'live'); await shot(p, '#tab-live', '11-de-doubles-live.png');
    await p.close();
  
    p = await open(1280);
    await setup(p, 'RR → Finals', 'Doubles', '24', 'end');
    await tab(p, 'results'); await shot(p, '#tab-results', '12-rr-finals-doubles-results.png');
    await tab(p, 'head-starts');
    await p.click('#eq-calc-mode button:text-is("Doubles")');
    for (const d of ['lower', 'lower', 'higher', 'higher', 'higher', 'lower', 'reset', 'lower']) await p.click(`[data-demo="${d}"]`);
        console.log('memory demo:', await p.$eval('#eq-demo', el => el.innerText.replace(/\n/g, ' | ')));
    await shot(p, '#tab-head-starts', '13-head-starts-calculator-and-memory.png');
    await p.close();
  
    p = await open(390);
    await setup(p, 'Double Elimination', 'Singles', '16', 10);
    await tab(p, 'live'); await shot(p, '#tab-live .eq-tables', '14-phone-tables.png');
    await p.click('.eq-tile >> nth=0');
    await p.click('#eq-score-rows button.ball[data-side="0"][data-games="2"]');
    await p.screenshot({ path: OUT + '15-phone-score-entry.png' });
    await p.click('#eq-score-cancel');
    await setup(p, 'RR → Finals', 'Doubles', '16', 12);
    await tab(p, 'bracket'); await shot(p, '#tab-bracket .eq-groups', '16-phone-rr-doubles-groups.png');
    await p.close();
  
  } finally {
    await browser.close();
    server.kill();
  }
  if (errors.length) throw new Error('Page errors: ' + errors.join('; '));
  console.log('Saved the Equalizer screenshots to docs/equalizer/screenshots/');
}

main().catch(error => { console.error(error.message); process.exit(1); });
