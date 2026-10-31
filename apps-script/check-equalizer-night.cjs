'use strict';

// The Equalizer on the real desk page (Index.html with Equalizer.html), against simulated Google on a virtual clock
// (scripts/lib/desk-sim.js): the Round robin | Equalizer switch moving everyone across and back with no wait, the
// organizer's options redrawing at once, scoring with the balls (and Winner for a best-of-5 match cut short), working
// offline, a reload, and finalizing. Made-up players only.
const assert = require('node:assert/strict');
const sim = require('../scripts/lib/desk-sim');

const DATE = '2026-10-14';
const EQ = 'session-' + DATE + '-equalizer';
const run = (world, ms) => world.clock.run(ms);
const workspace = tab => tab.$('#equalizer').textContent;
const shown = (tab, id) => !tab.$('#' + id).hidden;
const googleEq = world => JSON.parse(JSON.stringify(world.server.run('getEqualizerState', DATE)));
const googleRr = world => JSON.parse(JSON.stringify(sim.googleSession(world, DATE) || { groups: [] }));
const rrPlayers = world => [].concat(...googleRr(world).groups.map(g => g.players.map(p => p.playerId)));

async function deskWith(world, device, count) {
  const tab = device.open();
  await run(world, 15000);
  world.players.slice(0, count).forEach(p => tab.addPlayer(p.player_id));
  await run(world, 20000);
  return tab;
}
function switchTo(tab, event) {
  tab.click(tab.$('#event-switch [data-event="' + event + '"]'));
}
function choose(tab, name, value) {
  tab.click(tab.$('#eq-options [data-eq-choice="' + name + '"][data-value="' + value + '"]'));
}
// Scores the first match that is ready: the first side wins, the other side takes one game.
function scoreNext(tab) {
  const row = tab.$('#equalizer .match.match-pending[data-eq-match]');
  if (!row) return false;
  const id = row.getAttribute('data-eq-match');
  const need = row.querySelectorAll('[data-side="0"].ball').length - 1;
  tab.click(row.querySelector('[data-side="0"][data-games="' + need + '"]'));
  tab.click(tab.$('#equalizer [data-eq-match="' + id + '"] [data-side="1"][data-games="1"]'));
  return true;
}
async function scoreAll(world, tab) {
  while (scoreNext(tab)) await run(world, 3000);
  await run(world, 20000);
}

const cases = {
  // Signed in for a round robin, then the organizer picks the Equalizer: everyone moves at once, every option redraws
  // at once, and switching back puts everyone into round robin groups again. Google catches up each time.
  async switchMovesEveryone() {
    const world = sim.createWorld({ seed: 31 });
    const tab = await deskWith(world, world.device(), 10);
    assert.equal(rrPlayers(world).length, 10, 'the round robin draft reached Google');
    switchTo(tab, 'equalizer');
    // No clock has run: the page changed by itself.
    assert.ok(shown(tab, 'equalizer') && !shown(tab, 'matches') && !shown(tab, 'group-size'), 'the Equalizer workspace replaces the groups');
    assert.match(workspace(tab), /10 players · 3 groups of 4\/3\/3 · best of 3/, 'RR → Finals, singles, best of 3 by default');
    assert.match(tab.status(), /10 players moved to the Equalizer/);
    assert.equal(tab.$('#finalize').textContent, 'Finalize Equalizer');
    choose(tab, 'format', 'double');
    assert.match(workspace(tab), /Main Draw/, 'Double Elimination at once');
    choose(tab, 'play', 'doubles');
    assert.match(workspace(tab), /5 teams/, 'doubles at once');
    choose(tab, 'bestOf', '5');
    assert.match(workspace(tab), /best of 5/);
    assert.equal(tab.$('#equalizer .match.match-pending .score-one').querySelectorAll('.ball').length, 4, 'balls 0 to 3 for best of 5');
    await run(world, 20000);
    const eq = googleEq(world);
    assert.equal(eq.roster.length, 10, 'Google has the Equalizer roster');
    assert.deepEqual([eq.setup.format, eq.setup.play, eq.setup.bestOf], ['double', 'doubles', 5], 'and the last choices');
    assert.equal(rrPlayers(world).length, 0, 'and no round robin players');
    switchTo(tab, 'rr');
    assert.ok(shown(tab, 'matches') && !shown(tab, 'equalizer'));
    assert.equal(tab.roster().length, 10, 'everyone is back in round robin groups');
    await run(world, 30000);
    assert.equal(rrPlayers(world).length, 10, 'Google has them in the round robin');
    assert.equal(googleEq(world).roster.length, 0, 'and not in the Equalizer');
    assert.equal(googleEq(world).setup.format, 'double', 'the Equalizer keeps the organizer\'s choices for next time');
    assert.deepEqual(tab.errors, []);
  },

  // An afternoon: score every match with the balls, reload in the middle, finalize.
  async afternoon() {
    const world = sim.createWorld({ seed: 32 });
    const device = world.device();
    let tab = await deskWith(world, device, 8);
    switchTo(tab, 'equalizer');
    await run(world, 15000);
    for (let i = 0; i < 4; i += 1) { scoreNext(tab); await run(world, 3000); }
    // Adding someone after the first result is refused; the options are fixed.
    const late = world.players[12];
    tab.addPlayer(late.player_id);
    assert.match(tab.status(), /has started/);
    assert.ok(tab.$('#eq-options [data-eq-choice="format"]').disabled, 'options are fixed once a result is in');
    await run(world, 15000);
    assert.equal(Object.keys(googleEq(world).results).length, 4, 'every result reached Google');
    // A reload shows Google's copy, on the Equalizer.
    tab.close();
    tab = device.open();
    await run(world, 15000);
    assert.ok(shown(tab, 'equalizer'), 'the date opens on the Equalizer');
    assert.match(workspace(tab), /4 of \d+ matches complete/);
    await scoreAll(world, tab);
    assert.match(workspace(tab), /wins the Equalizer/);
    assert.ok(!tab.$('#finalize').disabled, 'Finalize is ready once it is finished');
    tab.finalize();
    await run(world, 60000);
    assert.equal(googleEq(world).session.status, 'finalized');
    assert.equal(world.server.rows('RatingLedger').filter(r => r.session_id === EQ).length, 8);
    assert.equal(tab.$('#finalize').textContent, '🔒 Finalized');
    assert.ok(tab.$('#equalizer .ball').disabled, 'a finalized Equalizer cannot be changed');
    assert.deepEqual(tab.errors, []);
  },

  // Offline: results are kept on the device and reach Google when the connection returns.
  async offlineScores() {
    const world = sim.createWorld({ seed: 33 });
    const device = world.device();
    const tab = await deskWith(world, device, 8);
    switchTo(tab, 'equalizer');
    await run(world, 15000);
    device.goOffline();
    scoreNext(tab);
    scoreNext(tab);
    await run(world, 20000);
    assert.match(workspace(tab), /2 of \d+ matches complete/, 'the page shows them');
    assert.equal(Object.keys(googleEq(world).results).length, 0, 'Google has not seen them yet');
    device.goOnline();
    await run(world, 30000);
    assert.equal(Object.keys(googleEq(world).results).length, 2, 'they sync when the connection returns');
    assert.deepEqual(tab.errors, []);
  },

  // Best of 5 cut to best of 3: two games and the Winner badge, as in round robins.
  async bestOfFiveWinner() {
    const world = sim.createWorld({ seed: 34 });
    const tab = await deskWith(world, world.device(), 8);
    switchTo(tab, 'equalizer');
    choose(tab, 'bestOf', '5');
    await run(world, 15000);
    const row = tab.$('#equalizer .match.match-pending[data-eq-match]');
    const id = row.getAttribute('data-eq-match');
    tab.click(row.querySelector('[data-side="0"][data-games="2"]'));
    await run(world, 10000);
    assert.equal(googleEq(world).results[id], undefined, 'two games alone is not a best-of-5 result');
    tab.click(tab.$('#equalizer [data-eq-match="' + id + '"] button.winner-badge[data-side="0"]'));
    await run(world, 15000);
    const saved = googleEq(world).results[id];
    assert.deepEqual([saved.games, !!saved.wonBy], [[2, 0], true], 'Winner records it as a best-of-3 win');
    assert.deepEqual(tab.errors, []);
  },

  // Doubles with an odd number: the desk asks, and a team of three is drawn when chosen.
  async oddDoubles() {
    const world = sim.createWorld({ seed: 35 });
    const tab = await deskWith(world, world.device(), 9);
    switchTo(tab, 'equalizer');
    choose(tab, 'format', 'double');
    choose(tab, 'play', 'doubles');
    assert.ok(tab.$('#equalizer [data-eq-odd]'), 'the odd player is flagged with a choice');
    assert.match(workspace(tab), /Sitting out/, 'by default someone drawn at random sits out');
    const select = tab.$('#equalizer [data-eq-odd]');
    select.value = 'team-of-three';
    select.dispatchEvent(new tab.window.Event('change', { bubbles: true }));
    assert.doesNotMatch(workspace(tab), /Sitting out/);
    await run(world, 20000);
    const draw = googleEq(world).setup.draw;
    assert.ok(draw.teams.some(team => team.length === 3), 'a team of three');
    assert.equal(googleEq(world).setup.oddPlayer, 'team-of-three');
    assert.deepEqual(tab.errors, []);
  },

  // Print EQ Sheets: a group sheet per group with each match's head start, then the Finals bracket; Double Elimination
  // prints the Main Draw with the Final and the Survivor Trail. Results and names fill in as they are known.
  async printedSheets() {
    const world = sim.createWorld({ seed: 37 });
    const tab = await deskWith(world, world.device(), 10);
    const button = tab.$('#print-sheets');
    assert.equal(button.textContent, 'Print RR Sheets');
    switchTo(tab, 'equalizer');
    assert.ok(shown(tab, 'print-sheets') && !button.disabled, 'the Equalizer has its own print button');
    assert.equal(button.textContent, 'Print EQ Sheets');
    scoreNext(tab);
    tab.click(button);
    const sheets = () => [...tab.window.document.querySelectorAll('#print-root .print-sheet')];
    assert.equal(sheets().length, 4, '3 group sheets and the Finals');
    const first = sheets()[0];
    assert.match(first.textContent, /The Equalizer · Group Sheet/);
    assert.match(first.textContent, /Group 1/);
    assert.equal(first.querySelectorAll('.tournament-match').length, 6, 'a group of 4 plays 6 matches');
    assert.ok(first.querySelectorAll('.eq-head-start').length === 6 && /\+\d|Even/.test(first.querySelector('.eq-head-start').textContent), 'each match shows its head start');
    assert.deepEqual([...first.querySelectorAll('.tournament-match-result span')].slice(0, 2).map(s => s.textContent), ['2', '1'], 'a recorded result is printed');
    const finals = sheets()[3];
    assert.ok(finals.classList.contains('print-bracket-sheet'), 'the Finals print as a bracket');
    assert.equal(finals.querySelectorAll('.eqb-match').length, 3, '3 group winners: a bye, a semifinal and the Final');
    assert.match(finals.textContent, /Best group winner/);
    assert.equal(finals.querySelectorAll('path').length, 2, 'lines join both semifinal boxes to the Final');
    tab.window.document.querySelector('#print-root .print-preview-toolbar button').click();
    assert.equal(sheets().length, 0, 'Close preview');
    assert.equal(button.textContent, 'Print EQ Sheets');

    // Clear the result, then Double Elimination: 10 players, a 16 draw, so two bracket pages.
    tab.click(tab.$('#equalizer .match.match-complete [data-side="0"][data-games="0"]'));
    choose(tab, 'format', 'double');
    await run(world, 20000);
    tab.click(button);
    assert.equal(sheets().length, 2, 'the Main Draw with the Final, and the Survivor Trail');
    assert.match(sheets()[0].textContent, /Main Draw and Final/);
    assert.match(sheets()[0].textContent, /GF2 · replay, only if needed/);
    assert.match(sheets()[1].textContent, /Survivor Trail/);
    assert.match(sheets()[1].textContent, /Loser of W1-/, 'Survivor Trail slots say who drops in');
    assert.equal(sheets()[0].querySelectorAll('.eqb-match').length, 8 + 4 + 2 + 1 + 2, 'every Main Draw match and both Finals');
    assert.deepEqual(tab.errors, []);
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
  console.log('Equalizer desk night checks passed: ' + Object.keys(cases).filter(name => !only.length || only.includes(name)).join(', '));
})().catch(error => { console.error(error); process.exit(1); });
