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
// The site's files and the turnout app are faked: fetch answers closures.json, the player list and the turnout app's
// checkout (answer), and keeps every request. A move to Clover is caught as jsdom's navigation notice.
const DIRECTORY = ['Ada Every', 'Adam Evans', 'Bo Mondays', 'José Núñez'];
const PREPAY_URL = /var PREPAY_URL = "([^"]+)"/.exec(script)[1];
function open(html, isoInstant, { sealedFor, url = 'https://concordtabletennisclub.com/pay.html', kept, closures = { days: {} }, answer = { ok: true, href: 'https://checkout.clover.com/pay/abc' } } = {}) {
  const code = sealedFor ? lock.setLocked(script, sealedFor) : script;
  const turnout = site.read('turnout.js');
  const requests = [];
  const navigations = [];
  const virtualConsole = new VirtualConsole(); // the home page's other scripts fetch live data, which is not here
  virtualConsole.on('jsdomError', error => { if (/navigation/i.test(error.message)) navigations.push(error.message); });
  const dom = new JSDOM(html.replace(/<script src="pay\.js\?v=\d+"><\/script>/, () => '<script>' + code + '</script>')
    .replace('<script src="turnout.js"></script>', () => '<script>' + turnout + '</script>'), {
    runScripts: 'dangerously',
    virtualConsole,
    url,
    beforeParse(window) {
      window.fetch = (address, options) => {
        requests.push({ address: String(address), options });
        const body = /closures\.json$/.test(address) ? closures : /player-index\.json$/.test(address) ? DIRECTORY
          : String(address).indexOf(PREPAY_URL) === 0 ? answer : null;
        if (body === null) return Promise.reject(new Error('offline'));
        return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(JSON.stringify(body))) });
      };
      const RealDate = window.Date;
      const fixed = new RealDate(isoInstant).getTime();
      window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
      Object.defineProperty(window, 'crypto', { value: webcrypto });
      window.TextDecoder = TextDecoder;
      if (kept) window.localStorage.setItem('cttc-pay-key', kept);
    }
  });
  dom.window.requests = requests;
  dom.window.navigations = navigations;
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


  // ---- Card, ahead of time ----
  // The page asks the same turnout app as the Tonight page, and the text page offers it.
  assert.equal(PREPAY_URL, /var TURNOUT_URL = "([^"]+)"/.exec(site.read('tonight.html'))[1], 'pay.js asks the released turnout app');
  assert.match(payPage, /<script src="turnout\.js"><\/script>\s*<script src="pay\.js/, 'pay.html knows the round robin days');
  assert.match(home, /<script src="turnout\.js"><\/script>\s*<script src="pay\.js/, 'so does the home page');
  assert.match(site.read('text.html'), /<a class="text-cttc-pay" href="pay\.html#card">/);

  // The pilot's small link in "Want to be included?" on the home and Round Robins pages: only while paying ahead is open.
  // On the home page it opens Pay now there, with the card open; the Round Robins page has no Pay now, so it goes to pay.html.
  const rr = site.read('roundrobins.html');
  assert.match(home, /<a class="tonight-pilot" href="#pay" data-open-pay data-open-card data-prepay-link hidden>/);
  assert.match(rr, /<a class="tonight-pilot" href="pay\.html#card" data-prepay-link hidden>/);
  for (const html of [home, rr]) assert.match(html, /<script src="turnout\.js"><\/script>\s*<script src="pay\.js\?v=\d+"><\/script>/);
  for (const [when, shown] of [[SUNDAY, false], ['2026-11-23T10:00:00-08:00', true], ['2026-11-23T20:30:00-08:00', false]]) {
    win = open(rr, when, { url: 'https://concordtabletennisclub.com/roundrobins.html' });
    await settle();
    assert.equal(win.document.querySelector('[data-prepay-link]').hidden, !shown, 'Round Robins page at ' + when);
  }
  win = open(home, '2026-11-23T10:00:00-08:00', { url: 'https://concordtabletennisclub.com/' });
  await settle();
  assert.equal(win.document.querySelector('[data-prepay-link]').hidden, false, 'home page on a round robin morning');
  assert.equal(win.document.getElementById('pay').open, false);
  win.document.querySelector('[data-prepay-link]').click();
  assert.equal(win.document.getElementById('pay').open, true, 'the pilot link opens Pay now');
  assert.equal(win.document.querySelector('#pay .pay-card-panel').hidden, false, 'with the card open');


  // Not a round robin day: no card button, just when it works.
  win = open(payPage, SUNDAY);
  await settle();
  assert.equal(win.document.querySelector('.pay-card').hidden, true);
  assert.equal(win.document.querySelector('.pay-card-pilot').hidden, true, 'and no pilot note');

  // Monday morning: pick a name from the directory, see what you pay, confirm.
  const MONDAY = '2026-11-23T10:00:00-08:00';
  win = open(payPage, MONDAY);
  await settle();
  doc = win.document;
  const cardButton = doc.querySelector('.pay-card');
  assert.equal(cardButton.hidden, false);
  assert.equal(doc.querySelector('.pay-card-pilot').hidden, false, 'marked as a pilot');
  assert.match(cardButton.textContent, /^Pilot Pay ahead by card$/);
  assert.ok(doc.querySelector('.pay-pilot').compareDocumentPosition(doc.querySelector('.pay-locked')) & win.Node.DOCUMENT_POSITION_PRECEDING, 'after Venmo and Zelle, not before');
  cardButton.click();
  await settle();
  const typeName = text => {
    const input = doc.querySelector('.pay-card-name');
    input.value = text;
    input.dispatchEvent(new win.Event('input'));
  };
  typeName('ada ev');
  await settle();
  assert.deepEqual([...doc.querySelectorAll('.pay-card-match')].map(b => b.textContent), ['Ada Every', 'Adam Evans'], 'every word starts a word of the name');
  assert.equal(doc.querySelector('.pay-card-new').hidden, false, 'not an exact name: they may be new');
  assert.equal(doc.querySelector('.pay-card-review').hidden, true, 'nothing to pay until a name is chosen');
  doc.querySelector('.pay-card-match').click();
  assert.equal(doc.querySelector('.pay-card-review').hidden, false);
  assert.equal(doc.querySelector('.pay-card-who').textContent, 'Ada Every · Member · round robin Mon, Nov 23 Change');
  assert.equal(doc.querySelector('.pay-card-go').textContent, 'Pay $10 by card');
  doc.querySelector('[data-kind="visitor"]').click();
  assert.equal(doc.querySelector('.pay-card-who').textContent, 'Ada Every · Visitor · round robin Mon, Nov 23 Change');
  assert.equal(doc.querySelector('.pay-card-go').textContent, 'Pay $15 by card');
  doc.querySelector('.pay-card-go').click();
  assert.equal(doc.querySelector('.pay-card-go').disabled, true, 'pressed once');
  await settle();
  // What the page sends is what the player confirmed: the name, the fee, today and the amount on the button.
  const asked = win.requests.filter(r => r.address.indexOf(PREPAY_URL) === 0);
  assert.equal(asked.length, 1);
  const sentParams = new URL(asked[0].address).searchParams;
  assert.deepEqual(Object.fromEntries(sentParams), { prepay: '1', name: 'Ada Every', kind: 'visitor', date: '2026-11-23', amount: '15' });
  assert.equal(asked[0].options.credentials, 'omit');
  assert.equal(win.navigations.length, 1, 'then off to Clover');
  assert.equal(win.localStorage.getItem('cttc-pay-name'), 'Ada Every', 'the name is kept for next time');

  // Next time the name is already chosen; a new player types theirs.
  win = open(payPage, MONDAY, { answer: { ok: false, reason: 'changed', error: 'Tonight’s price is $10. Reload the page and try again.' } });
  win.localStorage.setItem('cttc-pay-name', 'Ada Every');
  await settle();
  doc = win.document;
  doc.querySelector('.pay-card').click();
  await settle();
  assert.equal(doc.querySelector('.pay-card-who').textContent.indexOf('Ada Every'), 0);
  doc.querySelector('.pay-card-change').click();
  typeName('  Zed   Newcomer ');
  await settle();
  assert.equal(doc.querySelectorAll('.pay-card-match').length, 0);
  assert.equal(doc.querySelector('.pay-card-new').textContent, 'Not in the list? I’m new: use “Zed Newcomer”');
  doc.querySelector('[data-kind="intro"]').click();
  doc.querySelector('.pay-card-new').click();
  assert.equal(doc.querySelector('.pay-card-who').textContent, 'Zed Newcomer · First visit · round robin Mon, Nov 23 Change');
  doc.querySelector('.pay-card-go').click();
  await settle();
  assert.equal(new URL(win.requests.filter(r => r.address.indexOf(PREPAY_URL) === 0)[0].address).searchParams.get('name'), 'Zed Newcomer');
  // The turnout app said no: its reason is shown, nothing opens, and the button works again.
  assert.equal(doc.querySelector('.pay-card-error').hidden, false);
  assert.match(doc.querySelector('.pay-card-error').textContent, /Tonight’s price is \$10/);
  assert.equal(win.navigations.length, 0);
  assert.equal(doc.querySelector('.pay-card-go').disabled, false);

  // Only a Clover address is followed.
  win = open(payPage, MONDAY, { answer: { ok: true, href: 'https://example.com/clover.com/' } });
  win.localStorage.setItem('cttc-pay-name', 'Ada Every');
  await settle();
  win.document.querySelector('.pay-card').click();
  win.document.querySelector('.pay-card-go').click();
  await settle();
  assert.equal(win.navigations.length, 0);
  assert.match(win.document.querySelector('.pay-card-error').textContent, /not available right now/);

  // From the text page (#card), the card opens by itself.
  win = open(payPage, MONDAY, { url: 'https://concordtabletennisclub.com/pay.html#card' });
  await settle();
  assert.equal(win.document.querySelector('.pay-card-panel').hidden, false);

  // 8:30 PM, a closed night, or a Friday: no card. A Saturday special: $5.
  for (const [when, days, why] of [['2026-11-23T20:30:00-08:00', {}, '8:30 PM'], [MONDAY, { '2026-11-23': 'full' }, 'closed'], ['2026-11-27T10:00:00-08:00', {}, 'Friday']]) {
    win = open(payPage, when, { closures: { days } });
    await settle();
    assert.equal(win.document.querySelector('.pay-card').hidden, true, why);
  }
  win = open(payPage, '2026-11-28T10:00:00-08:00');
  win.localStorage.setItem('cttc-pay-name', 'Ada Every');
  await settle();
  win.document.querySelector('.pay-card').click();
  assert.equal(win.document.querySelector('.pay-card-go').textContent, 'Pay $5 by card');
  assert.match(win.document.querySelector('.pay-card-who').textContent, /Tonight’s special · round robin Sat, Nov 28/);

  // Back from Clover.
  win = open(payPage, MONDAY, { url: 'https://concordtabletennisclub.com/pay.html?paid=2026-11-23' });
  await settle();
  assert.match(win.document.querySelector('.pay-back-paid').textContent, /^Paid for tonight by card\. Just check in at the desk\./);
  assert.match(win.document.querySelector('.pay-back-paid a').getAttribute('href'), /^sms:/, 'and a reminder to text, so they count on the Tonight page');
  win = open(payPage, MONDAY, { url: 'https://concordtabletennisclub.com/pay.html?prepay=cancelled' });
  await settle();
  assert.equal(win.document.querySelector('.pay-back').textContent, 'Card payment cancelled. Nothing was charged.');
  win = open(payPage, MONDAY, { url: 'https://concordtabletennisclub.com/pay.html?prepay=failed' });
  await settle();
  assert.match(win.document.querySelector('.pay-back').textContent, /did not go through/);

  console.log('Pay for tonight: fees match the desk; Venmo and Zelle open only with the desk key; the Venmo link carries the amount; on pay.html and under Fees.');
})().catch(error => { console.error(error); process.exit(1); });
