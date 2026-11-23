'use strict';

// The meeting mailer (sends only [DRAFT NOTES] and [CTTC] emails, to at most 20 people plus a copy to the club account,
// always, within the shared email allowance, never the same email twice by accident) against a fake Google, and the draft email it sends (scripts/lib/meeting-email.js):
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
assert.deepEqual([...code.matchAll(/^function ([A-Za-z0-9_]+)\(/gm)].map(m => m[1]).filter(n => !n.endsWith('_')).sort(), ['doGet', 'sendClubMessage', 'sendDraftNotes', 'sentLog']);

// ---- The mailer against a fake Google ----
let clock = Date.parse('2026-11-22T18:00:00Z');
const sent = [];
let quota = 100;
const props = new Map();
const server = vm.createContext({
  Date: class extends Date { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return clock; } },
  JSON, Math,
  MailApp: { getRemainingDailyQuota: () => quota, sendEmail: message => { sent.push(message); quota -= message.to.split(',').length + (message.cc ? message.cc.split(',').length : 0); } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.has(k) ? props.get(k) : null, setProperty: (k, v) => props.set(k, String(v)) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  HtmlService: { createHtmlOutput: html => ({ html, setTitle() { return this; } }) }
});
vm.runInContext(code, server);
const plain = v => JSON.parse(JSON.stringify(v));
const send = draft => plain(server.sendDraftNotes(draft));
const club = message => plain(server.sendClubMessage(message));
const CLUB = 'club@example.org';
const good = { to: ['Secretary@Example.org'], copy: ['Club@Example.org'], subject: '[DRAFT NOTES] CTTC Executive Committee Meeting – Saturday, November 21, 2026', html: '<p>Draft</p>', text: 'Draft', meetingId: 'm20261121abcd' };
assert.match(server.doGet().html, /id="ready"/, 'the page the script waits for');

// Every email is copied to the club account, so the club sees everything sent: none without the copy.
assert.throws(() => send(Object.assign({}, good, { copy: [] })), /copied to the club account/, 'no copy, no email');
assert.throws(() => send(Object.assign({}, good, { copy: [CLUB, 'other@example.org'] })), /only to it/, 'and the copy goes to the club account only');
assert.equal(sent.length, 0);
const result = send(good);
assert.equal(result.sent, true);
assert.deepEqual([result.to, result.copy, result.quotaLeft], [['secretary@example.org'], [CLUB], 98], 'the copy counts against the allowance');
assert.deepEqual(sent.map(m => [m.to, m.cc, m.subject, m.htmlBody, m.body, m.name]), [['secretary@example.org', CLUB, good.subject, '<p>Draft</p>', 'Draft', 'CTTC Executive Committee']]);
assert.equal(props.get('CLUB_COPY'), CLUB, 'the club address is remembered from the first send');
assert.deepEqual([plain(server.sentLog())[0].meetingId, plain(server.sentLog())[0].kind], ['m20261121abcd', 'draft'], 'each send is logged');
assert.throws(() => send(Object.assign({}, good, { subject: '[DRAFT NOTES] Elsewhere', copy: ['someone.else@example.org'] })), /copy must go to the club account/,
  'a copy to any other address is refused');
assert.equal(send(Object.assign({}, good, { subject: '[DRAFT NOTES] Same person', to: ['secretary@example.org', CLUB] })).to.length, 1, 'never the same person twice');
assert.equal(send(Object.assign({}, good, { subject: '[DRAFT NOTES] Three', to: ['a@example.org', 'b@example.org', 'c@example.org'] })).to.length, 3, 'three people, plus the club copy');
assert.throws(() => send(Object.assign({}, good, { subject: '[DRAFT NOTES] Bad copy', copy: ['not an address'] })), /not an email address/);

assert.throws(() => send(good), /same email went to the same people/, 'no accidental second send');
assert.equal(send(Object.assign({}, good, { resend: true })).sent, true, 'unless asked to resend');
clock += 31 * 60000;
assert.equal(send(good).sent, true, 'or after half an hour');
assert.throws(() => send(Object.assign({}, good, { subject: 'CTTC minutes' })), /must start with \[DRAFT NOTES\]/, 'draft notes only');
assert.throws(() => send(Object.assign({}, good, { subject: '[CTTC] A club message' })), /must start with \[DRAFT NOTES\]/, 'a club message is not a draft');
send(Object.assign({}, good, { subject: '[DRAFT NOTES] x\nBcc: someone@example.org' }));
assert.equal(sent[sent.length - 1].subject, '[DRAFT NOTES] x Bcc: someone@example.org', 'a line break in the subject becomes a space: it can never add a header');
const many = n => Array.from({ length: n }, (_, i) => 'member' + i + '@example.org');
assert.equal(send(Object.assign({}, good, { subject: '[DRAFT NOTES] Everyone', to: many(20) })).to.length, 20, 'up to 20 people, a whole committee');
assert.equal(sent[sent.length - 1].cc, CLUB, 'still copied to the club');
assert.throws(() => send(Object.assign({}, good, { subject: '[DRAFT NOTES] Too many', to: many(21) })), /1 to 20 recipients/);
assert.throws(() => send(Object.assign({}, good, { to: ['not an address'] })), /not an email address/);
assert.throws(() => send(Object.assign({}, good, { to: ['a@example.org, b@example.org'] })), /not an email address/, 'one address per entry');
assert.throws(() => send(Object.assign({}, good, { text: '' })), /plain-text copy/);

// Club messages: the same rules, their own subject and sender name.
const clubNote = { to: ['Coach@Example.org'], copy: [CLUB], subject: '[CTTC] Coaching update', html: '<p>Hi</p>', text: 'Hi' };
assert.equal(club(clubNote).sent, true);
assert.deepEqual([sent[sent.length - 1].to, sent[sent.length - 1].cc, sent[sent.length - 1].name], ['coach@example.org', CLUB, 'Concord Table Tennis Club']);
assert.equal(plain(server.sentLog()).pop().kind, 'club');
assert.throws(() => club(Object.assign({}, clubNote, { subject: '[DRAFT NOTES] Not a club message' })), /must start with \[CTTC\]/, 'a draft is not a club message');
assert.throws(() => club(Object.assign({}, clubNote, { subject: 'Coaching update' })), /must start with \[CTTC\]/);
assert.throws(() => club(Object.assign({}, clubNote, { copy: [] })), /copied to the club account/);
assert.throws(() => club(clubNote), /same email went to the same people/);

const before = sent.length;
quota = 10;
assert.throws(() => send(Object.assign({}, good, { subject: '[DRAFT NOTES] another' })), /only 10 email recipients are left today/, 'the other apps keep their share of the allowance');
assert.throws(() => club(Object.assign({}, clubNote, { subject: '[CTTC] another' })), /only 10 email recipients are left today/);
assert.equal(sent.length, before, 'nothing sent when refused');

// ---- The club message (scripts/lib/club-email.js) ----
{
  const message = require('../scripts/lib/club-email.js');
  const m = { to: [{ name: 'Sam Coach', email: 'coach@example.org' }], subject: 'Coaching update', from: 'Pat Example',
    body: 'Hi Sam, **your email** is on https://concordtabletennisclub.com/coaching.html.\n\n- One <b>step</b>\n- Two\n\n1. First\n2. Second' };
  assert.equal(message.subject(m), '[CTTC] Coaching update', 'the subject the mailer accepts');
  assert.match(message.subject(m), /^\[CTTC\] \S/);
  const page = message.html(m);
  assert.match(page, /<strong>your email<\/strong>/);
  assert.match(page, /<a href="https:\/\/concordtabletennisclub\.com\/coaching\.html"[^>]*>https:\/\/concordtabletennisclub\.com\/coaching\.html<\/a>\./, 'a link, without the full stop after it');
  assert.match(page, /<ul[^>]*><li[^>]*>One &lt;b&gt;step&lt;\/b&gt;<\/li><li[^>]*>Two<\/li><\/ul>/, 'a list, everything escaped');
  assert.match(page, /<ol[^>]*><li[^>]*>First<\/li>/);
  assert.match(page, /by Claude, an AI assistant, at Pat Example’s request\. Reply to this email to reach the club\./, 'it says who wrote it and for whom');
  const plainText = message.text(m);
  assert.match(plainText, /^Hi Sam, your email is on https:\/\/concordtabletennisclub\.com\/coaching\.html\.\n\n- One <b>step<\/b>\n- Two\n\n1\. First\n2\. Second\n\n--\nSent from/);
  assert.throws(() => message.subject(Object.assign({}, m, { subject: '[CTTC] Twice' })), /without \[CTTC\]/);
  assert.throws(() => message.html(Object.assign({}, m, { to: [] })), /1 to 20 people/);
  assert.throws(() => message.html(Object.assign({}, m, { from: '' })), /who asked/);
  const script = fs.readFileSync(path.join(dir, '..', 'scripts', 'club-email.js'), 'utf8');
  assert.match(script, /use a folder outside the repository/);
  assert.match(script, /fn: 'sendClubMessage'/);
  assert.match(script, /copy: \[club\]/, 'every message is copied to the club account');
}

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
const draftStart = html.indexOf('>CTTC Executive Committee Meeting<');
assert.ok(note > 0 && note < cut && cut < draftStart, 'the note first, then a clear line, then the draft');
assert.ok(html.indexOf('meeting.html') > note && html.indexOf('meeting.html') < cut, 'the tracker link is in the note');
assert.doesNotMatch(html.slice(cut), />DRAFT</, 'no DRAFT badge in the draft itself: it is copied and sent on as written');
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
assert.match(script, /copy: \[club\]/, 'every draft is copied to the club account');
assert.match(script, /dir: 'meeting-mailer'/);

console.log('Meeting mailer checks passed');
