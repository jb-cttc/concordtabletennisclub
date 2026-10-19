'use strict';

// The Membership page's two buttons: Staff sign-up opens the staffing app in a dialog once it is deployed, and Cash flow
// opens the framed desk page that only the club's Google account can see.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'membership.html'), 'utf8');

const cash = /<a id="cash-launch"[^>]*>/.exec(html);
assert.ok(cash, 'the Cash flow button is on the page');
assert.match(cash[0], /href="cash\.html"/, 'Cash flow opens the framed page, never the raw Google address');
assert.doesNotMatch(html, /script\.google\.com\/macros\/s\/[^'"]+\?view=cash/, 'the desk address lives in cash.html only');

const appUrl = /var APP_URL = '([^']+)';/.exec(html);
assert.ok(appUrl, 'the staffing app address is set in one place');
assert.ok(appUrl[1] === 'PENDING_DEPLOYMENT' || /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(appUrl[1]),
  'only a released /exec address, never /dev');

function page(url) {
  const source = html.replace(/var APP_URL = '[^']+';/, "var APP_URL = '" + url + "';").replace(/<script src="navtoggle\.js"><\/script>/, '');
  const dom = new JSDOM(source, { runScripts: 'dangerously' });
  const dialog = dom.window.document.getElementById('staffing-dialog');
  dialog.showModal = function () { this.open = true; };
  dialog.close = function () { this.open = false; };
  return dom.window.document;
}

// Before the app is deployed the button stays hidden, so visitors never see one that does nothing.
const pending = page('PENDING_DEPLOYMENT');
assert.equal(pending.getElementById('staffing-launch').hidden, true);
assert.equal(pending.getElementById('staffing-frame').getAttribute('src'), null);

// Once deployed, the button shows and loads the app only when pressed.
const released = 'https://script.google.com/macros/s/AKfycbTEST/exec';
const live = page(released);
const launch = live.getElementById('staffing-launch');
assert.equal(launch.hidden, false);
assert.equal(live.getElementById('staffing-frame').getAttribute('src'), null, 'nothing loads until the button is pressed');
launch.click();
assert.equal(live.getElementById('staffing-frame').getAttribute('src'), released);
assert.equal(live.getElementById('staffing-dialog').open, true);
live.getElementById('staffing-close').click();
assert.equal(live.getElementById('staffing-dialog').open, false);

console.log('Membership page checks passed');
