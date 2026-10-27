// Run: npm run desk:google -- [--exec] [--date YYYY-MM-DD] [--view cash|clover] [--selector CSS] [--width 1280] [--height 1800] [--out DIR]
// Opens the real Google-hosted desk (/dev by default, /exec with --exec) in headless Chromium, signed in with the
// club's clasp sign-in (~/.clasprc.json), so an agent can see what it pushed. It looks, it does not touch: the script
// never clicks, types or saves. It only loads the page, optionally switches the date picker (which only reads), waits
// for the page to settle, prints a short summary and saves screenshots: desk.png is the browser window (Google keeps the
// desk in a frame the window's height, so raise --height to see further down), and --selector saves one part of the
// page in full however long it is. --view opens one of the desk's other pages (?view=cash, ?view=clover) instead, and waits
// for it to finish loading.
//
// Both URLs run against the real club Sheet, Gmail and member data. Screenshots therefore show real names: keep them
// in a scratch directory outside the repository, look at them, delete them, and never commit or post them.
// The access token stays in memory: it is never printed or written to disk.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function option(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[index + 1] : fallback;
}

async function accessToken() {
  const file = path.join(os.homedir(), '.clasprc.json');
  if (!fs.existsSync(file)) throw new Error('No clasp sign-in at ~/.clasprc.json. In a cloud session the CLASPRC_B64 environment variable provides it (see README, Deploying the desk).');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tokens = (saved.tokens && saved.tokens.default) || saved;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: tokens.client_id, client_secret: tokens.client_secret, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' })
  });
  if (!response.ok) throw new Error('Google refused the clasp sign-in (' + response.status + '). Sign in again with clasp login --no-localhost and update CLASPRC_B64.');
  return (await response.json()).access_token;
}

// /dev is the deployment at HEAD; /exec is the numbered one. Looked up rather than written down, so a new
// deployment never leaves this script pointing at the old one.
async function deployment(token, live) {
  const scriptId = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps-script', '.clasp.json'), 'utf8')).scriptId;
  const response = await fetch('https://script.googleapis.com/v1/projects/' + scriptId + '/deployments', { headers: { Authorization: 'Bearer ' + token } });
  if (!response.ok) throw new Error('Could not list the desk deployments (' + response.status + ')');
  const deployments = (await response.json()).deployments || [];
  const head = deployments.filter(d => !d.deploymentConfig.versionNumber);
  const numbered = deployments.filter(d => d.deploymentConfig.versionNumber).sort((a, b) => b.deploymentConfig.versionNumber - a.deploymentConfig.versionNumber);
  const chosen = live ? numbered[0] : head[0];
  if (!chosen) throw new Error('No ' + (live ? '/exec' : '/dev') + ' deployment found');
  return {
    url: 'https://script.google.com/macros/s/' + chosen.deploymentId + (live ? '/exec' : '/dev'),
    label: live ? '/exec version ' + chosen.deploymentConfig.versionNumber + ' (' + (chosen.deploymentConfig.description || '') + ')' : '/dev (HEAD)'
  };
}

(async () => {
  const live = process.argv.includes('--exec');
  const date = option('date', '');
  const view = option('view', '');
  const selector = option('selector', '');
  const width = Number(option('width', '1280'));
  const height = Number(option('height', '1800'));
  const out = path.resolve(option('out', path.join(os.tmpdir(), 'cttc-desk-view')));
  if (out.startsWith(ROOT + path.sep)) throw new Error('Screenshots show real member data: choose an --out directory outside the repository.');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date must be YYYY-MM-DD');
  if (view && !/^(cash|clover)$/.test(view)) throw new Error('--view must be cash or clover');
  if (view && date) throw new Error('--date is for the desk; leave it out with --view');
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });

  const token = await accessToken();
  const target = await deployment(token, live);
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width, height } });
    // Every request to script.google.com (the page and its google.script.run calls) carries the club sign-in.
    await context.route(/^https:\/\/script\.google\.com\//, route => route.continue({ headers: { ...route.request().headers(), authorization: 'Bearer ' + token } }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 300)));
    await page.goto(target.url + (view ? '?view=' + view : ''), { waitUntil: 'load' });

    // The desk runs two frames deep inside Google's sandbox; find the one holding the session date picker (or, for
    // another page, its status bar).
    const marker = view ? '#status' : '#date';
    let desk = null;
    for (let second = 0; second < 90 && !desk; second += 1) {
      for (const frame of page.frames()) if (await frame.$(marker).catch(() => null)) desk = frame;
      if (!desk) await page.waitForTimeout(1000);
    }
    if (!desk) {
      await page.screenshot({ path: path.join(out, 'desk-not-found.png') });
      throw new Error('The desk did not appear within 90 seconds; see ' + path.join(out, 'desk-not-found.png'));
    }
    await page.waitForTimeout(10000);
    // The other pages load their data after opening; wait while their status bar says they are busy.
    for (let second = 0; view && second < 150 && await desk.$('#status.busy'); second += 1) await page.waitForTimeout(1000);
    if (date) {
      await desk.evaluate(value => { const input = document.getElementById('date'); input.value = value; input.dispatchEvent(new Event('change')); }, date);
      await page.waitForTimeout(20000);
    }

    const summary = await desk.evaluate(() => ({
      date: document.getElementById('date') ? document.getElementById('date').value : '',
      status: (document.getElementById('status').textContent || '').slice(0, 200),
      statusClass: document.getElementById('status').className,
      sections: [...document.querySelectorAll('h2')].filter(heading => heading.getClientRects().length).map(heading => heading.textContent)
    }));
    const shots = [];
    const full = path.join(out, 'desk.png');
    await page.screenshot({ path: full });
    shots.push(full);
    if (selector) {
      const node = await desk.$(selector);
      if (!node) throw new Error('Nothing matches --selector ' + selector);
      const file = path.join(out, 'desk-selector.png');
      await node.screenshot({ path: file });
      shots.push(file);
    }
    console.log(JSON.stringify({ deployment: target.label, ...summary, pageErrors: errors, screenshots: shots }, null, 1));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(String(error.message || error));
  process.exit(1);
});
