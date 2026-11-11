// Run: node docs/storyboard/repro/finalized-standings.cjs   (a storyboard finding; see docs/storyboard/README.md)
// Repro: after finalize, a fresh page (reload or second device) shows the finalized night's "Rating" column
// computed from the post-finalize directory rating, so the change is counted twice.
const sim = require('../../../scripts/lib/desk-sim');
const DATE = '2026-10-14';
const run = (world, ms) => world.clock.run(ms);
(async () => {
  const world = sim.createWorld({ seed: 11 });
  const device = world.device();
  const tab = device.open();
  await run(world, 15000);
  world.players.slice(0, 5).forEach(p => tab.addPlayer(p.player_id));
  await run(world, 20000);
  for (let i = 0; i < tab.matchCount(); i += 1) { tab.scoreMatch(i, 'two', 1); await run(world, 4000); }
  await run(world, 20000);
  const cells = t => Array.from(t.window.document.querySelectorAll('.standings tbody tr')).map(tr => tr.children[0].textContent + ' | ' + tr.children[3].getAttribute('title') + ' | ' + tr.children[3].textContent);
  console.log('Before finalize (first tab):'); console.log(cells(tab).join('\n'));
  tab.finalize();
  await run(world, 60000);
  console.log('status:', sim.googleSession(world, DATE).status);
  console.log('After finalize, same tab:'); console.log(cells(tab).join('\n'));
  const ledger = world.server.rows('RatingLedger').filter(r => r.session_id === 'session-' + DATE).map(r => r.player_id.slice(-3) + ' ' + r.rating_before + ' -> ' + r.rating_after);
  console.log('Ledger:'); console.log(ledger.join('\n'));
  const other = world.device().open();
  await run(world, 30000);
  console.log('Fresh page (second device) on the finalized night:'); console.log(cells(other).join('\n'));
})();
