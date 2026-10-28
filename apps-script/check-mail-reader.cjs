const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// The one Gmail reader (MailReader.js), against a fake Gmail, Sheet and clock. Made-up names and 555 numbers only.
let clock = Date.parse('2026-10-26T17:00:00Z');
const grids = {};
const sheets = {};
const makeSheet = name => {
  const grid = grids[name] = [];
  const range = (row, column, rows, columns) => {
    const handle = {
      getValues: () => Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => (grid[row - 1 + r] || [])[column - 1 + c] ?? '')),
      setValues: values => {
        assert.ok(handle.text || row === 1, 'cells are plain text before they are written');
        values.forEach((line, r) => line.forEach((value, c) => {
          assert.equal(typeof value, 'string', 'every value is written as text');
          (grid[row - 1 + r] = grid[row - 1 + r] || [])[column - 1 + c] = value;
        }));
        return handle;
      },
      setNumberFormat: format => { assert.equal(format, '@'); handle.text = true; return handle; }
    };
    return handle;
  };
  return {
    getDataRange: () => ({ getValues: () => grid.map(line => line.slice()) }),
    getLastRow: () => grid.length,
    getMaxRows: () => Math.max(1000, grid.length),
    insertRowsAfter() {},
    getRange: range,
    deleteRows: (row, count) => { grid.splice(row - 1, count); }
  };
};

// Gmail: threads of messages, oldest first. Every call is counted, as Google counts them.
let threads = [];
let calls = 0;
let searches = [];
let lockHeld = false;
const replies = [];
let nextId = 0;
const message = (subject, body, when, from) => {
  const id = 'id' + nextId++;
  const counted = value => () => { calls += 1; return value; };
  return {
    id, getId: counted(id), getDate: counted(new Date(when)), getFrom: counted(from), getSubject: counted(subject), getPlainBody: counted(body),
    getReplyTo: counted(from), reply: text => { replies.push({ id, text }); }
  };
};
const voice = (name, body, when) => message('New text message from ' + name + ' (925) 555-01' + String(name.length).padStart(2, '0'), '<https://voice.google.com>\n' + body +
  '\nTo respond to this text message, reply to this email or visit Google Voice.\nYOUR ACCOUNT <https://voice.google.com>', when, '"' + name + ' (SMS)" <19255550100.19255550101.x@txt.voice.google.com>');
const minutes = count => count * 60000;
const deskLogs = [];
const audits = [];
const triggers = [];
const context = {
  Date: class extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  },
  console: { warn() {} },
  TABLES: {},
  SpreadsheetApp: { getActive: () => ({ getSheetByName: name => sheets[name] || null, insertSheet: name => (sheets[name] = makeSheet(name)) }) },
  ensureHeader_: (sheet, headers) => { sheet.getRange(1, 1, 1, headers.length).setValues([headers]); },
  formatTable_() {},
  ensurePrivatePaymentTables_() {},
  rows_: name => { assert.equal(name, 'ZeffyPayments'); return zeffyRows.map(row => Object.assign({}, row)); },
  appendObjects_: (name, rows) => { zeffyRows.push(...rows); },
  parseZeffyEmail_: (from, subject, body, paidOn) => /zeffy/.test(from) ? [{ paid_on: paidOn, kind: 'purchase', payer_name: body, payer_email: '', participant_name: body }] : [],
  GmailApp: {
    search: (query, start, max) => {
      assert.equal(lockHeld, false, 'Gmail is never read while holding the lock score saves wait on');
      if (gmailDown) throw new Error('Service invoked too many times for one day: gmail.');
      calls += 1;
      searches.push(query);
      const after = Number(query.match(/ after:(\d+)$/)[1]) * 1000;
      // Gmail matches a thread with any message after that moment; reading the dates for that is the search's own cost.
      return threads.filter(thread => thread.some(item => Date.parse(item.when) >= after)).slice(start, start + max);
    },
    getMessagesForThreads: found => { calls += 1; return found.map(thread => thread.slice()); },
    getMessageById: id => { calls += 1; return threads.flat().find(item => item.id === id); }
  },
  LockService: { getScriptLock: () => ({ hasLock: () => lockHeld, tryLock: () => (lockHeld = true), releaseLock: () => { lockHeld = false; } }) },
  CacheService: { getScriptCache: () => ({ get: key => cache[key] || null, put: (key, value) => { cache[key] = value; }, remove: key => { delete cache[key]; } }) },
  ScriptApp: {
    getProjectTriggers: () => triggers.map(handler => ({ getHandlerFunction: () => handler })),
    newTrigger: handler => ({ timeBased: () => ({ everyMinutes: n => ({ create: () => { assert.equal(n, 1); triggers.push(handler); } }) }) })
  },
  Utilities: { formatDate: date => new Date(date.getTime() - 7 * 3600000).toISOString().slice(0, 10) },
  Session: { getScriptTimeZone: () => 'America/Los_Angeles' },
  deskLog_: (...args) => deskLogs.push(args),
  appendAudit_: (...args) => audits.push(args),
  safeAudit_: (...args) => audits.push(args)
};
const make = (...args) => { const item = (args[0] === 'zeffy' ? message('Play pass', args[1], args[2], 'Zeffy <contact@communication.mailer.zeffy.com>') : voice(...args)); item.when = new Date(args[args.length - 1]).toISOString(); return item; };
let cache = {};
let zeffyRows = [];
let gmailDown = false;
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/MailReader.js', 'utf8'), context);
const read = () => JSON.parse(JSON.stringify(context.readMail()));
const texts = () => grids.VoiceTexts.slice(1);

// A long history: Ada has texted for months, all in one thread, like Google Voice.
const ada = [];
for (let day = 60; day >= 1; day -= 1) ada.push(make('Ada Every', 'old text ' + day, clock - day * 86400000));
const tonight = clock - minutes(30);
ada.push(make('Ada Every', 'coming tonight', tonight));
threads = [ada, [make('zeffy', 'Kim Tan', clock - 86400000)]];

const first = read();
assert.deepEqual(first, { texts: 8, zeffy: 1, gmailCalls: first.gmailCalls }, 'the first read takes the last week');
assert.match(searches[0], /^in:anywhere \(from:txt\.voice\.google\.com OR from:communication\.mailer\.zeffy\.com\) after:\d+$/, 'one search for texts and Zeffy, Trash and Spam included');
assert.deepEqual(triggers, [], 'the trigger itself installs nothing');
assert.equal(texts()[texts().length - 1][4], 'coming tonight', 'Voice links and footer are taken out');
assert.equal(zeffyRows.length, 1);
assert.equal(grids.MailReader[1][3], String(first.gmailCalls), 'Gmail calls are counted for the day');

// A quiet minute: one search, nothing opened.
clock += minutes(1);
calls = 0;
assert.deepEqual(read(), { texts: 0, zeffy: 0, gmailCalls: 1 });
assert.equal(calls, 1, 'a quiet minute costs one Gmail call');
assert.ok(Number(searches[searches.length - 1].match(/after:(\d+)/)[1]) * 1000 >= clock - minutes(5), 'only mail since the last read, with a few minutes to spare');

// A new text in that long thread: the thread is read newest first and left at the first text already recorded.
clock += minutes(1);
ada.push(make('Ada Every', 'running late', clock - 5000));
calls = 0;
assert.equal(read().texts, 1);
assert.ok(calls <= 12, 'a new text costs a handful of calls, not the whole history (' + calls + ')');

// Read twice (the trigger and a desk page at once): recorded once.
clock += minutes(1);
ada.push(make('Ada Every', 'see you', clock - 5000));
grids.MailReader[1][1] = String(clock - minutes(10));
assert.equal(read().texts, 1);
grids.MailReader[1][1] = String(clock - minutes(10));
clock += minutes(1);
assert.equal(read().texts, 0, 'a message already recorded is never recorded again');
assert.equal(texts().filter(row => row[4] === 'see you').length, 1);

// The desk's reads: within the minute nothing is read; a stale read installs the trigger once and reads.
calls = 0;
assert.deepEqual(JSON.parse(JSON.stringify(context.readMailIfStale_(60000))), { skipped: 'fresh' });
assert.equal(calls, 0);
assert.deepEqual(triggers, ['readMail'], 'the desk installs the minute trigger');
clock += minutes(2);
assert.equal(context.readMailIfStale_(60000).texts, 0);
cache = {};
context.readMailIfStale_(60000);
assert.deepEqual(triggers, ['readMail'], 'never twice');
assert.deepEqual(audits.map(entry => entry[0]), ['mail_reader_enabled']);

// Never while the caller holds the lock, and one read at a time.
lockHeld = true;
assert.deepEqual(read(), { skipped: 'locked' });
lockHeld = false;
cache['mail-reading'] = '1';
clock += minutes(2);
assert.deepEqual(read(), { skipped: 'running' });
delete cache['mail-reading'];

// Stored texts look like the Gmail messages: reading costs nothing; only a reply opens the real one.
calls = 0;
const stored = context.storedVoiceMessages_(clock - 86400000, clock);
assert.deepEqual(stored.map(item => item.getPlainBody()), ['coming tonight', 'running late', 'see you'], 'oldest first, within the window');
assert.equal(stored[0].getSubject(), 'New text message from Ada Every (925) 555-0109');
assert.match(stored[0].getFrom(), /@txt\.voice\.google\.com>$/);
assert.equal(stored[0].getDate().getTime(), tonight);
assert.equal(calls, 0, 'reading stored texts costs no Gmail');
stored[2].reply('Confirmed.');
assert.deepEqual(replies, [{ id: stored[2].getId(), text: 'Confirmed.' }]);
assert.equal(calls, 1, 'a reply opens one message by id');

// A heavy day: past the daily mark the reader slows to every 5 minutes, and the desk log says so once.
grids.MailReader[1][3] = '5999';
clock += minutes(2);
ada.push(make('Ada Every', 'one more', clock - 5000));
assert.equal(read().texts, 1);
assert.deepEqual(deskLogs.map(entry => entry.slice(0, 2)), [['warn', 'gmail_reads_high']]);
clock += minutes(1);
assert.deepEqual(read(), { skipped: 'slowed' });
clock += minutes(5);
assert.equal(read().texts, 0);
assert.equal(deskLogs.length, 1);

// A new day starts the count again, logs yesterday's total, and drops texts older than 90 days.
grids.VoiceTexts.splice(1, 0, ['old', String(clock - 91 * 86400000), 'x', 'y', 'z']);
clock += 86400000;
read();
assert.equal(grids.MailReader[1][2], context.Utilities.formatDate(new Date(clock)));
assert.ok(Number(grids.MailReader[1][3]) < 10, 'the count starts again');
assert.deepEqual(deskLogs[1].slice(0, 2), ['step', 'mail_reader_day']);
assert.equal(texts().some(row => row[0] === 'old'), false, 'texts older than 90 days are dropped');
assert.ok(texts().length > 5, 'recent texts are kept');

// Gmail failing (its daily allowance spent): the trigger fails and says so once in 10 minutes; the desk carries on with
// the texts already recorded; nothing moves until Gmail answers again.
gmailDown = true;
clock += minutes(2);
const cursor = grids.MailReader[1][1];
assert.throws(() => context.readMail(), /too many times/);
clock += minutes(1);
assert.throws(() => context.readMail(), /too many times/);
assert.deepEqual(audits.filter(entry => entry[0] === 'mail_reader_failed').length, 1, 'logged once, not every minute');
assert.deepEqual(JSON.parse(JSON.stringify(context.readMailIfStale_(60000))), { skipped: 'failed' });
assert.ok(context.storedVoiceMessages_(0, clock).length > 5, 'the recorded texts are still there');
assert.equal(grids.MailReader[1][1], cursor, 'the reader picks up where it was once Gmail answers');
assert.equal(cache['mail-reading'], undefined, 'a failed read does not block the next one');
gmailDown = false;
clock += minutes(1);
assert.equal(read().texts, 0);

assert.equal(context.voiceBodyText_('<https://voice.google.com>\n\nHi\n  there \nGoogle LLC\nignored'), 'Hi\nthere');
console.log('Mail reader checks passed');
