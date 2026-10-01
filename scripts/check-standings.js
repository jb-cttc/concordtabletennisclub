const assert = require('node:assert/strict');
const { sortByGroupResult, describeWinner, forfeitCount, forfeitNote, tally } = require('../standings');
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
assert.equal(describeWinner(findGroup('2026-09-28', 'Group 4').players).text, 'Tie-breaker: Samia Bendi beat Iman Mukherjee 3-2 head-to-head');
const group5 = sortByGroupResult(findGroup('2026-09-28', 'Group 5').players);
assert.equal(group5[0].name, 'Creig Murtha', '4-2 (10 pts) beats 4-1 plus a double forfeit (9 pts)');
assert.deepEqual(names(group5).slice(-2), ['Shiva Shadloo', 'William Craig Jr'], 'a played loss scores 1, so 0-6 (6 pts) beats 1-3 plus two double forfeits (5 pts)');
const group6 = sortByGroupResult(findGroup('2026-09-28', 'Group 6').players);
assert.deepEqual(names(group6).slice(0, 2), ['Peggy Alden', 'Amin Hasan'], 'Peggy: 5 wins and a loss (11 pts) beats Amin: 5 wins and a double forfeit (10 pts)');
assert.equal(describeWinner(findGroup('2026-09-28', 'Group 6').players).text,
  'Tie-breaker: Peggy Alden highest USATT match-point total, 11 pts (5 wins, 1 loss)');
assert.equal(describeWinner(findGroup('2026-09-28', 'Group 2').players).text, 'Tie-breaker: Yaroslav Shneikin beat Victor Lee 3-2 head-to-head');
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
assert.match(describeWinner(cycle).text, /^Tie-breaker: 3-way tie on matches, best games ratio among the tied$/);

// 9/30 Group 2: Ernie, Bob and Li all had 8 match points and each won 4 and lost 4 games in the matches among the
// three, so the note must not claim the highest total, and names no players or ratings.
const ernie = findGroup('2026-09-30', 'Group 2').players;
assert.equal(describeWinner(ernie).text, 'Tie-breaker: 3-way tie on matches and games ratio, lowest pre-match rating wins');
assert.doesNotMatch(describeWinner(ernie).text, /highest/);

// Forfeit note: only the player who forfeited is named; double forfeits and clean groups get no note.
assert.equal(forfeitNote(ernie).text, 'Son Lu forfeit 2 matches');
assert.equal(forfeitCount(ernie.find(player => player.name === 'Son Lu')), 2);
assert.equal(forfeitCount(ernie.find(player => player.name === 'Bob Zandipour')), 0, 'the player who won by forfeit is not marked');
assert.equal(forfeitNote(findGroup('2026-09-28', 'Group 4').players).text, 'Enver Sedolli forfeit 3 matches');
assert.equal(forfeitNote(findGroup('2026-09-28', 'Group 5').players), null, 'double forfeits are not noted');
assert.equal(forfeitNote(findGroup('2026-09-28', 'Group 1').players), null);

// Three-way tie with equal game ratios: the lowest pre-session rating wins.
const even = group([['A', 1500], ['B', 1400], ['C', 1300]], [['A', 'B', 3, 2], ['B', 'C', 3, 2], ['C', 'A', 3, 2]]);
assert.deepEqual(names(sortByGroupResult(even)), ['C', 'B', 'A']);
assert.equal(describeWinner(even).text, 'Tie-breaker: 3-way tie on matches and games ratio, lowest pre-match rating wins');

// Only the players actually level at the top count as the tie; the tied player behind them was separated by games ratio.
const partlyLevel = group([['A', 1500], ['B', 1400], ['C', 1300], ['D', 1200], ['E', 1100]], [
  ['B', 'A', 3, 0], ['A', 'C', 3, 0], ['D', 'A', 3, 1], ['E', 'A', 3, 1], ['B', 'C', 3, 0],
  ['D', 'B', 0, 0, 'both'], ['B', 'E', 3, 0], ['D', 'C', 3, 1], ['E', 'C', 3, 0], ['D', 'E', 3, 0]
]);
assert.equal(describeWinner(partlyLevel).text, 'Tie-breaker: 2-way tie on matches and games ratio, lowest pre-match rating wins');

// Two-way tie decided by a forfeit: the forfeit winner wins the head-to-head even though the rating is higher.
const byForfeit = group([['A', 1500], ['B', 1400], ['C', 1300], ['D', 1200]], [
  ['A', 'B', 0, 0, 'B'], ['A', 'C', 3, 0], ['A', 'D', 0, 0, 'both'],
  ['B', 'C', 3, 0], ['B', 'D', 3, 0], ['C', 'D', 0, 0, 'both']
]);
assert.equal(tally(byForfeit[1]).points, 4, 'a forfeit loss scores 0, not 1');
assert.deepEqual(names(sortByGroupResult(byForfeit)).slice(0, 2), ['A', 'B']);
assert.equal(describeWinner(byForfeit).text, 'Tie-breaker: A beat B by forfeit');

// Two players forfeit: one note lists both, in table order, with singular and plural.
const twoForfeiters = group([['A', 1500], ['B', 1400], ['C', 1300], ['D', 1200]], [
  ['C', 'A', 0, 0, 'A'], ['D', 'A', 0, 0, 'A'], ['C', 'B', 0, 0, 'B'], ['A', 'B', 3, 0], ['C', 'D', 3, 1], ['B', 'D', 3, 0]
]);
assert.equal(forfeitNote(twoForfeiters).text, 'B forfeit 1 match; A forfeit 2 matches');

// Two players who never played each other: the lower rating wins.
const neverMet = group([['X', 1200], ['Y', 1100], ['Z', 1000]], [['X', 'Z', 0, 0, 'Z'], ['Y', 'Z', 0, 0, 'Z'], ['X', 'Y', 0, 0, 'both']]);
assert.deepEqual(names(sortByGroupResult(neverMet)).slice(0, 2), ['Y', 'X']);
assert.equal(describeWinner(neverMet).text, 'Tie-breaker: no head-to-head, lowest pre-match rating wins');

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
