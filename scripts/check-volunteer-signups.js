'use strict';

// The home page's Volunteer signups button: hidden until the staffing app is deployed, then it swaps the closures calendar for
// the app in place, sized by the height the app reports.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const block = /\n  \/\/ Volunteer signups:[\s\S]*?\n  \}\)\(\);\n/.exec(html);
assert.ok(block, 'the volunteer script was found');
const appUrl = /var APP_URL = "([^"]+)";/.exec(block[0]);
assert.ok(appUrl, 'the staffing app address is set in one place');
assert.ok(appUrl[1] === 'PENDING_DEPLOYMENT' || /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(appUrl[1]),
  'only a released /exec address, never /dev');
assert.ok(html.indexOf('id="volunteer-launch"') < html.indexOf('id="closure-calendar"'), 'the button sits above the calendar');
assert.doesNotMatch(html, /<iframe[^>]*id="volunteer-frame"[^>]*\ssrc=/, 'nothing loads until the button is pressed');

const body = /<body>([\s\S]*)<\/body>/.exec(html)[1].replace(/<script[\s\S]*?<\/script>/g, '');
function page(url, address = 'https://concordtabletennisclub.com/') {
  const dom = new JSDOM('<!doctype html><body>' + body + '</body>', { runScripts: 'outside-only', url: address });
  dom.window.eval(block[0].replace(/var APP_URL = "[^"]+";/, 'var APP_URL = "' + url + '";'));
  return dom.window;
}
const byId = (window, id) => window.document.getElementById(id);

const pending = page('PENDING_DEPLOYMENT');
assert.equal(byId(pending, 'volunteer-launch').hidden, true, 'no button that does nothing before the app is deployed');
assert.equal(byId(pending, 'volunteer-app').hidden, true);

const released = 'https://script.google.com/macros/s/AKfycbTEST/exec';
const live = page(released);
const launch = byId(live, 'volunteer-launch');
assert.equal(launch.hidden, false);
assert.equal(byId(live, 'volunteer-frame').getAttribute('src'), null);
launch.click();
assert.equal(byId(live, 'volunteer-frame').getAttribute('src'), released);
assert.equal(byId(live, 'volunteer-app').hidden, false);
assert.equal(byId(live, 'closure-calendar').hidden, true, 'the app takes the calendar\'s place');
assert.equal(byId(live, 'closure-legend').hidden, true);
assert.equal(launch.getAttribute('aria-expanded'), 'true');
assert.equal(byId(live, 'volunteer-label').textContent, 'Back to closures calendar');

function post(window, origin, data) {
  window.dispatchEvent(new window.MessageEvent('message', { origin, data }));
}
post(live, 'https://n-abc123-script.googleusercontent.com', { type: 'cttc-staffing-height', height: 1234.4 });
assert.equal(byId(live, 'volunteer-frame').style.height, '1234px');
assert.equal(byId(live, 'volunteer-loading').hidden, true);
post(live, 'https://evil.example', { type: 'cttc-staffing-height', height: 99999 });
assert.equal(byId(live, 'volunteer-frame').style.height, '1234px', 'only Google\'s frame may resize it');
post(live, 'https://n-abc123-script.googleusercontent.com', { type: 'cttc-staffing-height', height: 99999 });
assert.equal(byId(live, 'volunteer-frame').style.height, '6000px', 'the height is capped');

launch.click();
assert.equal(byId(live, 'volunteer-app').hidden, true);
assert.equal(byId(live, 'closure-calendar').hidden, false, 'the closures calendar comes back');
assert.equal(byId(live, 'volunteer-label').textContent, 'Volunteer signups');

// The "My nights" link in a volunteer's email opens the app at their nights, and the code leaves the address bar at once.
const code = '0123456789abcdef0123';
const mine = page(released, 'https://concordtabletennisclub.com/?mine=' + code + '#volunteer');
assert.equal(byId(mine, 'volunteer-app').hidden, false, 'opened without a tap');
assert.equal(byId(mine, 'volunteer-frame').getAttribute('src'), released + '?mine=' + code.toUpperCase());
assert.equal(byId(mine, 'closure-calendar').hidden, true);
assert.equal(mine.location.href, 'https://concordtabletennisclub.com/#volunteer', 'the code is taken out of the address bar');
const odd = page(released, 'https://concordtabletennisclub.com/?mine=<script>');
assert.equal(byId(odd, 'volunteer-app').hidden, true, 'anything but a code opens nothing');
assert.equal(odd.location.search, '', 'and is cleared too');

console.log('Volunteer signups checks passed');
