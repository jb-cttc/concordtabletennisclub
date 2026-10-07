'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { matchesCoach, hasCoachingLevel, readCoaches, rewriteTable, ACTIVE, PENDING } = require('./check-usatt-coaches');

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

// Page rewrite is idempotent and only touches known coaches.
const page = fs.readFileSync(path.join(__dirname, '..', 'coaching.html'), 'utf8');
const coaches = readCoaches(page);
assert.equal(coaches.length, 6);
const statuses = Object.fromEntries(coaches.map(c => [c, c === 'Dominic Chan' ? ACTIVE : PENDING]));
const once = rewriteTable(page, statuses);
assert.equal(rewriteTable(once, statuses), once, 'running twice changes nothing');
assert.equal((once.match(/data-usatt="active"/g) || []).length, 1);
assert.equal((once.match(/data-usatt="pending"/g) || []).length, 5);
assert.equal((once.match(/<th>USATT<\/th>/g) || []).length, 1);
const flipped = rewriteTable(once, Object.assign({}, statuses, { 'Xin Huang': ACTIVE }));
assert.equal((flipped.match(/data-usatt="active"/g) || []).length, 2, 'a coach appearing later flips to Active');

console.log('coach certification checks passed');
