const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Coach Admin, the desk side (CoachAdmin.js): calls to the coaching app with the admin key, and one desk log entry for each
// mobile number the club sets (last four digits only), never for a preview or a refusal. Made-up coaches only.
const KEY = 'k'.repeat(64);
const calls = [];
let answers = [];
const audits = [];
const context = {
  JSON, Object, Array, Number, String, Error,
  UrlFetchApp: { fetch: (url, options) => {
    calls.push({ url, body: JSON.parse(options.payload) });
    const next = answers.shift();
    return { getResponseCode: () => (next === 500 ? 500 : 200), getContentText: () => JSON.stringify(next) };
  } },
  HtmlService: { createHtmlOutputFromFile: name => { assert.equal(name, 'CoachAdminPage'); const page = { setTitle: () => page, addMetaTag: () => page, setXFrameOptionsMode: () => page }; return page; }, XFrameOptionsMode: { ALLOWALL: 1 } },
  volunteerAdminKey_: () => KEY,
  appendAudit_: (action, type, id, details) => audits.push({ action, type, id, details })
};
vm.createContext(context);
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
assert.throws(() => context.getCoachAdmin(), /needs the release with Coach Admin/, 'an older coaching app says so plainly');

// The desk opens the page at ?view=coaches.
assert.match(fs.readFileSync(require('node:path').join(__dirname, 'Code.js'), 'utf8'), /view === 'coaches' \? coachAdminPage_\(\)/);
console.log('Coach Admin desk checks passed');
