// Randomized club nights on the simulated desk (scripts/lib/desk-sim.js): each seed mixes slow Google, lost replies,
// Wi-Fi drops, reloads, payments while Gmail is slow, and sometimes a second device, then checks that every score
// reached Google, the screens agree with it, no device copy is left behind, and the session finalizes.
// Run: npm run check:nights [-- first-seed count]   (about a minute per night; not part of npm test)
'use strict';

const { playNight, verdict, finalizeNight } = require('./lib/desk-night');
const sim = require('./lib/desk-sim');

function plan(seed) {
  const r = sim.random(seed * 104729);
  const events = [];
  if (r.chance(0.5)) {
    events.push({ stage: 'scoring', at: r.between(0.1, 0.8), do: async night => { night.device.goOffline(); await night.world.clock.run(r.between(30000, 300000)); night.device.goOnline(); } });
  }
  if (r.chance(0.5)) {
    events.push({ stage: 'scoring', at: r.between(0.1, 0.9), do: async night => {
      await night.world.clock.run(r.between(200, 3000));
      night.tab.close();
      await night.world.clock.run(r.between(2000, 60000));
      night.tab = night.open();
      await night.world.clock.run(15000);
    } });
  }
  if (r.chance(0.4)) {
    events.push({ stage: 'scoring', at: r.between(0.2, 0.6), do: async night => {
      const phone = night.open(night.world.device('phone'));
      await night.world.clock.run(15000);
      night.scorer = index => (index % 3 === 0 ? phone : night.tab);
    } });
  }
  if (r.chance(0.3)) {
    events.push({ stage: 'scoring', at: r.between(0.2, 0.8), do: async night => { night.device.net.blackhole = true; await night.world.clock.run(r.between(20000, 200000)); night.device.net.blackhole = false; } });
  }
  return {
    seed,
    players: 11 + Math.floor(r() * 8),
    slow: r.between(0.7, 3),
    loseReply: r.chance(0.5) ? r.between(0, 0.08) : 0,
    failReply: r.chance(0.5) ? r.between(0, 0.08) : 0,
    payments: r.chance(0.6),
    gmailMs: r.chance(0.4) ? r.between(3000, 25000) : 0,
    events
  };
}

(async () => {
  const first = Number(process.argv[2] || 1);
  const count = Number(process.argv[3] || 4);
  let failed = 0;
  for (let seed = first; seed < first + count; seed += 1) {
    const options = plan(seed);
    const night = await playNight(options);
    const tabs = night.tabs.filter(tab => !tab.closed && !tab.covered());
    const problems = [].concat.apply([], tabs.map(tab => verdict(night, tab).map(problem => tab.device.name + ': ' + problem)));
    const finalized = !problems.length && await finalizeNight(night, tabs[0]);
    const label = 'night ' + seed + ' (' + options.players + ' players, ' + options.events.length + ' incidents, slow x' + options.slow.toFixed(1) + ')';
    if (problems.length || !finalized) {
      failed += 1;
      console.log('FAIL ' + label + ': ' + (problems.join('; ') || 'did not finalize: ' + tabs[0].status()));
    } else {
      console.log('ok   ' + label + ': ' + night.seen.notices.length + ' notice(s), ' + night.world.server.problems().length + ' logged problem(s)');
    }
  }
  if (failed) {
    console.log(failed + ' of ' + count + ' nights failed');
    process.exit(1);
  }
  console.log('Randomized desk nights passed: ' + count);
})().catch(error => { console.error(error); process.exit(1); });
