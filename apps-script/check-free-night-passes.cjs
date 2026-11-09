const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// FreeNightPasses.js: the desk copies who holds a Zeffy pass on each special night ahead to a hidden tab, for the volunteer
// app's free spots (staffing-app/Code.js zeffyPasses_). Made-up player ids only.
let today = '2026-12-20';
let grid = null;
let hidden = 0;
let writes = 0;
const logs = [];
const cache = {};
let coverage = date => (date === '2026-12-26' ? { 'p-zed': true, 'p-amy': true } : date === '2026-12-21' ? { 'p-mon': true } : {});
const sheet = () => ({
  getLastRow: () => grid.length,
  getRange: (row, column, rows, columns) => ({
    getValues: () => grid.slice(row - 1, row - 1 + rows).map(line => line.slice(column - 1, column - 1 + columns)),
    setNumberFormat() { return this; },
    setValues: values => { writes += 1; grid = values.map(line => line.slice()); }
  }),
  clearContents: () => { grid = []; },
  hideSheet: () => { hidden += 1; }
});
const context = {
  CacheService: { getScriptCache: () => ({ get: key => cache[key] || null, put: (key, value) => { cache[key] = value; } }) },
  SpreadsheetApp: { getActive: () => ({ getSheetByName: name => (name === 'FreeNightPasses' && grid ? sheet() : null), insertSheet: () => { grid = []; return sheet(); } }) },
  Utilities: { formatDate: () => today },
  Session: { getScriptTimeZone: () => 'America/Los_Angeles' },
  zeffyDaysLater_: (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10),
  zeffyPassFinder_: () => date => coverage(date),
  deskLog_: (...args) => logs.push(args),
  console: { warn: () => {} }
};
vm.createContext(context);
for (const file of ['NightFees.js', 'FreeNightPasses.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context);
const plain = value => JSON.parse(JSON.stringify(value));

assert.deepEqual(plain(context.publishFreeNightPasses_()), { changed: 2 });
assert.deepEqual(plain(grid), [['date', 'player_id'], ['2026-12-26', 'p-amy'], ['2026-12-26', 'p-zed']], 'special nights from today to the last one, pass holders by night; Monday Dec 21 is no special night');
assert.equal(hidden, 1, 'a hidden tab');
assert.match(logs[0][1], /free_night_passes_changed/);
assert.equal(context.publishFreeNightPasses_(), null, 'once an hour: a quiet run is one cache read');
assert.deepEqual(plain(context.publishFreeNightPasses_(true)), { unchanged: 2 }, 'a pass change on the desk checks at once, and writes only a change');
assert.equal(writes, 1);
coverage = () => ({ 'p-new': true });
assert.deepEqual(plain(context.publishFreeNightPasses_(true)), { changed: 2 });
assert.deepEqual(plain(grid.slice(1)), [['2026-12-25', 'p-new'], ['2026-12-26', 'p-new']], 'Fri Dec 25 and Sat Dec 26 are the special nights left after Sun Dec 20 (Dec 31 is a Thursday)');
// After the special's last night the tab is just its heading, so nobody is passed over by an old list.
today = '2027-01-02';
coverage = () => ({ 'p-zed': true });
assert.deepEqual(plain(context.publishFreeNightPasses_(true)), { changed: 0 });
assert.deepEqual(plain(grid), [['date', 'player_id']]);
// Never throws: a failure keeps the last list.
context.zeffyPassFinder_ = () => { throw new Error('Sheet busy'); };
today = '2026-12-20';
assert.deepEqual(plain(context.publishFreeNightPasses_(true)), { skipped: 'error' });
assert.deepEqual(plain(grid), [['date', 'player_id']]);
console.log('Free night pass copy checks passed');
