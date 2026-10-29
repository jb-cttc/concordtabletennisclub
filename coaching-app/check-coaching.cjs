const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

// Synthetic people only (example.com): real names and addresses never belong in the repository.
const manifest = JSON.parse(fs.readFileSync(__dirname + '/appsscript.json', 'utf8'));
assert.deepEqual(manifest.oauthScopes, [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/script.send_mail',
  'https://www.googleapis.com/auth/script.scriptapp',
  'https://www.googleapis.com/auth/userinfo.email'
]);
assert.equal(manifest.webapp.access, 'ANYONE_ANONYMOUS');
assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING', 'visitors never need Google access: the app acts as the owner');

const source = fs.readFileSync(__dirname + '/Code.js', 'utf8');
const globals = [...source.matchAll(/^function ([A-Za-z0-9]+)\(/gm)].map(match => match[1]);
assert.deepEqual(globals.filter(name => !name.endsWith('_')).sort(), [
  'checkTexts', 'checkTextsWatch', 'coachBoard', 'coachList', 'coachPropose', 'doGet', 'doPost', 'joinWaitlist', 'openSlots', 'requestSlot', 'setup', 'studentChange', 'sweep'
], 'a public web app exposes every non-private function: only these may exist');

// ---- Fakes ----
const START = Date.parse('2026-10-02T17:00:00Z'); // Friday 10:00 AM Pacific (PDT)
let clock = START;
class FakeDate extends Date { static now() { return clock; } }
const grids = {};
const textFormatted = new Set();
const cleared = [];
const books = {};
const created = [];
const properties = {};
const sent = [];
const allSent = [];
let quota = 100;
let mailFails = false;
let quotaThrows = false;
let cache = {};
let held = 0;
let userHeld = false;
let overlap = null;
const logs = [];
let activeEmail = '';
// Timers as Google keeps them: { handler, every } repeats, { handler, after } fires once.
let triggers = [];
const timers = () => triggers.map(trigger => trigger.handler + (trigger.every ? ' every ' + trigger.every : ' after ' + trigger.after / 60000)).sort();
const makeSheet = name => {
  grids[name] = grids[name] || [];
  const grid = grids[name];
  const range = (row, column, rows, columns) => {
    const handle = {
      getValues: () => { const out = []; for (let r = 0; r < rows; r += 1) out.push(Array.from({ length: columns }, (_, c) => (grid[row - 1 + r] || [])[column - 1 + c] ?? '')); return out; },
      setValues: values => {
        values.forEach((line, r) => {
          for (let c = 0; c < line.length; c += 1) {
            if (row + r > 1) assert.ok(textFormatted.has(name + ':' + (row + r)), 'cells are formatted as plain text before they are written');
            (grid[row - 1 + r] = grid[row - 1 + r] || [])[column - 1 + c] = line[c];
          }
        });
        return handle;
      },
      setNumberFormat: format => { assert.equal(format, '@'); for (let r = 0; r < rows; r += 1) textFormatted.add(name + ':' + (row + r)); return handle; },
      setFontWeight: () => handle
    };
    return handle;
  };
  return {
    getLastRow: () => grid.length,
    getDataRange: () => ({ getValues: () => grid.map(line => line.slice()) }),
    getRange: range,
    deleteRow: row => { grid.splice(row - 1, 1); },
    deleteRows: (row, count) => { grid.splice(row - 1, count); },
    // Sheets reads a leading ' as "plain text" and does not store it.
    appendRow: values => { grid.push(Array.from(values, value => { assert.equal(String(value)[0], "'", 'appended values are kept as plain text'); return String(value).slice(1); })); },
    clearContents: () => { cleared.push(name); grid.length = 0; },
    setFrozenRows: () => {}
  };
};
const makeBook = id => {
  const sheets = {};
  return (books[id] = {
    getSheetByName: name => sheets[name] || null,
    insertSheet: name => (sheets[name] = makeSheet(name)),
    getSheets: () => Object.keys(sheets),
    deleteSheet: () => {},
    getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
    getName: () => books[id].title || '',
    rename: title => { assert.doesNotMatch(title, /@|\d{3}\) \d{3}-|Student |Coach /, 'the status read-out holds counts only'); books[id].title = title; },
    names: () => Object.keys(sheets).sort()
  });
};
const pacific = ms => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day + ' ' + parts.hour + ':' + parts.minute;
};
const base64 = bytes => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const templates = [];
// Google Voice forwards each text to Gmail; a Gmail reply to it goes back out as a text.
const inbox = [];
const replies = [];
const mailbox = [];
const gmailQueries = [];
let voiceDown = false;
let messageCount = 0;
const voiceFrom = '"Dee Coach (SMS)" <19255550100.19255550142.abc@txt.voice.google.com>';
const otherFrom = '"Someone Else (SMS)" <19255550100.19255550177.abc@txt.voice.google.com>';
const inbound = (subjectName, body, at = clock, from = voiceFrom) => {
  const id = 'm' + messageCount++;
  inbox.push({
    getId: () => id, getFrom: () => from, getReplyTo: () => from, getSubject: () => 'New text message from ' + subjectName,
    getPlainBody: () => '<https://voice.google.com>\n' + body + '\nTo respond to this text message, reply to this email or visit Google Voice.\nYOUR ACCOUNT <https://voice.google.com>',
    getDate: () => new Date(at), reply: text => { replies.push({ subject: 'New text message from ' + subjectName, body: text }); }
  });
};
// The desk's Sheet, where its one mail reader records every forwarded text (apps-script/MailReader.js): the app reads texts
// there, never by searching Gmail. Here the tab simply holds the inbox; readerStopped is a desk that stopped collecting.
let readerStopped = false;
let runtimeGrid = null;
// The desk's key for waking the app (apps-script/MailReader.js wakeKey_), in a hidden tab of its Sheet.
const WAKE_KEY = 'f'.repeat(64);
let textReads = 0;
books['desk-sheet-id'] = {
  getSheetByName: name => ({
    VoiceTexts: {
      getDataRange: () => ({ getValues: () => {
        textReads += 1;
        if (voiceDown) throw new Error('Google Voice is unavailable');
        return [['message_id', 'received_at', 'from', 'subject', 'text']].concat(inbox.map(message => [message.getId(), String(message.getDate().getTime()), message.getFrom(), message.getSubject(), message.getPlainBody()]));
      } })
    },
    MailReader: { getLastRow: () => 2, getRange: () => ({ getValues: () => [[String(readerStopped ? clock - 46 * 60000 : clock - 30 * 60000)]] }) },
    AppWake: { getLastRow: () => 2, getRange: (row, column) => ({ getValues: () => [[row === 2 && column === 1 ? WAKE_KEY : 'key']] }) },
    // Every app's timer run time for the day (the desk's apps-script/JobRuntime.js); absent until the desk makes it.
    JobRuntime: runtimeGrid && {
      getDataRange: () => ({ getValues: () => runtimeGrid.map(line => line.slice()) }),
      getRange: row => ({ setValues: values => { runtimeGrid[row - 1] = values[0].map(value => String(value).replace(/^'/, '')); } }),
      appendRow: values => { runtimeGrid.push(values.map(value => String(value).replace(/^'/, ''))); }
    }
  }[name] || null)
};
properties.DESK_SHEET_ID = 'desk-sheet-id';
const context = {
  Date: FakeDate, Math, Number, String, JSON, Object, console: { error: () => {}, log: line => { logs.push(line); } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) },
  SpreadsheetApp: {
    create: name => {
      const id = /public/.test(name) ? 'public-book-id' : /status/.test(name) ? 'status-book-id' : 'private-book-id';
      created.push(name);
      const book = makeBook(id);
      return Object.assign({ getId: () => id }, book);
    },
    openById: id => { assert.ok(books[id], 'only the two Sheets the app made, and the desk Sheet, are opened'); return books[id]; }
  },
  Session: { getActiveUser: () => ({ getEmail: () => activeEmail }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
  ScriptApp: {
    getProjectTriggers: () => triggers.map(trigger => ({ getHandlerFunction: () => trigger.handler, trigger })),
    deleteTrigger: handle => { triggers = triggers.filter(trigger => trigger !== handle.trigger); },
    newTrigger: handler => ({ timeBased: () => ({
      everyHours: hours => ({ create: () => { triggers.push({ handler, every: hours * 60 }); } }),
      everyMinutes: every => ({ create: () => { triggers.push({ handler, every }); } }),
      after: after => ({ create: () => { triggers.push({ handler, after }); } })
    }) })
  },
  LockService: {
    getScriptLock: () => ({ waitLock: () => { assert.equal(held, 0, 'locks are never nested'); held += 1; }, releaseLock: () => { held -= 1; } }),
    getUserLock: () => ({ tryLock: () => (userHeld ? false : (userHeld = true)), releaseLock: () => { userHeld = false; } })
  },
  CacheService: { getScriptCache: () => ({ get: key => cache[key] || null, put: (key, value) => { cache[key] = value; }, remove: key => { delete cache[key]; } }) },
  MailApp: {
    getRemainingDailyQuota: () => { if (quotaThrows) throw new Error('Service invoked too many times'); return quota; },
    sendEmail: message => { if (mailFails) throw new Error('mail refused'); sent.push(message); allSent.push(message); }
  },
  GmailApp: {
    getInboxUnreadCount: () => 0,
    getMessageById: id => inbox.find(message => message.getId() === id),
    search: query => {
      gmailQueries.push(query);
      // Emailed answers: replies whose subject carries a [CTTC ref] code.
      const replies = query.match(/^newer_than:3d subject:"CTTC ref" -from:me after:(\d+)$/);
      if (replies) {
        // A run that is still reading mail when the next minute's trigger fires.
        if (overlap) { const next = overlap; overlap = null; next(); }
        // Gmail returns threads with a message from someone else after that moment; ours are never in the mailbox.
        const found = mailbox.filter(message => message.getDate().getTime() >= Number(replies[1]) * 1000);
        return found.length ? [{ getMessages: () => mailbox.slice() }] : [];
      }
      if (voiceDown) throw new Error('Google Voice is unavailable');
      assert.match(query, /^in:anywhere from:txt\.voice\.google\.com newer_than:\d+d \((subject:"[A-Za-z ]+" OR "\(\d{3}\) \d{3}-\d{4}"|subject:"[A-Za-z ]+"|"\(\d{3}\) \d{3}-\d{4}"|STUDENT OR STOP)\)$/);
      return inbox.length ? [{ getMessages: () => inbox.slice() }] : [];
    }
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    base64Encode: text => Buffer.from(text, 'utf8').toString('base64'),
    getUuid: () => crypto.randomUUID(),
    computeDigest: (algorithm, value) => Array.from(crypto.createHash(algorithm).update(value).digest()),
    computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256', key).update(value).digest()),
    base64EncodeWebSafe: input => base64(typeof input === 'string' ? Buffer.from(input, 'utf8') : input),
    base64DecodeWebSafe: text => Array.from(Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
    formatDate: (date, zone, format) => { assert.equal(zone, 'America/Los_Angeles'); assert.equal(format, 'yyyy-MM-dd HH:mm'); return pacific(date.getTime()); }
  },
  ContentService: {
    MimeType: { JSON: 'JSON' },
    createTextOutput: text => { const output = { text, setMimeType: type => { output.type = type; return output; } }; return output; }
  },
  HtmlService: {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createTemplateFromFile: name => {
      const template = { name, evaluate: () => {
        let content = fs.readFileSync(__dirname + '/' + name + '.html', 'utf8');
        const output = { template, getContent: () => content, setContent: value => { content = value; return output; }, setTitle: () => output, addMetaTag: () => output, setXFrameOptionsMode: () => output };
        return output;
      } };
      templates.push(template);
      return template;
    }
  }
};
vm.createContext(context);
vm.runInContext(source, context);
// Keep every log line until the trimming check, so earlier checks can read a booking's whole story.
const LOG_KEEP = context.LOG_KEEP;
context.LOG_KEEP = 1e6;
const run = (name, ...args) => JSON.parse(JSON.stringify(context[name](...args) ?? null));
const hours = count => count * 3600 * 1000;
const mailTo = (address, from = 0) => sent.slice(from).filter(message => message.to.toLowerCase() === address);
const column = (tab, name) => grids[tab][0].indexOf(name);
const cell = (tab, line, name) => line[column(tab, name)];
const requestRows = () => grids.Requests.slice(1);
const requestBy = email => requestRows().filter(line => cell('Requests', line, 'student_email') === email);
const weekday = date => new Date(date + 'T00:00:00Z').getUTCDay();
// Everything on the public Sheet is readable by anyone: first names only, never a full name, an address or a number.
const PRIVATE = /@|example|555-\d{4}|\b(Abe|Ann|Bob|Cy|Dee|Hal|Sam|Pia|Tex|Uma|Wes|Xia|Late|Outage) (Coach|Student)\b|Pat Other|Pat & Sam|Alex Kid|Rex Reminder|Lou Late|Val Voice|Lee Waits|Low Quota|Mail Fail|Quiet Failure|Quota Silent/;
const assertPublicIsAnonymous = () => {
  assert.doesNotMatch(JSON.stringify([grids.Schedule, grids.About]), PRIVATE, 'public Sheet leaks');
};
// The minute-by-minute trigger, without its 20 second and 10 minute throttles.
const check = () => { delete cache['check-texts']; delete cache['verify-coaches']; delete cache['student-texts']; context.checkTexts(); };
// A text from a phone. Each one arrives a minute after the last, the way real replies come after the question.
const say = (name, body, from) => { clock += 60000; inbound(name, body, clock, from); check(); };
const allTextsTo = (...names) => replies.filter(reply => names.some(name => reply.subject === 'New text message from ' + name)).map(reply => reply.body);
// The one-time "you are verified" reply is checked on its own, so the other texts keep their order.
const VERIFIED = /^CTTC: Thanks, you are verified as /;
const verifiedTo = (...names) => allTextsTo(...names).filter(body => VERIFIED.test(body));
const textsTo = (...names) => allTextsTo(...names).filter(body => !VERIFIED.test(body));
// An email reply, a minute after the last thing that happened. Only the From address, the subject and the first line matter.
const answerMail = (from, word, subject) => {
  clock += 60000;
  const at = clock;
  const id = 'e' + messageCount++;
  mailbox.push({ getId: () => id, getFrom: () => from, getSubject: () => 'Re: ' + subject, getDate: () => new Date(at),
    getPlainBody: () => word + '\n\nOn Fri, Oct 2, 2026 the club wrote:\n> Reply YES to this email' });
  check();
};
// The latest question we emailed to an address, by its subject.
const askedBy = (address, pattern = /./) => allSent.filter(message => message.to.toLowerCase() === address && /\[CTTC ref [0-9A-F]{10}\]$/.test(message.subject) && pattern.test(message.subject)).pop().subject;
const replyTo = (address, word, pattern) => answerMail(address, word, askedBy(address, pattern));
// A request, then the student's YES to our email: what reaches the coach.
const book = (form, address = form.email) => {
  const result = run('requestSlot', form);
  assert.equal(result.ok, true, result.message);
  replyTo(address.toLowerCase(), 'YES', /^Confirm your coaching request/);
  return result;
};
const latestRequest = email => requestBy(email).pop();
const statusOf = email => cell('Requests', latestRequest(email), 'status');
// The board key of the time a student's live request is on: what the page sends when they tap it.
const keyOf = email => {
  const request = requestBy(email).filter(line => /^(unverified|pending|confirmed)$/.test(cell('Requests', line, 'status'))).pop();
  const entry = grids.Availability.slice(1).find(line => ['coach_id', 'date', 'start'].every(name => cell('Availability', line, name) === cell('Requests', request, name)));
  return cell('Availability', entry, 'avail_id');
};
const cancelLesson = (email, contact = email) => {
  assert.equal(run('studentChange', { key: keyOf(email), action: 'cancel', contact }).ok, true);
  replyTo(email, 'YES', /^Confirm: cancel your lesson/);
};
const slot = (date, start, minutes, table = 1) => ({ date, start, minutes, table });
const coachRow = id => grids.Coaches.find(line => line[4] === id);
// The owner types a name, email and mobile number into the private Coaches tab. A coach with a number texts COACH once so the
// club can text back.
const addCoach = (name, email, phone = '', thread = true) => {
  grids.Coaches.push([name, email, phone, '', '', '', '', '', '', '', '']);
  run('coachList');
  if (phone && thread) inbound(name, 'COACH', clock - 60000);
  return grids.Coaches[grids.Coaches.length - 1][4];
};
const propose = (id, slots) => { cache = {}; return run('coachPropose', id, slots); };
const publish = (id, name, slots) => {
  const result = propose(id, slots);
  assert.equal(result.ok, true, result.message);
  say(name, 'YES');
  return result;
};
// A coach's whole current list, as the page would send it back.
const mine = id => run('coachBoard', id).board.filter(entry => entry.mine).map(entry => slot(entry.date, entry.start, entry.slot, entry.table));

// ---- Setup runs only for the owner, in the editor ----
assert.throws(() => context.setup(), /owner/, 'a web visitor cannot run setup');
activeEmail = 'owner@example.com';
const setupResult = JSON.parse(JSON.stringify(context.setup()));
assert.match(setupResult.privateSheet, /^https:\/\/docs\.google\.com\/spreadsheets\//);
assert.match(setupResult.publicSheet, /^https:\/\/docs\.google\.com\/spreadsheets\//);
assert.notEqual(setupResult.privateSheet, setupResult.publicSheet);
assert.equal(created.length, 2, 'one private and one public Sheet');
assert.deepEqual(books['private-book-id'].names(), ['Availability', 'Coaches', 'Log', 'Requests', 'Students', 'Waitlist'], 'the send log is a private tab');
assert.deepEqual(books['public-book-id'].names(), ['About', 'Schedule'], 'the public Sheet has only the schedule and a note');
assert.deepEqual(timers(), ['sweep every 60'], 'one timer: the hourly sweep, which runs the check too (the desk wakes it in between)');
context.setup();
assert.equal(created.length, 2, 'setup is safe to run again');
assert.deepEqual(grids.Coaches.slice(1).map(line => [line[0], line[1], line[2], line[5]]), [
  ['Dominic Chan', 'dominicchan@sbcglobal.net', '', 'Coach D'],
  ['Fuqun (Bill) Xing', 'xfqslw@gmail.com', '', 'Coach F'], ['Tom (Xiaoyun) Zeng', 'xiaoyunzeng64@gmail.com', '', 'Coach T'],
  ['Raymond Trinh', '', '', 'Coach R']
], 'the four club coaches are listed once, with no phone numbers in the code');
assert.equal(run('coachList').coaches.filter(coach => coach.registered).length, 0, 'nobody starts with a green check');
// ---- The hourly sweep keeps the Coaches tab in line with the club list ----
{
  const statusOf = name => (grids.Coaches.find(line => line[0] === name) || [])[3];
  const labels = () => run('coachList').coaches.map(coach => coach.label);
  grids.Coaches.push(['Retired Coach', 'retired@example.com', '(925) 555-0199', '', '', '', '', '', '', '', '', '']);
  context.sweep();
  assert.equal(statusOf('Retired Coach'), 'disabled', 'a coach no longer in the club list is switched off, not deleted');
  assert.deepEqual(labels(), ['Coach D', 'Coach F', 'Coach T', 'Coach R'], 'and no longer offered on the page');
  grids.Coaches.find(line => line[0] === 'Dominic Chan')[3] = 'disabled';
  grids.Coaches.splice(grids.Coaches.findIndex(line => line[0] === 'Raymond Trinh'), 1);
  context.sweep();
  assert.equal(statusOf('Dominic Chan'), '', 'a listed coach is switched back on');
  assert.equal(statusOf('Raymond Trinh'), '', 'a listed coach missing from the tab is added back');
  assert.equal(statusOf('Retired Coach'), 'disabled');
  const before = JSON.stringify(grids.Coaches);
  cleared.length = 0;
  context.sweep();
  assert.equal(JSON.stringify(grids.Coaches), before, 'a sweep with nothing to change writes nothing');
  assert.deepEqual(cleared, [], 'nor rewrites an unchanged public schedule');
  const schedule = JSON.stringify(grids.Schedule);
  grids.Schedule[0][0] = 'edited';
  context.sweep();
  assert.equal(JSON.stringify(grids.Schedule), schedule, 'an edit to the public schedule is put right');
}
// The rest of these checks use made-up coaches, which the owner manages in the Sheet: with no club list, the sweep leaves
// the Coaches tab alone.
context.CLUB_COACHES = [];
grids.Coaches.splice(1);
assert.deepEqual(timers(), ['sweep every 60']);
activeEmail = '';
assert.equal(properties.COACHING_DB_ID, 'private-book-id');
assert.equal(properties.COACHING_PUBLIC_ID, 'public-book-id');
assert.equal(grids.Requests[0].length, 24);
assert.deepEqual(grids.Schedule[0], ['date', 'day', 'start', 'end', 'coach', 'status', 'student', 'summary']);
assert.match(grids.About[0][0], /does not change any booking/);

// ---- Reading a YES or NO: any case, other words allowed, never the quoted earlier message ----
[
  ['yes', 'yes'], ['Yes', 'yes'], ['YES!', 'yes'], ['yEs please', 'yes'], ['Yes, see you Friday', 'yes'], ['y', 'yes'], ['ok yes', 'yes'],
  ['No problem, yes I can', 'yes'], ['no', 'no'], ['No thanks', 'no'], ['NO, I cannot make it', 'no'], ['n', 'no'], ['Nope', 'no'],
  ['maybe', ''], ['yes no', ''], ['No problem!', ''], ['Yesterday works', ''], ['I know', ''], ['\n\nyes\n', 'yes'],
  ['\u200bYES\u200b\r\n\r\nSent from my Galaxy', 'yes'],
  ['\u200eYES\u200e\r\n\r\nSent from my Galaxy', 'yes'],
  // HTML-only replies whose plain text runs the lines together (a real reply from a Samsung phone read this way).
  ['YESSent from my Galaxy', 'yes'], ['NoSent from my iPhone', 'no'], ['yes-------- Original message --------From: Concord', 'yes'],
  ['YesOn Sat, Oct 10, 2026 at 11:57 AM Concord Table Tennis Club <club@example.com> wrote:', 'yes'], ['I sent from my phone yes', ''], ['\u202aYES\u202c', 'yes'], ['\u2068YES\u2069', 'yes'], ['\u00a0YES\u00a0', 'yes'], ['Y\u00adES', 'yes'],
  ['Yes\n\nOn Sat, Oct 10, 2026 at 11:57 AM Concord Table Tennis Club <club@example.com> wrote:\n> Reply YES: Send\n> Reply NO: Cancel', 'yes'],
  ['no\n\nOn Sat, Oct 10, 2026 at 11:57 AM Concord Table Tennis Club <\nclub@example.com> wrote:\nReply YES: Send', 'no'],
  ['YES\n\nSent from my Galaxy\n\n-------- Original message --------\nFrom: Concord <club@example.com>\nReply YES: Send\nReply NO: Cancel', 'yes'],
  ['Yes\n________________________________\nFrom: Concord Table Tennis Club\nSent: Saturday\nReply NO: cancel', 'yes'],
  ['Yes.\n\nOn Oct 10, 2026, at 11:57 AM, Concord Table Tennis Club <club@example.com> wrote:\n\nReply NO', 'yes'],
  // Only a leading yes or no is an answer: ordinary messages that mention one are not.
  ['I am out of the office with no access to email', ''], ['Running late tonight, there is no parking', ''], ['Is there no earlier time?', ''],
  ['I have no idea what this is', ''], ['Can I bring my son? No pressure', ''], ['Yes, but I can\'t make it', ''], ['I said yes', ''],
  ['Hi, yes please', 'yes'], ['Ok, no thanks', 'no'], ['no.', 'no'], ['Y', 'yes'], ['N', 'no'], ['yes!!!', 'yes'], ['', ''],
  // A reply app in another language: our own quoted lines are never read as their words.
  ['Ja, YES\n\nAm Sa., 10. Okt. 2026 um 11:57 schrieb Concord Table Tennis Club <club@example.com>:\nConfirm your coaching request [CTTC ref 0123456789]\nReply YES: Send\nReply NO: Cancel', ''],
  ['YES\n\nAm Sa., 10. Okt. 2026 um 11:57 schrieb Concord Table Tennis Club <club@example.com>:\nReply YES: Send\nReply NO: Cancel', 'yes'],
  ['yes\n-- \nBryan\nNo calls after 9', 'yes'],
  // A greeting first, on its own line or with a name, then the answer.
  ['Hi John,\n\nYes, I can do it.', 'yes'], ['Hi,\nYes', 'yes'], ['Dear Dee,\nYes', 'yes'], ['Good morning,\n\nYes please', 'yes'], ['Hello Coach Dee,\nyes', 'yes'],
  ['Hi Dee, yes', 'yes'], ['hi yes, see you', 'yes'], ['Hey,\nno thanks', 'no'], ['Thanks!\nNo idea what this is', ''],
  // The club's name in their own words, or Outlook's divider run onto the answer, does not lose the answer.
  ['Yes, see you at Concord Table Tennis Club!', 'yes'], ['Yes - thanks Concord Table Tennis Club', 'yes'],
  ['Yes________________________________From: Concord Table Tennis Club <club@example.com>', 'yes']
].forEach(([reply, expected]) => assert.equal(context.answerOf_(reply), expected, JSON.stringify(reply)));

// The page answers each form under its own Send button (on a phone the page-top message can be far off screen), names the
// field at fault, and checks the guardian name before sending.
{
  const page = fs.readFileSync(__dirname + '/Index.html', 'utf8');
  assert.doesNotMatch(page, /show\(result\.message, result\.ok \? 'ok' : 'error'\)/, 'waitlist and change answers go through report(), next to the form');
  assert.match(page, /#message\.error \{[^}]*position: sticky; top: 0;/, 'any other error stays on screen while scrolling');
  assert.match(page, /report\(form, result\.message, 'error', result\.field, fields\)/);
  assert.match(page, /if \(minor\.checked && !form\.querySelector\('#guardian'\)\.value\.trim\(\)\)/, 'a missing guardian name is caught on the page');
  assert.match(page, /scrollIntoView\(\{ block: 'center' \}\)/);
  assert.equal((page.match(/resetStatus\(form\);/g) || []).length, 4, 'every form, reopened, starts without an old answer');
  assert.match(page, /'class': 'field-error', id: input\.id \+ 'Error'/, 'the reason is shown right under the field at fault');
  assert.equal(context.fail_('x').field, undefined, 'fail_ without a field is unchanged');
  assert.match(page, /field\('Parent or guardian name \(required\)'/, 'the guardian field says it is required');
  assert.match(page, /@media \(prefers-reduced-motion: reduce\) \{ \.slide-open, \.slide-shut \{ animation: none; \} \}/, 'the guardian slide respects reduced motion');
  assert.match(page, /if \(guardianBox\.className === 'slide-shut'\) guardianBox\.hidden = !minor\.checked;/, 'and hides only once it has slid up, unless ticked again');
}

// HTML replies are read with their own line breaks; the quoted earlier message is never read.
{
  const reply = (plain, html) => ({ getPlainBody: () => plain, getBody: () => html });
  const samsung = '<div dir="auto">YES</div><div dir="auto"><br></div><div id="composer_signature" dir="auto"><div>Sent from my Galaxy</div></div>' +
    '<div><br></div><div align="left" dir="auto"><div>-------- Original message --------</div><div>Reply YES: Send my request</div><div>Reply NO: Cancel</div></div>';
  assert.equal(context.answerOf_(context.replyText_(reply('YESSent from my Galaxy-------- Original message --------', samsung))), 'yes');
  const gmail = '<div dir="ltr">No thanks&nbsp;</div><br><div class="gmail_quote"><div>On Sat, Oct 10 the club wrote:</div><blockquote>Reply YES: Confirm<br>Reply NO: Decline</blockquote></div>';
  assert.equal(context.answerOf_(context.replyText_(reply('No thanks\n\nOn Sat, Oct 10 the club wrote:\n> Reply YES', gmail))), 'no');
  assert.equal(context.answerOf_(context.replyText_(reply('YES', ''))), 'yes', 'a plain-text reply is read as it is');
  assert.equal(context.answerOf_(context.replyText_({ getPlainBody: () => 'yes' })), 'yes', 'and so is a message with no HTML at all');
  // The status read-out never spells out a reply: only invisible characters are listed, never letters in any language.
  assert.equal(context.oddCharacters_('是的 да YES‎'), 'U+200E');
}

// ---- Coaches: only the ones the owner listed, picked from a list; no sign-in ----
assert.deepEqual(grids.Coaches[0], ['name', 'email', 'phone', 'status', 'coach_id', 'label', 'created_at', 'ask_at', 'ask_slots', 'ask_ref', 'ask_made', 'registered_at'], 'the owner types the first three columns');
assert.deepEqual(run('coachList'), { ok: true, coaches: [] }, 'nobody is a coach until the owner lists them');
const annId = addCoach('Ann Coach', 'ann@example.com', '(925) 555-0101');
assert.match(annId, /^[a-f0-9]{16}$/);
assert.deepEqual([grids.Coaches[1][0], grids.Coaches[1][5]], ['Ann Coach', 'Coach A'], 'the owner only types a name: the app gives the coach an id and Coach A');
assert.deepEqual(run('coachList'), { ok: true, coaches: [{ id: annId, label: 'Coach A', ready: true, registered: false }] }, 'no green check until the coach is verified');
assert.equal(grids.Coaches.length, 2);
assert.equal(sent.length + replies.length, 0, 'listing a coach sends nothing');
const ann = () => textsTo('Ann Coach');
// A coach on the list who has texted the club number (COACH, or anything) can be texted back: the next check verifies them.
check();
assert.equal(run('coachList').coaches[0].registered, true, "Ann's earlier text to the club number gives her the green check");
assert.ok(cell('Coaches', coachRow(annId), 'registered_at'));
assert.deepEqual(verifiedTo('Ann Coach'), ['CTTC: Thanks, you are verified as Coach Ann. To offer coaching times, open concordtabletennisclub.com/coaching.html, ' +
  'tap I am a coach and pick Coach A. We will text you here to confirm your times and lesson requests.'], 'told once, on her own thread');
check();
assert.equal(verifiedTo('Ann Coach').length, 1, 'and never again');
replies.length = 0;

// ---- Labels ----
assert.deepEqual([0, 1, 25, 26, 27, 51, 52, 701, 702].map(n => context.letters_(n)), ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);

// ---- Coach times: Friday 7-10 PM and Saturday 3-6 PM only, 30 or 60 minutes, published only by a YES from the coach's phone ----
for (const [date, start, minutes, why] of [
  ['2026-10-05', '19:00', 30, 'Monday'], ['2026-10-07', '19:00', 30, 'Wednesday'], ['2026-10-08', '19:00', 30, 'Thursday'], ['2026-10-11', '15:00', 30, 'Sunday'],
  ['2026-10-09', '18:30', 30, 'before Friday 7 PM'], ['2026-10-09', '21:30', 60, 'a Friday hour ending after 10 PM'], ['2026-10-09', '22:00', 30, 'at 10 PM'],
  ['2026-10-09', '19:15', 30, 'a quarter hour'], ['2026-10-09', '19:00', 45, '45 minutes'], ['2026-10-09', '19:00', 90, '90 minutes'], ['2026-10-09', '19:00', 'x', 'junk length'],
  ['2026-10-10', '14:30', 30, 'before Saturday 3 PM'], ['2026-10-10', '17:30', 60, 'a Saturday hour ending after 6 PM'], ['2026-10-10', '18:00', 30, 'at 6 PM'],
  ['2026-02-30', '19:00', 30, 'not a date'], ['2026-11-06', '19:00', 30, 'beyond four weeks'], ['', '', 30, 'nothing']
]) assert.equal(propose(annId, [slot(date, start, minutes)]).ok, false, 'refused: ' + why);
assert.equal(propose(annId, [slot('2026-10-09', '19:00', 30, 4)]).ok, false, 'there are three tables');
assert.equal(propose(annId, 'nonsense').ok, false);
assert.equal(propose(annId, [slot('2026-10-09', '19:00', 60), slot('2026-10-09', '19:30', 30)]).ok, false, 'times cannot overlap');
assert.match(propose(annId, [slot('2026-10-09', '19:00', 60), slot('2026-10-09', '19:30', 30)]).message, /overlap on Fri Oct 9, 7:30 PM/);
assert.equal(propose(annId, []).ok, false, 'nothing to change');
assert.equal(grids.Availability.length, 1, 'nothing invalid is saved');
assert.equal(replies.length, 0, 'and nobody is texted');
assert.equal(run('openSlots').slots.length, 0, 'nothing is shown');

const annSet = [
  slot('2026-10-09', '19:00', 60), slot('2026-10-09', '20:00', 30), slot('2026-10-09', '20:30', 60), slot('2026-10-10', '15:00', 60), slot('2026-10-10', '16:00', 30),
  slot('2026-10-23', '19:00', 60), slot('2026-10-30', '19:00', 30), slot('2026-10-02', '20:00', 30)
];
const annAsked = propose(annId, annSet);
assert.equal(annAsked.ok, true);
assert.equal(annAsked.message, 'Sent. Reply YES to the email and the text we just sent to publish these times, or NO to cancel. Nothing changes until you reply.');
const annMail = mailTo('ann@example.com').pop();
assert.match(annMail.subject, /^Confirm your coaching times \[CTTC ref [0-9A-F]{10}\]$/);
assert.match(annMail.body, /Reply YES: Publish these changes to Coach Ann's coaching times\.\nReply NO: Cancel/);
assert.match(annMail.body, /Add: Fri Oct 2 8:00-8:30 PM; Fri Oct 9 7:00-8:00 PM/);
assert.match(annMail.body, /We also texted your mobile\. You can answer either one\./);
assert.match(annMail.body, /^Action needed: reply to this email by Sunday, October 4, 2026, 10:00 AM Pacific Time\. Nothing changes until you reply\./, 'the email says when the 48 hours end');
assert.deepEqual(ann(), ['CTTC: Reply YES by Sun Oct 4, 10:00 AM to update Coach Ann\'s coaching times, or NO to cancel. Add: Fri Oct 2 8:00-8:30 PM; Fri Oct 9 7:00-8:00 PM, 8:00-8:30 PM, ' +
  '8:30-9:30 PM; Sat Oct 10 3:00-4:00 PM, 4:00-4:30 PM; Fri Oct 23 7:00-8:00 PM; Fri Oct 30 7:00-7:30 PM. Nothing changes until you reply.']);
assert.equal(grids.Availability.length, 1, 'nothing is saved before the YES');
assert.equal(run('coachBoard', annId).pending.length, 8, 'the page shows what is waiting for the YES');
say('Ann Coach', 'YES');
assert.equal(ann()[1], 'CTTC: Done. Coach Ann now has 8 upcoming coaching times (8 added, 0 removed). Students can request them at concordtabletennisclub.com/coaching.html.');
assert.equal(grids.Availability.length, 1 + 8);
assert.equal(run('coachBoard', annId).pending, null);
assert.match(propose(annId, annSet).message, /Nothing changed/, 'sending the same list again changes nothing');
assert.equal(ann().length, 2);

let view = run('coachBoard', annId);
assert.deepEqual(view.days.map(day => weekday(day.date)).filter(day => day !== 5 && day !== 6), [], 'only Fridays and Saturdays can be offered');
assert.deepEqual(view.days.map(day => day.date), ['2026-10-02', '2026-10-03', '2026-10-09', '2026-10-10', '2026-10-16', '2026-10-17', '2026-10-23', '2026-10-24', '2026-10-30']);
assert.deepEqual(view.days.slice(0, 2).map(day => [day.start, day.end]), [['19:00', '22:00'], ['15:00', '18:00']]);
assert.deepEqual([view.label, view.ready, view.tables, view.textNumber], ['Coach A', true, 3, '(925) 238-3505']);
assert.equal(view.board.filter(entry => entry.mine).length, 8);
assert.doesNotMatch(JSON.stringify([view, run('coachList')]), PRIVATE, "the coach page never carries a coach's full name, email or number");

const slots = run('openSlots').slots;
assert.equal(slots.length, 7, "tonight's slot is under 24 hours away, so it is not offered");
assert.deepEqual([slots[0].date, slots[0].start, slots[0].minutes, slots[1].start, slots[1].minutes], ['2026-10-09', '19:00', 50, '20:00', 25], 'a 60 minute time is a 50 minute lesson, a 30 minute time a 25 minute one');
assert.equal(slots[0].label, 'Friday, October 9, 2026, 7:00 PM to 7:50 PM Pacific Time');
assert.equal(slots[1].time, '8:00 PM to 8:25 PM');
assert.ok(slots.every(entry => entry.coach === 'Coach Ann' && entry.table === 1), 'the public list shows only the first name and table');
assert.doesNotMatch(JSON.stringify(run('openSlots')), PRIVATE, 'the public list shows first names only, and no contact details');
assert.equal(Object.keys(slots[0]).sort().join(), 'coach,date,day,key,label,minutes,start,table,time');
assert.equal(run('openSlots').sheetUrl, setupResult.publicSheet);

// ---- The public Sheet mirrors the schedule with labels only ----
assert.equal(grids.Schedule.length, 1 + 7);
assert.deepEqual(grids.Schedule[1], ['2026-10-09', 'Friday', '7:00 PM', '7:50 PM', 'Coach Ann', 'Open', '', 'Coach Ann is available']);
assertPublicIsAnonymous();

// ---- Student requests: the time is held until the student replies YES to our email; only then is the coach asked ----
const form = (picked, extra) => Object.assign({ key: picked.key, name: 'Sam Student', email: 'sam@example.com', note: 'Left handed' }, extra);
assert.equal(run('requestSlot', form(slots[0], { name: '' })).ok, false);
assert.equal(run('requestSlot', form(slots[0], { email: 'nope' })).ok, false);
assert.deepEqual(run('requestSlot', form(slots[0], { minor: true })), { ok: false, field: 'guardian',
  message: 'Please enter the parent or guardian\'s name. For a student under 18, use the parent or guardian\'s email address.' }, 'a minor needs a guardian name');
assert.equal(run('requestSlot', form(slots[0], { minor: true, guardian: 'Mom2' })).field, 'guardian', 'the page is told which field to fix');
assert.match(run('requestSlot', form(slots[0], { minor: true, guardian: 'Mom2' })).message, /^Please check the parent or guardian name\. .*numbers are not/);
assert.equal(run('requestSlot', form(slots[0], { name: '' })).field, 'name');
assert.equal(run('requestSlot', form(slots[0], { email: 'nope' })).field, 'email');
assert.equal(run('requestSlot', form(slots[0], { phone: '123' })).field, 'phone');
// Names people really write, for a student or a guardian.
['Pat & Sam Parent', 'Smith, John', 'Pat/Sam Parent', 'Pat (mom)', 'Mary-Jane O\'Neil', 'Zo\u00eb', 'Jos\u00e9 Garc\u00eda', '\u674e\u534e'].forEach(name =>
  assert.equal(context.cleanName_(name), name, name));
['', '2Pat', '=HYPERLINK("x")', 'Pat <b>', 'Pat "P"', 'Pat2', '-Pat'].forEach(name => assert.equal(context.cleanName_(name), '', name));
// The public label is only ever one first name, whatever punctuation a name uses.
[['John/Smith', 'John'], ['John(Smith', 'John'], ['John&Smith', 'John'], ['Smith, John, Jr', 'John'], ['John,Smith', 'Smith'], ['Pat (mom)', 'Pat'],
  ['Smith, John', 'John'], ['Mary-Jane O\'Neil', 'Mary-Jane'], ['(mom) Pat', 'Pat']].forEach(([name, first]) => assert.equal(context.firstName_(name), first, name));
assert.equal(run('requestSlot', form({ key: 'f'.repeat(16) })).ok, false, 'only offered slots can be requested');
assert.equal(run('requestSlot', form({ key: undefined })).ok, false);
assert.equal(run('requestSlot', form(slots[0], { website: 'http://spam.example' })).ok, true);
assert.equal(grids.Requests.length, 1, 'rejected requests and a filled honeypot add nothing');
assert.equal(grids.Students.length, 1, 'and create no student label');
sent.length = 0;
const first = run('requestSlot', form(slots[0], { note: '=IMPORTDATA("http://evil.example")' }));
assert.equal(first.ok, true);
assert.equal(first.label, 'Student Sam');
assert.equal(first.message, 'Almost done: we emailed you. Reply YES to that email within 2 hours to send your request to Coach Ann. The time is held for you until then. Nothing goes to the coach until you reply.');
assert.equal(grids.Requests.length, 2);
assert.equal(cell('Requests', grids.Requests[1], 'note'), 'IMPORTDATA("http://evil.example")', 'a note cannot start a spreadsheet formula');
assert.equal(cell('Requests', grids.Requests[1], 'status'), 'unverified');
assert.equal(cell('Requests', grids.Requests[1], 'minutes'), '60');
assert.equal(cell('Requests', grids.Requests[1], 'table'), '1');
assert.equal(cell('Requests', grids.Requests[1], 'student_label'), 'Student A');
assert.deepEqual(grids.Students[1].slice(0, 2), ['Student A', 'sam@example.com'], 'the private Students tab maps the label to the person');
assert.deepEqual(sent.map(message => message.to), ['sam@example.com'], 'nothing goes to the coach before the YES');
assert.equal(ann().length, 2);
const verifyMail = mailTo('sam@example.com')[0];
assert.match(verifyMail.subject, /^Confirm your coaching request \[CTTC ref [0-9A-F]{10}\]$/);
assert.match(verifyMail.body, /Action needed: reply to this email by [^\n]+\.\n\nReply YES: Send my request to the coach\.\nReply NO: Cancel my request and release the time\./);
assert.match(verifyMail.body, /When: Friday, October 9, 2026, 7:00 PM to 7:50 PM Pacific Time\nWhere: Walnut Creek Christian Academy.*\nTable: Table 1\nCoach: Coach Ann/);
assert.match(verifyMail.htmlBody, /<strong>Action needed:<\/strong>/);
assert.match(verifyMail.htmlBody, /<td style="padding:3px 16px 3px 0;[^"]*">Table<\/td>/, 'the details are labelled in bold');
assert.match(verifyMail.htmlBody, /<td[^>]*>Table 1<\/td><td[^>]*>Table 2<\/td>/, 'the day\'s tables are drawn');
assert.match(verifyMail.htmlBody, /<td rowspan="2" style="[^"]*#fff3b0[^"]*"><strong>&#9733; YOUR LESSON<\/strong><br>Coach Ann \u00b7 7:00 PM to 7:50 PM<br><strong>Waiting for your YES/, 'with the student\'s time highlighted');
assert.equal((verifyMail.htmlBody.match(/YOUR LESSON/g) || []).length, 1);
assert.doesNotMatch(verifyMail.htmlBody.replace(/Sam Student/g, ''), PRIVATE);
assert.match(verifyMail.body, /You will show on the site as "Student Sam"/);
assert.doesNotMatch(verifyMail.body.replace(/sam@example\.com|Sam Student/g, ''), PRIVATE);
assert.equal(run('openSlots').slots.length, 6, 'the time is held while we wait');
assert.deepEqual(run('openSlots').schedule, [{ day: 'Friday, October 9, 2026', time: '7:00 PM to 7:50 PM', status: 'Waiting for Student Sam to confirm', summary: 'Student Sam requested a session with Coach Ann. Waiting for Student Sam to confirm' }]);
// Only a YES or NO, from the address the request was made with, quoting the code, after the question, answers it.
answerMail('sam@example.com', 'Maybe, is it the east door?', verifyMail.subject);
answerMail('pat@example.com', 'YES', verifyMail.subject);
answerMail('"Sam" <sam@example.com>', 'YES', verifyMail.subject.replace(/ref [0-9A-F]+/, 'ref 0123456789'));
answerMail('"Sam" <sam@example.com>', 'YES', 'Confirm your coaching request');
assert.equal(statusOf('sam@example.com'), 'unverified', 'a maybe, a stranger, a wrong code and no code are not answers');
// ...but a reply to a real question is never silently ignored: the sender is told what to do. The club is not emailed.
assert.deepEqual(sent.slice(1).map(message => [message.to.toLowerCase(), message.subject]), [
  ['sam@example.com', 'We could not read your reply'],
  ['pat@example.com', 'Your reply did not count: please answer from the right address']]);
assert.doesNotMatch(sent[2].body, /sam@example/, 'the other sender is not shown the booked address');
check();
assert.equal(sent.length, 3, 'each unanswerable reply is answered once');
sent.splice(1);
// The next check starts while this one is still reading mail: it must not read and apply the same YES again, which
// sent the student a second email saying "That request is no longer waiting for you (it is pending)".
overlap = () => { delete cache['check-texts']; context.checkTexts(); };
logs.length = 0;
answerMail('"Sam Student" <SAM@example.com>', 'Yes', verifyMail.subject);
assert.equal(overlap, null);
assert.ok(logs.includes('coaching checkTexts skipped: the previous check is still running'), 'a skipped check says so in the logs');
// Every message sent is logged once, by kind and request, with the recipient only as a code.
const samId = cell('Requests', latestRequest('sam@example.com'), 'request_id');
const sentLogs = logs.filter(line => line.startsWith('coaching sent '));
assert.deepEqual(sentLogs.map(line => line.replace(/ to=[0-9A-F]{6}$/, '')).sort(), [
  'coaching sent email coach_emailed:pending ref=' + samId,
  'coaching sent email student_emailed:pending ref=' + samId,
  'coaching sent text coach-question ref=' + samId]);
assert.equal(new Set(sentLogs.filter(line => / email student/.test(line)).map(line => line.slice(-6))).size, 1, 'the same person always has the same code');
// The same lines go to the private Log tab, with the skipped check and the YES that was read and applied.
const logTail = grids.Log.slice(-6).map(line => line.slice(1).join(' ').trim());
assert.deepEqual(logTail.slice().sort(), ['- check-skipped - -', 'email reply:student-v:yes ' + samId + ' - applied, now pending',
  'step step:pending ' + samId + ' - waiting on coach until Sunday, October 4, 2026, 10:06 AM Pacific Time']
  .concat(sentLogs.map(line => line.replace(/^coaching sent /, '').replace(' ref=', ' ').replace(' to=', ' '))).sort());
assert.ok(grids.Log.slice(1).every(line => /^\d{4}-\d\d-\d\dT/.test(line[0])), 'each row has its time');
assert.equal(statusOf('sam@example.com'), 'pending', 'her YES sends it to the coach');
assert.ok(cell('Requests', latestRequest('sam@example.com'), 'verified_at'));
assert.deepEqual(sent.map(message => message.to.toLowerCase()).sort(), ['ann@example.com', 'sam@example.com', 'sam@example.com']);
const pendingStudent = mailTo('sam@example.com')[1];
assert.match(pendingStudent.subject, /not confirmed yet/i);
assert.match(pendingStudent.body, /NOT confirmed until the coach accepts/);
assert.match(pendingStudent.body, /When: Friday, October 9, 2026, 7:00 PM to 7:50 PM Pacific Time\n[^]*Table: Table 1\nCoach: Coach Ann/);
assert.match(pendingStudent.htmlBody, /Waiting for the coach/);
assert.doesNotMatch(pendingStudent.body, /Ann Coach|ann@/, 'the student learns only the coach\'s first name before the lesson is confirmed');
assert.doesNotMatch(pendingStudent.body, /Payment:|Arrival:/, 'instructions come only after acceptance');
const pendingCoach = mailTo('ann@example.com')[0];
assert.match(pendingCoach.subject, /^Lesson request from Sam Student \[CTTC ref [0-9A-F]{10}\]$/);
assert.match(pendingCoach.body, /Sam Student asked for/, 'the coach sees the student\'s name before accepting');
assert.doesNotMatch(pendingCoach.body, /sam@example/, 'but no contact details until the lesson is confirmed');
assert.match(pendingCoach.body, /Reply YES: Confirm the lesson\.\nReply NO: Decline it\./);
assert.match(pendingCoach.body, /We are also texting your mobile about it\. You can answer either one\./);
assert.doesNotMatch(pendingCoach.body, /concordtabletennisclub\.com|script\.google/, 'a coach gets no link');
// The coach is asked by text straight away, and a bare YES or NO answers it.
assert.equal(ann()[2], 'CTTC: Lesson request from Sam Student: 50 min, Fri Oct 9, 7:00 PM, Table 1. Reply YES to confirm or NO to decline.');
assert.equal(run('openSlots').slots.length, 6, 'a requested slot is held');
assert.equal(grids.Schedule.find(line => line[5] === 'Waiting for Coach Ann to accept')[7], 'Student Sam requested a session with Coach Ann. Waiting for Coach Ann to accept',
  'the public schedule says who must reply next');
assert.equal(grids.Schedule.filter(line => line[5] === 'Open').length, 6);
assertPublicIsAnonymous();
assert.equal(run('requestSlot', form(slots[0], { name: 'Pat Other', email: 'pat@example.com' })).ok, false, 'a second student cannot take the same slot');
assert.equal(grids.Students.length, 2, 'and gets no label for it');
const patFirst = book(form(slots[1], { name: 'Pat Other', email: 'pat@example.com' }));
assert.equal(patFirst.label, 'Student Pat', 'but can take another');
assert.equal(grids.Requests.length, 3);
const patSecond = book(form(slots[2], { name: 'Pat Other', email: 'pat@example.com' }));
assert.equal(patSecond.label, 'Student Pat', 'the same person keeps the same name');
assert.equal(grids.Students.length, 3);
assert.equal(run('requestSlot', form(slots[3], { name: 'Pat Other', email: 'pat@example.com' })).ok, false, 'at most two waiting requests per student');
assert.equal(ann().length, 3, 'one question at a time: the coach is not asked about Pat until Sam is answered');
assert.equal(held, 0);

// A time with a request on it is not the coach's to change.
const changed = propose(annId, annSet.map(entry => entry.start === '19:00' && entry.date === '2026-10-09' ? slot(entry.date, '19:00', 30) : entry));
assert.equal(changed.ok, false);
assert.match(changed.message, /A time with a lesson request on it cannot be changed/);
assert.equal(grids.Availability.length, 1 + 8);

// ---- Status visible on both sides, by label only ----
assert.deepEqual(run('coachBoard', annId).board.filter(entry => entry.date === '2026-10-09').map(entry => [entry.start, entry.status, entry.student]),
  [['19:00', 'requested', 'Student Sam'], ['20:00', 'requested', 'Student Pat'], ['20:30', 'requested', 'Student Pat']]);
assert.doesNotMatch(JSON.stringify(run('openSlots')), PRIVATE, "the page never shows a student's full name or contact details");

// ---- Acceptance: a YES from the coach's phone, once, with instructions for both ----
sent.length = 0;
say('Someone Else', 'YES', otherFrom);
say('Ann Coach', 'Maybe, let me check');
say('Ann Coach', 'YES', '"Ann" <ann@example.com>');
assert.equal(sent.length, 0, "someone else's YES, a reply that is not YES or NO and an email posing as a text are not answers");
assert.equal(statusOf('sam@example.com'), 'pending');
say('Ann Coach', 'Yes');
assert.equal(sent.length, 2, 'one email to each side');
for (const message of sent) {
  assert.match(message.subject, /^Lesson confirmed/);
  assert.match(message.body, /Friday, October 9, 2026, 7:00 PM to 7:50 PM Pacific Time/, 'date, time and time zone');
  assert.match(message.body, /Where: Walnut Creek Christian Academy, 2336 Buena Vista Ave, Walnut Creek, CA 94597\nTable: Table 1/, 'location and table');
  assert.match(message.htmlBody, /<a href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=Walnut%20Creek/, 'the address opens a map');
  assert.match(message.body, /Student Sam with Coach Ann|Student Sam has session with Coach Ann/);
  assert.match(message.body, /Arrival: /);
  assert.match(message.body, /Payment: /);
  assert.match(message.body, /Guidelines: /);
  assert.match(message.body, /does not add you to the results mailing list/);
}
assert.notEqual(sent[0].to, sent[1].to);
assert.match(mailTo('ann@example.com')[0].body, /Student: Sam Student, sam@example\.com/);
assert.match(mailTo('ann@example.com')[0].body, /Need to cancel\? Reply to this email/);
assert.match(mailTo('sam@example.com')[0].body, /Coach: Ann Coach\n[^]*Email: ann@example\.com\nPhone: \(925\) 555-0101/, 'once confirmed, the student gets the coach\'s contact details');
assert.match(mailTo('sam@example.com')[0].body, /1\. Open https:\/\/concordtabletennisclub\.com\/coaching\.html\n2\. Tap your time \(shown as Student Sam\)/);
assert.match(mailTo('sam@example.com')[0].htmlBody, /YOUR LESSON[^]*<strong>Confirmed<\/strong>/);
assert.doesNotMatch(mailTo('sam@example.com')[0].body, /pat@example|[?]t=/);
assert.deepEqual(ann().slice(-2), [
  'CTTC: Confirmed. Student Sam, 50 min lesson Fri Oct 9, 7:00 PM, Table 1, Walnut Creek Christian Academy, 2336 Buena Vista Ave, Walnut Creek, CA 94597. Student: Sam Student, sam@example.com.',
  'CTTC: Lesson request from Pat Other: 25 min, Fri Oct 9, 8:00 PM, Table 1. Reply YES to confirm or NO to decline.'
], 'the coach gets the plan by text, then the next question');
assert.ok(ann().every(body => !/[?]t=/.test(body)), 'never a link in a text');
assert.deepEqual(run('openSlots').schedule[0], { day: 'Friday, October 9, 2026', time: '7:00 PM to 7:50 PM', status: 'Booked', summary: 'Student Sam has session with Coach Ann' });
assert.equal(grids.Schedule.find(line => line[5] === 'Booked')[7], 'Student Sam has session with Coach Ann');
assertPublicIsAnonymous();
const confirmedCount = sent.length + replies.length;
context.sweep();
context.sweep();
check();
assert.equal(sent.length + replies.length, confirmedCount, 'repeated sweeps and checks never repeat a notification or a question');
properties.COACHING_PAYMENT_TEXT = 'Pay with the club process described here.';
properties.COACHING_ARRIVAL_TEXT = 'Come to the east door.';
assert.equal(statusOf('sam@example.com'), 'confirmed');

// ---- Decline ----
sent.length = 0;
say('Ann Coach', 'no');
assert.equal(mailTo('pat@example.com').length, 1);
assert.match(mailTo('pat@example.com')[0].subject, /not accepted/i);
assert.equal(mailTo('ann@example.com').length, 0, 'the coach is not emailed about their own answer');
assert.deepEqual(ann().slice(-2), [
  'CTTC: Declined. Student Pat was told, and Fri Oct 9, 8:00 PM is open again.',
  'CTTC: Lesson request from Pat Other: 50 min, Fri Oct 9, 8:30 PM, Table 1. Reply YES to confirm or NO to decline.'
]);
assert.equal(run('openSlots').slots.length, 5, 'the declined slot is open again');
sent.length = 0;
say('Ann Coach', 'YES');
assert.match(mailTo('pat@example.com')[0].subject, /^Lesson confirmed: 2026-10-09 20:30/);
assert.equal(mailTo('ann@example.com').length, 1);
assert.ok(grids.Schedule.some(line => line[0] === '2026-10-09' && line[5] === 'Booked' && line[7] === 'Student Pat has session with Coach Ann'));
const answered = ann().length;
say('Ann Coach', 'YES');
assert.equal(ann().length, answered, 'a YES with no question waiting does nothing');

// ---- Cancelling: tap the time, give the email address or mobile number booked with, reply YES ----
sent.length = 0;
const samKey = keyOf('sam@example.com');
assert.equal(run('studentChange', { key: samKey, action: 'cancel' }).ok, false, 'an email address or mobile number is needed');
assert.equal(run('studentChange', { key: samKey, contact: 'sam@example.com' }).ok, false, 'and a choice');
const generic = run('studentChange', { key: samKey, action: 'cancel', contact: 'pat@example.com' });
assert.equal(generic.ok, true);
assert.equal(run('studentChange', { key: samKey, action: 'cancel', contact: '(925) 555-0199' }).ok, true);
assert.equal(sent.length, 0, 'nobody else can cancel it, and is not told whose time it is');
assert.deepEqual(run('studentChange', { key: samKey, action: 'cancel', contact: ' SAM@example.com ' }), generic, 'the owner gets the very same answer');
assert.equal(sent.length, 1);
assert.match(sent[0].subject, /^Confirm: cancel your lesson \[CTTC ref [0-9A-F]{10}\]$/);
assert.match(sent[0].body, /Reply YES: Cancel the lesson and release the time\.\nReply NO: Keep the lesson as it is\./);
assert.match(sent[0].body, /When: Friday, October 9, 2026, 7:00 PM to 7:50 PM Pacific Time[^]*Coach: Coach Ann/);
assert.match(sent[0].htmlBody, /#fde2e1[^"]*"><strong>&#10005; TO BE CANCELLED<\/strong><br>Coach Ann \u00b7 7:00 PM to 7:50 PM/, 'the time to cancel is marked on the schedule');
run('studentChange', { key: samKey, action: 'cancel', contact: 'sam@example.com' });
assert.equal(sent.length, 1, 'asking again within ten minutes sends nothing more');
assert.equal(statusOf('sam@example.com'), 'confirmed', 'nothing changes before the YES');
replyTo('sam@example.com', 'YES', /^Confirm: cancel your lesson/);
assert.equal(statusOf('sam@example.com'), 'cancelled');
assert.deepEqual(mailTo('ann@example.com').map(message => message.subject), ['Lesson cancelled by Sam Student']);
assert.deepEqual(mailTo('sam@example.com').map(message => message.subject).slice(1), ['Coaching lesson cancelled']);
assert.equal(ann()[ann().length - 1], 'CTTC: Student Sam cancelled the lesson on Fri Oct 9, 7:00 PM. The time is open again.');
assert.equal(run('studentChange', { key: samKey, action: 'cancel', contact: 'sam@example.com' }).ok, false, 'a cancelled lesson cannot be cancelled again');
const cancelledCount = sent.length;
context.sweep();
assert.equal(sent.length, cancelledCount, 'the cancellation notice is sent once');
assert.ok(run('openSlots').slots.some(entry => entry.key === slots[0].key), 'a cancelled slot is open again');
sent.length = 0;
cancelLesson('pat@example.com');
assert.deepEqual(mailTo('ann@example.com').map(message => message.subject), ['Lesson cancelled by Pat Other']);
assert.equal(run('openSlots').slots.length, 7);
assert.deepEqual(run('openSlots').schedule, []);
assert.ok(grids.Schedule.slice(1).every(line => line[5] === 'Open'));

// ---- Coaches can answer by email too; a student can move a lesson; NO keeps it ----
{
  const sam = book(form(slots[0], { name: 'Sam Student', email: 'sam@example.com' }));
  replyTo('ann@example.com', 'yes', /^Lesson request from Sam Student/);
  assert.equal(statusOf('sam@example.com'), 'confirmed', "the coach's emailed YES confirms it");
  assert.match(ann()[ann().length - 1], /^CTTC: Confirmed\. Student Sam, .*Student: Sam Student, sam@example\.com\.$/, 'and the text thread hears about it');
  sent.length = 0;
  const from = keyOf('sam@example.com');
  const to = run('openSlots').slots.find(entry => entry.date === '2026-10-10');
  assert.equal(run('studentChange', { key: from, action: 'move', to: 'f'.repeat(16), contact: 'sam@example.com' }).ok, false, 'only to an open time');
  assert.equal(run('studentChange', { key: from, action: 'move', to: to.key, contact: 'sam@example.com' }).ok, true);
  assert.match(sent[0].subject, /^Confirm: move your lesson \[CTTC ref/);
  assert.match(sent[0].body, /Now: Friday, October 9, 2026, 7:00 PM to 7:50 PM Pacific Time, Coach Ann, Table 1\nNew time: Saturday, October 10, 2026, 3:00 PM to 3:50 PM Pacific Time, Coach Ann, Table 1/);
  assert.match(sent[0].htmlBody, /&#10005; MOVING FROM[^]*&#8594; MOVING TO/, 'both times are marked, on their own days');
  replyTo('sam@example.com', 'No', /^Confirm: move your lesson/);
  assert.equal(statusOf('sam@example.com'), 'confirmed', 'NO keeps the lesson');
  assert.match(mailTo('sam@example.com').pop().body, /OK, nothing changed\. Student Sam's lesson on Friday, October 9, 2026, 7:00 PM to 7:50 PM Pacific Time stays as it is\./);
  clock += 11 * 60000;
  assert.equal(run('studentChange', { key: from, action: 'move', to: to.key, contact: 'sam@example.com' }).ok, true);
  replyTo('sam@example.com', 'YES', /^Confirm: move your lesson/);
  const [old, moved] = requestBy('sam@example.com').slice(-2);
  assert.deepEqual([cell('Requests', old, 'status'), cell('Requests', old, 'cancelled_by'), cell('Requests', moved, 'status'), cell('Requests', moved, 'date')],
    ['cancelled', 'move', 'pending', '2026-10-10'], 'YES releases the old time and sends the new one to the coach');
  assert.ok(mailTo('ann@example.com').some(message => message.subject === 'Lesson cancelled by Sam Student' && /moved the lesson/.test(message.body)));
  assert.match(ann()[ann().length - 1], /^CTTC: Lesson request from Sam Student: 50 min, Sat Oct 10, 3:00 PM/);
  replyTo('ann@example.com', 'NO', /^Lesson request from Sam Student/);
  assert.equal(statusOf('sam@example.com'), 'declined', "the coach's emailed NO declines it");
  assert.equal(sam.label, 'Student Sam');
  assert.equal(run('openSlots').slots.length, 7);
}

// ---- A 25 minute request on a 60 minute time splits it into two 30 minute times, either half ----
{
  const hour = run('openSlots').slots.filter(entry => entry.minutes === 50).pop();
  const half = context.endOf_(hour.start, 30);
  const sides = () => run('openSlots').board.filter(entry => entry.date === hour.date && entry.coach === hour.coach && [hour.start, half].includes(entry.start));
  const rows = grids.Availability.length;
  assert.equal(run('requestSlot', form(hour, { name: 'Ida Student', email: 'ida@example.com', length: 40 })).ok, false, 'only 25 or the offered length');
  assert.equal(grids.Availability.length, rows, 'a refused request splits nothing');
  book(form(hour, { name: 'Ida Student', email: 'ida@example.com', length: 25, start: half }));
  assert.equal(grids.Availability.length, rows + 1, 'the hour is now two half hours');
  assert.deepEqual(sides().map(entry => [entry.start, entry.slot, entry.minutes, entry.status]), [[hour.start, 30, 25, 'open'], [half, 30, 25, 'requested']],
    'the second half is held and the first is open straight away');
  const firstScreen = JSON.parse(/var INITIAL = (.*);\n/.exec(context.doGet({}).getContent())[1]).openSlots;
  assert.deepEqual(firstScreen, run('openSlots'), 'the data inlined in the page shows the split too');
  assert.deepEqual(['start', 'minutes'].map(name => cell('Requests', latestRequest('ida@example.com'), name)), [half, '30']);
  replyTo('ann@example.com', 'YES', /^Lesson request from Ida Student/);
  assert.equal(statusOf('ida@example.com'), 'confirmed');
  const first = run('openSlots').slots.find(entry => entry.key === sides()[0].key);
  assert.equal(run('requestSlot', form(first, { name: 'Jo Student', email: 'jo@example.com', length: 50 })).ok, false, 'the open half is a 30 minute time now');
  book(form(first, { name: 'Jo Student', email: 'jo@example.com', length: 25 }));
  assert.deepEqual(sides().map(entry => entry.status), ['requested', 'booked']);
  cancelLesson('ida@example.com');
  assert.deepEqual(sides().map(entry => [entry.slot, entry.status]), [[30, 'requested'], [30, 'open']], 'a cancelled half reopens as a 30 minute time');
  assert.equal(run('requestSlot', form(hour, { name: 'Kai Student', email: 'kai@example.com', length: 25, start: half })).ok, false, 'the old hour key is no longer offered whole');
  replyTo('ann@example.com', 'NO', /^Lesson request from Jo Student/);
  assert.deepEqual(sides().map(entry => entry.status), ['open', 'open']);
}

// ---- Expiry, and past slots are dropped ----
const lateSlot = run('openSlots').slots[0];
sent.length = 0;
const waiting = book({ key: lateSlot.key, name: 'Lee Waits', email: 'lee@example.com' });
assert.equal(mailTo('lee@example.com').length, 2);
assert.match(ann()[ann().length - 1], /^CTTC: Lesson request from Lee Waits:/);
assert.ok(grids.Availability.some(line => line[2] === '2026-10-02'), "tonight's slot is still stored");
clock += hours(49);
assert.equal(waiting.label, 'Student Lee');
sent.length = 0;
say('Ann Coach', 'YES');
assert.equal(cell('Requests', requestBy('lee@example.com')[0], 'status'), 'expired', 'a late YES cannot confirm an expired request');
assert.deepEqual(ann().slice(-2), [
  'CTTC: That lesson request is no longer waiting (it is expired), so nothing changed.',
  'CTTC: The request from Student Lee for Fri Oct 9, 7:00 PM expired without an answer, so the time was released.'
]);
assert.deepEqual(sent.map(message => message.to).sort(), ['ann@example.com', 'lee@example.com']);
assert.ok(sent.every(message => /expired/i.test(message.subject)));
assert.ok(sent.every(message => message.cc === 'owner@example.com'), 'the club is copied when a coach does not answer');
assert.deepEqual(grids.Log.slice(1).filter(line => line[2] === 'reply:coach-request:yes').pop().slice(1, 6).filter((value, index) => index !== 2),
  ['text', 'reply:coach-request:yes', '-', 'not applied, now expired'], 'a reply that came too late is logged as not applied');
context.sweep();
assert.equal(sent.length, 2, 'expiry is announced once');
assert.ok(!grids.Availability.some(line => line[2] === '2026-10-02'), 'a slot whose day has passed is dropped');
assert.equal(grids.Availability.length, 1 + 7 + 1, 'plus the hour split into halves above');
assert.equal(cell('Coaches', coachRow(annId), 'ask_ref'), '', 'nothing is left waiting for the coach');
// Back to the start. Texts from the future would answer the next question, so they go too.
clock = START;
inbox.length = 0;
mailbox.length = 0;
inbound('Ann Coach', 'COACH', clock - 60000);

// ---- Races, public Sheet failures, mail failures ----
{
  const picked = run('openSlots').slots[4];
  const results = [run('requestSlot', { key: picked.key, name: 'One', email: 'one@example.com' }), run('requestSlot', { key: picked.key, name: 'Two', email: 'two@example.com' })];
  assert.deepEqual(results.map(result => result.ok), [true, false], 'exactly one request can win a slot');
}
{
  const saved = properties.COACHING_PUBLIC_ID;
  delete properties.COACHING_PUBLIC_ID;
  const picked = run('openSlots').slots[0];
  assert.equal(run('requestSlot', { key: picked.key, name: 'Quiet Failure', email: 'quiet@example.com' }).ok, true, 'a problem with the public Sheet never blocks a booking');
  properties.COACHING_PUBLIC_ID = saved;
  context.sweep();
}
{
  const picked = run('openSlots').slots[3];
  mailFails = true; sent.length = 0;
  assert.equal(run('requestSlot', { key: picked.key, name: 'Mail Fail', email: 'fail@example.com' }).ok, true);
  assert.equal(sent.length, 0);
  mailFails = false;
  context.sweep();
  assert.equal(mailTo('fail@example.com').length, 1);
  assert.equal(mailTo('ann@example.com').filter(message => /Mail Fail/.test(message.subject)).length, 0, 'the coach hears nothing before the YES');
  context.sweep();
  assert.equal(mailTo('fail@example.com').length, 1);
  quota = 5; sent.length = 0;
  const other = run('openSlots').slots[0];
  assert.equal(run('requestSlot', { key: other.key, name: 'Low Quota', email: 'low@example.com' }).ok, true);
  assert.equal(sent.length, 0, 'the last of the daily mail quota is not used up');
  quota = 100;
  context.sweep();
  assert.equal(mailTo('low@example.com').length, 1, 'held mail goes out once there is quota');
}
// A saved request is a success on the page even when the follow-up (emails, the public Sheet) throws: otherwise the student
// tries again and is told their own request has taken the time.
{
  const picked = run('openSlots').slots[0];
  quotaThrows = true; sent.length = 0;
  const result = run('requestSlot', { key: picked.key, name: 'Sweep Throws', email: 'throws@example.com' });
  quotaThrows = false;
  assert.equal(result.ok, true, 'a saved request is never reported as a failure');
  assert.equal(statusOf('throws@example.com'), 'unverified');
  assert.equal(held, 0, 'the lock is released');
  assert.equal(run('requestSlot', { key: picked.key, name: 'Sweep Throws', email: 'throws@example.com' }).ok, false, 'the time is held by the saved request');
  context.sweep();
  assert.equal(mailTo('throws@example.com').length, 1, 'the next sweep sends the confirmation email');
}
// A request still waiting on someone's YES gets one reminder that says who must reply; a YES to the reminder counts.
{
  const picked = run('openSlots').slots[0];
  const coachAddress = picked.coach === 'Coach Ann' ? 'ann@example.com' : null;
  sent.length = 0;
  assert.equal(run('requestSlot', { key: picked.key, name: 'Rex Reminder', email: 'rex@example.com' }).ok, true);
  context.sweep();
  assert.equal(mailTo('rex@example.com').filter(message => /^Reminder:/.test(message.subject)).length, 0, 'no reminder straight away');
  clock += hours(1) + 60000;
  context.sweep();
  context.sweep();
  const nudges = mailTo('rex@example.com').filter(message => /^Reminder: Confirm your coaching request \[CTTC ref [0-9A-F]{10}\]$/.test(message.subject));
  assert.equal(nudges.length, 1, 'the student is reminded once');
  assert.match(nudges[0].body, /Still waiting for you: .* has not been sent to the coach yet\. Reply YES/);
  assert.equal(sent.filter(message => message.to.toLowerCase() !== 'rex@example.com' && /Rex/.test(message.subject + message.body)).length, 0, 'the coach hears nothing before the student says YES');
  answerMail('rex@example.com', 'YES', nudges[0].subject);
  assert.equal(statusOf('rex@example.com'), 'pending', 'a YES to the reminder confirms the request');
  const coachMail = sent.filter(message => /^Lesson request from Rex Reminder/.test(message.subject)).pop();
  assert.ok(coachMail, 'the coach is asked once the student confirms');
  const coachTo = coachMail.to.toLowerCase();
  if (coachAddress) assert.equal(coachTo, coachAddress);
  clock += hours(1);
  context.sweep();
  assert.equal(mailTo(coachTo).filter(message => /^Reminder:/.test(message.subject)).length, 0, 'the coach gets two hours first');
  clock += hours(1) + 60000;
  context.sweep();
  context.sweep();
  const coachNudges = mailTo(coachTo).filter(message => /^Reminder: Lesson request from Rex Reminder \[CTTC ref [0-9A-F]{10}\]$/.test(message.subject));
  assert.equal(coachNudges.length, 1, 'the coach is reminded once');
  assert.match(coachNudges[0].body, /waiting for your YES/);
  const waiting = mailTo('rex@example.com').filter(message => /^Your coaching request is waiting on Coach /.test(message.subject));
  assert.equal(waiting.length, 1, 'the student is told it now waits on the coach');
  assert.match(waiting[0].body, /nothing more is needed from you/);
  answerMail(coachTo, 'YES', coachNudges[0].subject);
  assert.equal(statusOf('rex@example.com'), 'confirmed', 'a YES to the coach reminder confirms the lesson');
  assertPublicIsAnonymous();
}
// A YES sent in time but read late (the minute check was failing, or the reply was missed) still counts if the time is free.
{
  const picked = run('openSlots').slots[0];
  sent.length = 0;
  assert.equal(run('requestSlot', { key: picked.key, name: 'Lou Late', email: 'lou.late@gmail.com' }).ok, true);
  const subject = askedBy('lou.late@gmail.com', /^Confirm your coaching request/);
  clock += hours(1);
  const at = clock;
  const id = 'e' + messageCount++;
  // Gmail ignores dots, and phones add invisible characters: this is still Lou's YES.
  mailbox.push({ getId: () => id, getFrom: () => '"lou" <LouLate@gmail.com>', getSubject: () => 'Re: ' + subject, getDate: () => new Date(at),
    getPlainBody: () => '\u200bYES\u200b\r\n\r\nSent from my Galaxy' });
  clock += hours(1) + 60000;
  context.sweep();
  assert.equal(statusOf('lou.late@gmail.com'), 'expired', 'nobody read the reply before the deadline');
  assert.ok(run('openSlots').slots.some(slot => slot.key === picked.key), 'the time was released');
  sent.length = 0;
  check();
  assert.equal(statusOf('lou.late@gmail.com'), 'pending', 'the YES was sent before the deadline, so it counts once read');
  assert.ok(!run('openSlots').slots.some(slot => slot.key === picked.key), 'the time is held again');
  assert.ok(sent.some(message => /^Lesson request from Lou Late/.test(message.subject)), 'the coach is asked');
  assert.ok(sent.some(message => message.to === 'lou.late@gmail.com' && /^Coaching request sent to /.test(message.subject)), 'the student is told it went to the coach');
  check();
  assert.equal(statusOf('lou.late@gmail.com'), 'pending');
}
// A failing step of the minute check (here Google Voice) never stops email answers being read. The club is emailed once it has
// failed for 30 minutes without a break, and again when it works.
{
  const picked = run('openSlots').slots[0];
  assert.equal(run('requestSlot', { key: picked.key, name: 'Val Voice', email: 'val@example.com' }).ok, true);
  const coaches = grids.Coaches.slice(1);
  const asked = coaches.find(line => cell('Coaches', line, 'ask_ref'));
  const saved = asked ? null : coaches[0].slice();
  if (!asked) { coaches[0][column('Coaches', 'ask_ref')] = 'slots'; coaches[0][column('Coaches', 'ask_at')] = String(clock); }
  voiceDown = true; sent.length = 0;
  replyTo('val@example.com', 'YES', /^Confirm your coaching request/);
  assert.equal(statusOf('val@example.com'), 'pending', 'the email YES is read even though texts cannot be');
  const toClub = () => mailTo('owner@example.com').filter(message => /^(Action needed|Resolved): /.test(message.subject));
  assert.deepEqual(toClub(), [], 'a failure is logged, not emailed at once');
  check();
  assert.deepEqual(toClub(), []);
  const failing = JSON.parse(properties.FAILING_STEPS);
  assert.deepEqual(Object.keys(failing), ['read coach texts']);
  // Thirty minutes ago, without moving the clock the later checks run on.
  const since = failing['read coach texts'].since -= 30 * 60000;
  properties.FAILING_STEPS = JSON.stringify(failing);
  check();
  assert.deepEqual(toClub().map(message => message.subject), ['Action needed: the coaching app cannot read coach texts'], '30 minutes without a break');
  assert.match(toClub()[0].body, new RegExp('^The coaching app has failed to read coach texts at every attempt since ' + context.momentLabel_(since) + '\\. It retries at least every hour, and whenever a text or an email reply comes in\\.\\n\\n' +
    'Coaches\' YES and NO texts are not being read\\.\\n\\nError: Error: Google Voice is unavailable\\n\\nWHAT TO DO\\n\\n1\\. Check https://www\\.google\\.com/appsstatus/dashboard/ '));
  assert.match(toClub()[0].body, /2\. If Google lists no outage, forward this email to JB\.\n\nThe club gets a follow-up email when this step works again\.\n\nSent by the CTTC coaching app to the club account\.$/);
  check();
  assert.equal(toClub().length, 1, 'once');
  // A new column gets its header at the next sweep, without running setup() again.
  grids.Requests[0] = grids.Requests[0].slice(0, 23);
  delete properties.HEADERS;
  context.sweep();
  assert.equal(grids.Requests[0][23], 'reminded');
  // A deleted status sheet is made again.
  properties.COACHING_STATUS_ID = 'deleted-status-id';
  check();
  assert.equal(properties.COACHING_STATUS_ID, 'status-book-id');
  assert.match(books['status-book-id'].title, /^CTTC Coaching status \| \d{4}-\d{2}-\d{2} \d{2}:\d0 \| mail q=\d+ late=\d+.* \| failed: read coach texts: Error: Google Voice is unavailable/,
    'the status read-out shows the minute check ran and which step failed');
  // ...and so do ?log's last-run record and an error line.
  cache = {};
  const failedView = JSON.parse(context.doGet({ parameter: { log: '' } }).text);
  assert.equal(failedView.runs.checkTexts.ok, false);
  assert.deepEqual(failedView.runs.checkTexts.failed, ['read coach texts: Error: Google Voice is unavailable']);
  assert.ok(failedView.lines.some(line => line.channel === 'error' && line.kind === 'read-coach-texts' && line.detail === 'Error: Google Voice is unavailable'));
  assert.equal(grids.Log.slice(1).filter(line => line[2] === 'read-coach-texts').length, 1, 'a failure that repeats every minute is logged once per 10 minutes');
  voiceDown = false;
  check();
  assert.deepEqual(toClub().map(message => message.subject).slice(1), ['Resolved: the coaching app can read coach texts again']);
  assert.match(toClub()[1].body, new RegExp('^The coaching app can read coach texts again as of ' + context.momentLabel_(clock) + '\\. No action is needed\\.\\n\\nIt had failed at every attempt from ' +
    context.momentLabel_(since) + '\\. This resolves the email "Action needed: the coaching app cannot read coach texts"\\.'));
  check();
  assert.equal(toClub().length, 2, 'told once');
  toClub().forEach(message => assert.doesNotMatch(message.body, /\bonly\b/i, 'facts and actions, no "only"'));
  assert.deepEqual(JSON.parse(properties.FAILING_STEPS), {});
  if (saved) grids.Coaches[grids.Coaches.indexOf(coaches[0])] = saved;
  cache = {};
}
// A student under 18, booked by a parent: the parent's email confirms, the coach accepts, both get the right details.
{
  const picked = run('openSlots').slots[0];
  sent.length = 0;
  const result = run('requestSlot', { key: picked.key, name: 'Alex Kid', email: 'pat.parent@example.com', minor: true, guardian: 'Pat & Sam Parent', note: 'First lesson' });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.label, 'Student Alex', 'the site shows the student, not the parent');
  const ask = mailTo('pat.parent@example.com').pop();
  assert.match(ask.subject, /^Confirm your coaching request \[CTTC ref/);
  assert.match(ask.body, /^Hello Pat & Sam Parent, this is about the lesson for Alex Kid\./, 'the email speaks to the parent about the child');
  replyTo('pat.parent@example.com', 'Yes', /^Confirm your coaching request/);
  assert.equal(statusOf('pat.parent@example.com'), 'pending');
  const request = sent.filter(message => /^Lesson request from Alex Kid/.test(message.subject)).pop();
  assert.ok(request, 'the coach is asked');
  assert.match(request.body, /Alex Kid \(under 18\) asked for/, 'the coach knows the student is a minor');
  assert.doesNotMatch(request.body, /pat\.parent@|Pat & Sam/, 'and gets no contact details before accepting');
  answerMail(request.to, 'YES', request.subject);
  assert.equal(statusOf('pat.parent@example.com'), 'confirmed');
  const coachDone = mailTo(request.to.toLowerCase()).filter(message => /^Lesson confirmed/.test(message.subject)).pop();
  assert.match(coachDone.body, /Alex Kid \(guardian: Pat & Sam Parent\), pat\.parent@example\.com/, 'once confirmed the coach gets the guardian and their email');
  const parentDone = mailTo('pat.parent@example.com').filter(message => /^Lesson confirmed/.test(message.subject)).pop();
  assert.match(parentDone.body, /^Hello Pat & Sam Parent, this is about the lesson for Alex Kid\./);
  assert.ok(grids.Schedule.some(line => line[6] === 'Student Alex' && line[5] === 'Booked'), 'the public schedule shows Student Alex, booked');
  assertPublicIsAnonymous();
}
// An unanswered request is released after two hours, and the coach never hears of it.
{
  const picked = run('openSlots').slots[0];
  sent.length = 0;
  assert.equal(run('requestSlot', { key: picked.key, name: 'Quota Silent', email: 'silent@example.com' }).ok, true);
  assert.ok(!run('openSlots').slots.some(entry => entry.key === picked.key));
  clock += hours(2) + 60000;
  assert.ok(run('openSlots').slots.some(entry => entry.key === picked.key), 'the time is open again');
  context.sweep();
  assert.equal(statusOf('silent@example.com'), 'expired');
  assert.match(mailTo('silent@example.com').pop().body, /expired because we did not receive your YES reply in time. You are not booked[\s\S]*Check your spam or junk folder/);
  assert.equal(mailTo('ann@example.com').filter(message => /Quota Silent/.test(message.subject + message.body)).length, 0, 'the coach was never told');
  clock -= hours(2) + 60000;
}
assert.equal(held, 0, 'the lock is always released');

// ---- The public Sheet is a read-out: editing it changes nothing ----
{
  const before = JSON.stringify(grids.Schedule);
  const requestsBefore = JSON.stringify(grids.Requests);
  const slotsBefore = JSON.stringify(run('openSlots').slots);
  grids.Schedule.push(['2026-10-09', 'Friday', '9:00 PM', '10:00 PM', 'Coach A', 'Booked', 'Student Z', 'Student Z has session with Coach A']);
  grids.Schedule[1][7] = 'Coach A is on vacation';
  grids.Schedule[2] = [];
  grids.About[0][0] = 'defaced';
  const mailBefore = sent.length;
  assert.equal(JSON.stringify(run('openSlots').slots), slotsBefore, 'the booking page does not read the public Sheet');
  assert.equal(JSON.stringify(grids.Requests), requestsBefore, 'nothing was booked or cancelled');
  assert.equal(sent.length, mailBefore, 'and nobody was emailed');
  context.sweep();
  assert.equal(JSON.stringify(grids.Schedule), before, 'the next sweep puts the schedule back');
  assert.equal(JSON.stringify(grids.Requests), requestsBefore);
  assert.equal(sent.length, mailBefore);
  grids.About[0][0] = 'This is a read-out of the coaching schedule. Changing it does not change any booking.';
}

// ---- Coach ids ----
{
  for (const badId of ['', 'x', 'f'.repeat(16), annId.toUpperCase(), annId + ' ', '"><script>', undefined]) {
    assert.equal(run('coachBoard', badId).ok, false, 'no coach: ' + badId);
    assert.equal(propose(badId, [slot('2026-10-16', '19:00', 30)]).ok, false);
  }
  // One coach's list never touches another's, and two coaches at one time get different tables.
  const bobId = addCoach('Bob Coach', 'bob@example.com', '(925) 555-0102');
  assert.equal(coachRow(bobId)[5], 'Coach B');
  const annCount = mine(annId).length;
  publish(bobId, 'Bob Coach', [slot('2026-10-16', '20:00', 30)]);
  assert.equal(mine(annId).length, annCount, "one coach cannot remove another's slot");
  publish(annId, 'Ann Coach', mine(annId).concat(slot('2026-10-16', '20:00', 30)));
  assert.deepEqual(run('openSlots').slots.filter(entry => entry.date === '2026-10-16').map(entry => [entry.coach, entry.table]), [['Coach Ann', 2], ['Coach Bob', 1]],
    'two coaches can offer the same time; the second gets the next table');
  publish(bobId, 'Bob Coach', []);
  publish(annId, 'Ann Coach', mine(annId).filter(entry => entry.date !== '2026-10-16'));
  assert.equal(run('openSlots').slots.filter(entry => entry.date === '2026-10-16').length, 0);
  const annRow = grids.Coaches.findIndex(line => line[4] === annId);
  const statusColumn = column('Coaches', 'status');
  grids.Coaches[annRow][statusColumn] = 'disabled';
  assert.equal(run('coachBoard', annId).ok, false, 'a disabled coach is gone');
  assert.ok(!run('coachList').coaches.some(coach => coach.id === annId));
  assert.equal(propose(annId, [slot('2026-10-16', '19:00', 30)]).ok, false);
  assert.equal(run('openSlots').slots.length, 0, 'and their slots disappear');
  grids.Coaches[annRow][statusColumn] = 'active';
}

// ---- Nothing private ever reaches the public Sheet ----
context.sweep();
assertPublicIsAnonymous();
assert.ok(grids.Schedule.length > 1);
assert.ok(grids.Schedule.slice(1).every(line => /^Coach [A-Z][a-z]+$/.test(line[4]) && (line[6] === '' || /^Student [A-Z][a-z]+$/.test(line[6]))), 'first names only');

// ---- Texting through Google Voice: the handshake between a coach's phone and the site ----
{
  cache = {};
  const cyId = addCoach('Cy Coach', 'cy@example.com');
  const deeId = addCoach('Dee Coach', 'dee@example.com', '(925) 555-0142', false);
  assert.equal(coachRow(deeId)[5], 'Coach D', 'a coach is shown by the first letter of their first name');
  assert.deepEqual(run('coachList').coaches.map(coach => [coach.label, coach.ready, coach.registered]), [['Coach A', true, true], ['Coach B', true, true], ['Coach C', true, false], ['Coach D', true, false]]);
  assert.doesNotMatch(JSON.stringify([run('coachList'), run('coachBoard', deeId)]), PRIVATE, "a coach's full name and number never reach the page");
  assert.deepEqual(['ready', 'email', 'text'].map(key => run('coachBoard', cyId)[key]), [true, true, false]);

  // A coach with only an email address confirms by email.
  const cyAsked = propose(cyId, [slot('2026-10-30', '20:00', 60)]);
  assert.equal(cyAsked.message, 'Sent. Reply YES to the email we just sent to publish these times, or NO to cancel. Nothing changes until you reply.');
  assert.match(mailTo('cy@example.com').pop().body, /Want to confirm by text instead\? Ask the club to add your mobile number to the coach list\./);
  answerMail('cy@example.com', 'YES', askedBy('ann@example.com', /coaching times/));
  assert.equal(run('openSlots').slots.filter(entry => entry.coach === 'Coach Cy').length, 0, "another coach's code does not publish Cy's list");
  replyTo('cy@example.com', 'YES', /^Confirm your coaching times/);
  assert.equal(run('openSlots').slots.filter(entry => entry.coach === 'Coach Cy').length, 1, 'her emailed YES publishes it');
  assert.equal(mailTo('cy@example.com').pop().body.split('\n')[0], 'Done. Coach Cy now has 1 upcoming coaching time (1 added, 0 removed). Students can request them at concordtabletennisclub.com/coaching.html.');
  assert.equal(run('coachList').coaches.find(coach => coach.id === cyId).registered, false, 'an email-only coach can publish but gets no green check without a mobile and a text');
  // An emailed YES after 48 hours gets an email offering the same times again, with a new reference; YES to that publishes them.
  const beforeLate = clock;
  assert.equal(propose(cyId, [slot('2026-10-30', '20:00', 60), slot('2026-10-10', '17:00', 60)]).ok, true);
  const cyLate = askedBy('cy@example.com', /^Confirm your coaching times/);
  clock += hours(50);
  context.sweep();
  answerMail('cy@example.com', 'Yes', cyLate);
  const offeredAgain = mailTo('cy@example.com').pop();
  assert.match(offeredAgain.subject, /^Confirm your coaching times \[CTTC ref [0-9A-F]{10}\]$/);
  assert.notEqual(offeredAgain.subject, cyLate, 'with a new reference code');
  assert.match(offeredAgain.body, /^Your reply came after the 48-hour window for the coaching times you sent on \w+day, \w+ \d+, 2026, [\d:]+ [AP]M Pacific Time, so nothing was published\.\n\nGood news: these times are all still open\. To publish them, reply YES to this email by \w+day, /);
  assert.match(offeredAgain.body, /Add: Sat Oct 10 5:00-6:00 PM/);
  assert.equal(run('openSlots').slots.filter(entry => entry.coach === 'Coach Cy').length, 1, 'nothing published yet');
  answerMail('cy@example.com', 'YES', cyLate);
  assert.equal(mailTo('cy@example.com').pop(), offeredAgain, 'another YES to the old email is not answered twice');
  replyTo('cy@example.com', 'YES', /^Confirm your coaching times/);
  assert.match(mailTo('cy@example.com').pop().body, /^Done\. Coach Cy now has 2 upcoming coaching times/);
  // A late NO is acknowledged.
  assert.equal(propose(cyId, [slot('2026-10-30', '20:00', 60)]).ok, true);
  const cyRemove = askedBy('cy@example.com', /^Confirm your coaching times/);
  clock += hours(49);
  answerMail('cy@example.com', 'no', cyRemove);
  assert.equal(mailTo('cy@example.com').pop().body.split('\n')[0], 'OK, nothing was changed. Your coaching times stay as they were.');
  assert.equal(run('openSlots').slots.filter(entry => entry.coach === 'Coach Cy').length, 2);
  // Back to where the checks below expect the clock (Cy's lists are all answered, so nothing is left waiting).
  clock = beforeLate;
  cache = {};
  const dee = () => textsTo('Dee Coach', '(925) 555-0142');
  const deeLive = () => run('openSlots').slots.filter(entry => entry.coach === 'Coach Dee');
  const deeSet = [slot('2026-10-16', '19:00', 60), slot('2026-10-16', '20:00', 30)];

  // Voice can only answer someone who has texted the club number first; the email still goes.
  const noThread = propose(deeId, deeSet);
  assert.equal(noThread.ok, true);
  assert.match(noThread.message, /We could not text you: from your mobile, text COACH to \(925\) 238-3505 once to get texts too\./);
  assert.equal(dee().length, 0);
  clock += 11 * 60000;
  inbound('Dee Coach', 'COACH', clock - 60000);
  inbound('Dee Coach', 'YES', clock - 30000);
  assert.equal(propose(deeId, deeSet).ok, true);
  assert.deepEqual(dee(), ['CTTC: Reply YES by Sun Oct 4, 3:25 PM to update Coach Dee\'s coaching times, or NO to cancel. Add: Fri Oct 16 7:00-8:00 PM, 8:00-8:30 PM. Nothing changes until you reply.'],
    'one text, sent as a reply to the coach\'s own text');
  assert.equal(run('coachBoard', deeId).pending.length, 2);
  assert.ok(run('coachBoard', deeId).pendingSince);
  assert.equal(deeLive().length, 0, 'times waiting for the YES are hidden from students');
  assert.ok(!grids.Schedule.some(line => line[4] === 'Coach Dee'), 'and from the public Sheet');
  assert.match(propose(deeId, deeSet.slice(0, 1)).message, /a few minutes ago/, 'a second list has to wait ten minutes, so a stranger cannot spam the phone');
  assert.equal(run('coachList').coaches.find(coach => coach.id === deeId).registered, false, 'sending a list alone is not verification');

  // Her text to the club number verifies her at the next check. Only a YES from this coach's phone, sent after the question, counts.
  check();
  assert.equal(run('coachList').coaches.find(coach => coach.id === deeId).registered, true, 'her COACH text gives Coach D the green check');
  assert.deepEqual(verifiedTo('Dee Coach'), ['CTTC: Thanks, you are verified as Coach Dee. To offer coaching times, open concordtabletennisclub.com/coaching.html, ' +
    'tap I am a coach and pick Coach D. We will text you here to confirm your times and lesson requests.']);
  assert.equal(deeLive().length, 0, 'a YES sent before the question does not count');
  inbound('Dee Coach', 'Call me first', clock + 1000);
  inbound('Someone Else', 'YES', clock + 2000, otherFrom);
  inbound('Dee Coach', 'YES', clock + 3000, '"Dee" <dee@example.com>');
  check();
  assert.equal(deeLive().length, 0, "someone else's YES, a spoofed email and a reply with no yes in it do not count");
  assert.equal(dee().length, 1);
  say('(925) 555-0142', 'Yes.');
  assert.deepEqual(deeLive().map(entry => [entry.start, entry.minutes]), [['19:00', 50], ['20:00', 25]], 'a YES from the number on the list publishes the listed times');
  assert.equal(dee()[1], 'CTTC: Done. Coach Dee now has 2 upcoming coaching times (2 added, 0 removed). Students can request them at concordtabletennisclub.com/coaching.html.');
  assert.equal(run('coachBoard', deeId).pending, null);
  assert.ok(grids.Schedule.some(line => line[4] === 'Coach Dee' && line[5] === 'Open'), 'and they appear on the public Sheet');
  assertPublicIsAnonymous();
  gmailQueries.length = 0;
  check();
  assert.equal(dee().length, 2, 'the same YES never publishes twice');
  assert.ok(!gmailQueries.some(query => /Dee Coach|555-0142/.test(query)), 'and with no question waiting her texts are not searched');

  // NO cancels a list; a list can also remove times.
  assert.equal(propose(deeId, deeSet.concat(slot('2026-10-17', '15:00', 30))).ok, true);
  assert.match(dee()[2], /Add: Sat Oct 17 3:00-3:30 PM\./);
  say('Dee Coach', 'NO');
  assert.equal(dee()[3], 'CTTC: OK, nothing was changed. Your coaching times stay as they were.');
  assert.equal(deeLive().length, 2);
  assert.equal(propose(deeId, deeSet.slice(0, 1)).ok, true);
  assert.equal(dee()[4], 'CTTC: Reply YES by Sun Oct 4, 3:27 PM to update Coach Dee\'s coaching times, or NO to cancel. Remove: Fri Oct 16 8:00-8:30 PM. Nothing changes until you reply.');
  say('Dee Coach', 'YES');
  assert.equal(dee()[5], 'CTTC: Done. Coach Dee now has 1 upcoming coaching time (0 added, 1 removed). Students can request them at concordtabletennisclub.com/coaching.html.');
  assert.equal(deeLive().length, 1);

  // A list is open for 48 hours. A YES after that is answered, never ignored: with every time still free, the same list is offered
  // again for another 48 hours, and one more YES publishes it.
  assert.equal(propose(deeId, deeSet).ok, true);
  clock += hours(47);
  assert.equal(run('coachBoard', deeId).pending.length, 2, 'still open after 47 hours');
  clock += hours(2);
  assert.equal(run('coachBoard', deeId).pending, null, 'lapsed after 48');
  context.sweep();
  context.sweep();
  say('Dee Coach', 'YES');
  assert.match(dee()[dee().length - 1], /^CTTC: Your reply came after the 48-hour window, so nothing was published yet\. Good news: those times are all still open\. Reply YES by \w{3} \w{3} \d+, \d+:\d\d [AP]M to publish them, or NO to cancel\.$/);
  assert.equal(deeLive().length, 1, 'a late YES publishes nothing by itself');
  assert.equal(run('coachBoard', deeId).pending.length, 2, 'the list is open again');
  say('Dee Coach', 'YES');
  assert.match(dee()[dee().length - 1], /^CTTC: Done\. Coach Dee now has 2 upcoming coaching times/, 'one more YES publishes it');
  assert.equal(deeLive().length, 2);
  assert.deepEqual(grids.Log.slice(1).filter(line => line[2] === 'reply:coach-slots:yes').slice(-2).map(line => [line[1], line[5]]),
    [['text', 'not applied, now late, offered again'], ['text', 'applied']], 'both replies are logged');

  // A late YES when another coach has since taken the time: told which, and to pick again.
  const saturday = slot('2026-10-17', '15:00', 60);
  assert.equal(propose(deeId, deeSet.concat(saturday)).ok, true);
  clock += hours(49);
  context.sweep();
  const others = grids.Coaches.slice(1).map(line => cell('Coaches', line, 'coach_id')).filter(id => id && id !== deeId).slice(0, 3);
  others.forEach((id, index) => grids.Availability.push(['taken-' + index, id, '2026-10-17', '15:00', '60', 'yes', String(index + 1)]));
  say('Dee Coach', 'YES');
  assert.equal(dee()[dee().length - 1], 'CTTC: Your reply came after the 48-hour window, so nothing was published, and another coach has since taken Sat Oct 17 3:00-4:00 PM. ' +
    'Please pick your times again at concordtabletennisclub.com/coaching.html.');
  assert.equal(run('coachBoard', deeId).pending, null, 'nothing is offered again');
  say('Dee Coach', 'YES');
  assert.match(dee()[dee().length - 1], /^CTTC: Your reply came after/, 'and a second YES changes nothing');
  assert.equal(dee().filter(text => /another coach has since taken/.test(text)).length, 1, 'the coach is told once');
  for (let row = grids.Availability.length - 1; row >= 1; row -= 1) if (String(grids.Availability[row][0]).startsWith('taken-')) grids.Availability.splice(row, 1);

  // At most ten lists a day per coach.
  cache = {};
  let accepted = 0;
  let capped = null;
  while (!capped && accepted < 20) {
    const result = run('coachPropose', deeId, deeSet.concat(slot('2026-10-17', '15:00', 30)));
    if (!result.ok) capped = result;
    else { accepted += 1; say('Dee Coach', 'NO'); }
  }
  assert.equal(accepted, 10);
  assert.match(capped.message, /most changes for one day/);
  cache = {};

  // A student request: the coach is asked by text, one question at a time, and answers YES or NO.
  const tex = book(form(deeLive()[0], { name: 'Tex Student', email: 'tex@example.com' }));
  assert.equal(dee()[dee().length - 1], 'CTTC: Lesson request from Tex Student: 50 min, Fri Oct 16, 7:00 PM, Table 1. Reply YES to confirm or NO to decline.');
  assert.ok(mailTo('dee@example.com').some(message => /Tex Student/.test(message.subject) && /Reply YES: Confirm the lesson/.test(message.body)), 'the email goes out as well');
  const asked = dee().length;
  context.sweep();
  context.sweep();
  assert.equal(dee().length, asked, 'never repeated');
  const uma = book(form(deeLive()[0], { name: 'Uma Student', email: 'uma@example.com' }));
  assert.equal(dee().length, asked, 'a second request waits while the first question is fresh');
  clock += 11 * 60000;
  context.sweep();
  assert.equal(dee()[dee().length - 1], 'CTTC: Lesson request from Uma Student: 25 min, Fri Oct 16, 8:00 PM, Table 1. Reply YES to confirm or NO to decline.',
    'after ten minutes a new request is asked anyway');
  say('Dee Coach', 'YES');
  assert.equal(statusOf('uma@example.com'), 'confirmed', 'the YES answers the latest question');
  assert.equal(statusOf('tex@example.com'), 'pending');
  assert.deepEqual(dee().slice(-2), [
    'CTTC: Confirmed. ' + uma.label + ', 25 min lesson Fri Oct 16, 8:00 PM, Table 1, Walnut Creek Christian Academy, 2336 Buena Vista Ave, Walnut Creek, CA 94597. Student: Uma Student, uma@example.com.',
    'CTTC: Still waiting: Lesson request from Tex Student: 50 min, Fri Oct 16, 7:00 PM, Table 1. Reply YES to confirm or NO to decline.'
  ], 'and the earlier question is asked again');
  const umaMail = mailTo('uma@example.com').find(message => /^Lesson confirmed/.test(message.subject));
  assert.match(umaMail.body, /Coach: Dee Coach\n[^]*Email: dee@example\.com\nPhone: \(925\) 555-0142/);
  assert.match(umaMail.body, /Table 1/);
  say('Dee Coach', 'NO');
  assert.equal(statusOf('tex@example.com'), 'declined');
  assert.equal(dee()[dee().length - 1], 'CTTC: Declined. ' + tex.label + ' was told, and Fri Oct 16, 7:00 PM is open again.');
  cancelLesson('uma@example.com');
  assert.equal(dee()[dee().length - 1], 'CTTC: ' + uma.label + ' cancelled the lesson on Fri Oct 16, 8:00 PM. The time is open again.');
  assert.ok(dee().every(body => body.length <= 320 && !/[?]t=/.test(body)), 'short texts, never a link');

  // A list sent while a request is waiting: each YES answers the question it follows.
  const late = book(form(deeLive()[0], { name: 'Late Student', email: 'late@example.com' }));
  assert.match(dee()[dee().length - 1], /^CTTC: Lesson request from Late Student/);
  assert.equal(propose(deeId, deeSet.concat(slot('2026-10-17', '15:00', 30))).ok, true);
  say('Dee Coach', 'YES');
  assert.equal(statusOf('late@example.com'), 'pending', 'that YES was for the list');
  assert.deepEqual(dee().slice(-2), [
    'CTTC: Done. Coach Dee now has 3 upcoming coaching times (1 added, 0 removed). Students can request them at concordtabletennisclub.com/coaching.html.',
    'CTTC: Still waiting: Lesson request from Late Student: 50 min, Fri Oct 16, 7:00 PM, Table 1. Reply YES to confirm or NO to decline.'
  ]);
  say('Dee Coach', 'YES');
  assert.equal(statusOf('late@example.com'), 'confirmed');

  voiceDown = true;
  const outage = book(form(deeLive()[0], { name: 'Outage Student', email: 'outage@example.com' }));
  assert.equal(outage.ok, true, 'a Google Voice problem never blocks a booking');
  assert.ok(mailTo('dee@example.com').some(message => /Outage Student/.test(message.subject)), 'the email still goes out');
  const afterOutage = dee().length;
  voiceDown = false;
  context.sweep();
  assert.equal(dee().length, afterOutage + 1, 'a question that could not be sent is retried');
  context.sweep();
  assert.equal(dee().length, afterOutage + 1);
}

// ---- Three coaching tables: a coach can pick one, a taken one falls back, and a fourth coach is told the time is full ----
{
  cache = {};
  const ids = {};
  [['Eve', '0151'], ['Fay', '0152'], ['Gus', '0153'], ['Hal', '0154'], ['Ivy', '0155']].forEach(([name, number]) => {
    ids[name] = addCoach(name + ' Coach', name.toLowerCase() + '@example.com', '(925) 555-' + number);
  });
  const put = (name, list) => publish(ids[name], name + ' Coach', list);
  const date = '2026-10-24';
  assert.ok(run('openSlots').days.filter(day => day.date !== date).every(day => day.tables === 2), 'days that never need a third table show two');
  put('Eve', [slot(date, '15:00', 60)]);
  put('Fay', [slot(date, '15:30', 30, 2)]);
  assert.equal(run('openSlots').days.find(day => day.date === date).tables, 2);
  put('Gus', [slot(date, '15:30', 30, 1)]);
  assert.equal(run('openSlots').days.find(day => day.date === date).tables, 3, 'Table 1 was taken, so the third coach gets Table 3, and only then does it show');
  for (const [start, minutes] of [['15:30', 30], ['15:30', 60], ['15:00', 60]]) {
    const refused = propose(ids.Ivy, [slot(date, start, minutes)]);
    assert.equal(refused.ok, false, 'a fourth coach cannot take ' + start + ' ' + minutes);
    assert.match(refused.message, /All 3 coaching tables are taken by other coaches at Sat Oct 24, \d:\d\d PM/);
  }
  assert.equal(textsTo('Ivy Coach').length, 0, 'a refused list is never texted');
  put('Ivy', [slot(date, '16:00', 30)]);
  const ivyView = run('coachBoard', ids.Ivy);
  assert.equal(ivyView.tables, 3);
  assert.deepEqual(ivyView.board.filter(entry => entry.date === date).map(entry => [entry.start, entry.table, entry.coach, entry.mine]),
    [['15:00', 1, 'Coach Eve', false], ['15:30', 2, 'Coach Fay', false], ['15:30', 3, 'Coach Gus', false], ['16:00', 1, 'Coach Ivy', true]], 'a coach sees which table every other coach has');
  put('Fay', []);
  put('Ivy', [slot(date, '16:00', 30), slot(date, '15:30', 30, 2)]);
  assert.match(propose(ids.Ivy, [slot(date, '16:00', 30), slot(date, '15:30', 30, 2)]).message, /Nothing changed/);

  // Tables are checked again when the YES arrives: another coach may have taken one meanwhile.
  assert.equal(propose(ids.Hal, [slot(date, '17:00', 60)]).ok, true);
  put('Eve', [slot(date, '15:00', 60), slot(date, '17:00', 30)]);
  put('Fay', [slot(date, '17:00', 30)]);
  put('Gus', [slot(date, '15:30', 30), slot(date, '17:00', 30)]);
  say('Hal Coach', 'YES');
  assert.match(textsTo('Hal Coach').pop(), /^CTTC: Nothing changed: by the time you replied, other coaches had taken every table/);
  assert.ok(!run('openSlots').slots.some(entry => entry.date === date && entry.start === '17:00' && entry.minutes === 50), 'the full time never reaches students');

  // Students see every table in use: who took one (labels only) and which is still open.
  const at = start => run('openSlots').board.filter(entry => entry.date === date && entry.start === start);
  assert.deepEqual(at('17:00').map(entry => [entry.table, entry.coach, entry.time, entry.status]),
    [[1, 'Coach Eve', '5:00 PM to 5:25 PM', 'open'], [2, 'Coach Fay', '5:00 PM to 5:25 PM', 'open'], [3, 'Coach Gus', '5:00 PM to 5:25 PM', 'open']]);
  assert.deepEqual(at('15:00').map(entry => [entry.table, entry.minutes, entry.slot]), [[1, 50, 60]], 'a table keeps its number for the whole slot');
  assert.deepEqual(at('15:30').map(entry => entry.table), [2, 3]);
  assert.deepEqual(run('openSlots').days.filter(day => day.date === date), [{ date, day: 'Saturday, October 24, 2026', start: '15:00', end: '18:00', tables: 3 }]);
  const eveFive = at('17:00')[0];
  assert.equal(run('requestSlot', form(eveFive, { name: 'Wes Student', email: 'wes@example.com', length: 50 })).ok, false, 'a 30 minute time is not a 50 minute lesson');
  const wes = run('requestSlot', form(eveFive, { name: 'Wes Student', email: 'wes@example.com', length: 25 }));
  assert.equal(wes.ok, true);
  assert.deepEqual(at('17:00').map(entry => [entry.table, entry.status, entry.student, entry.waitlist]), [[1, 'requested', wes.label, false], [2, 'open', '', false], [3, 'open', '', false]], 'Table 1 is held, Tables 2 and 3 are still open at the same time, so no waitlist yet');
  assert.doesNotMatch(JSON.stringify(run('openSlots').board), PRIVATE);

  // Waitlist: a taken time can be watched once no other table is open then; the watcher is emailed once when it opens again.
  const wait = extra => run('joinWaitlist', Object.assign({ key: eveFive.key, email: 'val@example.com' }, extra));
  assert.match(wait().message, /Another table is open at that time/);
  assert.equal(wait({ key: at('17:00')[1].key }).ok, false, 'an open time is requested, not waitlisted');
  assert.match(wait({ key: at('17:00')[1].key }).message, /open/);
  assert.equal(run('requestSlot', form(at('17:00')[1], { name: 'Kim Student', email: 'kim@example.com', length: 25 })).ok, true);
  assert.equal(run('requestSlot', form(at('17:00')[2], { name: 'Ned Student', email: 'ned@example.com', length: 25 })).ok, true);
  assert.deepEqual(at('17:00').map(entry => entry.waitlist), [true, true, true], 'every table at that time is taken, so each can be watched');
  assert.equal(wait({ email: 'nope' }).ok, false);
  assert.equal(wait({ key: 'f'.repeat(16) }).ok, false);
  assert.equal(wait({ website: 'x' }).ok, true);
  assert.equal(grids.Waitlist.length, 1, 'the honeypot adds nothing');
  assert.equal(wait().ok, true);
  assert.equal(wait({ email: 'VAL@example.com' }).ok, true);
  assert.equal(grids.Waitlist.length, 2, 'joining twice adds one row');
  for (let index = 0; index < 9; index += 1) wait({ email: 'w' + index + '@example.com' });
  assert.match(wait({ email: 'late@example.com' }).message, /full/);
  sent.length = 0;
  context.sweep();
  assert.equal(sent.filter(message => /time you wanted/.test(message.subject)).length, 0, 'nobody is told while the time is still taken');
  replyTo('wes@example.com', 'NO', /^Confirm your coaching request/);
  assert.equal(statusOf('wes@example.com'), 'cancelled', "the student's NO cancels a request");
  const told = sent.filter(message => /time you wanted/.test(message.subject));
  assert.equal(told.length, 10, 'everyone waiting is told at once');
  assert.ok(told.some(message => message.to === 'val@example.com'));
  assert.match(told[0].body, /When: Saturday, October 24, 2026, 5:00 PM to 5:25 PM Pacific Time\nCoach: Coach Eve\nTable: Table 1/);
  assert.match(told[0].htmlBody, /#e3f1e7[^"]*"><strong>&#9733; JUST OPENED<\/strong><br>Coach Eve/, 'the open time is marked on the schedule');
  assert.equal(grids.Waitlist.length, 1, 'and taken off the list');
  context.sweep();
  assert.equal(sent.filter(message => /time you wanted/.test(message.subject)).length, 10, 'never twice');
  const again = run('requestSlot', form(at('17:00')[0], { name: 'Xia Student', email: 'xia@example.com' }));
  assert.equal(again.ok, true);
  assert.equal(wait({ email: 'yan@example.com' }).ok, true);
  assert.match(propose(ids.Eve, [slot(date, '15:00', 60)]).message, /Nothing changed/, 'a requested time stays on the list even when the coach leaves it out');
  replyTo('xia@example.com', 'NO', /^Confirm your coaching request/);
  put('Eve', [slot(date, '15:00', 60)]);
  sent.length = 0;
  context.sweep();
  assert.equal(grids.Waitlist.length, 1, 'a withdrawn time drops its waitlist');
}

// ---- Coach initials, and students who opt in to texts by texting STUDENT ----
{
  const abeId = addCoach('Abe Coach', 'abe@example.com', '(925) 555-0161');
  assert.equal(coachRow(abeId)[5], 'Coach A2', 'two coaches with one initial are still told apart');
  publish(abeId, 'Abe Coach', [slot('2026-10-17', '16:00', 30), slot('2026-10-17', '16:30', 30)]);

  cache = {};
  const piaPhone = '"(925) 555-0123 (SMS)" <19255550100.19255550123.abc@txt.voice.google.com>';
  const pia = () => textsTo('(925) 555-0123');
  const studentRow = () => grids.Students.find(line => line[1] === 'pia@example.com');
  const abeSlot = () => run('openSlots').slots.find(entry => entry.coach === 'Coach Abe');
  assert.equal(run('requestSlot', form(abeSlot(), { name: 'Pia Student', email: 'pia@example.com', phone: '555-12' })).ok, false, 'a number that is not a US mobile is refused');
  const piaFirst = run('requestSlot', form(abeSlot(), { name: 'Pia Student', email: 'pia@example.com', phone: '(925) 555-0123' }));
  assert.equal(piaFirst.ok, true);
  assert.equal(piaFirst.texts, true);
  assert.equal(piaFirst.textNumber, '(925) 238-3505');
  assert.match(mailTo('pia@example.com').pop().body, new RegExp('You will show on the site as "' + piaFirst.label + '"'));
  replyTo('pia@example.com', 'YES', /^Confirm your coaching request/);
  const second = run('requestSlot', form(abeSlot(), { name: 'Pia Student', email: 'pia@example.com' }));
  assert.equal(second.texts, false, 'the number is optional');
  assert.match(second.message, /^Almost done: we emailed you\. Reply YES to that email/, 'and until she texts STUDENT, she confirms by email');
  replyTo('pia@example.com', 'NO', /^Confirm your coaching request/);
  assert.deepEqual([cell('Students', studentRow(), 'name'), cell('Students', studentRow(), 'phone'), cell('Students', studentRow(), 'texts')], ['Pia Student', '9255550123', ''], 'a request without a number keeps the one on file');
  const welcome = mailTo('pia@example.com').find(message => /not confirmed yet/.test(message.subject));
  assert.match(welcome.body, /send a text with the word STUDENT to \(925\) 238-3505/);

  check();
  assert.equal(pia().length, 0);
  inbound('Someone Else', 'STUDENT', clock + 1000, otherFrom);
  inbound('(925) 555-0123', 'Student', clock + 2000, piaPhone);
  check();
  assert.equal(textsTo('Someone Else').length, 0, 'a number nobody gave gets no answer');
  assert.deepEqual(pia(), ['CTTC: You will get texts about your coaching lessons, such as cancellations. Text STOP to stop.']);
  assert.equal(cell('Students', studentRow(), 'texts'), 'yes');
  check();
  assert.equal(pia().length, 1, 'the same text is answered once');

  say('Abe Coach', 'YES');
  assert.equal(statusOf('pia@example.com'), 'cancelled', 'her second request was the one she said NO to');
  assert.equal(cell('Requests', requestBy('pia@example.com')[0], 'status'), 'confirmed');
  assert.equal(pia()[1], 'CTTC: ' + piaFirst.label + ', your lesson with Coach Abe on Sat Oct 17, 4:00 PM is confirmed. Coach: Abe Coach, abe@example.com, (925) 555-0161.',
    "sent as a reply to the student's own text, with the coach's contact details");
  assert.match(textsTo('Abe Coach').join('\n'), /Student: Pia Student, pia@example\.com, \(925\) 555-0123\./, "the coach gets the student's mobile number too");
  assert.match(mailTo('abe@example.com').find(message => /^Lesson confirmed/.test(message.subject)).body, /Student: Pia Student, pia@example\.com, \(925\) 555-0123/);
  // With texts on, a change is asked by text as well as email, and either YES does it. Her mobile number identifies her.
  sent.length = 0;
  assert.equal(run('studentChange', { key: keyOf('pia@example.com'), action: 'cancel', contact: '925.555.0123' }).ok, true);
  assert.match(mailTo('pia@example.com')[0].subject, /^Confirm: cancel your lesson/);
  assert.equal(pia()[2], 'CTTC: Reply YES to cancel ' + piaFirst.label + '\'s lesson on Sat Oct 17, 4:00 PM, or NO to keep it.');
  say('Someone Else', 'YES', otherFrom);
  assert.equal(cell('Requests', requestBy('pia@example.com')[0], 'status'), 'confirmed');
  say('(925) 555-0123', 'yes', piaPhone);
  assert.equal(cell('Requests', requestBy('pia@example.com')[0], 'status'), 'cancelled');
  assert.equal(pia()[3], 'CTTC: ' + piaFirst.label + ', your lesson on Sat Oct 17, 4:00 PM is cancelled.');
  // A new request is asked by text too.
  const third = run('requestSlot', form(abeSlot(), { name: 'Pia Student', email: 'pia@example.com' }));
  assert.match(third.message, /^Almost done: we emailed you and texted your mobile\. Reply YES to either one within 2 hours/);
  assert.match(pia()[4], new RegExp('^CTTC: Reply YES to send ' + piaFirst.label + '\'s request to Coach Abe: 25 min, Sat Oct 17, 4:00 PM, Table 1\\. Reply NO to cancel it\\.$'));
  say('(925) 555-0123', 'YES', piaPhone);
  assert.equal(statusOf('pia@example.com'), 'pending', 'her texted YES sends it to the coach');
  say('Abe Coach', 'NO');
  assert.doesNotMatch(pia().filter((body, index) => index !== 1).join(' '), /Pia Student|pia@|Abe Coach|[?]t=/, 'first names only in a text, except the confirmation');
  const piaCount = pia().length;
  context.sweep();
  assert.equal(pia().length, piaCount, 'never repeated');

  inbound('(925) 555-0123', 'STOP', clock + 3000, piaPhone);
  check();
  assert.equal(pia()[piaCount], 'CTTC: Coaching texts are off. Text STUDENT to turn them back on.');
  assert.equal(cell('Students', studentRow(), 'texts'), '');
  assert.equal(run('requestSlot', form(abeSlot(), { name: 'Pia Student', email: 'pia@example.com' })).ok, true);
  replyTo('pia@example.com', 'NO', /^Confirm your coaching request/);
  assert.equal(pia().length, piaCount + 1, 'no texts after STOP');
}

// ---- Time zones ----
{
  // 8 PM Friday in California is already Saturday in UTC: "today" and "a day's notice" still follow Pacific time.
  clock = Date.parse('2026-10-03T03:00:00Z');
  inbox.length = 0;
  inbound('Ann Coach', 'COACH', clock - 60000);
  assert.equal(run('coachBoard', annId).days[0].date, '2026-10-02', "today's Friday is still today");
  assert.match(propose(annId, mine(annId).concat(slot('2026-10-02', '19:30', 30))).message, /Nothing changed/, 'a slot that has already started is left out');
  publish(annId, 'Ann Coach', mine(annId).concat(slot('2026-10-02', '21:00', 30)));
  assert.ok(mine(annId).some(entry => entry.date === '2026-10-02' && entry.start === '21:00'));
  assert.ok(run('openSlots').slots.every(entry => entry.date !== '2026-10-02'), 'tonight is under 24 hours away, so it is not offered');
  // After the clocks go back the label still says Pacific Time and the wall-clock hour is unchanged.
  clock = Date.parse('2026-11-01T12:00:00Z');
  publish(annId, 'Ann Coach', mine(annId).concat(slot('2026-11-06', '19:00', 30)));
  const later = run('openSlots').slots.find(entry => entry.date === '2026-11-06' && entry.start === '19:00');
  assert.equal(later.label, 'Friday, November 6, 2026, 7:00 PM to 7:25 PM Pacific Time');
  clock = START;
}

// ---- Rate limit ----
cache = {};
let refused = 0;
for (let index = 0; index < 40; index += 1) if (!run('requestSlot', { key: 'x', name: 'Flood', email: 'flood' + index + '@example.com' }).ok) refused += 1;
assert.equal(refused, 40);
cache = {};
let busy = 0;
for (let index = 0; index < 40; index += 1) if (/Too many/.test(run('coachPropose', 'f'.repeat(16), []).message || '')) busy += 1;
assert.ok(busy > 0, 'a burst is slowed down');

// ---- The club site's copy of the page calls the app with fetch (doPost), without cookies ----
{
  const post = body => { cache = {}; const output = context.doPost({ postData: { contents: body } }); assert.equal(output.type, 'JSON'); return JSON.parse(output.text); };
  cache = {};
  assert.deepEqual(post(JSON.stringify({ fn: 'openSlots', args: [] })), run('openSlots'), 'the same answer as google.script.run');
  cache = {};
  assert.deepEqual(post(JSON.stringify({ fn: 'coachList', args: [] })), run('coachList'));
  ['setup', 'sweep', 'checkTexts', 'doGet', 'doPost', 'logView_', 'constructor', '__proto__', 'toString'].forEach(fn => {
    assert.deepEqual(post(JSON.stringify({ fn, args: [] })), { ok: false, message: 'Unknown request.' }, fn + ' cannot be called from the site');
  });
  assert.deepEqual(post('not json'), { ok: false, message: 'Something went wrong. Please try again.' });
  assert.deepEqual(post(''), { ok: false, message: 'Unknown request.' });
  assert.deepEqual(post('x'.repeat(100001)), { ok: false, message: 'Unknown request.' }, 'an oversized request is refused');
  assert.deepEqual(JSON.parse(context.doPost(undefined).text), { ok: false, message: 'Unknown request.' });
  cache = {};
}

// ---- doGet and the page ----
templates.length = 0;
const served = context.doGet({ parameter: { t: '"><script>alert(1)</script>' } });
assert.equal(templates.length, 1);
assert.deepEqual(Object.keys(templates[0]).sort(), ['evaluate', 'name'], 'nothing from the address reaches the page');
const initial = JSON.parse(/var INITIAL = (.*);\n/.exec(served.getContent())[1]);
assert.deepEqual(Object.keys(initial), ['openSlots', 'coachList'], 'the first screen comes with the page');
assert.deepEqual(initial.openSlots, run('openSlots'));
assert.deepEqual(initial.coachList, run('coachList'));
assert.doesNotMatch(served.getContent(), /alert\(1\)/);
assert.equal(context.scriptJson_({ name: '</script><script>alert(1)</script>\u2028' }), '{"name":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>\\u2028"}', 'a name cannot end the script');
const openBooks = Object.keys(books).length;
const brokenId = properties.COACHING_DB_ID;
properties.COACHING_DB_ID = '';
context.openBooks_ = {};
context.bookIds_ = {};
const fallback = context.doGet({});
assert.match(fallback.getContent(), /var INITIAL = null;/, 'on a problem the page loads its data itself');
properties.COACHING_DB_ID = brokenId;
assert.equal(Object.keys(books).length, openBooks);

const page = fs.readFileSync(__dirname + '/Index.html', 'utf8');
assert.doesNotMatch(page, /<\?/, 'the page is static: no template tags');
assert.doesNotMatch(page, /<script[^>]*\ssrc=|<link[^>]*rel="stylesheet"/i, 'the page loads nothing from elsewhere');
assert.doesNotMatch(page, /<\?!=|innerHTML|outerHTML|document\.write|eval\(/, 'nothing typed by a visitor is turned into markup');
assert.doesNotMatch(page, /var status\b/, 'window.status must not be shadowed');
assert.match(page, /Which CTTC registered coach are you\?/);
const script = /<script>([\s\S]*?)<\/script>/.exec(page)[1];
new vm.Script(script);
const called = new Set([...script.matchAll(/(?:call|guarded|load|preload)\((?:[a-z]+, )?'([A-Za-z]+)'/g)].map(match => match[1]));
assert.deepEqual([...called].sort(), ['coachBoard', 'coachList', 'coachPropose', 'joinWaitlist', 'openSlots', 'requestSlot', 'studentChange']);
for (const name of called) assert.ok(globals.includes(name) && !name.endsWith('_'), name + ' exists and is callable from the page');

// ---- The site page that frames the app ----
const sitePage = fs.readFileSync(__dirname + '/../coaching.html', 'utf8');
assert.match(sitePage, /<button id="coaching-launch"[^>]* hidden>/, 'the button stays hidden until the app is deployed');
assert.match(sitePage, /<iframe id="coaching-frame"/);
assert.doesNotMatch(sitePage, /sign-in link/i, 'coaches no longer sign in');
const siteScript = /<script>\s*\(function \(\) \{\s*\/\/ The coaching app[\s\S]*?<\/script>/.exec(sitePage)[0].replace(/^<script>|<\/script>$/g, '');
assert.match(siteScript, /var APP_PAGE = 'coaching-app\.html';/, 'the site frames its own copy of the page');
assert.doesNotMatch(siteScript, /script\.google\.com/, 'never Google\'s page host, which can refuse a browser signed in to several Google accounts');
const workflow = fs.readFileSync(__dirname + '/../.github/workflows/update-data.yml', 'utf8');
assert.match(workflow, /cp coaching-app\/Index\.html _site\/coaching-app\.html/, 'the site publishes the page');
const apiUrl = /var API_URL = '([^']+)';/.exec(page)[1];
assert.match(apiUrl, /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/, 'the copy calls a released /exec address, never /dev');
assert.ok(fs.readFileSync(__dirname + '/../docs/coaching-flow.md', 'utf8').includes(apiUrl), 'the address is written down for maintainers');
const appUrl = 'coaching-app.html';
const SITE = 'https://concordtabletennisclub.com';
const openSite = (search, script = siteScript) => {
  const nodes = {};
  const node = id => nodes[id] = nodes[id] || { id, hidden: id === 'coaching-launch', attributes: {}, listeners: {}, opened: false,
    getAttribute(name) { return this.attributes[name] || null; }, setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(type, handler) { this.listeners[type] = handler; }, showModal() { this.opened = true; }, close() { this.opened = false; } };
  const loaded = [];
  const messages = [];
  vm.runInNewContext(script, { URLSearchParams, setTimeout: handler => handler(), location: { search }, document: { getElementById: node }, window: { location: { origin: SITE }, addEventListener: (type, handler) => { if (type === 'load') loaded.push(handler); if (type === 'message') messages.push(handler); } } });
  nodes.load = () => loaded.forEach(handler => handler());
  nodes.message = event => messages.forEach(handler => handler(event));
  return nodes;
};
let site = openSite('');
assert.equal(site['coaching-launch'].hidden, false);
assert.equal(site['coaching-dialog'].opened, false, 'the dialog opens on the click');
site.load();
assert.equal(site['coaching-frame'].attributes.src, appUrl, 'the app loads in the background once the page is in');
assert.equal(site['coaching-dialog'].opened, false);
site = openSite('');
site['coaching-launch'].listeners.click();
assert.equal(site['coaching-dialog'].opened, true);
assert.equal(site['coaching-frame'].attributes.src, appUrl);
assert.match(sitePage, /<p id="coaching-loading"[^>]*>Loading/, 'the dialog says it is loading instead of showing a blank page');
assert.notEqual(site['coaching-loading'].hidden, true);
site.message({ data: 'cttc-coaching-ready', origin: 'https://evil.example.com' });
site.message({ data: 'other', origin: 'https://n-abc123-0lu-script.googleusercontent.com' });
assert.notEqual(site['coaching-loading'].hidden, true, 'only the app can clear the loading note');
site.message({ data: 'cttc-coaching-ready', origin: 'https://n-abc123-0lu-script.googleusercontent.com' });
assert.equal(site['coaching-loading'].hidden, true, 'the note goes once the app is drawn, also by Google\'s page when the copy hands over to it');
site = openSite('');
site.message({ data: 'cttc-coaching-ready', origin: SITE });
assert.equal(site['coaching-loading'].hidden, true, 'the site\'s own copy clears it');
site = openSite('');
site['coaching-frame'].listeners.load();
assert.equal(site['coaching-loading'].hidden, true, 'and never stays forever');
assert.match(page, /postMessage\('cttc-coaching-ready', '\*'\)/);
{
  // Offer all slots: run the page's own offerAll and overlapsMine on a 3 hour Friday (6 half hours).
  const pick = (name) => page.match(new RegExp('\\n    function ' + name + '\\([\\s\\S]*?\\n    }\\n'))[0];
  const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const fromMinutes = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const offerAll = (length, used, held, wanted) => {
    const sandbox = { length, held, wanted, toMinutes, fromMinutes, shown: [], drawn: 0 };
    sandbox.show = (text, kind) => sandbox.shown.push([text, kind]);
    sandbox.draw = () => { sandbox.drawn += 1; };
    vm.runInNewContext(pick('offerAll') + pick('overlapsMine') + 'offerAll({ date: "2026-10-09", start: "19:00" }, 1, used, 6);', Object.assign(sandbox, { used }));
    return sandbox;
  };
  let result = offerAll(60, {}, [], []);
  assert.deepEqual(result.wanted.map((s) => s.start + '/' + s.minutes), ['19:00/60', '20:00/60', '21:00/60'], 'a free table becomes three hours');
  assert.equal(result.drawn, 1);
  result = offerAll(60, { '1:1': true, '1:4': true }, [], []);
  assert.deepEqual(result.wanted.map((s) => s.start + '/' + s.minutes), ['19:00/30', '20:00/60', '21:30/30'], 'gaps around taken times are filled');
  result = offerAll(60, {}, [{ date: '2026-10-09', start: '20:00', slot: 60 }], [{ date: '2026-10-09', start: '19:00', minutes: 30, table: 2 }]);
  assert.deepEqual(result.wanted.slice(1).map((s) => s.start + '/' + s.minutes), ['19:30/30', '21:00/60'], 'times the coach already has at another table are skipped');
  result = offerAll(30, {}, [{ date: '2026-10-09', start: '19:00', slot: 180 }], []);
  assert.equal(result.wanted.length, 0);
  assert.match(result.shown[0][0], /overlaps another of your times/, 'and saying so when nothing is left');
  assert.match(page, /'Offer all slots'/);
}
site = openSite('?t=abc.def');
assert.equal(site['coaching-dialog'].opened, false, 'the page opens nothing by itself');
site['coaching-launch'].listeners.click();
assert.equal(site['coaching-frame'].attributes.src, appUrl, 'and nothing from the address reaches the frame');

// A failure's detail keeps the error but never an address, a number, quoted text or a long id.
cache = {};
context.logError_('check the cleaner', new Error('Invalid email: sam@example.com, "Sam Student", \'Pat\', +1 (925) 555-1234, sheet 1d1vTRF839PRzLy4cEt70sA3yX1A'), 'r1');
assert.deepEqual(grids.Log[grids.Log.length - 1].slice(1), ['error', 'check-the-cleaner', 'r1', '-',
  'Error: Invalid email: <address> "…", \'…\', <number>, sheet <id>']);
context.logError_('check the cleaner', new Error('again'), 'r1');
assert.equal(grids.Log[grids.Log.length - 1][5].startsWith('Error: Invalid'), true, 'the same failure is not logged twice within 10 minutes');
context.checkTexts();
context.sweep();
// ?log shows the latest sends to anyone, as JSON: times, kinds and codes only.
cache = {};
const logView = context.doGet({ parameter: { log: '' } });
assert.equal(logView.type, 'JSON');
const viewed = JSON.parse(logView.text);
assert.equal(viewed.ok, true);
assert.equal(viewed.runs.checkTexts.ok, true, 'the last minute check is shown');
assert.deepEqual(viewed.runs.checkTexts.failed, []);
assert.equal(viewed.runs.sweep.ok, true, 'and the last sweep');
assert.match(viewed.runs.sweep.at, /^\d{4}-\d\d-\d\dT/);
assert.equal(viewed.lines.length, Math.min(context.LOG_SHOWN, grids.Log.length - 1));
viewed.lines.forEach(line => {
  assert.deepEqual(Object.keys(line), ['at', 'channel', 'kind', 'ref', 'to', 'detail']);
  assert.match(line.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/);
  assert.match(line.channel, /^(email|text|step|error|-)$/);
  assert.match(line.kind, /^[a-z0-9_:-]+$/);
  assert.match(line.ref, /^([0-9A-F]{6}|-)$/, 'what a message was about is shown only as a code');
  assert.match(line.to, /^([0-9A-F]{6}|-)$/);
});
const rawIds = new Set(requestRows().map(line => cell('Requests', line, 'request_id')));
assert.ok(!viewed.lines.some(line => rawIds.has(line.ref)), 'never a request id from the private Sheet');
assert.doesNotMatch(logView.text, PRIVATE, 'never a name or address');
assert.doesNotMatch(logView.text.replace(/"(ref|to)":"[0-9A-F-]+"|"at":"[^"]+"/g, ''), /\d{3}\D?\d{3}\D?\d{4}/, 'or a number');
const sameRef = viewed.lines.filter(line => line.kind === 'student_emailed:pending' || line.kind === 'coach_emailed:pending');
assert.ok(sameRef.length >= 2 && sameRef.every(line => viewed.lines.filter(other => other.ref === line.ref).length >= 2), 'messages about one request share its code');
// One booking's whole story at ?log=<code>: the code in its emails, its steps, what was sent and the replies, in order.
cache = {};
const samRequest = requestBy('sam@example.com')[0];
const samCode = context.bookingCode_({ request_id: cell('Requests', samRequest, 'request_id') });
assert.match(samCode, /^[0-9A-F]{6}$/);
const samCodes = requestBy('sam@example.com').map(line => context.bookingCode_({ request_id: cell('Requests', line, 'request_id') }));
const samMail = allSent.filter(message => message.to.toLowerCase() === 'sam@example.com' && message.subject !== 'We could not read your reply');
assert.ok(samMail.every(message => samCodes.some(code => message.body.includes('Booking code: ' + code + '. Quote it if you contact the club about this lesson.'))),
  'every email to the student about a booking carries its code');
assert.ok(samMail.filter(message => message.body.includes(samCode)).length >= 5);
assert.ok(allSent.filter(message => /^Lesson (request from|confirmed)/.test(message.subject) && message.to === 'ann@example.com' && message.body.includes(samCode)).length >= 2,
  'and so do the coach\'s');
const story = JSON.parse(context.doGet({ parameter: { log: samCode.toLowerCase() } }).text);
assert.ok(story.lines.length && story.lines.every(line => line.ref === samCode), 'only that booking\'s lines');
assert.deepEqual(story.lines.filter(line => line.channel === 'step').map(line => line.kind), ['step:unverified', 'step:pending', 'step:confirmed', 'step:cancelled']);
assert.match(story.lines[0].detail, /^waiting on student until \w+day, /, 'each step says who must act and by when');
assert.deepEqual(story.lines.filter(line => line.kind.startsWith('reply:')).map(line => line.kind + ' ' + line.detail),
  ['reply:student-v:yes applied, now pending', 'reply:coach-request:yes applied, now confirmed', 'reply:student-c:yes applied, now cancelled']);
assert.deepEqual(Object.keys(story.booking), ['code', 'date', 'start', 'status', 'waitingOn', 'deadline']);
assert.equal(story.booking.code, samCode);
assert.equal(story.booking.status, 'cancelled');
assert.equal(JSON.parse(context.doGet({ parameter: { log: '000000' } }).text).booking, null, 'an unknown code finds nothing');
assert.equal(JSON.parse(context.doGet({ parameter: { log: '' } }).text).booking, undefined);
const movedStep = grids.Log.slice(1).find(line => /^moved from [0-9A-F]{6}$/.test(String(line[5]).split(', ').pop()));
assert.ok(movedStep && movedStep[2] === 'step:pending', 'a move logs the new booking with the code it came from');
assert.ok(grids.Log.slice(1).some(line => line[2] === 'step:expired'), 'the sweep logs an expiry as a step');
assert.match(story.runs.checkTexts.mail, /^q=\d+ late=\d+/, 'the last minute check shows the same mail counts as the status read-out');
for (let read = 3; read < context.MAX_LOG_READS_PER_MINUTE; read += 1) context.doGet({ parameter: { log: '' } });
assert.deepEqual(JSON.parse(context.doGet({ parameter: { log: '' } }).text), { ok: false, message: 'Too many reads. Try again in a minute.' }, 'reads are limited');
assert.notEqual(context.doGet({}).getContent, undefined, 'without ?log the page is served as before');
// The sweep keeps only the latest LOG_KEEP rows.
cache = {};
context.LOG_KEEP = LOG_KEEP;
for (let extra = grids.Log.length - 1; extra <= context.LOG_KEEP + 5; extra += 1) grids.Log.push(['2026-10-01T00:00:00.000Z', 'email', 'old', '-', '-']);
const newest = grids.Log[grids.Log.length - 1];
context.sweep();
assert.equal(grids.Log.length - 1, context.LOG_KEEP);
assert.ok(grids.Log.includes(newest), 'the oldest rows go first');
assert.deepEqual(grids.Log[0], ['at', 'channel', 'kind', 'ref', 'to', 'detail']);
assert.ok(logs.length, 'the logs were checked');
assert.doesNotMatch(logs.join('\n'), PRIVATE, 'the logs never hold a name, address or number');
assert.doesNotMatch(logs.join('\n').replace(/ (ref|to)=\S+/g, ''), /\d{3}\D?\d{3}\D?\d{4}/, 'or a phone number');
logs.filter(line => line.startsWith('coaching sent ')).forEach(line => {
  assert.match(line, /^coaching sent (email|text) [a-z_-]+(:[a-z]+)? ref=\S.* to=[0-9A-F]{6}$/, 'each line names the channel, the kind, what it is about and a recipient code');
});
// The club site's copy (coaching-app.html): no google.script, so every call is a fetch to the app, with no cookies. Until the app
// answers (the site is a release ahead of it), the copy hands over to Google's own page instead of showing an error.
(async () => {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const openCopy = answer => {
    const requests = [];
    const navigations = [];
    const messages = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => { if (/navigation/i.test(error.message)) navigations.push(error.message); else throw error; });
    const dom = new JSDOM(page, {
      url: SITE + '/coaching-app.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
      beforeParse(window) {
        window.HTMLElement.prototype.scrollIntoView = () => {};
        window.top.postMessage = message => messages.push(message);
        window.fetch = (url, options) => { requests.push({ url, options }); return answer(options); };
      }
    });
    return { dom, requests, navigations, messages };
  };
  const viaDoPost = options => {
    cache = {};
    const text = context.doPost({ postData: { contents: options.body } }).text;
    return Promise.resolve({ json: () => Promise.resolve(JSON.parse(text)) });
  };
  let copy = openCopy(viaDoPost);
  await wait(50);
  assert.ok(copy.requests.length >= 2, 'the first screen is fetched from the app');
  copy.requests.forEach(request => {
    assert.equal(request.url, apiUrl);
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.credentials, 'omit', 'no cookies, so Google sign-ins never matter');
    assert.ok(['openSlots', 'coachList', 'coachBoard'].includes(JSON.parse(request.options.body).fn));
  });
  assert.deepEqual(copy.navigations, [], 'a working app keeps the copy');
  const shown = copy.dom.window.document.getElementById('app').textContent + copy.dom.window.document.getElementById('message').textContent;
  assert.doesNotMatch(shown, /Something went wrong/);
  assert.match(shown, /Coaching is on Fridays/, 'the booking view is drawn');
  assert.deepEqual(copy.messages, ['cttc-coaching-ready']);
  copy.dom.window.close();
  // The app before this release answers a POST with Google's HTML error page: the copy goes to Google's page instead.
  copy = openCopy(() => Promise.resolve({ json: () => Promise.reject(new SyntaxError('Unexpected token <')) }));
  await wait(50);
  assert.ok(copy.navigations.length >= 1, 'hands over to Google\'s own page');
  copy.dom.window.close();
  // Texts are read from the desk's tab; Gmail is searched for them only to text back someone with no collected text yet.
  // ---- When the check runs (90 minutes a day of timer run time are shared by every club app) ----
  // No timer of its own: the hourly sweep runs it, and the desk's mail reader wakes it through doPost when something came in.
  {
    const at = (date, time) => { clock = Date.parse(date + 'T' + time + ':00Z') + 7 * 3600000; }; // Pacific wall clock (PDT)
    const post = body => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).text);
    const runs = () => (logs.join('\n').match(/coaching checkTexts skipped/g) || []).length;
    // An app updated from the 30-minute timer and its one-off: their first run takes both away, and keeps the sweep.
    triggers = [{ handler: 'checkTextsWatch', every: 30 }, { handler: 'checkTexts', after: 900000 }, { handler: 'sweep', every: 60 }];
    delete properties.CHECK_SCHEDULE;
    at('2026-10-20', '12:00');
    delete cache['check-texts'];
    context.checkTextsWatch({ triggerUid: 'timer' });
    assert.deepEqual(timers(), ['sweep every 60'], 'the old check timers are gone');
    triggers = [{ handler: 'checkTexts', every: 1 }];
    delete properties.CHECK_SCHEDULE;
    delete cache['check-texts'];
    context.checkTexts({ triggerUid: 'timer' });
    assert.deepEqual(timers(), ['sweep every 60'], 'a missing sweep timer is put back');
    // The sweep runs the check: a YES that came in is read within the hour even if no wake came.
    const before = JSON.parse(properties.RUN_checkTexts).at;
    clock += 60000;
    delete cache['check-texts'];
    context.sweep({ triggerUid: 'timer' });
    assert.notEqual(JSON.parse(properties.RUN_checkTexts).at, before, 'the hourly sweep runs the check');
    // A wake needs the desk's key, and does nothing without it.
    const text = (body, name = 'Someone Else', from = otherFrom) => ({ from, subject: 'New text message from ' + name, text: body });
    clock += 60000;
    let checked = JSON.parse(properties.RUN_checkTexts).at;
    assert.equal(post({ fn: 'wake', key: 'guess', texts: [text('YES')], mail: 0 }).ok, false, 'a wrong key is refused');
    assert.equal(post({ fn: 'wake', texts: [text('YES')], mail: 0 }).ok, false, 'so is none');
    assert.equal(JSON.parse(properties.RUN_checkTexts).at, checked, 'and nothing was checked');
    // With the key: a YES or NO, STUDENT or STOP, or an email reply is checked; a round robin sign-up is not.
    assert.deepEqual(post({ fn: 'wake', key: WAKE_KEY, texts: [text('RR tonight please')], mail: 0 }), { ok: true, checked: false }, 'a sign-up text needs no look');
    assert.equal(JSON.parse(properties.RUN_checkTexts).at, checked);
    for (const [body, why] of [[{ texts: [text('Yes, see you then')], mail: 0 }, 'a YES'], [{ texts: [text('No')], mail: 0 }, 'a NO'], [{ texts: [text('STUDENT')], mail: 0 }, 'STUDENT'],
      [{ texts: [text('stop')], mail: 0 }, 'STOP'], [{ texts: [], mail: 1 }, 'an email reply'], [{ texts: [text('hello')], mail: 0, more: true }, 'more texts than were passed on']]) {
      clock += 60000;
      assert.deepEqual(post(Object.assign({ fn: 'wake', key: WAKE_KEY }, body)), { ok: true, checked: true }, why + ' is checked');
      assert.notEqual(JSON.parse(properties.RUN_checkTexts).at, checked);
      checked = JSON.parse(properties.RUN_checkTexts).at;
    }
    // A coach waiting to be verified: any text from them is checked.
    const waitingBefore = properties.WAITING_COACHES;
    properties.WAITING_COACHES = JSON.stringify([{ name: 'New Coach', phone: '(925) 555-0177' }]);
    clock += 60000;
    assert.equal(post({ fn: 'wake', key: WAKE_KEY, texts: [text('Hi, this is me', 'New Coach')], mail: 0 }).checked, true, 'a text from a coach waiting to be verified is checked');
    properties.WAITING_COACHES = waitingBefore;
    assert.ok(properties.WAITING_COACHES, 'the check keeps the list of coaches waiting to be verified');
    // The STUDENT and STOP scan skips a check soon after the last, but never a wake, which may be about just that text.
    const scan = context.checkStudentTexts_;
    let scanned = 0;
    context.checkStudentTexts_ = () => { if (!cache['student-texts']) scanned += 1; return scan(); };
    cache['student-texts'] = '1';
    clock += 60000;
    post({ fn: 'wake', key: WAKE_KEY, texts: [text('STUDENT')], mail: 0 });
    assert.equal(scanned, 1, 'a STUDENT text is read at once');
    context.checkStudentTexts_ = scan;
    // A wake that comes while a check runs waits for it, rather than being dropped: its text may be newer than that check.
    cache['check-texts'] = '1';
    clock += 60000;
    assert.equal(post({ fn: 'wake', key: WAKE_KEY, texts: [text('YES')], mail: 0 }).checked, true, 'a wake runs even right after a check');
    delete cache['check-texts'];
    const skipped = runs();
    userHeld = true;
    assert.equal(post({ fn: 'wake', key: WAKE_KEY, texts: [text('YES')], mail: 0 }).checked, false);
    assert.equal(runs(), skipped + 1, 'a check still running after 30 seconds is logged as skipped');
    userHeld = false;
    // Each timer run is counted (a page call or a wake is not) and reported to the desk's JobRuntime tab.
    at('2026-10-21', '09:00');
    runtimeGrid = [['app', 'day', 'runs', 'seconds', 'updated_at'], ['desk', '2026-10-21', '400', '3700', '']];
    const counted = JSON.parse(properties.JOB_RUNTIME || '{"runs":0}');
    properties.JOB_RUNTIME = JSON.stringify(Object.assign(counted, { reportedAt: 0 }));
    clock += 60000;
    post({ fn: 'wake', key: WAKE_KEY, texts: [], mail: 1 });
    assert.equal(JSON.parse(properties.JOB_RUNTIME).runs, counted.runs, 'a wake is not timer time');
    delete cache['check-texts'];
    context.sweep({ triggerUid: 'timer' });
    const after = JSON.parse(properties.JOB_RUNTIME);
    assert.equal(after.day, '2026-10-21');
    assert.ok(after.runs >= 1);
    assert.deepEqual(runtimeGrid.filter(line => line[0] === 'coaching').map(line => line[1]), ['2026-10-20', '2026-10-21'], 'reported to the desk: yesterday\'s total, and today\'s');
    assert.deepEqual(timers(), ['sweep every 60'], 'still one timer');
    runtimeGrid = null;
    delete properties.JOB_RUNTIME;
  }
  readerStopped = true;
  assert.throws(() => context.storedTexts_(0), /desk has not collected texts since .*: its mail reader is not running/, 'a desk that stopped collecting texts is a failing step, so the club hears');
  readerStopped = false;
  const lastEmailCheck = gmailQueries.filter(query => /CTTC ref/.test(query)).pop();
  if (lastEmailCheck) assert.ok(Number(lastEmailCheck.match(/after:(\d+)$/)[1]) * 1000 >= Number(properties.MAIL_CHECKED_AT) - 2 * 5 * 60000, 'emailed answers are searched from the last check, not from the oldest question');
  assert.ok(textReads > 0);
  gmailQueries.filter(query => /txt\.voice/.test(query)).forEach(query => assert.match(query, /newer_than:90d \(/, 'only the reply fallback searches Gmail for texts'));
  console.log('Coaching app checks passed');
})().catch(error => { console.error(error); process.exit(1); });
