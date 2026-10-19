const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

// Synthetic people only (example.com, made-up names): real names and addresses never belong in the repository.
const manifest = JSON.parse(fs.readFileSync(__dirname + '/appsscript.json', 'utf8'));
assert.deepEqual(manifest.oauthScopes, [
  'https://www.googleapis.com/auth/spreadsheets',
  // Only to read the membership list when it is a Google Doc (DocumentApp has no read-only scope).
  'https://www.googleapis.com/auth/documents',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/script.send_mail',
  'https://www.googleapis.com/auth/script.scriptapp',
  // Only to read the home page's closures.json.
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/userinfo.email'
]);
assert.equal(manifest.webapp.access, 'ANYONE_ANONYMOUS');
assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING', 'visitors never need Google access: the app acts as the owner');
assert.equal(manifest.timeZone, 'America/Los_Angeles');
assert.equal(fs.readFileSync(__dirname + '/.claspignore', 'utf8').trim(), 'check-*', 'the test is never pushed to Google');

const source = fs.readFileSync(__dirname + '/Code.js', 'utf8');
const globals = [...source.matchAll(/^function ([A-Za-z0-9_]+)\(/gm)].map(match => match[1]);
assert.deepEqual(globals.filter(name => !name.endsWith('_')).sort(), [
  'checkReplies', 'doGet', 'findPlayers', 'importMemberEmails', 'importSeedSheet', 'playerAccess', 'requestDrop', 'setup', 'signUp', 'staffBoard', 'sweep'
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
const docs = {};
// The home page's data/closures.json, as the site serves it. siteDown makes the fetch fail.
let site = { days: {}, notices: [] };
let siteDown = false;
const fetched = [];
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
  ['p27', 'Ron Tate', true], ['p28', 'Susan Lake', true], ['p29', 'Zoey Hart', true],
  ['p30', 'Una Newman', true], ['p31', 'Vic Lowe', true], ['p32', 'Wes Hunt', true], ['p33', 'Tess Vale', true], ['p34', 'Uma Rios', true],
  ['p35', 'Gia Rowe', true], ['p36', 'Ivo Bly', true], ['p37', 'Jan Bly', true], ['p38', 'Xan Doe', true]
].concat(['Abe', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gil', 'Hap', 'Ike', 'Jud', 'Kip', 'Lars'].map((first, index) => ['q' + (40 + index), first + ' Queue', true]));
// Players with no email on file at the start: the seed and member imports, and the club-approval path, find theirs.
const NO_EMAIL = ['Ron Tate', 'Susan Lake', 'Zoey Hart', 'Una Newman', 'Vic Lowe', 'Wes Hunt', 'Tess Vale', 'Uma Rios', 'Gia Rowe', 'Ivo Bly', 'Jan Bly', 'Xan Doe'];
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
    getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/staffing-test/dev' }),
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
      const answers = query.match(/^newer_than:(3|8)d subject:"CTTC shift" (-from:me )?after:(\d+)$/);
      if (answers) {
        const found = mailbox.filter(message => message.getDate().getTime() >= Number(answers[3]) * 1000);
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
  UrlFetchApp: {
    fetch: (url, options) => {
      assert.equal(options.muteHttpExceptions, true);
      fetched.push(url);
      if (siteDown === 'throw') throw new Error('DNS error');
      return { getResponseCode: () => (siteDown ? 503 : 200), getContentText: () => (siteDown ? '<html>Service unavailable</html>' : JSON.stringify(site)) };
    }
  },
  DocumentApp: {
    openById: id => {
      assert.ok(docs[id], 'only known Docs are opened');
      return { getBody: () => ({ getTables: () => docs[id].map(rows => ({
        getNumRows: () => rows.length,
        getRow: r => ({ getNumCells: () => rows[r].length, getCell: c => ({ getText: () => String(rows[r][c]) }) })
      })) }) };
    }
  },
  HtmlService: {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createHtmlOutput: html => { const output = { getContent: () => html, setTitle: () => output, addMetaTag: () => output }; return output; },
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
const reply = (address, word, pattern = /^Please confirm your CTTC volunteer night/) => answerMail(address, word, askedBy(address, pattern));
const signAndConfirm = (name, picks, extra) => {
  const result = signUp(name, picks, extra);
  assert.equal(result.ok, true, result.message);
  reply(emailOf(name), 'YES');
  return result;
};
const statusOf = (name, date, position) => cell('Signups', signupRows().filter(line => cell('Signups', line, 'player_id') === idOf(name)).filter(line => cell('Signups', line, 'date') === date && cell('Signups', line, 'position') === position).pop(), 'status');

// ---- Setup runs only for the owner, in the editor ----
assert.throws(() => context.setup(), /owner/, 'a web visitor cannot run setup');
assert.throws(() => context.importSeedSheet(), /owner/, 'nor import the seed Sheet');
activeEmail = 'owner@example.com';
properties.DESK_SHEET_ID = 'desk-sheet-id';
const setupResult = JSON.parse(JSON.stringify(context.setup()));
assert.equal(setupResult.players, PLAYERS.filter(player => player[2] === true || /^true$/i.test(player[2])).length + ' active players', 'inactive rows are left out of the player list');
assert.equal(setupResult.mode, 'directory', 'v1 signs up from the player list only');
assert.deepEqual(books['private-book-id'].names(), ['Batches', 'Closures', 'Emails', 'Log', 'MemberEmailReport', 'People', 'SeedLinks', 'SeedReport', 'Signups', 'Training']);
assert.deepEqual(grids.Emails[0], ['player_id', 'name', 'email', 'phone', 'source', 'status', 'requested_at', 'decided_at', 'batch_id']);
// Emails on file, as the owner would type them, for everyone but NO_EMAIL.
PLAYERS.forEach(([id, name]) => { if (!NO_EMAIL.includes(name) && !/Queue$/.test(name)) grids.Emails.push([id, name, emailOf(name), '', 'owner', 'approved', '', '', '']); });
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
  assert.match(asks[0].subject, /^Please confirm your CTTC volunteer nights? \[CTTC shift [0-9A-F]{10}\]$/);
  assert.match(asks[0].body, /Desk organizer, Mondays 7:00 PM: Oct 26\nTable setup, Wednesdays 7:00 PM: Oct 28\nClosing \(put tables away\), Fridays 10:00 PM: Oct 30 \(finalize\)/);
  assert.match(asks[0].body, /Yes, confirm all 3 nights: reply YES\nNo, release them: reply NO/);
  // The HTML version: a calendar with each night marked by its position letter, and one-tap replies with the same subject.
  assert.match(asks[0].htmlBody, /October 2026[\s\S]*<strong>26<\/strong><br><span[^>]*>D<\/span>[\s\S]*<strong>28<\/strong><br><span[^>]*>T<\/span>[\s\S]*<strong>30<\/strong><br><span[^>]*>C<\/span>/);
  const yes = /href="(mailto:[^"]+)"[^>]*>Yes, confirm all 3 nights</.exec(asks[0].htmlBody.replace(/&amp;/g, '&'));
  assert.ok(yes, 'a Yes button');
  assert.equal(decodeURIComponent(/subject=([^&]+)/.exec(yes[1])[1]), 'Re: ' + asks[0].subject, 'the reply keeps the subject, so it is read');
  assert.equal(decodeURIComponent(/body=([^&]+)/.exec(yes[1])[1]), 'YES');
  assert.match(yes[1], /^mailto:owner@example\.com\?/, 'the reply goes to the club');
  assert.deepEqual(night('2026-10-26').slots.desk, [{ name: 'Hal', pending: true, finalize: false }], 'a pending pick holds its slot and shows as waiting, with no id');
  assert.equal(night('2026-10-26').status, 'needs', 'status counts confirmed sign-ups only');
  assert.equal(signUp('Ivy Wong', [['2026-10-26', 'desk']]).problems[0].reason, 'Desk organizer is already taken that night.', 'nobody else can take a held slot');
  reply('hal.reed@example.com', 'YES');
  assert.deepEqual(['2026-10-26', '2026-10-28', '2026-10-30'].map((date, index) => statusOf('Hal Reed', date, ['desk', 'tables', 'close'][index])), ['confirmed', 'confirmed', 'confirmed']);
  const done = mailTo('hal.reed@example.com').pop();
  assert.equal(done.subject, 'You are on the CTTC staff schedule');
  assert.match(done.body, /3 nights are confirmed/);
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
  assert.deepEqual(run('playerAccess', 'p05'), { ok: true, positions: ['tables', 'close'], emailOnFile: 'c\u2022\u2022\u2022@example.com' }, 'the page learns only which positions the chosen player may take, and a masked email');
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
  assert.match(late.body, /1 night is confirmed[\s\S]*Table setup, Fridays 7:00 PM: Nov 13[\s\S]*NO LONGER FREE\n\nWed, Nov 11: Money collector \(Front Desk\)/);
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

// ---- Nobody can sign up as someone else: the email on file, or the club approves a new one once ----
{
  assert.equal(context.maskEmail_('sam.kim@gmail.com'), 's\u2022\u2022\u2022@gmail.com');
  resetLimits();
  const access = run('playerAccess', 'p03');
  assert.equal(access.emailOnFile, 'a\u2022\u2022\u2022@example.com', 'the page learns the address only masked');
  assert.doesNotMatch(JSON.stringify(access), /ada\.park/);
  resetLimits();
  assert.equal(run('playerAccess', 'p30').emailOnFile, null, 'and null when the club has none');
  // Signing up as Ada, with a forged email and phone, only emails Ada.
  let before = sent.length;
  const forged = signUp('Ada Park', [['2026-11-27', 'tables']], { email: 'forger@example.com', phone: '(925) 555-0177' });
  assert.equal(forged.ok, true);
  assert.match(forged.message, /we emailed a\u2022\u2022\u2022@example\.com/);
  assert.doesNotMatch(JSON.stringify(forged), /ada\.park|forger/, 'the answer never holds the full address');
  assert.deepEqual(sent.slice(before).map(message => message.to), ['ada.park@example.com'], 'the confirmation goes only to the email on file');
  assert.equal(cell('Signups', signupRows().at(-1), 'email'), 'ada.park@example.com');
  assert.doesNotMatch(JSON.stringify(grids.People) + JSON.stringify(grids.Batches), /forger|5550177/, 'the forged email and phone are not kept');

  // No email on file: a request to the club. Nothing is held, and nothing goes to the typed address yet.
  before = sent.length;
  const asked = signUp('Una Newman', [['2026-11-27', 'desk'], ['2026-11-30', 'tables']], { email: 'Una@Example.com' });
  assert.equal(asked.ok, true, asked.message);
  assert.equal(asked.request, true);
  assert.match(asked.message, /the club will confirm una@example\.com once/);
  assert.deepEqual(night('2026-11-27').slots.desk, [], 'a request holds no slot');
  assert.deepEqual(night('2026-11-30').slots.tables, []);
  const clubAsk = sent.slice(before);
  assert.deepEqual(clubAsk.map(message => message.to), ['owner@example.com'], 'one email, to the club');
  assert.match(clubAsk[0].subject, /^Approve an email for staff sign-ups \[CTTC shift [0-9A-F]{10}\]$/);
  assert.match(clubAsk[0].body, /Una Newman wants to use una@example\.com for staff sign-ups\. Reply YES to approve or NO to decline\./);
  const unaRow = () => grids.Emails.find(line => line[0] === 'p30' && line[2] === 'una@example.com');
  assert.deepEqual(unaRow().slice(4, 6), ['request', 'pending']);
  assert.match(signUp('Una Newman', [['2026-12-02', 'tables']], { email: 'una2@example.com' }).message, /not answered your last request/, 'one open request per player');
  assert.equal(signUp('Vic Lowe', [['2026-12-02', 'tables']], { email: 'una@example.com' }).field, 'email', 'and per email');
  signAndConfirm('Hal Reed', [['2026-11-27', 'desk']]);
  answerMail('una@example.com', 'YES', clubAsk[0].subject);
  assert.equal(unaRow()[5], 'pending', 'only the club can approve');
  before = sent.length;
  answerMail('owner@example.com', 'YES', clubAsk[0].subject);
  assert.deepEqual(unaRow().slice(4, 6), ['approved-request', 'approved']);
  assert.equal(statusOf('Una Newman', '2026-11-30', 'tables'), 'pending', 'the picks still free become holds');
  assert.equal(statusOf('Una Newman', '2026-11-27', 'desk'), 'unavailable', 'a pick taken meanwhile does not');
  const confirm = mailTo('una@example.com', before);
  assert.equal(confirm.length, 1);
  assert.match(confirm[0].subject, /^Please confirm your CTTC volunteer night/, 'the person still confirms with their own YES');
  assert.match(confirm[0].body, /club approved your email address[\s\S]*Table setup, Mondays 7:00 PM: Nov 30[\s\S]*NO LONGER FREE BY THE TIME THE CLUB APPROVED YOUR EMAIL\n\nFri, Nov 27: Desk organizer/);
  reply('una@example.com', 'YES');
  assert.equal(statusOf('Una Newman', '2026-11-30', 'tables'), 'confirmed');
  resetLimits();
  assert.equal(run('playerAccess', 'p30').emailOnFile, 'u\u2022\u2022\u2022@example.com', 'now on file');

  // The club says NO: nothing held; the person is told once.
  assert.equal(signUp('Vic Lowe', [['2026-12-02', 'tables']], { email: 'vic@example.com' }).ok, true);
  before = sent.length;
  answerMail('owner@example.com', 'No', askedBy('owner@example.com', /^Approve/));
  assert.equal(grids.Emails.find(line => line[0] === 'p31')[5], 'declined');
  assert.equal(statusOf('Vic Lowe', '2026-12-02', 'tables'), 'declined');
  assert.deepEqual(sent.slice(before).map(message => [message.to, message.subject]), [['vic@example.com', 'We could not confirm your email for CTTC staff sign-ups']]);
  context.sweep();
  assert.equal(mailTo('vic@example.com').length, 1, 'once');

  // At most MAX_OPEN_REQUESTS open; the owner can decline (or approve) in the Emails tab.
  ['Cy', 'Di', 'Ed', 'Flo', 'Gil', 'Hap', 'Ike', 'Jud', 'Kip', 'Lars'].forEach(first => {
    const result = signUp(first + ' Queue', [['2026-12-04', 'tables']], { email: first.toLowerCase() + '@example.com' });
    assert.equal(result.ok, true, result.message);
  });
  assert.equal(signUp('Wes Hunt', [['2026-12-04', 'tables']], { email: 'wes@example.com' }).message, 'Please ask the club to add your email.');
  grids.Emails.filter(line => /^q/.test(line[0]) && line[5] === 'pending').forEach(line => { line[5] = 'declined'; });
  check();
  assert.ok(grids.Batches.filter(line => /Queue$/.test(line[2])).every(line => line[column('Batches', 'status')] === 'declined'), 'an owner decision in the Sheet applies within a minute');
  assert.equal(signUp('Wes Hunt', [['2026-12-04', 'tables']], { email: 'wes@example.com' }).ok, true);
  grids.Emails.find(line => line[0] === 'p32')[5] = 'approved';
  before = sent.length;
  check();
  assert.equal(statusOf('Wes Hunt', '2026-12-04', 'tables'), 'pending', 'an owner approval proceeds as a YES');
  assert.match(mailTo('wes@example.com', before)[0].subject, /^Please confirm your CTTC volunteer night/);
  reply('wes@example.com', 'YES');
  // A later change of the email on file: drops (and reminders) go to the new address.
  grids.Emails.push(['p32', 'Wes Hunt', 'wes.new@example.com', '', 'owner', 'approved', '', '', '']);
  context.sweep();
  assert.equal(grids.Emails.find(line => line[2] === 'wes@example.com')[5], 'replaced', 'one approved email per player');
  resetLimits();
  run('requestDrop', night('2026-12-04').slots.tables.find(slot => slot.name === 'Wes').id);
  assert.equal(sent.at(-1).to, 'wes.new@example.com');
  answerMail('wes.new@example.com', 'YES', sent.at(-1).subject);
  assert.equal(statusOf('Wes Hunt', '2026-12-04', 'tables'), 'dropped');
  // No answer from the club in 7 days: declined.
  assert.equal(signUp('Abe Queue', [['2026-12-05', 'tables']], { email: 'abe@example.com' }).ok, true);
  clock += 7 * 24 * 3600000 + 60000;
  context.sweep();
  assert.equal(grids.Emails.find(line => line[0] === 'q40')[5], 'declined');
  assert.equal(mailTo('abe@example.com').pop().subject, 'We could not confirm your email for CTTC staff sign-ups');
}

// ---- The home page's closures (data/closures.json) ----
{
  assert.ok(fetched.length >= 1 && fetched.every(url => url === 'https://concordtabletennisclub.com/data/closures.json'), 'the published file is the source');
  signAndConfirm('Ada Park', [['2026-12-09', 'tables']]);
  signAndConfirm('Ben Ortiz', [['2026-12-09', 'close'], ['2026-12-11', 'close']]);
  assert.equal(signUp('Cal Diaz', [['2026-12-09', 'close']]).ok, true, 'Cal is still waiting to confirm');
  site = { months: ['2026-10', '2026-11', '2026-12'], days: { '2026-12-07': 'full', '2026-12-09': 'full', '2026-12-18': 'partial', '2026-12-19': 'partial', '2026-12-25': 'holiday', '2026-12-26': 'holiday', 'bad-date': 'full', '2026-12-28': 'weird' },
    notices: [{ when: 'Fri, Dec 18 and Sat, Dec 19', text: 'Open with a reduced play area (10 tables max)' }, { when: 'Fri, Dec 25', text: 'Open on holiday (Christmas), regular hours' }] };
  let fetches = fetched.length;
  board();
  assert.equal(fetched.length, fetches, 'read at most once an hour (cached)');
  delete cache['site-closures'];
  assert.equal(night('2026-12-07').status, 'closed', 'full: closed');
  assert.equal(fetched.length, fetches + 1);
  fetches = fetched.length;
  for (let index = 0; index < 5; index += 1) board();
  assert.equal(fetched.length, fetches, 'and cached again');
  assert.equal(night('2026-12-07').bookable, false);
  assert.deepEqual(night('2026-12-07').missing, [], 'a closed night needs nobody');
  assert.equal(signUp('Gus Hale', [['2026-12-07', 'tables']]).problems[0].reason, 'The club is closed that night.');
  assert.equal(night('2026-12-18').status, 'needs', 'partial: open, and still needs volunteers');
  assert.equal(night('2026-12-18').note, 'Open with a reduced play area (10 tables max)', 'with the home page notice that mentions it');
  assert.equal(night('2026-12-25').note, 'Open on holiday (Christmas), regular hours');
  assert.equal(night('2026-12-26').note, 'Open on holiday', 'or the default');
  assert.equal(night('2026-12-28').note, '', 'unknown kinds and bad dates are ignored');
  assert.equal(night('2026-10-24').status, 'closed', 'the private Closures tab still closes nights too');
  assert.deepEqual(board().closures.filter(date => date >= '2026-12-01'), ['2026-12-07', '2026-12-09']);
  // A night with confirmed sign-ups became closed: each person is told once, and the club once.
  const before = sent.length;
  context.sweep();
  assert.equal(statusOf('Ada Park', '2026-12-09', 'tables'), 'cancelled');
  assert.equal(cell('Signups', signupRows().find(line => cell('Signups', line, 'player_id') === 'p03' && cell('Signups', line, 'date') === '2026-12-09'), 'cancelled_by'), 'closure');
  assert.equal(statusOf('Cal Diaz', '2026-12-09', 'close'), 'cancelled', 'a pending pick on that night is released');
  assert.equal(statusOf('Ben Ortiz', '2026-12-11', 'close'), 'confirmed', 'other nights are untouched');
  const notices = sent.slice(before);
  assert.deepEqual(notices.map(message => message.to).sort(), ['ada.park@example.com', 'ben.ortiz@example.com', 'owner@example.com']);
  assert.match(notices.find(message => message.to === 'ada.park@example.com').body, /The gym is closed on Wednesday, December 9, 2026; your Table setup shift is cancelled\. Thank you!/);
  assert.match(notices.find(message => message.to === 'owner@example.com').subject, /^Staffing: 2 shifts cancelled because the gym is closed$/);
  context.sweep();
  clock += 3600000;
  delete cache['site-closures'];
  context.sweep();
  assert.equal(sent.length, before + 3, 'never twice');
  // The site is down or the file broken: the last good copy keeps closed nights closed.
  siteDown = true;
  delete cache['site-closures'];
  assert.equal(night('2026-12-07').status, 'closed', 'a 503 falls back to the last good copy');
  siteDown = 'throw';
  delete cache['site-closures'];
  assert.equal(night('2026-12-07').status, 'closed', 'as does a failed fetch');
  siteDown = false;
  site = { not: 'a closures file' };
  delete cache['site-closures'];
  assert.equal(night('2026-12-07').status, 'closed', 'and a file that is not a closures list');
  // Back to no closures for the checks that follow.
  site = { days: {}, notices: [] };
  delete cache['site-closures'];
  assert.equal(night('2026-12-07').status, 'needs');
}

// ---- Texts: STAFF opts in, CONFIRM answers, STOP opts out silently ----
{
  // The owner keeps the mobile in the Emails tab; the form takes none.
  grids.Emails.find(line => line[0] === 'p15')[3] = '(925) 555-0142';
  assert.equal(signUp('Max Gold', [['2026-11-23', 'close']], { phone: '(925) 555-0199' }).ok, true);
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
  grids.Students.push(['label', 'email', 'created_at', 'name', 'phone'], ['Student A', 'eve.stone@example.com', '', 'Eve Stone', ''], ['Student B', 'zoey.hart@example.com', '', 'Zoey Hart', '925-555-0188']);
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
  // The preview works everything out but writes nothing and sends nothing.
  const sheetBefore = JSON.stringify(grids);
  const plan = JSON.parse(JSON.stringify(context.importSeed_(true)));
  assert.equal(JSON.stringify(grids), sheetBefore, 'a preview changes no Sheet');
  assert.equal(sent.length, before, 'a preview sends nothing');
  assert.deepEqual(plan.preview.map(person => person.name).sort(), ['Ada', 'Bobby', 'Eve S.']);
  assert.ok(plan.preview.every(person => /^.\u2022\u2022\u2022@example\.com$/.test(person.email)), 'emails masked');
  assert.deepEqual(plan.preview.find(person => person.name === 'Ada').positions.sort(), ['Desk organizer', 'Desk organizer backup']);
  assert.equal(plan.preview.reduce((total, person) => total + person.nights, 0), plan.signups);
  // A test copy of the first person's email goes to the club inbox only, holds nothing, and its YES changes nothing.
  // (Opening the setup page runs setup(), whose sweep tidies earlier checks' sign-ups; compare from after that.)
  const pageWithLink = context.doGet({ parameter: { setup: '', import: 'preview' } }).getContent();
  const sheetsBeforeSample = JSON.stringify([grids.Signups, grids.Batches, grids.Emails, grids.Training]);
  assert.match(pageWithLink, /import=sample/, 'the preview offers a test copy');
  const sampleAt = sent.length;
  assert.match(context.doGet({ parameter: { setup: '', import: 'sample' } }).getContent(), /Sent a test copy/);
  const copies = sent.slice(sampleAt).filter(message => /^\[TEST\]/.test(message.subject));
  assert.equal(copies.length, 1, 'one test copy');
  assert.equal(copies[0].to, 'owner@example.com', 'to the club inbox only');
  assert.match(copies[0].subject, /^\[TEST\] Please confirm your CTTC volunteer nights \[CTTC shift [0-9A-F]{10}\]$/);
  assert.match(copies[0].htmlBody, /Yes, confirm all \d+ nights/);
  answerMail('owner@example.com', 'YES', copies[0].subject);
  context.checkReplies();
  assert.equal(JSON.stringify([grids.Signups, grids.Batches, grids.Emails, grids.Training]), sheetsBeforeSample, 'the test copy and its YES change nothing');
  before = sent.length;
  // Everyone on the roster the import leaves out (or holds only partly) is listed with the reason, in nights.
  const susan = plan.held.find(person => person.name === 'Susan');
  assert.deepEqual(susan, { name: 'Susan', nights: 0, reasons: { 'needs training': 12 } }, 'the untrained backup is explained');
  assert.ok(!plan.held.some(person => person.name === 'Bobby'), 'someone missing only closed nights is not listed');
  const ron = plan.held.find(person => person.name === 'Ron');
  assert.ok(ron && ron.reasons['roster: no email found'] > 0, 'no email is explained per person too');
  let result = JSON.parse(JSON.stringify(context.importSeedSheet()));
  assert.deepEqual([plan.people, plan.signups, plan.training, plan.unmatched, plan.ambiguous, plan.noEmail],
    [result.people, result.signups, result.training, result.unmatched, result.ambiguous, result.noEmail], 'the preview shows exactly what the import then does');
  assert.deepEqual(result, {
    training: 5, people: 3, signups: 50,
    skipped: {
      'unknown roster column': 1, 'roster: no email found': 13, 'club closed that night': 2, 'needs training': 12, 'roster: name ambiguous': 12,
      'roster: name unmatched': 12, 'training: name ambiguous': 1
    },
    unmatched: ['Zoe'], ambiguous: ['Sam'], noEmail: ['Ron']
  });
  // What the lookups found is on file now, never over the owner's own rows.
  assert.deepEqual(grids.Emails.filter(line => line[0] === 'p28').map(line => line.slice(2, 6)), [['susan.lake@example.com', '', 'zeffy', 'approved']]);
  assert.deepEqual(grids.Emails.filter(line => line[0] === 'p03').map(line => line.slice(4, 6)), [['owner', 'approved']], 'Ada\'s owner row stays the only one');
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
  const asks = sent.slice(before).filter(message => /^Please confirm/.test(message.subject));
  assert.deepEqual(asks.map(message => message.to).sort(), ['ada.park@example.com', 'ben.ortiz@example.com', 'eve.stone@example.com']);
  assert.ok(asks.every(message => /^Please confirm your CTTC volunteer nights? \[CTTC shift [0-9A-F]{10}\]$/.test(message.subject)));
  assert.match(asks.find(message => message.to === 'ada.park@example.com').body, /open\/close list, which has moved[\s\S]*Desk organizer, Wednesdays 7:00 PM: [^\n]*Jan 6[\s\S]*Desk organizer backup, Saturdays 3:00 PM: Jan 9/);
  assert.equal(signupsOf('ada.park@example.com').filter(line => cell('Signups', line, 'seed_key')).length, 25, 'Ada: 13 Wednesdays and 12 Saturdays, the latest Zeffy email');
  assert.equal(signupsOf('ada.park@example.com').filter(line => cell('Signups', line, 'position') === 'desk-backup').length, 12, 'second of two names in a cell: the backup');
  assert.equal(signupsOf('ben.ortiz@example.com').filter(line => cell('Signups', line, 'seed_key') && cell('Signups', line, 'position') === 'money').length, 12, 'Bobby: every Monday but the closure');
  const seeded = email => signupsOf(email).filter(line => cell('Signups', line, 'seed_key'));
  assert.equal(seeded('eve.stone@example.com').length, 13, 'Eve: her email from the coaching Sheet');
  assert.ok(seeded('eve.stone@example.com').every(line => cell('Signups', line, 'status') === 'pending' && cell('Signups', line, 'position') === 'money'));
  assert.equal(signupsOf('susan.lake@example.com').length, 0, 'Susan has no opening training: nothing is held');
  // Already emailed and still waiting: listed on the preview, and one tap re-sends the current email with a fresh deadline.
  let page = context.doGet({ parameter: { setup: '', import: 'preview' } }).getContent();
  assert.doesNotMatch(page, /Re-send:/, 'just emailed: not offered again within the hour');
  clock += 2 * 3600000;
  page = context.doGet({ parameter: { setup: '', import: 'preview' } }).getContent();
  assert.match(page, /Sending would email 3 people[\s\S]*<strong>Ada<\/strong> \(a\u2022\u2022\u2022@example\.com\): 25 nights as [^<]*<em>Re-send: emailed a\u2022\u2022\u2022@example\.com earlier, no YES yet/,
    'people still waiting are in the one list, marked as a re-send');
  assert.match(page, />Send these 3 emails</, 'one button for everyone');
  const adaBatch = () => grids.Batches.slice(1).find(line => cell('Batches', line, 'email') === 'ada.park@example.com' && cell('Batches', line, 'source') === 'seed');
  const oldExpiry = Number(cell('Batches', adaBatch(), 'expires_at'));
  const resendAt = sent.length;
  const batchCount = grids.Batches.length;
  assert.match(context.doGet({ parameter: { setup: '', import: 'seed' } }).getContent(), /Sent 3 emails: 0 new \(0 nights held\) and 3 re-sent to people still waiting/, 'the one Send button re-sends too');
  const resent = sent.slice(resendAt).filter(message => /^Please confirm/.test(message.subject));
  assert.deepEqual(resent.map(message => message.to).sort(), ['ada.park@example.com', 'ben.ortiz@example.com', 'eve.stone@example.com'], 'each person still waiting, once');
  assert.equal(grids.Batches.length, batchCount, 'the same submissions: no new holds');
  assert.ok(Number(cell('Batches', adaBatch(), 'expires_at')) > oldExpiry, 'a fresh deadline');
  assert.ok(signupsOf('ada.park@example.com').filter(line => cell('Signups', line, 'seed_key')).every(line => cell('Signups', line, 'expires_at') === cell('Batches', adaBatch(), 'expires_at')), 'the held nights move with it');
  // A SeedLinks email typed after someone was emailed is where the preview says (and the import then sends) the re-send goes,
  // when the email on file was found automatically (Ben: Zeffy). An email the club typed itself (Ada: owner) stays.
  clock += 2 * 3600000;
  grids.SeedLinks.push(['Bobby', 'Ben Ortiz', 'ben.new@example.com'], ['Ada', 'Ada Park', 'ada.new@example.com']);
  const benRow = grids.Emails.find(line => line[2] === 'ben.ortiz@example.com');
  const benSource = benRow[4];
  benRow[4] = 'zeffy'; // as if the first import had found Ben's address in the Zeffy records (Raymond's case)
  const benId = cell('Batches', grids.Batches.slice(1).find(line => cell('Batches', line, 'email') === 'ben.ortiz@example.com' && cell('Batches', line, 'source') === 'seed'), 'player_id');
  const previewed = JSON.parse(JSON.stringify(context.importSeed_(true)));
  assert.equal(previewed.emailsFor[benId], 'ben.new@example.com', 'the preview follows the SeedLinks email over a Zeffy one, as the import does');
  assert.equal(previewed.emailsFor[cell('Batches', adaBatch(), 'player_id')], 'ada.park@example.com', 'an email the club typed itself is kept');
  page = context.doGet({ parameter: { setup: '', import: 'preview' } }).getContent();
  assert.match(page, /<strong>Ben<\/strong> \(b\u2022\u2022\u2022@example\.com\)[^<]*<em>Re-send: emailed b\u2022\u2022\u2022@example\.com earlier/);
  const moved = sent.length;
  context.doGet({ parameter: { setup: '', import: 'seed' } });
  const resentTo = sent.slice(moved).filter(message => /^Please confirm/.test(message.subject)).map(message => message.to);
  assert.ok(resentTo.includes('ben.new@example.com') && !resentTo.includes('ben.ortiz@example.com'), 'Ben\'s re-send goes to the new SeedLinks address');
  grids.SeedLinks.splice(-2, 2);
  const benNow = grids.Emails.filter(line => line[0] === benRow[0] && line[5] === 'approved');
  assert.deepEqual(benNow.map(line => [line[2], line[4]]), [['ben.new@example.com', 'seedlinks']], 'the SeedLinks address is now on file; the old one is marked replaced');
  benRow[4] = benSource;
  clock -= 2 * 3600000;
  const doubleTap = sent.length;
  assert.match(context.doGet({ parameter: { setup: '', import: 'seed' } }).getContent(), /and 0 re-sent/, 'a second tap re-sends nothing');
  assert.equal(sent.slice(doubleTap).filter(message => /^Please confirm/.test(message.subject)).length, 0);
  clock -= 2 * 3600000;
  // The fix-up loop: SeedReport and a blank SeedLinks row per name, with a player dropdown.
  const report = grids.SeedReport.slice(1);
  assert.deepEqual(report.filter(line => line[1] !== 'summary' && line[1] !== 'skipped').map(line => line.slice(1)), [
    ['ambiguous', 'Sam', '', 'Sam Kim, Sam Lee'], ['unmatched', 'Zoe', '', 'Zoey Hart'], ['no email', 'Ron', '', 'Ron Tate']
  ], 'each name to fix, with candidate players (the private Sheet may show full names)');
  assert.ok(report.some(line => line[1] === 'skipped' && line[2] === 'needs training' && line[3] === '12'));
  assert.deepEqual(grids.SeedLinks.slice(1), [['Sam', '', ''], ['Zoe', '', ''], ['Ron', '', '']]);
  const dropdown = validations['private-book-id/SeedLinks'];
  assert.equal(dropdown.column, 2, 'the dropdown is on player_name');
  assert.equal(dropdown.dropdown, true);
  assert.equal(dropdown.allowInvalid, true, 'a player_id is accepted too');
  assert.ok(hidden.has('private-book-id/SeedPlayers'));
  assert.ok(grids.SeedPlayers.some(line => line[0] === 'Zoey Hart') && !grids.SeedPlayers.some(line => line[0] === 'Samson Gray'), 'active players only');
  // The owner fills SeedLinks and runs it again: only the newly linked people are emailed.
  grids.SeedLinks[1][1] = 'Sam Lee';
  grids.SeedLinks[1][2] = 'sam.lee@example.com';
  grids.SeedLinks[2][1] = 'p29';
  grids.SeedLinks[3][2] = 'ron.tate@example.com';
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
  assert.deepEqual(grids.Emails.filter(line => line[0] === 'p27').map(line => line.slice(2, 6)), [['ron.tate@example.com', '', 'seedlinks', 'approved']]);
  assert.deepEqual(grids.Emails.filter(line => line[0] === 'p29').map(line => line.slice(2, 6)), [['zoey.hart@example.com', '9255550188', 'coaching', 'approved']], 'with the mobile from the coaching Sheet');
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
  // Ben never answered: once his hold expires, the next import may offer him those nights again. Ada (confirmed) is not offered twice.
  const benExpiry = Number(cell('Batches', grids.Batches.slice(1).find(line => cell('Batches', line, 'player_id') === benId && cell('Batches', line, 'source') === 'seed'), 'expires_at'));
  const beforeExpiry = clock;
  clock = benExpiry + 60000;
  const again = JSON.parse(JSON.stringify(context.importSeed_(true)));
  assert.ok(again.preview.some(person => person.name === 'Bobby'), 'an unanswered, expired hold is offered again');
  assert.ok(!again.preview.some(person => person.name === 'Ada'), 'a confirmed one is not');
  clock = beforeExpiry;
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

// ---- The membership list's emails: a Sheet, then a Doc table ----
{
  makeBook('member-sheet-id').insertSheet('Members 2026');
  grids['Members 2026'].push(['2026 Membership', '', ''], ['Member Name', 'E-mail', 'Paid'],
    ['Lu Chen', 'lu.new@example.com', 'yes'],
    ['Tess Vale; Uma Rios', 'tess@example.com; uma@example.com', ''],
    ['Kim Pair, Lee Pair', 'only.one@example.com', ''],
    ['Nobody Known', 'nobody@example.com', ''],
    ['Sam', 'sam@example.com', ''],
    ['Una Newman', 'una@example.com', ''],
    ['Ron Tate', 'ron.member@example.com', ''],
    ['Jo Banks', '', ''],
    ['', '', '']);
  properties.MEMBER_LIST_ID = 'member-sheet-id';
  assert.throws(() => context.importMemberEmails(), /owner/, 'owner only');
  activeEmail = 'owner@example.com';
  const logged = [];
  context.console.log = line => logged.push(line);
  const emailRows = () => grids.Emails.length;
  let result = JSON.parse(JSON.stringify(context.importMemberEmails()));
  assert.deepEqual(result, { rows: 8, added: 2, alreadyOnFile: 1, kept: 2, skipped: {
    'names and emails could not be paired': 1, 'name unmatched': 1, 'name ambiguous': 1, 'no email': 1 } });
  assert.doesNotMatch(JSON.stringify(result) + logged.join('\n'), /@|Tess|Lu Chen|Nobody|Pair/, 'counts only outside the private Sheet');
  assert.deepEqual(grids.Emails.filter(line => line[0] === 'p33' || line[0] === 'p34').map(line => [line[2], line[4], line[5]]),
    [['tess@example.com', 'member-list', 'approved'], ['uma@example.com', 'member-list', 'approved']], 'a household row pairs names and emails one to one');
  assert.deepEqual(grids.Emails.filter(line => line[0] === 'p14').map(line => [line[2], line[4], line[5]]), [['lu.chen@example.com', 'owner', 'approved']], 'never over the owner\'s row');
  assert.deepEqual(grids.Emails.filter(line => line[0] === 'p27' && line[5] === 'approved').map(line => line[4]), ['seedlinks'], 'nor a SeedLinks fix');
  const report = grids.MemberEmailReport.slice(1).map(line => line.slice(1));
  assert.ok(report.some(line => line[0] === 'unmatched' && line[1] === 'Nobody Known'), 'the private report names who could not be matched');
  assert.ok(report.some(line => line[0] === 'ambiguous' && line[1] === 'Sam' && line[3] === 'Sam Kim, Sam Lee'));
  assert.ok(report.some(line => line[0] === 'unpaired' && line[1] === 'Kim Pair, Lee Pair'));
  assert.ok(report.some(line => line[0] === 'kept' && line[1] === 'Lu Chen'));
  const rows = emailRows();
  result = JSON.parse(JSON.stringify(context.importMemberEmails()));
  assert.equal(result.added, 0, 'running it again adds nothing');
  assert.equal(result.alreadyOnFile, 3);
  assert.equal(emailRows(), rows);
  docs['member-doc-id'] = [[['Notes'], ['not a member table']], [['First name', 'Last name', 'Email'],
    ['Gia', 'Rowe', 'gia@example.com'],
    ['Ivo & Jan', 'Bly', 'ivo@example.com, jan@example.com'],
    ['Zed', '', 'zed@example.com'],
    ['Xan', 'Doe', '']]];
  properties.MEMBER_LIST_ID = 'member-doc-id';
  result = JSON.parse(JSON.stringify(context.importMemberEmails()));
  assert.deepEqual(result, { rows: 4, added: 4, alreadyOnFile: 0, kept: 0, skipped: { 'no email': 1 } }, 'a Doc table works the same, with first and last name columns');
  assert.deepEqual(['p35', 'p36', 'p37', 'p26'].map(id => grids.Emails.find(line => line[0] === id && line[5] === 'approved')[2]),
    ['gia@example.com', 'ivo@example.com', 'jan@example.com', 'zed@example.com'], 'Ivo and Jan Bly share a last name; Zed is the only active Zed');
  assert.equal(JSON.parse(JSON.stringify(context.importMemberEmails())).added, 0);
  activeEmail = '';
  context.console.log = () => {};
}

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

// ---- The owner's setup page (/dev?setup), so the club never needs the Apps Script editor ----
{
  // The imports below change the fake Sheet; it is put back afterwards so the page checks see the calendar as before.
  const saved = structuredClone({ grids, properties, cache, sent: sent.length });
  const deskBefore = properties.DESK_SHEET_ID;
  const memberBefore = properties.MEMBER_LIST_ID;
  delete properties.MEMBER_LIST_ID;
  const longId = 'M'.repeat(44);
  activeEmail = '';
  let html = context.doGet({ parameter: { setup: '', members: longId, desk: 'D'.repeat(44) } }).getContent();
  assert.match(html, /Not available/);
  assert.doesNotMatch(html, /Sheet|import|player/i, 'a visitor learns nothing about the club');
  assert.equal(properties.MEMBER_LIST_ID, undefined, 'a visitor sets nothing');
  activeEmail = 'someone@example.com';
  assert.match(context.doGet({ parameter: { setup: '' } }).getContent(), /Not available/, 'only the owner, not another signed-in account');
  activeEmail = 'owner@example.com';
  html = context.doGet({ parameter: { setup: '', members: longId, desk: 'D'.repeat(44), seed: 'bad id!' } }).getContent();
  assert.match(html, /Set up\. Player list: \d+ active players/);
  assert.match(html, /<base target="_top">/, 'links open in the whole window, not inside Google\'s frame');
  assert.equal(properties.MEMBER_LIST_ID, longId, 'a missing property is set from the link');
  assert.equal(properties.DESK_SHEET_ID, deskBefore, 'a property already set is never overwritten from a link');
  assert.match(html, /href="https:\/\/script\.google\.com\/macros\/s\/staffing-test\/dev\?setup&amp;import=preview"/, 'the setup page offers the preview first');
  assert.doesNotMatch(html, /import=seed/, 'and no send button until the preview');
  assert.doesNotMatch(html, /@example\.com/, 'no address on the page');
  properties.MEMBER_LIST_ID = memberBefore;
  const previewSent = sent.length;
  html = context.doGet({ parameter: { setup: '', import: 'preview' } }).getContent();
  assert.match(html, /Preview: nothing has been sent or saved/);
  assert.match(html, /All skips: /);
  assert.equal(sent.length, previewSent, 'the preview page sends nothing');
  assert.match(html, /\u2022\u2022\u2022@example\.com/);
  assert.doesNotMatch(html, /[a-z0-9._-]{2,}@example\.com/, 'only masked addresses on the preview page');
  assert.match(context.doGet({ parameter: { setup: '', import: 'sample' } }).getContent(), /Sent a test copy|no test copy to send/);
  const before = sent.length;
  html = context.doGet({ parameter: { setup: '', import: 'seed' } }).getContent();
  assert.match(html, /Sent \d+ emails: \d+ new \(\d+ nights held\) and \d+ re-sent to people still waiting for a YES/);
  const keys = signupRows().map(line => cell('Signups', line, 'seed_key')).filter(Boolean);
  assert.equal(new Set(keys).size, keys.length, 'a repeat import never holds the same night twice (it only adds nights newly in the calendar)');
  html = context.doGet({ parameter: { setup: '', import: 'seed' } }).getContent();
  const again = sent.length;
  context.doGet({ parameter: { setup: '', import: 'seed' } });
  assert.equal(sent.slice(again).filter(message => /^Please confirm/.test(message.subject)).length, 0, 'running it again at once emails nobody');
  activeEmail = '';
  Object.keys(grids).forEach(name => { grids[name].length = 0; if (saved.grids[name]) grids[name].push(...saved.grids[name]); });
  Object.keys(properties).forEach(key => delete properties[key]);
  Object.assign(properties, saved.properties);
  cache = saved.cache;
  sent.length = saved.sent;
}

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
  assert.match(again.textContent, /The opener: first in at 6:40 PM, has the key lockbox/, 'each position says what it does, with this night\'s time');
  assert.doesNotMatch(again.textContent, /on Saturdays/);
  assert.deepEqual([...again.querySelectorAll('.night-cols > div > h3')].map(h3 => h3.textContent), ['Opening, 7:00 PM', 'Closing, 10:00 PM'], 'opening and closing are two columns');
  assert.ok(again.closest('.slot-area'), 'one column (no layout here, as on a phone): the night opens under its month');
  assert.ok(document.querySelector('#calendar > .slot-wide'), 'a full-width place for wide screens');
  assert.match(fs.readFileSync(__dirname + '/Code.js', 'utf8'), /first in at 6:40 PM \(2:40 PM on Saturdays\)/, 'the page swaps in each night\'s time for this exact wording');
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
  assert.equal(document.querySelector('.onfile').textContent, 'We\'ll email i\u2022\u2022\u2022@example.com to confirm. Not your address? Ask the club.');
  assert.equal(document.getElementById('email').parentNode.hidden, true, 'no email field for a player with an email on file');
  assert.equal(document.getElementById('phone'), null, 'and no phone field at all');
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
  // A player with no email on file: the email field appears, and the club is asked.
  [...document.querySelectorAll('.chosen button')][0].click();
  const search3 = document.getElementById('who');
  search3.value = 'xan';
  search3.dispatchEvent(new dom.window.Event('input'));
  await wait(350);
  [...document.querySelectorAll('.results button')].find(button => button.textContent === 'Xan Doe').click();
  assert.equal(document.getElementById('email').parentNode.hidden, false);
  assert.equal(document.getElementById('emailNote').textContent, 'We don\'t have an email for you yet. Enter it and the club will confirm it once; then we\'ll email you to confirm your shifts.');
  assert.equal(document.querySelector('.onfile').hidden, true);
  document.getElementById('email').value = 'xan@example.com';
  const clubBefore = mailTo('owner@example.com').length;
  document.querySelector('#picks form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  assert.match(document.getElementById('picks').textContent, /Sent to the club[\s\S]*the club will confirm xan@example\.com once/);
  assert.match(mailTo('owner@example.com').slice(clubBefore).pop().body, /Xan Doe wants to use xan@example\.com/);
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
