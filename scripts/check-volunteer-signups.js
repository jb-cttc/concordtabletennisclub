'use strict';

// The home page's Volunteer signups button swaps the closures calendar for the staffing app's page in place, sized by the
// height the page reports. The page is the site's own copy (volunteer-app.html, published from staffing-app/Index.html), which
// calls the app with fetch and no cookies, so a visitor's Google sign-ins never matter.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const site = require('./lib/site-build');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = site.read('index.html');

const block = /\n  \/\/ Volunteer signups:[\s\S]*?\n  \}\)\(\);\n/.exec(html);
assert.ok(block, 'the volunteer script was found');
assert.match(block[0], /var APP_PAGE = "volunteer-app\.html";/, 'the site\'s own copy of the page, never a Google address');
assert.equal(block[0].match(/script\.google\.com/g).length, 1, 'Google\'s address appears once: the calendar asked for early, never the frame');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/update-data.yml'), 'utf8');
assert.match(workflow, /cp staffing-app\/Index\.html _site\/volunteer-app\.html/, 'the site publishes the page');
assert.match(fs.readFileSync(path.join(root, 'staffing-app', 'Index.html'), 'utf8'), /<meta name="viewport" content="width=device-width, initial-scale=1">/, 'phone width if the copy is opened on its own');
// On a phone the home page leaves the frame about 320px; the legend must wrap rather than run off the side.
const phoneCss = /@media \(max-width: 520px\) \{[\s\S]*?\n  \}/.exec(fs.readFileSync(path.join(root, 'staffing-app', 'Index.html'), 'utf8'));
assert.ok(phoneCss && /\.legend \{[^}]*font-size/.test(phoneCss[0]), 'the phone legend has its own, smaller text');
assert.doesNotMatch(phoneCss[0], /flex-wrap: nowrap/, 'the phone legend may wrap, so it never overflows a narrow frame');
const apiUrl = /var API_URL = '([^']+)';/.exec(fs.readFileSync(path.join(root, 'staffing-app/Index.html'), 'utf8'));
assert.ok(apiUrl && /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(apiUrl[1]), 'the page calls a released /exec address, never /dev');
assert.match(fs.readFileSync(path.join(root, 'docs/staffing-flow.md'), 'utf8'), new RegExp(apiUrl[1].replace(/[.?]/g, '\\$&')), 'the address is written down for maintainers');
assert.equal(/var BOARD_URL = "([^"]+)";/.exec(block[0])[1], apiUrl[1], 'the home page asks the same released app the page calls');
assert.ok(html.indexOf('id="volunteer-launch"') < html.indexOf('id="closure-calendar"'), 'the button sits above the calendar');
assert.doesNotMatch(html, /<iframe[^>]*id="volunteer-frame"[^>]*\ssrc=/, 'nothing loads until the button is pressed');

const body = /<body>([\s\S]*)<\/body>/.exec(html)[1].replace(/<script[\s\S]*?<\/script>/g, '');
// Every page gets a fetch that records the calendar requests (jsdom has none); saveData plays a phone saving data.
function page(address = 'https://concordtabletennisclub.com/', { saveData = false, loaded = true } = {}) {
  const dom = new JSDOM('<!doctype html><body>' + body + '</body>', { runScripts: 'outside-only', url: address });
  const asked = [];
  dom.window.fetch = (url, options) => {
    asked.push({ url, options });
    return Promise.resolve({ ok: true, text: () => Promise.resolve('{"ok":true,"nights":[]}') });
  };
  if (saveData) Object.defineProperty(dom.window.navigator, 'connection', { value: { saveData: true } });
  Object.defineProperty(dom.window.document, 'readyState', { value: loaded ? 'complete' : 'loading', configurable: true });
  dom.window.eval(block[0]);
  dom.window.asked = asked;
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

// The calendar is asked for once the home page has loaded, while the visitor reads, and handed to the app's page.
(async () => {
  const early = page();
  assert.equal(early.asked.length, 1, 'asked for once the page has loaded');
  assert.equal(early.asked[0].url, apiUrl[1]);
  assert.deepEqual(JSON.parse(early.asked[0].options.body), { fn: 'staffBoard', args: [] }, 'only the public calendar');
  assert.equal(early.asked[0].options.credentials, 'omit', 'with no cookies, like the app');
  assert.equal(await early.cttcStaffBoard.text, '{"ok":true,"nights":[]}', 'the answer\'s text waits for the app\'s page');
  byId(early, 'volunteer-launch').click();
  assert.equal(early.asked.length, 1, 'a fresh answer is not asked for again on opening');

  const later = page();
  later.cttcStaffBoard.at -= 3 * 60 * 1000;
  byId(later, 'volunteer-launch').click();
  assert.equal(later.asked.length, 2, 'an answer older than two minutes is asked for again on opening');

  const loading = page(undefined, { loaded: false });
  assert.equal(loading.asked.length, 0, 'nothing is asked before the page has loaded');
  loading.dispatchEvent(new loading.Event('load'));
  assert.equal(loading.asked.length, 1);

  const saving = page(undefined, { saveData: true });
  assert.equal(saving.asked.length, 0, 'a phone saving data is not asked to fetch it early');
  byId(saving, 'volunteer-launch').click();
  assert.equal(saving.asked.length, 1, 'but opening the app still starts it at once');

  assert.equal(page('https://concordtabletennisclub.com/?mine=' + code).asked.length, 1, 'a My nights link opens the app at once and asks once, not twice');

  console.log('Volunteer signups checks passed');
})().catch(error => { console.error(error); process.exit(1); });
