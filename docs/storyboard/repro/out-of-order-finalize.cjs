// Run: node docs/storyboard/repro/out-of-order-finalize.cjs   (a storyboard finding; see docs/storyboard/README.md)
// Repro: a night dated BEFORE the desk's latest finalized round robin can still be finalized (no check), so its
// rating changes land on top of the later night's ratings, while the site's players.json takes ratings from the
// latest-dated session only.
const sim = require('../../../scripts/lib/desk-sim');
const world = sim.createWorld({ seed: 3 });
const s = world.server;
const ids = world.players.slice(0, 3).map(p => p.player_id);
console.log('latest finalized RR before:', s.run('latestFinalizedSessionDate_'));
const created = s.run('createSession', '2026-10-05');
const pairs = [[0, 1], [0, 2], [1, 2]];
const saved = s.run('saveSessionDraft', { sessionId: created.sessionId, revision: created.revision, groups: [{ groupNumber: 1, playerIds: ids }],
  matches: pairs.map(([a, b]) => ({ groupNumber: 1, playerOneId: ids[a], playerTwoId: ids[b], playerOneGames: 0, playerTwoGames: 3, forfeit: false, forfeitedBy: null, wonBy: null })), promotions: {} });
try {
  const done = s.run('finalizeSession', created.sessionId, saved.revision);
  console.log('finalized 2026-10-05 after 2026-10-12 was finalized:', done.status);
  console.log('ledger:', s.rows('RatingLedger').filter(r => r.session_id === created.sessionId).map(r => r.rating_before + '->' + r.rating_after).join(', '));
} catch (e) { console.log('refused:', e.message); }
