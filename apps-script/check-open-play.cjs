const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const tables = {
  Players: [{ player_id: 'a', active: true }, { player_id: 'b', active: true }],
  SessionPlayers: [],
  OpenPlay: []
};
const sheet = { deleteRow: rowNumber => tables.OpenPlay.splice(rowNumber - 2, 1) };
const context = {
  TABLES: {},
  SpreadsheetApp: { getActive: () => ({ getSheetByName: () => sheet }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  ensureHeader_: () => {}, formatTable_: () => {}, appendAudit_: () => {},
  validateSessionDate_: date => { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Invalid date'); },
  displayDate_: value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value),
  asBoolean_: value => value === true,
  rows_: name => tables[name].map((row, index) => ({ ...row, __row: index + 2 })),
  findRow_: (name, key, value) => tables[name].find(row => row[key] === value),
  appendObjects_: (name, rows) => tables[name].push(...rows)
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/OpenPlay.js', 'utf8'), context);
const date = '2026-09-24';
assert.equal(context.setOpenPlayParticipant(date, 'a', true), true);
assert.equal(context.setOpenPlayParticipant(date, 'a', true), true);
assert.equal(tables.OpenPlay.length, 1);
assert.deepEqual(Array.from(context.getOpenPlayParticipants(date)), ['a']);
tables.OpenPlay[0].session_date = new Date('2026-09-24T07:00:00Z');
assert.deepEqual(Array.from(context.getOpenPlayParticipants(date)), ['a']);
assert.deepEqual(Array.from(context.getOpenPlayParticipants('2026-09-25')), []);
tables.SessionPlayers.push({ session_id: 'session-' + date, player_id: 'b' });
assert.throws(() => context.setOpenPlayParticipant(date, 'b', true), /saved round robin/);
assert.throws(() => context.setOpenPlayParticipant(date, 'missing', true), /Unknown/);
assert.equal(context.setOpenPlayParticipant(date, 'a', false), false);
assert.deepEqual(Array.from(context.getOpenPlayParticipants(date)), []);
console.log('Open Play Sheet checks passed');