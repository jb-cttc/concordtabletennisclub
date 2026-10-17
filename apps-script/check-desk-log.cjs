// The CTTC Desk Logs tab, on the whole-desk simulator: a club night's key steps are logged, every kind of failure is
// caught (an action that fails, a call that fails, a page error, a background job), and no row ever holds a name, an
// address, a number, a payment method or a member status. Synthetic players only.
const assert = require('node:assert/strict');
const sim = require('../scripts/lib/desk-sim');

const DATE = '2026-10-14';
const run = (world, ms) => world.clock.run(ms);
const log = world => {
  const sheet = world.server.spreadsheet.getSheetByName('CTTC Desk Logs');
  assert.ok(sheet, 'the desk log tab is made when first needed');
  const values = sheet.getDataRange().getValues();
  assert.deepEqual(values[0], ['at', 'level', 'what', 'session', 'ref', 'detail']);
  return values.slice(1).map(([at, level, what, session, ref, detail]) => ({ at: String(at), level, what, session: String(session), ref: String(ref), detail: String(detail) }));
};
const PRIVATE = /@|Example|Ava|Ben|cash|zeffy|venmo|member|visitor|player-sim/i;

(async () => {
  const world = sim.createWorld({ seed: 31 });
  const device = world.device();
  const tab = device.open();
  await run(world, 15000);
  world.players.slice(0, 6).forEach(p => tab.addPlayer(p.player_id));
  await run(world, 20000);
  for (let i = 0; i < tab.matchCount(); i += 1) { tab.scoreMatch(i, i % 2 ? 'one' : 'two', i % 3); await run(world, 4000); }
  await run(world, 20000);
  tab.pay(world.players[0].player_id, 'cash');
  await run(world, 10000);

  // A call that fails is caught by the page, even though nothing expected it, and logged as a warning.
  device.net.failReply = 1;
  tab.scoreMatch(0, 'one', 2);
  await run(world, 8000);
  device.net.failReply = 0;
  await run(world, 60000);
  // An error in the page itself.
  tab.window.dispatchEvent(new tab.window.ErrorEvent('error', { message: 'TypeError: cannot read x of undefined', lineno: 1234 }));
  await run(world, 5000);

  tab.finalize();
  await run(world, 60000);
  assert.equal(sim.googleSession(world, DATE).status, 'finalized');

  // A background job that fails with nobody watching.
  world.site = () => undefined;
  assert.throws(() => world.server.run('syncRatingsFromPublicSite'), /HTTP 404/);

  const rows = log(world);
  const whats = rows.map(row => row.level + ' ' + row.what);
  ['step session_created', 'step session_saved', 'step session_payment_updated', 'step finalize_started', 'step session_finalized']
    .forEach(step => assert.ok(whats.includes(step), 'logged: ' + step));
  const saved = rows.find(row => row.what === 'session_saved');
  assert.equal(saved.session, DATE, 'a step names its session by date');
  assert.match(saved.detail, /^revision=\d+ players=\d+ matches=\d+/, 'with its counts');
  const paid = rows.find(row => row.what === 'session_payment_updated');
  assert.match(paid.detail, /^player=P[0-9A-F]{6}$/, 'a payment names the player only by code, and never the method');
  const failedCall = rows.find(row => row.what === 'page: call failed');
  assert.ok(failedCall, 'a failed call is caught');
  assert.equal(failedCall.level, 'warn');
  assert.equal(failedCall.session, DATE);
  assert.equal(failedCall.detail, 'saveSessionDraft: NetworkError: Connection failure due to HTTP 500 revision=' + failedCall.detail.match(/revision=(\d+)/)[1] +
    ' status=active online=true mode=dev call=saveSessionDraft', 'with what the page knew, and no date repeated in the text');
  assert.equal(rows.filter(row => row.what === 'page: call failed' && /^saveSessionDraft:/.test(row.detail)).length, 1,
    'a failure that repeats while retrying, or whose report Google kept but lost the reply to, is logged once');
  const pageError = rows.find(row => row.what === 'page: page error');
  assert.ok(pageError && pageError.level === 'error', 'an error in the page is caught');
  assert.match(pageError.detail, /^TypeError: cannot read x of undefined \(line 1234\)/);
  const sync = rows.find(row => row.what === 'rating_sync_failed');
  assert.ok(sync && sync.level === 'error', 'a background job that fails is logged');
  assert.match(sync.detail, /Club site returned HTTP 404/);
  assert.match(sync.ref, /^[0-9A-F]{8}$/, 'an error carries the AuditLog reference');
  assert.ok(world.server.rows('AuditLog').some(row => String(row.event_id).replace(/-/g, '').slice(0, 8).toUpperCase() === sync.ref), 'which finds the private AuditLog row');
  rows.forEach(row => {
    assert.match(row.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/);
    assert.match(row.level, /^(step|warn|error)$/);
    assert.doesNotMatch(JSON.stringify(row), PRIVATE, 'no name, address, payment method, member status or player id: ' + JSON.stringify(row));
  });

  // An action that fails (finalizing with unscored matches) shows the desk a Reference, and the log has the same one,
  // with player ids taken out.
  const world2 = sim.createWorld({ seed: 32 });
  const tab2 = world2.device().open();
  await run(world2, 15000);
  world2.players.slice(0, 3).forEach(p => tab2.addPlayer(p.player_id));
  await run(world2, 20000);
  assert.throws(() => world2.server.run('finalizeSession', 'session-' + DATE, sim.googleSession(world2, DATE).revision), error => {
    const reference = /\(Reference ([0-9A-F]{8})\)/.exec(error.message)[1];
    const row = log(world2).find(entry => entry.what === 'finalize_failed');
    assert.ok(row && row.ref === reference && row.level === 'error', 'the log has the Reference the desk showed');
    assert.equal(row.detail, 'Incomplete or invalid match: <player>::<player>');
    return true;
  });

  // The tab keeps the latest rows.
  const sheet = world.server.spreadsheet.getSheetByName('CTTC Desk Logs');
  const keep = world.server.context.DESK_LOG_KEEP;
  for (let i = log(world).length; i < keep + 120; i += 1) sheet.appendRow(["'2026-01-01T00:00:00.000Z", "'step", "'old", "'", "'", "'"]);
  world.server.run('deskLog_', 'step', 'newest', DATE, '', '');
  assert.equal(log(world).length, keep, 'the oldest rows are dropped');
  assert.equal(log(world).pop().what, 'newest');

  // Text that might hold something personal is cleaned.
  assert.equal(world.server.context.cleanDeskText_('Invalid email: sam@example.com for "Sam Example", call +1 (925) 555-1234 about 1iH-jbmnYL7kfeyq0r0WMMkmxR7439 and player-sam-smith'),
    'Invalid email: <address> for "…", call <number> about <id> and <player>');
  console.log('Desk log checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
