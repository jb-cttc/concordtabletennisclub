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
let revenueDocumentId = '';
let currentRevenueRows = [];
const context = {
  TABLES: {},
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => revenueDocumentId }) },
  DocumentApp: { openById: id => {
    assert.equal(id, 'configured-document');
    return { getBody: () => ({ getTables: () => [{
      getNumRows: () => currentRevenueRows.length,
      getRow: index => ({
        getNumCells: () => currentRevenueRows[index].length,
        getCell: cell => ({ getText: () => currentRevenueRows[index][cell] })
      })
    }] }) };
  } },
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
context.normalizeName_ = value => String(value || '').trim().replace(/\s+/g, ' ');
vm.createContext(context);
for (const file of ['LinkedNames.js', 'PrivatePayments.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context);
const date = '2026-09-23';
const names = () => context.getZeffyPlayers().map(p => p.name).join(',');

const revenueRows = [
  ['M/Zeffy', ' Dana ', ' Chen ', '09/30/26'],
  ['M/Zeffy', 'Avery', 'Park', '09/22/26'],
  ['M/Zeffy', 'May', 'Tan', '02/30/27'],
  ['Zeffy', 'Mei', 'Tan', '12/31/26'],
  ['M/Zeffy', 'Unknown', 'Person', '12/31/26']
];
assert.deepEqual(Array.from(context.revenuePassesForDate_(revenueRows, tables.Players, date), pass => pass.playerId), ['b']);
assert.deepEqual(Array.from(context.revenuePassesForDate_([['M/Zeffy', 'Dana', 'Chen', '09/23/26']], tables.Players, date), pass => pass.playerId), ['b'], 'expiry date remains covered');
assert.equal(context.revenuePassesForDate_(revenueRows, tables.Players.concat({ player_id: 'duplicate', display_name: 'Dana Chen' }), date).length, 0, 'ambiguous directory names must not be marked covered');

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

revenueDocumentId = 'configured-document';
currentRevenueRows = [
  ['Type', 'First', 'Last', 'Exp.Date'],
  ['M/Zeffy', 'Avery', 'Park', '09/23/26'],
  ['M/Zeffy', 'Dana', 'Chen', '09/30/26'],
  ['M/Zeffy', 'May', 'Tan', '09/22/26']
];
const revenueOverview = context.getPrivatePaymentOverview(date);
assert.equal(revenueOverview.methods.a, 'zeffy');
assert.equal(revenueOverview.passes.filter(pass => pass.playerId === 'a').length, 1, 'manual and revenue passes are combined without duplicates');
assert.equal(revenueOverview.passes.some(pass => pass.playerId === 'b'), true, 'revenue pass appears in sidebar list');
assert.throws(() => context.setSessionPayment(date, 'b', 'cash'), /Zeffy play pass covers/);
assert.equal(context.getPrivatePaymentOverview('2026-10-01').methods.b, '', 'expired revenue pass no longer covers a session');
assert.equal(context.setSessionPayment('2026-10-01', 'b', 'cash'), 'cash');
revenueDocumentId = '';

assert.throws(() => context.setZeffyPass('missing', true), /Unknown/);
tables.ZeffyPasses.push({ player_id: 'ron', player_name: 'Old Member', active: true });
assert.throws(() => context.getZeffyPlayers(), /Duplicate Zeffy pass/);
tables.ZeffyPasses.pop();
tables.SessionPayments.push({ session_id: 'session-' + date, player_id: 'a', method: 'cash' });
assert.throws(() => context.getPrivatePaymentState(date), /Duplicate payment/);
console.log('Payment and Zeffy pass checks passed');
