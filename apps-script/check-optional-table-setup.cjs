const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

for (const [file, setup, names] of [
  ['PrivatePayments.js', 'ensurePrivatePaymentTables_', ['ZeffyPasses', 'SessionPayments']],
  ['MemberStatus.js', 'ensureMemberStatusTable_', ['MemberStatus']],
  ['MembershipDues.js', 'ensureMembershipDuesTable_', ['MembershipDues']],
  ['OpenPlay.js', 'ensureOpenPlayTable_', ['OpenPlay']]
]) {
  const sheets = new Map(names.map(name => [name, { name }]));
  const formatted = [];
  const verified = [];
  const context = {
    TABLES: {},
    SpreadsheetApp: { getActive: () => ({
      getSheetByName: name => sheets.get(name),
      insertSheet: name => {
        const sheet = { name };
        sheets.set(name, sheet);
        return sheet;
      }
    }) },
    ensureHeader_: sheet => verified.push(sheet.name),
    formatTable_: sheet => formatted.push(sheet.name)
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context);
  context[setup]();
  assert.deepEqual(formatted, [], file + ' should not format existing tabs');
  assert.deepEqual(verified, names, file + ' should still verify headers');
  sheets.delete(names[0]);
  context[setup]();
  assert.deepEqual(formatted, [names[0]], file + ' should format a new tab');
  assert.deepEqual(verified, names.concat(names), file + ' should verify new headers');
}
console.log('Optional table setup checks passed');