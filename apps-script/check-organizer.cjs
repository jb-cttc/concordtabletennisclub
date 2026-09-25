const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { window: {} };
vm.createContext(context);
const html = fs.readFileSync(path.join(__dirname, 'Organizer.html'), 'utf8');
vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'RatingEngine.js'), 'utf8'), context);
const O = context.window.CTTCOrganizer;
const plain = value => JSON.parse(JSON.stringify(value));

const people = {};
const player = id => people[id];
function roster(count) {
  return Array.from({ length: count }, (_, i) => {
    const id = 'p' + (i + 1);
    people[id] = { name: 'Player ' + String(i + 1).padStart(2, '0'), currentRating: 2000 - i * 10 };
    return id;
  });
}

assert.deepEqual(plain(O.sizeGroups(27)), [6, 6, 5, 5, 5]);
assert.deepEqual(plain(O.sizeGroups(12)), [6, 6]);
assert.deepEqual(plain(O.sizeGroups(7)), [4, 3]);
const ids = roster(17);
assert.deepEqual(plain(O.organize(ids, player).map(g => g.length)), [6, 6, 5]);

let groups = O.organize(ids, player);
const promotions = O.applyPromotions(groups, [
  { playerId: 'p10', groupNumber: 2, groupName: 'Group 2', date: '2026-09-21' },
  { playerId: 'p17', groupNumber: 3, groupName: 'Group 3', date: '2026-09-21' },
  { playerId: 'p2', groupNumber: 1, groupName: 'Group 1', date: '2026-09-21' }
], player);
assert.ok(groups[0].includes('p10'), 'group 2 winner moves up to group 1');
assert.ok(groups[1].includes('p17'), 'group 3 winner moves up to group 2');
assert.ok(groups[1].includes('p6'), 'lowest non-winner of group 1 swaps down');
assert.ok(groups[0].includes('p2'), 'group 1 winners stay');
assert.deepEqual(plain(promotions.p10), { fromGroup: 2, toGroup: 1, wonGroup: 'Group 2', date: '2026-09-21' });
assert.equal(promotions.p2, undefined);
assert.equal(groups[0].indexOf('p10'), 5, 'groups stay sorted by rating after a swap');

groups = O.organize(ids, player);
O.applyPromotions(groups, [{ playerId: 'p3', groupNumber: 3, groupName: 'Group 3', date: 'x' }], player);
assert.ok(groups[0].includes('p3'), 'a winner already rated above the target group is left alone');

groups = [['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], ['p7', 'p8', 'p9', 'p10', 'p11', 'p12']];
people.late = { name: 'Late Arrival', currentRating: 1995 };
O.insert(groups, 'late', ids.slice(0, 12).concat('late'), player);
assert.deepEqual(plain(groups.map(g => g.length)), [6, 6, 1], 'overflow cascades down without reshuffling');
assert.equal(groups[0][1], 'late');
assert.equal(groups[2][0], 'p12');

groups = [['p1', 'p2', 'p3', 'p4', 'p5', 'p10'], ['p6', 'p7', 'p8', 'p9', 'p11', 'p12']];
O.insert(groups, 'late', ids.slice(0, 12).concat('late'), player, { p10: {} });
assert.ok(groups[0].includes('p10'), 'a promoted player is not bumped by a late arrival');
assert.ok(groups[1].includes('p5'), 'the lowest non-promoted player moves down instead');

const six = roster(6);
const pairs = O.roundRobinPairs(six);
assert.equal(pairs.length, 15);
assert.equal(new Set(pairs.map(p => p.slice().sort().join())).size, 15, 'every pair plays exactly once');
assert.deepEqual(plain(pairs.slice(0, 3).map(p => p.join('-'))), ['p1-p6', 'p2-p5', 'p3-p4'], 'first round uses three tables');
assert.equal(O.roundRobinPairs(roster(5)).length, 10);

assert.equal(O.matchState({ playerOneGames: null, playerTwoGames: null }), 'pending');
assert.equal(O.matchState({}), 'pending', 'blank scores from google.script.run arrive as undefined');
assert.equal(O.matchState({ playerOneGames: 3, playerTwoGames: null }), 'incomplete');
assert.equal(O.matchState({ playerOneGames: 3, playerTwoGames: 3 }), 'invalid');
assert.equal(O.matchState({ playerOneGames: 2, playerTwoGames: 1 }), 'invalid');
assert.equal(O.matchState({ playerOneGames: 1, playerTwoGames: 3 }), 'complete');

people.a = { name: 'Ava', currentRating: 1400 };
people.b = { name: 'Ben', currentRating: 1300 };
people.c = { name: 'Cy', currentRating: 1350 };
const m = (one, two, g1, g2, forfeit) => ({ playerOneId: one, playerTwoId: two, playerOneGames: g1, playerTwoGames: g2, forfeit: !!forfeit });
let table = O.standings(['a', 'b', 'c'], [m('a', 'b', 3, 1), m('b', 'c', 3, 0), m('a', 'c', 0, 3)], player, O.ratingAdjustment);
assert.deepEqual(plain(table.rows.map(r => r.name)), ['Ben', 'Cy', 'Ava'], 'three-way 1-1 tie goes to the lowest starting rating');
assert.equal(table.finished, true);
assert.equal(table.rows.find(r => r.name === 'Ava').gamesWon, 3);
table = O.standings(['a', 'b'], [m('a', 'b', 3, 0, true)], player, O.ratingAdjustment);
assert.equal(table.rows[0].adjustment, 0, 'forfeits carry no rating change');
table = O.standings(['a', 'b'], [m('a', 'b', 0, 3)], player, O.ratingAdjustment);
assert.deepEqual(plain(table.rows.map(r => [r.name, r.projected])), [['Ben', 1320], ['Ava', 1380]], 'a 100-point upset is worth 20');
assert.equal(O.standings(['a', 'b'], [m('a', 'b', 3, null)], player, O.ratingAdjustment).finished, false);
table = O.standings(['a', 'b', 'c'], [m('a', 'b', 0, 3)], player, O.ratingAdjustment);
assert.deepEqual(plain(table.rows.map(r => r.name)), ['Ben', 'Cy', 'Ava'], 'mid-session: unplayed players sit above players with losses');

for (let gap = -400; gap <= 400; gap += 1) {
  assert.equal(O.ratingAdjustment(1500 + gap, 1500, false), context.ratingAdjustment_(1500 + gap, 1500, false), 'gap ' + gap);
}

const { sortByGroupResult } = require('../standings');
const sessions = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'session-details-2026.json'), 'utf8'));
let compared = 0;
sessions.forEach(session => session.groups.forEach(group => {
  if (!group.players.some(p => Number.isInteger(p.wins))) return;
  assert.equal(O.publishedWinner(group.players), sortByGroupResult(group.players)[0].name, session.date + ' ' + group.name);
  compared += 1;
}));
assert.ok(compared > 100, 'checked real 2026 groups');

assert.equal(O.previousSameWeekday(['2026-09-14', '2026-09-16', '2026-09-21'], '2026-09-23'), '2026-09-16');
assert.equal(O.previousSameWeekday(['2026-09-16'], '2026-09-21'), null);
assert.equal(O.sheetAdjustment(1400, 1405), '8/8');
assert.equal(O.sheetAdjustment(1400, 1600), '1/40');
console.log('Organizer checks passed (' + compared + ' real groups cross-checked)');
