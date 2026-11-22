'use strict';

// Pay for tonight (pay.js), on the page the desk QR code opens (pay.html) and folded under Fees on the home page: it asks
// the same fees the desk charges (apps-script/NightFees.js); Venmo and Zelle open only with the key in the desk code's
// link (scripts/pay-lock.js); and the Venmo button carries the amount for who's playing, or the special's fee. The pages,
// pay.js and style.css are read as deployed (_site, scripts/lib/site-build.js), so one the deploy leaves out fails here.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { JSDOM, VirtualConsole } = require('jsdom');
const lock = require('./pay-lock.js');
const site = require('./lib/site-build');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const script = site.read('pay.js');
const payPage = site.read('pay.html');
const home = site.read('index.html');

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
const css = site.read('style.css');
assert.match(css, /\.pay-intro \{[^}]*animation: pay-intro-out[^}]*forwards;/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.pay-intro \{ display: none; \}/);
assert.ok(site.has('assets/pay-qr.svg'), 'the QR code the intro shows');

// The monthly pass button is the same Zeffy page the home page and Membership page link to.
const zeffy = /var ZEFFY = "([^"]+)"/.exec(script)[1];
assert.match(home, new RegExp('<dd>\\$65/month, auto-pay \\(<a href="' + zeffy.replace(/[.?]/g, '\\$&') + '"'), 'the Fees Play Pass link');
assert.ok(site.read('membership.html').includes('href="' + zeffy + '"'), 'the Membership page link');

// The Venmo and Zelle details are only sealed in pay.js (scripts/pay-lock.js), never readable in the repository.
const locked = /^  var LOCKED = "([A-Za-z0-9_-]*)";$/m.exec(script);
assert.ok(locked, 'pay.js has its LOCKED line');
assert.doesNotMatch(script, /\b(venmo|zelle|zelleName|venmoLast4): "/, 'no account written out in pay.js');
assert.doesNotMatch(script, /\(?\b\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/, 'no phone number in pay.js');
// Nor the desk key anywhere on the published site.
fs.readdirSync(site.dir()).filter(name => /\.(html|js|css)$/.test(name)).forEach(name => {
  assert.doesNotMatch(site.read(name), /#k=[A-Za-z0-9_-]{22}/, 'no desk key in ' + name);
});

const TEST = { venmo: 'Test-Club', venmoLast4: '1234', zelle: '5105550123', zelleName: 'Test Treasurer' };
const settle = () => new Promise(resolve => setTimeout(resolve, 50));

// A page opened at a given moment (Pacific), with pay.js sealed for TEST under testKey, from url, with a key kept or not.
function open(html, isoInstant, { sealedFor, url = 'https://concordtabletennisclub.com/pay.html', kept } = {}) {
  const code = sealedFor ? lock.setLocked(script, sealedFor) : script;
  const dom = new JSDOM(html.replace(/<script src="pay\.js\?v=\d+"><\/script>/, () => '<script>' + code + '</script>'), {
    runScripts: 'dangerously',
    virtualConsole: new VirtualConsole(), // the home page's other scripts fetch live data, which is not here
    url,
    beforeParse(window) {
      const RealDate = window.Date;
      const fixed = new RealDate(isoInstant).getTime();
      window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
      Object.defineProperty(window, 'crypto', { value: webcrypto });
      window.TextDecoder = TextDecoder;
      if (kept) window.localStorage.setItem('cttc-pay-key', kept);
    }
  });
  return dom.window;
}
const venmo = doc => new URL(doc.querySelector('.pay-venmo').href);
const SUNDAY = '2027-01-10T19:30:00-08:00';

(async () => {
  const testKey = lock.newKey();
  const sealed = await lock.seal(TEST, testKey);

  // Without the desk key (browsing the site): no Venmo or Zelle, just how to get them, and the monthly pass.
  let win = open(payPage, SUNDAY, { sealedFor: sealed });
  await settle();
  let doc = win.document;
  ['member', 'visitor', 'intro', 'junior'].forEach(kind => {
    assert.equal(doc.querySelector('[data-kind="' + kind + '"] .pay-price').textContent, '$' + desk.NIGHT_FEES[kind], kind + ' shows its fee');
  });
  assert.equal(doc.querySelector('.pay-locked').hidden, false);
  assert.equal(doc.querySelector('.pay-venmo').hidden, true);
  assert.equal(doc.querySelector('.pay-zelle').hidden, true);
  assert.equal(doc.querySelector('.pay-with').hidden, true);
  assert.equal(doc.querySelector('.pay-pass').hidden, false);
  assert.equal(doc.querySelector('.pay-zeffy').href, zeffy);
  assert.equal(doc.body.textContent.includes(TEST.zelle), false);

  // Scanned at the desk, on a Sunday: Venmo and Zelle open, the key leaves the address bar and stays on the phone.
  win = open(payPage, SUNDAY, { sealedFor: sealed, url: 'https://concordtabletennisclub.com/pay.html#k=' + testKey });
  await settle();
  doc = win.document;
  assert.equal(win.location.hash, '', 'the key is taken out of the address bar');
  assert.equal(win.localStorage.getItem('cttc-pay-key'), testKey, 'and kept on the phone');
  assert.equal(doc.querySelector('.pay-locked').hidden, true);
  assert.equal(venmo(doc).pathname, '/Test-Club');
  assert.equal(venmo(doc).searchParams.get('txn'), 'pay');
  assert.equal(venmo(doc).searchParams.get('amount'), '10');
  assert.equal(venmo(doc).searchParams.get('note'), 'CTTC member night');
  assert.match(doc.querySelector('.pay-venmo-note').textContent, /they are 1234\./);
  doc.querySelector('[data-kind="visitor"]').click();
  assert.equal(venmo(doc).searchParams.get('amount'), '15');
  assert.deepEqual([...doc.querySelectorAll('.pay-amount')].map(el => el.textContent), ['$15', '$15'], 'the heading and the Zelle panel');
  assert.equal(doc.querySelector('[data-kind="visitor"]').getAttribute('aria-checked'), 'true');
  assert.equal(doc.querySelector('.pay-zelle-address').textContent, '(510) 555-0123');
  assert.equal(doc.querySelector('.pay-zelle-name').textContent, 'Zelle shows it as Test Treasurer.');

  // A special Friday: no choice to make, everyone pays the special's fee.
  win = open(payPage, '2026-11-27T19:30:00-08:00', { sealedFor: sealed, kept: testKey });
  await settle();
  doc = win.document;
  assert.equal(doc.querySelector('.pay-kinds').hidden, true);
  assert.equal(doc.querySelector('.pay-special').hidden, false);
  assert.equal(venmo(doc).searchParams.get('amount'), '5');

  // The home page on a phone that scanned the code: the same options under Fees.
  win = open(home, SUNDAY, { sealedFor: sealed, url: 'https://concordtabletennisclub.com/', kept: testKey });
  await settle();
  doc = win.document;
  assert.equal(doc.querySelector('#pay .pay-venmo').hidden, false);
  assert.equal(venmo(doc).searchParams.get('amount'), '10');

  // A key from an old printed code opens nothing and is forgotten.
  win = open(payPage, SUNDAY, { sealedFor: sealed, kept: lock.newKey() });
  await settle();
  assert.equal(win.document.querySelector('.pay-locked').hidden, false);
  assert.equal(win.localStorage.getItem('cttc-pay-key'), null);

  console.log('Pay for tonight: fees match the desk; Venmo and Zelle open only with the desk key; the Venmo link carries the amount; on pay.html and under Fees.');
})().catch(error => { console.error(error); process.exit(1); });
