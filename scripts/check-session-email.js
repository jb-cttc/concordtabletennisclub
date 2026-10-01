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
  assert.ok(email.text.includes(group.name + ': ' + winner.name + (described ? '\u2020' : '') + ' ('), group.name + ' winner in the text email');
  assert.ok(email.html.includes(escapeHtml(winner.name) + (described ? '\u2020' : '') + '</td>'), group.name + ' winner in the HTML email');
  if (described) {
    notes += 1;
    assert.ok(email.text.includes('\u2020 ' + described.text), group.name + ' note in the text email');
    assert.ok(email.html.includes('\u2020 ' + escapeHtml(described.text)), group.name + ' note in the HTML email');
  }
}
assert.ok(notes >= 3, 'the regression session has several groups whose winner needed a tie-breaker note');

// A group with a clear winner gets neither a dagger nor a note.
const clear = session.groups.find(group => !describeWinner(group.players));
assert.ok(clear, 'the regression session has a group with a clear winner');
const clearWinner = sortByGroupResult(clear.players)[0].name;
assert.ok(!email.text.includes(clearWinner + '\u2020'));

// Every results email says how to stop. The copy published for the sign-up app leaves that to the welcome email.
const { UNSUBSCRIBE_URL } = require('./build-session-email');
assert.equal(UNSUBSCRIBE_URL, 'https://concordtabletennisclub.com/unsubscribe.html');
assert.ok(email.html.includes('href="' + UNSUBSCRIBE_URL + '"'), 'unsubscribe link in the HTML email');
assert.ok(email.text.includes('Unsubscribe: ' + UNSUBSCRIBE_URL), 'unsubscribe link in the text email');
const bare = buildSessionEmail('2026-09-28', { footer: false });
assert.ok(!bare.html.includes('nsubscribe') && !bare.text.includes('nsubscribe'));
const { buildLatestEmail } = require('./build-latest-email');
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'latest-session-email.json'), 'utf8')), buildLatestEmail(),
  'data/latest-session-email.json is out of date; run npm run build:latest-email');

console.log('Session email checks passed: winners and ' + notes + ' notes match the site');
