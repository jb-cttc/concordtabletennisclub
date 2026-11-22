'use strict';

// Calls one server function of a club Apps Script web app, as the club account, through the app's own page
// (google.script.run) in headless Chromium: the same sign-in and route as scripts/desk-google-view.js. Used by
// scripts/meeting-draft-email.js to read the meeting app and to send through the meeting mailer. The access token
// stays in memory.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

async function accessToken() {
  const file = path.join(os.homedir(), '.clasprc.json');
  if (!fs.existsSync(file)) throw new Error('No clasp sign-in at ~/.clasprc.json (see README, Deploying the desk).');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const t = (saved.tokens && saved.tokens.default) || saved;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: t.client_id, client_secret: t.client_secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' }) });
  if (!response.ok) throw new Error('Google refused the clasp sign-in (' + response.status + ').');
  return (await response.json()).access_token;
}

// The app's released /exec (the newest numbered deployment), or /dev with live false.
async function appUrl(token, dir, live) {
  const scriptId = JSON.parse(fs.readFileSync(path.join(ROOT, dir, '.clasp.json'), 'utf8')).scriptId;
  const response = await fetch('https://script.googleapis.com/v1/projects/' + scriptId + '/deployments', { headers: { Authorization: 'Bearer ' + token } });
  if (!response.ok) throw new Error('Could not list the deployments of ' + dir + ' (' + response.status + ')');
  const all = (await response.json()).deployments || [];
  const numbered = all.filter(d => d.deploymentConfig.versionNumber).sort((a, b) => b.deploymentConfig.versionNumber - a.deploymentConfig.versionNumber);
  const chosen = live ? numbered[0] : all.filter(d => !d.deploymentConfig.versionNumber)[0];
  if (!chosen) throw new Error(dir + ' has no ' + (live ? 'released /exec' : '/dev') + ' deployment yet.');
  return 'https://script.google.com/macros/s/' + chosen.deploymentId + (live ? '/exec' : '/dev');
}

// { dir, live, query, marker, fn, args } -> the function's result. marker: a CSS selector the app's page has.
async function callApp({ dir, live = true, query = '', marker, fn, args = [] }) {
  const token = await accessToken();
  const url = await appUrl(token, dir, live);
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.route(/^https:\/\/script\.google\.com\//, route => route.continue({ headers: { ...route.request().headers(), authorization: 'Bearer ' + token } }));
    const page = await context.newPage();
    await page.goto(url + query, { waitUntil: 'load' });
    let frame = null;
    for (let second = 0; second < 90 && !frame; second += 1) {
      for (const f of page.frames()) if (await f.$(marker).catch(() => null)) frame = f;
      if (!frame) await page.waitForTimeout(1000);
    }
    if (!frame) {
      const body = (await page.textContent('body').catch(() => '')) || '';
      if (/authori[sz]ation|review permissions|needs your permission/i.test(body)) throw new Error(dir + ' needs Google permission first: open ' + url + ' once, signed in to the club account, and click Allow.');
      throw new Error(dir + ' did not open within 90 seconds (' + url + ').');
    }
    return await frame.evaluate(([name, list]) => new Promise((resolve, reject) => {
      const runner = google.script.run.withSuccessHandler(resolve).withFailureHandler(error => reject(new Error(String(error && error.message || error))));
      runner[name].apply(runner, list);
    }), [fn, args]);
  } finally {
    await browser.close();
  }
}

module.exports = { callApp, appUrl, accessToken };
