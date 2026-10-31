'use strict';

// The Equalizer's server (EqualizerService.js) against the simulated Google Sheet: saving the setup and results, the
// switch between round robin and Equalizer, finalizing through the shared ledger, reopening, and the memory. Made-up
// players only (scripts/lib/desk-sim.js).
const assert = require('node:assert/strict');
const { createWorld } = require('../scripts/lib/desk-sim');
const E = require('../equalizer');

const DATE = '2026-11-07';
const EQ = 'session-' + DATE + '-equalizer';
const world = createWorld({ date: DATE, players: 24 });
const server = world.server;
// Replies cross from the simulator's sandbox: compare them as plain JSON, as a page would receive them.
const plain = value => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
const run = (name, ...args) => plain(server.run(name, ...args));
const ids = world.players.map(p => p.player_id);
const ratingOf = id => Number(server.rows('Players').find(p => p.player_id === id).current_rating);
const refuses = (pattern, fn) => assert.throws(fn, pattern);
function seededRandom(seed) {
  let value = seed;
  return () => { value = (value * 1103515245 + 12345) % 2147483648; return value / 2147483648; };
}
function drawFor(roster, setup) {
  return E.draw(Object.assign({ players: roster.map(id => ({ id, rating: ratingOf(id) })) }, setup || {}), seededRandom(7));
}

// ---- Nothing yet: reading never creates tabs ----
let state = run('getEqualizerState', DATE);
assert.equal(state.session, null);
assert.deepEqual(state.roster, []);

// ---- Players sign in before there are enough for a draw ----
const roster = ids.slice(0, 8);
let saved = run('saveEqualizerSetup', DATE, { roster: roster.slice(0, 3), format: 'groups', play: 'singles', bestOf: 3, draw: null });
assert.equal(saved.sessionId, EQ);
state = run('getEqualizerState', DATE);
assert.deepEqual(state.roster, roster.slice(0, 3));
assert.equal(state.setup.draw, null);
assert.equal(server.rows('Sessions').find(r => r.session_id === EQ).status, 'active');

// ---- The full roster and its draw ----
let draw = drawFor(roster);
saved = run('saveEqualizerSetup', DATE, { roster, format: 'groups', play: 'singles', bestOf: 3, draw });
state = run('getEqualizerState', DATE);
assert.deepEqual(state.setup.draw, draw, 'the draw is saved as drawn');
assert.equal(state.setup.bestOf, 3);
const players = server.rows('SessionPlayers').filter(r => r.session_id === EQ);
assert.equal(players.length, 8);
assert.ok(players.every(r => Number(r.starting_rating) === draw.ratings[r.player_id]), 'starting ratings are the draw\'s');
refuses(/does not match its players/, () => run('saveEqualizerSetup', DATE, { roster: roster.slice(0, 7), format: 'groups', play: 'singles', bestOf: 3, draw }));
// A changed choice before any result is a new draw.
draw = drawFor(roster, { bestOf: 5 });
run('saveEqualizerSetup', DATE, { roster, format: 'groups', play: 'singles', bestOf: 5, draw });
assert.equal(run('getEqualizerState', DATE).setup.bestOf, 5);

// ---- Results ----
const event = E.fromSnapshot(draw);
let view = E.resolve(event, {});
const first = E.callOrder(view)[0];
const win = { winnerId: first.players[0], games: [3, 1], headStart: { sideId: first.players[1], points: 4 } };
refuses(/best-of-5/, () => run('saveEqualizerResult', DATE, first.id, { winnerId: first.players[0], games: [2, 1] }, null));
saved = run('saveEqualizerResult', DATE, first.id, win, null);
const again = run('saveEqualizerResult', DATE, first.id, win, null);
assert.equal(again.revision, saved.revision, 'sending the same result again changes nothing');
refuses(/changed on another device/, () => run('saveEqualizerResult', DATE, first.id, { winnerId: first.players[1], games: [1, 3] }, null));
// This page's own earlier send may have arrived: listing it as known lets the newer version through.
const edited = { winnerId: first.players[0], games: [3, 2], headStart: win.headStart };
run('saveEqualizerResult', DATE, first.id, edited, [null, win]);
run('saveEqualizerResult', DATE, first.id, win, [edited]);
const row = server.rows('BracketMatches').find(r => r.match_id === first.id);
assert.equal(Number(row.head_start_points), 4);
assert.equal(row.side_one_id, first.players[0]);
// Cut to best of 3 with Winner.
const second = E.callOrder(E.resolve(event, { [first.id]: win }), { [first.id]: first.players }).find(m => m.players.every(p => first.players.indexOf(p) < 0));
run('saveEqualizerResult', DATE, second.id, { winnerId: second.players[1], games: [1, 2], wonBy: second.players[1] }, null);
assert.equal(run('getEqualizerState', DATE).results[second.id].wonBy, second.players[1]);
refuses(/has started/, () => run('saveEqualizerSetup', DATE, { roster, format: 'double', play: 'singles', bestOf: 5, draw: drawFor(roster, { format: 'double' }) }));
// Finals are not ready until every group is decided.
refuses(/not ready/, () => run('saveEqualizerResult', DATE, 'W1-1', { winnerId: 'x', games: [3, 0] }, null));

// ---- Play it out, then finalize ----
let results = run('getEqualizerState', DATE).results;
refuses(/not finished/, () => run('finalizeEqualizer', DATE, Number(server.rows('Sessions').find(r => r.session_id === EQ).revision)));
for (;;) {
  view = E.resolve(event, results);
  if (view.finished) break;
  const m = E.callOrder(view)[0];
  run('saveEqualizerResult', DATE, m.id, { winnerId: m.players[0], games: [3, 0] }, null);
  results = run('getEqualizerState', DATE).results;
}
// A result a later match depends on cannot be changed or cleared.
// (A group result: the Final depends on every group being decided.)
const dependedOn = view.matches.find(m => m.bracket === 'G' && m.status === 'done');
refuses(/depends on this one/, () => run('saveEqualizerResult', DATE, dependedOn.id, null, results[dependedOn.id]));
const flipped = { winnerId: dependedOn.players[1], games: [0, 3] };
refuses(/depends on this one/, () => run('saveEqualizerResult', DATE, dependedOn.id, flipped, results[dependedOn.id]));
const before = {};
roster.forEach(id => { before[id] = ratingOf(id); });
// A round robin with players on the same date is finalized first.
run('createSession', DATE);
server.context.appendObjects_('SessionPlayers', [{ session_id: 'session-' + DATE, player_id: ids[20], group_number: 1, starting_rating: ratingOf(ids[20]), promotion_from_group: '' }]);
const revision = () => Number(server.rows('Sessions').find(r => r.session_id === EQ).revision);
refuses(/round robin for 2026-11-07 is still open/, () => run('finalizeEqualizer', DATE, revision()));
server.context.replaceSessionRows_('SessionPlayers', 'session-' + DATE, []);
state = run('finalizeEqualizer', DATE, revision());
assert.equal(state.session.status, 'finalized');
const outcome = E.playerResults(event, E.resolve(event, results));
const ledger = server.rows('RatingLedger').filter(r => r.session_id === EQ);
assert.equal(ledger.length, 8);
assert.ok(ledger.every(r => r.rule_version === 'cttc-equalizer-v1'));
roster.forEach(id => {
  assert.equal(ratingOf(id), Math.max(0, before[id] + outcome[id].raw), 'each player gains or gives 8 a match, on top of their rating now');
});
assert.equal(roster.reduce((sum, id) => sum + ratingOf(id) - before[id], 0), 0, 'as much up as down');
refuses(/finalized/, () => run('saveEqualizerResult', DATE, first.id, null, results[first.id]));

// ---- Reopen puts the ratings back ----
state = run('reopenEqualizer', DATE, revision());
assert.equal(state.session.status, 'active');
roster.forEach(id => assert.equal(ratingOf(id), before[id]));
assert.equal(server.rows('RatingLedger').filter(r => r.session_id === EQ).length, 0);
run('finalizeEqualizer', DATE, revision());

// ---- The memory: a later Equalizer sees this one's matches ----
const LATER = '2026-11-14';
const later = run('getEqualizerState', LATER);
assert.equal(later.history.length, Object.keys(results).length, 'every finalized match is remembered');
assert.ok(later.history.every(h => h.ratings[h.playerOneId] !== undefined && h.ratings[h.playerTwoId] !== undefined));

// ---- Switching the day's event moves the roster while the event it leaves has no results ----
const SWITCH = '2026-11-21';
run('createSession', SWITCH);
const rrPlayers = ids.slice(10, 16);
const rrSession = run('getSessionByDate', SWITCH);
run('saveSessionDraft', { sessionId: rrSession.sessionId, revision: rrSession.revision, groups: [{ groupNumber: 1, playerIds: rrPlayers }], matches: [], promotions: {} });
let switched = run('switchDayEvent', SWITCH, 'equalizer', rrPlayers);
assert.deepEqual(switched.equalizer.roster, rrPlayers, 'the players are in the Equalizer');
assert.equal(switched.rrSession.groups.length, 0, 'and no longer in the round robin');
assert.equal(switched.equalizer.setup.format, 'groups', 'with the default choices');
switched = run('switchDayEvent', SWITCH, 'rr', rrPlayers);
assert.deepEqual(switched.equalizer.roster, []);
assert.equal(switched.equalizer.setup.draw, null);
// A round robin with a result keeps its players.
const rr2 = run('getSessionByDate', SWITCH);
run('saveSessionDraft', { sessionId: rr2.sessionId, revision: rr2.revision, groups: [{ groupNumber: 1, playerIds: rrPlayers.slice(0, 2) }], matches: [{ groupNumber: 1, playerOneId: rrPlayers[0], playerTwoId: rrPlayers[1], playerOneGames: 3, playerTwoGames: 0, forfeit: false }], promotions: {} });
refuses(/already has results/, () => run('switchDayEvent', SWITCH, 'equalizer', rrPlayers.slice(0, 2)));

// ---- Doubles: a team of three is saved and finalized for all three ----
const TEAMS = '2026-11-28';
const nine = ids.slice(0, 9); // 4 pairs and a team of three
const doubles = E.draw({ format: 'double', play: 'doubles', oddPlayer: 'team-of-three', players: nine.map(id => ({ id, rating: ratingOf(id) })) }, seededRandom(3));
run('saveEqualizerSetup', TEAMS, { roster: nine, format: 'double', play: 'doubles', bestOf: 3, oddPlayer: 'team-of-three', draw: doubles });
const doublesEvent = E.fromSnapshot(doubles);
let doublesResults = {};
for (;;) {
  const v = E.resolve(doublesEvent, doublesResults);
  if (v.finished) break;
  const m = E.callOrder(v)[0];
  run('saveEqualizerResult', TEAMS, m.id, { winnerId: m.players[1], games: [0, 2] }, null);
  doublesResults = run('getEqualizerState', TEAMS).results;
}
const teamBefore = {};
nine.forEach(id => { teamBefore[id] = ratingOf(id); });
run('finalizeEqualizer', TEAMS, Number(server.rows('Sessions').find(r => r.session_id === 'session-' + TEAMS + '-equalizer').revision));
assert.equal(server.rows('RatingLedger').filter(r => r.session_id === 'session-' + TEAMS + '-equalizer').length, 9, 'all nine players, the team of three included');

// ---- Every step is in the desk log, by its usual names ----
const logged = server.audit.map(entry => entry.action);
['session_created', 'session_saved', 'session_finalized', 'session_reopened', 'event_switched'].forEach(action => assert.ok(logged.includes(action), action));

console.log('Equalizer desk server checks passed');
