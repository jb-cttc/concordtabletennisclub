'use strict';

// Apps Script refuses a push when two files share a name, whatever their type: Code.js and Code.html cannot both
// exist. clasp pushes this folder's .js, .gs and .html files except those in .claspignore; their names (without the
// extension) must all differ, or the push to Google fails.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ignored = new Set(fs.readFileSync(path.join(__dirname, '.claspignore'), 'utf8').split('\n').map(line => line.trim()).filter(Boolean));
const pushed = fs.readdirSync(__dirname).filter(name => /\.(js|gs|html)$/.test(name) && !ignored.has(name));
const byName = {};
pushed.forEach(file => {
  const name = file.replace(/\.(js|gs|html)$/, '');
  (byName[name] = byName[name] || []).push(file);
});
const clashes = Object.values(byName).filter(files => files.length > 1);
assert.deepEqual(clashes, [], 'Apps Script needs every file name to differ: ' + clashes.map(files => files.join(' and ')).join(', '));
assert.ok(pushed.includes('Code.js') && pushed.includes('Index.html'), 'the check sees the desk files');
console.log('Desk file name checks passed: ' + pushed.length + ' files, every name different');
