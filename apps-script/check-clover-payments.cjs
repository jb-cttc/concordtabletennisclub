// Clover card payments (CloverPayments.js): reading Clover, and which player each payment is matched to. All names,
// cards and amounts here are made up.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const tz = 'America/Los_Angeles';
const formatDate = (date, timeZone, pattern) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true })
    .formatToParts(date).map(part => [part.type, part.value]));
  if (pattern === 'yyyy-MM-dd') return parts.year + '-' + parts.month + '-' + parts.day;
  if (pattern === 'h:mm a') return parts.hour + ':' + parts.minute + ' ' + parts.dayPeriod;
  throw new Error('unexpected pattern ' + pattern);
};
const properties = {};
const fetched = [];
let clover = { payments: [], orders: [], customers: {} };
let status = 200;
const respond = (body, code) => ({ getResponseCode: () => code || status, getContentText: () => JSON.stringify(body) });
const route = request => {
  const url = new URL(request.url);
  fetched.push({ url: request.url, auth: request.headers.Authorization });
  const path = url.pathname.replace(/^\/v3\/merchants\/[^/]+/, '');
  if (path === '/payments') return respond({ elements: clover.payments });
  if (path === '/orders') return respond({ elements: clover.orders });
  const customer = /^\/customers\/(.+)$/.exec(path);
  if (customer) return respond(clover.customers[decodeURIComponent(customer[1])]);
  throw new Error('unexpected Clover path ' + path);
};
const sheets = {
  Players: [
    { player_id: 'p1', display_name: 'Avery Park', active: true },
    { player_id: 'p2', display_name: 'Dana Chen', active: true },
    { player_id: 'p3', display_name: 'Robert Lee', active: true },
    { player_id: 'p4', display_name: 'Jordan Smith', active: true },
    { player_id: 'p5', display_name: 'Jamie Smith', active: true },
    { player_id: 'p6', display_name: 'Kai Park', active: true },
    { player_id: 'p7', display_name: 'Old Member', active: false }
  ],
  SessionPlayers: [],
  SessionPayments: [],
  NameLinks: []
};
const context = {
  TABLES: {},
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] === undefined ? null : properties[key] }) },
  UrlFetchApp: { fetch: (url, options) => route({ url, ...options }), fetchAll: requests => requests.map(route) },
  Utilities: { formatDate },
  Session: { getScriptTimeZone: () => tz },
  SpreadsheetApp: { getActive: () => ({ getSheetByName: name => sheets[name] ? {} : null }) },
  rows_: name => sheets[name].map((row, index) => ({ ...row, __row: index + 2 })),
  cashRows_: name => (sheets[name] || []).map((row, index) => ({ ...row, __row: index + 2 })),
  cashDate_: value => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date'); return Date.parse(value + 'T00:00:00Z'); },
  listPlayers: rows => rows.filter(p => p.active).map(p => ({ playerId: p.player_id, name: p.display_name })),
  playerAliases_: () => ({ 'bobby lee': 'p3' }),
  getMemberStatuses: () => ({ statuses: { p1: 'member', p2: 'visitor', p3: 'member', p4: 'member', p5: 'member', p6: 'junior' } }),
  cashZeffyCoverage_: () => date => (date === '2026-10-05' ? { p2: true } : {}),
  normalizeName_: value => String(value || '').trim().replace(/\s+/g, ' ')
};
vm.createContext(context);
for (const file of ['LinkedNames.js', 'CloverPayments.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context);
const plain = value => JSON.parse(JSON.stringify(value));

// Evening times in club time: 7 PM Pacific is 02:00 UTC the next day.
const at = (date, hour, minute) => Date.parse(date + 'T00:00:00Z') + 86400000 + (hour - 17) * 3600000 + (minute || 0) * 60000;
let nextId = 1;
const payment = (date, dollars, card, extra) => ({
  id: 'PAY' + nextId++, amount: dollars * 100, result: 'SUCCESS', createdTime: at(date, 19, nextId), order: { id: 'ORD' + nextId },
  cardTransaction: card === null ? undefined : { cardType: 'VISA', first6: '411111', last4: '1234', cardholderName: '', ...card },
  tender: card === null ? { label: 'Cash' } : { label: 'Credit Card' }, ...extra
});
const normal = (raw, customers) => context.cloverPayment_(raw, customers || {}, tz);

// Reading a payment.
let p = normal(payment('2026-10-07', 10, { cardholderName: 'PARK/AVERY' }));
assert.equal(p.date, '2026-10-07', 'an evening payment belongs to that night in club time, not the UTC date');
assert.match(p.clock, /^7:\d\d PM$/);
assert.equal(p.kind, 'card');
assert.equal(p.state, 'paid');
assert.equal(p.net, 1000);
assert.equal(normal(payment('2026-10-07', 10, {}, { refunds: { elements: [{ amount: 1000 }] } })).state, 'refunded');
assert.equal(normal(payment('2026-10-07', 15, {}, { refunds: { elements: [{ amount: 500 }] } })).net, 1000, 'a part refund leaves the rest');
assert.equal(normal(payment('2026-10-07', 10, {}, { result: 'VOIDED' })).state, 'voided');
assert.equal(normal(payment('2026-10-07', 10, {}, { result: 'FAIL' })).state, 'failed');
assert.equal(normal(payment('2026-10-07', 10, {}, { result: 'PENDING' })).state, 'pending');
assert.equal(normal(payment('2026-10-07', 10, null)).kind, 'cash');
assert.equal(normal(payment('2026-10-07', 10, { first6: '41**11' })).first6, '', 'only real digits are kept');

// Names on cards.
assert.equal(context.cloverNameKey_('PARK/AVERY'), 'avery park');
assert.equal(context.cloverNameKey_('LEE/ROBERT J'), 'robert j lee');
assert.equal(context.cloverNameKey_('VALUED CUSTOMER'), '', 'placeholders are not names');
assert.equal(context.cloverNameKey_('CARDHOLDER/VISA'), '');
assert.deepEqual(plain(context.cloverNameTokens_('robert j lee jr')), ['robert', 'lee']);
const players = context.listPlayers(sheets.Players);
const index = context.cloverPlayerIndex_(players, context.playerAliases_());
const byName = name => plain(context.cloverByName_(name, index));
assert.deepEqual(byName('AVERY PARK'), { playerId: 'p1', reason: 'name' });
assert.deepEqual(byName('PARK/AVERY Q'), { playerId: 'p1', reason: 'name' }, 'a middle initial on the card still matches');
assert.deepEqual(byName('BOBBY LEE'), { playerId: 'p3', reason: 'name' }, 'a saved alias matches');
assert.deepEqual(byName('A PARK'), { playerId: 'p1', reason: 'initial' }, 'initial and last name when one player fits');
assert.deepEqual(byName('ROB LEE'), { playerId: 'p3', reason: 'initial' }, 'a shortened first name fits');
assert.deepEqual(byName('J SMITH').candidates.sort(), ['p4', 'p5'], 'two J. Smiths: no match');
assert.deepEqual(byName('RACHEL LEE'), { candidates: [] }, 'a different first name is not the same person');
assert.deepEqual(byName('OLD MEMBER'), { candidates: [] }, 'archived players are never matched');

// One night.
const night = (payments, extra) => plain(context.cloverMatchNight_(payments.map(raw => normal(raw.raw || raw, raw.customers)), {
  index, links: {}, paysFor: {}, statuses: context.getMemberStatuses().statuses, covered: {}, roster: { p1: true, p3: true, p4: true, p6: true }, hand: {}, ...extra
}));
let rows = night([payment('2026-10-07', 10, { cardholderName: 'PARK/AVERY' })]);
assert.equal(rows[0].state, 'matched');
assert.deepEqual(rows[0].playerIds, ['p1']);
assert.equal(rows[0].reason, 'name');
rows = night([payment('2026-10-07', 15, { cardholderName: 'PARK/AVERY' })]);
assert.equal(rows[0].state, 'needs-action', 'an overpayment waits for the organizer');
assert.equal(rows[0].payerId, 'p1');
assert.match(rows[0].note, /Paid \$15, fee is \$10: \$5 more/);
rows = night([payment('2026-10-07', 5, { cardholderName: 'AVERY PARK' })]);
assert.equal(rows[0].state, 'needs-action', 'an underpayment waits for the organizer');
rows = night([payment('2026-10-07', 10, { cardholderName: 'J SMITH' })]);
assert.equal(rows[0].state, 'unmatched');
assert.match(rows[0].note, /more than one player/);
assert.deepEqual(rows[0].suggestions, ['p4', 'p1', 'p3'], 'the checked-in Smith comes first, then others owing $10; the absent Smith is left out');
rows = night([payment('2026-10-07', 10, { cardholderName: '' })]);
assert.equal(rows[0].state, 'unmatched');
assert.deepEqual(rows[0].suggestions.sort(), ['p1', 'p3', 'p4'], 'checked-in players owing $10');
rows = night([payment('2026-10-07', 10, { cardholderName: 'AVERY PARK' })], { hand: { p1: 'cash' } });
assert.equal(rows[0].state, 'needs-action', 'a method chosen by hand always wins');
assert.match(rows[0].note, /\{player\} is already marked cash/);
assert.equal(night([payment('2026-10-07', 10, { cardholderName: 'AVERY PARK' })], { hand: { p1: 'credit' } })[0].state, 'matched', 'Credit by hand agrees');
rows = night([payment('2026-10-07', 10, { cardholderName: 'AVERY PARK' }), payment('2026-10-07', 10, { cardholderName: 'AVERY PARK', last4: '9999' })]);
assert.deepEqual(rows.map(row => row.state), ['matched', 'needs-action'], 'one player is matched to one payment a night');
rows = night([payment('2026-10-07', 15, { cardholderName: 'DANA CHEN' })], { covered: { p2: true } });
assert.equal(rows[0].state, 'needs-action', 'a Zeffy pass holder paying on Clover is asked about');
rows = night([payment('2026-10-07', 15, { cardholderName: 'DANA CHEN' })]);
assert.equal(rows[0].state, 'matched', 'paid before checking in still matches');
assert.deepEqual(rows[0].notCheckedIn, ['p2']);
rows = night([payment('2026-10-07', 10, {}, { refunds: { elements: [{ amount: 1000 }] } }), payment('2026-10-07', 10, null)]);
assert.deepEqual(rows.map(row => row.state), ['ignored', 'ignored'], 'refunds and cash are never matched');

// Links: a card matched before, an ambiguous card, a Clover customer.
const cardKey = 'card:VISA|411111|1234';
rows = night([payment('2026-10-07', 10, { cardholderName: '' })], { links: { [cardKey]: 'p3' } });
assert.equal(rows[0].state, 'matched');
assert.equal(rows[0].reason, 'card');
assert.deepEqual(rows[0].playerIds, ['p3'], 'a card matched before wins even with no name');
rows = night([payment('2026-10-07', 10, { cardholderName: 'AVERY PARK' })], { links: { [cardKey]: 'p3' } });
assert.deepEqual(rows[0].playerIds, ['p3'], 'the card link wins over the name (a spouse paying)');
rows = night([payment('2026-10-07', 10, { cardholderName: '' })], { links: { [cardKey]: null } });
assert.match(rows[0].note, /paid for more than one player/);
const links = {};
context.cloverRemember_(links, [cardKey], 'p1');
context.cloverRemember_(links, [cardKey], 'p1');
assert.equal(links[cardKey], 'p1');
context.cloverRemember_(links, [cardKey], 'p3');
assert.equal(links[cardKey], null, 'a card used for two players stops matching');
const customers = { ORD900: { id: 'C1', name: 'Robert Lee', phones: ['(925) 555-0100'], emails: ['rl@example.com'] } };
const withCustomer = { raw: payment('2026-10-07', 10, { cardholderName: '' }, { order: { id: 'ORD900' } }), customers };
assert.deepEqual(plain(context.cloverPaymentKeys_(normal(withCustomer.raw, customers))), [cardKey, 'customer:C1', 'phone:9255550100', 'email:rl@example.com']);
rows = night([withCustomer]);
assert.equal(rows[0].reason, 'customer-name', 'the Clover customer name is used when the card has none');
rows = night([withCustomer], { links: { 'phone:9255550100': 'p4' } });
assert.deepEqual([rows[0].playerIds, rows[0].reason], [['p4'], 'phone']);

// pays_for: a payer and the players they pay for.
const paysFor = { p1: ['p6'] };
rows = night([payment('2026-10-07', 15, { cardholderName: 'AVERY PARK' })], { paysFor });
assert.deepEqual([rows[0].state, rows[0].playerIds, rows[0].reason], ['matched', ['p1', 'p6'], 'pays-for'], 'member and junior together');
rows = night([payment('2026-10-07', 5, { cardholderName: 'AVERY PARK' })], { paysFor });
assert.deepEqual(rows[0].playerIds, ['p6'], 'paying only for the junior');
assert.equal(rows[0].payerId, 'p1');
rows = night([payment('2026-10-07', 20, { cardholderName: 'AVERY PARK' })], { paysFor });
assert.equal(rows[0].state, 'needs-action', 'an amount no group fits waits for the organizer');

sheets.NameLinks = [{ kind: 'pays_for', name: 'Avery Park', linked_name: 'Kai Park' }, { kind: 'pays_for', name: 'Avery Park', linked_name: 'Nobody Here' }];
assert.deepEqual(plain(context.cloverPaysFor_(players, context.nameLinkRows_())), paysFor, 'NameLinks pays_for rows, by name; an unknown name is skipped');
sheets.NameLinks = [];

// Learning from the record by hand.
const review = (payments, hand, linkStore) => {
  const ctx = { index, links: linkStore, paysFor: {}, statuses: context.getMemberStatuses().statuses, covered: {}, roster: { p1: true, p3: true, p4: true, p6: true }, hand };
  const result = context.cloverMatchNight_(payments.map(raw => normal(raw)), ctx);
  const left = context.cloverReviewNight_(result, ctx, linkStore);
  return { rows: plain(result), left: plain(left) };
};
let store = {};
let reviewed = review([payment('2026-10-07', 10, { cardholderName: 'AVERY PARK', last4: '1111' }), payment('2026-10-07', 5, { cardholderName: '', last4: '2222' })], { p1: 'credit', p6: 'credit', p3: 'credit' }, store);
assert.equal(reviewed.rows[0].verdicts[0].verdict, 'agrees');
assert.equal(reviewed.rows[1].learnedPlayerId, 'p6', 'the only $5 payment and the only $5 Credit player are paired');
assert.deepEqual(reviewed.left, ['p3'], 'Credit by hand with no Clover payment is reported');
assert.equal(store['card:VISA|411111|1111'], 'p1', 'a matched card is remembered');
assert.equal(store['card:VISA|411111|2222'], 'p6');
reviewed = review([payment('2026-10-14', 5, { cardholderName: '', last4: '2222' })], { p6: 'credit' }, store);
assert.deepEqual([reviewed.rows[0].state, reviewed.rows[0].reason], ['matched', 'card'], 'the next week the learned card matches on its own');
reviewed = review([payment('2026-10-07', 10, { cardholderName: '', last4: '3333' }), payment('2026-10-07', 10, { cardholderName: '', last4: '4444' })], { p3: 'credit', p4: 'credit' }, {});
assert.ok(reviewed.rows.every(row => !row.learnedPlayerId), 'two payments and two players at one amount are never guessed');
reviewed = review([payment('2026-10-07', 10, { cardholderName: 'AVERY PARK' })], { p1: 'venmo' }, {});
assert.equal(reviewed.rows[0].state, 'needs-action');

// Configuration and errors never show the token.
assert.match(context.cloverConfigProblem_({ token: '', merchant: '' }), /CLOVER_API_TOKEN and CLOVER_MERCHANT_ID/);
assert.match(context.cloverConfigProblem_({ token: 'x', merchant: 'bad/id' }), /does not look like/);
assert.equal(context.cloverConfigProblem_({ token: 'x', merchant: 'ABC123DEF4567' }), '');
for (const code of [401, 403, 404, 429, 500]) {
  assert.throws(() => context.cloverResponse_(respond({ message: 'secret-token-value' }, code)), error => !/secret-token-value/.test(error.message));
}

// The report: reads Clover with the token, groups by night, compares with the record, and writes nothing.
let report = context.getCloverReport('2026-10-05', '2026-10-07');
assert.equal(report.connected, false, 'without the settings the page says what to add');
properties.CLOVER_API_TOKEN = 'test-token';
properties.CLOVER_MERCHANT_ID = 'ABC123DEF4567';
assert.throws(() => context.getCloverReport('2026-10-07', '2026-10-05'), /on or before/);
assert.throws(() => context.getCloverReport('2026-01-01', '2026-10-05'), /at most 85 days/);
sheets.SessionPlayers = [
  { session_id: 'session-2026-10-05', player_id: 'p1' }, { session_id: 'session-2026-10-05', player_id: 'p2' },
  { session_id: 'session-2026-10-07', player_id: 'p1' }, { session_id: 'session-2026-10-07', player_id: 'p3' }, { session_id: 'session-2026-10-07', player_id: 'p6' },
  { session_id: 'session-2026-09-30', player_id: 'p1' }
];
sheets.SessionPayments = [
  { session_id: 'session-2026-10-05', player_id: 'p1', method: 'credit' },
  { session_id: 'session-2026-10-07', player_id: 'p1', method: 'cash' },
  { session_id: 'session-2026-10-07', player_id: 'p6', method: 'credit' }
];
clover = {
  payments: [
    payment('2026-10-05', 10, { cardholderName: 'PARK/AVERY', last4: '1111' }),
    payment('2026-10-05', 15, { cardholderName: 'DANA CHEN', last4: '5555' }),
    payment('2026-10-07', 10, { cardholderName: '', last4: '1111' }),
    payment('2026-10-07', 5, { cardholderName: '', last4: '6666' }),
    payment('2026-10-07', 10, { cardholderName: 'ROBERT LEE', last4: '7777' }, { refunds: { elements: [{ amount: 1000 }] } }),
    payment('2026-10-09', 10, { cardholderName: 'PARK/AVERY', last4: '1111' })
  ],
  orders: [],
  customers: {}
};
report = plain(context.getCloverReport('2026-10-05', '2026-10-07'));
assert.ok(fetched.every(call => call.auth === 'Bearer test-token'));
const paymentsCall = fetched.find(call => /\/payments\?/.test(call.url));
assert.match(paymentsCall.url, /^https:\/\/api\.clover\.com\/v3\/merchants\/ABC123DEF4567\/payments\?filter=createdTime%3E%3D\d+&filter=createdTime%3C\d+&expand=cardTransaction%2Crefunds&limit=1000&offset=0$/);
assert.deepEqual(report.nights.map(n => n.date), ['2026-10-07', '2026-10-05'], 'newest night first; a payment after the range is left out');
const oct5 = report.nights[1];
assert.deepEqual(oct5.rows.map(row => [row.state, row.verdicts.map(v => v.verdict).join()]), [['matched', 'agrees'], ['needs-action', '']], 'the Zeffy holder paying is asked about');
const oct7 = report.nights[0];
assert.deepEqual(oct7.rows.map(row => row.state), ['needs-action', 'unmatched', 'ignored'], 'the learned card meets a hand-chosen Cash; the refund is left alone');
assert.equal(oct7.rows[0].reason, 'card', 'the card learned on Oct 5 is recognised on Oct 7');
assert.equal(oct7.rows[1].learnedPlayerId, 'p6');
assert.equal(oct7.rows[0].card, 'VISA ••1111');
assert.equal(report.totals.cardPayments, 4);
assert.equal(report.totals.matched, 1);
assert.equal(report.totals.agrees, 1);
assert.equal(report.totals.needsAction, 2);
assert.equal(report.totals.learned, 1);
assert.equal(report.totals.ignored, 1);
assert.equal(report.names.p1, 'Avery Park');
assert.equal(report.enabled, false);
assert.ok(!('CloverLinks' in sheets), 'the report never adds a tab');

console.log('Clover payment checks passed');
