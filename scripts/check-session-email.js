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

// One message per subscriber, each with a link made for that address and nothing printed about anyone.
const crypto = require('node:crypto');
const { sendPersonalized, LINK_MARK } = require('./lib/personalized-send');
const { makeUnsubscribeToken } = require('./lib/unsubscribe-token');
const SECRET = 'mailing-test-secret-mailing-test-secret-mailing-test-secret';
const template = buildSessionEmail('2026-09-28', { unsubscribeUrl: LINK_MARK });
assert.ok(template.html.includes('href="' + LINK_MARK + '"') && template.text.includes('Unsubscribe: ' + LINK_MARK), 'the template carries the placeholder link');

function verify(token) {
  const [payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  assert.equal(signature, expected, 'the signature matches the shared secret');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

(async () => {
  const messages = [];
  const transport = {
    sendMail: async message => {
      if (message.to === 'bounce@example.com') throw Object.assign(new Error('550 no such user bounce@example.com'), { responseCode: 550 });
      messages.push(message);
    }
  };
  const now = Date.UTC(2026, 9, 1);
  const outcome = await sendPersonalized(transport, {
    from: 'Club <club@example.com>', subject: 'CTTC Results', template, secret: SECRET, unsubscribeUrl: UNSUBSCRIBE_URL, now,
    subscribers: ['One@Example.com', 'two@example.com', 'one@example.com ', 'bounce@example.com']
  });
  assert.deepEqual([outcome.sent, outcome.failed, outcome.failures], [2, 1, { 550: 1 }], 'duplicates are sent once and failures are counted by code');
  assert.ok(!JSON.stringify(outcome).includes('example.com'), 'the result never mentions an address');
  assert.deepEqual(messages.map(m => m.to), ['one@example.com', 'two@example.com'], 'each subscriber gets their own message');
  messages.forEach(message => {
    assert.ok(!message.html.includes(LINK_MARK) && !message.text.includes(LINK_MARK), 'no placeholder is left behind');
    const link = /https:\/\/concordtabletennisclub\.com\/unsubscribe\.html\?t=([A-Za-z0-9_.-]+)/.exec(message.text);
    assert.ok(link && message.html.includes('href="' + link[0] + '"'), 'the same personal link is in the text and HTML versions');
    assert.equal(message.headers['List-Unsubscribe'], '<' + link[0] + '>');
    assert.deepEqual(verify(link[1]), { e: message.to, p: 'unsubscribe', x: now + 365 * 24 * 60 * 60 * 1000 }, 'the token is for exactly this address');
  });
  assert.notEqual(messages[0].text, messages[1].text, 'the two messages differ only by their links');
  assert.equal(messages[0].text.split(/unsubscribe\.html\?t=[A-Za-z0-9_.-]+/).join(''), messages[1].text.split(/unsubscribe\.html\?t=[A-Za-z0-9_.-]+/).join(''));
  assert.equal(makeUnsubscribeToken('A@b.co', SECRET, now), makeUnsubscribeToken('a@B.CO'.toLowerCase(), SECRET, now));
  assert.throws(() => makeUnsubscribeToken('a@b.co', ''), /secret/);

  // Without a secret nobody is left without a way out: the plain page, where the address is typed in.
  messages.length = 0;
  await sendPersonalized(transport, { from: 'Club', subject: 's', template, unsubscribeUrl: UNSUBSCRIBE_URL, subscribers: ['three@example.com'] });
  assert.ok(messages[0].text.includes('Unsubscribe: ' + UNSUBSCRIBE_URL) && !messages[0].text.includes('?t='));
  assert.equal(messages[0].headers['List-Unsubscribe'], '<' + UNSUBSCRIBE_URL + '>');

  console.log('Session email checks passed: winners and ' + notes + ' notes match the site; personal unsubscribe links verified');
})().catch(error => { console.error(error); process.exit(1); });
