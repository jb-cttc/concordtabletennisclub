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
    // The first time on a computer, the board asks what the screen is for; the main desk's own board does not follow.
    assert.ok(!board.$('#board-chooser').hidden, 'the board asks once');
    boardClick(board, '#choose-desk');
    assert.ok(board.$('#board-chooser').hidden);
    assert.equal(board.$('#bc-follow').checked, false, 'this laptop runs the desk: no following');
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

    // Off until asked: an open board on the second computer adds no checks while "What is this screen for?" is up.
    let since = world.clock.now();
    await run(world, 60000);
    assert.equal(calls('getDeskStamps', projector, since).length, 0, 'no checks until follow mode is turned on');
    assert.ok(!board.$('#board-chooser').hidden);

    // One click: follow the main desk, full screen.
    let fullScreen = 0;
    board.w.document.documentElement.requestFullscreen = () => { fullScreen += 1; return Promise.resolve(); };
    boardClick(board, '#choose-follow');
    assert.equal(fullScreen, 1, 'following goes full screen in the same click');
    assert.ok(board.$('#board-chooser').hidden);
    assert.equal(board.$('#bc-follow').checked, true);
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

  // The projector laptop first, in any order: its board is answered before its own desk has finished opening and before
  // the main desk has started the night. It keeps asking, follows once its desk has opened, and shows the night when the
  // main desk starts it. An end by itself (6 hours) keeps the answer: Player board again follows again.
  async projectorFirst() {
    const world = sim.createWorld({ seed: 73, players: 40 });
    const projector = world.device().open();
    await run(world, 200);
    const board = boardWindow(world, projector);
    projector.click(projector.$('#player-board'));
    await run(world, 100);
    board.w.document.documentElement.requestFullscreen = () => Promise.resolve();
    boardClick(board, '#choose-follow');
    assert.equal(board.$('#bc-follow').checked, true, 'still following while the desk opens');
    assert.match(board.$('#board-notice').textContent, /starting as soon as this desk has opened/);
    await run(world, 25000);
    assert.ok(!projector.$('#follow-bar').hidden, 'following once the desk opened');
    assert.ok(board.$('#board-notice').hidden, 'the waiting note is gone');
    assert.equal(board.$('#bc-follow-note').textContent, 'Following');

    // The main laptop starts the night afterwards: the projector board shows it.
    const main = await deskWith(world, 12);
    await run(world, 25000);
    assert.equal(board.$('.b-count .num').textContent, '12', 'the projector shows the night the main desk started');
    assert.ok(board.$$('.wall .panel').length >= 2, 'on the wall');

    // Six hours later follow mode ends by itself; the computer's answer stays Follow.
    await run(world, 6 * 3600000 + 120000);
    assert.ok(projector.$('#follow-bar').hidden, 'follow mode ended');
    assert.match(board.$('#bc-follow-note').textContent, /6 hours/);
    assert.equal(board.$('#bc-follow').checked, true, 'the answer is kept');
    const calls = since => world.traffic.filter(log => log.name === 'getDeskStamps' && log.tab === projector && log.sentAt >= since);
    let since = world.clock.now();
    await run(world, 120000);
    assert.equal(calls(since).length, 0, 'no checks once it ended');
    projector.click(projector.$('#player-board'));
    await run(world, 3000);
    assert.ok(!projector.$('#follow-bar').hidden, 'Player board follows again');
    // Stop following on the desk is a person's choice: the answer turns off.
    projector.click(projector.$('#stop-follow'));
    await run(world, 1000);
    assert.equal(board.$('#bc-follow').checked, false);
    since = world.clock.now();
    await run(world, 60000);
    assert.equal(calls(since).length, 0);
    [main, projector].forEach(tab => assert.ok(!tab.errors.length, tab.errors.join('\n')));
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

  // Follow mode across a switch between the round robin and the Equalizer, including the switches that move no players
  // (the round robin already has scores; or neither event has players yet), which change nothing saved.
  async followEventSwitch() {
    const shown = tab => tab.$('#event-switch [aria-pressed="true"]').getAttribute('data-event');
    const follower = async world => {
      const projector = world.device().open();
      await run(world, 15000);
      const board = boardWindow(world, projector);
      projector.click(projector.$('#player-board'));
      await run(world, 1000);
      const box = board.$('#bc-follow');
      box.checked = true;
      box.dispatchEvent(new board.w.Event('change', { bubbles: true }));
      await run(world, 5000);
      return { projector, board };
    };
    let world = sim.createWorld({ seed: 73 });
    let main = await deskWith(world, 16);
    let { projector, board } = await follower(world);
    assert.equal(shown(projector), 'rr');
    // Players move across: both events' saves change.
    main.click(main.$('#event-switch [data-event="equalizer"]'));
    await run(world, 25000);
    assert.equal(shown(projector), 'equalizer', 'the players moved to the Equalizer');
    assert.match(board.$('.b-title strong').textContent, /The Equalizer/);
    main.click(main.$('#event-switch [data-event="rr"]'));
    await run(world, 25000);
    assert.equal(shown(projector), 'rr', 'and back');
    // The round robin has a score, so the switch only changes what the main desk shows.
    main.scoreMatch(0, 'one', 1);
    await run(world, 25000);
    main.click(main.$('#event-switch [data-event="equalizer"]'));
    await run(world, 25000);
    assert.equal(shown(main), 'equalizer');
    assert.equal(shown(projector), 'equalizer', 'a switch that moves no one still reaches the follower');
    assert.match(board.$('.b-title strong').textContent, /The Equalizer/);
    // A follower that opens after the switch shows it too (its own load would open on the round robin, which has players).
    const late = await follower(world);
    assert.equal(shown(late.projector), 'equalizer', 'a fresh follower opens on the main desk\'s event');
    main.click(main.$('#event-switch [data-event="rr"]'));
    await run(world, 25000);
    assert.equal(shown(projector), 'rr');
    assert.equal(shown(late.projector), 'rr');
    [main, projector, late.projector].forEach(tab => assert.ok(!tab.errors.length, tab.errors.join('\n')));
    board.close();
    late.board.close();

    // The Equalizer chosen before anyone signs in; the sign-ins then change only the Equalizer.
    world = sim.createWorld({ seed: 74 });
    main = world.device().open();
    await run(world, 15000);
    ({ projector, board } = await follower(world));
    main.click(main.$('#event-switch [data-event="equalizer"]'));
    await run(world, 3000);
    world.players.slice(0, 8).forEach(p => main.addPlayer(p.player_id));
    await run(world, 30000);
    assert.equal(shown(projector), 'equalizer', 'an empty switch reaches the follower');
    assert.equal(board.$('.b-count .num').textContent, '8', 'with the Equalizer sign-ins');
    [main, projector].forEach(tab => assert.ok(!tab.errors.length, tab.errors.join('\n')));
    board.close();
  },

  // Projector screen on the main desk: the following board takes the layout, slide time, look and checks chosen there,
  // with no reads of the night, and a follower that opens later takes them too.
  async followScreen() {
    const world = sim.createWorld({ seed: 75 });
    const main = await deskWith(world, 16);
    const follower = async () => {
      const projector = world.device().open();
      await run(world, 15000);
      const board = boardWindow(world, projector);
      projector.click(projector.$('#player-board'));
      await run(world, 1000);
      boardClick(board, '#choose-follow');
      await run(world, 5000);
      return { projector, board };
    };
    const { projector, board } = await follower();
    const pressed = (b, key) => b.$('[data-set="' + key + '"] [aria-pressed="true"]').getAttribute('data-value');
    assert.ok(board.$('.wall'), 'a new computer starts on the wall');
    assert.ok(projector.$('#screen-control').hidden, 'the following desk has no Projector screen control');
    assert.ok(!main.$('#screen-control').hidden);
    const choose = (key, value) => main.click(main.$('#screen-panel [data-screen="' + key + '"] [data-value="' + value + '"]'));
    main.click(main.$('#screen-control'));
    assert.ok(!main.$('#screen-panel').hidden);
    assert.equal(main.$('#screen-panel').querySelectorAll('[aria-pressed="true"]').length, 0, 'nothing chosen from the desk yet');
    const since = world.clock.now();
    choose('concept', 'carousel');
    await run(world, 15000);
    assert.ok(board.$('.carousel'), 'the projector shows the carousel');
    assert.equal(pressed(board, 'concept'), 'carousel', 'and its own settings strip says so');
    assert.match(main.status(), /Projector screen: Layout Carousel/);
    const reads = world.traffic.filter(log => log.tab === projector && log.sentAt >= since).map(log => log.name);
    assert.ok(reads.every(name => name === 'getDeskStamps'), 'a screen choice reads nothing else: ' + reads.join(', '));
    choose('look', 'green');
    choose('pay', 'false');
    await run(world, 15000);
    assert.equal(board.$('#board').dataset.look, 'green');
    assert.equal(board.$('#bc-pay').checked, false);
    assert.equal(pressed(board, 'concept'), 'carousel', 'a later choice keeps the earlier ones');
    // Changed on the projector itself, then chosen again on the desk: the desk's choice shows again.
    boardClick(board, '[data-set="concept"] [data-value="wall"]');
    await run(world, 15000);
    assert.ok(board.$('.wall'), 'the projector\'s own strip still works');
    choose('concept', 'carousel');
    await run(world, 15000);
    assert.ok(board.$('.carousel'), 'the same choice again from the desk counts');
    // A follower that opens later takes the desk's choice.
    const late = await follower();
    assert.ok(late.board.$('.carousel'));
    assert.equal(late.board.$('#board').dataset.look, 'green');
    // Google keeps only settings it knows.
    assert.throws(() => world.server.run('setFollowScreen', world.date, { concept: 'x', secs: 99 }), /nothing to show/);
    [main, projector, late.projector].forEach(tab => assert.ok(!tab.errors.length, tab.errors.join('\n')));
    board.close();
    late.board.close();
  },

  // A player who arrives after the Equalizer's sheets print joins the group the desk picks: nobody else moves, every
  // match keeps its id and result, Google takes it even once a result is in, and only that group's sheet needs printing.
  async equalizerLateAdd() {
    const world = sim.createWorld({ seed: 77, players: 24 });
    const main = await deskWith(world, 19);
    main.click(main.$('#event-switch [data-event="equalizer"]'));
    await run(world, 20000);
    const board = boardWindow(world, main);
    main.click(main.$('#player-board'));
    await run(world, 1000);
    const eqData = () => main.window.cttcDesk.equalizerPrint();
    const groupsNow = () => JSON.parse(JSON.stringify(eqData().event.groups.map(g => ({ sides: g.sides.slice(), matches: g.matches.map(m => m.id + ':' + m.players.join('v')) }))));
    assert.deepEqual(groupsNow().map(g => g.sides.length), [4, 4, 4, 4, 3]);

    // Before the print a sign-in draws again, as before; after it, the desk asks for a group.
    main.window.cttcPlayerBoard.printed();
    await run(world, 3000);
    const row = main.$('#equalizer .match.match-pending[data-eq-match]');
    const scored = row.getAttribute('data-eq-match');
    main.click(row.querySelector('[data-side="0"][data-games="2"]'));
    await run(world, 20000);
    const before = groupsNow();
    const late = world.players[19].player_id;
    // Group 5 is the one group smaller than the rest: the late player goes there with no question.
    main.addPlayer(late);
    assert.ok(!main.$('#equalizer .eq-late'), 'no group to pick: Group 5 is the short one');
    await run(world, 20000);
    const after = groupsNow();
    assert.deepEqual(after.slice(0, 4), before.slice(0, 4), 'the other groups are untouched');
    assert.deepEqual(after[4].sides, before[4].sides.concat([late]), 'the late player joins Group 5');
    assert.deepEqual(after[4].matches.slice(0, 3), before[4].matches, 'Group 5\'s matches keep their ids');
    assert.equal(after[4].matches.length, 6);
    assert.match(main.status(), /joins Group 5 as a late add/);
    assert.ok(main.$('#equalizer [data-eq-print-group="5"]'), 'Print sheet beside Group 5');
    assert.match(main.window.cttcPlayerBoard.printNote(), /Late add since the sheets printed: replace the sheet for Group 5/);
    assert.ok(board.text().includes(nameOf(world, late)), 'the board shows the late add');
    // Google has it, with the result still there.
    const saved = world.server.run('getEqualizerState', world.date);
    assert.deepEqual(JSON.parse(JSON.stringify(saved.setup.draw.late)).map(x => [x.id, x.group]), [[late, 5]]);
    assert.ok(saved.roster.includes(late));
    assert.ok(saved.results[scored], 'the result already in stays');
    assert.equal(main.syncNote(), '');
    // Every group has 4 now, so the next one is asked which group (Cancel adds nobody); a group of 4 takes a fifth.
    const second = world.players[20].player_id;
    main.addPlayer(second);
    await run(world, 500);
    assert.ok(!eqData().event.ratings[second], 'not placed until a group is picked');
    assert.match(main.status(), /pick their group/);
    const picker = main.$('#equalizer .eq-late');
    assert.ok(picker, 'the desk asks which group');
    assert.equal(picker.querySelectorAll('[data-eq-late]').length, 5);
    main.click(picker.querySelector('[data-eq-late-cancel]'));
    assert.ok(!main.$('#equalizer .eq-late'), 'Cancel adds nobody');
    main.addPlayer(second);
    await run(world, 500);
    main.click(main.$('#equalizer [data-eq-late="2"]'));
    await run(world, 20000);
    assert.equal(groupsNow()[1].sides.length, 5);
    assert.equal(groupsNow()[1].matches.length, 10);
    assert.equal(world.server.run('getEqualizerState', world.date).setup.draw.late.length, 2);
    // A section's header folds it away, as in round robin scoring, and it stays folded through a redraw.
    const head = main.$('#equalizer [data-eq-fold="g1"]');
    main.click(head);
    assert.ok(head.closest('.match-group').classList.contains('collapsed'));
    assert.equal(head.getAttribute('aria-expanded'), 'false');
    main.window.cttcDesk.setStatus('redraw');
    main.addPlayer(world.players[21].player_id);
    await run(world, 500);
    assert.ok(main.$('#equalizer [data-eq-fold="g1"]').closest('.match-group').classList.contains('collapsed'), 'still folded after a redraw');
    main.click(main.$('#equalizer [data-eq-late-cancel]'));
    main.click(main.$('#equalizer [data-eq-fold="g1"]'));
    assert.ok(!main.$('#equalizer [data-eq-fold="g1"]').closest('.match-group').classList.contains('collapsed'), 'and opens again');
    // One group's sheet prints on its own and leaves the print mark alone.
    main.click(main.$('#equalizer [data-eq-print-group="5"]'));
    assert.equal(main.window.document.querySelectorAll('.eq-group-sheet').length, 1);
    assert.ok(main.$('.eq-group-sheet').textContent.includes(nameOf(world, late)));
    [main].forEach(tab => assert.ok(!tab.errors.length, tab.errors.join('\n')));
    board.close();
  },

  // Refresh projector on the main desk: a following laptop reads the whole night again and redraws its board; one
  // running older desk code than the main desk says to reload there.
  async followRefresh() {
    const world = sim.createWorld({ seed: 79 });
    const main = await deskWith(world, 12);
    const follower = async build => {
      const projector = world.device().open({ build });
      await run(world, 15000);
      const board = boardWindow(world, projector);
      projector.click(projector.$('#player-board'));
      await run(world, 1000);
      boardClick(board, '#choose-follow');
      await run(world, 15000);
      return { projector, board };
    };
    const same = await follower();
    const old = await follower('0ld0c0de'.replace(/[^0-9a-f]/g, 'f'));
    // A refresh sent before a laptop started following is not acted on.
    const since = world.clock.now();
    main.click(main.$('#screen-control'));
    main.click(main.$('#screen-refresh'));
    await run(world, 15000);
    assert.match(main.status(), /Refresh sent/);
    const reads = tab => world.traffic.filter(log => log.tab === tab && log.sentAt >= since && log.name === 'getAppState').length;
    assert.ok(reads(same.projector) >= 1, 'the follower read the whole night again');
    assert.ok(same.board.$('#board-notice').hidden, 'same code: no warning');
    assert.match(old.board.$('#board-notice').textContent, /older version of the desk/, 'older code: the board says to reload');
    assert.match(old.projector.$('#follow-text').textContent, /older version of the desk/);
    // Nothing more until the next refresh.
    const later = world.clock.now();
    await run(world, 30000);
    assert.equal(world.traffic.filter(log => log.tab === same.projector && log.sentAt >= later && log.name === 'getAppState').length, 0);
    [main, same.projector, old.projector].forEach(tab => assert.ok(!tab.errors.length, tab.errors.join('\n')));
    same.board.close();
    old.board.close();
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

  // Once the sheets print, the play order stays as it is on the paper: removing a player takes only that player's
  // matches out, a late arrival's matches go at the end, a reprint and another device keep the same order, and a night
  // whose order was rebuilt before this rule (a print mark without the order) is put back when the desk loads.
  async playOrderAfterPrint() {
    const world = sim.createWorld({ seed: 67, players: 40 });
    const tab = await deskWith(world, 24);
    // Array.from: each simulated device is its own window, and its arrays are not this file's arrays.
    const orderOf = (t, n) => Array.from(t.desk().matches).filter(m => m.groupNumber === n).map(m => m.playerOneId + ' v ' + m.playerTwoId);
    const without = (list, ids) => list.filter(text => !ids.some(id => text.split(' v ').includes(id)));
    const numbers = tab.desk().groups.map(g => g.groupNumber);
    tab.window.cttcPlayerBoard.printed();
    await run(world, 400);
    const paper = {};
    numbers.forEach(n => { paper[n] = orderOf(tab, n); });
    const lineup = tab.desk().groups.map(g => g.playerIds.slice());

    // A score entered before the removals stays with its match.
    const scoredAt = tab.desk().matches.findIndex(m => m.groupNumber === 1 && !m.playerOneId.includes(lineup[0][1]) && m.playerOneId !== lineup[0][1] && m.playerTwoId !== lineup[0][1] && m.playerOneId !== lineup[0][4] && m.playerTwoId !== lineup[0][4]);
    const scored = tab.desk().matches[scoredAt];
    const scoredText = scored.playerOneId + ' v ' + scored.playerTwoId;
    tab.scoreMatch(scoredAt, 'one', 1);
    await run(world, 400);

    // Two players leave Group 1 (not the top or bottom seat, so the plain round robin order would reshuffle).
    const gone = [lineup[0][1], lineup[0][4]];
    assert.notDeepEqual(tab.window.CTTCOrganizer.roundRobinPairs(lineup[0].filter(id => !gone.includes(id))).map(p => p.join(' v ')), without(paper[1], gone), 'the plain order for the smaller group is a different order');
    gone.forEach(id => tab.removePlayer(id));
    await run(world, 400);
    assert.deepEqual(orderOf(tab, 1), without(paper[1], gone), 'the matches left keep the order on the printed sheet');
    const still = tab.desk().matches.find(m => m.playerOneId + ' v ' + m.playerTwoId === scoredText);
    assert.deepEqual([still.playerOneGames, still.playerTwoGames], [3, 1], 'and their scores');
    numbers.slice(1).forEach(n => assert.deepEqual(orderOf(tab, n), paper[n], 'Group ' + n + ' is untouched'));

    // A late arrival: every printed match stays where it was, and the new player's matches follow at the end.
    const late = world.players[24].player_id;
    tab.addPlayer(late);
    await run(world, 400);
    const joined = tab.desk().groups.find(g => g.playerIds.includes(late)).groupNumber;
    const before = joined === 1 ? without(paper[1], gone) : paper[joined];
    assert.deepEqual(orderOf(tab, joined).slice(0, before.length), before, 'the printed matches keep their places');
    assert.ok(orderOf(tab, joined).slice(before.length).every(text => text.split(' v ').includes(late)), 'the late add\u2019s matches come last');
    assert.equal(orderOf(tab, joined).length, before.length + tab.desk().groups[joined - 1].playerIds.length - 1);

    // A move to the next group and back puts the player's matches back where the paper has them.
    const mover = lineup[1][2];
    tab.movePlayer(mover, '1');
    await run(world, 400);
    assert.ok(tab.desk().groups[2].playerIds.includes(mover), 'moved down a group');
    assert.deepEqual(orderOf(tab, 2).filter(text => !text.split(' v ').includes(late)), without(paper[2], [mover]), 'the group left keeps its order');
    assert.deepEqual(orderOf(tab, 3).filter(text => !text.split(' v ').includes(late) && !text.split(' v ').includes(mover)), paper[3], 'and so does the group joined');
    tab.movePlayer(mover, '-1');
    await run(world, 400);
    assert.deepEqual(orderOf(tab, 2).filter(text => !text.split(' v ').includes(late)), paper[2], 'back in the group, back in the printed order');

    // A reprint keeps the order it printed with, here and on a device that loads the night afterwards.
    const shown = {};
    numbers.forEach(n => { shown[n] = orderOf(tab, n); });
    tab.window.cttcPlayerBoard.printed();
    await run(world, 30000);
    numbers.forEach(n => assert.deepEqual(orderOf(tab, n), shown[n], 'a reprint changes no order'));
    const mark = JSON.parse(JSON.stringify(world.server.run('getAppState', world.date).printed));
    assert.equal(mark.order.length, mark.groups.length, 'Google keeps the printed order with the mark');
    const second = world.device().open();
    await run(world, 15000);
    numbers.forEach(n => assert.deepEqual(orderOf(second, n), shown[n], 'another device draws the same order'));
    tab.removePlayer(late);
    await run(world, 30000);
    assert.deepEqual(orderOf(tab, 1), without(paper[1], gone), 'removing after the reprint still keeps the paper\u2019s order');

    // A night from before this rule: the mark has the lineups as printed and no order, and the saved matches are in
    // the rebuilt order. Loading the desk puts them back in the printed order.
    const old = sim.createWorld({ seed: 71, players: 40 });
    const first = await deskWith(old, 18);
    first.window.cttcPlayerBoard.printed();
    await run(old, 30000);
    const oldPaper = orderOf(first, 1);
    const oldLineup = first.desk().groups.map(g => g.playerIds.slice());
    const left = [oldLineup[0][0], oldLineup[0][3]];
    const legacy = JSON.parse(JSON.stringify(old.server.run('getAppState', old.date).printed));
    first.window.cttcPlayerBoard.forgetPrint();
    await run(old, 30000);
    left.forEach(id => first.removePlayer(id));
    await run(old, 30000);
    assert.notDeepEqual(orderOf(first, 1), without(oldPaper, left), 'without the rule the order is rebuilt');
    old.server.run('saveSessionPrint', 'session-' + old.date, { at: legacy.at + 1, groups: legacy.groups, first: legacy.first });
    const fresh = old.device().open();
    await run(old, 15000);
    // (With the print undone, the removals rebuilt the groups by rating, so Group 1 also took players from Group 2:
    // their matches are not on Group 1's sheet and follow the printed ones.)
    const kept = without(oldPaper, left);
    assert.deepEqual(orderOf(fresh, 1).slice(0, kept.length), kept, 'a fresh load restores the printed order');
    assert.ok(orderOf(fresh, 1).slice(kept.length).every(text => text.split(' v ').some(id => !oldLineup[0].includes(id))), 'with the matches the sheet never had after them');
    await run(old, 70000);
    assert.deepEqual(orderOf(first, 1), orderOf(fresh, 1), 'and a desk left open follows within its refresh');

    // Google keeps only a well-formed order.
    assert.throws(() => old.server.run('saveSessionPrint', 'session-' + old.date, { at: 1, groups: [['a', 'b']], first: ['a', 'b'], order: [[[0, 2]]] }), /match order/);
    assert.throws(() => old.server.run('saveSessionPrint', 'session-' + old.date, { at: 1, groups: [['a', 'b']], first: ['a', 'b'], order: 'x' }), /match order/);
    [tab, second, first, fresh].forEach(t => assert.ok(!t.errors.length, t.errors.join('\n')));
  },

  // A board window left open across a release (the projector's): its page is whatever desk code first wrote it. The
  // next Player board click from a desk running other code writes the page again in the same window; the same code
  // leaves the page alone.
  async boardLeftOpenAcrossRelease() {
    const world = sim.createWorld({ seed: 83 });
    const tab = await deskWith(world, 12);
    const board = boardWindow(world, tab);
    tab.click(tab.$('#player-board'));
    await run(world, 1000);
    boardClick(board, '#choose-desk');
    const build = board.w.cttcBoardPage.version;
    assert.match(String(build), /^[0-9a-z]+\.\d+$/, 'the page carries a fingerprint of its code');
    board.$('#board').setAttribute('data-kept', '1');
    tab.click(tab.$('#player-board'));
    await run(world, 1000);
    assert.equal(board.$('#board').getAttribute('data-kept'), '1', 'the same code: the page is not written again');
    // The window as an earlier release left it: a page with another fingerprint (earlier pages all said 2).
    board.w.cttcBoardPage.version = 2;
    let retired = 0;
    const retire = board.w.cttcBoardPage.retire;
    board.w.cttcBoardPage.retire = () => { retired += 1; retire(); };
    tab.click(tab.$('#player-board'));
    await run(world, 1000);
    assert.equal(board.$('#board').getAttribute('data-kept'), null, 'other code: the page is written again');
    assert.equal(board.w.cttcBoardPage.version, build, 'with this desk\u2019s code');
    assert.equal(retired, 1, 'and the old page\u2019s timers are stopped');
    assert.match(board.$('.b-title strong').textContent, /Round Robin/, 'the new page shows the night');
    assert.equal(board.$$('#board-controls').length, 1);
    assert.ok(!tab.errors.length, tab.errors.join('\n'));
    board.close();
  },

  // The settings strip is up until the board goes full screen and back when it leaves (Esc), in every layout and on a
  // following board too; the mouse does not bring it up in full screen.
  async stripGoesInFullScreen() {
    const world = sim.createWorld({ seed: 89 });
    const tab = await deskWith(world, 12);
    const board = boardWindow(world, tab);
    tab.click(tab.$('#player-board'));
    await run(world, 1000);
    boardClick(board, '#choose-desk');
    const hidden = () => board.$('#board-controls').classList.contains('hidden');
    const doc = board.w.document;
    let full = null;
    Object.defineProperty(doc, 'fullscreenElement', { configurable: true, get: () => full });
    const setFull = on => { full = on ? doc.documentElement : null; doc.dispatchEvent(new board.w.Event('fullscreenchange')); };
    const mouse = () => doc.dispatchEvent(new board.w.MouseEvent('mousemove', { bubbles: true }));
    for (const layout of ['carousel', 'wall', 'spot']) {
      boardClick(board, '[data-set="concept"] [data-value="' + layout + '"]');
      await run(world, 6000);
      assert.equal(hidden(), false, layout + ': the strip stays up outside full screen, however long the mouse is still');
      setFull(true);
      assert.equal(hidden(), true, layout + ': full screen takes the strip away');
      mouse();
      await run(world, 500);
      assert.equal(hidden(), true, layout + ': and the mouse does not bring it back');
      assert.equal(board.$('#bc-full').textContent, 'Exit full screen');
      setFull(false);
      assert.equal(hidden(), false, layout + ': leaving full screen (Esc) brings it back');
      assert.equal(board.$('#bc-full').textContent, 'Full screen');
    }
    // A following board is no different.
    board.$('#bc-follow').checked = true;
    board.$('#bc-follow').dispatchEvent(new board.w.Event('change', { bubbles: true }));
    await run(world, 6000);
    assert.equal(hidden(), false, 'following, not full screen: the strip is up');
    setFull(true);
    mouse();
    assert.equal(hidden(), true, 'following, full screen: gone');
    setFull(false);
    assert.equal(hidden(), false);
    assert.ok(!tab.errors.length, tab.errors.join('\n'));
    board.close();
  },

  // After the sheets print, a group whose players all leave goes, and every other group keeps the number on its sheet
  // ("Table #"): on the desk, the scores, the board, a reprint, Google and another device. Nothing asks for a sheet to be
  // replaced, and a late add joins a group that is still playing.
  async groupEmptiedAfterPrint() {
    const world = sim.createWorld({ seed: 97, players: 40 });
    const tab = await deskWith(world, 18);
    const numbers = t => Array.from(t.desk().groups).map(g => g.groupNumber);
    assert.deepEqual(numbers(tab), [1, 2, 3]);
    tab.window.cttcPlayerBoard.printed();
    await run(world, 2000);
    const printed = Array.from(tab.desk().groups).map(g => Array.from(g.playerIds));
    const third = printed[2][0];
    const orderOf = (t, n) => Array.from(t.desk().matches).filter(m => m.groupNumber === n).map(m => m.playerOneId + ' v ' + m.playerTwoId);
    const paper3 = orderOf(tab, 3);
    for (const id of printed[1]) { tab.removePlayer(id); await run(world, 300); }
    assert.deepEqual(numbers(tab), [1, 3], 'Group 3 keeps its number when Group 2 empties');
    assert.equal(tab.desk().groups.find(g => g.playerIds.includes(third)).groupNumber, 3);
    assert.deepEqual(orderOf(tab, 3), paper3, 'its matches keep their number and printed order');
    assert.equal(orderOf(tab, 2).length, 0);
    assert.equal(tab.window.cttcPlayerBoard.printNote(), '', 'no sheet needs replacing');
    assert.equal(tab.window.cttcPlayerBoard.labels(), null, 'and no Updated label');
    const headings = [...tab.window.document.querySelectorAll('#groups .group-head strong')].map(el => el.textContent);
    assert.deepEqual(headings, ['Group 1', 'Group 3'], 'the desk shows the printed numbers');
    // A late add joins a group still playing, never the empty number.
    const late = world.players[18].player_id;
    tab.addPlayer(late);
    await run(world, 400);
    assert.deepEqual(numbers(tab), [1, 3]);
    const joined = tab.desk().groups.find(g => g.playerIds.includes(late)).groupNumber;
    assert.equal(tab.window.cttcPlayerBoard.printNote(), 'Group ' + joined + ' changed since the sheets last printed: that is the sheet to replace.', 'only the late add\u2019s group, by its printed number');
    // Google keeps the numbers; a reload and another device show them.
    await run(world, 30000);
    const saved = sim.googleSession(world, world.date);
    assert.deepEqual([...new Set(saved.groups.map(g => g.groupNumber))].sort(), [1, 3], 'Google holds groups 1 and 3');
    const other = world.device().open();
    await run(world, 15000);
    assert.deepEqual(numbers(other), [1, 3], 'another device shows the printed numbers');
    assert.deepEqual(orderOf(other, 3), orderOf(tab, 3));
    assert.equal(other.window.cttcPlayerBoard.printNote(), tab.window.cttcPlayerBoard.printNote(), 'the same note on the other device');
    // Clear labels and a reprint keep the numbers; the mark records Group 2 as gone.
    tab.window.cttcPlayerBoard.keepAsPrinted();
    await run(world, 400);
    assert.deepEqual(numbers(tab), [1, 3]);
    const mark = JSON.parse(JSON.stringify(world.server.run('getAppState', world.date).printed));
    assert.equal(mark.groups.length, 3);
    assert.deepEqual(mark.groups[1], [], 'the mark keeps Group 2\u2019s place, empty');
    [tab, other].forEach(t => assert.ok(!t.errors.length, t.errors.join('\n')));
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
