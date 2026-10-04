const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let nextId = 0;
const replies = [];
const audits = [];
const thread = { messages: [] };
function text(name, phone, body, at, from) {
  const id = 'm' + nextId++;
  return {
    getId: () => id,
    getReplyTo: () => from ? '' : '"' + name + ' (SMS)" <19255550100.19255550199.abc@txt.voice.google.com>',
    getThread: () => ({ getMessages: () => thread.messages }),
    reply: body => { replies.push({ id, body }); },
    getFrom: () => from || '"' + name + ' (SMS)" <19255550100.19255550199.abc@txt.voice.google.com>',
    getSubject: () => 'New text message from ' + (name ? name + ' ' : '') + phone,
    getPlainBody: () => '<https://voice.google.com>\n' + body + '\nTo respond to this text message, reply to this email or visit Google Voice.\nYOUR ACCOUNT <https://voice.google.com> HELP CENTER',
    getDate: () => new Date(at)
  };
}
const inbox = [
  text('Patrick Lee', '(925) 555-0142', 'This is a test', '2026-09-24T18:00:00Z'),
  text('Patrick Lee', '(925) 555-0142', 'Testing with two messages\nsecond line', '2026-09-24T18:01:00Z'),
  text('Christopher Moss', '(925) 555-0177', "can't make it tonight", '2026-09-24T19:00:00Z'),
  text('', '(415) 555-0123', 'who is this?', '2026-09-24T19:30:00Z'),
  text('Casey', '(415) 555-0188', 'add me', '2026-09-24T19:40:00Z'),
  text('Avery Park', '(415) 555-0199', 'spoofed', '2026-09-24T19:50:00Z', 'Avery <avery@example.com>'),
  text('Dana Chen', '(415) 555-0111', 'wrong day', '2026-09-25T18:00:00Z'),
  text('Taylor Quinn Vale', '(925) 555-0163', 'in tonight', '2026-09-24T17:00:00Z'),
  text('Sam Lee Park', '(925) 555-0160', 'Coach Sam Park', '2026-09-24T17:10:00Z'),
  text('Riley Stone', '(925) 555-0161', 'see you at 7', '2026-09-24T17:20:00Z'),
  text('Jordan Fox', '(925) 555-0162', 'COACH', '2026-09-24T17:30:00Z'),
  text('Jordan Fox', '(925) 555-0162', 'I can play RR', '2026-09-24T17:31:00Z')
];
const players = ['P. J. Lee', 'Chris Moss', 'Casey Kim', 'Casey Jones', 'Avery Park', 'Dana Chen', 'Taylor (Quinn) Vale', 'Sam (Lee) Park', 'Riley Stone']
  .map((name, index) => ({ playerId: 'p' + index, name }));
const coachingBook = {
  Coaches: [['name', 'email', 'phone', 'status', 'coach_id', 'label'],
    ['Sam Lee Park', 'sam@example.com', '(925) 555-0160', '', 'c1', 'S'],
    ['Morgan Gray', 'morgan@example.com', '', 'disabled', 'c2', 'M']],
  Students: [['label', 'email', 'created_at', 'name', 'phone'], ['A', 'riley@example.com', '', 'Riley S', '9255550161']],
  Requests: [['request_id', 'coach_id', 'date', 'start', 'minutes', 'student_label', 'student_name', 'student_email', 'status'],
    ['r1', 'c1', '2026-09-24', '20:00', '60', 'A', 'Riley S', 'RILEY@example.com', 'confirmed'],
    ['r2', 'c1', new Date('2026-09-24T19:00:00Z'), '19:00', '30', 'B', 'Jordan Fox', 'jordan@example.com', 'cancelled'],
    ['r3', 'c1', '2026-09-25', '19:00', '30', 'B', 'Jordan Fox', 'jordan@example.com', 'confirmed'],
    ['r4', 'c2', '2026-09-24', '19:00', '30', 'C', 'Avery Park', 'avery@example.com', 'confirmed'],
    ['r5', 'c1', new Date('2026-09-24T19:00:00Z'), '19:00', '30', 'D', 'Casey Kim', 'casey@example.com', 'confirmed']]
};
let coachingId = 'coaching-sheet';
const context = {
  TABLES: {},
  SpreadsheetApp: {
    getActive: () => ({ getSheetByName: () => ({}) }),
    openById: id => {
      assert.equal(id, 'coaching-sheet');
      return { getSheetByName: name => coachingBook[name] && { getDataRange: () => ({ getValues: () => coachingBook[name] }) } };
    }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'CTTC_COACHING_DB_ID' ? coachingId : null }) },
  displayDate_: value => value instanceof Date ? new Date(value.getTime() - 7 * 3600000).toISOString().slice(0, 10) : String(value),
  console: { warn: () => {} },
  rows_: () => [],
  normalizeName_: name => String(name || '').trim().replace(/\s+/g, ' '),
  validateSessionDate_: date => { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Invalid date'); },
  listPlayers: () => players,
  playerAliases_: () => ({ 'patrick lee': 'p0', 'christopher moss': 'p1', 'old record': 'gone' }),
  GmailApp: { search: query => { assert.match(query, /^in:anywhere from:txt\.voice\.google\.com /, 'Trash and Spam are searched too'); return [{ getMessages: () => inbox }, { getMessages: () => inbox.slice(0, 1) }]; } },
  Utilities: { formatDate: date => new Date(date.getTime() - 7 * 3600000).toISOString().slice(0, 10) },
  Session: { getScriptTimeZone: () => 'America/Los_Angeles' },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  appendAudit_: (...args) => audits.push(args)
};
vm.createContext(context);
for (const file of ['LinkedNames.js', 'VoiceSuggestions.js', 'Coaching.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context);

const day = JSON.parse(JSON.stringify(context.listVoiceSuggestions('2026-09-24')));
const bySender = Object.fromEntries(day.map(s => [s.senderName, s]));
assert.deepEqual(Object.keys(bySender), ['Casey', 'Unknown number ending 0123', 'Christopher Moss', 'Patrick Lee', 'Jordan Fox', 'Taylor Quinn Vale'], 'newest sender first');
assert.deepEqual(bySender['Taylor Quinn Vale'].playerIds, ['p6'], 'parentheses in a directory name do not block a match');
assert.equal(bySender['Sam Lee Park'], undefined, 'a coach with a confirmed lesson that day is left out');
assert.equal(bySender['Riley Stone'], undefined, 'a student with a confirmed lesson is recognised by phone');
assert.deepEqual(bySender['Jordan Fox'].messages.map(m => m.text), ['I can play RR'], 'coaching commands are dropped; a cancelled lesson does not hide the sender');
assert.deepEqual(bySender['Patrick Lee'].messages.map(m => m.text), ['This is a test', 'Testing with two messages\nsecond line'], 'footer stripped, duplicates collapsed, order kept');
assert.deepEqual(bySender['Patrick Lee'].playerIds, ['p0'], 'an old contact name resolves through its alias');
assert.deepEqual(bySender['Christopher Moss'].playerIds, ['p1']);
assert.equal(bySender['Christopher Moss'].messages[0].text, "can't make it tonight", 'messages are shown, not interpreted');
assert.deepEqual(bySender['Unknown number ending 0123'].playerIds, []);
assert.equal(JSON.stringify(day).includes('555-0123'), false, 'full phone numbers never reach the page');
assert.deepEqual(bySender.Casey.playerIds, ['p2', 'p3'], 'partial contact names offer prefix matches');
assert.equal(bySender['Avery Park'], undefined, 'non-Voice senders ignored');
assert.equal(bySender['Dana Chen'], undefined, 'other dates ignored');
assert.equal(bySender['Patrick Lee'].senderKey, 'patrick lee');
assert.equal(bySender['Unknown number ending 0123'].senderKey, '', 'unknown numbers expose no key');
assert.deepEqual(Object.keys(bySender['Patrick Lee'].messages[0]).sort(), ['receivedAt', 'text'], 'Gmail objects never reach the page');

const lessons = JSON.parse(JSON.stringify(context.getCoachingParticipants('2026-09-24')));
assert.deepEqual(lessons, [
  { playerId: 'p7', name: 'Sam Lee Park', role: 'coach', lessons: [{ start: '19:00', minutes: 30, coachLabel: 'S' }, { start: '20:00', minutes: 60, coachLabel: 'S' }] },
  { playerId: 'p2', name: 'Casey Kim', role: 'student', lessons: [{ start: '19:00', minutes: 30, coachLabel: 'S' }] },
  { playerId: 'p8', name: 'Riley S', role: 'student', lessons: [{ start: '20:00', minutes: 60, coachLabel: 'S' }] }
], 'confirmed lessons only, disabled coaches skipped, one row per person, no contact details');
assert.deepEqual(JSON.parse(JSON.stringify(context.getCoachingParticipants('2026-09-26'))), []);
coachingId = null;
assert.deepEqual(JSON.parse(JSON.stringify(context.getCoachingParticipants('2026-09-24'))), [], 'no coaching Sheet linked');
assert.ok(context.listVoiceSuggestions('2026-09-24').some(s => s.senderName === 'Riley Stone'), 'without the link, nothing is hidden');
coachingId = 'broken';
assert.ok(context.listVoiceSuggestions('2026-09-24').length, 'an unreadable coaching Sheet does not break Voice signups');
coachingId = 'coaching-sheet';

thread.messages = inbox.slice(0, 2);
assert.deepEqual(JSON.parse(JSON.stringify(context.sendVoiceConfirmation('2026-09-24', 'patrick lee', 'p0'))), { sent: true, reason: '' });
assert.deepEqual(replies, [{ id: 'm1', body: 'Confirmed.' }], 'replies to the latest text from that sender only');
assert.deepEqual(JSON.parse(JSON.stringify(audits)), [['voice_confirmation_sent', 'player', 'p0', { sessionDate: '2026-09-24' }]]);
thread.messages = inbox.slice(0, 2).concat([{ getDate: () => new Date('2026-09-24T18:05:00Z'), getFrom: () => 'Club <club@example.com>' }]);
assert.equal(context.sendVoiceConfirmation('2026-09-24', 'patrick lee', 'p0').sent, false, 'a reply already in the thread blocks a second one');
assert.equal(replies.length, 1);
assert.throws(() => context.sendVoiceConfirmation('2026-09-24', 'phone:4155550123', 'p9'), /no saved contact name/);
assert.throws(() => context.sendVoiceConfirmation('2026-09-24', '', 'p9'), /no saved contact name/);
assert.throws(() => context.sendVoiceConfirmation('2026-09-24', 'nobody here', 'p9'), /No text from this person/);
assert.throws(() => context.sendVoiceConfirmation('2026-09-24', 'avery park', 'p4'), /No text from this person/, 'non-Voice senders cannot be replied to');
assert.equal(replies.length, 1);
console.log('Voice suggestion checks passed');
