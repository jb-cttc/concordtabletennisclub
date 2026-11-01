'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { matchesCoach, hasCoachingLevel, readCoaches, applyStatuses, ACTIVE, PENDING } = require('./check-usatt-coaches');

// Name matching: family name plus a given name or nickname, either order.
assert.ok(matchesCoach('Dominic Chan', 'Dominic Chan'));
assert.ok(matchesCoach('Tom (Xiaoyun) Zeng', 'Zeng Xiaoyun'));
assert.ok(matchesCoach('Tom (Xiaoyun) Zeng', 'Tom Zeng'));
assert.ok(matchesCoach('Fuqun (Bill) Xing', 'Bill Xing'));
assert.ok(!matchesCoach('Dominic Chan', 'CHANGHONG NI'), 'a name that merely contains the letters is not a match');
assert.ok(!matchesCoach('Dominic Chan', 'Wendy Chan'), 'family name alone is not enough');
assert.ok(!matchesCoach('Xin Huang', 'Ray Huang'));
assert.ok(!matchesCoach('Xin Huang', 'Xin Zhou'));
assert.ok(!matchesCoach('Raymond Trinh', 'Ray Huang'));

assert.ok(hasCoachingLevel(['Coaching Level 1']));
assert.ok(!hasCoachingLevel([]) && !hasCoachingLevel(undefined) && !hasCoachingLevel(['Referee']));

// Table rebuild: only Active coaches plus the showWhilePending exceptions are shown;
// hidden coaches stay in data and come back in their old place once certified.
const page = fs.readFileSync(path.join(__dirname, '..', 'coaching.html'), 'utf8');
const A = { status: ACTIVE, level: 'Coaching Level 1' };
const P = { status: PENDING, level: null };
const table = '<table><thead><tr><th>Coach</th><th>Contact</th><th>USATT</th></tr></thead><tbody>\n' +
  ['Ann One', 'Bo Two', 'Cy Three', 'Di Four'].map(function (n) {
    return '      <tr>\n        <td>' + n + '</td>\n        <td><a href="mailto:' + n[0] + '@x.org">' + n[0] + '@x.org</a></td>\n      </tr>';
  }).join('\n') + '\n    </tbody></table>';
const data0 = { showWhilePending: ['Di Four'] };
const first = applyStatuses(table, data0, { 'Ann One': A, 'Bo Two': P, 'Cy Three': A, 'Di Four': P });
assert.deepEqual(readCoaches(first.html), ['Ann One', 'Cy Three', 'Di Four'], 'Pending coach hidden, exception kept');
assert.equal(first.data.coaches['Bo Two'].hidden, true);
assert.equal(first.data.coaches['Bo Two'].contact, '<a href="mailto:B@x.org">B@x.org</a>');
assert.equal(first.data.coaches['Di Four'].hidden, undefined);
assert.deepEqual(Object.keys(first.data.coaches), ['Ann One', 'Bo Two', 'Cy Three', 'Di Four'], 'data keeps the hidden coach in order');
assert.deepEqual(first.data.showWhilePending, ['Di Four']);

const again = applyStatuses(first.html, first.data, { 'Ann One': A, 'Bo Two': P, 'Cy Three': A, 'Di Four': P });
assert.equal(again.html, first.html, 'running twice changes nothing');
assert.deepEqual(again.data, first.data);

const back = applyStatuses(first.html, first.data, { 'Ann One': A, 'Bo Two': A, 'Cy Three': A, 'Di Four': A });
assert.deepEqual(readCoaches(back.html), ['Ann One', 'Bo Two', 'Cy Three', 'Di Four'], 'certified coach returns in place');
assert.ok(back.html.includes('<td><a href="mailto:B@x.org">B@x.org</a></td>\n        <td class="usatt-status" data-usatt="active">'));
assert.equal(back.data.coaches['Bo Two'].hidden, undefined);
assert.equal(back.data.coaches['Bo Two'].contact, undefined);
assert.deepEqual(back.data.showWhilePending, [], 'exception ends once certified');
assert.equal((back.html.match(/data-usatt="active"/g) || []).length, 4);
assert.equal((back.html.match(/<th>USATT<\/th>/g) || []).length, 1);

const lapsed = applyStatuses(back.html, back.data, { 'Ann One': A, 'Bo Two': A, 'Cy Three': A, 'Di Four': P });
assert.deepEqual(readCoaches(lapsed.html), ['Ann One', 'Bo Two', 'Cy Three'], 'a later lapse hides like anyone else');

const deleted = applyStatuses(table.replace(/\s*<tr>\s*<td>Cy Three[\s\S]*?<\/tr>/, ''), first.data, { 'Ann One': A, 'Bo Two': P, 'Di Four': P });
assert.ok(!('Cy Three' in deleted.data.coaches), 'a visible coach deleted from the page is dropped for good');

// The live page: every coach shown is Active except the showWhilePending exceptions.
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'coach-certifications.json'), 'utf8'));
readCoaches(page).forEach(function (name) {
  const r = data.coaches[name];
  assert.ok(r && !r.hidden, name + ' is on the page and in data');
  assert.ok(r.status === ACTIVE || data.showWhilePending.indexOf(name) >= 0, name + ' is shown only if Active or excepted');
});
Object.keys(data.coaches).filter(function (n) { return data.coaches[n].hidden; }).forEach(function (name) {
  assert.ok(!readCoaches(page).includes(name) && data.coaches[name].contact, name + ' is hidden with a stored contact');
});

console.log('coach certification checks passed');
