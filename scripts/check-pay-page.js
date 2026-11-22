'use strict';

// Pay for tonight (pay.js), on the page the desk QR code opens (pay.html) and folded under Fees on the home page: it asks
// the same fees the desk charges (apps-script/NightFees.js), and the Venmo button carries the amount for who's playing,
// or the special's fee on a special night.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const script = read('pay.js');
const payPage = read('pay.html');
const home = read('index.html');

const desk = {};
vm.runInNewContext(read('apps-script/NightFees.js'), desk);
const page = {};
vm.runInNewContext(/var FEES = [^\n]+\n[\s\S]*?var SPECIAL_NIGHTS = [^\n]+\n/.exec(script)[0], page);
assert.deepEqual({ ...page.FEES }, { ...desk.NIGHT_FEES }, 'pay.js FEES match NIGHT_FEES in apps-script/NightFees.js');
assert.deepEqual(JSON.parse(JSON.stringify(page.SPECIAL_NIGHTS)), JSON.parse(JSON.stringify(desk.SPECIAL_NIGHTS)), 'pay.js SPECIAL_NIGHTS match the desk');

// Both places draw the options from pay.js.
assert.match(payPage, /<div class="pay-widget" data-pay><\/div>/);
assert.match(payPage, /<script src="pay\.js\?v=\d+"><\/script>/);
assert.match(home, /<details id="pay" class="pay-details">[\s\S]*?<div class="pay-widget" data-pay><\/div>\s*<\/details>/, 'the home page folds the options under Fees');
assert.ok(home.indexOf('id="pay"') > home.indexOf('id="fees-heading"') && home.indexOf('id="pay"') < home.indexOf('id="latest-results"'), 'inside the Fees section');
assert.match(home, /<script src="pay\.js\?v=\d+"><\/script>/);
assert.doesNotMatch(read('scripts/sync-nav.js').match(/const NAV_LINKS = \[[\s\S]*?\];/)[0], /pay\.html/, 'not in the menu');

// The intro on pay.html ends by itself (CSS, not script) and is left out for reduced motion.
const css = read('style.css');
assert.match(css, /\.pay-intro \{[^}]*animation: pay-intro-out[^}]*forwards;/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.pay-intro \{ display: none; \}/);
assert.ok(fs.existsSync(path.join(root, 'assets/pay-qr.svg')), 'the desk QR code the intro shows');

// A page with test accounts filled in, opened at a given moment (Pacific).
function open(html, isoInstant) {
  const filled = script.replace('venmo: "",', 'venmo: "Test-Club",').replace('zelle: "",', 'zelle: "pay@example.com",');
  const dom = new JSDOM(html.replace(/<script src="pay\.js\?v=\d+"><\/script>/, () => '<script>' + filled + '</script>'), {
    runScripts: 'dangerously',
    virtualConsole: new VirtualConsole(), // the home page's other scripts fetch live data, which is not here
    url: 'https://concordtabletennisclub.com/',
    beforeParse(window) {
      const RealDate = window.Date;
      const fixed = new RealDate(isoInstant).getTime();
      window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
    }
  });
  return dom.window.document;
}
const venmo = doc => new URL(doc.querySelector('.pay-venmo').href);

// A Sunday evening outside the special: member by default, and each choice changes the amount.
let doc = open(payPage, '2027-01-10T19:30:00-08:00');
['member', 'visitor', 'intro', 'junior'].forEach(kind => {
  assert.equal(doc.querySelector('[data-kind="' + kind + '"] .pay-price').textContent, '$' + desk.NIGHT_FEES[kind], kind + ' shows its fee');
});
assert.equal(doc.querySelector('.pay-kinds').hidden, false);
assert.equal(venmo(doc).pathname, '/Test-Club');
assert.equal(venmo(doc).searchParams.get('txn'), 'pay');
assert.equal(venmo(doc).searchParams.get('amount'), '10');
assert.equal(venmo(doc).searchParams.get('note'), 'CTTC member night');
doc.querySelector('[data-kind="visitor"]').click();
assert.equal(venmo(doc).searchParams.get('amount'), '15');
assert.deepEqual([...doc.querySelectorAll('.pay-amount')].map(el => el.textContent), ['$15', '$15'], 'the heading and the Zelle panel');
assert.equal(doc.querySelector('[data-kind="visitor"]').getAttribute('aria-checked'), 'true');
assert.equal(doc.querySelector('.pay-zelle-address').textContent, 'pay@example.com');
assert.equal(doc.querySelector('.pay-zeffy').hidden, true, 'an option with no account is hidden');

// A special Friday: no choice to make, everyone pays the special's fee.
doc = open(payPage, '2026-11-27T19:30:00-08:00');
assert.equal(doc.querySelector('.pay-kinds').hidden, true);
assert.equal(doc.querySelector('.pay-special').hidden, false);
assert.equal(venmo(doc).searchParams.get('amount'), '5');

// The home page draws the same options inside the folded section.
doc = open(home, '2027-01-10T19:30:00-08:00');
assert.equal(doc.querySelectorAll('#pay .pay-method').length, 3);
assert.equal(venmo(doc).searchParams.get('amount'), '10');

console.log('Pay for tonight: fees match the desk; Venmo link carries the amount; special nights show one fee; on pay.html and under Fees.');
