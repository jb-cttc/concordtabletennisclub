const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

let ids = [[3], [2]];
let counters = [[4, 5, 1, 2], [6, 7, 3, 4]];
const archives = {};
const sheet = {
  getLastRow: () => ids.length + 1,
  getRange: function (...args) {
    return {
      getValue: () => 'Player ID',
      getValues: () => typeof args[0] === 'string' ? [['Club Wins - Matches', 'Club Losses - Matches', 'League Wins - Matches', 'League Losses - Matches']] : args[1] === 1 ? ids : counters
    };
  }
};
const context = {
  SpreadsheetApp: { getActive: () => ({
    getSheetByName: (name) => name === 'AccessPlayers' ? sheet : archives[name],
    insertSheet: (name) => {
      const archive = {
        getRange: () => ({
          setValues: (values) => { archive.values = values; },
          getValues: () => [archive.values[0]]
        }),
        setFrozenRows: () => {}
      };
      archives[name] = archive;
      return archive;
    }
  }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (algorithm, value) => [...crypto.createHash(algorithm).update(value).digest()]
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/RecordArchive.js', 'utf8'), context);

const result = context.inspectAccessRecordCounters();
assert.equal(result.rows, 2);
assert.equal(result.counterHash, crypto.createHash('sha256').update('2:6:7:3:4\n3:4:5:1:2').digest('hex'));
assert.deepEqual(Array.from(result.totals), [10, 12, 4, 6]);
ids = [[3], [3]];
assert.throws(() => context.inspectAccessRecordCounters(), /duplicate/);
ids = [[3], [2]];
counters = [[4, 5, '', 2], [6, 7, 3, 4]];
assert.throws(() => context.inspectAccessRecordCounters(), /Invalid record counter/);

ids = Array.from({ length: 27 }, (_, index) => [index + 1]);
counters = ids.map(() => [0, 0, 0, 0]);
context.ACCESS_RECORD_SNAPSHOT_HASH = context.inspectAccessRecordCounters().counterHash;
const delta = ids.map(([id]) => [id, id === 1 ? 58 : 0, id === 2 ? 33 : id > 2 ? 1 : 0]);
const finalRows = ids.map(([id]) => [id, ...counters[id - 1]]);
delta.forEach(([id, won, lost]) => {
  finalRows[id - 1][1] += won;
  finalRows[id - 1][2] += lost;
  finalRows[id - 1][3] += won;
  finalRows[id - 1][4] += lost;
});
context.ACCESS_RECORD_THROUGH_HASH = context.recordFingerprint_(finalRows);
assert.equal(context.seedRecordArchive2026(delta).rows, 27);
assert.equal(archives.RecordArchive.values.length, 28);
assert.deepEqual(Array.from(archives.RecordArchive.values[1]).slice(0, 6), ['access-1', 2026, 0, 0, 0, 0]);
assert.equal(archives.RecordArchiveEvents.values.length, 28);
assert.deepEqual(Array.from(archives.RecordArchiveEvents.values[1]), ['2026-09-23', 'access-1', 58, 0, 'Access Match']);
assert.throws(() => context.seedRecordArchive2026(delta), /already exists/);
archives.RecordArchive.values.slice(1).forEach(row => { row[6] = new Date('2026-09-21T12:00:00Z'); });
archives.RecordArchiveEvents.values.slice(1).forEach(row => { row[0] = new Date('2026-09-23T12:00:00Z'); });

context.ACCESS_RECORD_COUNT = 27;
context.rows_ = (name) => {
  if (name === 'Players') return roster.map(id => ({ player_id: id }));
  if (name === 'Sessions') return [{ session_id: 'later', session_date: '2026-09-24', status: 'finalized' }, { session_id: 'draft', session_date: '2026-09-25', status: 'draft' }];
  if (name === 'Matches') return [
    { session_id: 'later', player_one_id: 'access-1', player_two_id: 'access-2', player_one_games: 3, player_two_games: 1, forfeit: false },
    { session_id: 'later', player_one_id: 'access-1', player_two_id: 'access-2', player_one_games: 3, player_two_games: 0, forfeit: true },
    { session_id: 'draft', player_one_id: 'access-1', player_two_id: 'access-2', player_one_games: 0, player_two_games: 3, forfeit: false }
  ];
  const values = archives[name].values;
  return values.slice(1).map(row => Object.fromEntries(values[0].map((header, index) => [header, row[index]])));
};
context.validateSessionDate_ = (date) => assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
context.displayDate_ = (date) => date instanceof Date ? date.toISOString().slice(0, 10) : date;
context.asBoolean_ = Boolean;
const roster = ['access-1', 'access-2', 'player-new'];
const before = context.getPlayerRecordsForPrint(roster, '2026-09-23');
assert.equal(before.records['access-1'].clubWins, 0);
assert.equal(before.missing, 1);
const after = context.getPlayerRecordsForPrint(roster, '2026-09-24');
assert.equal(after.records['access-1'].clubWins, 58);
assert.equal(after.records['access-2'].clubLosses, 33);
const later = context.getPlayerRecordsForPrint(roster, '2026-09-25');
assert.equal(later.records['access-1'].clubWins, 59);
assert.equal(later.records['access-2'].yearLosses, 34);
const nextYear = context.getPlayerRecordsForPrint(roster, '2027-01-05');
assert.equal(nextYear.records['access-1'].clubWins, 59);
assert.equal(nextYear.records['access-1'].yearWins, 0);
context.ratingsSyncedThrough_ = () => '2026-09-23';
assert.equal(context.recordArchiveStatus().missingPlayers, 1);
assert.equal(context.recordArchiveStatus().readyForCutover, false);
context.findRow_ = (table, key, id) => context.rows_(table).find(row => row[key] === id);
context.appendObjects_ = (name, objects) => {
  const headers = archives[name].values[0];
  objects.forEach(object => archives[name].values.push(headers.map(header => object[header])));
};
assert.throws(() => context.addVerifiedRecordBaseline('player-new', 0, 0, 0, 0, ''), /source description/);
assert.equal(context.addVerifiedRecordBaseline('player-new', 0, 0, 0, 0, 'Reviewed source').readyForCutover, true);
assert.equal(context.getPlayerRecordsForPrint(roster, '2026-09-24').records['player-new'].clubWins, 0);
let enabled = 0;
let ready = false;
const guard = vm.createContext({
  recordArchiveStatus: () => ({ readyForCutover: ready, missingPlayers: 26, ratingsSyncedThrough: '2026-09-23' }),
  PropertiesService: { getScriptProperties: () => ({ setProperty: () => { enabled += 1; }, getProperty: () => 'true' }) },
  appendAudit_: () => {}
});
vm.runInContext(fs.readFileSync(__dirname + '/SessionService.js', 'utf8'), guard);
assert.throws(() => guard.enableClosedLoopMode(), /Record archive cutover blocked/);
assert.equal(enabled, 0);
ready = true;
assert.equal(guard.enableClosedLoopMode(), true);
assert.equal(enabled, 1);
console.log('Access record archive checks passed');