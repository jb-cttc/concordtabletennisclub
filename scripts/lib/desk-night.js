// Plays a club night on the simulated desk (see desk-sim.js) and reports what the volunteers would have seen.
'use strict';

const sim = require('./desk-sim');

// Desk work a night costs on Google, in milliseconds. A save rewrites the session; Gmail-backed calls are slower.
function nightCost(profile) {
  return (name, args, record) => {
    const r = profile.random;
    const base = {
      saveSessionDraft: [1500, 4000], createSession: [800, 2000], finalizeSession: [4000, 9000], getAppState: [1200, 3000],
      setSessionPayment: [800, 2000], getPrivatePaymentOverview: [1500, 4000], listVoiceSuggestions: [2000, 5000]
    }[name] || [300, 1200];
    return r.between(base[0], base[1]) * (profile.slow || 1);
  };
}

// Options: seed, players (how many play), slow (cost multiplier), loseReply, failReply, gmailMs, payments (true to
// take payments while scoring), events: [{ at: 'scoring:0.4', do: async (night) => {} }].
async function playNight(options) {
  const profile = Object.assign({ seed: 1, players: 24, slow: 1 }, options);
  const random = sim.random(profile.seed * 7919);
  profile.random = random;
  const world = sim.createWorld({ seed: profile.seed, players: Math.max(30, profile.players + 4), cost: nightCost(profile) });
  world.server.gmail.searchMs = profile.gmailMs || 0;
  const device = world.device('desk');
  const night = { world, device, tab: null, tabs: [], seen: { notices: [], errors: [], conflicts: 0, reloadAsked: 0 }, random, profile };
  night.open = (dev, opts) => { const tab = (dev || device).open(opts); night.tabs.push(tab); watch(night, tab); return tab; };
  night.tab = night.open();
  await world.clock.run(15000);
  device.net.loseReply = profile.loseReply || 0;
  device.net.failReply = profile.failReply || 0;

  const lineup = world.players.slice(0, profile.players).map(p => p.player_id);
  const events = (profile.events || []).map(event => Object.assign({}, event));
  async function fire(stage, fraction) {
    for (const event of events.filter(e => e.stage === stage && !e.done && fraction >= e.at)) {
      event.done = true;
      await event.do(night);
    }
  }

  // Sign-in: players arrive over ~15 minutes.
  for (let i = 0; i < lineup.length; i += 1) {
    night.tab.addPlayer(lineup[i]);
    await fire('arrivals', (i + 1) / lineup.length);
    await world.clock.run(random.between(10000, 50000));
    if (profile.payments && random.chance(0.6)) night.tab.pay(lineup[i], random.pick(['venmo', 'zelle', 'cash']));
  }
  await world.clock.run(20000);

  // Scores come in over ~2 hours, a few at a time.
  const total = night.tab.matchCount();
  const order = Array.from({ length: total }, (_, i) => i).sort(() => random() - 0.5);
  for (let n = 0; n < order.length; n += 1) {
    const tab = night.scorer ? await night.scorer(order[n]) : night.tab;
    tab.scoreMatch(order[n], random.chance(0.5) ? 'one' : 'two', Math.floor(random.between(0, 3)));
    await fire('scoring', (n + 1) / order.length);
    await world.clock.run(random.between(20000, 140000));
  }

  // Healed network, then a long quiet spell: whatever the desk does on its own should finish.
  device.net.loseReply = 0;
  device.net.failReply = 0;
  world.devices.forEach(d => { d.net.blackhole = false; if (!d.net.online) d.goOnline(); });
  await world.clock.run(6 * 60000);
  return night;
}

function watch(night, tab) {
  const status = () => tab.status();
  let lastNotice = '';
  let lastStatus = '';
  const check = () => {
    if (tab.closed) return;
    const notice = tab.notice();
    if (notice && notice !== lastNotice) night.seen.notices.push(notice);
    lastNotice = notice;
    const text = status();
    if (text !== lastStatus && /error|not saved|different version|Reload/i.test(text)) night.seen.errors.push(text);
    if (text !== lastStatus && /different version/i.test(text)) night.seen.conflicts += 1;
    if (text !== lastStatus && /Reload/.test(text)) night.seen.reloadAsked += 1;
    lastStatus = text;
    night.world.clock.after(1000, check, tab);
  };
  night.world.clock.after(1000, check, tab);
}

// What is true at the end of a good night.
function verdict(night, tab) {
  tab = tab || night.tab;
  const world = night.world;
  const problems = [];
  if (sim.googleKey(world) !== sim.pageKey(tab)) problems.push('Google and the desk page disagree');
  if (tab.device.storageKeys('cttc-rr-draft-v1:').length) problems.push('an unsynced device copy is left on the device');
  if (tab.notice()) problems.push('notice still showing: ' + tab.notice());
  const session = sim.googleSession(world, world.date);
  const done = session ? session.matches.filter(m => m.playerOneGames != null || m.forfeitedBy).length : 0;
  if (!session || done !== session.matches.length) problems.push('Google holds ' + done + ' of ' + (session ? session.matches.length : 0) + ' scores');
  if (tab.errors.length) problems.push('page errors: ' + tab.errors.map(e => e.message || e).join('; '));
  return problems;
}

async function finalizeNight(night, tab) {
  tab = tab || night.tab;
  tab.finalize();
  await night.world.clock.run(90000);
  const session = sim.googleSession(night.world, night.world.date);
  return session && session.status === 'finalized';
}

module.exports = { playNight, verdict, finalizeNight };
