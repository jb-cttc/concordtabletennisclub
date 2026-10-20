'use strict';

// The home page's Volunteer signups button swaps the closures calendar for the staffing app's page in place, sized by the
// height the page reports. The page is the site's own copy (volunteer-app.html, published from staffing-app/Index.html), which
// calls the app with fetch and no cookies, so a visitor's Google sign-ins never matter.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const block = /\n  \/\/ Volunteer signups:[\s\S]*?\n  \}\)\(\);\n/.exec(html);
assert.ok(block, 'the volunteer script was found');
assert.match(block[0], /var APP_PAGE = "volunteer-app\.html";/, 'the site\'s own copy of the page, never a Google address');
assert.doesNotMatch(block[0], /script\.google\.com/);
const workflow = fs.readFileSync(path.join(root, '.github/workflows/update-data.yml'), 'utf8');
assert.match(workflow, /cp staffing-app\/Index\.html _site\/volunteer-app\.html/, 'the site publishes the page');
const apiUrl = /var API_URL = '([^']+)';/.exec(fs.readFileSync(path.join(root, 'staffing-app/Index.html'), 'utf8'));
assert.ok(apiUrl && /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(apiUrl[1]), 'the page calls a released /exec address, never /dev');
assert.match(fs.readFileSync(path.join(root, 'docs/staffing-flow.md'), 'utf8'), new RegExp(apiUrl[1].replace(/[.?]/g, '\\$&')), 'the address is written down for maintainers');
assert.ok(html.indexOf('id="volunteer-launch"') < html.indexOf('id="closure-calendar"'), 'the button sits above the calendar');
assert.doesNotMatch(html, /<iframe[^>]*id="volunteer-frame"[^>]*\ssrc=/, 'nothing loads until the button is pressed');

const body = /<body>([\s\S]*)<\/body>/.exec(html)[1].replace(/<script[\s\S]*?<\/script>/g, '');
function page(address = 'https://concordtabletennisclub.com/') {
  const dom = new JSDOM('<!doctype html><body>' + body + '</body>', { runScripts: 'outside-only', url: address });
  dom.window.eval(block[0]);
  return dom.window;
}
const byId = (window, id) => window.document.getElementById(id);

const released = 'volunteer-app.html';
const live = page();
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
const own = 'https://concordtabletennisclub.com';
post(live, own, { type: 'cttc-staffing-height', height: 1234.4 });
assert.equal(byId(live, 'volunteer-frame').style.height, '1234px');
assert.equal(byId(live, 'volunteer-loading').hidden, true);
post(live, 'https://evil.example', { type: 'cttc-staffing-height', height: 99999 });
post(live, 'https://n-abc123-script.googleusercontent.com', { type: 'cttc-staffing-height', height: 99999 });
assert.equal(byId(live, 'volunteer-frame').style.height, '1234px', 'only the site\'s own page may resize it');
post(live, own, { type: 'cttc-staffing-height', height: 99999 });
assert.equal(byId(live, 'volunteer-frame').style.height, '6000px', 'the height is capped');

launch.click();
assert.equal(byId(live, 'volunteer-app').hidden, true);
assert.equal(byId(live, 'closure-calendar').hidden, false, 'the closures calendar comes back');
assert.equal(byId(live, 'volunteer-label').textContent, 'Volunteer signups');

// The "My nights" link in a volunteer's email opens the app at their nights, and the code leaves the address bar at once.
const code = '0123456789abcdef0123';
const mine = page('https://concordtabletennisclub.com/?mine=' + code + '#volunteer');
assert.equal(byId(mine, 'volunteer-app').hidden, false, 'opened without a tap');
assert.equal(byId(mine, 'volunteer-frame').getAttribute('src'), released + '?mine=' + code.toUpperCase());
assert.equal(byId(mine, 'closure-calendar').hidden, true);
assert.equal(mine.location.href, 'https://concordtabletennisclub.com/#volunteer', 'the code is taken out of the address bar');
const odd = page('https://concordtabletennisclub.com/?mine=<script>');
assert.equal(byId(odd, 'volunteer-app').hidden, true, 'anything but a code opens nothing');
assert.equal(odd.location.search, '', 'and is cleared too');

console.log('Volunteer signups checks passed');
