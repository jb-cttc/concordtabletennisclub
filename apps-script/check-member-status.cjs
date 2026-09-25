const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const tables = {
  Players: [
    { player_id: 'a', display_name: 'Avery Park', active: true },
    { player_id: 'bo', display_name: 'Morgan Vale', active: true },
    { player_id: 'j', display_name: 'Riley Vale', active: true },
    { player_id: 'wc', display_name: 'Jordan Reyes', active: true },
    { player_id: 'wcj', display_name: 'Jordan Reyes Jr', active: true },
    { player_id: 'll', display_name: 'Mei Tan', active: true },
    { player_id: 'ml', display_name: 'May Tan', active: true },
    { player_id: 'mh', display_name: 'Sky Ortiz', active: true },
    { player_id: 'x', display_name: 'Retired Player', active: false }
  ],
  MemberStatus: [{ player_id: 'bo', status: 'member' }, { player_id: 'wcj', status: 'member' }, { player_id: 'ml', status: 'member' }],
  NameLinks: [
    { kind: 'same_person', name: 'Mei Tan', linked_name: 'May Tan' },
    { kind: 'junior', name: 'Riley Vale', linked_name: 'Morgan Vale' },
    { kind: 'junior', name: 'Jordan Reyes Jr', linked_name: 'Jordan Reyes' },
    { kind: 'junior', name: 'Sky Ortiz', linked_name: '' }
  ]
};
const reads = {};
const context = {
  TABLES: {},
  SpreadsheetApp: { getActive: () => ({ getSheetByName: () => ({}) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ensureHeader_() {}, formatTable_() {}, appendAudit_() {},
  rows_: name => {
    reads[name] = (reads[name] || 0) + 1;
    return tables[name].map((row, index) => ({ ...row, __row: index + 2 }));
  },
  appendObjects_: (name, rows) => tables[name].push(...rows),
  updateRow_: (name, rowNumber, changes) => Object.assign(tables[name][rowNumber - 2], changes),
  listPlayers: () => tables.Players.filter(p => p.active).map(p => ({ playerId: p.player_id, name: p.display_name }))
};
vm.createContext(context);
for (const file of ['LinkedNames.js', 'MemberStatus.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context);

let state = context.getMemberStatuses();
assert.equal(reads.NameLinks, 1, 'membership should read name links once');
assert.equal(state.statuses.a, 'visitor');
assert.equal(state.statuses.bo, 'member');
assert.equal(state.statuses.j, 'junior');
assert.equal(state.notes.j, 'Junior linked to member Morgan Vale');
assert.equal(state.statuses.wcj, 'junior', 'a junior shows J even with an old member row');
assert.equal(state.notes.wcj, 'Junior linked to member Jordan Reyes');
assert.equal(state.statuses.ll, 'member', 'a confirmed linked name shares membership');
assert.equal(state.notes.ll, 'Also listed as May Tan');
assert.equal(state.statuses.x, undefined);
assert.equal(state.statuses.mh, 'junior', 'a junior needs no linked adult');
assert.equal(state.notes.mh, 'Junior member');
assert.throws(() => context.setMemberStatus('mh', 'visitor'), /stay marked J/);

state = context.setMemberStatus('ll', 'visitor');
assert.equal(state.statuses.ll, 'visitor', 'toggling one linked name updates both');
assert.equal(state.statuses.ml, 'visitor');
assert.equal(context.setMemberStatus('a', 'member').statuses.a, 'member');
assert.equal(context.setMemberStatus('a', '').statuses.a, 'visitor');

assert.throws(() => context.setMemberStatus('j', 'visitor'), /Morgan Vale's account/);
assert.throws(() => context.setMemberStatus('missing', 'member'), /Unknown/);
assert.throws(() => context.setMemberStatus('a', 'junior'), /Invalid/);
tables.MemberStatus.push({ player_id: 'a', status: 'visitor' });
assert.throws(() => context.getMemberStatuses(), /Duplicate/);
console.log('Member status checks passed');
