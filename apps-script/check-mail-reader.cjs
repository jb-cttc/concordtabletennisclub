const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// The one Gmail reader (MailReader.js), against a fake Gmail, Sheet and clock. Made-up names and 555 numbers only.
let clock = Date.parse('2026-10-26T17:00:00Z');
const grids = {};
const sheets = {};
// Sheets reads a leading ' as "plain text" and does not store it.
const asStored = value => (typeof value === 'string' && value[0] === "'" ? value.slice(1) : value);
const makeSheet = name => {
  const grid = grids[name] = [];
  const range = (row, column, rows, columns) => {
    const handle = {
      getValues: () => Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => (grid[row - 1 + r] || [])[column - 1 + c] ?? '')),
      setValues: values => {
        // The reader's own tabs hold ids and times, written as plain text; the run-time tab holds counts.
        const text = name !== 'JobRuntime';
        if (text) assert.ok(handle.text || row === 1, 'cells are plain text before they are written');
        values.forEach((line, r) => line.forEach((value, c) => {
          if (text) assert.equal(typeof value, 'string', 'every value is written as text');
          (grid[row - 1 + r] = grid[row - 1 + r] || [])[column - 1 + c] = asStored(value);
        }));
        return handle;
      },
      setNumberFormat: format => { assert.equal(format, '@'); handle.text = true; return handle; },
      setFontWeight: () => handle
    };
    return handle;
  };
  return {
    getDataRange: () => ({ getValues: () => grid.map(line => line.slice()) }),
    getLastRow: () => grid.length,
    getMaxRows: () => Math.max(1000, grid.length),
    insertRowsAfter() {},
    getRange: range,
    appendRow: values => { grid.push(values.map(asStored)); },
    deleteRow: row => { grid.splice(row - 1, 1); },
    deleteRows: (row, count) => { grid.splice(row - 1, count); },
    setFrozenRows() {}
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
// Timers as Google keeps them: { handler, every } for a repeating one, { handler, after } for a one-off. Until October
// 2026 the job had an every-minute timer, and so did the automatic answers: the first run removes both.
let triggers = [{ handler: 'readMail', every: 1 }, { handler: 'answerVoiceSignups', every: 1 }];
const properties = {};
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
    getProjectTriggers: () => triggers.map(trigger => ({ getHandlerFunction: () => trigger.handler, trigger })),
    deleteTrigger: handle => { triggers = triggers.filter(trigger => trigger !== handle.trigger); },
    newTrigger: handler => ({ timeBased: () => ({
      everyMinutes: every => ({ create: () => { triggers.push({ handler, every }); } }),
      after: after => ({ create: () => { triggers.push({ handler, after }); } })
    }) })
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => (key in properties ? properties[key] : null), setProperty: (key, value) => { properties[key] = String(value); }, deleteProperty: key => { delete properties[key]; } }) },
  // Pacific (PDT) wall clock, for the October dates used here.
  Utilities: {
    formatDate: (date, zone, pattern) => {
      const pacific = new Date(date.getTime() - 7 * 3600000);
      return pattern === 'H' ? String(pacific.getUTCHours()) : pattern === 'm' ? String(pacific.getUTCMinutes()) : pacific.toISOString().slice(0, 10);
    }
  },
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
// The round robin days and sign-up hours come from the desk's automatic answers.
for (const file of ['VoiceAutoReply.js', 'MailReader.js', 'JobRuntime.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context);
// What a read found; the job also says what the automatic answers did (off here).
const read = event => { const result = JSON.parse(JSON.stringify(context.readMail(event))); if (result.answered) assert.deepEqual(result.answered, { skipped: 'off' }); delete result.answered; return result; };
const timers = () => triggers.map(trigger => trigger.handler + (trigger.every ? ' every ' + trigger.every : ' after ' + trigger.after / 60000)).sort();
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
assert.deepEqual(timers(), ['readMail after 1', 'readMailWatch every 30'], 'the old every-minute timers are gone: a 30-minute timer, and the next read a minute away on a round robin day');
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
clock += minutes(2);
assert.equal(context.readMailIfStale_(60000).texts, 0);
cache = {};
triggers = triggers.filter(trigger => trigger.handler !== 'readMailWatch');
context.readMailIfStale_(60000);
assert.deepEqual(timers().filter(timer => /Watch/.test(timer)), ['readMailWatch every 30'], 'the desk puts back a missing 30-minute timer');
cache = {};
context.readMailIfStale_(60000);
assert.equal(triggers.filter(trigger => trigger.handler === 'readMailWatch').length, 1, 'never twice');
assert.deepEqual(audits.map(entry => entry[0]), ['mail_reader_enabled', 'mail_reader_enabled']);

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
clock += minutes(6);
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

// Gmail is read only as often as texts matter: every minute on a round robin day until sign-up closes (7:15 PM, 3:15 PM
// for the Saturday pilot from October 31), every 30 minutes from 11 PM to 7 AM, and every 5 minutes otherwise.
const pt = (date, time) => Date.parse(date + 'T' + time + ':00Z') + 7 * 3600000;
const every = (date, time) => context.mailReadEvery_(new Date(pt(date, time))) / 60000;
assert.equal(every('2026-10-26', '05:59'), 30, 'night');
assert.equal(every('2026-10-26', '06:00'), 1, 'a round robin day from 6 AM, when the automatic answers start');
assert.equal(every('2026-10-26', '07:00'), 1, 'Monday morning: a round robin day');
assert.equal(every('2026-10-26', '19:14'), 1);
assert.equal(every('2026-10-26', '19:15'), 5, 'after sign-up closes');
assert.equal(every('2026-10-26', '23:00'), 30, '11 PM');
assert.equal(every('2026-10-27', '06:59'), 30);
assert.equal(every('2026-10-27', '12:00'), 5, 'Tuesday: no round robin');
assert.equal(every('2026-10-28', '12:00'), 1, 'Wednesday');
assert.equal(every('2026-10-24', '12:00'), 5, 'no Saturday round robin before the pilot');
assert.equal(every('2026-10-31', '12:00'), 1, 'the Saturday pilot');
assert.equal(every('2026-10-31', '15:15'), 5);
// Each run sets the one-off timer for the next read: none at night (the 30-minute timer covers it), and never past the
// start of a busier stretch.
const nextAfter = () => triggers.filter(trigger => trigger.handler === 'readMail').map(trigger => trigger.after / 60000);
clock = pt('2026-10-28', '01:00');
assert.equal(typeof read().gmailCalls, 'number');
assert.deepEqual(nextAfter(), [], 'no one-off timer at night');
calls = 0;
clock += minutes(1);
assert.deepEqual(read(), { skipped: 'fresh' }, 'a run sooner than due reads nothing');
assert.equal(calls, 0);
clock = pt('2026-10-28', '05:45');
read();
assert.deepEqual(nextAfter(), [15], 'Wednesday 5:45 AM: next at 6:00, when sign-up opens');
clock = pt('2026-10-28', '06:00');
read();
assert.deepEqual(nextAfter(), [1], 'then every minute');
clock = pt('2026-10-28', '19:12');
read();
assert.deepEqual(nextAfter(), [1]);
clock = pt('2026-10-28', '19:15');
read();
assert.deepEqual(nextAfter(), [5], 'after sign-up closes, every 5 minutes');
clock = pt('2026-11-03', '12:00');
read();
assert.deepEqual(nextAfter(), [5], 'Tuesday midday');
// A timer run is measured (a page's read is not), toward the 90 minutes every app's timers share (JobRuntime.js).
clock += minutes(6);
read({ triggerUid: 't1' });
assert.equal(JSON.parse(properties.CTTC_JOB_RUNTIME).runs, 1, 'one timer run counted');
assert.deepEqual(JSON.parse(JSON.stringify(grids.JobRuntime[1].slice(0, 3))), ['desk', '2026-11-03', 1], 'and reported to the JobRuntime tab');
// Once every app's timers together have run an hour today, the desk reads a third as often.
grids.JobRuntime.push(['coaching', '2026-11-03', 900, 3700, '']);
properties.CTTC_JOB_RUNTIME = JSON.stringify(Object.assign(JSON.parse(properties.CTTC_JOB_RUNTIME), { reportedAt: 0 }));
clock += minutes(6);
read({ triggerUid: 't2' });
assert.equal(JSON.parse(properties.CTTC_JOB_RUNTIME).slow, true);
assert.deepEqual(deskLogs.filter(entry => entry[1] === 'trigger_time_high').map(entry => entry[0]), ['warn'], 'the desk log warns once');
assert.equal(context.mailReadEvery_(new Date(pt('2026-11-03', '13:00'))) / 60000, 15, 'every 15 minutes instead of 5');
assert.equal(context.mailReadEvery_(new Date(pt('2026-11-03', '23:30'))) / 60000, 30, 'the night stays at 30');
// A desk with Voice signups open still reads within the minute, night or day.
clock += minutes(2);
assert.equal(typeof context.readMailIfStale_(60000).gmailCalls, 'number');
clock = pt('2026-11-03', '22:57');
read();
assert.deepEqual(nextAfter(), [], 'from 11 PM the 30-minute timer alone');

assert.equal(context.voiceBodyText_('<https://voice.google.com>\n\nHi\n  there \nGoogle LLC\nignored'), 'Hi\nthere');
console.log('Mail reader checks passed');
