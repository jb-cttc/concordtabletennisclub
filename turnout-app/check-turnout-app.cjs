const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// The public turnout app against a fake Google: the desk Sheet, forwarded Voice texts, the cache and the site's files.
// Synthetic people only (made-up names and 555 numbers).
const manifest = JSON.parse(fs.readFileSync(__dirname + '/appsscript.json', 'utf8'));
assert.deepEqual(manifest.oauthScopes, [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://mail.google.com/',
  // Only to read the site's session-roster.json and closures.json.
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/userinfo.email'
]);
assert.equal(manifest.webapp.access, 'ANYONE_ANONYMOUS');
assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING', 'visitors never need Google access: the app acts as the owner');
assert.equal(manifest.timeZone, 'America/Los_Angeles');
assert.equal(fs.readFileSync(__dirname + '/.claspignore', 'utf8').trim(), 'check-*', 'the test is never pushed to Google');

const source = fs.readFileSync(__dirname + '/Code.js', 'utf8');
const globals = [...source.matchAll(/^function ([A-Za-z0-9_]+)\(/gm)].map(match => match[1]);
assert.deepEqual(globals.filter(name => !name.endsWith('_')).sort(), ['doGet', 'setup', 'turnout'], 'a public web app exposes every non-private function: only these may exist');
assert.doesNotMatch(source, /=>|`|^\s*(let|const|class)\s/m, 'Code.js is ES5 style, like the other Apps Script projects');
// The one write is the log (log_ appends to LOG_TAB in the desk Sheet); nothing else in the app writes, replies or sends.
const logWriter = /\nfunction log_\([\s\S]*?\n}\n/.exec(source)[0];
assert.doesNotMatch(source.replace(logWriter, ''), /HtmlService|getActiveSpreadsheet|\.setValue|\.appendRow|insertSheet|\.reply\(|sendEmail|deleteRow/, 'it only reads: no page, no writes, no replies');
assert.match(logWriter, /getSheetByName\(LOG_TAB\)/);
assert.match(source, /var LOG_TAB = 'CTTC Turnout Logs';/);

// ---- Fakes ----
let clock = Date.parse('2026-10-26T17:00:00Z'); // Monday October 26, 2026, 10:00 AM Pacific
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
const pacific = ms => new Date(ms - 7 * 3600000); // PDT, for the October dates used here
const pad = n => String(n).padStart(2, '0');
const Utilities = {
  formatDate(date, zone, pattern) {
    const d = zone === 'UTC' ? new Date(date.getTime()) : pacific(date.getTime());
    return pattern.replace('yyyy', d.getUTCFullYear()).replace('MM', pad(d.getUTCMonth() + 1)).replace('dd', pad(d.getUTCDate()))
      .replace(/^H$/, String(d.getUTCHours())).replace(/^m$/, String(d.getUTCMinutes()));
  },
  DigestAlgorithm: { SHA_256: 'sha256' },
  computeDigest: (algorithm, value) => Array.from(require('node:crypto').createHash(algorithm).update(String(value)).digest()).map(byte => (byte > 127 ? byte - 256 : byte))
};

const tabs = {
  Players: [['player_id', 'display_name', 'current_rating', 'active', 'created_at', 'updated_at'],
    ['p-ada', 'Ada Every', 1250, true, '', ''],
    ['p-bo', 'Bo Mondays', 640, true, '', ''],
    ['p-cy', 'Cy Desk', 1080, true, '', ''],
    ['p-dee', 'Dee Texter', 1710, true, '', ''],
    ['p-eli1', 'Eli Twin', 900, true, '', ''],
    ['p-eli2', 'Eli Twin', 1300, false, '', ''],
    ['p-fay', 'Fay Alias-Name', 980, true, '', ''],
    ['p-gus', 'Gus Unrated', '', true, '', '']],
  Aliases: [['alias', 'player_id', 'created_at'], ['Faye A', 'p-fay', '']],
  Sessions: [['session_id', 'session_date', 'status', 'revision', 'created_at', 'updated_at', 'finalized_at'],
    ['s-old', new FakeDate('2026-10-21T19:00:00Z'), 'finalized', 3, '', '', ''],
    ['s-now', new FakeDate('2026-10-26T19:00:00Z'), 'draft', 1, '', '', '']],
  SessionPlayers: [['session_id', 'player_id', 'group_number', 'starting_rating', 'promotion_from_group'],
    ['s-old', 'p-bo', 1, 640, ''],
    ['s-now', 'p-cy', 1, 1080, ''],
    ['s-now', 'p-ada', 1, 1240, '']]
};
const opened = [];
const SpreadsheetApp = {
  openById(id) {
    opened.push(id);
    const sheet = name => ({
      getDataRange: () => ({ getValues: () => tabs[name].map(row => row.slice()) }),
      getLastRow: () => tabs[name].length,
      appendRow: row => { tabs[name].push(row); },
      deleteRows: (start, count) => { tabs[name].splice(start - 1, count); },
      getRange: () => ({ setValues: values => { tabs[name][0] = values[0]; return { setFontWeight() {} }; } }),
      setFrozenRows() {}
    });
    return {
      getSheetByName: name => tabs[name] ? sheet(name) : null,
      insertSheet: name => { tabs[name] = [[]]; return sheet(name); }
    };
  }
};

let messages = [];
let searches = [];
const text = (sender, body, at, from = 'x@txt.voice.google.com') => ({
  getId: () => sender + at,
  getFrom: () => '"' + sender + '" <' + from + '>',
  getSubject: () => 'New text message from ' + sender,
  getPlainBody: () => body + '\n\nTo respond to this text message, reply to this email or visit Google Voice.\nYOUR ACCOUNT',
  getDate: () => new FakeDate(at)
});
const GmailApp = {
  search(query, start, max) {
    searches.push(query);
    return [{ getMessages: () => messages }];
  }
};

let cache = {};
const CacheService = {
  getScriptCache: () => ({
    get: key => cache[key] === undefined ? null : cache[key],
    getAll: keys => Object.fromEntries(keys.filter(key => cache[key] !== undefined).map(key => [key, cache[key]])),
    put: (key, value) => { cache[key] = value; },
    putAll: values => Object.assign(cache, values),
    remove: key => { delete cache[key]; }
  })
};

const mondays = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
const siteRoster = {};
// A usual Monday is 20: these three plus 17 others the desk doesn't know, so 20 is the forecast total.
const others = Array.from({ length: 17 }, (_, i) => 'Other Player ' + i);
mondays.forEach(d => { siteRoster[d] = ['Ada Every', 'Bo Mondays', 'Hal Unknown'].concat(others); });
mondays.map(d => new Date(Date.parse(d) + 2 * 86400000).toISOString().slice(0, 10)).forEach(d => { siteRoster[d] = ['Ada Every', 'Hal Unknown']; });
// Big enough to need more than one cache part.
siteRoster['2024-01-01'] = Array.from({ length: 4000 }, (_, i) => 'Long Ago Player ' + i);
const fetched = [];
let siteDown = false;
const UrlFetchApp = {
  fetch(url) {
    fetched.push(url);
    const body = url.endsWith('/data/session-roster.json') ? siteRoster : url.endsWith('/data/closures.json') ? { days: {} } : null;
    return { getResponseCode: () => (siteDown || !body ? 503 : 200), getContentText: () => JSON.stringify(body) };
  }
};
let properties = { DESK_SHEET_ID: 'desk-sheet' };
const context = {
  Date: FakeDate, JSON, Math, Object, Array, String, Number, RegExp, Error, isFinite, console: { error() {}, warn() {}, log() {} },
  Utilities, SpreadsheetApp, GmailApp, CacheService, UrlFetchApp,
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || null }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: body => ({ body, setMimeType() { return this; } }) },
  Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => 'club@example.com' }) }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/Turnout.js', 'utf8'), context);
vm.runInContext(source, context);
// Answers cross from the script's realm as JSON, the way the page receives them.
const call = (name, ...args) => JSON.parse(JSON.stringify(context[name](...args)));

const at = (time) => Date.parse('2026-10-26T' + time + ':00Z') + 7 * 3600000; // Pacific wall clock on October 26
messages = [
  text('Dee Texter', 'Coming tonight!', at('09:30')),
  text('Cy Desk', 'See you at 7', at('08:00')),
  text('Faye A', 'in', at('09:00')),
  text('Eli Twin', 'Running late, save me a spot', at('09:10')),
  text('Ivy Nobody', 'Coming', at('09:15')),
  text('(925) 555-0142', 'Is there RR tonight? I will come', at('09:20')),
  text('Jo Changed', 'Coming tonight', at('08:00')),
  text('Jo Changed', 'Sorry, can\'t make it after all', at('09:40')),
  text('Kim Student', 'STUDENT Mon 5pm', at('09:00')),
  text('Pat Asks', 'What time does the round robin start?', at('09:05')),
  text('Quinn Asks', 'Can I come tonight?', at('09:06')),
  text('Lou Staff', 'STAFF', at('09:00')),
  text('Mo Yesterday', 'Coming', Date.parse('2026-10-25T20:00:00Z')),
  text('Not Voice', 'Coming', at('09:00'), 'someone@example.com')
];

const answer = call('turnout');
assert.equal(answer.ok, true);
assert.equal(answer.date, '2026-10-26');
assert.equal(answer.phase, 'signup');
assert.equal(answer.today, true);
assert.equal(answer.updatedAt, clock);
const zone = label => answer.brackets.find(b => b.label === label);
assert.deepEqual(zone('1200–1399'), { label: '1200–1399', min: 1200, max: 1400, here: 1, texted: 0, likely: 0, expected: 1 }, 'Ada signed in at her starting rating; signed in beats likely');
assert.equal(zone('1000–1199').here, 1, 'Cy signed in and also texted: counted once, as here');
assert.equal(zone('1000–1199').texted, 0);
assert.equal(zone('1600+').texted, 1, 'Dee texted');
assert.equal(zone('800–999').texted, 1, 'Fay texted under her alias');
assert.equal(zone('600–799').likely, 0, 'Bo comes Mondays only: probable, not likely');
assert.equal(zone('600–799').expected, 1, 'but Bo is in the forecast');
assert.deepEqual(answer.unrated, { here: 0, texted: 3, expected: 3 }, 'two Eli Twins, Ivy (no player) and a number with no contact name');
assert.equal(answer.brackets.reduce((sum, b) => sum + b.here + b.texted, 0), 4);

const said = JSON.stringify(answer);
['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Ivy', 'Jo', 'Hal', 'Pat', 'Quinn', '555', '0142', 'p-', 'tonight', 'Coming'].forEach(word => {
  assert.ok(!said.includes(word), 'the public answer never carries a name, number, id or text: ' + word);
});
assert.equal(opened[0], 'desk-sheet');
assert.match(searches[0], /^in:anywhere from:txt\.voice\.google\.com after:2026\/10\/25 before:2026\/10\/28$/);
assert.deepEqual(fetched, ['https://concordtabletennisclub.com/data/closures.json', 'https://concordtabletennisclub.com/data/session-roster.json']);
assert.ok(Object.keys(cache).filter(key => key.startsWith('site:/data/session-roster.json:')).length >= 2, 'the roster is cached in parts');

// CTTC Turnout Logs: one row per text counted or left out, and one for the counts, with codes in place of people.
const LOG = 'CTTC Turnout Logs';
const logRows = () => tabs[LOG].slice(1).map(row => row.map(value => String(value).replace(/^'/, '')));
const rowsOf = what => logRows().filter(row => row[2] === what);
assert.deepEqual(JSON.parse(JSON.stringify(tabs[LOG][0])), ['at', 'level', 'what', 'session', 'ref', 'detail'], 'the desk log\'s columns');
assert.deepEqual(rowsOf('text_counted').map(row => row[5]).sort(), [
  'front desk: contact name is not exactly one player', 'front desk: contact name is not exactly one player',
  'front desk: no contact name', 'zone=1000–1199', 'zone=1600+', 'zone=800–999'
], 'Eli Twin and Ivy, the number, Cy, Dee and Faye A');
assert.deepEqual(rowsOf('text_skipped').map(row => row[5]).sort(), [
  'latest text only asks a question', 'latest text only asks a question', 'latest text says not coming',
  'only commands for the coaching or volunteer apps', 'only commands for the coaching or volunteer apps'
], 'Pat and Quinn ask, Jo cannot make it, Kim and Lou only sent commands');
assert.deepEqual(rowsOf('turnout_counts').map(row => row[5]), ['phase=signup playing=7 here=2 texted=5 likely=0 expected=' + answer.brackets.reduce((sum, b) => sum + b.expected, 3)]);
logRows().forEach(row => {
  assert.equal(row[1], 'step');
  if (/^text_/.test(row[2])) assert.match(row[4], /^S[0-9A-F]{6}$/, 'a texter is a code');
  if (/^text_/.test(row[2]) || row[2] === 'turnout_counts') assert.equal(row[3], '2026-10-26');
});
const logText = JSON.stringify(tabs[LOG]);
['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Ivy', 'Jo', 'Kim', 'Lou', 'Pat', 'Quinn', '555', '0142', 'p-', 'Coming', 'STUDENT', 'STAFF'].forEach(word => {
  assert.ok(!logText.includes(word), 'the log never holds a name, number, id or text: ' + word);
});
assert.equal(new Set(rowsOf('text_counted').concat(rowsOf('text_skipped')).map(row => row[4])).size, 11, 'one code per sender');
const firstLog = logRows().length;

// The same minute is served from the cache: no Sheet, no Gmail.
const before = { opened: opened.length, searches: searches.length };
assert.deepEqual(call('turnout'), answer);
assert.deepEqual({ opened: opened.length, searches: searches.length }, before);
const served = JSON.parse(context.doGet().body);
assert.deepEqual(served, answer, 'doGet answers the same as turnout');

// A minute later the answer is worked out again, but the site's files come from the cache.
delete cache.turnout;
const fetchedBefore = fetched.length;
tabs.SessionPlayers.push(['s-now', 'p-dee', 2, 1710, '']);
const next = call('turnout');
assert.equal(fetched.length, fetchedBefore, 'site files are cached for an hour');
assert.equal(next.brackets[6].here, 1, 'Dee is now signed in');
assert.equal(next.brackets[6].texted, 0);
assert.equal(logRows().length, firstLog + 1, 'a minute later only the changed counts are logged: no text is logged twice');
assert.match(rowsOf('turnout_counts')[1][5], /playing=7 here=3 texted=4/);
call('turnout');
delete cache.turnout;
call('turnout');
assert.equal(logRows().length, firstLog + 1, 'nothing changed, nothing logged');

// After 7:15 PM: no forecast, only who is playing.
cache = {};
clock = at('19:20');
const late = call('turnout');
assert.equal(late.phase, 'underway');
assert.equal(late.brackets.reduce((sum, b) => sum + b.likely, 0), 0);
assert.equal(late.brackets[1].expected, 0, 'Bo did not come');
assert.equal(late.brackets[4].expected, 1, 'expected is who is playing');

// On Friday it is about Monday: no texts or desk yet, only the forecast.
cache = {};
clock = Date.parse('2026-10-23T17:00:00Z');
searches = [];
const friday = call('turnout');
assert.equal(friday.date, '2026-10-26');
assert.equal(friday.phase, 'ahead');
assert.equal(friday.today, false);
assert.equal(searches.length, 0, 'texts are only read on the night itself');
assert.equal(friday.brackets[4].here, 1, 'a session already started for Monday still counts: Ada is on it');
assert.equal(friday.brackets[4].likely, 0, 'so she is not also likely');
assert.equal(friday.brackets[1].expected, 1, 'Bo is in the forecast');

// Trouble: a short public message, and nothing cached.
cache = {};
siteDown = true;
assert.deepEqual(call('turnout'), { ok: false, error: 'Live turnout is not available right now.' });
assert.equal(cache.turnout, undefined);
assert.deepEqual(rowsOf('turnout_failed').map(row => [row[1], row[5]]), [['error', 'The site answered 503 for /data/closures.json']], 'a failure is logged as an error');
call('turnout');
assert.equal(rowsOf('turnout_failed').length, 1, 'the same failure is logged once in ten minutes, however often the page asks');
siteDown = false;
properties = {};
assert.equal(call('turnout').ok, false, 'no desk Sheet set');
properties = { DESK_SHEET_ID: 'desk-sheet' };

// setup only works for the owner in the editor.
assert.match(call('setup'), /signed in as the owner/);
context.Session.getActiveUser = () => ({ getEmail: () => 'club@example.com' });
const logged = [];
context.console.log = line => logged.push(line);
assert.match(call('setup'), /^Ready: 8 players in the desk Sheet, \d+ published nights\.$/);
assert.match(rowsOf('turnout_setup')[0][5], /^players=8 nights=\d+$/);
assert.deepEqual(logged.map(line => /^Ready: /.test(line)), [true], 'the editor shows the result: Run displays only the log');

console.log('Turnout app checks passed');
