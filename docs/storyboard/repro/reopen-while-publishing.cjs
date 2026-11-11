// Run: node docs/storyboard/repro/reopen-while-publishing.cjs   (a storyboard finding; see docs/storyboard/README.md)
// Repro: while the publish workflow is running ('dispatched', the site does not list the session yet), the lock
// button can still reopen the session. If the workflow already read the finalized rows, the site gets that version;
// after the reopen (and a refinalize) every later publication stops with "Previously published session missing or changed".
const sim = require('../../../scripts/lib/desk-sim');
const { buildPublication } = require('../../../scripts/publish-finalized-sessions');
const DATE = '2026-10-14';
const ID = 'session-' + DATE;
const run = (world, ms) => world.clock.run(ms);
const plainTables = world => {
  const out = {};
  ['Players', 'Sessions', 'SessionPlayers', 'Matches', 'RatingLedger'].forEach(name => {
    out[name] = world.server.rows(name).map(row => {
      const o = {};
      Object.keys(row).forEach(k => { if (k !== '__row') o[k] = (row[k] && typeof row[k] === 'object' && typeof row[k].toISOString === 'function') ? (k === 'session_date' ? row[k].toISOString().slice(0,10) : row[k].toISOString()) : (row[k] === true ? 'TRUE' : row[k] === false ? 'FALSE' : String(row[k])); });
      return o;
    });
  });
  out.Sessions = out.Sessions.filter(s => s.session_id === ID);
  return out;
};
(async () => {
  const world = sim.createWorld({ seed: 11 });
  const tab = world.device().open();
  await run(world, 15000);
  world.players.slice(0, 5).forEach(p => tab.addPlayer(p.player_id));
  await run(world, 20000);
  for (let i = 0; i < tab.matchCount(); i += 1) { tab.scoreMatch(i, 'two', 1); await run(world, 4000); }
  await run(world, 20000);
  tab.finalize();
  await run(world, 30000);
  const session = sim.googleSession(world, DATE);
  console.log('finalized:', session.status, 'revision', session.revision);
  // The workflow was dispatched and has read the Sheet; the site does not list the session yet.
  const props = world.server.properties;
  const pending = JSON.parse(props.CTTC_PENDING_PUBLISH);
  pending.state = 'dispatched'; pending.dispatchedAt = world.clock.now();
  props.CTTC_PENDING_PUBLISH = JSON.stringify(pending);
  const published = buildPublication([], plainTables(world), '2026-10-01').details;
  console.log('workflow built', published.length, 'session(s) from the finalized rows');
  // Volunteer clicks the lock while "Publishing started." shows.
  try {
    const reopened = world.server.run('reopenSession', ID, session.revision);
    console.log('reopen allowed while dispatched:', reopened.status, 'revision', reopened.revision, '| pending now:', props.CTTC_PENDING_PUBLISH || '(cleared)');
  } catch (e) { console.log('reopen refused:', e.message); }
  // Corrected and finalized again; next publish run starts from the files the first run committed.
  const again = world.server.run('getSessionByDate', DATE);
  world.server.run('finalizeSession', ID, again.revision);
  try {
    buildPublication(published, plainTables(world), '2026-10-01');
    console.log('second publication OK');
  } catch (e) { console.log('second publication throws:', e.message); }
})();
