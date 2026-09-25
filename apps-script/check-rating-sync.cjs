const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const props = {};
const tables = {
  Players: [
    { player_id: 'jb', display_name: 'Pat Lee', current_rating: 1413, active: true },
    { player_id: 'bo', display_name: 'Chris Moss', current_rating: 1163, active: true },
    { player_id: 'gone', display_name: 'Old Timer', current_rating: 800, active: false },
    { player_id: 'sc', display_name: 'Sam Rivera', current_rating: 1004, active: true }
  ],
  Aliases: [{ alias: 'Sam Riviera', player_id: 'sc' }],
  Sessions: [{ session_id: 'session-2026-09-23', session_date: '2026-09-23', status: 'active', revision: 4 }],
  SessionPlayers: [{ session_id: 'session-2026-09-23', player_id: 'jb', group_number: 1, starting_rating: 1413 }],
  Matches: []
};
const writes = [];
const context = {
  TABLES: { Players: ['player_id', 'display_name', 'current_rating', 'active', 'created_at', 'updated_at'] },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  appendAudit_() {}
};
vm.createContext(context);
for (const file of ['SessionService.js', 'RatingSync.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context);
Object.assign(context, {
  rows_: name => tables[name].map((row, index) => ({ ...row, __row: index + 2 })),
  updateRow_: (name, rowNumber, changes) => { writes.push([name, rowNumber, changes]); Object.assign(tables[name][rowNumber - 2], changes); },
  replaceSessionRows_: (name, sessionId, rows) => { tables[name] = tables[name].filter(r => r.session_id !== sessionId).concat(rows); },
  displayDate_: value => String(value)
});
const site = players => ({ latestSessionDate: '2026-09-23', players });
context.UrlFetchApp = { fetch: () => ({
  getResponseCode: () => 200,
  getContentText: () => JSON.stringify(site([{ name: 'Pat Lee', currentRating: 1413 }]))
}) };
const measured = context.syncRatingsFromPublicSite();
assert.ok(measured.checkedAt, 'sync records a check time');
for (const phase of ['fetchMs', 'applyMs', 'lockMs', 'sessionsMs', 'aliasesMs', 'playersMs', 'totalMs']) {
  assert.ok(Number.isFinite(measured.timings[phase]) && measured.timings[phase] >= 0, phase + ' has a duration');
}
assert.ok(measured.timings.totalMs >= measured.timings.fetchMs + measured.timings.applyMs);
assert.equal(props.CTTC_RATINGS_CHECKED_AT, measured.checkedAt);

const result = context.applyPublicRatings_(site([{ name: 'Pat Lee', currentRating: 1449 }, { name: 'Chris Moss', currentRating: 1163 }, { name: 'Old Timer', currentRating: 1 }]));
assert.equal(result.updated, 1, 'only changed active ratings are written');
assert.equal(tables.Players[0].current_rating, 1449);
assert.equal(tables.Players[2].current_rating, 800, 'inactive players untouched');
assert.equal(props.CTTC_RATINGS_SYNCED_THROUGH, '2026-09-23');
assert.equal(context.applyPublicRatings_(site([{ name: 'Pat Lee', currentRating: 1449 }])).updated, 0, 'rerun is a no-op');

const aliased = context.applyPublicRatings_(site([{ name: 'Sam Riviera', currentRating: 1010 }]));
assert.deepEqual({ ...aliased.changes }, { sc: 1010 }, 'an old spelling on the site still updates the renamed player');
assert.equal(context.applyPublicRatings_(site([{ name: 'Sam Riviera', currentRating: 900 }, { name: 'Sam Rivera', currentRating: 1020 }])).changes.sc, 1020, 'the exact name wins over an alias');

assert.throws(() => context.applyPublicRatings_(site([{ name: 'X', currentRating: 1 }, { name: 'x', currentRating: 2 }])), /Duplicate/);
assert.throws(() => context.applyPublicRatings_(site([{ name: 'X', currentRating: -5 }])), /Invalid public rating/);
assert.throws(() => context.applyPublicRatings_({ players: [] }), /Unexpected/);

assert.throws(() => context.finalizeSession('session-2026-09-23', 4), /off until go-live/, 'finalize is off until the go-live switch is set');
props.CTTC_CLOSED_LOOP = 'true';
assert.throws(() => context.finalizeSession('session-2026-09-23', 4), /already has results through 2026-09-23.*twice/);
assert.equal(tables.Sessions[0].status, 'active', 'blocked finalize changes nothing');

context.saveSessionDraft({ sessionId: 'session-2026-09-23', revision: 4, groups: [{ groupNumber: 1, playerIds: ['jb'] }], matches: [] });
assert.equal(tables.SessionPlayers[0].starting_rating, 1449, 'saving a draft refreshes stale starting ratings');

tables.Sessions[0].revision = 4;
context.saveSessionDraft({ sessionId: 'session-2026-09-23', revision: 4, groups: [{ groupNumber: 1, playerIds: ['jb'] }, { groupNumber: 2, playerIds: ['bo'] }], matches: [], promotions: { jb: 2, bo: 1 } });
const saved = Object.fromEntries(tables.SessionPlayers.map(row => [row.player_id, row.promotion_from_group]));
assert.deepEqual(saved, { jb: 2, bo: '' }, 'promotions persist per player; a move down is not a promotion');

tables.Sessions.push({ session_id: 'session-2026-09-28', session_date: '2026-09-28', status: 'finalized', revision: 2 });
writes.length = 0;
const skipped = context.applyPublicRatings_(site([{ name: 'Pat Lee', currentRating: 1000 }]));
assert.equal(skipped.skipped, true, 'app-finalized sessions newer than the site are never overwritten');
assert.equal(writes.length, 0);
console.log('Rating sync checks passed');
