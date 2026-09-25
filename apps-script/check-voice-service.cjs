const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let nextId = 0;
function text(name, phone, body, at, from) {
  const id = 'm' + nextId++;
  return {
    getId: () => id,
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
  text('Dana Chen', '(415) 555-0111', 'wrong day', '2026-09-25T18:00:00Z')
];
const players = ['P. J. Lee', 'Chris Moss', 'Casey Kim', 'Casey Jones', 'Avery Park', 'Dana Chen']
  .map((name, index) => ({ playerId: 'p' + index, name }));
const context = {
  TABLES: {},
  SpreadsheetApp: { getActive: () => ({ getSheetByName: () => ({}) }) },
  rows_: () => [],
  normalizeName_: name => String(name || '').trim().replace(/\s+/g, ' '),
  validateSessionDate_: date => { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Invalid date'); },
  listPlayers: () => players,
  playerAliases_: () => ({ 'patrick lee': 'p0', 'christopher moss': 'p1', 'old record': 'gone' }),
  GmailApp: { search: query => { assert.match(query, /^in:anywhere from:txt\.voice\.google\.com /, 'Trash and Spam are searched too'); return [{ getMessages: () => inbox }, { getMessages: () => inbox.slice(0, 1) }]; } },
  Utilities: { formatDate: date => new Date(date.getTime() - 7 * 3600000).toISOString().slice(0, 10) },
  Session: { getScriptTimeZone: () => 'America/Los_Angeles' }
};
vm.createContext(context);
for (const file of ['LinkedNames.js', 'VoiceSuggestions.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context);

const day = JSON.parse(JSON.stringify(context.listVoiceSuggestions('2026-09-24')));
const bySender = Object.fromEntries(day.map(s => [s.senderName, s]));
assert.deepEqual(Object.keys(bySender), ['Casey', 'Unknown number ending 0123', 'Christopher Moss', 'Patrick Lee'], 'newest sender first');
assert.deepEqual(bySender['Patrick Lee'].messages.map(m => m.text), ['This is a test', 'Testing with two messages\nsecond line'], 'footer stripped, duplicates collapsed, order kept');
assert.deepEqual(bySender['Patrick Lee'].playerIds, ['p0'], 'an old contact name resolves through its alias');
assert.deepEqual(bySender['Christopher Moss'].playerIds, ['p1']);
assert.equal(bySender['Christopher Moss'].messages[0].text, "can't make it tonight", 'messages are shown, not interpreted');
assert.deepEqual(bySender['Unknown number ending 0123'].playerIds, []);
assert.equal(JSON.stringify(day).includes('555-0123'), false, 'full phone numbers never reach the page');
assert.deepEqual(bySender.Casey.playerIds, ['p2', 'p3'], 'partial contact names offer prefix matches');
assert.equal(bySender['Avery Park'], undefined, 'non-Voice senders ignored');
assert.equal(bySender['Dana Chen'], undefined, 'other dates ignored');
console.log('Voice suggestion checks passed');
