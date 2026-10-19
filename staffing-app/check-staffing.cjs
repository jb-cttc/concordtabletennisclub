const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

// Synthetic people only (example.com, made-up names): real names and addresses never belong in the repository.
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
assert.equal(manifest.timeZone, 'America/Los_Angeles');
assert.equal(fs.readFileSync(__dirname + '/.claspignore', 'utf8').trim(), 'check-*', 'the test is never pushed to Google');

const source = fs.readFileSync(__dirname + '/Code.js', 'utf8');
const globals = [...source.matchAll(/^function ([A-Za-z0-9_]+)\(/gm)].map(match => match[1]);
assert.deepEqual(globals.filter(name => !name.endsWith('_')).sort(), [
  'checkReplies', 'doGet', 'findPlayers', 'importSeedSheet', 'playerAccess', 'requestDrop', 'setup', 'signUp', 'staffBoard', 'sweep'
], 'a public web app exposes every non-private function: only these may exist');
assert.doesNotMatch(source, /=>|`|^\s*(let|const|class)\s/m, 'Code.js is ES5 style, like the other Apps Script projects');

// ---- Fakes ----
const START = Date.parse('2026-10-19T17:00:00Z'); // Monday October 19, 2026, 10:00 AM Pacific (PDT)
let clock = START;
class FakeDate extends Date { static now() { return clock; } }
const pacificAt = (date, time) => { // Pacific wall clock -> ms, for the October to December 2026 dates used here
  const offset = date >= '2026-11-01' && date < '2027-03-14' ? 8 : 7;
  return Date.parse(date + 'T' + time + ':00Z') + offset * 3600000;
};
const grids = {};
const textFormatted = new Set();
const books = {};
const created = [];
const properties = {};
const sent = [];
let quota = 100;
let cache = {};
let held = 0;
let userHeld = false;
let activeEmail = '';
const triggers = [];
let opened = [];
const makeSheet = (name, bookId) => {
  const key = bookId + '/' + name;
  grids[name] = grids[name] || [];
  const grid = grids[name];
  const range = (row, column, rows, columns) => {
    const handle = {
      getValues: () => { const out = []; for (let r = 0; r < rows; r += 1) out.push(Array.from({ length: columns }, (_, c) => (grid[row - 1 + r] || [])[column - 1 + c] ?? '')); return out; },
      setValues: values => {
        values.forEach((line, r) => {
          for (let c = 0; c < line.length; c += 1) {
            if (row + r > 1) assert.ok(textFormatted.has(key + ':' + (row + r)), 'cells are formatted as plain text before they are written');
            assert.equal(typeof line[c], 'string', 'only text is written');
            (grid[row - 1 + r] = grid[row - 1 + r] || [])[column - 1 + c] = line[c];
          }
        });
        return handle;
      },
      setNumberFormat: format => { assert.equal(format, '@'); for (let r = 0; r < rows; r += 1) textFormatted.add(key + ':' + (row + r)); return handle; },
      setFontWeight: () => handle,
      setDataValidation: rule => { validations[key] = Object.assign({ row, column, rows }, rule); return handle; }
    };
    return handle;
  };
  return {
    getLastRow: () => grid.length,
    getDataRange: () => ({ getValues: () => grid.map(line => line.slice()) }),
    getRange: range,
    deleteRows: (row, count) => { grid.splice(row - 1, count); },
    // Sheets reads a leading ' as "plain text" and does not store it.
    appendRow: values => { grid.push(Array.from(values, value => { assert.equal(String(value)[0], "'", 'appended values are kept as plain text'); return String(value).slice(1); })); },
    setFrozenRows: () => {},
    clearContents: () => { grid.length = 0; },
    hideSheet: () => { hidden.add(key); }
  };
};
const validations = {};
const hidden = new Set();
const makeBook = id => {
  const sheets = {};
  return (books[id] = {
    getSheetByName: name => sheets[name] || null,
    insertSheet: name => (sheets[name] = makeSheet(name, id)),
    getSheets: () => Object.values(sheets),
    deleteSheet: () => {},
    getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
    names: () => Object.keys(sheets).sort()
  });
};
const pacific = ms => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day + ' ' + parts.hour + ':' + parts.minute;
};
// The desk's private Sheet: its Players tab, with columns in a different order than the desk writes them, to show they are
// found by header name. active is a checkbox (true/false) or text.
const PLAYERS = [
  ['p01', 'Sam Kim', true], ['p02', 'Sam Lee', true], ['p03', 'Ada Park', true], ['p04', 'Ben Ortiz', 'TRUE'], ['p05', 'Cal Diaz', true],
  ['p06', 'Dee Nguyen', true], ['p07', 'Eve Stone', 'true'], ['p08', 'Fay Moss', true], ['p09', 'Gus Hale', true], ['p10', 'Hal Reed', true],
  ['p11', 'Ivy Wong', true], ['p12', 'Jo Banks', true], ['p13', 'Kai Ford', true], ['p14', 'Lu Chen', true], ['p15', 'Max Gold', true],
  ['p16', 'Sasha Bell', true], ['p17', 'Sara Diaz', true], ['p18', 'Sal Roy', true], ['p19', 'Santi Ruiz', true], ['p20', 'Sage Hill', true],
  ['p21', 'Sandy Cole', true], ['p22', 'Saul Vega', true], ['p23', 'Samson Gray', false], ['p24', 'Ned Gone', 'FALSE'], ['p25', 'José Peña', true],
  ['p27', 'Ron Tate', true], ['p28', 'Susan Lake', true], ['p29', 'Zoey Hart', true]
];
makeBook('desk-sheet-id').insertSheet('Players');
grids.Players.push(['display_name', 'current_rating', 'player_id', 'created_at', 'active', 'updated_at']);
PLAYERS.forEach(([id, name, active]) => grids.Players.push([name, 1500, id, new Date(START), active, '']));
const emailOf = name => name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com';
const idOf = name => (PLAYERS.find(player => player[1] === name) || [''])[0];

// Google Voice forwards each text to Gmail; a Gmail reply to it goes back out as a text.
const inbox = [];
const replies = [];
const mailbox = [];
let messageCount = 0;
const inbound = (subjectName, body, at = clock, digits = '9255550142') => {
  const id = 'm' + messageCount++;
  const from = '"' + subjectName + ' (SMS)" <19255550100.1' + digits + '.abc@txt.voice.google.com>';
  inbox.push({
    getId: () => id, getFrom: () => from, getReplyTo: () => from, getSubject: () => 'New text message from ' + subjectName,
    getPlainBody: () => '<https://voice.google.com>\n' + body + '\nTo respond to this text message, reply to this email or visit Google Voice.\nYOUR ACCOUNT <https://voice.google.com>',
    getDate: () => new Date(at), reply: text => { replies.push({ to: subjectName, body: text }); }
  });
};
const context = {
  Date: FakeDate, Math, Number, String, JSON, Object, Array, console: { error: () => {}, log: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) },
  SpreadsheetApp: {
    create: name => { created.push(name); const book = makeBook('private-book-id'); return Object.assign({ getId: () => 'private-book-id' }, book); },
    openById: id => { assert.ok(books[id], 'only known Sheets are opened'); opened.push(id); return books[id]; },
    newDataValidation: () => {
      const rule = {};
      const builder = {
        requireValueInRange: (range, dropdown) => { rule.range = range; rule.dropdown = dropdown; return builder; },
        setAllowInvalid: allow => { rule.allowInvalid = allow; return builder; },
        setHelpText: text => { rule.help = text; return builder; },
        build: () => rule
      };
      return builder;
    }
  },
  Session: { getActiveUser: () => ({ getEmail: () => activeEmail }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
  ScriptApp: {
    getProjectTriggers: () => triggers.map(handler => ({ getHandlerFunction: () => handler })),
    newTrigger: handler => ({ timeBased: () => ({ everyHours: () => ({ create: () => { triggers.push(handler); } }), everyMinutes: () => ({ create: () => { triggers.push(handler); } }) }) })
  },
  LockService: {
    getScriptLock: () => ({ waitLock: () => { assert.equal(held, 0, 'locks are never nested'); held += 1; }, releaseLock: () => { held -= 1; } }),
    getUserLock: () => ({ tryLock: () => (userHeld ? false : (userHeld = true)), releaseLock: () => { userHeld = false; } })
  },
  CacheService: { getScriptCache: () => ({ get: key => cache[key] || null, put: (key, value) => { cache[key] = value; }, remove: key => { delete cache[key]; } }) },
  MailApp: { getRemainingDailyQuota: () => quota, sendEmail: message => { assert.equal(held <= 1, true); sent.push(message); } },
  GmailApp: {
    getInboxUnreadCount: () => 0,
    search: query => {
      const answers = query.match(/^newer_than:3d subject:"CTTC shift" -from:me after:(\d+)$/);
      if (answers) {
        const found = mailbox.filter(message => message.getDate().getTime() >= Number(answers[1]) * 1000);
        return found.length ? [{ getMessages: () => mailbox.slice() }] : [];
      }
      assert.match(query, /^in:anywhere from:txt\.voice\.google\.com newer_than:\d+d \(.+\)$/);
      return inbox.length ? [{ getMessages: () => inbox.slice() }] : [];
    }
  },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256', key).update(value).digest()),
    formatDate: (date, zone, format) => {
      assert.equal(zone, 'America/Los_Angeles');
      if (format === 'yyyy-MM-dd') return pacific(date.getTime()).slice(0, 10);
      assert.equal(format, 'yyyy-MM-dd HH:mm');
      return pacific(date.getTime());
    }
  },
  HtmlService: {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createTemplateFromFile: name => ({ evaluate: () => {
      let content = fs.readFileSync(__dirname + '/' + name + '.html', 'utf8');
      const output = { getContent: () => content, setContent: value => { content = value; return output; }, setTitle: () => output, addMetaTag: () => output, setXFrameOptionsMode: () => output };
      return output;
    } })
  }
};
vm.createContext(context);
vm.runInContext(source, context);
const run = (name, ...args) => JSON.parse(JSON.stringify(context[name](...args) ?? null));
const column = (tab, name) => grids[tab][0].indexOf(name);
const cell = (tab, line, name) => line[column(tab, name)];
const signupRows = () => grids.Signups.slice(1);
const signupsOf = email => signupRows().filter(line => cell('Signups', line, 'email') === email);
const mailTo = (address, from = 0) => sent.slice(from).filter(message => message.to === address);
const resetLimits = () => { Object.keys(cache).filter(key => key.startsWith('rate:')).forEach(key => { delete cache[key]; }); };
const board = () => { resetLimits(); return run('staffBoard'); };
const night = date => board().nights.find(entry => entry.date === date);
// The minute-by-minute trigger, without its 20 second and 5 minute throttles.
const check = () => { delete cache['check-replies']; delete cache['opt-ins']; context.checkReplies(); };
const signUp = (name, picks, extra = {}) => {
  resetLimits();
  return run('signUp', Object.assign({ playerId: idOf(name), email: emailOf(name), picks: picks.map(([date, position, finalize]) => ({ date, position, finalize: !!finalize })) }, extra));
};
// An email reply, a minute after the last thing that happened. Only the From address, the subject and the first line matter.
const answerMail = (from, word, subject) => {
  clock += 60000;
  const at = clock;
  const id = 'e' + messageCount++;
  mailbox.push({ getId: () => id, getFrom: () => 'Someone <' + from + '>', getSubject: () => 'Re: ' + subject, getDate: () => new Date(at),
    getPlainBody: () => word + '\n\nOn Mon, Oct 19, 2026 the club wrote:\n> Reply YES: Confirm all of them.\n> Reply NO: Cancel' });
  check();
};
const askedBy = (address, pattern = /./) => sent.filter(message => message.to === address && /\[CTTC shift [0-9A-F]{10}\]$/.test(message.subject) && pattern.test(message.subject)).pop().subject;
const reply = (address, word, pattern = /^Confirm your CTTC staff sign-up/) => answerMail(address, word, askedBy(address, pattern));
const signAndConfirm = (name, picks, extra) => {
  const result = signUp(name, picks, extra);
  assert.equal(result.ok, true, result.message);
  reply(emailOf(name), 'YES');
  return result;
};
const statusOf = (name, date, position) => cell('Signups', signupsOf(emailOf(name)).filter(line => cell('Signups', line, 'date') === date && cell('Signups', line, 'position') === position).pop(), 'status');

// ---- Setup runs only for the owner, in the editor ----
assert.throws(() => context.setup(), /owner/, 'a web visitor cannot run setup');
assert.throws(() => context.importSeedSheet(), /owner/, 'nor import the seed Sheet');
activeEmail = 'owner@example.com';
properties.DESK_SHEET_ID = 'desk-sheet-id';
const setupResult = JSON.parse(JSON.stringify(context.setup()));
assert.equal(setupResult.players, '26 active players', 'inactive rows are left out of the player list');
assert.equal(setupResult.mode, 'directory', 'v1 signs up from the player list only');
assert.deepEqual(books['private-book-id'].names(), ['Batches', 'Closures', 'Log', 'People', 'SeedLinks', 'SeedReport', 'Signups', 'Training']);
assert.deepEqual(grids.Training[0], ['player_id', 'name', 'keys', 'open', 'front_desk', 'updated_at']);
// The owner's training list: everyone in these checks may open and run the Front Desk, except Cal (tables and closing only)
// and Dee (keys but no opening training).
PLAYERS.forEach(([id, name]) => { if (name !== 'Cal Diaz' && name !== 'Ron Tate' && name !== 'Susan Lake') grids.Training.push([id, name, name === 'Dee Nguyen' ? 'Yes' : 'yes', name === 'Dee Nguyen' ? 'No' : 'yes', name === 'Dee Nguyen' ? 'N/A' : 'Yes', '']); });
assert.deepEqual(triggers, ['sweep', 'checkReplies'], 'an hourly sweep and a minute-by-minute reply check are installed');
context.setup();
assert.equal(created.length, 1, 'setup is safe to run again');
assert.deepEqual(triggers, ['sweep', 'checkReplies']);
activeEmail = '';
assert.equal(properties.STAFFING_DB_ID, 'private-book-id');

// ---- The horizon: this month and the next two, Pacific time ----
{
  let view = board();
  assert.deepEqual(view.months.map(month => month.title), ['October 2026', 'November 2026', 'December 2026']);
  assert.equal(view.nights[0].date, '2026-10-02', 'October 1 is a Thursday: the first night is Friday the 2nd');
  assert.equal(view.nights.at(-1).date, '2026-12-30');
  assert.ok(view.nights.every(entry => [1, 3, 5, 6].includes(new Date(entry.date + 'T12:00:00Z').getUTCDay())), 'Mondays, Wednesdays, Fridays and Saturdays only');
  assert.equal(view.nights.find(entry => entry.date === '2026-10-16').status, 'past');
  assert.equal(view.nights.find(entry => entry.date === '2026-10-16').bookable, false);
  assert.equal(night('2026-10-19').bookable, true, 'tonight can be picked in the morning');
  assert.equal(night('2026-10-24').time, '3:00 PM to 6:00 PM', 'Saturday is 3 to 6');
  assert.equal(night('2026-10-21').time, '7:00 PM to 10:00 PM');
  clock = pacificAt('2026-10-31', '23:59');
  assert.deepEqual(board().months.map(month => month.title), ['October 2026', 'November 2026', 'December 2026']);
  clock = pacificAt('2026-11-01', '00:01');
  assert.deepEqual(board().months.map(month => month.title), ['November 2026', 'December 2026', 'January 2027'], 'January opens on November 1st, Pacific time');
  clock = pacificAt('2026-12-15', '12:00');
  assert.deepEqual(board().months.map(month => month.title), ['December 2026', 'January 2027', 'February 2027'], 'the year rolls over');
  clock = pacificAt('2026-10-19', '17:59');
  assert.equal(night('2026-10-19').bookable, true, 'tonight closes an hour before opening');
  clock = pacificAt('2026-10-19', '18:01');
  assert.equal(night('2026-10-19').bookable, false);
  let result = signUp('Ada Park', [['2026-10-19', 'tables']]);
  assert.equal(result.ok, false);
  assert.match(result.problems[0].reason, /closed/, 'too late tonight is refused by the server too');
  clock = START;
  result = signUp('Ada Park', [['2026-10-16', 'tables'], ['2026-10-20', 'tables'], ['2027-01-04', 'tables'], ['2026-10-2x', 'tables'], ['2026-10-21', 'janitor']]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.map(problem => problem.reason), [
    'Sign-ups for that night have closed.', 'That is not a club night in the sign-up calendar.', 'That is not a club night in the sign-up calendar.',
    'That is not a club night in the sign-up calendar.', 'That position does not exist.'
  ], 'past nights, Tuesdays, nights past the horizon, bad dates and made-up positions are refused');
  assert.match(result.message, /nothing was sent/);
  assert.equal(grids.Signups.length, 1, 'all or nothing: a refused submission saves nothing');
  assert.equal(sent.length, 0);
}

// ---- The player list ----
{
  assert.deepEqual(run('findPlayers', 's'), { ok: true, players: [] }, 'one letter finds nothing, so the list is never shipped');
  assert.deepEqual(run('findPlayers', ' '), { ok: true, players: [] });
  const found = run('findPlayers', 'sa');
  assert.equal(found.players.length, 8, 'at most 8 names');
  assert.ok(found.players.every(player => Object.keys(player).sort().join() === 'name,playerId'), 'only an id and the name');
  assert.ok(!found.players.some(player => player.name === 'Samson Gray'), 'inactive players are never offered');
  assert.deepEqual(run('findPlayers', 'kim').players, [{ playerId: 'p01', name: 'Sam Kim' }], 'any word of the name matches');
  assert.deepEqual(run('findPlayers', 'SAM K').players, [{ playerId: 'p01', name: 'Sam Kim' }], 'each typed word starts a word of the name');
  assert.deepEqual(run('findPlayers', 'jose').players, [{ playerId: 'p25', name: 'José Peña' }], 'accents do not matter');
  assert.deepEqual(run('findPlayers', 'ned').players, [], 'FALSE as text is inactive too');
  assert.deepEqual(run('findPlayers', 'am').players, [], 'the start of a word, not the middle');
  opened = [];
  grids.Players.push(['Zed New', 1400, 'p26', '', true, '']);
  assert.deepEqual(run('findPlayers', 'zed').players, [], 'the list is cached for 10 minutes');
  assert.deepEqual(opened, [], 'so typing does not open the desk Sheet');
  delete cache.directory;
  assert.deepEqual(run('findPlayers', 'zed').players, [{ playerId: 'p26', name: 'Zed New' }]);
  assert.ok(cache.directory, 'and cached again');
  let busy = 0;
  for (let index = 0; index < 130; index += 1) if (!run('findPlayers', 'sam').ok) busy += 1;
  assert.ok(busy > 0, 'a flood of searches is slowed down');
  resetLimits();
  const hidden = properties.DESK_SHEET_ID;
  properties.DESK_SHEET_ID = '';
  delete cache.directory;
  assert.match(run('findPlayers', 'sam').message, /not available/, 'a missing desk Sheet id says so instead of failing');
  assert.equal(signUp('Ada Park', [['2026-10-21', 'tables']]).ok, false);
  properties.DESK_SHEET_ID = hidden;
  assert.equal(signUp('Nobody', [['2026-10-21', 'tables']], { playerId: 'p99' }).field, 'name', 'an id not on the list is refused');
  assert.equal(signUp('Samson Gray', [['2026-10-21', 'tables']]).field, 'name', 'an inactive player is refused');
}

// ---- Reading a YES or NO ----
[
  ['yes', 'yes'], ['Yes, see you Monday', 'yes'], ['ok yes', 'yes'], ['no thanks', 'no'], ['maybe', ''], ['Yes, but no', ''],
  ['YESSent from my Galaxy', 'yes'], ['Yes\n\nOn Mon, Oct 19, 2026 Concord Table Tennis Club wrote:\n> Reply NO: Cancel', 'yes'],
  ['No\n> Confirm your CTTC staff sign-up [CTTC shift 0123456789]\n> Reply YES', 'no'], ['Re: [CTTC shift 0123456789] yes', '']
].forEach(([text, expected]) => assert.equal(context.answerOf_(text), expected, JSON.stringify(text)));
assert.equal(context.ownWords_('Sure\n[CTTC shift 0123456789]\nReply YES'), 'Sure', 'our own tag marks the quoted message');
// Texts use words the coaching app (which reads the same Voice number) never takes for an answer.
{
  const coaching = { console: { error: () => {}, log: () => {} } };
  vm.createContext(coaching);
  vm.runInContext(fs.readFileSync(__dirname + '/../coaching-app/Code.js', 'utf8'), coaching);
  ['CONFIRM', 'Confirm', 'RELEASE', 'release.', 'STAFF'].forEach(word => assert.equal(coaching.answerOf_(word), '', 'coaching ignores ' + word));
  assert.equal(coaching.answerOf_('YES'), 'yes');
  assert.match(coaching.mailQuery_(1), /subject:"CTTC ref"/, 'coaching searches its own tag, never ours');
  assert.equal(coaching.ownWords_('yes\n[CTTC shift 0123456789]'), 'yes\n[CTTC shift 0123456789]', 'the tags differ');
  [['CONFIRM', 'yes'], ['confirm!', 'yes'], ['RELEASE', 'no'], ['YES', ''], ['no', ''], ['STOP', ''], ['confirm it', '']].forEach(([text, expected]) => assert.equal(context.staffWord_(text), expected, text));
}

// ---- One email for a whole submission; YES confirms all ----
{
  const result = signUp('Hal Reed', [['2026-10-26', 'desk'], ['2026-10-28', 'tables'], ['2026-10-30', 'close', true]]);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.count, 3);
  assert.match(result.message, /Reply YES to that email by Tuesday, October 20, 2026, 10:00 AM Pacific Time/, '24 hours to confirm');
  const asks = mailTo('hal.reed@example.com');
  assert.equal(asks.length, 1, 'one email for every pick');
  assert.match(asks[0].subject, /^Confirm your CTTC staff sign-up \[CTTC shift [0-9A-F]{10}\]$/);
  assert.match(asks[0].body, /Mon, Oct 26: Desk organizer \(opening, 7:00 PM\)\nWed, Oct 28: Table setup \(opening, 7:00 PM\)\nFri, Oct 30: Closing \(put tables away\) \(closing, 10:00 PM\), also finalizing the desk/);
  assert.match(asks[0].body, /Reply YES: Confirm all of them\.\nReply NO: Cancel all of them/);
  assert.deepEqual(night('2026-10-26').slots.desk, [{ name: 'Hal', pending: true, finalize: false }], 'a pending pick holds its slot and shows as waiting, with no id');
  assert.equal(night('2026-10-26').status, 'needs', 'status counts confirmed sign-ups only');
  assert.equal(signUp('Ivy Wong', [['2026-10-26', 'desk']]).problems[0].reason, 'Desk organizer is already taken that night.', 'nobody else can take a held slot');
  reply('hal.reed@example.com', 'YES');
  assert.deepEqual(['2026-10-26', '2026-10-28', '2026-10-30'].map((date, index) => statusOf('Hal Reed', date, ['desk', 'tables', 'close'][index])), ['confirmed', 'confirmed', 'confirmed']);
  const done = mailTo('hal.reed@example.com').pop();
  assert.equal(done.subject, 'You are on the CTTC staff schedule');
  assert.match(done.body, /3 shifts are confirmed/);
  assert.equal(night('2026-10-26').slots.desk[0].pending, false);
  assert.match(night('2026-10-26').slots.desk[0].id, /^[0-9a-f]{16}$/, 'a confirmed slot carries an id for "This is me"');
  const count = sent.length;
  reply('hal.reed@example.com', 'YES');
  assert.equal(sent.length, count, 'a second YES to an answered question is ignored');
}

// ---- NO releases everything ----
{
  assert.equal(signUp('Ivy Wong', [['2026-10-28', 'desk'], ['2026-10-30', 'money']]).ok, true);
  assert.equal(night('2026-10-28').slots.desk.length, 1);
  reply('ivy.wong@example.com', 'NO');
  assert.equal(statusOf('Ivy Wong', '2026-10-28', 'desk'), 'released');
  assert.equal(statusOf('Ivy Wong', '2026-10-30', 'money'), 'released');
  assert.equal(night('2026-10-28').slots.desk.length, 0, 'the slots open again');
  assert.equal(mailTo('ivy.wong@example.com').pop().subject, 'Your CTTC staff sign-up is cancelled');
}

// ---- Statuses, capacities and the one-opening-position rule (Wednesday October 21) ----
{
  const W = '2026-10-21';
  assert.equal(night(W).status, 'needs');
  assert.deepEqual(night(W).missing, ['a desk organizer', 'a money collector', 'someone for table setup', '2 closers']);
  signAndConfirm('Ada Park', [[W, 'desk']]);
  signAndConfirm('Ben Ortiz', [[W, 'money']]);
  signAndConfirm('Cal Diaz', [[W, 'tables']]);
  signAndConfirm('Dee Nguyen', [[W, 'close']]);
  assert.equal(night(W).status, 'needs');
  assert.deepEqual(night(W).missing, ['a closer']);
  assert.equal(signUp('Eve Stone', [[W, 'close']]).ok, true);
  assert.equal(night(W).status, 'needs', 'a pending closer does not count yet');
  reply('eve.stone@example.com', 'YES');
  assert.equal(night(W).status, 'covered', 'every minimum met, backups still open');
  signAndConfirm('Fay Moss', [[W, 'desk-backup']]);
  assert.equal(night(W).status, 'covered');
  signAndConfirm('Gus Hale', [[W, 'money-backup']]);
  assert.equal(night(W).status, 'full', 'fully staffed: every minimum and both backups');
  ['Hal Reed', 'Jo Banks', 'Kai Ford'].forEach(name => signAndConfirm(name, [[W, 'tables']]));
  assert.equal(night(W).slots.tables.length, 4);
  assert.equal(signUp('Lu Chen', [[W, 'tables']]).problems[0].reason, 'Table setup is already taken that night.', 'a fifth table setup is refused');
  ['Sam Kim', 'Sam Lee', 'Lu Chen', 'Max Gold'].forEach(name => signAndConfirm(name, [[W, 'close']]));
  assert.equal(night(W).slots.close.length, 6);
  assert.equal(signUp('Ivy Wong', [[W, 'close']]).problems[0].reason, 'Closing (put tables away) is already taken that night.', 'a seventh closer is refused');
  assert.deepEqual(night(W).missing, []);

  // First names only; two Sams that night become Sam K. and Sam L.
  const names = night(W).slots.close.map(slot => slot.name).sort();
  assert.deepEqual(names, ['Dee', 'Eve', 'Lu', 'Max', 'Sam K.', 'Sam L.']);
  assert.deepEqual(night(W).slots.desk.map(slot => slot.name), ['Ada']);
  const everything = JSON.stringify(board()) + /var INITIAL = (.*);\n/.exec(context.doGet().getContent())[1];
  assert.doesNotMatch(everything, /@|example|555-\d|\b(Kim|Lee|Park|Ortiz|Diaz|Nguyen|Stone|Moss|Hale|Reed|Banks|Ford|Chen|Gold|Wong)\b|p0\d|p1\d/, 'no email, phone, last name or player id is public');
}

// ---- One opening position per person per night; opening and closing is fine; one finalizer ----
{
  const F = '2026-10-23';
  assert.match(signUp('Ada Park', [[F, 'desk'], [F, 'money-backup']]).problems[0].reason, /one opening position/, 'desk and a backup in one submission');
  assert.match(signUp('Ada Park', [[F, 'desk'], [F, 'tables']]).problems[0].reason, /one opening position/, 'desk and table setup');
  assert.match(signUp('Ada Park', [[F, 'close'], [F, 'close']]).problems[0].reason, /already closing/);
  assert.match(signUp('Ada Park', [[F, 'tables', true]]).problems[0].reason, /Only a closer/);
  signAndConfirm('Ada Park', [[F, 'desk'], [F, 'close', true]]);
  assert.equal(statusOf('Ada Park', F, 'close'), 'confirmed', 'the same person may open and close');
  assert.deepEqual(night(F).slots.close, [{ name: 'Ada', pending: false, finalize: true, id: night(F).slots.close[0].id }]);
  assert.match(signUp('Ben Ortiz', [[F, 'close', true]]).problems[0].reason, /already finalizing/, 'one finalizer per night');
  assert.equal(signUp('Ben Ortiz', [[F, 'close']]).ok, true, 'closing without finalizing is fine');
  assert.match(signUp('Ada Park', [[F, 'money']]).problems[0].reason, /one opening position/, 'checked against earlier sign-ups too');
  const many = [];
  for (let day = 0; many.length < 41; day += 1) many.push(['2026-11-02', 'tables']);
  assert.match(signUp('Cal Diaz', many).message, /at most 40/);
}

// ---- Training: Desk needs keys and opening, Money needs Front Desk; tables and closing are open to anyone listed ----
{
  const S = '2026-11-02';
  assert.match(signUp('Cal Diaz', [[S, 'desk']]).problems[0].reason, /^Desk organizer needs key access and opening training/, 'the server refuses an untrained desk pick');
  assert.match(signUp('Cal Diaz', [[S, 'desk-backup']]).problems[0].reason, /needs key access and opening training/, 'backups too');
  assert.match(signUp('Cal Diaz', [[S, 'money-backup']]).problems[0].reason, /needs Front Desk training/);
  assert.match(signUp('Dee Nguyen', [[S, 'desk']]).problems[0].reason, /needs opening training/, 'keys alone are not enough');
  assert.match(signUp('Dee Nguyen', [[S, 'money']]).problems[0].reason, /Front Desk/, 'N/A is not trained');
  assert.equal(signUp('Cal Diaz', [[S, 'tables'], ['2026-11-04', 'close']]).ok, true, 'table setup and closing need no training');
  resetLimits();
  assert.deepEqual(run('playerAccess', 'p05'), { ok: true, positions: ['tables', 'close'] }, 'the page learns only which positions the chosen player may take');
  assert.deepEqual(run('playerAccess', 'p06').positions, ['tables', 'close']);
  assert.deepEqual(run('playerAccess', 'p03').positions, ['desk', 'desk-backup', 'money', 'money-backup', 'tables', 'close']);
  assert.equal(run('playerAccess', 'p23').ok, false, 'not for inactive players');
  assert.deepEqual(night(S).slots.desk, []);
  assert.match(board().positions.find(spec => spec.id === 'desk').does, /first in at 6:40 PM.*key lockbox.*lights and AC/);
  assert.match(board().positions.find(spec => spec.id === 'money').does, /Revenue Sheet.*Clover.*Zelle/);
  assert.equal(board().positions.find(spec => spec.id === 'money').label, 'Money collector (Front Desk)');
  assert.ok(!JSON.stringify(board()).includes('front_desk'), 'the calendar says nothing about who is trained');
}

// ---- Closures typed into the private Sheet ----
{
  grids.Closures.push(['2026-10-24', 'Gym closed for an event'], [new Date(pacificAt('2026-10-31', '00:00')), 'Halloween'], ['11/14/2026', ''], ['not a date', 'ignored']);
  assert.equal(night('2026-10-24').status, 'closed');
  assert.equal(night('2026-10-24').note, 'Gym closed for an event');
  assert.equal(night('2026-10-24').bookable, false);
  assert.equal(night('2026-10-31').status, 'closed', 'a cell the Sheet turned into a date still works');
  assert.equal(night('2026-11-14').status, 'closed', 'as does 11/14/2026');
  assert.deepEqual(night('2026-10-24').slots.desk, []);
  assert.deepEqual(board().closures, ['2026-10-24', '2026-10-31', '2026-11-14']);
  assert.equal(signUp('Cal Diaz', [['2026-10-24', 'tables']]).problems[0].reason, 'The club is closed that night.');
}

// ---- Tonight's hold ends an hour before opening ----
{
  const result = signUp('Jo Banks', [['2026-10-19', 'money']]);
  assert.equal(result.ok, true);
  assert.equal(result.deadline, 'Monday, October 19, 2026, 6:00 PM Pacific Time', 'no later than an hour before the earliest night');
  reply('jo.banks@example.com', 'YES');
}

// ---- Holds expire; a late YES confirms what is still free ----
{
  const result = signUp('Kai Ford', [['2026-11-11', 'money'], ['2026-11-13', 'tables']]);
  assert.equal(result.ok, true);
  clock += 24 * 3600000 + 60000;
  assert.deepEqual(night('2026-11-11').slots.money, [], 'an expired hold is open at once, before the sweep writes it');
  assert.equal(statusOf('Kai Ford', '2026-11-11', 'money'), 'pending');
  context.sweep();
  assert.equal(statusOf('Kai Ford', '2026-11-11', 'money'), 'expired');
  assert.ok(mailTo('kai.ford@example.com').some(message => message.subject === 'Your CTTC staff sign-up expired'), 'the person is told the hold expired');
  signAndConfirm('Lu Chen', [['2026-11-11', 'money']]);
  reply('kai.ford@example.com', 'YES');
  assert.equal(statusOf('Kai Ford', '2026-11-13', 'tables'), 'confirmed', 'a late YES confirms the pick that is still free');
  assert.equal(statusOf('Kai Ford', '2026-11-11', 'money'), 'expired', 'and not the one someone else took');
  const late = mailTo('kai.ford@example.com').pop();
  assert.equal(late.subject, 'You are on the CTTC staff schedule');
  assert.match(late.body, /1 shift is confirmed[\s\S]*Fri, Nov 13: Table setup[\s\S]*NO LONGER FREE\n\nWed, Nov 11: Money collector \(Front Desk\)/);
  const count = sent.length;
  reply('kai.ford@example.com', 'YES');
  assert.equal(sent.length, count, 'the late YES closed the question');
  // A late YES when nothing is free any more says so.
  assert.equal(signUp('Max Gold', [['2026-11-11', 'tables']]).ok, true);
  clock += 24 * 3600000 + 60000;
  signAndConfirm('Ivy Wong', [['2026-11-11', 'tables']]);
  ['Jo Banks', 'Sam Kim', 'Sam Lee'].forEach(name => signAndConfirm(name, [['2026-11-11', 'tables']]));
  reply('max.gold@example.com', 'YES');
  assert.equal(mailTo('max.gold@example.com').pop().subject, 'Your CTTC staff sign-up had expired');
}

// ---- A reply from another address does not count; auto-replies never count ----
{
  assert.equal(signUp('Sara Diaz', [['2026-11-16', 'close']]).ok, true);
  answerMail('someone.else@example.com', 'YES', askedBy('sara.diaz@example.com'));
  assert.equal(statusOf('Sara Diaz', '2026-11-16', 'close'), 'pending', 'a YES from someone else changes nothing');
  assert.equal(mailTo('someone.else@example.com').pop().subject, 'Your reply did not count: please answer from the right address');
  const subject = askedBy('sara.diaz@example.com');
  clock += 60000;
  mailbox.push({ getId: () => 'auto', getFrom: () => 'sara.diaz@example.com', getSubject: () => 'Automatic reply: ' + subject, getDate: () => new Date(clock), getPlainBody: () => 'Yes, I am away' });
  check();
  assert.equal(statusOf('Sara Diaz', '2026-11-16', 'close'), 'pending', 'an out-of-office reply is not an answer');
  answerMail('Sara.Diaz@Example.com', 'Yes please', subject);
  assert.equal(statusOf('Sara Diaz', '2026-11-16', 'close'), 'confirmed', 'the right address in any case');
}

// ---- Dropping a confirmed shift ----
{
  const W = '2026-10-21';
  const desk = night(W).slots.desk[0];
  assert.match(run('requestDrop', 'nope').message, /Please pick a shift|not confirmed/);
  resetLimits();
  assert.equal(signUp('Saul Vega', [['2026-12-04', 'close']]).ok, true);
  const pendingId = cell('Signups', signupsOf('saul.vega@example.com')[0], 'signup_id');
  assert.equal(run('requestDrop', pendingId).ok, false, 'only a confirmed shift can be dropped');
  resetLimits();
  const before = sent.length;
  const asked = run('requestDrop', desk.id);
  assert.equal(asked.ok, true);
  assert.doesNotMatch(JSON.stringify(asked), /@/, 'the page is never told whose shift it is');
  const question = sent.slice(before);
  assert.equal(question.length, 1);
  assert.equal(question[0].to, 'ada.park@example.com', 'the address that confirmed it is asked');
  assert.match(question[0].subject, /^Drop your CTTC shift\? \[CTTC shift [0-9A-F]{10}\]$/);
  resetLimits();
  assert.equal(run('requestDrop', desk.id).ok, true);
  assert.equal(sent.length, before + 1, 'one ask per sign-up per 10 minutes');
  answerMail('fay.moss@example.com', 'YES', question[0].subject);
  assert.equal(statusOf('Ada Park', W, 'desk'), 'confirmed', 'a YES from the backup does not drop it');
  const ready = sent.length;
  answerMail('ada.park@example.com', 'YES', question[0].subject);
  assert.equal(statusOf('Ada Park', W, 'desk'), 'dropped');
  assert.deepEqual(night(W).slots.desk, [], 'the slot opens again');
  assert.equal(night(W).status, 'needs');
  const notices = sent.slice(ready);
  assert.deepEqual(notices.map(message => message.to).sort(), ['ada.park@example.com', 'fay.moss@example.com', 'owner@example.com'], 'the person, the club and the backup are told');
  assert.match(notices.find(message => message.to === 'fay.moss@example.com').subject, /^Heads-up: you may be needed as Desk organizer on Wed, Oct 21$/);
  assert.match(notices.find(message => message.to === 'owner@example.com').body, /Ada Park dropped Desk organizer[\s\S]*backup \(Fay Moss\)/);
  // A NO keeps the shift; a backup dropping gives nobody a heads-up.
  resetLimits();
  const backup = night(W).slots['desk-backup'][0];
  run('requestDrop', backup.id);
  answerMail('fay.moss@example.com', 'NO', sent.at(-1).subject);
  assert.equal(statusOf('Fay Moss', W, 'desk-backup'), 'confirmed');
  assert.equal(sent.at(-1).subject, 'Your CTTC shift stays as it is');
  clock += 11 * 60000;
  resetLimits();
  run('requestDrop', backup.id);
  const bfore = sent.length;
  answerMail('fay.moss@example.com', 'YES', sent.at(-1).subject);
  assert.deepEqual(sent.slice(bfore).map(message => message.to).sort(), ['fay.moss@example.com', 'owner@example.com']);
}

// ---- Directory and hybrid modes ----
{
  const full = { keys: true, open: true, front_desk: true };
  assert.equal(context.canTake_({ playerId: 'p01', training: full }, 'desk'), '');
  assert.match(context.canTake_({ playerId: 'p01', training: {} }, 'desk'), /training/);
  assert.equal(context.canTake_({ playerId: 'p01', training: {} }, 'close'), '');
  assert.match(context.canTake_({ playerId: '' }, 'tables'), /player list/, 'directory mode: the player list only');
  const refused = signUp('Nia Newcomer', [['2026-11-18', 'tables']], { playerId: '', unlisted: true, name: 'Nia Newcomer', email: 'nia@example.com' });
  assert.equal(refused.field, 'name', 'directory mode refuses a typed name');
  assert.equal(board().mode, 'directory');
  properties.SIGNUP_MODE = 'hybrid';
  assert.equal(board().mode, 'hybrid');
  assert.equal(context.canTake_({ playerId: '' }, 'tables'), '');
  assert.equal(context.canTake_({ playerId: '' }, 'close'), '');
  assert.match(context.canTake_({ playerId: '' }, 'desk'), /training/);
  assert.match(context.canTake_({ playerId: '' }, 'money-backup'), /training/);
  assert.equal(context.canTake_({ playerId: '', training: full }, 'money'), '');
  const nia = { playerId: '', unlisted: true, name: 'Nia Newcomer', email: 'nia@example.com' };
  const alerts = mailTo('owner@example.com').length;
  const desk = signUp('Nia Newcomer', [['2026-11-18', 'tables'], ['2026-11-20', 'desk']], nia);
  assert.equal(desk.ok, false);
  assert.equal(desk.problems.length, 1);
  assert.match(desk.problems[0].reason, /training/);
  const asked = grids.Training.find(line => line[0] === 'nia@example.com');
  assert.deepEqual(asked.slice(1, 5), ['Nia Newcomer', '', '', ''], 'the owner finds an untrained Training row, keyed by email, for who asked');
  assert.equal(mailTo('owner@example.com').length, alerts + 1, 'and the club is told');
  assert.equal(signUp('Nia Newcomer', [['2026-11-18', 'tables']], nia).ok, true, 'table setup straight away');
  reply('nia@example.com', 'YES');
  assert.equal(night('2026-11-18').slots.tables[0].name, 'Nia');
  asked[2] = 'Yes';
  asked[3] = 'Yes';
  assert.equal(signUp('Nia Newcomer', [['2026-11-20', 'desk']], nia).ok, true, 'once the club marks the training, the app remembers');
  delete properties.SIGNUP_MODE;
  assert.equal(signUp('Nia Newcomer', [['2026-11-20', 'money']], nia).field, 'name', 'switching back to directory mode closes it again');
}

// ---- Texts: STAFF opts in, CONFIRM answers, STOP opts out silently ----
{
  assert.equal(signUp('Max Gold', [['2026-11-23', 'close']], { phone: '(925) 555-0142' }).ok, true);
  assert.equal(replies.length, 0, 'no texts before the person texts STAFF');
  clock += 60000;
  inbound('(925) 555-0142', 'Staff', clock);
  check();
  assert.equal(grids.People.find(line => line[0] === 'max.gold@example.com')[column('People', 'texts')], 'yes');
  assert.match(replies.at(-1).body, /^CTTC: You will get texts about your staff shifts/);
  context.sweep();
  assert.match(replies.at(-1).body, /^CTTC: Reply CONFIRM to lock in your 1 staff shift \(first: Mon, Nov 23, Closing \(put tables away\)\), or RELEASE to cancel/, 'the waiting sign-up is texted');
  clock += 60000;
  inbound('(925) 555-0142', 'YES', clock);
  check();
  assert.equal(statusOf('Max Gold', '2026-11-23', 'close'), 'pending', 'a bare YES text is left for the coaching app');
  clock += 60000;
  inbound('(925) 555-0142', 'Confirm', clock);
  check();
  assert.equal(statusOf('Max Gold', '2026-11-23', 'close'), 'confirmed');
  assert.equal(replies.at(-1).body, 'CTTC: Done: you are confirmed for 1 shift. Details are in your email.');
  const texts = replies.length;
  clock += 6 * 60000;
  inbound('(925) 555-0142', 'STOP', clock);
  check();
  assert.equal(grids.People.find(line => line[0] === 'max.gold@example.com')[column('People', 'texts')], '');
  assert.equal(replies.length, texts, 'STOP is recorded without a second reply (the coaching app answers STOP)');
  assert.equal(signUp('Max Gold', [['2026-11-25', 'close']]).ok, true);
  assert.equal(replies.length, texts, 'and no more texts');
}

// ---- Seeding from the volunteer's "Open/Close" Sheet ----
// Run last among the Sheet checks, in January 2027, so its holds never touch the nights the other checks use.
const seedCheck = () => {
  const keep = clock;
  clock = pacificAt('2027-01-04', '10:00'); // a Monday
  grids.Closures.push(['2027-01-11', 'Closed']);
  // The desk Sheet's Aliases and ZeffyPayments tabs, and the coaching app's private Sheet: where emails come from.
  books['desk-sheet-id'].insertSheet('Aliases');
  grids.Aliases.push(['alias', 'player_id'], ['Bobby', 'p04']);
  books['desk-sheet-id'].insertSheet('ZeffyPayments');
  grids.ZeffyPayments.push(['payer_name', 'payer_email', 'amount'], ['Ada Park', 'old.ada@example.com', 10], ['Ada Park', 'ada.park@example.com', 10],
    ['Ben Ortiz', 'ben.ortiz@example.com', 10], ['Susan Lake', 'susan.lake@example.com', 10]);
  makeBook('coaching-db-id').insertSheet('Students');
  grids.Students.push(['label', 'email', 'created_at', 'name'], ['Student A', 'eve.stone@example.com', '', 'Eve Stone']);
  books['coaching-db-id'].insertSheet('Coaches');
  grids.Coaches.push(['name', 'email', 'phone'], ['Some Coach', 'coach@example.com', '']);
  properties.COACHING_DB_ID = 'coaching-db-id';
  // The volunteer's tab, laid out as the club keeps it (made-up first names).
  makeBook('seed-sheet-id').insertSheet('Notes');
  books['seed-sheet-id'].insertSheet('Open/Close');
  grids['Open/Close'].push(
    ['', '', 'Open', 'Front Desk', 'Notes'],
    ['', 'Monday', 'Ron\nSusan', 'Bobby'],
    ['', 'Wednesday', 'Ada', 'Eve Stone'],
    ['', 'Friday', 'Sam', 'N/A'],
    ['', 'Saturday', 'Zoe / Ada', ''],
    ['', '', '', ''],
    ['Training list', 'Keys Access', 'Open', 'Front Desk'],
    ['Ada', 'Yes', 'Yes', 'No'],
    ['Bobby', 'N/A', 'No', 'Yes'],
    ['Ron', 'Yes', 'Yes', 'Yes'],
    ['Eve Stone', 'No', 'No', 'yes'],
    ['Sam', 'Yes', 'Yes', 'Yes'],
    ['Kai', 'yes', 'YES', 'N/A'],
    ['', '', '', ''],
    ['Opening checklist', 'Open', 'Front Desk', ''],
    ['Get the key from the lockbox', 'Monday', '', '']);
  properties.SEED_SHEET_ID = 'seed-sheet-id';
  const logged = [];
  context.console.log = line => logged.push(line);
  activeEmail = 'owner@example.com';
  const trainingOf = id => grids.Training.filter(line => line[0] === id);
  let before = sent.length;
  let result = JSON.parse(JSON.stringify(context.importSeedSheet()));
  assert.deepEqual(result, {
    training: 5, people: 3, signups: 50,
    skipped: {
      'unknown roster column': 1, 'roster: no email found': 13, 'club closed that night': 2, 'needs training': 12, 'roster: name ambiguous': 12,
      'roster: name unmatched': 12, 'training: name ambiguous': 1
    },
    unmatched: ['Zoe'], ambiguous: ['Sam'], noEmail: ['Ron']
  });
  const told = JSON.stringify(result) + logged.join('\n');
  assert.doesNotMatch(told, /@|Ron Tate|Zoey Hart|Sam Kim|Sam Lee|Ada Park|Ortiz/, 'the report and console hold counts and the seed Sheet\'s own first names only');
  assert.match(logged.join('\n'), /^Seed import: \{/m);
  // Training: Yes is trained; No, N/A and blank are not. Bobby is Ben by the desk's alias; Kai by the only active Kai.
  assert.deepEqual(trainingOf('p03')[0].slice(2, 5), ['yes', 'yes', 'no']);
  assert.deepEqual(trainingOf('p04')[0].slice(1, 5), ['Ben Ortiz', 'no', 'no', 'yes']);
  assert.deepEqual(trainingOf('p13')[0].slice(2, 5), ['yes', 'yes', 'no']);
  assert.deepEqual(trainingOf('p27')[0].slice(1, 5), ['Ron Tate', 'yes', 'yes', 'yes'], 'Ron has no email: his training still imports');
  // Holds: one normal email per person, every matching night but closures.
  // (The sweep the import runs also tells earlier checks' people their old holds expired: those are not seed emails.)
  const asks = sent.slice(before).filter(message => /^Confirm/.test(message.subject));
  assert.deepEqual(asks.map(message => message.to).sort(), ['ada.park@example.com', 'ben.ortiz@example.com', 'eve.stone@example.com']);
  assert.ok(asks.every(message => /^Confirm your CTTC staff sign-up \[CTTC shift [0-9A-F]{10}\]$/.test(message.subject)));
  assert.match(asks.find(message => message.to === 'ada.park@example.com').body, /open\/close list has you down[\s\S]*Wed, Jan 6: Desk organizer[\s\S]*Sat, Jan 9: Desk organizer/);
  assert.equal(signupsOf('ada.park@example.com').filter(line => cell('Signups', line, 'seed_key')).length, 25, 'Ada: 13 Wednesdays and 12 Saturdays, the latest Zeffy email');
  assert.equal(signupsOf('ada.park@example.com').filter(line => cell('Signups', line, 'position') === 'desk-backup').length, 12, 'second of two names in a cell: the backup');
  assert.equal(signupsOf('ben.ortiz@example.com').filter(line => cell('Signups', line, 'seed_key') && cell('Signups', line, 'position') === 'money').length, 12, 'Bobby: every Monday but the closure');
  const seeded = email => signupsOf(email).filter(line => cell('Signups', line, 'seed_key'));
  assert.equal(seeded('eve.stone@example.com').length, 13, 'Eve: her email from the coaching Sheet');
  assert.ok(seeded('eve.stone@example.com').every(line => cell('Signups', line, 'status') === 'pending' && cell('Signups', line, 'position') === 'money'));
  assert.equal(signupsOf('susan.lake@example.com').length, 0, 'Susan has no opening training: nothing is held');
  // The fix-up loop: SeedReport and a blank SeedLinks row per name, with a player dropdown.
  const report = grids.SeedReport.slice(1);
  assert.deepEqual(report.filter(line => line[1] !== 'summary' && line[1] !== 'skipped').map(line => line.slice(1)), [
    ['no email', 'Ron', '', 'Ron Tate'], ['ambiguous', 'Sam', '', 'Sam Kim, Sam Lee'], ['unmatched', 'Zoe', '', 'Zoey Hart']
  ], 'each name to fix, with candidate players (the private Sheet may show full names)');
  assert.ok(report.some(line => line[1] === 'skipped' && line[2] === 'needs training' && line[3] === '12'));
  assert.deepEqual(grids.SeedLinks.slice(1), [['Ron', '', ''], ['Sam', '', ''], ['Zoe', '', '']]);
  const dropdown = validations['private-book-id/SeedLinks'];
  assert.equal(dropdown.column, 2, 'the dropdown is on player_name');
  assert.equal(dropdown.dropdown, true);
  assert.equal(dropdown.allowInvalid, true, 'a player_id is accepted too');
  assert.ok(hidden.has('private-book-id/SeedPlayers'));
  assert.ok(grids.SeedPlayers.some(line => line[0] === 'Zoey Hart') && !grids.SeedPlayers.some(line => line[0] === 'Samson Gray'), 'active players only');
  // The owner fills SeedLinks and runs it again: only the newly linked people are emailed.
  grids.SeedLinks[1][2] = 'ron.tate@example.com';
  grids.SeedLinks[2][1] = 'Sam Lee';
  grids.SeedLinks[2][2] = 'sam.lee@example.com';
  grids.SeedLinks[3][1] = 'p29';
  grids.SeedLinks[3][2] = 'zoey.hart@example.com';
  before = sent.length;
  result = JSON.parse(JSON.stringify(context.importSeedSheet()));
  assert.equal(result.people, 3);
  assert.equal(result.signups, 36, 'Ron\'s 12 Mondays, Sam Lee\'s 12 Fridays and Zoe\'s 12 Saturdays');
  assert.equal(result.skipped['already imported'], 50, 'what was held before is not held or emailed again');
  assert.equal(result.skipped['position already full'], undefined, 'the second name in "Zoe / Ada" is the backup, so Zoe (p29) gets the Saturday desk');
  assert.ok(signupsOf('zoey.hart@example.com').every(line => cell('Signups', line, 'position') === 'desk'));
  assert.deepEqual([result.unmatched, result.ambiguous, result.noEmail], [[], [], []]);
  assert.deepEqual(sent.slice(before).map(message => message.to).sort(), ['ron.tate@example.com', 'sam.lee@example.com', 'zoey.hart@example.com']);
  assert.equal(trainingOf('p02').length, 1, 'Sam\'s training now goes to Sam Lee');
  assert.equal(grids.SeedLinks.length, 4, 'no SeedLinks row is added twice');
  before = sent.length;
  const rows = grids.Signups.length;
  result = JSON.parse(JSON.stringify(context.importSeedSheet()));
  assert.equal(result.signups, 0);
  assert.equal(grids.Signups.length, rows);
  assert.equal(sent.length, before, 'a third run emails nobody');
  assert.equal(trainingOf('p27').length, 1, 'training is updated in place');
  reply('ada.park@example.com', 'YES');
  assert.equal(signupsOf('ada.park@example.com').filter(line => cell('Signups', line, 'seed_key') && cell('Signups', line, 'status') === 'confirmed').length, 25, 'a seeded sign-up is confirmed like any other');
  activeEmail = '';
  context.console.log = () => {};
  clock = keep;
};

// ---- Day-before reminder, once ----
{
  clock = pacificAt('2026-11-22', '08:30');
  const before = sent.length;
  context.sweep();
  assert.equal(mailTo('max.gold@example.com', before).filter(message => /^Reminder/.test(message.subject)).length, 0, 'not before 9 AM');
  clock = pacificAt('2026-11-22', '09:30');
  context.sweep();
  const reminders = mailTo('max.gold@example.com', before).filter(message => /^Reminder/.test(message.subject));
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].subject, 'Reminder: your CTTC shift tomorrow, Mon, Nov 23');
  assert.match(reminders[0].body, /Closing \(put tables away\) \(closing, 10:00 PM\)/);
  context.sweep();
  clock += 3600000;
  context.sweep();
  assert.equal(mailTo('max.gold@example.com', before).filter(message => /^Reminder/.test(message.subject)).length, 1, 'sent once');
  assert.equal(mailTo('sara.diaz@example.com', before).filter(message => /^Reminder/.test(message.subject)).length, 0, 'only to people on tomorrow');
}

// ---- Rate limits, quota and the log ----
{
  let refused = 0;
  for (let index = 0; index < 30; index += 1) if (/Too many/.test(run('signUp', { playerId: 'p01', email: 'flood@example.com', picks: [{ date: '2026-12-02', position: 'close' }] }).message || '')) refused += 1;
  assert.ok(refused > 0, 'a burst of sign-ups is slowed down');
  resetLimits();
  quota = 5;
  const before = sent.length;
  assert.equal(signUp('Gus Hale', [['2026-12-14', 'tables']]).ok, true, 'a sign-up is saved even when mail is out');
  assert.equal(sent.length, before, 'no mail below the quota floor');
  quota = 100;
  context.sweep();
  assert.equal(mailTo('gus.hale@example.com', before).length, 1, 'the sweep sends it later');
  const log = JSON.stringify(grids.Log);
  assert.doesNotMatch(log, /@|555-\d|925555|\b(Ada|Ben|Gus|Max|Park|Hale)\b/, 'the log never holds a name, address or number');
  assert.match(log, /"email","batch:pending"/);
  assert.match(log, /"step","step:dropped"/);
  assert.equal(held, 0);
}
seedCheck();

// ---- doGet and the page ----
const served = context.doGet();
const initial = JSON.parse(/var INITIAL = (.*);\n/.exec(served.getContent())[1]);
assert.deepEqual(Object.keys(initial), ['staffBoard'], 'the calendar comes with the page');
assert.equal(context.scriptJson_({ name: '</script>' }), '{"name":"\\u003c/script>"}', 'a name cannot end the script');
const page = fs.readFileSync(__dirname + '/Index.html', 'utf8');
assert.doesNotMatch(page, /<\?/, 'the page is static: no template tags');
assert.doesNotMatch(page, /<script[^>]*\ssrc=|<link[^>]*rel="stylesheet"/i, 'the page loads nothing from elsewhere');
assert.doesNotMatch(page, /innerHTML|outerHTML|document\.write|eval\(/, 'nothing typed by a visitor is turned into markup');
assert.doesNotMatch(page, /position:\s*(fixed|sticky)|100vh|overflow(-y)?:\s*(auto|scroll)/, 'no scroll area or full-screen height of its own: it sits inline in the home page');
assert.match(page, /postMessage\('cttc-staffing-ready', '\*'\)/);
assert.match(page, /type: 'cttc-staffing-height'/);
assert.match(page, /new ResizeObserver\(postHeight\)\.observe\(document\.body\)/);
const script = /<script>([\s\S]*?)<\/script>/.exec(page)[1];
new vm.Script(script);
const called = new Set([...script.matchAll(/call\('([A-Za-z]+)'/g)].map(match => match[1]));
assert.deepEqual([...called].sort(), ['findPlayers', 'playerAccess', 'requestDrop', 'signUp', 'staffBoard']);
for (const name of called) assert.ok(globals.includes(name), name + ' exists and is callable from the page');

// ---- The page in a browser (jsdom): calendar, picks, repeat weekly, the form, and hybrid mode ----
(async () => {
  const { JSDOM } = require('jsdom');
  clock = START;
  const open = () => {
    resetLimits();
    const posted = [];
    const html = context.doGet().getContent();
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(window) {
        window.HTMLElement.prototype.scrollIntoView = () => {};
        window.postMessage = message => posted.push(message);
        const runner = (ok, bad) => new Proxy({}, { get: (target, name) => {
          if (name === 'withSuccessHandler') return handler => runner(handler, bad);
          if (name === 'withFailureHandler') return handler => runner(ok, handler);
          return (...args) => { resetLimits(); ok(JSON.parse(JSON.stringify(context[name](...args) ?? null))); };
        } });
        window.google = { script: { run: runner(() => {}, () => {}) } };
      }
    });
    return { dom, document: dom.window.document, posted };
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let { dom, document, posted } = open();
  assert.ok(posted.includes('cttc-staffing-ready'));
  assert.ok(posted.some(message => message && message.type === 'cttc-staffing-height' && typeof message.height === 'number'), 'the page tells the site its height');
  assert.equal(document.querySelector('h1').textContent, 'Volunteer signups');
  assert.equal(document.querySelectorAll('.month').length, 3);
  const cellFor = date => document.querySelector('button.day[data-date="' + date + '"]');
  assert.match(cellFor('2026-10-21').getAttribute('aria-label'), /^Wednesday, October 21, 2026: Needs people/, 'status in words, not only color');
  assert.equal(cellFor('2026-10-21').querySelector('.mark').textContent, '!');
  assert.ok(cellFor('2026-10-24').classList.contains('closed'), 'closures show in the grid');
  assert.equal(cellFor('2026-10-20'), null, 'Tuesdays are not offered');
  assert.equal(document.querySelector('span.day.past').textContent, '2', 'past nights are greyed out');
  cellFor('2026-12-02').click();
  const panel = document.getElementById('night');
  assert.match(panel.textContent, /Wednesday, December 2, 2026/);
  const addFor = label => [...panel.querySelectorAll('button.add')].find(button => button.getAttribute('aria-label').startsWith('Add me as ' + label + ' on'));
  addFor('Desk organizer').click();
  assert.match(document.getElementById('bar').textContent, /My picks: 1/);
  const again = document.getElementById('night');
  assert.equal([...again.querySelectorAll('button.add')].find(button => /Add me as Money collector \(Front Desk\) on/.test(button.getAttribute('aria-label'))).disabled, true, 'one opening position per night, on the page too');
  assert.match(again.textContent, /The opener: first in at 6:40 PM/, 'each position says what it does');
  [...again.querySelectorAll('button.add')].find(button => /Add me as Closing/.test(button.getAttribute('aria-label'))).click();
  assert.match(document.getElementById('bar').textContent, /My picks: 2/, 'opening and closing the same night');
  assert.doesNotMatch(document.getElementById('picks').textContent, /not listed/, 'directory mode never offers "I\'m not listed"');
  [...document.querySelectorAll('#picks button')].find(button => button.textContent === 'Repeat every Wednesday').click();
  const count = Number(/My picks: (\d+)/.exec(document.getElementById('bar').textContent)[1]);
  assert.equal(count, 2 + 4, 'the desk is added on every later open Wednesday (Dec 9, 16, 23, 30)');
  cellFor('2026-11-04').click();
  assert.match(document.getElementById('bar').textContent, /My picks: 6/, 'picks stay while browsing months');
  const search = document.getElementById('who');
  search.value = 'iv';
  search.dispatchEvent(new dom.window.Event('input'));
  await wait(350);
  const result = [...document.querySelectorAll('.results button')].find(button => button.textContent === 'Ivy Wong');
  assert.ok(result, 'the name search offers matching players');
  result.click();
  assert.match(document.querySelector('.chosen').textContent, /Signing up as Ivy Wong/);
  document.getElementById('email').value = 'ivy.wong@example.com';
  const before = sent.length;
  document.querySelector('#picks form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  assert.match(document.getElementById('picks').textContent, /Check your email[\s\S]*Reply YES to that email/);
  assert.equal(mailTo('ivy.wong@example.com', before).length, 1, 'one email for the page\'s six picks');
  assert.equal(signupsOf('ivy.wong@example.com').filter(line => cell('Signups', line, 'status') === 'pending').length, 6);
  assert.equal(document.getElementById('bar').hidden, true);
  // A pick the server refuses is marked with its reason.
  cellFor('2026-12-02').click();
  [...document.getElementById('night').querySelectorAll('button.add')].find(button => /Add me as Table setup/.test(button.getAttribute('aria-label'))).click();
  search.value = '';
  const ivy = [...document.querySelectorAll('#picks form')][0];
  document.getElementById('email').value = 'ivy.wong@example.com';
  ivy.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  assert.match(document.getElementById('picks').textContent, /one opening position per night/i, 'the server\'s reason shows under the pick');
  // Picking an untrained name greys out Desk and Money ("Needs training"), and marks such picks.
  [...document.querySelectorAll('.chosen button')][0].click();
  cellFor('2026-12-05').click();
  [...document.getElementById('night').querySelectorAll('button.add')].find(button => /Add me as Desk organizer on/.test(button.getAttribute('aria-label'))).click();
  const search2 = document.getElementById('who');
  search2.value = 'cal';
  search2.dispatchEvent(new dom.window.Event('input'));
  await wait(350);
  [...document.querySelectorAll('.results button')].find(button => button.textContent === 'Cal Diaz').click();
  cellFor('2026-12-07').click();
  const gated = [...document.getElementById('night').querySelectorAll('button.add')];
  const deskAdd = gated.find(button => /Add me as Desk organizer on/.test(button.getAttribute('aria-label')));
  assert.equal(deskAdd.disabled, true);
  assert.match(deskAdd.parentNode.nextSibling.textContent, /Needs training: ask the club/);
  assert.equal(gated.find(button => /Add me as Table setup/.test(button.getAttribute('aria-label'))).disabled, false);
  assert.match(document.getElementById('picks').textContent, /Needs training: ask the club\. Remove this pick/, 'an earlier desk pick is marked');
  dom.window.close();
  properties.SIGNUP_MODE = 'hybrid';
  ({ dom, document } = open());
  cellFor('2026-12-05').click();
  [...document.getElementById('night').querySelectorAll('button.add')][0].click();
  assert.match(document.getElementById('picks').textContent, /I'm not listed/, 'hybrid mode offers "I\'m not listed"');
  dom.window.close();
  delete properties.SIGNUP_MODE;
  console.log('staffing app checks passed');
})().catch(error => { console.error(error); process.exit(1); });
