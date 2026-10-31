'use strict';

// The Equalizer's shared rules (handicap.js, bracket.js). Made-up players only.
const assert = require('node:assert/strict');
const H = require('../handicap');
const B = require('../bracket');
const ratings = require('../rating-engine');

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
      const ready = B.callOrder(view);
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
  const match = B.callOrder(view)[0];
  results[match.id] = { winnerId: match.players[0] };
}
const shares = {};
Object.values(B.resolve(sixteen, results).places).forEach(function (p) { shares[p.place + '-' + p.to] = (shares[p.place + '-' + p.to] || 0) + 1; });
assert.deepEqual(shares, { '1-1': 1, '2-2': 1, '3-3': 1, '4-4': 1, '5-6': 2, '7-8': 2, '9-12': 4, '13-16': 4 });
// Best of: finals best of 5 by default, a replay best of 3.
assert.equal(sixteen.matches.find(function (m) { return m.id === 'W1-1'; }).bestOf, 3);
assert.equal(sixteen.matches.find(function (m) { return m.id === sixteen.mainFinal; }).bestOf, 5);
assert.equal(sixteen.matches.find(function (m) { return m.id === 'GF2'; }).bestOf, 3);
// The estimate grows with the field and the replay.
assert.ok(B.estimate(sixteen).minutes < B.estimate(sixteen, { replayPlayed: true }).minutes);

console.log('Equalizer checks passed:', events, 'simulated events');
