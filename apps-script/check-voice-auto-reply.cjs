const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Automatic answers to round robin texts (VoiceAutoReply.js), against a fake Gmail, clock and Script properties.
// Made-up names and 555 numbers only.
let clock = Date.parse('2026-10-26T17:00:00Z'); // Monday October 26, 2026, 10:00 AM Pacific (PDT)
const pacific = ms => new Date(ms - 7 * 3600000);
const at = time => Date.parse('2026-10-26T' + time + ':00Z') + 7 * 3600000; // Pacific wall clock on October 26

let nextId = 0;
const replies = [];
const audits = [];
function text(name, phone, body, when, threadExtra) {
  const id = 'm' + nextId++;
  const message = {
    getId: () => id,
    getReplyTo: () => '"' + (name || phone) + ' (SMS)" <19255550100.19255550199.x@txt.voice.google.com>',
    getFrom: () => '"' + (name || phone) + ' (SMS)" <19255550100.19255550199.x@txt.voice.google.com>',
    getSubject: () => 'New text message from ' + (name ? name + ' ' : '') + phone,
    getPlainBody: () => body + '\nTo respond to this text message, reply to this email or visit Google Voice.\nYOUR ACCOUNT',
    getDate: () => new Date(when),
    reply: reply => { replies.push({ to: name || phone, reply }); }
  };
  const thread = [message].concat(threadExtra || []);
  message.getThread = () => ({ getMessages: () => thread });
  return message;
}
let inbox = [];
let searches = 0;
const properties = {};
let cache = {};
let lockFree = true;
let closuresBody = { days: {} };
let triggers = [];
const players = [
  { playerId: 'p-ada', name: 'Ada Every' },
  { playerId: 'p-eli1', name: 'Eli Twin' },
  { playerId: 'p-eli2', name: 'Eli Twin' },
  { playerId: 'p-fay', name: 'Fay Alias-Name' },
  { playerId: 'p-gus', name: 'Gus Long Name' }
];
const context = {
  TABLES: {},
  console: { warn() {} },
  Utilities: {
    formatDate(date, zone, pattern) {
      const d = pacific(date.getTime());
      const pad = n => String(n).padStart(2, '0');
      return pattern === 'yyyy-MM-dd' ? d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) : pattern === 'H' ? String(d.getUTCHours()) : String(d.getUTCMinutes());
    }
  },
  Session: { getScriptTimeZone: () => 'America/Los_Angeles' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] === undefined ? null : properties[key], setProperty: (key, value) => { properties[key] = value; } }) },
  CacheService: { getScriptCache: () => ({ get: key => cache[key] || null, put: (key, value) => { cache[key] = value; } }) },
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(closuresBody) }) },
  LockService: { getDocumentLock: () => ({ tryLock: () => lockFree, releaseLock() {} }), getScriptLock: () => { throw new Error('score saves own the script lock'); } },
  MAIL_FRESH_MS_: 60000,
  readMailIfStale_: () => { searches += 1; },
  storedVoiceMessages_: (from, to) => inbox.filter(message => message.getDate().getTime() >= from && message.getDate().getTime() < to),
  GmailApp: { search: () => { throw new Error('texts come from the mail reader, never a Gmail search'); } },
  ScriptApp: {
    getProjectTriggers: () => triggers,
    deleteTrigger: trigger => { triggers = triggers.filter(item => item !== trigger); },
    newTrigger: handler => ({ timeBased: () => ({ everyMinutes: n => ({ create: () => { triggers.push({ getHandlerFunction: () => handler, every: n }); } }) }) })
  },
  listPlayers: () => players,
  playerAliases_: () => ({ 'faye a': 'p-fay', 'gone player': 'p-missing' }),
  normalizeName_: name => String(name || '').trim().replace(/\s+/g, ' '),
  validateSessionDate_: () => {},
  confirmedNameLinks_: () => ({ resolved: [] }),
  appendAudit_: (...args) => { audits.push(JSON.parse(JSON.stringify(args))); },
  guardDesk_: (name, work) => work(),
  Date: class extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
};
vm.createContext(context);
for (const file of ['Coaching.js', 'VoiceSuggestions.js', 'VoiceAutoReply.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context);
// One lesson that day, found by the student's number (their Voice contact name differs).
context.coachingLessons_ = () => [{ role: 'student', name: 'Tess S', phone: '(925) 555-0117' }];
const run = () => JSON.parse(JSON.stringify(context.answerVoiceSignups()));

inbox = [
  text('Ada Every', '(925) 555-0101', 'I\'ll join CTTC\'s RR tonight', at('09:00')),
  text('Faye A', '(925) 555-0102', 'count me in', at('09:05')),
  text('', '(925) 555-0103', 'I\'ll join CTTC\'s RR tonight', at('09:10')),
  text('Eli Twin', '(925) 555-0104', 'Coming tonight', at('09:15')),
  text('Mom', '(925) 555-0105', 'on my way', at('09:20')),
  text('Gus', '(925) 555-0106', 'playing tonight', at('09:25')),
  text('Hal Asks', '(925) 555-0107', 'Is RR on tonight?', at('09:30')),
  text('Ivy Out', '(925) 555-0108', 'Coming tonight', at('08:00')),
  text('Ivy Out', '(925) 555-0108', 'Sorry, can\'t make it after all', at('09:35')),
  text('Jo Coach', '(925) 555-0109', 'STUDENT Mon 5pm', at('09:40')),
  text('Kim Staff', '(925) 555-0110', 'STAFF', at('09:40')),
  text('Lee Done', '(925) 555-0111', 'see you at 7', at('09:45'), [{ getDate: () => new Date(at('09:50')), getFrom: () => 'Club <club@example.com>' }]),
  text('Mo Chat', '(925) 555-0112', 'Thanks!', at('09:50')),
  text('Ned Yesterday', '(925) 555-0113', 'Coming tonight', Date.parse('2026-10-25T20:00:00Z')),
  text('Tess Student', '(925) 555-0117', 'on my way', at('09:55'))
];

// Off until the owner turns it on.
assert.deepEqual(run(), { skipped: 'off' });
assert.equal(searches, 0, 'off reads nothing');
assert.equal(replies.length, 0);

assert.deepEqual(JSON.parse(JSON.stringify(context.enableVoiceAutoReply())), { on: true, triggers: 1 });
assert.equal(triggers[0].every, 1, 'every minute');
context.enableVoiceAutoReply();
assert.equal(triggers.length, 1, 'turning it on twice keeps one trigger');

const first = run();
const said = Object.fromEntries(replies.map(item => [item.to, item.reply]));
assert.equal(said['Ada Every'], 'Received - you\'re on the list, Ada Every! See you tonight.', 'linked: their directory name');
assert.equal(said['Faye A'], 'Received - you\'re on the list, Fay Alias-Name! See you tonight.', 'an alias links to the directory name');
const unlinked = 'We\'re glad to have you! This number isn\'t linked to anyone in our club directory yet. Reply with your name and we\'ll add you.';
assert.equal(said['(925) 555-0103'], unlinked, 'a number with no contact name');
assert.equal(said['Eli Twin'], unlinked, 'a name that is two players is no one');
assert.equal(said.Mom, unlinked, 'a contact name that is no player');
assert.equal(said.Gus, unlinked, 'part of a name is not a link');
['Hal Asks', 'Ivy Out', 'Jo Coach', 'Kim Staff', 'Lee Done', 'Mo Chat', 'Ned Yesterday', 'Tess Student'].forEach(name => {
  assert.equal(said[name], undefined, name + ' gets no automatic answer');
});
assert.equal(replies.length, 6);
assert.deepEqual(first.sent.sort(), ['linked', 'linked', 'unlinked', 'unlinked', 'unlinked', 'unlinked']);
assert.deepEqual(audits.filter(a => a[0] === 'voice_auto_reply').map(a => [a[2], a[3].linked]).sort(),
  [['', false], ['', false], ['', false], ['', false], ['p-ada', true], ['p-fay', true]], 'the log holds a player id at most, never a number or text');

// A minute later: nobody is answered twice, even after writing back with their name.
inbox.push(text('', '(925) 555-0103', 'Sam Newcomer, I\'m in', at('10:01')));
inbox.push(text('Ada Every', '(925) 555-0101', 'running late, save me a spot', at('10:02')));
clock = at('10:03');
assert.deepEqual(run(), { sent: [] });
assert.equal(replies.length, 6);
// Someone new later in the day is answered.
inbox.push(text('Pat Late', '(925) 555-0114', 'I\'ll join CTTC\'s RR tonight', at('18:30')));
clock = at('18:31');
run();
assert.equal(replies.length, 7);

// Only on a round robin day, from 6 AM until sign-up closes at 7:15 PM, and never on a closed night.
inbox.push(text('Quin Late', '(925) 555-0115', 'coming', at('19:16')));
clock = at('19:16');
assert.deepEqual(run(), { skipped: 'not now' });
clock = at('05:59');
assert.deepEqual(run(), { skipped: 'not now' });
clock = Date.parse('2026-10-27T17:00:00Z');
assert.deepEqual(run(), { skipped: 'not now' }, 'Tuesday');
clock = Date.parse('2026-11-02T17:00:00Z');
closuresBody = { days: { '2026-11-02': 'full' } };
cache = {};
assert.deepEqual(run(), { skipped: 'closed' });
// The next round robin day starts a fresh list, and another run holding the lock means this one waits for the next minute.
closuresBody = { days: {} };
cache = {};
lockFree = false;
assert.deepEqual(run(), { skipped: 'busy' });
lockFree = true;
inbox = [text('Ada Every', '(925) 555-0101', 'I\'ll join CTTC\'s RR tonight', Date.parse('2026-11-02T16:00:00Z'))];
run();
assert.equal(replies[replies.length - 1].reply, 'Received - you\'re on the list, Ada Every! See you tonight.', 'answered again on a new night');
assert.equal(JSON.parse(properties.CTTC_VOICE_AUTO_REPLIED).date, '2026-11-02');

// The Saturday afternoon pilot, from October 31: answered "today" until sign-up closes at 3:15 PM.
clock = Date.parse('2026-10-24T17:00:00Z');
assert.deepEqual(run(), { skipped: 'not now' }, 'no Saturday round robin before the pilot');
inbox = [text('Ada Every', '(925) 555-0101', 'I\'ll join CTTC\'s RR today', Date.parse('2026-10-31T16:00:00Z'))];
clock = Date.parse('2026-10-31T17:00:00Z');
run();
assert.equal(replies[replies.length - 1].reply, 'Received - you\'re on the list, Ada Every! See you today.', 'Saturday is an afternoon');
inbox.push(text('Pat Late', '(925) 555-0114', 'coming', Date.parse('2026-10-31T22:14:00Z')));
clock = Date.parse('2026-10-31T22:14:30Z');
run();
assert.equal(replies[replies.length - 1].to, 'Pat Late', 'answered at 3:14 PM');
clock = Date.parse('2026-10-31T22:15:00Z');
assert.deepEqual(run(), { skipped: 'not now' }, 'Saturday sign-up closes at 3:15 PM');

// Off again.
assert.deepEqual(JSON.parse(JSON.stringify(context.disableVoiceAutoReply())), { on: false, triggers: 0 });
inbox.push(text('Rae New', '(925) 555-0116', 'coming', Date.parse('2026-11-02T16:30:00Z')));
const before = replies.length;
assert.deepEqual(run(), { skipped: 'off' });
assert.equal(replies.length, before);

console.log('Voice auto-reply checks passed');
