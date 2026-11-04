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
    // A new computer opens on the wall, which shows every group: every player on the desk is on the board.
    assert.equal(board.$('[data-set="concept"] [aria-pressed="true"]').getAttribute('data-value'), 'wall', 'the wall is the default layout');
    assert.equal(board.$$('.track').length, 0, 'not the carousel');
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
    assert.equal(board.$$('.track > .panel').length, 3, 'the carousel shows two groups and the next one waiting');
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

  // After the sheets print, a late arrival joins the group their rating gives them and nobody else changes table, even
  // when that makes a group of 8; they carry a Late add label on the desk and the board. Removals leave the gap.
  async lateAddAfterPrint() {
    const world = sim.createWorld({ seed: 53, players: 40 });
    const tab = await deskWith(world, 28);
    const board = boardWindow(world, tab);
    tab.click(tab.$('#player-board'));
    await run(world, 1000);
    const groupsNow = () => tab.desk().groups.map(g => g.playerIds.slice());

    // Before printing, with no moves by hand, a sign-in still rebuilds by rating.
    const early = world.players[28].player_id;
    tab.addPlayer(early);
    await run(world, 400);
    assert.ok(!tab.$('.late-badge'), 'no late adds before the sheets print');
    assert.doesNotMatch(tab.status(), /late add/);

    // The pips under the carousel pick a group.
    boardClick(board, '[data-set="concept"] [data-value="carousel"]');
    await run(world, 500);
    const pips = board.$$('.pips button.pip');
    assert.equal(pips.length, tab.desk().groups.length, 'one pip button per group');
    boardClick(board, '.pips button.pip[data-pick="3"]');
    await run(world, 100);
    assert.deepEqual(board.$$('.track > .panel h2').slice(0, 2).map(h => h.textContent), ['Group 4', 'Group 5'], 'clicking the fourth pip shows Group 4 with the next beside it');
    assert.ok(board.$$('.pips .pip')[3].classList.contains('on'));
    assert.match(board.$('.pip-label').textContent, /Groups 4 & 5/);

    tab.window.cttcPlayerBoard.printed();
    await run(world, 400);
    assert.match(board.$('.b-stage').textContent, /Sheets printed/);
    const printed = groupsNow();

    // Late adds into one group: it grows past the group size and nobody else moves.
    const late = world.players.slice(29, 40).map(p => p.player_id);
    const target = (() => {
      const first = late[0];
      tab.addPlayer(first);
      return tab.desk().groups.findIndex(g => g.playerIds.includes(first));
    })();
    await run(world, 400);
    assert.match(tab.status(), /added to Group \d+ as a late add.*Nobody else moved/);
    const after = groupsNow();
    printed.forEach((ids, gi) => {
      const kept = after[gi].filter(id => id !== late[0]);
      assert.deepEqual(kept, ids, 'Group ' + (gi + 1) + ' keeps exactly its printed players');
    });
    assert.equal(after[target].length, printed[target].length + 1);
    // More late adds: none of them ever bumps a printed player, whatever group their rating lands in.
    for (const id of late.slice(1, 4)) {
      tab.addPlayer(id);
      await run(world, 200);
    }
    const crowded = groupsNow();
    printed.forEach((ids, gi) => ids.forEach(id => assert.ok(crowded[gi].includes(id), 'a printed player never changes table')));
    assert.equal(crowded.flat().length, 33);
    const big = crowded.reduce((m, ids) => Math.max(m, ids.length), 0);
    assert.ok(big >= 7, 'groups grow past the size instead of passing a player down');

    // Labels on the desk and the board.
    const badges = [...tab.window.document.querySelectorAll('#groups .late-badge')];
    assert.equal(badges.length, 4, 'each late add has a Late add badge on the desk');
    assert.ok(badges.every(b => /Late add/.test(b.textContent)));
    boardClick(board, '[data-set="concept"] [data-value="wall"]');
    await run(world, 500);
    const lateRows = board.$$('.wall tr[data-pid]').filter(tr => tr.querySelector('.chip.late'));
    assert.deepEqual(lateRows.map(tr => tr.getAttribute('data-pid')).sort(), late.slice(0, 4).sort(), 'the board labels the same four');
    assert.match(board.$('.legend').textContent, /Late add/);

    // A late add moved by hand: only they move, and they glow on the wall.
    const mover = late[1];
    const from = groupsNow().findIndex(ids => ids.includes(mover));
    tab.movePlayer(mover, from === 0 ? 1 : -1);
    await run(world, 400);
    assert.ok(board.$$('.wall tr.fresh').some(tr => tr.getAttribute('data-pid') === mover), 'the moved player glows');
    const moved = groupsNow();
    printed.forEach((ids, gi) => ids.forEach(id => assert.ok(moved[gi].includes(id))));

    // A removal after printing leaves the gap: nobody is rebuilt.
    const leaving = printed[0][2];
    tab.removePlayer(leaving);
    await run(world, 400);
    const gone = groupsNow();
    printed.forEach((ids, gi) => ids.filter(id => id !== leaving).forEach(id => assert.ok(gone[gi].includes(id), 'a removal rebuilds nobody')));

    // Taking a late add back off (a quick add and remove at the side of the tables) leaves every group as it was.
    const oops = late[2];
    const beforeOops = groupsNow();
    tab.removePlayer(oops);
    await run(world, 400);
    assert.deepEqual(groupsNow(), beforeOops.map(ids => ids.filter(id => id !== oops)), 'removing a late add moves nobody');
    tab.addPlayer(oops);
    await run(world, 400);
    tab.removePlayer(oops);
    await run(world, 400);
    assert.deepEqual(groupsNow(), beforeOops.map(ids => ids.filter(id => id !== oops)), 'an add and remove straight after moves nobody');

    // Reprinting keeps the labels: they mark who was not on the first sheets.
    tab.window.cttcPlayerBoard.printed();
    await run(world, 400);
    const roster = tab.window.cttcPlayerBoard.printedRoster();
    late.slice(0, 4).forEach(id => assert.ok(!roster.includes(id), 'still a late add after a reprint'));
    assert.ok(roster.includes(printed[1][0]));
    assert.ok(!tab.errors.length, tab.errors.join('\n'));
    board.close();
  },

  // Updated shows only while a group differs from its printed sheet; the desk's Print labels control shows only while a
  // label does, and clears them (sheets still printed) or undoes a print made by mistake.
  async printLabels() {
    const world = sim.createWorld({ seed: 59, players: 40 });
    const tab = await deskWith(world, 24);
    const board = boardWindow(world, tab);
    tab.click(tab.$('#player-board'));
    await run(world, 1000);
    boardClick(board, '[data-set="concept"] [data-value="wall"]');
    await run(world, 500);
    const control = tab.$('#print-labels');
    const stale = () => board.$$('.wall .panel').filter(p => p.querySelector('.stale')).map(p => p.querySelector('h2').textContent);
    const groupsNow = () => tab.desk().groups.map(g => g.playerIds.slice());
    assert.ok(control.hidden, 'no control before a print');

    tab.window.cttcPlayerBoard.printed();
    await run(world, 400);
    assert.ok(control.hidden, 'a print with nothing changed since leaves no labels');

    // A late add marks its group Updated; taking them back off clears both labels.
    const late = world.players[24].player_id;
    tab.addPlayer(late);
    await run(world, 400);
    const where = 'Group ' + tab.desk().groups.find(g => g.playerIds.includes(late)).groupNumber;
    assert.deepEqual(stale(), [where]);
    assert.ok(!control.hidden);
    assert.match(control.textContent, /1 late add · 1 group updated/);
    tab.removePlayer(late);
    await run(world, 400);
    assert.deepEqual(stale(), [], 'the group is as printed again: no Updated');
    assert.ok(control.hidden, 'no labels, no control');
    assert.equal(tab.window.cttcPlayerBoard.printNote(), '');

    // Clear labels: the groups as they are count as printed; the next arrival is still placed without moving anyone.
    tab.addPlayer(late);
    await run(world, 400);
    tab.click(control);
    assert.ok(!tab.$('#print-labels-panel').hidden);
    assert.match(tab.$('#print-labels-text').textContent, new RegExp('Late add: ' + nameOf(world, late)));
    tab.click(tab.$('#labels-keep'));
    await run(world, 400);
    assert.ok(control.hidden && tab.$('#print-labels-panel').hidden);
    assert.ok(!tab.$('#groups .late-badge'), 'no Late add on the desk');
    assert.deepEqual(stale(), []);
    assert.ok(!board.$('.chip.late'), 'no Late add on the board');
    assert.match(board.$('.b-stage').textContent, /Sheets printed/);
    const kept = groupsNow();
    const next = world.players[25].player_id;
    tab.addPlayer(next);
    await run(world, 400);
    kept.forEach((ids, gi) => ids.forEach(id => assert.ok(groupsNow()[gi].includes(id), 'still placed without moving anyone')));
    assert.ok(tab.$('#groups .late-badge'), 'a new late add is labeled');

    // Undo the print: back to sign-ins as if the sheets never printed.
    tab.click(control);
    tab.click(tab.$('#labels-forget'));
    await run(world, 400);
    assert.ok(control.hidden);
    assert.ok(!tab.$('#groups .late-badge'));
    assert.match(board.$('.b-stage').textContent, /Signing in/);
    assert.equal(tab.window.cttcPlayerBoard.printedRoster(), null);

    // Clear after a print undoes it, so the next night's worth of sign-ins is built by rating, not piled into one group.
    tab.window.cttcPlayerBoard.printed();
    await run(world, 400);
    tab.click(tab.$('#clear-roster'));
    await run(world, 400);
    assert.match(tab.confirms[tab.confirms.length - 1], /also undoes the sheets print/);
    assert.equal(tab.window.cttcPlayerBoard.printedRoster(), null);
    world.players.slice(0, 18).forEach(p => tab.addPlayer(p.player_id));
    await run(world, 400);
    assert.equal(tab.desk().groups.length, 3, 'sign-ins after Clear are grouped by rating again');

    // A print mark naming nobody in the round robin (this device does not have the night's groups) is not applied.
    const key = 'cttc-player-board-printed-v1';
    const all = JSON.parse(tab.window.localStorage.getItem(key) || '{}');
    all[world.date + ':rr'] = { at: Date.now(), groups: [['nobody-here']], first: ['nobody-here'] };
    tab.window.localStorage.setItem(key, JSON.stringify(all));
    assert.equal(tab.window.cttcPlayerBoard.printedRoster(), null);
    tab.addPlayer(world.players[18].player_id);
    await run(world, 400);
    assert.doesNotMatch(tab.status(), /late add/);
    assert.ok(!tab.errors.length, tab.errors.join('\n'));
    board.close();
  },

  // The print mark goes through Google: a second device (an officer's phone, the projector computer) learns of a print
  // within its once-a-minute refresh or on load, and follows the same rules: late adds placed without moving anyone,
  // removals leaving the gap, Late add labels, and its board on scores. Undo the print reaches it the same way.
  async printMarkAcrossDevices() {
    const world = sim.createWorld({ seed: 61, players: 40 });
    const main = await deskWith(world, 24);
    await run(world, 15000);
    const officer = world.device().open();
    await run(world, 15000);
    assert.equal(officer.roster().length, 24, 'the second device has the night');
    const board = boardWindow(world, officer);
    officer.click(officer.$('#player-board'));
    await run(world, 1000);
    assert.match(board.$('.b-stage').textContent, /Signing in/);
    const groupsOn = tab => tab.desk().groups.map(g => g.playerIds.slice());

    main.window.cttcPlayerBoard.printed();
    await run(world, 70000);
    assert.ok(officer.window.cttcPlayerBoard.printedRoster(), 'the officer device knows the sheets printed');
    assert.match(board.$('.b-stage').textContent, /Sheets printed/, 'and its board shows scores');

    // An add and remove on the officer device moves nobody, and the late add is labeled there.
    const printed = groupsOn(officer);
    const late = world.players[24].player_id;
    officer.addPlayer(late);
    await run(world, 400);
    assert.match(officer.status(), /as a late add/);
    printed.forEach((ids, gi) => ids.forEach(id => assert.ok(groupsOn(officer)[gi].includes(id), 'a printed player stays put')));
    assert.ok(officer.$('#groups .late-badge'));
    officer.removePlayer(late);
    await run(world, 400);
    assert.deepEqual(groupsOn(officer), printed, 'add then remove on the officer device leaves the groups as printed');

    // A reload there still knows (from Google, not this device's own storage).
    const reloaded = world.device().open();
    await run(world, 15000);
    assert.ok(reloaded.window.cttcPlayerBoard.printedRoster(), 'a fresh device reads the mark on load');

    // Undo the print on the main desk reaches the officer device too.
    main.window.cttcPlayerBoard.forgetPrint();
    await run(world, 70000);
    assert.equal(officer.window.cttcPlayerBoard.printedRoster(), null, 'undone everywhere');
    assert.match(board.$('.b-stage').textContent, /Signing in/);
    [main, officer, reloaded].forEach(tab => assert.ok(!tab.errors.length, tab.errors.join('\n')));
    // Google keeps only what it should.
    assert.throws(() => world.server.run('saveSessionPrint', 'Sessions!A1', { at: 1, groups: [], first: [] }), /Print mark/);
    assert.throws(() => world.server.run('saveSessionPrint', 'session-' + world.date, { at: 1, groups: [[{}]], first: [] }), /Print mark/);
    const kept = JSON.parse(JSON.stringify(world.server.run('getAppState', world.date).printed));
    assert.deepEqual(Object.keys(kept).sort(), ['at', 'undone'], 'an undone print is kept as undone, without the players');
    board.close();
  },

  // Follow mode: a second computer's board follows the main desk, checking the change stamps every 10 seconds only
  // while Follow the main desk is ticked, and reading the night only when something changed there.
  async followMode() {
    const world = sim.createWorld({ seed: 67, players: 40 });
    const main = await deskWith(world, 24);
    await run(world, 15000);
    const projector = world.device().open();
    await run(world, 15000);
    const board = boardWindow(world, projector);
    projector.click(projector.$('#player-board'));
    await run(world, 1000);
    const calls = (name, tab, since) => world.traffic.filter(log => log.name === name && log.tab === tab && log.sentAt >= since);
    const tick = selector => { const box = board.$(selector); box.checked = !box.checked; box.dispatchEvent(new board.w.Event('change', { bubbles: true })); };

    // Off by default: an open board on the second computer adds no checks.
    let since = world.clock.now();
    await run(world, 60000);
    assert.equal(calls('getDeskStamps', projector, since).length, 0, 'no checks until follow mode is turned on');

    boardClick(board, '[data-set="concept"] [data-value="wall"]');
    tick('#bc-follow');
    await run(world, 3000);
    assert.ok(!projector.$('#follow-bar').hidden, 'the desk says it is following');
    assert.ok(projector.$('.workspace').classList.contains('following'));
    assert.equal(board.$('#bc-follow-note').textContent, 'Following');

    // A sign-in on the main desk reaches the projector board within a check or two.
    const late = world.players[24].player_id;
    main.addPlayer(late);
    await run(world, 22000);
    assert.equal(board.$('.b-count .num').textContent, '25', 'the projector board counts the new sign-in');
    assert.ok(board.text().includes(nameOf(world, late)));
    assert.match(board.$('.ticker').textContent, new RegExp(nameOf(world, late) + ' signed in'));

    // A payment on the main desk: the check turns green there too, read without going to Gmail.
    since = world.clock.now();
    main.pay(late, 'cash');
    await run(world, 22000);
    const row = board.$$('.wall .row').find(r => r.getAttribute('data-pid') === late);
    assert.ok(row && row.querySelector('.pay.paid'), 'the payment check follows');
    const paymentReads = calls('getPrivatePaymentOverview', projector, since);
    assert.ok(paymentReads.length >= 1 && paymentReads.every(log => log.args[1] && log.args[1].skipMailbox), 'payments are read without the Zeffy mail');

    // A move up at the main desk: the projector board shows the same ▲ (the arrows are saved with the night).
    const mover = main.desk().groups[2].playerIds[0];
    main.movePlayer(mover, -1);
    await run(world, 22000);
    const moved = board.$$('.wall .row').find(r => r.getAttribute('data-pid') === mover);
    assert.ok(moved && moved.querySelector('.push.moved'), 'the ▲ follows');
    assert.match(board.$('.ticker').textContent, /moved up to Group 2/);
    const fresh = world.device().open();
    await run(world, 15000);
    assert.ok(Object.keys(fresh.window.cttcDesk.boardData().movedUp).includes(mover), 'and survives a reload');

    // A quiet minute: six tiny checks, no reads of the night.
    since = world.clock.now();
    await run(world, 60000);
    const quiet = calls('getDeskStamps', projector, since).length;
    assert.ok(quiet >= 5 && quiet <= 7, 'about one check every 10 seconds: ' + quiet);
    assert.equal(calls('getAppState', projector, since).length, 0, 'nothing changed, nothing read');
    assert.equal(calls('getPrivatePaymentOverview', projector, since).length, 0);

    // Editing is off on the following desk.
    assert.equal(projector.window.cttcDesk.add(world.players[30].player_id), false);

    // After 20 quiet minutes it checks once a minute.
    await run(world, 20 * 60000);
    since = world.clock.now();
    await run(world, 5 * 60000);
    const idle = calls('getDeskStamps', projector, since).length;
    assert.ok(idle >= 4 && idle <= 6, 'once a minute when quiet: ' + idle);

    // Unticked: the checks stop, the desk can edit again, and usage went to the desk log.
    tick('#bc-follow');
    await run(world, 1000);
    assert.ok(projector.$('#follow-bar').hidden);
    since = world.clock.now();
    await run(world, 120000);
    assert.equal(calls('getDeskStamps', projector, since).length, 0, 'no checks after follow mode is off');
    assert.ok(calls('logFollowMode', projector, 0).length >= 1, 'usage is logged');
    [main, projector, fresh].forEach(tab => assert.ok(!tab.errors.length, tab.errors.join('\n')));
    board.close();
  },

  // Follow mode on an Equalizer night: the projector shows the draw once the main desk prints, then each result, reading
  // only the Equalizer for a result.
  async followEqualizer() {
    const world = sim.createWorld({ seed: 71 });
    const main = await deskWith(world, 16);
    main.click(main.$('#event-switch [data-event="equalizer"]'));
    await run(world, 20000);
    const projector = world.device().open();
    await run(world, 15000);
    const board = boardWindow(world, projector);
    projector.click(projector.$('#player-board'));
    await run(world, 1000);
    const box = board.$('#bc-follow');
    box.checked = true;
    box.dispatchEvent(new board.w.Event('change', { bubbles: true }));
    await run(world, 5000);
    assert.match(board.$('.b-stage').textContent, /the draw is set when sheets print/);

    main.window.cttcPlayerBoard.printed();
    await run(world, 25000);
    assert.match(board.$('.b-stage').textContent, /Group stage/, 'the main desk printed: the projector shows the draw');

    const row = main.$('#equalizer .match.match-pending[data-eq-match]');
    const need = row.querySelectorAll('[data-side="0"].ball').length - 1;
    main.click(row.querySelector('[data-side="0"][data-games="' + need + '"]'));
    main.click(main.$('#equalizer [data-eq-match="' + row.getAttribute('data-eq-match') + '"] [data-side="1"][data-games="1"]'));
    const since = world.clock.now();
    await run(world, 25000);
    assert.match(board.$('.ticker').textContent, / beat /, 'the result reaches the projector');
    const reads = world.traffic.filter(log => log.tab === projector && log.sentAt >= since).map(log => log.name);
    assert.ok(reads.includes('getEqualizerState'));
    assert.ok(!reads.includes('getAppState') && !reads.includes('getPublishState'), 'a result reads only the Equalizer: ' + reads.join(', '));
    [main, projector].forEach(tab => assert.ok(!tab.errors.length, tab.errors.join('\n')));
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
