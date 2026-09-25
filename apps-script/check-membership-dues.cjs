const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const tables = {
  MembershipDues: [
    { player_id: 'a', membership_year: '2026', expires_on: '2026-12-31', payment_method: 'zeffy' },
    { player_id: 'b', membership_year: '2026', expires_on: '2026-12-31', payment_method: '' },
    { player_id: 'a', membership_year: '2025', expires_on: '2025-12-31', payment_method: 'cash' }
  ]
};
const context = {
  TABLES: {},
  SpreadsheetApp: { getActive: () => ({ getSheetByName: () => ({}) }) },
  ensureHeader_() {}, formatTable_() {},
  rows_: name => tables[name].map((row, index) => ({ ...row, __row: index + 2 }))
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/MembershipDues.js', 'utf8'), context);

const dues = JSON.parse(JSON.stringify(context.getMembershipDues2026()));
assert.deepEqual(dues, { a: { method: 'zeffy', expiresOn: '2026-12-31' }, b: { method: '', expiresOn: '2026-12-31' } });
tables.MembershipDues.push({ player_id: 'b', membership_year: '2026' });
assert.throws(() => context.getMembershipDues2026(), /Duplicate/);
console.log('Membership dues checks passed');
