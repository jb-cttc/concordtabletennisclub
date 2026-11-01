const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

// The one Gmail reader (MailReader.js), against a fake Gmail, Sheet and clock. Made-up names and 555 numbers only.
let clock = Date.parse('2026-10-26T23:00:00Z'); // Monday 4 PM Pacific: round robin sign-up, read every minute
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
    setFrozenRows() {},
    hideSheet() { hidden.push(name); },
    clearContents() { grid.length = 0; }
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
const hidden = [];
// The coaching and staffing apps' web addresses: each call is kept, and an app answers as a woken app does.
const wakes = [];
let appDown = false;
// Something a desk page's read records while the apps are being called.
let duringWake = null;
const wakeApp = request => {
  if (duringWake) { const run = duringWake; duringWake = null; run(); }
  const app = /AKfycbyw/.test(request.url) ? 'coaching' : 'staffing';
  const body = JSON.parse(request.payload);
  wakes.push({ app, body });
  if (appDown) return { getResponseCode: () => 500, getContentText: () => 'Error' };
  const answer = body.key === grids.AppWake[1][0] ? { ok: true, checked: body.mail > 0 || body.texts.some(text => /^(yes|no)/i.test(text.text)) } : { ok: false };
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify(answer) };
};
const audits = [];
// Made-up coaches: shown, an owner's exception (shown while Pending), and hidden while Pending.
const coachFetches = [];
let siteDown = false;
let coachFile = { showWhilePending: ['Pat Pending'], coaches: {
  'Ann Active': { status: 'USATT Certification Active', level: 'Coaching Level 1' },
  'Hal Hidden': { status: 'USATT Certification Pending', level: null, hidden: true, contact: 'h@example.com' },
  'Pat Pending': { status: 'USATT Certification Pending', level: null }
} };
let coachRuns = [];
const coachLogs = [];
// Timers as Google keeps them: { handler, every } for a repeating one, { handler, after } for a one-off. Until October
// 2026 the job had an every-minute timer, and so did the automatic answers; until November 2026 a 30-minute timer and a
// one-off for the next read. The first run removes them all.
let triggers = [{ handler: 'readMailWatch', every: 30 }, { handler: 'readMail', after: 300000 }, { handler: 'answerVoiceSignups', every: 1 }];
let triggerCalls = 0;
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
  // Every call to Google's timers is counted: each is slow, so a quiet run makes none.
  ScriptApp: {
    getProjectTriggers: () => { triggerCalls += 1; return triggers.map(trigger => ({ getHandlerFunction: () => trigger.handler, trigger })); },
    deleteTrigger: handle => { triggerCalls += 1; triggers = triggers.filter(trigger => trigger !== handle.trigger); },
    newTrigger: handler => ({ timeBased: () => ({
      everyMinutes: every => {
        assert.ok([1, 5, 10, 15, 30].includes(every), 'Google repeats a timer every 1, 5, 10, 15 or 30 minutes, not ' + every);
        return { create: () => { triggerCalls += 1; triggers.push({ handler, every }); } };
      }
    }) })
  },
  UrlFetchApp: {
    fetchAll: requests => requests.map(wakeApp),
    // The club site's coach file (CoachList.js): who the coaching page shows.
    fetch: url => {
      coachFetches.push(url);
      if (siteDown) return { getResponseCode: () => 503, getContentText: () => '' };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(coachFile) };
    }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => (key in properties ? properties[key] : null), setProperty: (key, value) => { properties[key] = String(value); }, deleteProperty: key => { delete properties[key]; } }) },
  // Pacific (PDT) wall clock, for the October dates used here.
  Utilities: {
    formatDate: (date, zone, pattern) => {
      const pacific = new Date(date.getTime() - 7 * 3600000);
      return pattern === 'H' ? String(pacific.getUTCHours()) : pattern === 'm' ? String(pacific.getUTCMinutes()) : pacific.toISOString().slice(0, 10);
    },
    getUuid: () => crypto.randomUUID()
  },
  Session: { getScriptTimeZone: () => 'America/Los_Angeles', getEffectiveUser: () => ({ getEmail: () => 'Club@example.com' }) },
  // The coach list's own lines are kept apart: they come once at the first read, whatever the mail.
  deskLog_: (...args) => (args[1] === 'coach_list_changed' ? coachLogs : deskLogs).push(args),
  appendAudit_: (...args) => audits.push(args),
  safeAudit_: (...args) => audits.push(args)
};
const make = (...args) => { const item = (args[0] === 'zeffy' ? message('Play pass', args[1], args[2], 'Zeffy <contact@communication.mailer.zeffy.com>') : voice(...args)); item.when = new Date(args[args.length - 1]).toISOString(); return item; };
let cache = {};
let zeffyRows = [];
let gmailDown = false;
vm.createContext(context);
// The round robin days and sign-up hours come from the desk's automatic answers.
for (const file of ['VoiceAutoReply.js', 'MailReader.js', 'JobRuntime.js', 'CoachList.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context);
// What a read found; the job also says what the automatic answers did (off here), and which apps it woke (woke).
let woke = null;
const read = event => {
  const result = JSON.parse(JSON.stringify(context.readMail(event)));
  if (result.answered) assert.deepEqual(result.answered, { skipped: 'off' });
  woke = result.woke || null;
  if (result.coaches) coachRuns.push(result.coaches);
  delete result.coaches;
  delete result.answered;
  delete result.woke;
  return result;
};
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
assert.match(searches[0], /^in:anywhere \(from:txt\.voice\.google\.com OR from:communication\.mailer\.zeffy\.com OR subject:"CTTC ref" OR subject:"CTTC shift"\) after:\d+$/,
  'one search for texts, Zeffy and replies to the apps\' questions, Trash and Spam included');
assert.deepEqual(timers(), ['readMail every 1'], 'the old timers are gone: one timer, every minute (round robin sign-up)');
assert.equal(texts()[texts().length - 1][4], 'coming tonight', 'Voice links and footer are taken out');
assert.equal(zeffyRows.length, 1);
assert.equal(grids.MailReader[1][3], String(first.gmailCalls), 'Gmail calls are counted for the day');

// A quiet minute: one search, nothing opened, no timer changed, no app called.
clock += minutes(1);
calls = 0;
triggerCalls = 0;
wakes.length = 0;
assert.deepEqual(read(), { texts: 0, zeffy: 0, gmailCalls: 1 });
assert.equal(calls, 1, 'a quiet minute costs one Gmail call');
assert.equal(triggerCalls, 0, 'and no call to Google\'s timers');
assert.equal(wakes.length, 0, 'and wakes no app');
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
triggers = [];
context.readMailIfStale_(60000);
assert.deepEqual(timers(), ['readMail every 1'], 'the desk puts back a missing timer');
cache = {};
context.readMailIfStale_(60000);
assert.deepEqual(timers(), ['readMail every 1'], 'never twice');
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

// Gmail is read only as often as texts matter: every minute in the 4 hours before a round robin's sign-up closes (3:15 to
// 7:15 PM; 11:15 AM to 3:15 PM for the Saturday pilot from October 31), every 30 minutes from 11 PM to 7 AM, and every 5
// minutes otherwise, including from 6 AM on a round robin day.
const pt = (date, time) => Date.parse(date + 'T' + time + ':00Z') + 7 * 3600000;
const every = (date, time) => context.mailReadEvery_(new Date(pt(date, time))) / 60000;
assert.equal(every('2026-10-26', '05:59'), 30, 'night');
assert.equal(every('2026-10-26', '06:00'), 5, 'a round robin day from 6 AM, when the automatic answers start');
assert.equal(every('2026-10-26', '07:00'), 5, 'Monday morning');
assert.equal(every('2026-10-26', '15:14'), 5);
assert.equal(every('2026-10-26', '15:15'), 1, 'every minute for the last 4 hours of sign-up');
assert.equal(every('2026-10-26', '19:14'), 1);
assert.equal(every('2026-10-26', '19:15'), 5, 'after sign-up closes');
assert.equal(every('2026-10-26', '23:00'), 30, '11 PM');
assert.equal(every('2026-10-27', '06:59'), 30);
assert.equal(every('2026-10-27', '12:00'), 5, 'Tuesday: no round robin');
assert.equal(every('2026-10-28', '12:00'), 5, 'Wednesday midday');
assert.equal(every('2026-10-28', '16:00'), 1, 'Wednesday afternoon');
assert.equal(every('2026-10-24', '12:00'), 5, 'no Saturday round robin before the pilot');
assert.equal(every('2026-10-31', '11:14'), 5, 'the Saturday pilot: 5 minutes in the morning');
assert.equal(every('2026-10-31', '11:15'), 1, 'every minute from 11:15 AM');
assert.equal(every('2026-10-31', '12:00'), 1);
assert.equal(every('2026-10-31', '15:15'), 5);
// The timer repeats at the pace due now, and changes only when the pace does: every 30 minutes at night, every 5 by day,
// every minute during sign-up. A busier stretch starts on time: the timer speeds up a run ahead of it.
const pace = () => triggers.filter(trigger => trigger.handler === 'readMail').map(trigger => trigger.every);
clock = pt('2026-10-28', '01:00');
assert.equal(typeof read().gmailCalls, 'number');
assert.deepEqual(pace(), [30], 'every 30 minutes at night');
calls = 0;
triggerCalls = 0;
clock += minutes(1);
assert.deepEqual(read(), { skipped: 'fresh' }, 'a run sooner than due reads nothing');
assert.equal(calls, 0);
assert.equal(triggerCalls, 0, 'and changes no timer');
clock = pt('2026-10-28', '05:45');
read();
assert.deepEqual(pace(), [5], 'Wednesday 5:45 AM: every 5 minutes, so the first read after 6:00, when sign-up opens, is on time');
clock = pt('2026-10-28', '06:00');
read();
assert.deepEqual(pace(), [5]);
clock = pt('2026-10-28', '15:10');
read();
assert.deepEqual(pace(), [5]);
clock = pt('2026-10-28', '15:12');
read();
assert.deepEqual(pace(), [1], 'every minute from the run before 3:15 PM');
assert.equal(triggers.length, 1, 'one timer: the new one replaces the old');
clock = pt('2026-10-28', '15:13');
assert.deepEqual(read(), { skipped: 'fresh' }, 'reads stay 5 minutes apart until 3:15');
clock = pt('2026-10-28', '15:15');
read();
assert.deepEqual(pace(), [1], 'then every minute until sign-up closes');
clock = pt('2026-10-28', '19:12');
read();
assert.deepEqual(pace(), [1]);
clock = pt('2026-10-28', '19:15');
read();
assert.deepEqual(pace(), [5], 'after sign-up closes, every 5 minutes');
clock = pt('2026-11-03', '12:00');
read();
assert.deepEqual(pace(), [5], 'Tuesday midday');
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
assert.equal(context.mailTimerEvery_(new Date(pt('2026-11-03', '13:00')), true), 15, 'and the timer follows');
assert.equal(context.mailTimerEvery_(new Date(pt('2026-11-04', '16:00')), true), 5, 'sign-up: every 3 minutes is not a pace Google repeats, so every 5');
// A desk with Voice signups open still reads within the minute, night or day.
clock += minutes(2);
assert.equal(typeof context.readMailIfStale_(60000).gmailCalls, 'number');
clock = pt('2026-11-03', '22:57');
read();
assert.deepEqual(pace(), [15], 'until 11 PM every 15 minutes (today is slowed)');
clock = pt('2026-11-03', '23:00');
read();
assert.deepEqual(pace(), [30], 'from 11 PM, every 30');
properties.CTTC_JOB_RUNTIME = JSON.stringify({ day: '2026-11-04', runs: 0, ms: 0, reportedAt: Date.now(), slow: false });

// Waking the coaching and staffing apps. A new text wakes both at once, with the desk's key and what came in; the key is
// made the first time, in a hidden tab the apps can open.
const answered = () => wakes.map(entry => entry.app + ':' + entry.body.mail + ':' + entry.body.texts.map(text => text.text).join('|'));
clock = pt('2026-11-04', '10:00');
wakes.length = 0;
ada.push(make('Ada Every', 'YES', clock - 5000));
assert.equal(read().texts, 1);
assert.deepEqual(answered(), ['coaching:0:YES', 'staffing:0:YES']);
assert.deepEqual(woke, { coaching: 'checked', staffing: 'checked' });
assert.match(grids.AppWake[1][0], /^[0-9a-f]{64}$/, 'a long random key');
assert.ok(wakes.every(entry => entry.body.key === grids.AppWake[1][0] && entry.body.fn === 'wake'));
assert.deepEqual(hidden.filter(name => name !== 'CoachList'), ['AppWake'], 'the key\'s tab is hidden');
assert.equal(properties.CTTC_WAKE_coaching, undefined, 'nothing left to tell');
// A text that is no answer: the apps say there is nothing to check.
clock += minutes(5);
wakes.length = 0;
ada.push(make('Ada Every', 'running late', clock - 5000));
read();
assert.deepEqual(woke, { coaching: 'nothing to check', staffing: 'nothing to check' });
// An email reply to a coaching question wakes coaching only, and is not recorded as a text or a payment. Our own question
// in the thread wakes nothing; a reply already seen (within the search's overlap) is not passed on twice.
const question = message('Confirm your coaching request [CTTC ref 0A1B2C3D4E]', 'Reply YES', clock - minutes(10), 'Concord Table Tennis Club <club@example.com>');
question.when = new Date(clock - minutes(10)).toISOString();
const reply = message('Re: Confirm your coaching request [CTTC ref 0A1B2C3D4E]', 'YES', clock + minutes(4), 'Student <student@example.com>');
reply.when = new Date(clock + minutes(4)).toISOString();
const asked = [question];
threads.push(asked);
clock += minutes(1);
wakes.length = 0;
const textsBefore = texts().length;
const zeffyBefore = zeffyRows.length;
read();
assert.deepEqual(wakes, [], 'our own question wakes nothing');
clock += minutes(4);
asked.push(reply);
read();
assert.deepEqual(answered(), ['coaching:1:']);
assert.equal(texts().length, textsBefore, 'not recorded as a text');
assert.equal(zeffyRows.length, zeffyBefore, 'nor as a payment');
clock += minutes(5);
wakes.length = 0;
grids.MailReader[1][1] = String(clock - minutes(2));
read();
assert.deepEqual(wakes, [], 'a reply already passed on is not passed on again');
// The club's answer to a staffing approval comes from this account, as a reply: it wakes staffing.
const approval = message('Approve an email for staff sign-ups [CTTC shift 1A2B3C4D5E]', 'Reply YES', clock - minutes(30), 'Concord Table Tennis Club <club@example.com>');
approval.when = new Date(clock - minutes(30)).toISOString();
const clubYes = message('Re: Approve an email for staff sign-ups [CTTC shift 1A2B3C4D5E]', 'YES', clock + minutes(4), 'club@example.com');
clubYes.when = new Date(clock + minutes(4)).toISOString();
threads.push([approval, clubYes]);
clock += minutes(5);
wakes.length = 0;
read();
assert.deepEqual(answered(), ['staffing:1:']);
// What a desk page's read finds wakes the apps at the job's next run, not during the page's call.
clock += minutes(5);
wakes.length = 0;
ada.push(make('Ada Every', 'NO', clock - 5000));
assert.equal(context.readMailIfStale_(60000).texts, 1);
assert.deepEqual(wakes, [], 'a page never waits on the apps');
clock += minutes(1);
read();
assert.deepEqual(answered(), ['coaching:0:NO', 'staffing:0:NO']);
// A desk page's read that records a text while the apps are being called: that text still wakes them, at the next run.
clock += minutes(5);
ada.push(make('Ada Every', 'YES', clock - 5000));
duringWake = () => context.noteWake_([{ from: 'x', subject: 'New text message from Late Text', text: 'NO' }], {});
read();
assert.ok(properties.CTTC_WAKE_coaching && /Late Text/.test(properties.CTTC_WAKE_coaching), 'the newer text is kept');
clock += minutes(5);
wakes.length = 0;
read();
assert.deepEqual(answered(), ['coaching:0:YES|NO', 'staffing:0:YES|NO'], 'and passed on at the next run, with what was sent before (a second look costs nothing)');
assert.equal(properties.CTTC_WAKE_coaching, undefined);
// A busy minute: at most 10 texts are passed on, each cut to its start, and the app is told there were more.
clock += minutes(5);
wakes.length = 0;
for (let index = 0; index < 12; index += 1) ada.push(make('Ada Every', 'text ' + index + ' ' + 'x'.repeat(300), clock - 5000 + index));
read();
assert.equal(wakes[0].body.texts.length, 10);
assert.equal(wakes[0].body.more, true);
assert.ok(wakes[0].body.texts.every(text => text.text.length === 120));
// An app that does not answer is tried at the next runs; after 3 failed tries it is left to its hourly check, and the desk
// log says so once an hour.
appDown = true;
clock += minutes(5);
wakes.length = 0;
ada.push(make('Ada Every', 'YES', clock - 5000));
read();
assert.deepEqual(woke, { coaching: 'failed', staffing: 'failed' });
assert.ok(properties.CTTC_WAKE_coaching, 'kept for the next run');
clock += minutes(5);
read();
clock += minutes(5);
read();
assert.equal(wakes.length, 6, 'three tries each');
assert.equal(properties.CTTC_WAKE_coaching, undefined, 'then dropped');
assert.deepEqual(deskLogs.filter(entry => entry[1] === 'app_wake_failed').map(entry => entry[0]), ['warn']);
clock += minutes(5);
wakes.length = 0;
read();
assert.deepEqual(wakes, [], 'nothing new, nothing to try');
appDown = false;
// A new day logs the day's calls by app.
clock = pt('2026-11-05', '10:00');
ada.push(make('Ada Every', 'YES', clock - 5000));
read();
const day = deskLogs.filter(entry => entry[1] === 'app_wakes_day').pop();
assert.equal(day[2], '2026-11-04');
assert.match(day[4], /^coaching=7 staffing=7 coaching_failed=3 staffing_failed=3$/);

// ---- Hourly, the desk copies who the coaching page shows to the hidden CoachList tab, for the coaching app ----
{
  const shown = () => grids.CoachList.map(line => line[0]);
  assert.deepEqual(shown(), ['shown_coach', 'Ann Active', 'Pat Pending'], 'hidden coaches are left out, in page order');
  assert.ok(hidden.includes('CoachList'), 'the tab is hidden, like AppWake');
  assert.ok(coachFetches.length >= 1 && coachFetches.every(url => url === 'https://concordtabletennisclub.com/data/coach-certifications.json'));
  const fetches = coachFetches.length;
  coachRuns = [];
  read();
  assert.equal(coachFetches.length, fetches, 'at most once an hour: a run within the hour reads nothing');
  assert.deepEqual(coachRuns, []);
  const due = () => { delete cache['coach-list-checked']; coachRuns = []; read(); return coachRuns[0]; };
  assert.deepEqual(due(), { unchanged: 2 }, 'an unchanged list writes nothing');
  const logged = coachLogs.length;
  coachFile.coaches['Hal Hidden'] = { status: 'USATT Certification Active', level: 'Coaching Level 1' };
  assert.deepEqual(due(), { changed: 3 });
  assert.deepEqual(shown(), ['shown_coach', 'Ann Active', 'Hal Hidden', 'Pat Pending'], 'a coach certified since comes back');
  assert.equal(coachLogs.length, logged + 1, 'each change is in the desk log');
  coachFile.coaches['Pat Pending'].hidden = true;
  assert.deepEqual(due(), { changed: 2 });
  assert.deepEqual(shown(), ['shown_coach', 'Ann Active', 'Hal Hidden'], 'a shorter list leaves no old rows behind');
  siteDown = true;
  assert.deepEqual(due(), { skipped: 'site returned 503' });
  siteDown = false;
  const good = coachFile;
  coachFile = { coaches: {} };
  assert.deepEqual(due(), { skipped: 'coach file unreadable' }, 'a broken file never switches every coach off');
  coachFile = good;
  assert.deepEqual(shown(), ['shown_coach', 'Ann Active', 'Hal Hidden'], 'the last good list is kept');
}

assert.equal(context.voiceBodyText_('<https://voice.google.com>\n\nHi\n  there \nGoogle LLC\nignored'), 'Hi\nthere');
console.log('Mail reader checks passed');
