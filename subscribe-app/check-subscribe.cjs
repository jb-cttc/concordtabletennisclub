const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Fake addresses only: real subscriber addresses never belong in the repository.
const manifest = JSON.parse(fs.readFileSync(__dirname + '/appsscript.json', 'utf8'));
assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets']);
assert.equal(manifest.webapp.access, 'ANYONE_ANONYMOUS');
assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');

const source = fs.readFileSync(__dirname + '/Code.js', 'utf8');
const globals = [...source.matchAll(/^function ([A-Za-z0-9]+)\(/gm)].map(match => match[1]);
assert.deepEqual(globals.filter(name => !name.endsWith('_')).sort(), ['doGet', 'subscribe'],
  'a public web app exposes every non-private function: only doGet and subscribe may exist');

const rows = [];
let sheetExists = false;
let locks = 0;
let cache = {};
const sheet = {
  getLastRow: () => rows.length + 1,
  getRange: (row, column, count) => ({ getValues: () => rows.slice(row - 2, row - 2 + count).map(entry => [entry[0]]), setValues: () => ({ setFontWeight: () => {} }) }),
  appendRow: row => rows.push(row),
  setFrozenRows: () => {}
};
const context = {
  Date, Math, Number, String,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'database-id' }) },
  SpreadsheetApp: { openById: () => ({
    getSheetByName: () => sheetExists ? sheet : null,
    insertSheet: () => { sheetExists = true; return sheet; }
  }) },
  LockService: { getScriptLock: () => ({ waitLock: () => { locks += 1; }, releaseLock: () => { locks -= 1; } }) },
  CacheService: { getScriptCache: () => ({ get: key => cache[key] || null, put: (key, value) => { cache[key] = value; } }) }
};
vm.createContext(context);
vm.runInContext(source, context);

const result = value => JSON.stringify(value);
assert.equal(result(context.subscribe('  Fan@Example.com ', '')), '{"ok":true}');
assert.ok(sheetExists, 'the Subscribers tab is created when missing');
assert.equal(rows.length, 1);
assert.equal(rows[0][0], 'fan@example.com', 'stored trimmed and lowercase');
assert.equal(result(context.subscribe('FAN@example.com', '')), '{"ok":true}');
assert.equal(rows.length, 1, 'duplicates are ignored regardless of case');

for (const bad of ['', 'nobody', 'a@b', 'two words@example.com', null, undefined, 'x@example.com' + 'y'.repeat(260)]) {
  assert.equal(context.subscribe(bad, '').ok, false, 'rejected: ' + String(bad).slice(0, 20));
}
assert.equal(result(context.subscribe('bot@example.com', 'http://spam.example')), '{"ok":true}');
assert.equal(rows.length, 1, 'a filled honeypot adds nothing');
assert.equal(locks, 0, 'the lock is always released');

cache = {};
let refused = 0;
for (let index = 0; index < 30; index += 1) if (!context.subscribe('fan' + index + '@example.com', '').ok) refused += 1;
assert.equal(refused, 10, 'more than 20 sign-ups in a minute are refused');

const page = fs.readFileSync(__dirname + '/Index.html', 'utf8');
assert.doesNotMatch(page, /<script[^>]*\ssrc=|<link[^>]*rel="stylesheet"/i, 'the form loads nothing from elsewhere');
assert.match(page, /\.subscribe\(email, document\.getElementById\('website'\)\.value\)/);
assert.doesNotMatch(page, /var status\b/, 'window.status must not be shadowed');
console.log('Subscribe app checks passed');
