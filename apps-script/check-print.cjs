const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const index = fs.readFileSync(__dirname + '/Index.html', 'utf8');
const html = fs.readFileSync(__dirname + '/Print.html', 'utf8');
assert.match(index, /id="print-sheets"[^>]*>Print RR Sheets<\/button>/);
assert.doesNotMatch(index, /id="print-groups"/);

const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const listeners = {};
const classes = new Set();
const node = function (tag) {
  return {
    tagName: tag,
    children: [],
    append: function (...children) { this.children.push(...children); },
    appendChild: function (child) { this.children.push(child); },
    addEventListener: function (name, handler) { this[name] = handler; },
    focus: function () {},
    setAttribute: function () {},
    className: '',
    textContent: ''
  };
};
const root = node('div');
root.replaceChildren = function (...children) { this.children = children; };
root.classList = {
  add: function (name) { classes.add(name); },
  remove: function (name) { classes.delete(name); },
  contains: function (name) { return classes.has(name); }
};
root.querySelector = function () { return this.children[0].children[0]; };
const button = node('button');
button.addEventListener = function (name, handler) { listeners[name] = handler; };
const status = node('div');
let dirty = false;
let saveResult = {};
let saveCalls = 0;
let prints = 0;
let prompts = 0;
let saveChoice = false;
let recordsAvailable = true;
let recordCalls = 0;
const context = {
  document: {
    createElement: node,
    getElementById: function (id) { return id === 'print-root' ? root : id === 'print-sheets' ? button : status; },
    body: { classList: { add: function () {}, remove: function () {} } }
  },
  confirm: function () { prompts += 1; return saveChoice; },
  window: {
    CTTCOrganizer: { sheetAdjustment: function () { return ''; } },
    cttcRequest: async function (name, ids, date) {
      assert.equal(name, 'getPlayerRecordsForPrint');
      assert.deepEqual(Array.from(ids), ['one']);
      assert.equal(date, '2026-09-23');
      recordCalls += 1;
      if (!recordsAvailable) throw new Error('Archive missing');
      return { records: { one: { clubWins: 10, clubLosses: 8, yearWins: 3, yearLosses: 1 } }, missing: 0 };
    },
    cttcDesk: {
      print: function () { return { date: '2026-09-23', groups: [{ groupNumber: 1, playerIds: ['one'] }], matches: [], player: function () { return { name: 'Test Player', currentRating: 1000 }; }, siteJson: async function () { return { players: [] }; } }; },
      needsPrintSave: function () { return dirty; },
      saveDraft: async function () { saveCalls += 1; return saveResult; }
    },
    print: function () { prints += 1; }
  }
};
vm.runInNewContext(script, context);

async function check() {
  await listeners.click();
  assert.equal(prompts, 0);
  assert.equal(classes.has('previewing'), true);
  assert.equal(root.children.length, 2);
  assert.equal(root.children[1].children[0].children[0].children[1].children[0].textContent,
    'Player [Club Rating] (Club Record) (2026 Record)');
  assert.equal(root.children[1].children[0].children[0].children[1].children[1].textContent,
    'Test Player [1000] (10/8) (3/1)');
  root.children[0].children[1].click();
  assert.equal(prints, 1);
  root.children[0].children[0].click();
  assert.equal(classes.has('previewing'), false);
  assert.equal(root.children.length, 0);

  dirty = true;
  saveChoice = false;
  await listeners.click();
  assert.equal(saveCalls, 0);
  assert.equal(classes.has('previewing'), true);
  root.children[0].children[0].click();

  saveChoice = true;
  saveResult = null;
  await listeners.click();
  assert.equal(saveCalls, 1);
  assert.equal(classes.has('previewing'), false, 'do not open preview after a failed save');
  assert.equal(prints, 1, 'do not print after a failed save');

  saveResult = { revision: 2 };
  await listeners.click();
  assert.equal(saveCalls, 2);
  assert.equal(classes.has('previewing'), true);
  assert.equal(prompts, 3);
  root.children[0].children[0].click();
  recordsAvailable = false;
  await listeners.click();
  assert.equal(classes.has('previewing'), false, 'failed archive reads never open preview');
  assert.match(status.textContent, /RR records unavailable: Archive missing/);
  assert.equal(recordCalls, 4);
  console.log('RR sheet print checks passed');
}

check().catch(function (error) { console.error(error); process.exitCode = 1; });