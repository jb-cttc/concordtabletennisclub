'use strict';

// The Equalizer's shared rules (handicap.js, bracket.js, round-robin.js, equalizer.js). Made-up players only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('../handicap');
const B = require('../bracket');
const RR = require('../round-robin');
const E = require('../equalizer');
const ratings = require('../rating-engine');

// Any ready match, for playing a bracket out at random.
function readyOf(view) { return view.matches.filter(function (m) { return m.status === 'ready'; }); }

// ---- Head start: every full 40 points, at most 8 ----
[[0, 0], [39, 0], [40, 1], [79, 1], [80, 2], [239, 5], [240, 6], [319, 7], [320, 8], [1000, 8]].forEach(function (testCase) {
  assert.equal(H.baseHeadStart(1500, 1500 + testCase[0]), testCase[1], 'gap ' + testCase[0]);
  assert.equal(H.baseHeadStart(1500 + testCase[0], 1500), testCase[1], 'gap ' + testCase[0] + ' either way round');
});
assert.equal(H.baseHeadStart(null, 1500), null);
assert.equal(11 - H.MAX_HEAD_START, 3, 'the lower-rated player always needs at least 3 points');

// ---- Rating exchange: the club engine at equal ratings, forfeits move nothing ----
assert.equal(H.exchange(false), 8);
assert.equal(H.exchange(false), ratings.adjustment(2000, 2000, false), 'follows the club table');
assert.equal(H.exchange(true), 0);

// ---- Memory: a lower-rated win takes a point off; a higher-rated win gives one back, never past the base ----
const start = { hi: 1800, lo: 1590 }; // gap 210: base 5
function played(at, winnerId, matchRatings) {
  return { at, playerOneId: 'hi', playerTwoId: 'lo', winnerId, forfeit: false, ratings: matchRatings || start };
}
assert.deepEqual(H.pairState('hi', 'lo', start, []), { lowerId: 'lo', base: 5, reduction: 0, headStart: 5, matchesCounted: 0 });
const sequence = ['lo', 'lo', 'hi', 'hi', 'hi'];
const expected = [4, 3, 4, 5, 5];
sequence.forEach(function (winner, index) {
  const history = sequence.slice(0, index + 1).map(function (who, at) { return played('2026-11-0' + (at + 1), who); });
  assert.equal(H.pairState('hi', 'lo', start, history).headStart, expected[index], 'after ' + (index + 1) + ' matches');
});
// Never below zero, however often the lower-rated player wins.
const streak = Array.from({ length: 9 }, function (_, at) { return played('2026-11-' + String(at + 10), 'lo'); });
assert.equal(H.pairState('hi', 'lo', start, streak).headStart, 0);
assert.equal(H.pairState('lo', 'hi', start, streak).headStart, 0, 'order of the two players does not matter');
// A smaller base today caps a reduction earned on a bigger gap.
assert.equal(H.pairState('hi', 'lo', { hi: 1700, lo: 1590 }, streak).reduction, 2, 'base 2 now');
// Forfeits do not count.
assert.equal(H.pairState('hi', 'lo', start, [Object.assign(played('2026-11-01', 'lo'), { forfeit: true })]).headStart, 5);
// Ratings crossing over starts the pair again.
assert.equal(H.pairState('hi', 'lo', { hi: 1500, lo: 1600 }, [played('2026-11-01', 'lo'), played('2026-11-02', 'lo')]).reduction, 0);
// Owner resets: everyone, or one pair; matches on or before the reset no longer count.
const twoWins = [played('2026-11-01', 'lo'), played('2026-11-08', 'lo')];
assert.equal(H.pairState('hi', 'lo', start, twoWins, [{ at: '2026-11-01', pair: 'all' }]).headStart, 4);
assert.equal(H.pairState('hi', 'lo', start, twoWins, [{ at: '2026-11-09', pair: H.pairKey('lo', 'hi') }]).headStart, 5);
assert.equal(H.pairState('hi', 'lo', start, twoWins, [{ at: '2026-11-09', pair: H.pairKey('lo', 'other') }]).headStart, 3);

// ---- Bracket ----
assert.deepEqual(B.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
assert.throws(function () { B.build(['a', 'b', 'c']); }, /at least 4/);
assert.throws(function () { B.build(['a'], { elimination: 'single' }); }, /at least 2/);
assert.throws(function () { B.build(['a', 'b', 'c', 'a']); }, /twice/);

function rng(seed) {
  let value = seed;
  return function () { value = (value * 1103515245 + 12345) % 2147483648; return value / 2147483648; };
}
// Every field from 4 to the cap, with random results: it always finishes, everyone plays at least twice,
// 2n-2 matches (2n-1 with a replay), and everyone gets a place.
let events = 0;
for (let size = B.MIN_FIELD; size <= B.MAX_FIELD; size += 1) {
  for (let trial = 0; trial < 40; trial += 1) {
    const random = rng(size * 100 + trial);
    const ids = Array.from({ length: size }, function (_, n) { return 'p' + n; });
    const structure = B.build(B.draw(ids, random));
    const results = {};
    const playedBy = {};
    for (let guard = 0; guard < 100; guard += 1) {
      const view = B.resolve(structure, results);
      if (view.finished) break;
      const ready = readyOf(view);
      assert.ok(ready.length, 'never stuck: ' + size);
      const match = ready[Math.floor(random() * ready.length)];
      match.players.forEach(function (id) { playedBy[id] = (playedBy[id] || 0) + 1; });
      results[match.id] = { winnerId: match.players[random() < 0.5 ? 0 : 1] };
    }
    const view = B.resolve(structure, results);
    assert.ok(view.finished, 'finished: ' + size);
    const count = Object.keys(results).length;
    assert.ok(count === 2 * size - 2 || count === 2 * size - 1, size + ' players, ' + count + ' matches');
    assert.equal(count === 2 * size - 1, view.byId.GF2.status === 'done', 'only a replay adds a match');
    ids.forEach(function (id) { assert.ok(playedBy[id] >= 2, 'two matches at least'); });
    assert.equal(Object.keys(view.places).length, size, 'everyone placed');
    const champion = Object.keys(view.places).filter(function (id) { return view.places[id].place === 1; });
    assert.deepEqual(champion, [view.champion]);
    assert.ok(Object.keys(view.lives).every(function (id) { return id === view.champion ? view.lives[id] >= 1 : view.lives[id] === 0; }));
    events += 1;
  }
}
// A Main Draw winner who wins the Final needs no replay; a Survivor Trail winner who wins forces one.
const four = B.build(['a', 'b', 'c', 'd']);
let results = { 'W1-1': { winnerId: 'a' }, 'W1-2': { winnerId: 'b' }, 'W2-1': { winnerId: 'a' }, 'L1-1': { winnerId: 'd' }, 'L2-1': { winnerId: 'b' } };
assert.deepEqual(B.resolve(four, results).byId.GF.players, ['a', 'b']);
assert.equal(B.resolve(four, Object.assign({ GF: { winnerId: 'a' } }, results)).byId.GF2.status, 'skipped');
assert.equal(B.resolve(four, Object.assign({ GF: { winnerId: 'b' } }, results)).byId.GF2.status, 'ready');
assert.equal(B.resolve(four, Object.assign({ GF: { winnerId: 'b' }, GF2: { winnerId: 'a' } }, results)).champion, 'a');
assert.equal(B.build(['a', 'b', 'c', 'd'], { replay: false }).matches.some(function (m) { return m.id === 'GF2'; }), false);
// Places: 16 players share 5-6, 7-8, 9-12, 13-16.
const sixteen = B.build(Array.from({ length: 16 }, function (_, n) { return 's' + n; }));
results = {};
for (;;) {
  const view = B.resolve(sixteen, results);
  if (view.finished) break;
  const match = readyOf(view)[0];
  results[match.id] = { winnerId: match.players[0] };
}
const shares = {};
Object.values(B.resolve(sixteen, results).places).forEach(function (p) { shares[p.place + '-' + p.to] = (shares[p.place + '-' + p.to] || 0) + 1; });
assert.deepEqual(shares, { '1-1': 1, '2-2': 1, '3-3': 1, '4-4': 1, '5-6': 2, '7-8': 2, '9-12': 4, '13-16': 4 });
// Best of: finals best of 5 by default, a replay best of 3.
assert.equal(sixteen.matches.find(function (m) { return m.id === 'W1-1'; }).bestOf, 3);
assert.equal(sixteen.matches.find(function (m) { return m.id === sixteen.mainFinal; }).bestOf, 5);
assert.equal(sixteen.matches.find(function (m) { return m.id === 'GF2'; }).bestOf, 3);

// ---- Single elimination (the RR -> Finals knockout) ----
for (let size = 2; size <= 8; size += 1) {
  const single = B.build(Array.from({ length: size }, function (_, n) { return 'k' + n; }), { elimination: 'single' });
  assert.ok(single.matches.every(function (m) { return m.bracket === 'W'; }), 'no Survivor Trail');
  let res = {};
  for (;;) {
    const view = B.resolve(single, res);
    if (view.finished) break;
    const m = readyOf(view)[0];
    res[m.id] = { winnerId: m.players[1] };
  }
  const view = B.resolve(single, res);
  assert.equal(Object.keys(res).length, size - 1, size + ': one match fewer than entries');
  assert.equal(Object.keys(view.places).length, size, 'everyone placed');
  assert.equal(single.matches.find(function (m) { return m.id === single.mainFinal; }).bestOf, 5);
}
// An entrant not known yet (a group still playing) makes its matches wait; a bye never does.
const waiting = B.build(['x', 'y', 'z'], { elimination: 'single' });
const pending = Object.assign({}, waiting, { entrants: ['x', null, 'z'] });
assert.ok(B.resolve(pending, {}).matches.every(function (m) { return m.status !== 'ready' || m.players.indexOf(null) < 0; }));
assert.equal(B.resolve(pending, {}).finished, false);

// ---- round-robin.js gives the desk's answers (apps-script/Organizer.html) ----
const desk = { window: {} };
vm.createContext(desk);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Organizer.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1], desk);
const O = desk.window.CTTCOrganizer;
for (let count = 1; count <= 60; count += 1) {
  [5, 6, 7].forEach(function (size) { assert.deepEqual(RR.sizeGroups(count, size), Array.from(O.sizeGroups(count, size)), count + ' in groups of ' + size); });
}
for (let size = 2; size <= 8; size += 1) {
  const ids = Array.from({ length: size }, function (_, n) { return 'r' + n; });
  assert.deepEqual(RR.roundRobinPairs(ids), JSON.parse(JSON.stringify(O.roundRobinPairs(ids))), 'match order for ' + size);
}
assert.deepEqual(RR.sizeGroups(13, 4), [4, 3, 3, 3]);
assert.deepEqual(RR.sizeGroups(24, 4), [4, 4, 4, 4, 4, 4]);
assert.deepEqual(RR.roundRobinRounds(['a', 'b', 'c', 'd']).map(function (r) { return r.length; }), [2, 2, 2], 'a group of 4 plays 3 rounds on 2 tables');

// ---- Events: both formats, singles and doubles ----
const pool = Array.from({ length: 25 }, function (_, n) { return { id: 'e' + n, rating: 2150 - n * 75 }; });
let combos = 0;
['double', 'groups'].forEach(function (format) {
  ['singles', 'doubles'].forEach(function (play) {
    for (let size = E.minimumPlayers(format, play); size <= E.MAX_PLAYERS; size += 1) {
      const random = rng(size * 7 + (format === 'groups' ? 1 : 0) + (play === 'doubles' ? 2 : 0));
      const event = E.create({ format: format, play: play, players: pool.slice(0, size) }, random);
      const seen = {};
      event.sides.forEach(function (side) {
        side.members.forEach(function (id) { assert.ok(!seen[id], 'one side each'); seen[id] = true; });
        assert.equal(side.rating, Math.round(side.members.reduce(function (sum, id) { return sum + event.ratings[id]; }, 0) / side.members.length), 'a team is the average of its ratings');
        assert.equal(side.members.length, play === 'doubles' ? 2 : 1);
      });
      assert.equal(Object.keys(seen).length + event.sitOut.length, size, 'everyone plays, or sits out an odd doubles draw');
      assert.equal(event.sitOut.length, play === 'doubles' ? size % 2 : 0);
      if (format === 'groups') event.groups.forEach(function (g) { assert.ok(g.sides.length === 3 || g.sides.length === 4, 'groups of 4, or 3'); });
      const results = {};
      for (let guard = 0; guard < 200; guard += 1) {
        const view = E.resolve(event, results);
        if (view.finished) break;
        const ready = E.callOrder(view);
        assert.ok(ready.length, 'never stuck');
        const m = ready[Math.floor(random() * ready.length)];
        const side = random() < 0.5 ? 0 : 1;
        const need = (m.bestOf + 1) / 2;
        const games = side === 0 ? [need, Math.floor(random() * need)] : [Math.floor(random() * need), need];
        results[m.id] = { winnerId: m.players[side], games: games };
      }
      const view = E.resolve(event, results);
      assert.ok(view.finished, format + ' ' + play + ' ' + size + ' finishes');
      const count = Object.keys(results).length;
      const sides = event.sides.length;
      if (format === 'double') assert.ok(count === 2 * sides - 2 || count === 2 * sides - 1);
      else assert.equal(count, event.groups.reduce(function (sum, g) { return sum + g.matches.length; }, 0) + event.groups.length - 1, 'groups, then one knockout match per group winner but one');
      assert.equal(Object.keys(view.places).length, sides, 'every side placed');
      if (format === 'groups') {
        view.tables.forEach(function (t) { assert.ok(view.places[t.winnerId].place <= event.groups.length, 'group winners place above everyone else'); });
        // Byes go to the best group winners.
        const ranked = E.finalsRank(event, view.tables);
        const firstRound = view.matches.filter(function (m) { return m.bracket === 'W' && m.round === 1; });
        const byed = firstRound.filter(function (m) { return m.status === 'bye'; }).map(function (m) { return m.winnerId; }).sort();
        assert.deepEqual(byed, ranked.slice(0, event.bracket.byes).sort(), 'byes to the best group winners');
      }
      const players = E.playerResults(event, view);
      const total = Object.keys(players).reduce(function (sum, id) { return sum + players[id].change; }, 0);
      Object.keys(players).forEach(function (id) {
        const p = players[id];
        if (event.ratings[id] - 8 * p.losses > 0) assert.equal(p.change, 8 * (p.wins - p.losses), 'each player, partners included, gains or gives 8 a match');
      });
      if (Object.keys(players).every(function (id) { return event.ratings[id] > 8 * players[id].losses; })) assert.equal(total, 0, 'ratings move as much up as down');
      combos += 1;
    }
  });
});
// The Finals wait for every group; with 6 groups the best 2 winners get byes (a bracket of 8).
const six = E.create({ format: 'groups', play: 'singles', players: pool.slice(0, 24) }, rng(9));
assert.equal(six.groups.length, 6);
assert.equal(six.bracket.byes, 2);
const partial = {};
six.groups[0].matches.forEach(function (m) { partial[m.id] = { winnerId: m.players[0], games: [3, 0] }; });
assert.ok(E.resolve(six, partial).matches.filter(function (m) { return m.bracket === 'W'; }).every(function (m) { return m.status !== 'ready'; }), 'no Finals match before every group is decided');
// Games ratio decides the byes, then fewer games lost, then the higher rating (the lower-rated winner plays on).
const fakeTables = [
  { winnerId: 'a', rows: [{ id: 'a', gamesWon: 9, gamesLost: 3 }] },
  { winnerId: 'b', rows: [{ id: 'b', gamesWon: 6, gamesLost: 0 }] },
  { winnerId: 'c', rows: [{ id: 'c', gamesWon: 9, gamesLost: 0 }] },
  { winnerId: 'd', rows: [{ id: 'd', gamesWon: 9, gamesLost: 3 }] }
];
assert.deepEqual(E.finalsRank({ sideRatings: { a: 1500, b: 900, c: 1200, d: 1400 } }, fakeTables), ['c', 'b', 'a', 'd'], 'a perfect group of 3 ties a perfect group of 4; ties go to the higher rating');

// Odd numbers in doubles: the organizer's choice.
const seven = pool.slice(0, 13);
const sat = E.create({ format: 'double', play: 'doubles', players: seven, oddPlayer: 'sit-out', sitOutId: 'e4' }, rng(2));
assert.deepEqual(sat.sitOut, ['e4'], 'a volunteer sits out');
assert.equal(sat.sides.length, 6);
const three = E.create({ format: 'double', play: 'doubles', players: seven, oddPlayer: 'team-of-three' }, rng(2));
assert.equal(three.sitOut.length, 0, 'nobody sits out');
const trio = three.sides.filter(function (side) { return side.members.length === 3; });
assert.equal(trio.length, 1, 'one team of three');
assert.equal(trio[0].rating, Math.round(trio[0].members.reduce(function (sum, id) { return sum + three.ratings[id]; }, 0) / 3), 'rated by the average of all three');
const threeView = (function () {
  const res = {};
  for (;;) {
    const v = E.resolve(three, res);
    if (v.finished) return v;
    const m = E.callOrder(v)[0];
    res[m.id] = { winnerId: m.players[0], games: [2, 0] };
  }
}());
const trioResults = E.playerResults(three, threeView);
trio[0].members.forEach(function (id) { assert.equal(trioResults[id].change, 8 * (trioResults[id].wins - trioResults[id].losses), 'all three share each result'); });
// The rotation: the player who sat out comes in for the one on longest; nobody sits out twice in a row.
assert.deepEqual(E.teamOfThreeOrder(['a', 'b'], ['a', 'b', 'c'], 5), [['a', 'b'], ['b', 'c'], ['c', 'a'], ['a', 'b'], ['b', 'c']]);
assert.deepEqual(E.teamOfThreeOrder(['c', 'a'], ['a', 'b', 'c'], 3), [['c', 'a'], ['a', 'b'], ['b', 'c']]);

// Doubles head starts use the average of each team's ratings; memory follows the same team.
const pairs = E.create({ format: 'double', play: 'doubles', players: [{ id: 'a', rating: 2000 }, { id: 'b', rating: 1000 }, { id: 'c', rating: 1500 }, { id: 'd', rating: 1300 }, { id: 'f', rating: 900 }, { id: 'g', rating: 800 }, { id: 'h', rating: 700 }, { id: 'i', rating: 600 }] }, rng(3));
const [t1, t2] = pairs.sides;
const gap = Math.abs(t1.rating - t2.rating);
assert.equal(E.headStart(pairs, t1.id, t2.id).base, Math.min(8, Math.floor(gap / 40)));
assert.equal(E.teamId(['b', 'a']), 'a+b');
assert.equal(E.teamRating(['a', 'b'], { a: 1001, b: 1000 }), 1001, 'rounded to a whole point');
// A forfeit moves nothing, for either partner.
const firstMatch = E.resolve(pairs, {}).matches.find(function (m) { return m.status === 'ready'; });
const forfeited = E.playerResults(pairs, E.resolve(pairs, { [firstMatch.id]: { winnerId: firstMatch.players[0], forfeitedBy: firstMatch.players[1] } }));
assert.ok(Object.keys(forfeited).every(function (id) { return forfeited[id].change === 0; }));
assert.equal(forfeited[pairs.sideById[firstMatch.players[0]].members[1]].wins, 1, 'but it is still a win');
// The estimate grows with the replay and RR -> Finals is shorter than Double Elimination.
const sixteenSingles = E.create({ format: 'double', play: 'singles', players: pool.slice(0, 16) }, rng(5));
assert.ok(E.estimate(sixteenSingles).minutes < E.estimate(sixteenSingles, { replayPlayed: true }).minutes);
assert.ok(E.estimate(E.create({ format: 'groups', play: 'singles', players: pool.slice(0, 16) }, rng(5))).minutes < E.estimate(sixteenSingles).minutes);
assert.throws(function () { E.create({ format: 'groups', play: 'doubles', players: pool.slice(0, 10) }, rng(1)); }, /at least 12/);

console.log('Equalizer checks passed:', events, 'simulated brackets,', combos, 'simulated events');
