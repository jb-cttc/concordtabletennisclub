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
let throttle = 0;
const slept = [];
const respond = (body, code) => ({ getResponseCode: () => code || status, getContentText: () => JSON.stringify(body) });
const route = request => {
  const url = new URL(request.url);
  fetched.push({ url: request.url, auth: request.headers.Authorization });
  if (throttle > 0) { throttle -= 1; return respond({}, 429); }
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
  Utilities: { formatDate, sleep: ms => slept.push(ms) },
  Session: { getScriptTimeZone: () => tz },
  SpreadsheetApp: { getActive: () => ({ getSheetByName: name => sheets[name] ? {} : null }) },
  rows_: name => sheets[name].map((row, index) => ({ ...row, __row: index + 2 })),
  cashRows_: name => (sheets[name] || []).map((row, index) => ({ ...row, __row: index + 2 })),
  displayDate_: value => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value)),
  cashDate_: value => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date'); return Date.parse(value + 'T00:00:00Z'); },
  listPlayers: rows => rows.filter(p => p.active).map(p => ({ playerId: p.player_id, name: p.display_name })),
  playerAliases_: () => ({ 'bobby lee': 'p3' }),
  getMemberStatuses: () => ({ statuses: { p1: 'member', p2: 'visitor', p3: 'member', p4: 'member', p5: 'member', p6: 'junior' } }),
  cashZeffyCoverage_: () => date => (date === '2026-10-05' ? { p2: true } : {}),
  normalizeName_: value => String(value || '').trim().replace(/\s+/g, ' ')
};
vm.createContext(context);
for (const file of ['LinkedNames.js', 'NightFees.js', 'CloverPayments.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context);
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
assert.match(rows[0].note, /\{player\} is already marked Cash \(paid twice\?\)/);
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

// Comparing a night with the record by hand.
const ctx7 = { index, links: {}, paysFor: {}, statuses: context.getMemberStatuses().statuses, covered: {}, roster: { p1: true, p3: true, p4: true, p6: true }, hand: { p1: 'credit', p3: 'credit', p4: 'venmo' } };
let reviewedRows = context.cloverMatchNight_([normal(payment('2026-10-07', 10, { cardholderName: 'AVERY PARK' })), normal(payment('2026-10-07', 10, { cardholderName: 'J SMITH' }))], ctx7);
let left = plain(context.cloverReviewNight_(reviewedRows, ctx7));
assert.equal(plain(reviewedRows)[0].verdicts[0].verdict, 'agrees');
assert.deepEqual(left, ['p3'], 'Credit by hand with no Clover payment is reported');

// Learning cards from the record by hand, across nights.
const statuses = context.getMemberStatuses().statuses;
const card = (date, dollars, last4) => normal(payment(date, dollars, { cardholderName: '', last4 }));
const learn = nights => plain(context.cloverLearnCards_(nights.map(([date, payments, credit]) => ({ date, payments, credit })), statuses));
let learnt = learn([
  ['2026-10-05', [card('2026-10-05', 10, '1001'), card('2026-10-05', 10, '1002')], ['p1', 'p3']],
  ['2026-10-07', [card('2026-10-07', 10, '1001'), card('2026-10-07', 10, '1004'), card('2026-10-07', 10, '1004')], ['p1', 'p4', 'p6']],
  ['2026-10-12', [card('2026-10-12', 10, '1001'), card('2026-10-12', 10, '1004')], ['p1', 'p4']],
  ['2026-10-14', [card('2026-10-14', 5, '1005'), card('2026-10-14', 10, '1006')], ['p6']],
  ['2026-10-19', [card('2026-10-19', 5, '1005')], []],
  ['2026-10-21', [card('2026-10-21', 5, '1005'), card('2026-10-21', 10, '1007')], ['p5']],
  ['2026-10-23', [card('2026-10-23', 10, '1008')], []]
]);
const linkOf = last4 => learnt.links['card:VISA|411111|' + last4];
const cardOf = last4 => learnt.cards.find(c => c.key === 'card:VISA|411111|' + last4);
assert.equal(linkOf('1001'), 'p1', 'the one player marked Credit at $10 on all three nights the card paid');
assert.equal(linkOf('1002'), 'p3', 'p1 is taken by the other card that night, which leaves p3');
assert.equal(linkOf('1004'), 'p4', 'the night it paid twice says nothing; on Oct 12 p1 is taken by the other card, which leaves p4');
assert.equal(linkOf('1005'), undefined, 'the $5 card fits p6 on Oct 14 but nobody on Oct 21: a record is missing or the card is shared, so no link');
assert.equal(cardOf('1005').candidates.length, 0);
assert.equal(cardOf('1005').nights, 2, 'Oct 19 had nothing marked Credit, so it is no clue');
assert.equal(linkOf('1006'), undefined, 'nobody was marked Credit at $10 on Oct 14');
assert.equal(linkOf('1007'), 'p5', 'a single night with one player at that fee');
assert.deepEqual(cardOf('1002').why.ruledOut, [{ playerId: 'p1', reason: 'other-card', date: '2026-10-05', card: 'card:VISA|411111|1001' }], 'why: p1\'s own card paid that night');
assert.deepEqual(cardOf('1001').why.nights.map(night => [night.date, night.amount, night.credit.join()]), [['2026-10-05', 10, 'p1,p3'], ['2026-10-07', 10, 'p1,p4'], ['2026-10-12', 10, 'p1,p4']]);
assert.deepEqual(cardOf('1001').why.ruledOut, [{ playerId: 'p3', reason: 'not-credit', date: '2026-10-07' }, { playerId: 'p4', reason: 'not-credit', date: '2026-10-05' }]);
assert.equal(cardOf('1008').nights, 0, 'only paid on a night with no Credit recorded');
// Two cards the same night both left with only one player: the records cannot say which is theirs, so neither is
// linked, whichever card is looked at first.
for (const order of [['4002', '4003'], ['4003', '4002']]) {
  learnt = learn([
    ['2026-10-14', [card('2026-10-14', 10, '4001')].concat(order.map(last4 => card('2026-10-14', 10, last4))), ['p1', 'p3']],
    ['2026-10-19', [card('2026-10-19', 10, '4001')], ['p1']]
  ]);
  assert.equal(linkOf('4001'), 'p1', 'p1 is the only $10 Credit player on both of its nights');
  assert.deepEqual([linkOf('4002'), linkOf('4003')], [undefined, undefined], 'both other cards point only to p3: neither is linked');
  assert.deepEqual([cardOf('4002').conflict.playerId, cardOf('4002').conflict.cards], ['p3', ['card:VISA|411111|4003']]);
}
// A card matched at the desk (or saved) is settled from the start, and settles the rest: 4003 is p3's, so 4002 is not.
learnt = plain(context.cloverLearnCards_([
  ['2026-10-14', [card('2026-10-14', 10, '4001'), card('2026-10-14', 10, '4002'), card('2026-10-14', 10, '4003')], ['p1', 'p3', 'p4']],
  ['2026-10-19', [card('2026-10-19', 10, '4001'), card('2026-10-19', 10, '4002')], ['p1', 'p4']]
].map(([date, payments, credit]) => ({ date, payments, credit })), statuses, { 'card:VISA|411111|4003': 'p3' }));
assert.deepEqual([linkOf('4003'), linkOf('4001'), linkOf('4002')], ['p3', undefined, undefined], 'p1 and p4 still both fit 4001 and 4002');
learnt = plain(context.cloverLearnCards_([
  ['2026-10-14', [card('2026-10-14', 10, '4001'), card('2026-10-14', 10, '4002')], ['p1', 'p3']],
  ['2026-10-19', [card('2026-10-19', 10, '4001')], ['p1', 'p3']]
].map(([date, payments, credit]) => ({ date, payments, credit })), statuses, { 'card:VISA|411111|4002': 'p3' }));
assert.deepEqual([linkOf('4002'), linkOf('4001')], ['p3', 'p1'], 'with 4002 known to be p3, 4001 can only be p1');
assert.equal(cardOf('4002').why, undefined, 'a card matched by hand needs no explanation');
assert.deepEqual(cardOf('4001').why.ruledOut, [{ playerId: 'p3', reason: 'other-card', date: '2026-10-14', card: 'card:VISA|411111|4002' }]);
learnt = learn([
  ['2026-10-05', [card('2026-10-05', 10, '3001')], ['p1', 'p3']],
  ['2026-10-07', [card('2026-10-07', 10, '3001')], ['p1', 'p4']],
  ['2026-10-12', [card('2026-10-12', 10, '3001')], ['p3', 'p4']],
  ['2026-10-14', [card('2026-10-14', 10, '3001')], ['p1']]
]);
assert.equal(linkOf('3001'), undefined);
assert.deepEqual(cardOf('3001').almost, { playerId: 'p1', dates: ['2026-10-12'] }, 'p1 fits three of four nights: the odd night is shown to check, never linked');
learnt = learn([['2026-10-05', [card('2026-10-05', 10, '2001'), card('2026-10-05', 10, '2002')], ['p1', 'p3']]]);
assert.deepEqual([linkOf('2001'), linkOf('2002')], [undefined, undefined], 'two cards and two players at one amount are never guessed');
assert.equal(cardOf('2001').candidates.length, 2);
learnt = learn([['2026-10-05', [card('2026-10-05', 20, '2003')], ['p1', 'p3']]]);
assert.equal(linkOf('2003'), undefined, 'a payment for two people links no card');

// Configuration and errors never show the token.
assert.match(context.cloverConfigProblem_({ token: '', merchant: '' }), /CLOVER_API_TOKEN and CLOVER_MERCHANT_ID/);
assert.match(context.cloverConfigProblem_({ token: 'x', merchant: 'bad/id' }), /does not look like/);
assert.equal(context.cloverConfigProblem_({ token: 'x', merchant: 'ABC123DEF4567' }), '');
throttle = 10;
assert.throws(() => context.cloverFetchAll_([{ url: 'https://api.clover.com/v3/merchants/M/payments', headers: {} }]), /slow down \(429\)/, 'it gives up after a few tries');
throttle = 0;
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
const openPlayPayment = payment('2026-10-07', 10, { cardholderName: '', last4: '8888' });
clover.payments.push(openPlayPayment);
sheets.OpenPlay = [{ session_date: new Date('2026-10-07T00:00:00Z'), player_id: 'p4' }];
sheets.SessionPayments.push({ session_id: 'session-2026-10-07', player_id: 'p4', method: 'credit', updated_at: new Date(openPlayPayment.createdTime + 3 * 3600000) });
sheets.AuditLog = [
  { action: 'session_payment_updated', entity_id: 'session-2026-10-07', event_time: new Date(openPlayPayment.createdTime + 60000), details_json: JSON.stringify({ playerId: 'p4', method: 'credit' }) },
  { action: 'session_payment_updated', entity_id: 'session-2026-10-07', event_time: new Date(openPlayPayment.createdTime), details_json: JSON.stringify({ playerId: 'p3', method: 'unpaid' }) },
  { action: 'player_created', entity_id: 'p9', event_time: new Date(), details_json: '{}' }
];
clover.orders = [{ id: 'ORD-C', customers: { elements: [{ id: 'C9' }] } }];
clover.customers = { C9: { firstName: 'Robert', lastName: 'Lee', phoneNumbers: { elements: [{ phoneNumber: '925-555-0199' }] }, emailAddresses: { elements: [] } } };
clover.payments[1].order = { id: 'ORD-C' };
throttle = 2;
slept.length = 0;
fetched.length = 0;
report = plain(context.getCloverReport('2026-10-05', '2026-10-07'));
assert.equal(slept.length, 2, 'Clover asking to slow down is waited out and tried again');
assert.equal(fetched.filter(call => /\/customers\//.test(call.url)).length, 1, 'each customer is read once');
assert.ok(fetched.every(call => call.auth === 'Bearer test-token'));
const paymentsCall = fetched.find(call => /\/payments\?/.test(call.url));
assert.match(paymentsCall.url, /^https:\/\/api\.clover\.com\/v3\/merchants\/ABC123DEF4567\/payments\?filter=createdTime%3E%3D\d+&filter=createdTime%3C\d+&expand=cardTransaction%2Crefunds&limit=1000&offset=0$/);
assert.deepEqual(report.nights.map(n => n.date), ['2026-10-07', '2026-10-05'], 'newest night first; a payment after the range is left out');
const oct5 = report.nights[1];
assert.equal(oct5.rows[1].customer, 'Robert Lee · 925-555-0199', 'the Clover customer is shown');
assert.deepEqual(oct5.rows.map(row => [row.state, row.verdicts.map(v => v.verdict).join()]), [['matched', 'agrees'], ['needs-action', '']], 'matched by the name on the card; the Zeffy holder paying is asked about');
const oct7 = report.nights[0];
assert.deepEqual(oct7.rows.map(row => [row.state, row.reason, row.playerIds.join()]), [['unmatched', '', ''], ['matched', 'card', 'p6'], ['ignored', '', ''], ['matched', 'card', 'p4']],
  'the card Avery used on Oct 5 is not linked: Oct 7 records Cash for Avery; the learned cards match; the refund is left alone');
assert.equal(oct7.rosterCount, 4, 'Open Play players count as checked in');
assert.equal(oct7.rows[1].card, 'VISA ••6666');
const learnedCards = Object.fromEntries(report.cards.map(c => [c.card, c]));
assert.deepEqual([learnedCards['VISA ••8888'].playerId, learnedCards['VISA ••8888'].minutes], ['p4', [1]], 'an Open Play player, marked Credit (AuditLog) a minute from paying');
assert.equal(learnedCards['VISA ••6666'].playerId, 'p6');
assert.equal(learnedCards['VISA ••1111'].playerId, '');
assert.equal(report.cards.filter(c => c.playerId).length, 2);
assert.deepEqual([report.totals.cardPayments, report.totals.matched, report.totals.agrees, report.totals.needsAction, report.totals.unmatched, report.totals.ignored], [5, 3, 3, 1, 1, 1]);
assert.deepEqual(report.repeat, { cards: 4, payments: 1 }, 'one payment came from a card seen on an earlier night');
assert.equal(report.names.p1, 'Avery Park');
assert.equal(report.enabled, false);
assert.ok(!('CloverLinks' in sheets), 'the report never adds a tab');

console.log('Clover payment checks passed');
