'use strict';

// data/closures.json is the one list of gym closures: the home page draws its list and calendar from it, and the volunteer
// sign-up app (staffing-app/) reads it so a closed night asks for no volunteers.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'closures.json'), 'utf8'));

assert.ok(Array.isArray(data.months) && data.months.length, 'months to draw');
data.months.forEach(month => assert.match(month, /^\d{4}-(0[1-9]|1[0-2])$/));
assert.ok(Array.isArray(data.notices));
data.notices.forEach(notice => {
  assert.equal(typeof notice.when, 'string');
  assert.equal(typeof notice.text, 'string');
  assert.ok(notice.when && notice.text);
});
Object.keys(data.days).forEach(day => {
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(day + 'T12:00:00Z').toISOString().slice(0, 10), day, day + ' is a real date');
  assert.ok(['full', 'partial', 'holiday'].includes(data.days[day]), day + ': full, partial or holiday');
});

// The home page draws both from the file; nothing about closures is written into the page itself.
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(html, /<ul id="closure-list"><\/ul>/, 'the list comes from data/closures.json');
assert.doesNotMatch(html, /"20\d\d-\d\d-\d\d":\s*"(full|partial|holiday)"/, 'no closure dates in the page');
const block = /\n  \/\/ Closures come from data\/closures\.json[\s\S]*?\.catch\(function \(\) \{\}\);\n/.exec(html);
assert.ok(block, 'the closures script was found');
const body = /<body>([\s\S]*)<\/body>/.exec(html)[1].replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM('<!doctype html><body>' + body + '</body>', { runScripts: 'outside-only' });
let fetched = '';
dom.window.fetch = url => { fetched = url; return Promise.resolve({ json: () => Promise.resolve(data) }); };
dom.window.eval(block[0]);
setImmediate(() => {
  const doc = dom.window.document;
  assert.equal(fetched, 'data/closures.json');
  const items = [...doc.querySelectorAll('#closure-list li')];
  assert.equal(items.length, data.notices.length);
  assert.equal(items[0].querySelector('strong').textContent, data.notices[0].when);
  assert.equal(doc.querySelectorAll('.cal-month').length, data.months.length);
  const closed = doc.querySelectorAll('.cal-day.cal-full').length;
  const shown = Object.keys(data.days).filter(day => data.days[day] === 'full' && data.months.includes(day.slice(0, 7))).length;
  assert.equal(closed, shown, 'every closed day in the months shown is marked');
  console.log('Closures checks passed');
});
