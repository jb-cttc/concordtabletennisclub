const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const tables = {};
const writes = [];
let siteSessions = [];
let siteStatus = 200;
const reset = () => {
  tables.Players = [
    { player_id: 'a', display_name: 'Ava', current_rating: 1420 },
    { player_id: 'b', display_name: 'Ben', current_rating: 1290 }
  ];
  tables.Sessions = [{ session_id: 'session-2026-10-05', session_date: '2026-10-05', status: 'finalized', revision: 7, finalized_at: 'yesterday' }];
  tables.RatingLedger = [
    { event_id: 's:a', session_id: 'session-2026-10-05', player_id: 'a', rating_before: 1400, adjustment: 20, rating_after: 1420 },
    { event_id: 's:b', session_id: 'session-2026-10-05', player_id: 'b', rating_before: 1310, adjustment: -20, rating_after: 1290 },
    { event_id: 'o:a', session_id: 'older', player_id: 'a', rating_before: 1390, adjustment: 10, rating_after: 1400 }
  ];
  siteSessions = [{ date: '2026-09-30', source: 'app' }];
  siteStatus = 200;
  writes.length = 0;
};
reset();

const context = {
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => siteStatus, getContentText: () => JSON.stringify(siteSessions) }) },
  appendAudit_: (...args) => writes.push(['audit', ...args]),
  TABLES: {}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/SessionService.js', 'utf8'), context);
Object.assign(context, {
  rows_: name => tables[name].map((row, index) => ({ ...row, __row: index + 2 })),
  updateRow_: (name, rowNumber, changes) => { writes.push([name, rowNumber, changes]); Object.assign(tables[name][rowNumber - 2], changes); },
  replaceSessionRows_: (name, sessionId, rows) => { tables[name] = tables[name].filter(row => row.session_id !== sessionId).concat(rows); writes.push(['replace', name, sessionId]); },
  displayDate_: value => String(value),
  getSession: id => ({ sessionId: id, status: tables.Sessions[0].status })
});
const rating = id => tables.Players.find(player => player.player_id === id).current_rating;

// Reopening restores ratings from the ledger, removes that session's ledger rows, and unlocks the session.
const reopened = context.reopenSession('session-2026-10-05', 7);
assert.equal(reopened.status, 'active');
assert.deepEqual([rating('a'), rating('b')], [1400, 1310]);
assert.deepEqual(tables.RatingLedger.map(row => row.event_id), ['o:a'], 'only this session\'s ledger rows are removed');
assert.deepEqual([tables.Sessions[0].status, tables.Sessions[0].revision, tables.Sessions[0].finalized_at], ['active', 8, '']);
assert.ok(writes.some(entry => entry[0] === 'audit' && entry[1] === 'session_reopened'), 'the reopen is audited');

// It refuses, and changes nothing, when it should not run.
const refuses = (pattern, revision) => {
  writes.length = 0;
  assert.throws(() => context.reopenSession('session-2026-10-05', revision === undefined ? 7 : revision), pattern);
  assert.equal(writes.length, 0, 'nothing is written on a refusal');
};
reset();
refuses(/changed on another device/, 6);
tables.Sessions[0].status = 'active';
refuses(/Only a finalized session/);
reset();
siteSessions.push({ date: '2026-10-05', source: 'app' });
refuses(/already lists this session/);
reset();
siteStatus = 500;
refuses(/Could not check/);
reset();
tables.Sessions.push({ session_id: 'session-2026-10-07', session_date: '2026-10-07', status: 'finalized', revision: 2 });
refuses(/2026-10-07 session is already finalized/);
reset();
tables.Players[0].current_rating = 1433;
refuses(/changed after this session was finalized/);
assert.throws(() => context.reopenSession('missing', 1), /Session not found/);

console.log('Session reopen checks passed');
