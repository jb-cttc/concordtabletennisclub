const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { projectFinalizedSession } = require('../scripts/lib/finalized-session');

// Server: finalizeSession writes the ledger first, rolls back a failure, repairs an earlier run that could not be
// rolled back, and logs every failure with a reference the desk can quote.
const SESSION = 'session-2026-10-07';
let tables;
let writes;
let fail;
let down;
let lockBusy;
const reset = () => {
  tables = {
    Players: [
      { player_id: 'a', display_name: 'Ava', current_rating: 1500, updated_at: 'old' },
      { player_id: 'b', display_name: 'Ben', current_rating: 1400, updated_at: 'old' },
      { player_id: 'c', display_name: 'Cy', current_rating: 1300, updated_at: 'old' },
      { player_id: 'd', display_name: 'Dee', current_rating: 1200, updated_at: 'old' }
    ],
    Sessions: [{ session_id: SESSION, session_date: '2026-10-07', status: 'active', revision: 4, created_at: 'then', updated_at: 'then', finalized_at: '' }],
    SessionPlayers: ['a', 'b', 'c'].map(id => ({ session_id: SESSION, player_id: id, group_number: 1, starting_rating: { a: 1500, b: 1400, c: 1300 }[id], promotion_from_group: '' })),
    Matches: [['a', 'b'], ['a', 'c'], ['b', 'c']].map(([one, two]) => ({
      match_id: SESSION + ':' + one + '::' + two, session_id: SESSION, group_number: 1, player_one_id: one, player_two_id: two,
      player_one_games: 3, player_two_games: 1, forfeit: false, forfeited_by: '', won_by: ''
    })),
    RatingLedger: [{ event_id: 'older:a', session_id: 'older', player_id: 'a', rating_before: 1490, adjustment: 10, rating_after: 1500 }]
  };
  writes = [];
  fail = () => false;
  down = false;
  lockBusy = false;
};
reset();

// A write fails when `fail` says so, and every write fails while Google is `down`.
const guard = (...entry) => {
  if (down || fail(...entry)) { down = down || !!fail.takesGoogleDown; throw new Error('Service Spreadsheets timed out'); }
  writes.push(entry);
};
// A failure that happens once, like a timeout.
const once = test => { let spent = false; return (...entry) => !spent && test(...entry) && (spent = true); };
const context = {
  LockService: { getScriptLock: () => ({ waitLock() { if (lockBusy) throw new Error('Lock timeout'); }, releaseLock() {} }) },
  appendAudit_: (...args) => { writes.push(['audit', ...args]); return '9b1c2d3e-aaaa-4bbb-8ccc-000000000000'; },
  schedulePublish_: id => writes.push(['publish', id]),
  ratingsSyncedThrough_: () => '2026-10-05',
  TABLES: {}
};
vm.createContext(context);
for (const file of ['RatingEngine.js', 'SessionService.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
Object.assign(context, {
  rows_: name => tables[name].map((row, index) => ({ ...row, __row: index + 2 })),
  updateRow_: (name, rowNumber, changes) => { guard(name, rowNumber, changes); Object.assign(tables[name][rowNumber - 2], changes); },
  appendObjects_: (name, objects) => { guard('append', name, objects.length); tables[name] = tables[name].concat(objects.map(row => ({ ...row }))); },
  replaceSessionRows_: (name, sessionId, rows) => {
    guard('replace', name, rows.length);
    tables[name] = tables[name].filter(row => row.session_id !== sessionId).concat(rows.map(({ __row, ...row }) => row));
  },
  writeSessionRow_: (session, changes) => {
    guard('Sessions', session.__row, changes);
    const { __row, ...original } = session;
    tables.Sessions[session.__row - 2] = { ...original, ...changes };
  },
  flushSheets_: () => {},
  displayDate_: value => String(value),
  getSession: id => ({ sessionId: id, status: tables.Sessions[0].status, revision: tables.Sessions[0].revision })
});
const ratings = () => Object.fromEntries(tables.Players.map(player => [player.player_id, player.current_rating]));
const ledger = () => tables.RatingLedger.filter(row => row.session_id === SESSION);
const audits = action => writes.filter(entry => entry[0] === 'audit' && entry[1] === action);
// What the publication step will check: participants, scores and ledger all agree.
const publishable = () => projectFinalizedSession(tables.Sessions[0], tables.SessionPlayers, tables.Matches, ledger(), tables.Players);
const FINAL = { a: 1505, b: 1400, c: 1295, d: 1200 };

// The normal path: ledger, then ratings, then the session; only changed ratings are written.
let result = context.finalizeSession(SESSION, 4);
assert.equal(result.status, 'finalized');
assert.deepEqual(ratings(), FINAL);
assert.deepEqual(tables.Sessions[0].revision, 5);
const order = writes.filter(entry => entry[0] !== 'audit').map(entry => entry[0] === 'append' ? 'ledger' : entry[0]);
assert.deepEqual(order, ['ledger', 'Players', 'Players', 'Sessions', 'publish'], 'ledger first, session last; Ben is unchanged and not rewritten');
assert.equal(audits('finalize_started').length, 1);
assert.equal(audits('session_finalized').length, 1);
assert.equal(publishable().groups[0].players.length, 3);

// The same finalize again (its reply was lost): the result, not an error, and nothing written.
writes = [];
assert.equal(context.finalizeSession(SESSION, 4).status, 'finalized');
assert.equal(writes.length, 0);
assert.throws(() => context.finalizeSession(SESSION, 3), /already finalized\. Reload the page/);

// Refusals change nothing, are logged, and end with the AuditLog reference.
const refuses = (pattern, setup, revision) => {
  reset();
  setup();
  assert.throws(() => context.finalizeSession(SESSION, revision === undefined ? tables.Sessions[0].revision : revision), pattern);
  assert.deepEqual(writes.filter(entry => entry[0] !== 'audit'), [], 'nothing is written on a refusal');
  assert.equal(audits('finalize_failed').length, 1);
};
refuses(/changed on another device or tab.*\(Reference 9B1C2D3E\)$/, () => {}, 3);
refuses(/Ben's rating is 1410 now but was 1400 when this session was last saved.*Click Save to Sheets/, () => { tables.Players[1].current_rating = 1410; });
refuses(/Missing 1 round-robin match/, () => { tables.Matches.pop(); });
refuses(/already has results through 2026-10-07.*twice/, () => { context.ratingsSyncedThrough_ = () => '2026-10-07'; });
context.ratingsSyncedThrough_ = () => '2026-10-05';
refuses(/still finishing another change/, () => { lockBusy = true; });

// Google stops while writing ratings: everything is put back and the desk is told nothing changed.
reset();
fail = once((name, row) => name === 'Players' && row === 4);
assert.throws(() => context.finalizeSession(SESSION, 4), /stopped partway through finalizing \(Service Spreadsheets timed out\)\. Nothing was changed and the session is still open\..*\(Reference 9B1C2D3E\)$/);
assert.deepEqual(ratings(), { a: 1500, b: 1400, c: 1300, d: 1200 });
assert.equal(tables.Players[0].updated_at, 'old', 'the rollback restores updated_at too');
assert.equal(ledger().length, 0);
assert.deepEqual([tables.Sessions[0].status, tables.Sessions[0].revision], ['active', 4]);
let logged = audits('finalize_failed')[0][4];
assert.deepEqual([logged.step, logged.rolledBack, logged.error], ['player ratings', true, 'Service Spreadsheets timed out']);
fail = () => false;
assert.deepEqual(context.finalizeSession(SESSION, 4).status, 'finalized', 'trying again works');
assert.deepEqual(ratings(), FINAL);

// Google stops on the session write: the ratings and ledger are put back as well.
reset();
fail = once(name => name === 'Sessions');
assert.throws(() => context.finalizeSession(SESSION, 4), /Nothing was changed/);
assert.deepEqual([ratings(), ledger().length, tables.Sessions[0].status], [{ a: 1500, b: 1400, c: 1300, d: 1200 }, 0, 'active']);

// Google goes down mid-run and the rollback fails too. The ledger rows stay behind, so the next attempt repairs
// the run instead of applying the ratings twice, even after a save copied the half-applied ratings as starting ones.
reset();
fail = (name, row) => name === 'Players' && row === 4;
fail.takesGoogleDown = true;
assert.throws(() => context.finalizeSession(SESSION, 4), /some changes could not be undone\. Keep the paper sheets and click Finalize RR Results again: the next attempt repairs this one\./);
logged = audits('finalize_failed')[0][4];
assert.equal(logged.rolledBack, false);
assert.match(logged.rollbackError, /timed out/);
assert.deepEqual([ratings().a, ratings().c, ledger().length, tables.Sessions[0].status], [1505, 1300, 3, 'active'], 'half applied');
down = false;
fail = () => false;
tables.SessionPlayers.forEach(row => { row.starting_rating = ratings()[row.player_id]; });
tables.Sessions[0].revision = 5;
writes = [];
assert.equal(context.finalizeSession(SESSION, 5).status, 'finalized');
assert.deepEqual(ratings(), FINAL, 'each rating change is applied once');
assert.deepEqual(tables.SessionPlayers.map(row => row.starting_rating), [1500, 1400, 1300], 'the real starting ratings are put back');
assert.equal(ledger().length, 3);
assert.equal(audits('finalize_started')[0][4].repairing, 3);
assert.equal(publishable().groups[0].players.find(player => player.name === 'Ava').ratingAfter, 1505);
assert.equal(tables.RatingLedger.filter(row => row.session_id === 'older').length, 1, 'other sessions\' ledger rows are kept');

// An older run that applied every rating but never marked the session finalized (the case that blocked the desk).
// A player dropped from the session since then goes back to their rating before it.
reset();
tables.RatingLedger.push(
  { event_id: SESSION + ':a', session_id: SESSION, player_id: 'a', rating_before: 1500, adjustment: 5, rating_after: 1505 },
  { event_id: SESSION + ':b', session_id: SESSION, player_id: 'b', rating_before: 1400, adjustment: 0, rating_after: 1400 },
  { event_id: SESSION + ':c', session_id: SESSION, player_id: 'c', rating_before: 1300, adjustment: -5, rating_after: 1295 },
  { event_id: SESSION + ':d', session_id: SESSION, player_id: 'd', rating_before: 1200, adjustment: 9, rating_after: 1209 }
);
Object.assign(tables.Players[0], { current_rating: 1505 });
Object.assign(tables.Players[2], { current_rating: 1295 });
Object.assign(tables.Players[3], { current_rating: 1209 });
tables.SessionPlayers.forEach(row => { row.starting_rating = ratings()[row.player_id]; });
assert.equal(context.finalizeSession(SESSION, 4).status, 'finalized');
assert.deepEqual(ratings(), FINAL);
assert.deepEqual(ledger().map(row => row.player_id).sort(), ['a', 'b', 'c']);
assert.ok(publishable());

// If a rating moved since the interrupted run, an automatic repair could double-count, so it stops.
refuses(/earlier finalize of this session did not finish, and the rating of Ava has changed since \(1500 before, 1505 after, 1520 now\)/, () => {
  tables.RatingLedger.push({ event_id: SESSION + ':a', session_id: SESSION, player_id: 'a', rating_before: 1500, adjustment: 5, rating_after: 1505 });
  tables.Players[0].current_rating = 1520;
});

// A logging failure never hides the real error or turns a success into a failure.
reset();
context.appendAudit_ = () => { throw new Error('AuditLog is full'); };
assert.equal(context.finalizeSession(SESSION, 4).status, 'finalized');
reset();
tables.Matches.pop();
assert.throws(() => context.finalizeSession(SESSION, 4), error => /Missing 1 round-robin match/.test(error.message) && !/Reference/.test(error.message));
console.log('Finalize session checks passed');

// Page: the button cannot start a second finalize, and after an error the page asks Google what really happened.
const html = fs.readFileSync(path.join(__dirname, 'Index.html'), 'utf8');
const slice = (from, to) => html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));
const page = {
  state: { session: { sessionId: SESSION, status: 'active', revision: 4 }, matches: [] },
  loadedDate: '2026-10-07',
  lockBusy: '',
  O: { matchState: () => 'complete' },
  confirm: () => true,
  render: () => {},
  refreshPublish: () => {},
  renderFinalizeButton: () => { page.buttonStates.push(page.lockBusy); },
  load: async () => { page.loads += 1; },
  setStatus: (message, type) => { page.status = message; page.statusType = type || ''; },
  busyStatus: () => () => {},
  reportDeskProblem: (kind, message) => { page.reports.push(kind + ': ' + message); },
  document: { activeElement: null },
  save: async () => ({ sessionId: SESSION, revision: 4 })
};
vm.createContext(page);
vm.runInContext(slice('  async function finalize() {', '  window.cttcDesk = {'), page);
const run = async (finalizeReply, appStateReply) => {
  Object.assign(page, { calls: [], reports: [], buttonStates: [], loads: 0, status: '', statusType: '' });
  page.call = (name, ...args) => {
    page.calls.push(name);
    if (name === 'finalizeSession' || name === 'reopenSession') return finalizeReply(args);
    if (name === 'getAppState') return appStateReply();
    throw new Error('unexpected ' + name);
  };
};
const deferred = () => { let resolve; let reject; const promise = new Promise((ok, bad) => { resolve = ok; reject = bad; }); return { promise, resolve, reject }; };

async function checkPage() {
  // A second click while the first is waiting on Google does nothing.
  const reply = deferred();
  await run(() => reply.promise);
  const first = page.finalize();
  await page.finalize();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(page.calls, ['finalizeSession'], 'only one finalize reaches Google');
  assert.equal(page.lockBusy, 'finalize');
  reply.resolve({ sessionId: SESSION, status: 'finalized', revision: 5 });
  await first;
  assert.equal(page.lockBusy, '');
  assert.deepEqual(page.buttonStates, ['finalize', '']);
  assert.match(page.status, /^Session finalized\./);

  // The reply was lost but Google finished: reported as success.
  page.state.session = { sessionId: SESSION, status: 'active', revision: 4 };
  await run(() => Promise.reject(new Error('NetworkError: Connection failure due to HTTP 0')), async () => ({ session: { sessionId: SESSION, status: 'finalized', revision: 5 } }));
  await page.finalize();
  assert.deepEqual(page.calls, ['finalizeSession', 'getAppState']);
  assert.match(page.status, /Session finalized\. Google Sheets confirmed it after a slow reply/);
  assert.equal(page.state.session.status, 'finalized');
  assert.deepEqual(page.reports, []);

  // A server refusal already carries its AuditLog reference: shown as is and not reported twice.
  page.state.session = { sessionId: SESSION, status: 'active', revision: 4 };
  await run(() => Promise.reject(new Error('Missing 1 round-robin match. (Reference 9B1C2D3E)')), async () => ({ session: { status: 'active' } }));
  await page.finalize();
  assert.equal(page.status, 'Not finalized: Missing 1 round-robin match. (Reference 9B1C2D3E)');
  assert.equal(page.statusType, 'error');
  assert.deepEqual(page.reports, []);
  assert.equal(page.lockBusy, '');

  // Google cannot be reached at all: the desk is told to reload before trying again, and the page reports it.
  await run(() => Promise.reject(new Error('Google did not respond')), () => Promise.reject(new Error('offline')));
  await page.finalize();
  assert.match(page.status, /^Not finalized: Google did not respond\. Google Sheets could not be reached to double-check, so reload the page before trying again\.$/);
  assert.deepEqual(page.reports, ['finalize failed: Google did not respond']);

  // Reopening has the same guard and the same check.
  page.state.session = { sessionId: SESSION, status: 'finalized', revision: 5 };
  const reopenReply = deferred();
  await run(() => reopenReply.promise);
  const reopening = page.reopen();
  await page.reopen();
  assert.deepEqual(page.calls, ['reopenSession']);
  reopenReply.reject(new Error('Service Spreadsheets timed out'));
  page.call = name => { page.calls.push(name); return Promise.resolve({ session: { sessionId: SESSION, status: 'active', revision: 6 } }); };
  await reopening;
  assert.equal(page.loads, 1);
  assert.match(page.status, /Session reopened and ratings restored \(Google Sheets confirmed it after a slow reply\)/);
  assert.equal(page.lockBusy, '');
  console.log('Finalize button and error recovery checks passed');
}
checkPage().catch(error => { console.error(error); process.exitCode = 1; });
