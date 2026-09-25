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
  NameLinks: [{ kind: 'same_person', name: 'Mei Tan', linked_name: 'May Tan' }]
};
const reads = {};
const context = {
  TABLES: {},
  SpreadsheetApp: { getActive: () => ({ getSheetByName: () => ({}) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ensureHeader_() {}, formatTable_() {}, appendAudit_() {},
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
vm.createContext(context);
for (const file of ['LinkedNames.js', 'PrivatePayments.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context);
const date = '2026-09-23';
const names = () => context.getZeffyPlayers().map(p => p.name).join(',');

const overview = context.getPrivatePaymentOverview(date);
assert.equal(overview.methods.a, '');
assert.equal(overview.passes.length, 0);
assert.equal(overview.coveredIds.length, 0);
assert.equal(reads.Players, 1, 'payment overview should read Players once');
assert.equal(reads.ZeffyPasses, 1, 'payment overview should read Zeffy passes once');
assert.equal(reads.SessionPayments, 1, 'payment overview should read payments once');
assert.equal(reads.NameLinks, 1, 'payment overview should resolve links once');

assert.equal(context.getPrivatePaymentState(date).a, '');
assert.equal(context.setSessionPayment(date, 'a', 'venmo'), 'venmo');
assert.equal(context.getPrivatePaymentState(date).a, 'venmo');
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

assert.throws(() => context.setZeffyPass('missing', true), /Unknown/);
tables.ZeffyPasses.push({ player_id: 'ron', player_name: 'Old Member', active: true });
assert.throws(() => context.getZeffyPlayers(), /Duplicate Zeffy pass/);
tables.ZeffyPasses.pop();
tables.SessionPayments.push({ session_id: 'session-' + date, player_id: 'a', method: 'cash' });
assert.throws(() => context.getPrivatePaymentState(date), /Duplicate payment/);
console.log('Payment and Zeffy pass checks passed');
