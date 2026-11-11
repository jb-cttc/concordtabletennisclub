// Run: node docs/storyboard/repro/empty-group.cjs   (a storyboard finding; see docs/storyboard/README.md)
// Fixed (setGroups keeps printed numbers, apps-script/Index.html); kept to show it stays fixed.
// After the print, every player in Group 2 leaves (e.g. a group of 4 goes home). What do Groups 3+ become?
const sim = require('../../../scripts/lib/desk-sim');
const run = (w, ms) => w.clock.run(ms);
(async () => {
  const world = sim.createWorld({ seed: 97, players: 40 });
  const tab = world.device().open(); await run(world, 15000);
  world.players.slice(0, 18).forEach(p => tab.addPlayer(p.player_id)); await run(world, 20000);
  const g = () => Array.from(tab.desk().groups).map(x => x.groupNumber + ':' + x.playerIds.length);
  tab.window.cttcPlayerBoard.printed(); await run(world, 2000);
  const before = Array.from(tab.desk().groups).map(x => Array.from(x.playerIds));
  console.log('printed groups', g().join(' '));
  for (const id of before[1]) { tab.removePlayer(id); await run(world, 300); }
  console.log('after emptying Group 2', g().join(' '));
  const third = before[2][0];
  console.log('a Group 3 player is now in group', tab.desk().groups.find(x => x.playerIds.includes(third)).groupNumber);
  console.log('labels', JSON.stringify(tab.window.cttcPlayerBoard.labels && tab.window.cttcPlayerBoard.labels()));
  console.log('printNote', tab.window.cttcPlayerBoard.printNote());
  const after = Array.from(tab.desk().groups).map(x => x.groupNumber).join(',');
  console.log(after === '1,3' && !tab.window.cttcPlayerBoard.printNote() ? 'FIXED: groups keep their printed numbers (1, 3) and no sheet is named to replace' : 'STILL BROKEN: groups ' + after);
  console.log('errors', tab.errors);
})();
