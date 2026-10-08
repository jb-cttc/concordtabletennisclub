const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const tables = {};
const writes = [];
let siteSessions = [];
let siteStatus = 200;
let failOn = '';
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
  failOn = '';
  writes.length = 0;
};
reset();

const context = {
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => siteStatus, getContentText: () => JSON.stringify(siteSessions) }) },
  appendAudit_: (...args) => { writes.push(['audit', ...args]); return '3f2a9c1d-0000-4000-8000-000000000000'; },
  cancelPublish_: id => writes.push(['cancelPublish', id]),
  TABLES: {}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/SessionService.js', 'utf8'), context);
Object.assign(context, {
  rows_: name => tables[name].map((row, index) => ({ ...row, __row: index + 2 })),
  updateRow_: (name, rowNumber, changes) => { writes.push([name, rowNumber, changes]); Object.assign(tables[name][rowNumber - 2], changes); },
  replaceSessionRows_: (name, sessionId, rows) => { tables[name] = tables[name].filter(row => row.session_id !== sessionId).concat(rows); writes.push(['replace', name, sessionId]); },
  writeSessionRow_: (session, changes) => { if (failOn === 'session') throw new Error('Service Spreadsheets timed out'); writes.push(['Sessions', session.__row, changes]); Object.assign(tables.Sessions[session.__row - 2], changes); },
  flushSheets_: () => {},
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
  assert.deepEqual(writes.filter(entry => entry[0] !== 'audit'), [], 'nothing is written on a refusal');
  const logged = writes.filter(entry => entry[0] === 'audit');
  assert.equal(logged.length, 1);
  assert.equal(logged[0][1], 'reopen_failed', 'a refusal is logged with its reason');
  assert.match(logged[0][4].message, pattern);
};
assert.throws(() => { reset(); tables.Sessions[0].revision = 6; context.reopenSession('session-2026-10-05', 6.5); }, /\(Reference 3F2A9C1D\)$/, 'the error names the AuditLog row');
reset();
// A repeat of a reopen whose reply was lost reports the reopened session instead of an error.
context.reopenSession('session-2026-10-05', 7);
writes.length = 0;
assert.equal(context.reopenSession('session-2026-10-05', 7).status, 'active');
assert.equal(writes.length, 0, 'the repeat changes nothing');

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
refuses(/changed after this session was finalized \(1420 then, 1433 now\)/);

// Google stops partway: the error says to click again, and the second click finishes the job.
reset();
failOn = 'session';
assert.throws(() => context.reopenSession('session-2026-10-05', 7), /stopped partway through reopening \(Service Spreadsheets timed out\).*click it again/);
const failure = writes.find(entry => entry[0] === 'audit' && entry[1] === 'reopen_failed');
assert.equal(failure[4].step, 'session status');
assert.deepEqual([rating('a'), rating('b'), tables.Sessions[0].status], [1400, 1310, 'finalized'], 'ratings were restored before Google stopped');
failOn = '';
writes.length = 0;
assert.equal(context.reopenSession('session-2026-10-05', 7).status, 'active', 'a player already back at rating_before is accepted');
assert.equal(writes.filter(entry => entry[0] === 'Players').length, 0, 'ratings already restored are not written again');
assert.deepEqual(tables.RatingLedger.map(row => row.event_id), ['o:a']);
assert.throws(() => context.reopenSession('missing', 1), /Session not found/);

console.log('Session reopen checks passed');
