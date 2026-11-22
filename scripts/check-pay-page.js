'use strict';

// The front desk payment page (pay.html): it asks the same fees the desk charges (apps-script/NightFees.js), and the
// Venmo button carries the amount for who's playing, or the special's fee on a special night.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'pay.html'), 'utf8');

const desk = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'apps-script/NightFees.js'), 'utf8'), desk);
const page = {};
vm.runInNewContext(/var FEES = [^\n]+\n[\s\S]*?var SPECIAL_NIGHTS = [^\n]+\n/.exec(html)[0], page);
assert.deepEqual({ ...page.FEES }, { ...desk.NIGHT_FEES }, 'pay.html FEES match NIGHT_FEES in apps-script/NightFees.js');
assert.deepEqual(JSON.parse(JSON.stringify(page.SPECIAL_NIGHTS)), JSON.parse(JSON.stringify(desk.SPECIAL_NIGHTS)), 'pay.html SPECIAL_NIGHTS match the desk');
['member', 'visitor', 'intro', 'junior'].forEach(kind => {
  assert.match(html, new RegExp('data-kind="' + kind + '">[^<]+<span class="pay-price">\\$' + desk.NIGHT_FEES[kind] + '</span>'), kind + ' button shows its fee');
});

// The page with test accounts filled in, opened at a given moment (Pacific).
function open(isoInstant) {
  const filled = html.replace('venmo: "",', 'venmo: "Test-Club",').replace('zelle: "",', 'zelle: "pay@example.com",');
  const dom = new JSDOM(filled, {
    runScripts: 'dangerously',
    url: 'https://concordtabletennisclub.com/pay.html',
    beforeParse(window) {
      const RealDate = window.Date;
      const fixed = new RealDate(isoInstant).getTime();
      window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
    }
  });
  return dom.window.document;
}
const venmo = doc => new URL(doc.getElementById('pay-venmo').href);

// A Sunday evening outside the special: member by default, and each choice changes the amount.
let doc = open('2027-01-10T19:30:00-08:00');
assert.equal(doc.querySelector('.pay-kinds').hidden, false);
assert.equal(venmo(doc).pathname, '/Test-Club');
assert.equal(venmo(doc).searchParams.get('txn'), 'pay');
assert.equal(venmo(doc).searchParams.get('amount'), '10');
assert.equal(venmo(doc).searchParams.get('note'), 'CTTC member night');
doc.querySelector('[data-kind="visitor"]').click();
assert.equal(venmo(doc).searchParams.get('amount'), '15');
assert.equal(doc.getElementById('pay-amount').textContent, '$15');
assert.equal(doc.querySelector('.pay-zelle-amount').textContent, '$15');
assert.equal(doc.querySelector('[data-kind="visitor"]').getAttribute('aria-checked'), 'true');
assert.equal(doc.getElementById('pay-zelle-to').textContent, 'pay@example.com');
assert.equal(doc.getElementById('pay-zeffy').hidden, true, 'an option with no account is hidden');

// A special Friday: no choice to make, everyone pays the special's fee.
doc = open('2026-11-27T19:30:00-08:00');
assert.equal(doc.querySelector('.pay-kinds').hidden, true);
assert.equal(doc.querySelector('.pay-special').hidden, false);
assert.equal(venmo(doc).searchParams.get('amount'), '5');
assert.equal(doc.getElementById('pay-amount').textContent, '$5');

// The printed sign's QR code exists and the sign points at this page.
assert.ok(fs.existsSync(path.join(root, 'assets/pay-qr.svg')));
assert.match(fs.readFileSync(path.join(root, 'pay-sign.html'), 'utf8'), /concordtabletennisclub\.com\/pay\.html/);

console.log('Pay page: fees match the desk; Venmo link carries the amount; special nights show one fee.');
