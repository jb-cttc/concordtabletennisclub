const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Tonight's volunteers (Volunteers.js) from a fake copy of the volunteer app's private Sheet. Made-up people only.
const NOW = Date.parse('2026-10-21T16:00:00Z');
const header = ['signup_id', 'batch_id', 'date', 'position', 'finalize', 'player_id', 'name', 'email', 'status', 'created_at', 'expires_at', 'confirmed_at'];
const row = (date, position, playerId, name, status, expiresAt) => ['s', 'b', date, position, '', playerId, name, name.split(' ')[0].toLowerCase() + '@example.com', status, '', expiresAt || '', ''];
let signups = [
  header,
  row('2026-10-21', 'close', 'p-ron', 'Ron Example', 'confirmed'),
  row('2026-10-21', 'tables', 'p-ray', 'Ray Example', 'confirmed'),
  row('2026-10-21', 'desk', 'p-ray', 'Ray Example', 'confirmed'),
  row(new Date('2026-10-21T19:00:00Z'), 'money', 'p-mia', 'Mia Example', 'pending', String(NOW + 3600000)),
  row('2026-10-21', 'lockup', 'p-old', 'Old Pending', 'pending', String(NOW - 1)),
  row('2026-10-21', 'tables', 'p-no', 'Said No', 'released'),
  row('2026-10-21', 'tables', 'p-drop', 'Dropped Out', 'dropped'),
  row('2026-10-21', 'close', 'p-gone', 'Closed Night', 'cancelled'),
  row('2026-10-21', 'close', '', 'Walk In Helper', 'confirmed'),
  row('2026-10-21', 'close', 'p-archived', 'Archived Person', 'confirmed'),
  row('2026-10-23', 'desk', 'p-ron', 'Ron Example', 'confirmed')
];
let property = 'staffing-sheet';
const opened = [];
const context = {
  Date: class extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => (key === 'CTTC_STAFFING_DB_ID' ? property : null) }) },
  SpreadsheetApp: {
    openById: id => {
      opened.push(id);
      return { getSheetByName: name => (name === 'Signups' && signups ? { getDataRange: () => ({ getValues: () => signups.map(r => r.slice()) }) } : null) };
    }
  },
  validateSessionDate_: date => { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date'); },
  displayDate_: value => (value instanceof Date ? new Date(value.getTime() - 7 * 3600000).toISOString().slice(0, 10) : String(value)),
  listPlayers: () => [
    { playerId: 'p-ron', name: 'Ron Example', currentRating: 900 },
    { playerId: 'p-ray', name: 'Raymond Example', currentRating: 1300 },
    { playerId: 'p-mia', name: 'Mia Example', currentRating: 700 }
  ]
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/Volunteers.js', 'utf8'), context);
const list = date => JSON.parse(JSON.stringify(context.listVolunteers(date)));

const tonight = list('2026-10-21');
assert.equal(opened[0], 'staffing-sheet');
assert.deepEqual(tonight, {
  connected: true,
  volunteers: [
    { playerId: 'p-ray', name: 'Raymond Example', roles: ['Desk organizer', 'Tables and barriers'], waiting: false },
    { playerId: 'p-mia', name: 'Mia Example', roles: ['Front desk'], waiting: true },
    { playerId: '', name: 'Archived Person', roles: ['Put away'], waiting: false },
    { playerId: 'p-ron', name: 'Ron Example', roles: ['Put away'], waiting: false },
    { playerId: '', name: 'Walk In Helper', roles: ['Put away'], waiting: false }
  ]
}, 'by first role, then name; the directory name; one row per person; a Date cell read as its day');
const text = JSON.stringify(tonight);
['@', 'example.com', 'Old Pending', 'Said No', 'Dropped Out', 'Closed Night'].forEach(word => {
  assert.ok(!text.includes(word), 'no email address, and no expired, released, dropped or cancelled sign-up: ' + word);
});
assert.deepEqual(list('2026-10-23').volunteers.map(v => v.name), ['Ron Example']);
assert.deepEqual(list('2026-10-26'), { connected: true, volunteers: [] });

signups = null;
assert.deepEqual(list('2026-10-21'), { connected: true, volunteers: [] }, 'no Signups tab yet');
property = null;
const before = opened.length;
assert.deepEqual(list('2026-10-21'), { connected: false, volunteers: [] }, 'not connected: the desk works as before');
assert.equal(opened.length, before, 'nothing is opened without the property');
property = 'staffing-sheet';
signups = [['date', 'player_id', 'name', 'status']];
assert.throws(() => list('2026-10-21'), /no position column/, 'a changed Sheet is reported, not misread');
assert.throws(() => list('tonight'), /Invalid date/);

const source = fs.readFileSync(__dirname + '/Volunteers.js', 'utf8');
assert.doesNotMatch(source, /setValue|appendRow|insertSheet|deleteRow|GmailApp|MailApp|\.reply\(|UrlFetchApp/, 'read-only: no writes, texts or emails');
console.log('Volunteer checks passed');
