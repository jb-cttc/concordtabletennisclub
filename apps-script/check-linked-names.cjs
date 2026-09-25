const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const names = ['Morgan Vale', 'Riley Vale', 'Jordan Reyes', 'Jordan Reyes Jr', 'Priya Nair', 'Arjun Nair', 'Tomas Novak', 'Eli Novak', 'Mei Tan', 'Linda Tan', 'A. Chen', 'Alex Chen', 'Sky Ortiz'];
let players = names.map((name, index) => ({ playerId: String(index), name }));
const nameLinks = [
  { kind: 'same_person', name: 'Mei Tan', linked_name: 'May Tan' },
  { kind: 'junior', name: 'Riley Vale', linked_name: 'Morgan Vale' },
  { kind: 'junior', name: 'Jordan Reyes Jr', linked_name: 'Jordan Reyes' },
  { kind: 'junior', name: 'Arjun Nair', linked_name: 'Priya Nair' },
  { kind: 'junior', name: 'Eli Novak', linked_name: 'Tomas Novak' },
  { kind: 'junior', name: 'Sky Ortiz', linked_name: '' },
  { kind: '', name: '', linked_name: '' }
];
const context = {
  TABLES: {},
  SpreadsheetApp: { getActive: () => ({ getSheetByName: () => ({}) }) },
  rows_: () => nameLinks.map((row, index) => ({ ...row, __row: index + 2 })),
  listPlayers: () => players,
  getMembershipDues2026: () => ({ 10: {} }),
  getZeffyPlayers: () => []
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/LinkedNames.js', 'utf8'), context);

const review = JSON.parse(JSON.stringify(context.getLinkedNameReview()));
assert.deepEqual(review.confirmed, [], 'a link needs both names in the directory');
assert.deepEqual(review.juniors.map(l => l.junior.name + '->' + l.member.name), ['Riley Vale->Morgan Vale', 'Jordan Reyes Jr->Jordan Reyes', 'Arjun Nair->Priya Nair', 'Eli Novak->Tomas Novak']);
assert.deepEqual(context.standaloneJuniors_(players).map(p => p.name), ['Sky Ortiz'], 'a junior row without a member is a standalone junior');
assert.deepEqual(review.unresolved.map(u => u.names.join('/')), ['Mei Tan/May Tan']);
assert.deepEqual(review.candidates.map(c => c.left.name + '/' + c.right.name), ['A. Chen/Alex Chen']);
assert.equal(context.linkedNameCandidate_('Mei Tan', 'Linda Tan'), false);

players = players.concat([{ playerId: 'dup', name: 'Jordan Reyes' }]);
assert.equal(context.juniorLinks_(players).length, 3, 'an ambiguous member name never links a junior');

nameLinks.push({ kind: 'parent', name: 'X', linked_name: 'Y' });
assert.throws(() => context.juniorLinks_(players), /unknown kind "parent"/);
console.log('Linked-name checks passed');
