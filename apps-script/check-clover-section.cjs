// The desk's Clover card payments section (Index.html), run in jsdom with the desk's real queue and payment buttons:
// matches show as Credit ✓ on the players' buttons, the organizer ticks who a payment is for, every change goes through
// the queue, and the dry run only shows. All names, cards and amounts are made up.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(__dirname + '/Index.html', 'utf8');
function block(marker) {
  const at = html.indexOf(marker);
  assert.ok(at > 0, 'missing script: ' + marker);
  return html.slice(html.lastIndexOf('<script>', at) + 8, html.indexOf('</script>', at));
}
const outboxCode = block("var KEY = 'cttc-outbox-v1'");
const paymentsCode = block("var CACHE_PREFIX = 'cttc-payment-overview-v1:'");
const cloverCode = block("section.className = 'section clover-payments'");
const DATE = '2026-09-28';
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
// Values made in the page's window compare as plain data.
const plain = value => JSON.parse(JSON.stringify(value));

const item = (id, extra) => Object.assign({ id, time: Date.parse('2026-09-29T02:00:00Z'), clock: '7:00 PM', amount: 10, net: 10, kind: 'card', card: 'VISA \u2022\u20221234', cardholder: '', customer: '',
  state: 'unmatched', reason: '', payerId: '', playerIds: [], note: '', notePlayerId: '', suggestions: [], notCheckedIn: [], verdicts: [], recorded: false, changed: [] }, extra);
function night(enabled, items) {
  return { connected: true, enabled, date: DATE, checkedAt: Date.now(), pageUrl: 'https://script.google.com/macros/s/X/dev?view=clover',
    names: { p1: 'Avery Park', p2: 'Blake Stone', p3: 'Casey Stone', p4: 'Drew Lane' }, fees: { p1: 10, p2: 10, p3: 5, p4: 10 }, items };
}
const tonight = enabled => night(enabled, [
  item('A', { state: 'matched', reason: 'card', playerIds: ['p1'], recorded: enabled, clock: '7:02 PM' }),
  item('B', { net: 15, amount: 15, state: 'needs-action', payerId: 'p2', playerIds: ['p2'], reason: 'card', note: 'Paid $15, fee is $10: $5 more. Who else does it cover?', suggestions: ['p3'] }),
  item('C', { note: 'No player found', suggestions: ['p4'] }),
  item('D', { state: 'ignored', note: 'Refunded' })
]);

// Each page's minute check is a timer: the pages are closed at the end so the check can finish.
const opened = [];
function boot(desk) {
  const names = desk.names || night(true, []).names;
  const reads = [];
  const server = [];
  const dom = new JSDOM('<!doctype html><body><input id="date" value="' + DATE + '"><button id="load"></button><div id="status"></div><span id="network-activity"></span>' +
    '<aside class="sidebar"><section class="section zeffy-passes"><h2>Zeffy</h2></section></aside>' +
    '<div id="groups"><ul class="group-list">' + ['p1', 'p2', 'p3', 'p4'].map(id => '<li><div class="identity"><strong>' + names[id] + '</strong></div><div class="move"><button data-move="' + id + '"></button></div></li>').join('') + '</ul></div>' +
    '<div id="open-roster"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.test/' });
  const window = dom.window;
  opened.push(window);
  window.cttcTab = { retired: () => false, onRetire() {}, onResume() {} };
  window.cttcRequest = (name, ...args) => {
    reads.push(name);
    if (name === 'getPrivatePaymentOverview') return Promise.resolve({ methods: {}, coveredIds: [], passes: [] });
    if (name === 'getCloverDesk') return Promise.resolve(JSON.parse(JSON.stringify(desk)));
    return Promise.reject(new Error('unexpected ' + name));
  };
  window.google = { script: { run: { withSuccessHandler: ok => ({ withFailureHandler: bad => new Proxy({}, { get: (_, name) => (...args) => server.push({ name, args, ok, bad }) }) }) } } };
  if (!window.CSS) window.CSS = {};
  if (!window.CSS.escape) window.CSS.escape = value => String(value).replace(/["\\]/g, '\\$&');
  window.eval(outboxCode);
  window.eval(paymentsCode);
  window.eval(cloverCode);
  const $ = selector => window.document.querySelector(selector);
  const $$ = selector => Array.from(window.document.querySelectorAll(selector));
  return { window, reads, server, $, $$, button: id => $('[data-payment-player="' + id + '"] .payment-trigger') };
}

(async () => {
  // Live: placed with the other payment sections, with only what needs the organizer in the open list.
  let page = boot(tonight(true));
  await tick();
  const section = page.$('.clover-payments');
  assert.ok(section.nextElementSibling.classList.contains('zeffy-passes'), 'just above the Zeffy play passes');
  assert.equal(section.querySelector('h2 .count').textContent, '2');
  assert.deepEqual(plain(page.$$('.clover-payments > ul > li').map(li => li.getAttribute('data-clover-payment'))), ['B', 'C']);
  assert.match(page.$('.clover-payments > p.hint').textContent, /1 matched, 2 to match by hand\. Checked/);
  assert.equal(page.$('.clover-matched-group').hidden, false);
  assert.equal(page.$('.clover-aside-group summary').textContent, 'Refunds and set aside (1)');
  assert.equal(page.$('.clover-footer a').href, 'https://script.google.com/macros/s/X/dev?view=clover');

  // A recorded match is Credit ✓ on the player's own button, with when and how much.
  assert.equal(page.button('p1').textContent, 'Credit \u2713');
  assert.match(page.button('p1').title, /^Paid by credit \(Clover 7:02 PM, \$10\)/);
  assert.equal(page.button('p2').textContent, 'Payment');

  // The overpayment: the likely payer is ticked, the second player is offered, and the fees add up as they are ticked.
  const overpaid = () => page.$('li[data-clover-payment="B"]');
  const ticked = li => Array.from(li.querySelectorAll('input[data-player]')).filter(input => input.checked).map(input => input.getAttribute('data-player'));
  assert.deepEqual(plain(ticked(overpaid())), ['p2']);
  assert.equal(overpaid().querySelector('.clover-sum').textContent, 'Fees $10 of $15');
  assert.ok(overpaid().querySelector('.clover-sum').classList.contains('off'));
  overpaid().querySelector('input[data-player="p3"]').click();
  assert.deepEqual(plain(ticked(overpaid())), ['p2', 'p3']);
  assert.equal(overpaid().querySelector('.clover-sum').textContent, 'Fees $15 of $15');
  assert.ok(!overpaid().querySelector('.clover-sum').classList.contains('off'));
  assert.equal(page.window.document.activeElement.getAttribute('data-player'), 'p3', 'focus stays on the box just ticked');
  assert.equal(overpaid().querySelector('.clover-actions label'), null, 'no card to remember for a payment covering two');
  assert.deepEqual(plain(Array.from(overpaid().querySelectorAll('select option')).map(option => option.textContent)), ['Someone else checked in\u2026', 'Drew Lane'],
    'everyone else checked in and unpaid can be chosen (Avery already paid)');

  // Matching sends one queued change; the players' buttons show Credit ✓ while it is on its way.
  overpaid().querySelector('.clover-actions button.small:not(.clover-aside)').click();
  await tick();
  const sent = page.server.filter(call => call.name === 'matchCloverPayment');
  assert.equal(sent.length, 1);
  assert.deepEqual(plain(sent[0].args), [DATE, 'B', ['p2', 'p3'], false]);
  assert.match(page.$('.clover-matched-group li.saving').textContent, /Matching Blake Stone \+ Casey Stone/);
  assert.equal(page.button('p2').textContent, 'Credit \u2713');
  assert.ok(page.$('[data-payment-player="p2"]').classList.contains('unsynced'), 'not yet confirmed by Google');
  assert.equal(JSON.parse(page.window.localStorage.getItem('cttc-outbox-v1'))[0].fn, 'matchCloverPayment', 'kept on this device until Google confirms it');

  // Google confirms with the night as it now stands.
  const after = tonight(true);
  Object.assign(after.items[1], { state: 'matched', reason: 'hand', playerIds: ['p2', 'p3'], recorded: true, note: '' });
  sent[0].ok(after);
  await tick();
  assert.deepEqual(plain(page.$$('.clover-payments > ul > li').map(li => li.getAttribute('data-clover-payment'))), ['C']);
  assert.match(page.$('.clover-matched-group summary').textContent, /Matched \(2\)/);
  assert.equal(page.window.localStorage.getItem('cttc-outbox-v1'), null);
  assert.ok(page.reads.filter(name => name === 'getPrivatePaymentOverview').length >= 2, 'the payment buttons are read again from Google');

  // One player picked from tonight's list, remembered by default.
  const unmatched = () => page.$('li[data-clover-payment="C"]');
  assert.equal(unmatched().querySelector('.clover-actions button').disabled, true, 'nothing to match until someone is ticked');
  unmatched().querySelector('input[data-player="p4"]').click();
  assert.equal(unmatched().querySelector('.clover-actions label input').checked, true, 'Remember this card is on');
  unmatched().querySelector('.clover-actions button').click();
  await tick();
  assert.deepEqual(plain(page.server.filter(call => call.name === 'matchCloverPayment')[1].args), [DATE, 'C', ['p4'], true]);

  // Undo sends its own change, and the button goes back to Payment while it is sent.
  page.$('.clover-matched-group li[data-clover-payment="A"] .clover-undo').click();
  await tick();
  assert.equal(page.button('p1').textContent, 'Payment');
  page.server.filter(call => call.name === 'matchCloverPayment')[1].ok(after);
  await tick();
  assert.deepEqual(plain(page.server.filter(call => call.name === 'unmatchCloverPayment')[0].args), [DATE, 'A']);

  // Not a desk fee.
  page = boot(tonight(true));
  await tick();
  page.$('li[data-clover-payment="C"] .clover-aside').click();
  await tick();
  assert.deepEqual(plain(page.server.filter(call => call.name === 'setAsideCloverPayment')[0].args), [DATE, 'C']);

  // A change Google turns down is reported, and the list is read again.
  page.server.filter(call => call.name === 'setAsideCloverPayment')[0].bad(new Error('This Clover payment is matched: undo the match first.'));
  await tick();
  assert.match(page.window.document.getElementById('sync-note').textContent, /Setting a Clover payment aside was not saved/);
  assert.ok(page.reads.filter(name => name === 'getCloverDesk').length >= 2);

  // Dry run: shows what it would do; nothing can be pressed and no button changes.
  page = boot(tonight(false));
  await tick();
  assert.match(page.$('.clover-payments > p.hint').textContent, /^Dry run/);
  assert.equal(page.$('.clover-payments input, .clover-payments .clover-undo'), null);
  assert.match(page.$('li[data-clover-payment="B"]').textContent, /Likely Blake Stone \(card used before\)/);
  assert.match(page.$('.clover-matched-group summary').textContent, /Would match \(1\)/);
  assert.match(page.$('.clover-matched-group li').textContent, /would be Credit, by card used before/);
  assert.equal(page.button('p1').textContent, 'Payment', 'nothing recorded, so no Credit');

  // A match changed by hand afterwards waits for the organizer, who can undo it.
  const changed = tonight(true);
  changed.items[0].changed = [{ playerId: 'p1', method: 'Venmo' }];
  page = boot(changed);
  await tick();
  assert.match(page.$('li[data-clover-payment="A"]').textContent, /Avery Park was matched to this payment, then marked Venmo by hand/);
  assert.ok(page.$('li[data-clover-payment="A"] .clover-undo'));

  // Not connected: says what to set.
  page = boot({ connected: false, enabled: false, date: DATE, problem: 'Add CLOVER_API_TOKEN in the script\'s Project Settings > Script Properties.' });
  await tick();
  assert.match(page.$('.clover-payments > p.hint').textContent, /^Clover is not connected: Add CLOVER_API_TOKEN/);

  opened.forEach(window => window.close());
  console.log('Clover section checks passed');
})().catch(error => { console.error(error); process.exit(1); });
