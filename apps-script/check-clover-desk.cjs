// The desk's Clover section on the server (CloverPayments.js): the check that matches and records, matching by hand,
// undo, setting a payment aside, refunds, and the dry run before CLOVER_ENABLED. It runs the real payment, Zeffy,
// member status and Open Play code on an in-memory Sheet. All names, cards and amounts are made up.
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

const tables = {};
const sheets = {};
function sheet(name) {
  return sheets[name] || (sheets[name] = { deleteRow: row => { tables[name].splice(row - 2, 1); } });
}
const properties = {};
let cache = {};
let clover = { payments: [] };
const audits = [];
const route = request => {
  const path = new URL(request.url).pathname.replace(/^\/v3\/merchants\/[^/]+/, '');
  const body = path === '/payments' ? { elements: clover.payments } : path === '/orders' ? { elements: [] } : {};
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
};
const context = {
  console,
  TABLES: {},
  SpreadsheetApp: { getActive: () => ({ getSheetByName: name => (tables[name] ? sheet(name) : null), insertSheet: name => { tables[name] = []; return sheet(name); } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, hasLock: () => false, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => (key in properties ? properties[key] : null), setProperty() {} }) },
  CacheService: { getScriptCache: () => ({
    get: key => cache[key] || null, put: (key, value) => { cache[key] = value; },
    getAll: keys => Object.fromEntries(keys.filter(key => cache[key]).map(key => [key, cache[key]])), putAll: values => Object.assign(cache, values)
  }) },
  UrlFetchApp: { fetchAll: requests => requests.map(route) },
  GmailApp: { search: () => [] },
  Session: { getScriptTimeZone: () => tz, getActiveUser: () => ({ getEmail: () => 'desk@example.test' }) },
  Utilities: { formatDate, getUuid: () => String(Math.random()).slice(2), sleep() {} },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/dev' }) },
  HtmlService: {}
};
// The desk's clock: matches are recorded by themselves only on tonight's date (or last night's).
let clock = Date.parse('2026-11-03T04:00:00Z');
context.Date = class extends Date {
  constructor(...args) { if (args.length) super(...args); else super(clock); }
  static now() { return clock; }
};
vm.createContext(context);
for (const file of ['Code.js', 'SessionService.js', 'LinkedNames.js', 'MemberStatus.js', 'PrivatePayments.js', 'ZeffyTracking.js', 'OpenPlay.js', 'CashFlow.js', 'NightFees.js', 'CloverPayments.js']) {
  vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context, { filename: file });
}
context.rows_ = name => {
  if (!tables[name]) throw new Error('Missing database table: ' + name);
  return tables[name].map((row, index) => Object.assign({ __row: index + 2 }, row));
};
context.appendObjects_ = (name, objects) => { objects.forEach(object => tables[name].push(Object.assign({}, object))); };
context.updateRow_ = (name, row, changes) => { Object.assign(tables[name][row - 2], changes); };
context.ensureHeader_ = () => {};
context.formatTable_ = () => {};
context.appendAudit_ = (action, type, id, details) => { audits.push({ action, details }); return ''; };
const plain = value => JSON.parse(JSON.stringify(value));

const people = { p1: 'Avery Park', p2: 'Blake Stone', p3: 'Casey Stone', p4: 'Drew Lane', p5: 'Emery Wu', p6: 'Gray Ito' };
tables.Players = Object.keys(people).map(id => ({ player_id: id, display_name: people[id], current_rating: 1500, active: true }));
tables.Aliases = [];
tables.NameLinks = [{ kind: 'junior', name: 'Casey Stone', linked_name: 'Blake Stone' }];
tables.MemberStatus = [{ player_id: 'p1', status: 'member' }, { player_id: 'p2', status: 'member' }, { player_id: 'p4', status: 'member' }, { player_id: 'p6', status: 'member' }];
tables.ZeffyPasses = [{ player_id: 'p6', player_name: 'Gray Ito', active: true }];
tables.ZeffyPayments = [];
tables.SessionPayments = [];
tables.OpenPlay = [];
const DATE = '2026-11-02';
const NEXT = '2026-11-04';
tables.SessionPlayers = ['p1', 'p2', 'p3', 'p4', 'p6'].map(id => ({ session_id: 'session-' + DATE, player_id: id }))
  .concat(['p1', 'p4', 'p5'].map(id => ({ session_id: 'session-' + NEXT, player_id: id })));
properties.CLOVER_API_TOKEN = 'test-token';
properties.CLOVER_MERCHANT_ID = 'ABC123DEF4567';

const at = (date, minute) => Date.parse(date + 'T00:00:00Z') + 86400000 + 2 * 3600000 + minute * 60000;
const payment = (id, date, minute, dollars, card, extra) => Object.assign({
  id, amount: dollars * 100, result: 'SUCCESS', createdTime: at(date, minute), order: { id: 'O-' + id },
  cardTransaction: Object.assign({ cardType: 'VISA', first6: '411111', last4: '1234', cardholderName: '' }, card), tender: { label: 'Credit Card' }
}, extra);
const desk = date => { cache = {}; return plain(context.getCloverDesk(date)); };
const item = (state, id) => state.items.find(entry => entry.id === id);
const method = (date, playerId) => (tables.SessionPayments.find(row => row.session_id === 'session-' + date && row.player_id === playerId) || {}).method;

// Not connected yet: the section says what to add.
delete properties.CLOVER_MERCHANT_ID;
assert.equal(desk(DATE).connected, false);
assert.match(desk(DATE).problem, /CLOVER_MERCHANT_ID/);
properties.CLOVER_MERCHANT_ID = 'ABC123DEF4567';

// Dry run: the desk shows what it would do and writes nothing.
clover.payments = [
  payment('A', DATE, 1, 10, { cardholderName: 'PARK/AVERY', last4: '1111' }),
  payment('B', DATE, 4, 15, { last4: '2222', cardholderName: 'VISA CARDHOLDER' }),
  payment('C', DATE, 6, 10, { cardholderName: 'DREW LANE', last4: '3333' }, { refunds: { elements: [{ amount: 1000 }] } }),
  payment('D', DATE, 8, 10, { last4: '4444' }),
  payment('E', DATE, 9, 10, { cardholderName: 'GRAY ITO', last4: '5555' })
];
let state = desk(DATE);
assert.equal(state.enabled, false);
assert.deepEqual(state.items.map(entry => entry.id), ['E', 'D', 'C', 'B', 'A'], 'newest first');
assert.deepEqual([item(state, 'A').state, item(state, 'A').recorded, item(state, 'A').playerIds], ['matched', false, ['p1']], 'would match, not recorded');
assert.equal(item(state, 'C').state, 'ignored', 'a refund is left alone');
assert.equal(item(state, 'B').cardholder, '', 'no name on the card');
assert.equal(item(state, 'E').state, 'needs-action', 'a Zeffy pass holder paying is asked about');
assert.equal(state.names.p3, 'Casey Stone', 'names for every checked-in player, for choosing by hand');
assert.equal(state.fees.p3, 5, 'Casey is a junior');
assert.equal(state.pageUrl, 'https://script.google.com/macros/s/TEST/dev?view=clover');
assert.ok(!('CloverMatches' in tables) && !('CloverLinks' in tables), 'the dry run adds no tabs');
assert.equal(tables.SessionPayments.length, 0, 'and records no payments');
assert.throws(() => context.matchCloverPayment(DATE, 'D', ['p4'], true), /Clover matching is off/);
assert.throws(() => context.unmatchCloverPayment(DATE, 'A'), /Clover matching is off/);
assert.throws(() => context.setAsideCloverPayment(DATE, 'D'), /Clover matching is off/);
assert.throws(() => context.saveCloverCards([{ key: 'card:VISA|411111|9999', playerId: 'p5' }]), /Clover matching is off/, 'saving learned cards waits for CLOVER_ENABLED too');

// Switched on: the check records the match as Credit, once, and remembers the card it was matched by name.
properties.CLOVER_ENABLED = 'true';
state = desk(DATE);
assert.deepEqual([item(state, 'A').state, item(state, 'A').recorded, item(state, 'A').reason], ['matched', true, 'name']);
assert.equal(method(DATE, 'p1'), 'credit');
assert.equal(tables.CloverMatches.length, 1);
assert.deepEqual(plain(tables.CloverLinks.map(row => [row.link_key, row.player_id, row.source])), [['card:VISA|411111|1111', 'p1', 'name']]);
state = desk(DATE);
assert.equal(tables.CloverMatches.length, 1, 'checking again records nothing twice');
assert.equal(audits.filter(entry => entry.action === 'clover_payment_matched').length, 1);

// By hand: one payment for two players (Blake paid $15 for himself and his junior Casey). No card is linked.
state = plain(context.matchCloverPayment(DATE, 'B', ['p2', 'p3'], true));
assert.deepEqual([item(state, 'B').state, item(state, 'B').reason, item(state, 'B').playerIds], ['matched', 'hand', ['p2', 'p3']]);
assert.deepEqual([method(DATE, 'p2'), method(DATE, 'p3')], ['credit', 'credit']);
assert.equal(tables.CloverLinks.length, 1, 'which of two players owns the card is not known');
assert.throws(() => context.matchCloverPayment(DATE, 'B', ['p4'], true), /already matched/);
assert.throws(() => context.matchCloverPayment(DATE, 'D', ['p2'], true), /Already has a Clover payment tonight/);
assert.throws(() => context.matchCloverPayment(DATE, 'D', ['p6'], true), /Zeffy play pass covers/);
assert.throws(() => context.matchCloverPayment(DATE, 'C', ['p4'], true), /Not a completed card payment/);
assert.throws(() => context.matchCloverPayment(DATE, 'Z', ['p4'], true), /no such payment/);
assert.throws(() => context.matchCloverPayment(DATE, 'D', [], true), /Choose who/);

// By hand, remembered: Drew had been marked Cash by mistake; matching sets Credit and links the card.
tables.SessionPayments.push({ session_id: 'session-' + DATE, player_id: 'p4', method: 'cash' });
state = plain(context.matchCloverPayment(DATE, 'D', ['p4'], true));
assert.equal(method(DATE, 'p4'), 'credit', 'the organizer\'s match replaces the method chosen by hand');
assert.ok(tables.CloverLinks.some(row => row.link_key === 'card:VISA|411111|4444' && row.player_id === 'p4' && row.source === 'hand'));

// Not a desk fee: set aside, never matched; a matched payment has to be undone first.
state = plain(context.setAsideCloverPayment(DATE, 'E'));
assert.deepEqual([item(state, 'E').state, item(state, 'E').note], ['set-aside', 'Not a desk fee']);
assert.throws(() => context.setAsideCloverPayment(DATE, 'A'), /undo the match first/);

// Changed by hand afterwards: Avery is marked Venmo now. The desk shows it rather than changing it back.
tables.SessionPayments.find(row => row.player_id === 'p1').method = 'venmo';
state = desk(DATE);
assert.deepEqual(item(state, 'A').changed, [{ playerId: 'p1', method: 'Venmo' }]);
assert.equal(method(DATE, 'p1'), 'venmo');

// Undo: Credit goes back to unpaid unless changed by hand, the card no longer points to the player, and the payment
// waits for the organizer with the player as the suggestion, never matching by itself again.
state = plain(context.unmatchCloverPayment(DATE, 'D'));
assert.equal(method(DATE, 'p4'), '');
assert.ok(!tables.CloverLinks.some(row => row.link_key === 'card:VISA|411111|4444'), 'the card is forgotten');
assert.deepEqual([item(state, 'D').state, item(state, 'D').note], ['unmatched', 'Undone at the desk: choose who it is for']);
state = plain(context.unmatchCloverPayment(DATE, 'A'));
assert.equal(method(DATE, 'p1'), 'venmo', 'a method changed by hand is left alone');
assert.equal(item(state, 'A').state, 'unmatched', 'the name still fits Avery, but an undone payment waits for the organizer');
assert.deepEqual(item(state, 'A').suggestions.slice(0, 1), ['p1']);
state = plain(context.unmatchCloverPayment(DATE, 'E'));
assert.equal(item(state, 'E').state, 'unmatched', 'undoing a set-aside brings the payment back to the organizer');

// Next night: the card matched by hand matches by itself, even with no name and the player paying before check-in.
context.matchCloverPayment(DATE, 'D', ['p4'], true);
// An earlier night is never changed by itself: a match there waits, ticked, for the organizer to confirm.
const OLD = '2026-10-26';
tables.SessionPlayers.push({ session_id: 'session-' + OLD, player_id: 'p4' });
clover.payments = [payment('H', OLD, 1, 10, { last4: '4444' })];
clock = Date.parse('2026-11-05T04:00:00Z');
state = desk(OLD);
assert.deepEqual([item(state, 'H').state, item(state, 'H').playerIds], ['needs-action', ['p4']]);
assert.match(item(state, 'H').note, /^Matched by a card used before\. On an earlier night, confirm with Match\./);
assert.equal(method(OLD, 'p4'), undefined, 'nothing recorded on an earlier night');
assert.ok(!tables.CloverMatches.some(row => row.session_id === 'session-' + OLD));

clock = Date.parse('2026-11-05T04:00:00Z');
clover.payments = [payment('F', NEXT, 1, 10, { last4: '4444' }), payment('G', NEXT, 2, 10, { last4: '7777' })];
tables.SessionPlayers = tables.SessionPlayers.filter(row => !(row.session_id === 'session-' + NEXT && row.player_id === 'p4'));
state = desk(NEXT);
assert.deepEqual([item(state, 'F').state, item(state, 'F').reason, item(state, 'F').playerIds, item(state, 'F').notCheckedIn], ['matched', 'card', ['p4'], ['p4']]);
assert.equal(method(NEXT, 'p4'), 'credit', 'paid before checking in: Credit is waiting when they arrive');
assert.equal(item(state, 'G').state, 'unmatched');
assert.deepEqual(item(state, 'G').suggestions, ['p1'], 'checked-in players without a payment whose fee is $10 (Emery is a $15 visitor)');

// Refunded on Clover after it was matched: the Credit is taken back and the desk says so.
clover.payments[0].refunds = { elements: [{ amount: 1000 }] };
state = desk(NEXT);
assert.equal(method(NEXT, 'p4'), '');
assert.deepEqual([item(state, 'F').state, item(state, 'F').note], ['ignored', 'Refunded on Clover after it was matched: Credit taken back']);
assert.equal(audits.filter(entry => entry.action === 'clover_payment_refunded').length, 1);
state = desk(NEXT);
assert.equal(audits.filter(entry => entry.action === 'clover_payment_refunded').length, 1, 'taken back once');

// Cards learned from the records, checked and saved by the owner on the Clover page.
assert.equal(context.saveCloverCards([{ key: 'card:VISA|411111|9999', playerId: 'p5' }]), 1);
assert.equal(plain(context.cloverLinkRows_())['card:VISA|411111|9999'], 'p5');
assert.equal(tables.CloverLinks.find(row => row.link_key === 'card:VISA|411111|9999').source, 'records');
assert.throws(() => context.saveCloverCards([{ key: 'customer:C1', playerId: 'p5' }]), /Not a card the desk learned/);
assert.throws(() => context.saveCloverCards([{ key: 'card:VISA|411111|9998', playerId: 'nobody' }]), /Unknown or inactive player/);
assert.throws(() => context.saveCloverCards([]), /Choose the cards/);
context.saveCloverCards([{ key: 'card:VISA|411111|9999', playerId: 'p1' }]);
assert.equal(plain(context.cloverLinkRows_())['card:VISA|411111|9999'], null, 'saved for a second player, the card stops matching');

// The desk log only keeps codes and numbers from these audit entries.
assert.ok(audits.every(entry => Object.keys(entry.details).every(key => ['playerId', 'players', 'how', 'remember', 'cards'].indexOf(key) >= 0)));

console.log('Clover desk checks passed');
