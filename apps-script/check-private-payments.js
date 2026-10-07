const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const tables = {
  Players: [
    { player_id: 'a', display_name: 'Avery Park', active: true },
    { player_id: 'b', display_name: 'Dana Chen', active: true },
    { player_id: 'ron', display_name: 'Old Member', active: false },
    { player_id: 'll', display_name: 'Mei Tan', active: true },
    { player_id: 'ml', display_name: 'May Tan', active: true }
  ],
  ZeffyPasses: [],
  SessionPayments: [],
  ZeffyPayments: [],
  NameLinks: [{ kind: 'same_person', name: 'Mei Tan', linked_name: 'May Tan' }]
};
const reads = {};
const properties = {};
let inbox = [];
let searches = [];
const mail = (id, date, subject, body, from = 'Concord Table Tennis Club <contact@communication.mailer.zeffy.com>') => ({
  getId: () => id, getDate: () => new Date(date + 'T18:00:00Z'), getFrom: () => from, getSubject: () => subject, getPlainBody: () => body
});
const PASS = 'New purchase with automatic renewal for CTTC Monthly Pre-pay Playpass (for Members only)';
const purchase = (buyer, email, participants) => 'Organization: *Concord Table Tennis Club* New $65.00 payment received! ' + buyer + ' ' + email +
  ' California, US Payment method: Card ORDER SUMMARY ' + participants.map((name, index) => 'Participant ' + (index + 1) + ': Monthly Playpass / $65.00\nName: ' + name + '\nEmail: ' + email).join(' ') + ' View payment <https://example.invalid/x>';
const renewal = (buyer, email) => 'New $65.00 payment received! ' + buyer + ' <' + email + '> California, US ORDER SUMMARY Participant 1: Monthly Playpass / $65.00 View payment';
const context = {
  TABLES: {},
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) },
  GmailApp: { search: (query, start) => { searches.push(query); return start ? [] : [{ getMessages: () => inbox }]; } },
  Utilities: { formatDate: value => value.toISOString().slice(0, 10) },
  Session: { getScriptTimeZone: () => 'UTC' },
  SpreadsheetApp: { getActive: () => ({ getSheetByName: () => ({}) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {}, hasLock: () => false, tryLock: () => true }) },
  ensureHeader_() {}, formatTable_() {}, appendAudit_() {},
  playerAliases_: () => ({ 'danielle chen': 'b' }),
  displayDate_: value => String(value),
  validateSessionDate_: date => { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date'); },
  asBoolean_: value => value === true || String(value).toLowerCase() === 'true',
  rows_: name => {
    reads[name] = (reads[name] || 0) + 1;
    return tables[name].map((row, index) => ({ ...row, __row: index + 2 }));
  },
  findRow_: (name, key, value) => context.rows_(name).find(row => String(row[key]) === String(value)) || null,
  appendObjects_: (name, rows) => tables[name].push(...rows),
  updateRow_: (name, rowNumber, changes) => Object.assign(tables[name][rowNumber - 2], changes),
  listPlayers: () => tables.Players.filter(p => p.active).map(p => ({ playerId: p.player_id, name: p.display_name }))
};
context.normalizeName_ = value => String(value || '').trim().replace(/\s+/g, ' ');
vm.createContext(context);
for (const file of ['LinkedNames.js', 'PrivatePayments.js', 'ZeffyTracking.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context);
const date = '2026-09-23';
const names = () => context.getZeffyPlayers(null, date).map(p => p.name).join(',');

assert.equal(context.zeffyMonthsLater_('2026-01-31', 1), '2026-02-28', 'a short month ends on its last day');
assert.equal(context.zeffyMonthsLater_('2026-01-31', 2), '2026-03-31', 'later months return to the start day');
assert.equal(context.zeffyMonthsLater_('2028-01-30', 1), '2028-02-29', 'leap years keep February 29');
assert.equal(context.zeffyMonthsLater_('2026-12-15', 1), '2027-01-15');
assert.equal(context.zeffyDaysBetween_('2026-02-05', context.zeffyMonthsLater_('2026-02-05', 1)), 28, 'a February pass lasts 28 days');
assert.equal(context.zeffyDaysBetween_('2026-04-05', context.zeffyMonthsLater_('2026-04-05', 1)), 30);
assert.equal(context.parseZeffyEmail_('x <someone@example.com>', PASS, purchase('Avery Park', 'a@example.com', ['Avery Park']), date).length, 0, 'only Zeffy can report payments');
assert.deepEqual(JSON.parse(JSON.stringify(context.parseZeffyEmail_('<contact@communication.mailer.zeffy.com>', PASS, purchase('Avery Park', 'A@example.com', ['Avery Park', 'Kid Park']), date))), [
  { paid_on: date, kind: 'purchase', payer_name: 'Avery Park', payer_email: 'a@example.com', participant_name: 'Avery Park' },
  { paid_on: date, kind: 'purchase', payer_name: 'Avery Park', payer_email: 'a@example.com', participant_name: 'Kid Park' }
]);
assert.equal(context.parseZeffyEmail_('<contact@communication.mailer.zeffy.com>', PASS + ' (recurring payment)', renewal('AVERY PARK', 'a@example.com'), date)[0].kind, 'renewal');
assert.equal(context.parseZeffyEmail_('<contact@communication.mailer.zeffy.com>', 'The recurring donation by Avery Park has been cancelled', 'contact them at a@example.com for more details', date)[0].kind, 'cancel');

const overview = context.getPrivatePaymentOverview(date);
assert.equal(overview.methods.a, '');
assert.equal(overview.passes.length, 0);
assert.equal(overview.coveredIds.length, 0);
assert.equal(reads.Players, 1, 'payment overview should read Players once');
assert.equal(reads.ZeffyPasses, 1, 'payment overview should read Zeffy passes once');
assert.equal(reads.SessionPayments, 1, 'payment overview should read payments once');
assert.equal(reads.NameLinks, 1, 'payment overview should resolve links once');
assert.equal(searches.length, 1, 'the first sync reads all Zeffy mail');
assert.doesNotMatch(searches[0], /newer_than/);

assert.equal(context.getPrivatePaymentState(date).a, '');
assert.equal(context.setSessionPayment(date, 'a', 'venmo'), 'venmo');
assert.equal(context.getPrivatePaymentState(date).a, 'venmo');
assert.equal(context.setSessionPayment(date, 'a', 'credit'), 'credit');
assert.equal(context.getPrivatePaymentState(date).a, 'credit', 'Credit is a recordable method');
assert.equal(context.setSessionPayment(date, 'a', 'venmo'), 'venmo');
assert.equal(context.getPrivatePaymentState('2026-09-24').a, '', 'per-session fees are per date');
assert.equal(context.setSessionPayment(date, 'a', ''), '');
assert.equal(context.getPrivatePaymentState(date).a, '');
assert.equal(tables.SessionPayments.length, 1);
assert.throws(() => context.setSessionPayment(date, 'a', 'check'), /Invalid/);
assert.throws(() => context.setSessionPayment(date, 'missing', 'cash'), /Unknown/);

assert.equal(context.setZeffyPass('b', true), true);
assert.equal(names(), 'Dana Chen');
assert.equal(context.getPrivatePaymentState(date).b, 'zeffy', 'Zeffy covers every session');
assert.equal(context.getPrivatePaymentState('2026-10-07').b, 'zeffy');
assert.throws(() => context.setSessionPayment(date, 'b', 'cash'), /Zeffy play pass covers/);
context.setZeffyPass('b', false);
assert.equal(names(), '');
assert.equal(context.getPrivatePaymentState(date).b, '');
assert.equal(tables.ZeffyPasses.length, 1, 'turning a pass off keeps its row');

context.setZeffyPass('ron', true);
assert.equal(names(), 'Old Member', 'archived players stay on the Zeffy list');
assert.equal(context.getPrivatePaymentState(date).ron, undefined, 'only active players get payment state');

context.setZeffyPass('ml', true);
assert.equal(context.getPrivatePaymentState(date).ll, 'zeffy', 'a confirmed linked name shares the pass');
const linkedOverview = context.getPrivatePaymentOverview(date);
assert.equal(linkedOverview.methods.ll, 'zeffy');
assert.equal(linkedOverview.passes.some(pass => pass.playerId === 'ml'), true);
assert.equal(linkedOverview.coveredIds.includes('ll'), true);
assert.equal(context.setSessionPayment(date, 'a', 'zeffy'), 'zeffy', 'Zeffy can be recorded for a single session');
assert.equal(context.getPrivatePaymentState(date).a, 'zeffy');

context.setZeffyPass('ml', false);
context.setZeffyPass('ron', false);
properties.CTTC_ZEFFY_SYNCED_AT = '0';
inbox = [
  mail('m1', '2026-07-12', PASS, purchase('Danielle Chen', 'd@example.com', ['Danielle Chen'])),
  mail('m2', '2026-08-12', PASS + ' (recurring payment)', renewal('Danielle Chen', 'd@example.com')),
  mail('m3', '2026-09-12', PASS + ' (recurring payment)', renewal('Danielle Chen', 'd@example.com')),
  mail('m4', '2026-08-01', PASS, purchase('Avery Park', 'a@example.com', ['Avery Park'])),
  mail('m5', '2026-09-12', 'The recurring donation by Avery Park has been cancelled', 'contact them at a@example.com for more details'),
  mail('m6', '2026-09-20', PASS, purchase('Kim Tan', 'k@example.com', ['Kim Tan'])),
  mail('m7', '2026-09-20', PASS, purchase('Kim Tan', 'k@example.com', ['Mei Tan'])),
  mail('m8', '2026-10-20', PASS + ' (recurring payment)', renewal('Kim Tan', 'k@example.com')),
  mail('m9', '2026-09-01', PASS, purchase('Pat Lee', 'p@example.com', ['Pat Lee']), 'Pat Lee <p@example.com>')
];
const tracked = context.getZeffyPlayers(null, date);
assert.deepEqual(JSON.parse(JSON.stringify(tracked)), [
  { playerId: 'a', name: 'Avery Park', active: false, daysLeft: null, streak: 1, renewsOn: '2026-09-01' },
  { playerId: 'b', name: 'Dana Chen', active: true, daysLeft: 19, streak: 3, renewsOn: '2026-10-12' },
  { playerId: '', name: 'Kim Tan', active: true, daysLeft: 27, streak: 1, renewsOn: '2026-10-20' },
  { playerId: 'll', name: 'Mei Tan', active: true, daysLeft: 27, streak: 1, renewsOn: '2026-10-20' }
], 'aliases, unlisted buyers, expired passes and streaks come from Zeffy mail');
assert.equal(tables.ZeffyPayments.length, 8, 'one row per covered person, cancellations included');
assert.equal(context.getPrivatePaymentState(date).a, 'zeffy', 'an expired pass leaves a recorded session payment alone');
assert.equal(context.getPrivatePaymentState(date).b, 'zeffy');
assert.equal(context.getPrivatePaymentState(date).ml, 'zeffy', 'linked names still share a pass');
assert.equal(context.getPrivatePaymentOverview('2026-10-12').methods.b, 'zeffy', 'the renewal day is still covered');
assert.equal(context.getPrivatePaymentOverview('2026-10-13').methods.b, '', 'a missed renewal expires the pass');
assert.equal(context.getZeffyPlayers(null, '2026-11-01').find(pass => pass.name === 'Mei Tan').streak, 2, 'renewals cover everyone the buyer bought for');
const fullSearches = searches.length;
properties.CTTC_ZEFFY_SYNCED_AT = String(Date.now() - 11 * 60000);
context.getZeffyPlayers(null, date);
assert.equal(searches.length, fullSearches + 1);
assert.match(searches[searches.length - 1], /newer_than:3d$/, 'later syncs read only recent mail');
assert.equal(tables.ZeffyPayments.length, 8, 'messages are recorded once');
tables.ZeffyPayments.length = 0;
inbox = [];
assert.throws(() => context.setZeffyPass('missing', true), /Unknown/);
tables.ZeffyPasses.push({ player_id: 'ron', player_name: 'Old Member', active: true }, { player_id: 'ron', player_name: 'Old Member', active: true });
assert.throws(() => context.getZeffyPlayers(), /Duplicate Zeffy pass/);
tables.ZeffyPasses.splice(-2);
tables.SessionPayments.push({ session_id: 'session-' + date, player_id: 'a', method: 'cash' });
assert.throws(() => context.getPrivatePaymentState(date), /Duplicate payment/);
console.log('Payment and Zeffy pass checks passed');
