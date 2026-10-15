// Whole-desk checks: the real page (Index.html and its includes) and the real server files, on a simulated Google
// with a virtual clock (scripts/lib/desk-sim.js). Each case plays out something that happens at the club and checks
// what the volunteer sees and what Google ends up holding. Synthetic players only.
const assert = require('node:assert/strict');
const sim = require('../scripts/lib/desk-sim');

const DATE = '2026-10-14';
const run = (world, ms) => world.clock.run(ms);

// A desk with a small session loaded: 11 players in two groups, 25 matches.
async function deskWith(world, device, count) {
  const tab = device.open();
  await run(world, 15000);
  world.players.slice(0, count || 11).forEach(p => tab.addPlayer(p.player_id));
  await run(world, 20000);
  return tab;
}
const scored = list => list.filter(m => m.playerOneGames != null || m.forfeitedBy).length;
const googleScored = world => scored(sim.googleSession(world, DATE).matches);
function inStep(world, tab, label) {
  assert.equal(sim.googleKey(world, DATE), sim.pageKey(tab), label + ': Google and the page hold the same session');
  assert.deepEqual(tab.device.storageKeys('cttc-rr-draft-v1:'), [], label + ': no device copy left waiting');
  assert.equal(tab.notice(), '', label + ': no notice left showing');
  assert.deepEqual(tab.errors, [], label + ': no page errors');
}
async function scoreAll(world, tab, gap) {
  for (let i = 0; i < tab.matchCount(); i += 1) {
    tab.scoreMatch(i, i % 2 ? 'one' : 'two', i % 3);
    await run(world, gap || 4000);
  }
}

const cases = {
  // The ordinary night: roster, scores, finalize, with nothing going wrong and nothing to read.
  async ordinaryNight() {
    const world = sim.createWorld({ seed: 11 });
    const tab = await deskWith(world, world.device());
    await scoreAll(world, tab);
    await run(world, 20000);
    inStep(world, tab, 'ordinary night');
    assert.equal(googleScored(world), 25);
    tab.finalize();
    await run(world, 60000);
    assert.equal(sim.googleSession(world, DATE).status, 'finalized');
    assert.equal(world.server.problems().length, 0, 'nothing was reported as a problem');
    assert.equal(world.server.rows('RatingLedger').filter(r => r.session_id === 'session-' + DATE).length, 11);
  },

  // One lost reply and one error: the desk retries by itself without alarming anyone.
  async singleBlipsStayQuiet() {
    const world = sim.createWorld({ seed: 12 });
    const device = world.device();
    const tab = await deskWith(world, device);
    let worst = '';
    const watch = () => { worst = worst || tab.notice(); world.clock.after(500, watch, tab); };
    watch();
    device.net.failReply = 1;
    tab.scoreMatch(0, 'one', 1);
    await run(world, 3000);
    device.net.failReply = 0;
    await run(world, 30000);
    device.net.loseReply = 1;
    tab.scoreMatch(1, 'two', 2);
    await run(world, 3000);
    device.net.loseReply = 0;
    await run(world, 120000);
    assert.equal(worst, '', 'a single failed or lost save that fixes itself shows no notice');
    inStep(world, tab, 'after blips');
    assert.equal(googleScored(world), 2);
  },

  // Repeated failures still say so, keep the scores on the device, and catch up when Google answers again.
  async lastingTroubleIsShown() {
    const world = sim.createWorld({ seed: 13 });
    const device = world.device();
    const tab = await deskWith(world, device);
    device.net.failReply = 1;
    tab.scoreMatch(0, 'one', 0);
    await run(world, 40000);
    assert.match(tab.notice(), /Unsynced draft saved on this device/, 'lasting trouble is announced');
    tab.scoreMatch(1, 'one', 1);
    await run(world, 5000);
    device.net.failReply = 0;
    await run(world, 180000);
    inStep(world, tab, 'after lasting trouble');
    assert.equal(googleScored(world), 2);
  },

  // The Wi-Fi drops for a few minutes during scoring.
  async offlineSpell() {
    const world = sim.createWorld({ seed: 14 });
    const device = world.device();
    const tab = await deskWith(world, device);
    device.goOffline();
    tab.scoreMatch(0, 'one', 2);
    tab.scoreMatch(1, 'two', 0);
    await run(world, 5000);
    assert.match(tab.notice(), /Offline/);
    await run(world, 180000);
    device.goOnline();
    await run(world, 30000);
    inStep(world, tab, 'after the Wi-Fi returns');
    assert.equal(googleScored(world), 2);
  },

  // The tab is closed or reloaded a moment after a score is tapped, before or while it is saved, and opened again.
  async reloadRightAfterTapping() {
    for (const delay of [300, 2500]) {
      const world = sim.createWorld({ seed: 15 });
      const device = world.device();
      const tab = await deskWith(world, device);
      tab.scoreMatch(0, 'one', 1);
      await run(world, 20000);
      tab.scoreMatch(1, 'two', 1);
      tab.scoreMatch(2, 'one', 2);
      await run(world, delay);
      tab.close();
      const again = device.open();
      await run(world, 30000);
      assert.equal(again.confirms.length, 0, 'no question to answer after reopening');
      assert.doesNotMatch(again.status(), /choose which to keep/);
      inStep(world, again, 'reopened ' + delay + ' ms after tapping');
      assert.equal(googleScored(world), 3, 'every tapped score reached Google (' + delay + ' ms)');
    }
  },

  // The desk is opened again in a second tab of the same browser while the first tab is saving.
  async secondTab() {
    const world = sim.createWorld({ seed: 16 });
    const device = world.device();
    const first = await deskWith(world, device);
    first.scoreMatch(0, 'one', 1);
    await run(world, 400);
    const second = device.open();
    await run(world, 20000);
    assert.equal(first.covered(), true, 'the older tab steps aside');
    assert.equal(second.covered(), false);
    assert.equal(second.notice(), '', 'the new tab does not ask about a device copy');
    second.scoreMatch(1, 'two', 2);
    await run(world, 20000);
    first.scoreMatch(2, 'one', 0);
    assert.ok(first.blockedClicks > 0, 'the covered tab cannot be edited');
    first.takeOver();
    await run(world, 20000);
    assert.equal(second.covered(), true);
    first.scoreMatch(3, 'one', 0);
    await run(world, 20000);
    inStep(world, first, 'after switching tabs');
    assert.equal(googleScored(world), 3);
  },

  // Two devices score different groups of the same session: both keep saving and each shows the other's scores.
  async twoDevices() {
    const world = sim.createWorld({ seed: 17 });
    const laptop = world.device('laptop');
    const phone = world.device('phone');
    const a = await deskWith(world, laptop);
    const b = phone.open();
    await run(world, 15000);
    for (let i = 0; i < 25; i += 1) {
      (i % 2 ? a : b).scoreMatch(i, i % 3 ? 'one' : 'two', i % 3);
      await run(world, 3000 + (i % 4) * 1000);
    }
    await run(world, 150000);
    inStep(world, a, 'laptop');
    inStep(world, b, 'phone');
    assert.equal(googleScored(world), 25);
    assert.equal(a.status().includes('different version') || b.status().includes('different version'), false);
  },

  // The phone was opened before anyone started tonight's session; the laptop then builds the roster. The phone shows
  // it within a minute, and a player the phone adds later shows up on the laptop.
  async lateStarterAndNewPlayer() {
    const world = sim.createWorld({ seed: 21 });
    const laptop = world.device('laptop');
    const phone = world.device('phone');
    const b = phone.open();
    await run(world, 15000);
    const a = await deskWith(world, laptop);
    await run(world, 70000);
    assert.equal(b.roster().length, 11, 'the phone shows the session the laptop started');
    b.$('#new-name').value = 'Newcomer Example';
    b.$('#new-rating').value = '900';
    b.$('#new-player').dispatchEvent(new b.window.Event('submit', { cancelable: true }));
    await run(world, 15000);
    a.scoreMatch(0, 'one', 1);
    await run(world, 90000);
    assert.equal(a.roster().length, 12, 'the laptop shows the player the phone added');
    inStep(world, a, 'laptop');
    inStep(world, b, 'phone');
    assert.equal(a.notice() + b.notice(), '');
  },


  // Two devices record the same match differently: nothing is chosen silently, and a person is asked.
  async realDisagreementIsAsked() {
    const world = sim.createWorld({ seed: 18 });
    const laptop = world.device('laptop');
    const phone = world.device('phone');
    const a = await deskWith(world, laptop);
    const b = phone.open();
    await run(world, 15000);
    phone.goOffline();
    b.scoreMatch(0, 'two', 1);
    a.scoreMatch(0, 'one', 2);
    await run(world, 20000);
    phone.goOnline();
    await run(world, 30000);
    const google = sim.googleSession(world, DATE).matches.find(m => m.playerOneGames != null);
    assert.equal(google.playerOneGames, 3, 'the result Google had is not overwritten');
    assert.match(b.status() + b.notice(), /different version/, 'the phone says the copies differ');
    const kept = JSON.parse(phone.store.get('cttc-rr-draft-v1:' + DATE));
    assert.equal(kept.matches[0].playerTwoGames, 3, 'the phone keeps its own result on the device');
  },

  // Finalizing on one device while another still has a score on its way.
  async finalizedElsewhere() {
    const world = sim.createWorld({ seed: 19 });
    const laptop = world.device('laptop');
    const phone = world.device('phone');
    const a = await deskWith(world, laptop);
    await scoreAll(world, a, 2000);
    const b = phone.open();
    await run(world, 15000);
    phone.goOffline();
    b.scoreMatch(0, b.desk().matches[0].playerOneGames === 3 ? 'two' : 'one', 1);
    a.finalize();
    await run(world, 60000);
    phone.goOnline();
    await run(world, 30000);
    assert.equal(sim.googleSession(world, DATE).status, 'finalized');
    assert.match(b.status(), /finalized/i, 'the phone is told the session was finalized');
    assert.equal(world.server.audit.filter(a => a.action === 'session_saved' && a.at > world.clock.now() - 60000).length, 0, 'nothing was saved over the finalized session');
  },

  // The help tour shows an example night; closing it brings back tonight's session.
  async tourReturnsToTonight() {
    const world = sim.createWorld({ seed: 22 });
    const tab = await deskWith(world, world.device());
    tab.scoreMatch(0, 'one', 2);
    await run(world, 10000);
    tab.click(tab.$('#show-tour'));
    await run(world, 10000);
    assert.equal(tab.$('#date').value, '2026-09-23', 'the tour shows its example date');
    tab.click(tab.$('.tour-close'));
    await run(world, 15000);
    assert.equal(tab.$('#date').value, DATE, 'closing the tour goes back to tonight');
    assert.equal(tab.roster().length, 11);
    inStep(world, tab, 'after the tour');
  },

  // A slow Gmail (Zeffy pass emails) while a payment is recorded does not hold up score saves.
  async slowGmailDoesNotBlockSaves() {
    const world = sim.createWorld({ seed: 20 });
    const tab = await deskWith(world, world.device());
    world.server.gmail.searchMs = 25000;
    world.server.properties.CTTC_ZEFFY_SYNCED_AT = '0';
    tab.pay(world.players[0].player_id, 'cash');
    await run(world, 1500);
    tab.scoreMatch(0, 'one', 1);
    await run(world, 8000);
    assert.equal(googleScored(world), 1, 'the score was saved while Gmail was still being read');
    await run(world, 40000);
    assert.equal(world.server.rows('SessionPayments').length, 1);
  }
};

(async () => {
  const only = process.argv.slice(2);
  for (const [name, check] of Object.entries(cases)) {
    if (only.length && !only.includes(name)) continue;
    try {
      await check();
    } catch (error) {
      error.message = name + ': ' + error.message;
      throw error;
    }
  }
  console.log('Whole-desk night checks passed: ' + Object.keys(cases).filter(name => !only.length || only.includes(name)).join(', '));
})().catch(error => { console.error(error); process.exit(1); });
