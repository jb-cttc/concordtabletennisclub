'use strict';

// The Player board on the real desk page (Index.html with PlayerBoard.html) against simulated Google
// (scripts/lib/desk-sim.js): the window it opens follows sign-ins, moves, payment checks, printing and scores on the
// round robin, and the Equalizer from the field to its Finals. Made-up players only.
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const sim = require('../scripts/lib/desk-sim');

const run = (world, ms) => world.clock.run(ms);

// The board window: a second jsdom window on the same virtual clock, returned by the desk's window.open.
function boardWindow(world, tab) {
  const owner = { closed: false };
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: 'about:blank', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  const timers = new Map();
  let id = 0;
  w.setTimeout = (fn, ms) => { const n = ++id; timers.set(n, world.clock.after(Math.max(0, Number(ms) || 0), () => { timers.delete(n); fn(); }, owner)); return n; };
  w.clearTimeout = n => { const event = timers.get(n); if (event) event.cancelled = true; timers.delete(n); };
  w.setInterval = (fn, ms) => { const n = ++id; const tick = () => { timers.set(n, world.clock.after(ms, tick, owner)); fn(); }; timers.set(n, world.clock.after(ms, tick, owner)); return n; };
  w.clearInterval = w.clearTimeout;
  w.requestAnimationFrame = fn => w.setTimeout(() => fn(world.clock.now()), 16);
  w.focus = () => {};
  w.Date = tab.window.Date;
  let opened = 0;
  tab.window.open = (url, name) => {
    opened += 1;
    assert.equal(name, 'cttc-player-board', 'the board opens in its own named window, so a second click reuses it');
    return w;
  };
  return { w, $: s => w.document.querySelector(s), $$: s => [...w.document.querySelectorAll(s)], text: () => w.document.body.textContent, opened: () => opened, close: () => { owner.closed = true; } };
}
const nameOf = (world, id) => world.players.find(p => p.player_id === id).display_name;
const boardClick = (board, selector) => board.$(selector).dispatchEvent(new board.w.MouseEvent('click', { bubbles: true }));

async function deskWith(world, count) {
  const tab = world.device().open();
  await run(world, 15000);
  world.players.slice(0, count).forEach(p => tab.addPlayer(p.player_id));
  await run(world, 20000);
  return tab;
}

const cases = {
  async roundRobinNight() {
    const world = sim.createWorld({ seed: 41, players: 40 });
    const tab = await deskWith(world, 30);
    const board = boardWindow(world, tab);
    tab.click(tab.$('#player-board'));
    await run(world, 1000);
    assert.equal(board.opened(), 1);
    assert.ok(board.$('#board-controls'), 'the window has its settings strip');
    assert.match(board.$('.b-title strong').textContent, /Round Robin/);
    assert.equal(board.$('.b-count .num').textContent, '30', 'the board counts everyone signed in');
    assert.match(board.$('.b-stage').textContent, /Signing in/);
    assert.equal(board.$$('.track > .panel').length, 3, 'the carousel shows two groups and the next one waiting');

    // The wall shows every group: every player on the desk is on the board.
    boardClick(board, '[data-set="concept"] [data-value="wall"]');
    await run(world, 500);
    const groups = tab.desk().groups;
    assert.equal(board.$$('.wall .panel').length, groups.length);
    groups.forEach(g => g.playerIds.forEach(id => assert.ok(board.text().includes(nameOf(world, id)), nameOf(world, id) + ' is on the board')));

    // A sign-in shows at once (before any save reaches Google), glowing, and the ticker says where they went.
    const late = world.players[30].player_id;
    tab.addPlayer(late);
    await run(world, 400);
    assert.equal(board.$('.b-count .num').textContent, '31');
    assert.ok(board.$$('.row.fresh').some(row => row.textContent.includes(nameOf(world, late))), 'the new row glows');
    assert.match(board.$('.ticker').textContent, new RegExp(nameOf(world, late) + ' signed in · Group \\d'));
    assert.doesNotMatch(board.text(), /Signed in(?! ·)|SIGNED IN/, 'no "Signed in" label on rows');

    // A payment: the check turns green; the ticker never mentions it.
    const payer = tab.desk().groups[0].playerIds[0];
    const rowOf = id => board.$$('.wall .row').find(row => row.querySelector('.name').textContent.startsWith(nameOf(world, id)));
    assert.ok(!rowOf(payer).querySelector('.pay').classList.contains('paid'));
    tab.pay(payer, 'cash');
    await run(world, 400);
    assert.ok(rowOf(payer).querySelector('.pay').classList.contains('paid'), 'the payment check is green');
    assert.doesNotMatch(board.$('.ticker').textContent, /cash|paid|payment/i);

    // A move up at the desk: an arrow beside the name; a move down shows nothing.
    const mover = tab.desk().groups[2].playerIds[0];
    tab.movePlayer(mover, -1);
    await run(world, 400);
    assert.ok(rowOf(mover).querySelector('.push.moved'), 'moved up: an arrow');
    assert.match(board.$('.ticker').textContent, /moved up to Group 2/);
    const sinker = tab.desk().groups[0].playerIds[tab.desk().groups[0].playerIds.length - 1];
    tab.movePlayer(sinker, 1);
    await run(world, 400);
    assert.ok(!rowOf(sinker).querySelector('.push'), 'moved down: no mark');

    // Printing switches the board to scores; a group that changes afterwards is tagged, and the next print says so.
    tab.window.cttcPlayerBoard.printed();
    await run(world, 400);
    assert.match(board.$('.b-stage').textContent, /Sheets printed/);
    assert.equal(board.$$('.stale').length, 0, 'nothing changed since printing');
    tab.addPlayer(world.players[31].player_id);
    await run(world, 400);
    const where = tab.desk().groups.find(g => g.playerIds.includes(world.players[31].player_id)).groupNumber;
    const tagged = board.$$('.wall .panel').filter(p => p.querySelector('.stale')).map(p => p.querySelector('h2').textContent);
    assert.ok(tagged.includes('Group ' + where), 'the changed group is tagged: ' + tagged.join(', '));
    assert.match(tab.window.cttcPlayerBoard.printNote(), new RegExp('Group ' + where));
    tab.window.cttcPlayerBoard.printed();
    await run(world, 400);
    assert.equal(board.$$('.stale').length, 0, 'printing again clears the tags');
    assert.equal(tab.window.cttcPlayerBoard.printNote(), '');

    // A score: the standings and the ticker follow; the carousel shows the sheet's grid with the score in it.
    tab.scoreMatch(0, 'one', 1);
    await run(world, 400);
    const m = tab.desk().matches[0];
    assert.match(board.$('.ticker').textContent, new RegExp(nameOf(world, m.playerOneId) + ' beat ' + nameOf(world, m.playerTwoId) + ' 3–1'));
    boardClick(board, '[data-set="concept"] [data-value="carousel"]');
    await run(world, 500);
    assert.ok(board.$$('.xt td.cell').some(td => td.textContent === '3–1'), 'the grid shows the score');

    // The spotlight's A–Z list has everyone, with their group.
    boardClick(board, '[data-set="concept"] [data-value="spot"]');
    await run(world, 500);
    assert.equal(board.$$('.idx li').length, 32 > 32 ? 26 : 32);
    // Settings are the board's own, remembered in its window.
    boardClick(board, '[data-set="look"] [data-value="green"]');
    assert.equal(board.$('#board').dataset.look, 'green');
    assert.ok(!tab.errors.length, tab.errors.join('\n'));
    board.close();
  },

  async equalizerToFinals() {
    const world = sim.createWorld({ seed: 43 });
    const tab = await deskWith(world, 16);
    tab.click(tab.$('#event-switch [data-event="equalizer"]'));
    await run(world, 3000);
    const board = boardWindow(world, tab);
    tab.click(tab.$('#player-board'));
    await run(world, 1000);
    assert.match(board.$('.b-title strong').textContent, /The Equalizer/);
    assert.match(board.$('.b-stage').textContent, /the draw is set when sheets print/, 'before printing: the field, not a draw that keeps changing');
    boardClick(board, '[data-set="concept"] [data-value="wall"]');
    await run(world, 500);
    assert.ok(board.$$('.wall .panel h2').some(h => h.textContent === 'The field'));
    assert.ok(!board.$$('.wall .panel h2').some(h => /^Group/.test(h.textContent)));

    tab.window.cttcPlayerBoard.printed();
    await run(world, 400);
    assert.match(board.$('.b-stage').textContent, /Group stage · winners go to the Finals/);
    assert.equal(board.$$('.wall .panel h2').filter(h => /^Group/.test(h.textContent)).length, 4);
    assert.ok(board.$$('.wall .panel h2').some(h => h.textContent === 'Road to the Finals'));

    // Score every match in the desk's call order; when the groups are done the whole board is the Finals.
    const scoreNext = () => {
      const row = tab.$('#equalizer .match.match-pending[data-eq-match]');
      if (!row) return false;
      const need = row.querySelectorAll('[data-side="0"].ball').length - 1;
      tab.click(row.querySelector('[data-side="0"][data-games="' + need + '"]'));
      tab.click(tab.$('#equalizer [data-eq-match="' + row.getAttribute('data-eq-match') + '"] [data-side="1"][data-games="1"]'));
      return true;
    };
    let guard = 0;
    while (!board.$('.finals-screen') && scoreNext() && guard++ < 40) await run(world, 1500);
    assert.ok(board.$('.finals-screen'), 'the Finals screen replaces the groups');
    assert.match(board.$('.b-stage').textContent, /Finals · single elimination/);
    assert.match(board.$('.ticker').textContent, /the Finals are set|goes to the Finals/);
    while (scoreNext() && guard++ < 60) await run(world, 1500);
    assert.match(board.$('.b-stage').textContent, /Finished · .+ wins/);
    assert.ok(board.$('.champ'), 'the champion banner');
    assert.ok(!tab.errors.length, tab.errors.join('\n'));
    board.close();
  },

  async blockedPopup() {
    const world = sim.createWorld({ seed: 47 });
    const tab = await deskWith(world, 6);
    tab.window.open = () => null;
    tab.click(tab.$('#player-board'));
    assert.match(tab.status(), /blocked the Player board window/);
  }
};

(async () => {
  for (const [name, test] of Object.entries(cases)) {
    try { await test(); } catch (error) { console.error('Player board check failed: ' + name); throw error; }
  }
  console.log('Player board checks passed: ' + Object.keys(cases).length + ' cases');
})().catch(error => { console.error(error); process.exit(1); });
