'use strict';

// The meeting mailer (sends only [DRAFT NOTES] emails, to at most 3 people, within the shared email allowance, never
// the same draft twice by accident) against a fake Google, and the draft email it sends (scripts/lib/meeting-email.js):
// the note to the secretary kept apart from the draft, everything escaped, follow-ups by owner. Synthetic names only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'appsscript.json'), 'utf8'));
assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/script.send_mail'], 'sending email, and nothing else');
assert.equal(manifest.webapp.access, 'MYSELF', 'only the club account can open it');
assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
assert.equal(fs.readFileSync(path.join(dir, '.claspignore'), 'utf8').trim(), 'check-*');
const code = fs.readFileSync(path.join(dir, 'Code.js'), 'utf8');
assert.doesNotMatch(code, /=>|`|^\s*(let|const|class)\s/m, 'ES5 style, like the other Apps Script projects');
assert.doesNotMatch(code, /GmailApp|SpreadsheetApp|UrlFetchApp|DriveApp|newTrigger/, 'no Gmail, Sheets, web calls, Drive or timers');
assert.deepEqual([...code.matchAll(/^function ([A-Za-z0-9_]+)\(/gm)].map(m => m[1]).filter(n => !n.endsWith('_')).sort(), ['doGet', 'sendDraftNotes', 'sentLog']);

// ---- The mailer against a fake Google ----
let clock = Date.parse('2026-11-22T18:00:00Z');
const sent = [];
let quota = 100;
const props = new Map();
const server = vm.createContext({
  Date: class extends Date { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return clock; } },
  JSON, Math,
  MailApp: { getRemainingDailyQuota: () => quota, sendEmail: message => { sent.push(message); quota -= message.to.split(',').length; } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.has(k) ? props.get(k) : null, setProperty: (k, v) => props.set(k, String(v)) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  HtmlService: { createHtmlOutput: html => ({ html, setTitle() { return this; } }) }
});
vm.runInContext(code, server);
const plain = v => JSON.parse(JSON.stringify(v));
const send = draft => plain(server.sendDraftNotes(draft));
const good = { to: ['Secretary@Example.org'], subject: '[DRAFT NOTES] CTTC Executive Committee Meeting – Saturday, November 21, 2026', html: '<p>Draft</p>', text: 'Draft', meetingId: 'm20261121abcd' };
assert.match(server.doGet().html, /id="ready"/, 'the page the script waits for');

const result = send(good);
assert.equal(result.sent, true);
assert.deepEqual(result.to, ['secretary@example.org']);
assert.equal(result.quotaLeft, 99);
assert.deepEqual(sent.map(m => [m.to, m.subject, m.htmlBody, m.body, m.name]), [['secretary@example.org', good.subject, '<p>Draft</p>', 'Draft', 'CTTC Executive Committee']]);
assert.equal(plain(server.sentLog())[0].meetingId, 'm20261121abcd', 'each send is logged');

assert.throws(() => send(good), /same draft went to the same people/, 'no accidental second send');
assert.equal(send(Object.assign({}, good, { resend: true })).sent, true, 'unless asked to resend');
clock += 31 * 60000;
assert.equal(send(good).sent, true, 'or after half an hour');
assert.throws(() => send(Object.assign({}, good, { subject: 'CTTC minutes' })), /must start with \[DRAFT NOTES\]/, 'draft notes only');
send(Object.assign({}, good, { subject: '[DRAFT NOTES] x\nBcc: someone@example.org' }));
assert.equal(sent[sent.length - 1].subject, '[DRAFT NOTES] x Bcc: someone@example.org', 'a line break in the subject becomes a space: it can never add a header');
assert.throws(() => send(Object.assign({}, good, { to: ['a@example.org', 'b@example.org', 'c@example.org', 'd@example.org'] })), /1 to 3 recipients/);
assert.throws(() => send(Object.assign({}, good, { to: ['not an address'] })), /not an email address/);
assert.throws(() => send(Object.assign({}, good, { to: ['a@example.org, b@example.org'] })), /not an email address/, 'one address per entry');
assert.throws(() => send(Object.assign({}, good, { text: '' })), /plain-text copy/);
const before = sent.length;
quota = 10;
assert.throws(() => send(Object.assign({}, good, { subject: '[DRAFT NOTES] another' })), /only 10 email recipients are left today/, 'the other apps keep their share of the allowance');
assert.equal(sent.length, before, 'nothing sent when refused');

// ---- The draft email ----
const email = require('../scripts/lib/meeting-email.js');
const meeting = {
  id: 'm20261121abcd', title: 'CTTC Executive Committee Meeting', date: '2026-11-21',
  attendees: [
    { name: 'Pat Example', role: 'President' }, { name: 'Sam Sample', role: 'Secretary' }, { name: 'Lee Placeholder', role: 'Board' },
    { name: 'Robin Guest', role: 'Guest' }, { name: 'Jordan Absent', role: 'Board', present: false }
  ],
  items: [
    { title: 'Closure dates', details: 'Nov 13, Friday\n   – Dec 4 & 5', status: 'done' },
    { title: 'Budget <script>alert(1)</script>', details: '', status: 'done' },
    { title: 'Communication methods', details: '', status: 'done', added: true }
  ]
};
const summary = {
  to: { name: 'Sam Sample', email: 'secretary@example.org' },
  note: ['I prepared these draft notes from the meeting app for you to use any or all of as you need.'],
  trackerUrl: 'https://concordtabletennisclub.com/meeting.html',
  intro: 'Thanks, everyone.',
  decisions: ['Keep the club open Dec 4 & 5', 'Fees stay the same <b>bold</b>'],
  agenda: [{ discussion: ['Open Dec 4 & 5'] }, { note: 'No decision recorded.' }],
  followUps: [
    { owner: 'Pat Example', text: 'Add pre-pay', topic: 'Budget' },
    { owner: 'Lee Placeholder', text: 'Buy nets', topic: 'Budget', due: 'Dec 15' },
    { owner: 'Pat Example', text: 'Train a backup', topic: 'Website' },
    { owner: '', text: 'Find a venue' }
  ],
  openQuestions: ['Open on Christmas Day?']
};
assert.equal(email.subject(meeting), '[DRAFT NOTES] CTTC Executive Committee Meeting – Saturday, November 21, 2026', 'the subject says DRAFT NOTES, and the mailer accepts it');
assert.match(email.subject(meeting), /^\[DRAFT NOTES\] \S/);
const html = email.html(meeting, summary);
const note = html.indexOf('Note for Sam');
const cut = html.indexOf('DRAFT NOTES BEGIN BELOW');
const draftStart = html.indexOf('>DRAFT<');
assert.ok(note > 0 && note < cut && cut < draftStart, 'the note first, then a clear line, then the draft');
assert.ok(html.indexOf('meeting.html') > note && html.indexOf('meeting.html') < cut, 'the tracker link is in the note');
assert.doesNotMatch(html, /<script>|<b>bold/, 'everything from the meeting is escaped');
assert.match(html, /Budget &lt;script&gt;/);
assert.match(html, /Attendees \(4\)/, 'only the people checked in');
assert.doesNotMatch(html, /Jordan Absent/);
assert.match(html, /Pat Example \(President\)/);
assert.match(email.html(meeting, Object.assign({}, summary, { names: { 'Pat Example': 'Patricia Example' } })), /Patricia Example \(President\)/, 'a display name for someone checked in under a short name');
assert.match(html, /ADDED/, 'an item added during the meeting says so');
assert.deepEqual(email.byOwner(summary.followUps).map(([owner, list]) => [owner, list.length]), [['Pat Example', 2], ['Lee Placeholder', 1], ['', 1]], 'most follow-ups first; no owner last');
assert.match(html, /rowspan="2"[^>]*>Pat Example/);
assert.match(html, /Owner needed/);
assert.match(html, />TBD</, 'no due date shows TBD');
const text = email.text(meeting, summary);
assert.ok(text.indexOf('NOTE FOR SAM') === 0 && text.indexOf('DRAFT NOTES BEGIN BELOW') > text.indexOf('Follow-up tracker: https://concordtabletennisclub.com/meeting.html'));
assert.match(text, /FOLLOW-UPS \(4\)\n  Pat Example\n    - Add pre-pay \[Budget\] \(due TBD\)/);
assert.match(text, /2\. Budget <script>alert\(1\)<\/script>\n   No decision recorded\./, 'plain text stays plain');

// ---- The script keeps member data out of the repository ----
const script = fs.readFileSync(path.join(dir, '..', 'scripts', 'meeting-draft-email.js'), 'utf8');
assert.match(script, /use a folder outside the repository/);
assert.match(script, /fn: 'sendDraftNotes'/);
assert.match(script, /dir: 'meeting-mailer'/);

console.log('Meeting mailer checks passed');
