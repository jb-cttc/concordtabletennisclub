const assert = require('node:assert/strict');
const { sortByGroupResult, describeWinner, tally } = require('../standings');
const sessions = require('../data/session-details-2026.json');

const names = players => players.map(player => player.name);
const findGroup = (date, name) => sessions.find(session => session.date === date).groups.find(group => group.name === name);

// Real groups.
const september14 = findGroup('2026-09-14', 'Group 2');
const originalNames = names(september14.players);
assert.deepEqual(sortByGroupResult(september14.players).slice(0, 2).map(player => player.ratingBefore), [1392, 1436], 'published 9/14 Group 2 winner and runner-up');
assert.deepEqual(names(september14.players), originalNames, 'the input is not reordered');

const august24 = findGroup('2026-08-24', 'Group 6');
const august24Order = sortByGroupResult(august24.players);
assert.deepEqual([august24Order[0].wins, august24Order[0].losses], [5, 0], 'a 5-0 player beats a withdrawn 0-0 player');
assert.deepEqual([august24Order.at(-1).wins, august24Order.at(-1).losses], [0, 0]);

// 9/28: Group 4 has Sedolli's three forfeits (wins for his opponents); Groups 5 and 6 have double forfeits.
const group4 = sortByGroupResult(findGroup('2026-09-28', 'Group 4').players);
assert.deepEqual(names(group4).slice(0, 3), ['Samia Bendi', 'Iman Mukherjee', 'Ryan Beavers'], 'win by forfeit counts as a win: 4-1 beats 3-2');
assert.equal(group4.at(-1).name, 'Enver Sedolli');
assert.equal(describeWinner(findGroup('2026-09-28', 'Group 4').players).text, 'Tie-Breaker: Samia Bendi beat Iman Mukherjee 3-2 head-to-head');
const group5 = sortByGroupResult(findGroup('2026-09-28', 'Group 5').players);
assert.equal(group5[0].name, 'Creig Murtha', '4-2 (10 pts) beats 4-1 plus a double forfeit (9 pts)');
assert.deepEqual(names(group5).slice(-2), ['Shiva Shadloo', 'William Craig Jr'], 'a played loss scores 1, so 0-6 (6 pts) beats 1-3 plus two double forfeits (5 pts)');
const group6 = sortByGroupResult(findGroup('2026-09-28', 'Group 6').players);
assert.deepEqual(names(group6).slice(0, 2), ['Peggy Alden', 'Amin Hasan'], 'Peggy: 5 wins and a loss (11 pts) beats Amin: 5 wins and a double forfeit (10 pts)');
assert.equal(describeWinner(findGroup('2026-09-28', 'Group 6').players).text,
  'Peggy Alden 11 pts (5 wins, 1 loss) vs Amin Hasan 10 pts (5 wins)');
assert.equal(describeWinner(findGroup('2026-09-28', 'Group 2').players).text, 'Tie-Breaker: Yaroslav Shneikin beat Victor Lee 3-2 head-to-head');
assert.equal(describeWinner(findGroup('2026-09-28', 'Group 1').players), null, 'no note when the winner was clear');

// Builds a group from results: [a, b, gamesA, gamesB, forfeitedBy?]
function group(definitions, results) {
  const players = definitions.map(([name, ratingBefore]) => ({ name, ratingBefore, matches: [] }));
  const get = name => players.find(player => player.name === name);
  results.forEach(([a, b, gamesA, gamesB, by]) => {
    const flags = by ? { forfeit: true, forfeitedBy: by } : {};
    get(a).matches.push({ opponent: b, gamesWon: gamesA, gamesLost: gamesB, ...flags });
    get(b).matches.push({ opponent: a, gamesWon: gamesB, gamesLost: gamesA, ...flags });
  });
  return players;
}

// Three-way tie: game ratio among the tied players beats rating.
const cycle = group([['A', 1500], ['B', 1400], ['C', 1300], ['D', 1200]], [
  ['A', 'B', 3, 2], ['C', 'A', 3, 1], ['B', 'C', 3, 0], ['A', 'D', 3, 0], ['B', 'D', 3, 0], ['C', 'D', 3, 0]
]);
assert.deepEqual(names(sortByGroupResult(cycle)), ['B', 'A', 'C', 'D']);
assert.match(describeWinner(cycle).text, /^Tie-Breaker: game ratio among the tied \(B 5\/3, A 4\/5, C 3\/4\)$/);

// Three-way tie with equal game ratios: the lowest pre-session rating wins.
const even = group([['A', 1500], ['B', 1400], ['C', 1300]], [['A', 'B', 3, 2], ['B', 'C', 3, 2], ['C', 'A', 3, 2]]);
assert.deepEqual(names(sortByGroupResult(even)), ['C', 'B', 'A']);
assert.match(describeWinner(even).text, /level .*lowest rating wins: C 1300$/);

// Two-way tie decided by a forfeit: the forfeit winner wins the head-to-head even though the rating is higher.
const byForfeit = group([['A', 1500], ['B', 1400], ['C', 1300], ['D', 1200]], [
  ['A', 'B', 0, 0, 'B'], ['A', 'C', 3, 0], ['A', 'D', 0, 0, 'both'],
  ['B', 'C', 3, 0], ['B', 'D', 3, 0], ['C', 'D', 0, 0, 'both']
]);
assert.equal(tally(byForfeit[1]).points, 4, 'a forfeit loss scores 0, not 1');
assert.deepEqual(names(sortByGroupResult(byForfeit)).slice(0, 2), ['A', 'B']);
assert.equal(describeWinner(byForfeit).text, 'Tie-Breaker: A beat B by forfeit');

// Two players who never played each other: the lower rating wins.
const neverMet = group([['X', 1200], ['Y', 1100], ['Z', 1000]], [['X', 'Z', 0, 0, 'Z'], ['Y', 'Z', 0, 0, 'Z'], ['X', 'Y', 0, 0, 'both']]);
assert.deepEqual(names(sortByGroupResult(neverMet)).slice(0, 2), ['Y', 'X']);
assert.match(describeWinner(neverMet).text, /no head-to-head, lower rating wins \(Y 1100 vs X 1200\)/);

// Records without match lists (summary-only reports and older tests) fall back to wins and losses.
assert.deepEqual(names(sortByGroupResult([
  { name: 'Three wins', wins: 3, losses: 1, ratingBefore: 800 },
  { name: 'Perfect', wins: 2, losses: 0, ratingBefore: 900 }
])), ['Three wins', 'Perfect'], '3-1 is 7 match points and 2-0 is 4');
assert.deepEqual(names(sortByGroupResult([
  { name: 'High', wins: 4, losses: 1, ratingBefore: 1500 },
  { name: 'Low', wins: 4, losses: 1, ratingBefore: 1100 },
  { name: 'Middle', wins: 4, losses: 1, ratingBefore: 1300 }
])), ['Low', 'Middle', 'High']);
assert.deepEqual(names(sortByGroupResult([
  { name: 'Zed', wins: 3, losses: 2, ratingBefore: 1000 },
  { name: 'Amy', wins: 3, losses: 2, ratingBefore: 1000 }
])), ['Amy', 'Zed']);
assert.deepEqual(names(sortByGroupResult([
  { name: 'Lower', wins: null, losses: null, matchesUnavailable: true, ratingAfter: 1300 },
  { name: 'Higher', wins: null, losses: null, matchesUnavailable: true, ratingAfter: 1500 }
])), ['Higher', 'Lower'], 'summary-only groups keep ordering by final rating');

// Recorded forfeit directions replace the scraped "F / F" pairs.
const { applyForfeitOverrides } = require('./lib/forfeit-overrides');
const scraped = () => [{ date: '2026-01-05', groups: [{ name: 'Group 1', players: [
  { name: 'P', wins: 1, losses: 0, ratingBefore: 1000, matches: [{ opponent: 'Q', gamesWon: 0, gamesLost: 0, adj: 0 }, { opponent: 'R', gamesWon: 3, gamesLost: 0, adj: 5 }] },
  { name: 'Q', wins: 0, losses: 1, ratingBefore: 1100, matches: [{ opponent: 'P', gamesWon: 0, gamesLost: 0, adj: 0 }, { opponent: 'R', gamesWon: 3, gamesLost: 1, adj: 5 }] },
  { name: 'R', wins: 0, losses: 2, ratingBefore: 900, matches: [{ opponent: 'P', gamesWon: 0, gamesLost: 3, adj: -5 }, { opponent: 'Q', gamesWon: 1, gamesLost: 3, adj: -5 }] }
] }] }];
const overridden = applyForfeitOverrides(scraped(), { '2026-01-05': { 'Group 1': [{ players: ['P', 'Q'], forfeitedBy: 'Q' }] } })[0].groups[0].players;
assert.deepEqual(overridden.map(player => [player.name, player.wins, player.losses]), [['P', 2, 0], ['Q', 1, 1], ['R', 0, 2]]);
assert.deepEqual(overridden[0].matches[0], { opponent: 'Q', gamesWon: 0, gamesLost: 0, adj: 0, forfeit: true, forfeitedBy: 'Q' });
assert.throws(() => applyForfeitOverrides(scraped(), { '2026-01-05': { 'Group 1': [{ players: ['P', 'R'], forfeitedBy: 'R' }] } }), /was played, not forfeited/);
assert.throws(() => applyForfeitOverrides(scraped(), { '2026-01-05': { 'Group 1': [{ players: ['P', 'Q'], forfeitedBy: 'R' }] } }), /forfeitedBy must be/);
assert.equal(applyForfeitOverrides(scraped(), { '2030-01-01': {} })[0].groups[0].players[0].wins, 1, 'sessions that are not posted yet are ignored');

// Every posted group: the winner has the most match points.
let groups = 0;
sessions.forEach(session => session.groups.forEach(g => {
  if (g.players.some(player => player.matchesUnavailable)) return;
  const ordered = sortByGroupResult(g.players);
  assert.equal(ordered.length, g.players.length);
  assert.equal(tally(ordered[0]).points, Math.max(...g.players.map(player => tally(player).points)), session.date + ' ' + g.name);
  groups += 1;
}));
assert.ok(groups > 300, 'checked real 2026 groups');

console.log('Standings checks passed: match points, forfeits, head-to-head, game-ratio ties, winner notes');
