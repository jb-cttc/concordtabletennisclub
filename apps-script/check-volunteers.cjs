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
vm.runInContext(fs.readFileSync(__dirname + '/NightFees.js', 'utf8'), context);
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

// ---- The Friday and Saturday special (NightFees.js) ----
assert.equal(context.specialNight_('2026-11-13').fee, 5, 'the first Friday');
assert.equal(context.specialNight_('2026-12-26').fee, 5, 'the last Saturday');
assert.equal(context.specialNight_('2026-11-07'), null, 'not before November 13');
assert.equal(context.specialNight_('2027-01-01'), null, 'not after December 31');
assert.equal(context.specialNight_('2026-11-16'), null, 'Mondays are ordinary');
assert.equal(context.specialNight_(''), null);
for (const status of ['junior', 'member', 'visitor', undefined]) {
  assert.equal(context.nightFee_(status, false, '2026-11-20'), 5, 'everyone pays $5: ' + status);
  assert.equal(context.nightFee_(status, true, '2026-11-20'), 5, 'a first visit too: ' + status);
  assert.equal(context.nightFee_(status, false, '2026-11-20', true), 0, 'a free volunteer pays nothing: ' + status);
}
assert.equal(context.nightFee_('visitor', false, '2026-11-18', true), 15, 'free only on a special night');
assert.equal(context.nightFee_('visitor', true, '2026-11-18'), 10);
assert.equal(context.nightFee_('member', false), 10, 'no date: the usual fees');

// The free-night rule is the volunteer app's, word for word (it tells people; the desk charges them).
const rule = text => /\/\/ THE FREE-NIGHT RULE[\s\S]*?\n}\n/.exec(text)[0];
assert.equal(rule(fs.readFileSync(__dirname + '/Volunteers.js', 'utf8')), rule(fs.readFileSync(__dirname + '/../staffing-app/Code.js', 'utf8')),
  'freeSpots_ is the same in apps-script/Volunteers.js and staffing-app/Code.js');

// Friday November 20: by sign-up time, the first 2 openers and the first 2 closers. Ray opens and closes: free once, so the
// second closing spot passes to Ron. Mia holds a spot while she has not confirmed; Old Pending's hold has expired.
const SPECIAL = '2026-11-20';
const at = minutes => new Date(Date.parse('2026-11-01T10:00:00Z') + minutes * 60000).toISOString();
const free = (id, date, position, playerId, name, status, created, extra = {}) => {
  const line = ['s' + id, 'b', date, position, '', playerId, name, name.split(' ')[0].toLowerCase() + '@example.com', status, created, extra.expires || '', ''];
  return extra.told ? line.concat(['', '', '', '', '', '', '', extra.told]) : line;
};
const told = header.concat(['updated_at', 'drop_at', 'reminded', 'seed_key', 'cancelled_by', 'notified', 'replaces', 'free_night']);
signups = [told,
  free(1, SPECIAL, 'lockup', 'p-old', 'Old Pending', 'pending', at(0), { expires: String(NOW - 1) }),
  free(2, SPECIAL, 'tables', 'p-ray', 'Ray Example', 'confirmed', at(1)),
  free(3, SPECIAL, 'close', 'p-ray', 'Ray Example', 'confirmed', at(2)),
  free(4, SPECIAL, 'money', 'p-mia', 'Mia Example', 'pending', at(3), { expires: String(NOW + 3600000) }),
  free(5, SPECIAL, 'desk', 'p-late', 'Late Opener', 'confirmed', at(4)),
  free(6, SPECIAL, 'close', '', 'Walk In Helper', 'confirmed', at(5)),
  free(7, SPECIAL, 'lockup', 'p-ron', 'Ron Example', 'confirmed', at(6)),
  free(8, SPECIAL, 'close', 'p-no', 'Said No', 'released', at(0)),
  free(9, SPECIAL, 'close', 'p-last', 'Last Closer', 'confirmed', at(7))];
const special = list(SPECIAL);
assert.deepEqual(special.special, { fee: 5 });
assert.deepEqual(special.volunteers.map(v => [v.name, v.free, v.waiting]), [
  ['Late Opener', '', false], ['Mia Example', 'open', true], ['Raymond Example', 'open', false], ['Ron Example', 'close', false], ['Last Closer', '', false], ['Walk In Helper', 'close', false]
], 'Ray and Mia hold the opening spots (Mia once she confirms); the walk-in and Ron the closing ones');
const freeOn = date => JSON.parse(JSON.stringify(context.freeVolunteerFinder_()(date)));
assert.deepEqual(freeOn(SPECIAL), { 'p-ray': 'open', 'p-ron': 'close' }, 'only confirmed directory players are charged nothing');
// Someone told they play free keeps the spot ahead of an earlier sign-up time.
signups.push(free(10, SPECIAL, 'tables', 'p-early', 'Early Bird', 'confirmed', at(-10)));
assert.deepEqual(freeOn(SPECIAL), { 'p-early': 'open', 'p-ray': 'open', 'p-ron': 'close' }, 'an earlier sign-up moves ahead of anyone not yet told (Mia here)');
signups[5] = free(5, SPECIAL, 'desk', 'p-late', 'Late Opener', 'confirmed', at(4), { told: '2026-11-02T00:00:00.000Z' });
assert.deepEqual(freeOn(SPECIAL), { 'p-late': 'open', 'p-early': 'open', 'p-ray': 'close' },
  'someone already told keeps the spot ahead of earlier sign-ups; Ray, no longer free as an opener, takes the first closing spot');
assert.deepEqual(freeOn('2026-11-18'), {}, 'nobody is free on an ordinary night');
assert.equal(list('2026-11-18').special, undefined);
property = null;
assert.deepEqual(freeOn(SPECIAL), {}, 'not connected: nobody is free, the desk works as before');
property = 'staffing-sheet';

const source = fs.readFileSync(__dirname + '/Volunteers.js', 'utf8');
assert.doesNotMatch(source, /setValue|appendRow|insertSheet|deleteRow|GmailApp|MailApp|\.reply\(|UrlFetchApp/, 'read-only: no writes, texts or emails');
console.log('Volunteer checks passed');
