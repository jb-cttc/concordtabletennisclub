const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Coach Admin, the desk side (CoachAdmin.js): calls to the coaching app with the admin key, and one desk log entry for each
// mobile number the club sets (last four digits only), never for a preview or a refusal. Made-up coaches only.
const KEY = 'k'.repeat(64);
const calls = [];
let answers = [];
const audits = [];
// The club site's coach file (data/coach-certifications.json) and the desk's CoachList tab, made up.
let coachFile = { source: 'https://coaches.usatt.org/', showWhilePending: [], coaches: {
  'Ann Coach': { status: 'USATT Certification Active', level: 'Coaching Level 1' },
  'Bo Coach': { status: 'USATT Certification Pending', level: null, hidden: true, contact: 'bo@example.com' },
  'Cy Coach': { status: 'USATT Certification Pending', level: null } } };
let siteDown = false;
let coachListTab = [['shown_coach'], ['Ann Coach']];
const siteReads = [];
const dispatches = [];
let githubCode = 204;
const properties = {};
let cache = {};
let clock = Date.parse('2026-11-23T20:00:00Z');
const context = {
  JSON, Object, Array, Number, String, Error,
  Date: class extends Date { static now() { return clock; } },
  UrlFetchApp: { fetch: (url, options) => {
    if (url.startsWith('https://concordtabletennisclub.com/data/coach-certifications.json')) {
      siteReads.push(url);
      return { getResponseCode: () => (siteDown ? 503 : 200), getContentText: () => JSON.stringify(coachFile) };
    }
    if (url.startsWith('https://api.github.com/')) {
      dispatches.push({ url, body: JSON.parse(options.payload) });
      return { getResponseCode: () => githubCode, getContentText: () => '' };
    }
    calls.push({ url, body: JSON.parse(options.payload) });
    const next = answers.shift();
    return { getResponseCode: () => (next === 500 ? 500 : 200), getContentText: () => JSON.stringify(next) };
  } },
  CacheService: { getScriptCache: () => ({ get: key => cache[key] || null, put: (key, value) => { cache[key] = String(value); }, remove: key => { delete cache[key]; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = String(value); } }) },
  Utilities: { formatDate: (date, zone, format) => { assert.equal(zone, 'America/Los_Angeles'); return 'Mon 12:00 PM'; } },
  SpreadsheetApp: { getActive: () => ({ getSheetByName: name => name !== 'CoachList' ? null : {
    getLastRow: () => coachListTab.length,
    getRange: (row, column, rows) => ({ getValues: () => coachListTab.slice(row - 1, row - 1 + rows).map(line => line.slice()),
      setNumberFormat() { return this; }, setValues: values => { coachListTab = Array.from(values, line => Array.from(line)); } }),
    clearContents: () => { coachListTab = []; } }, insertSheet: () => { throw new Error('the tab exists'); } }) },
  githubToken_: () => 'token',
  githubHeaders_: token => ({ Authorization: 'Bearer ' + token }),
  workflowUrl_: () => 'https://api.github.com/repos/jb-cttc/concordtabletennisclub/actions/workflows/update-data.yml',
  githubErrorMessage_: code => 'GitHub returned HTTP ' + code + '.',
  deskLog_: () => {},
  console,
  HtmlService: { createHtmlOutputFromFile: name => { assert.equal(name, 'CoachAdminPage'); const page = { setTitle: () => page, addMetaTag: () => page, setXFrameOptionsMode: () => page }; return page; }, XFrameOptionsMode: { ALLOWALL: 1 } },
  volunteerAdminKey_: () => KEY,
  appendAudit_: (action, type, id, details) => audits.push({ action, type, id, details })
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, 'CoachList.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, 'CoachAdmin.js'), 'utf8'), context);
const ID = 'abcdef0123456789';

assert.ok(context.coachAdminPage_());
answers = [{ ok: true, textNumber: '(925) 238-3505', coaches: [] }];
assert.equal(context.getCoachAdmin().ok, true);
assert.deepEqual(calls.pop().body, { fn: 'admin', key: KEY, action: 'coaches' }, 'the admin key, as Volunteer Admin sends it');
assert.match(String(context.COACH_ADMIN_URL_), /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/, 'the coaching app\'s released address');
assert.equal(context.COACH_ADMIN_URL_, /var API_URL = '([^']+)'/.exec(fs.readFileSync(require('node:path').join(__dirname, '..', 'coaching-app', 'Index.html'), 'utf8'))[1],
  'the same address the coaching page calls');

// A preview changes nothing and logs nothing; Confirm sends the same number and logs who, the coach, and last four digits.
const seen = { ok: true, preview: true, name: 'Gus Coach', before: '(925) 555-0171', after: '(925) 555-0177', effect: '...' };
answers = [seen];
assert.deepEqual(context.previewCoachPhone(ID, ' 925.555.0177 '), seen);
assert.deepEqual(calls.pop().body, { fn: 'admin', key: KEY, action: 'phone', coachId: ID, phone: '925.555.0177', preview: true });
assert.equal(audits.length, 0, 'a preview is not logged');
answers = [Object.assign({}, seen, { preview: undefined })];
assert.equal(context.setCoachPhone(ID, '925.555.0177').ok, true);
assert.equal(calls.pop().body.preview, false);
assert.deepEqual(JSON.parse(JSON.stringify(audits)), [{ action: 'coach_phone_set', type: 'coaching', id: ID, details: { coach: 'Gus Coach', before: '…0171', after: '…0177' } }],
  'logged once: the coach and the last four digits, never the whole number');
answers = [{ ok: true, name: 'Gus Coach', before: '(925) 555-0177', after: '' }];
context.setCoachPhone(ID, '');
assert.equal(audits.pop().details.after, 'none', 'a removed number');

// The coaching app's refusals come back as they are, and are not logged.
answers = [{ ok: false, message: 'That number is already on file for Coach Ann.' }];
assert.equal(context.setCoachPhone(ID, '9255550101').message, 'That number is already on file for Coach Ann.');
assert.equal(audits.length, 1);
assert.throws(() => context.setCoachPhone('not-an-id', '9255550101'), /not found/, 'only a coach id goes to the app');
assert.throws(() => context.setCoachPhone(ID, '9'.repeat(41)), /not a phone number/);
answers = [500];
assert.throws(() => context.getCoachAdmin(), /did not answer/);
answers = [{ ok: false, message: 'Unknown request.' }];
assert.throws(() => context.getCoachAdmin(), /needs its latest release/, 'an older coaching app says so plainly');

// The control center: its data, and each control previewed (not logged) then done (logged once, with the booking code).
answers = [{ ok: true, lessons: [], proposals: [] }];
assert.equal(context.getCoachingOverview().ok, true);
assert.deepEqual(calls.pop().body, { fn: 'admin', key: KEY, action: 'overview' });
const LESSON = '0123456789abcdef';
answers = [{ ok: true, preview: true, title: 'Accept for Coach Gus', effect: '...' }];
assert.equal(context.previewCoachingAction('accept', LESSON).preview, true);
assert.deepEqual(calls.pop().body, { fn: 'admin', key: KEY, action: 'act', kind: 'accept', id: LESSON, preview: true });
assert.equal(audits.length, 1, 'a preview is not logged');
answers = [{ ok: true, message: 'Accepted for Coach Gus: ...', record: { booking: '3F09A1', coach: 'Coach Gus' } }];
context.runCoachingAction('accept', LESSON);
assert.equal(calls.pop().body.preview, false);
assert.deepEqual(JSON.parse(JSON.stringify(audits.pop())), { action: 'coaching_accept', type: 'coaching', id: LESSON, details: { about: 'lesson', booking: '3F09A1', coach: 'Coach Gus' } },
  'who and when come with the entry; what it was about is the booking code and coach');
answers = [{ ok: true, message: 'Done: the sweep ran.' }];
context.runCoachingAction('sweep', 'ignored');
assert.equal(calls.pop().body.id, '', 'an app-wide control carries no id');
assert.equal(audits.pop().action, 'coaching_sweep');
answers = [{ ok: false, message: 'That booking is confirmed now, so it cannot be accepted. Reload the page.' }];
assert.equal(context.runCoachingAction('accept', LESSON).ok, false);
assert.equal(audits.length, 1, 'a refusal is not logged');
assert.throws(() => context.runCoachingAction('force-status', LESSON), /not known/, 'only the controls the coaching app knows');
assert.throws(() => context.runCoachingAction('accept', 'x'), /not found/);
const known = /var ADMIN_ACTIONS = \{([\s\S]*?)\};/.exec(fs.readFileSync(require('node:path').join(__dirname, '..', 'coaching-app', 'Code.js'), 'utf8'))[1];
const coachingKinds = [...known.matchAll(/'?([a-z-]+)'?: \{ about: '([a-z]+)' \}/g)].map(match => match[1] + ':' + match[2]).sort();
assert.deepEqual(Object.entries(context.COACHING_ACTIONS_).map(entry => entry.join(':')).sort(), coachingKinds, 'the same controls on both sides');

// The desk opens the page at ?view=coaches.
assert.match(fs.readFileSync(require('node:path').join(__dirname, 'Code.js'), 'utf8'), /view === 'coaches' \? coachAdminPage_\(\)/);

// ---- Who is offered, and why: USATT status from the site's coach file, and the controls that fit ----
const A = 'a'.repeat(16);
const B = 'b'.repeat(16);
const C = 'c'.repeat(16);
const D = 'd'.repeat(16);
const E = 'e'.repeat(16);
const roster = () => ({ ok: true, textNumber: '(925) 238-3505', coaches: [
  { id: A, name: 'Ann Coach', active: true, club: true },
  { id: B, name: 'Bo Coach', active: false, club: true },
  { id: C, name: 'Cy Coach', active: true, club: true },
  { id: D, name: 'Di Gone', active: false, club: false },
  { id: E, name: 'Ed Unlisted', active: false, club: true }] });
coachFile.showWhilePending = ['Cy Coach'];
coachListTab = [['shown_coach'], ['Ann Coach'], ['Cy Coach']];
const offers = () => { cache = {}; answers = [roster()]; const view = JSON.parse(JSON.stringify(context.getCoachAdmin())); return Object.fromEntries(view.coaches.map(coach => [coach.name, coach.offer])); };
let offered = offers();
assert.deepEqual([offered['Ann Coach'].status, offered['Ann Coach'].level, offered['Ann Coach'].certified, offered['Ann Coach'].actions], ['USATT Certification Active', 'Coaching Level 1', true, []]);
assert.match(offered['Bo Coach'].reason, /^USATT certification pending/);
assert.deepEqual(offered['Bo Coach'].actions, ['offer'], 'a Pending coach can be made a club exception');
assert.deepEqual([offered['Cy Coach'].exception, offered['Cy Coach'].actions], [true, ['end']], 'an exception can be ended');
assert.match(offered['Di Gone'].reason, /Not on the club's coach list .* reviewed pull request/);
assert.deepEqual(offered['Di Gone'].actions, [], 'only a pull request brings back a coach taken off the list');
assert.match(offered['Ed Unlisted'].reason, /not in the coaching page's coach table/);
assert.ok(siteReads.every(url => /^https:\/\/concordtabletennisclub\.com\/data\/coach-certifications\.json\?at=\d+$/.test(url)), 'read past the site cache');
siteDown = true;
cache = {};
answers = [roster()];
const down = context.getCoachAdmin();
assert.equal(down.coaches.length, 5, 'the coaches still come');
assert.match(down.usatt.message, /could not be read from the club site/);
siteDown = false;

// Offer Bo while pending: Review starts nothing; Confirm starts the data update with his name, once, and is logged.
const before = audits.length;
answers = [roster()];
const asked = context.previewCoachOffer('offer', B);
assert.deepEqual([asked.ok, asked.preview, asked.title], [true, true, 'Offer Bo Coach while USATT certification is pending']);
assert.match(asked.effect, /club exception.*GitHub records the change as a commit/);
assert.equal(dispatches.length, 0, 'a preview starts nothing');
assert.equal(audits.length, before, 'nor is logged');
answers = [roster()];
assert.equal(context.setCoachOffer('offer', B).ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(dispatches.pop().body)), { ref: 'main', inputs: { coach_exception: 'offer:Bo Coach' } });
assert.deepEqual(JSON.parse(JSON.stringify(audits.pop())), { action: 'coach_exception_requested', type: 'coaching', id: B, details: { coach: 'Bo Coach' } });
// Until the page shows it, his card says it was asked, and nothing else can be started (GitHub keeps one waiting run).
offered = offers();
assert.match(offered['Bo Coach'].request.text, /Asked to offer them at .*GitHub is updating the coaching page/);
assert.deepEqual(offered['Bo Coach'].actions, []);
answers = [roster()];
assert.match(context.setCoachOffer('end', C).message, /The change for Bo Coach asked at .* is still running/);
assert.match(context.previewCoachOffer('recheck', '').message, /still running/);
// The data update shows him: the coaching app has not caught up, so Sync now.
coachFile.showWhilePending = ['Cy Coach', 'Bo Coach'];
delete coachFile.coaches['Bo Coach'].hidden;
offered = offers();
assert.equal(offered['Bo Coach'].request, null);
assert.match(offered['Bo Coach'].reason, /coaching app has not caught up yet/);
assert.deepEqual(offered['Bo Coach'].actions, ['sync']);
answers = [roster(), { ok: true, message: 'Done: the sweep ran.' }];
cache['coach-list-checked'] = '1';
assert.equal(context.setCoachOffer('sync', B).ok, true);
assert.deepEqual(coachListTab.map(line => String(line[0])), ['shown_coach', 'Ann Coach', 'Bo Coach', 'Cy Coach'], 'the list copied now, in page order, despite the hourly wait');
assert.deepEqual(calls.pop().body, { fn: 'admin', key: KEY, action: 'act', kind: 'sweep', id: '' }, 'then the coaching app follows it');
assert.equal(audits.pop().action, 'coach_list_synced');
// A control that does not fit is refused with the reason.
answers = [roster()];
assert.match(context.setCoachOffer('offer', A).message, /not needed for Ann Coach/);
answers = [roster()];
assert.match(context.setCoachOffer('offer', D).message, /not needed for Di Gone now\. Not on the club's coach list/);
// A request GitHub skipped can be asked again after half an hour.
clock += 11 * 60000;
answers = [roster()];
assert.equal(context.setCoachOffer('end', C).ok, true);
assert.deepEqual(dispatches.pop().body.inputs, { coach_exception: 'end:Cy Coach' });
clock += 31 * 60000;
offered = offers();
assert.ok(offered['Cy Coach'].request.stale, 'still not shown after 30 minutes');
assert.match(offered['Cy Coach'].request.text, /GitHub most likely skipped that run\. Ask again\./);
assert.deepEqual(offered['Cy Coach'].actions, ['end']);
// Re-check USATT: the data update with no exception.
answers = [];
assert.equal(context.setCoachOffer('recheck', '').ok, true);
assert.deepEqual(dispatches.pop().body, { ref: 'main', inputs: {} });
assert.equal(audits.pop().action, 'usatt_recheck_requested');
clock += 11 * 60000;
githubCode = 403;
answers = [roster()];
assert.throws(() => context.setCoachOffer('end', C), /GitHub returned HTTP 403/, 'a GitHub refusal is shown, and nothing is recorded');
assert.throws(() => context.setCoachOffer('promote', B), /not known/);
assert.throws(() => context.setCoachOffer('offer', 'x'), /not found/);
console.log('Coach Admin desk checks passed');
