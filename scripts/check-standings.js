const assert = require('node:assert/strict');
const { sortByGroupResult } = require('../standings');
const sessions = require('../data/session-details-2026.json');

const september14 = sessions.find(function (session) { return session.date === '2026-09-14'; });
const groupTwo = september14.groups.find(function (group) { return group.name === 'Group 2'; });
const originalNames = groupTwo.players.map(function (player) { return player.name; });
const ordered = sortByGroupResult(groupTwo.players);

assert.deepEqual(ordered.slice(0, 2).map(function (player) { return player.ratingBefore; }), [1392, 1436], 'published 9/14 Group 2 winner and runner-up');
assert.deepEqual(groupTwo.players.map(function (player) { return player.name; }), originalNames);

assert.deepEqual(sortByGroupResult([
  { name: 'Three wins', wins: 3, losses: 1, ratingBefore: 800, ratingAfter: 1200 },
  { name: 'Perfect', wins: 2, losses: 0, ratingBefore: 900, ratingAfter: 1000 }
]).map(function (player) { return player.name; }), ['Perfect', 'Three wins']);

assert.deepEqual(sortByGroupResult([
  { name: 'High', wins: 4, losses: 1, ratingBefore: 1500, ratingAfter: 1550 },
  { name: 'Low', wins: 4, losses: 1, ratingBefore: 1100, ratingAfter: 1200 },
  { name: 'Middle', wins: 4, losses: 1, ratingBefore: 1300, ratingAfter: 1600 }
]).map(function (player) { return player.name; }), ['Low', 'Middle', 'High']);

assert.deepEqual(sortByGroupResult([
  { name: 'Zed', wins: 3, losses: 2, ratingBefore: 1000, ratingAfter: 1100 },
  { name: 'Amy', wins: 3, losses: 2, ratingBefore: 1000, ratingAfter: 900 }
]).map(function (player) { return player.name; }), ['Amy', 'Zed']);

const august24 = sessions.find(function (session) { return session.date === '2026-08-24'; });
const groupSix = august24.groups.find(function (group) { return group.name === 'Group 6'; });
const groupSixOrder = sortByGroupResult(groupSix.players);
assert.deepEqual([groupSixOrder[0].wins, groupSixOrder[0].losses], [5, 0], 'a 5-0 player beats a withdrawn 0-0 player');
assert.deepEqual([groupSixOrder.at(-1).wins, groupSixOrder.at(-1).losses], [0, 0]);

console.log('Standings checks passed: historical winner, record ratio, three-way tie, stable fallback');