// The session email must show the same group winners and tie-breaker notes as the Round Robins page.
// Both come from standings.js, so this compares the email with that shared code instead of fixed wording:
// change the rules or the wording there and the email follows, and this check still passes.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSessionEmail } = require('./build-session-email');
const { sortByGroupResult, describeWinner } = require('../standings');

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const session = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'session-details-2026.json'), 'utf8'))
  .find(entry => entry.date === '2026-09-28');
assert.ok(session, '2026-09-28 is the regression session');

const email = buildSessionEmail('2026-09-28');
let notes = 0;
for (const group of session.groups) {
  const winner = sortByGroupResult(group.players)[0];
  const described = describeWinner(group.players);
  assert.ok(email.text.includes(group.name + ': ' + winner.name + (described ? '*' : '') + ' ('), group.name + ' winner in the text email');
  assert.ok(email.html.includes(escapeHtml(winner.name) + (described ? '*' : '') + '</td>'), group.name + ' winner in the HTML email');
  if (described) {
    notes += 1;
    assert.ok(email.text.includes('* ' + described.text), group.name + ' note in the text email');
    assert.ok(email.html.includes('* ' + escapeHtml(described.text)), group.name + ' note in the HTML email');
  }
}
assert.ok(notes >= 3, 'the regression session has several groups whose winner needed a tie-breaker note');

// A group with a clear winner gets neither an asterisk nor a note.
const clear = session.groups.find(group => !describeWinner(group.players));
assert.ok(clear, 'the regression session has a group with a clear winner');
const clearWinner = sortByGroupResult(clear.players)[0].name;
assert.ok(!email.text.includes(clearWinner + '*'));

console.log('Session email checks passed: winners and ' + notes + ' notes match the site');
