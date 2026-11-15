'use strict';

// The Email list (?view=subscribers): the club account's read-only view of the Subscribers tab, for the executive
// committee's hand-sent updates. It must never write to the tab, must give Gmail a clean Bcc list, and opens only
// through the owner-only desk.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const root = path.join(__dirname, '..');

// ----- The server: one read of the Subscribers tab, nothing written, a desk log line with the count only -----
const values = [
  ['Ann@Example.com ', new Date('2026-10-02T17:00:00Z')],
  ['', ''],
  ['not an address', new Date('2026-10-03T17:00:00Z')],
  ['ann@example.com', new Date('2026-10-04T17:00:00Z')],
  ['=HYPERLINK("x")', ''],
  ['bo@example.org', '2026-11-01 09:00:00']
];
const audits = [];
const writes = [];
const range = { getValues: () => values.map(row => row.slice()), setValues: () => writes.push('setValues'), setValue: () => writes.push('setValue'), clear: () => writes.push('clear') };
const sheet = { getLastRow: () => values.length + 1, getRange: (row, col, rows, cols) => { assert.deepEqual([row, col, rows, cols], [2, 1, values.length, 2]); return range; },
  appendRow: () => writes.push('appendRow'), deleteRow: () => writes.push('deleteRow') };
let tab = sheet;
const context = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: name => (name === 'Subscribers' ? tab : null) }) },
  Session: { getScriptTimeZone: () => 'America/Los_Angeles' },
  Utilities: { formatDate: (date, zone, pattern) => { assert.equal(pattern, 'yyyy-MM-dd'); return new Date(date.getTime() - 7 * 3600000).toISOString().slice(0, 10); } },
  HtmlService: { createHtmlOutputFromFile: name => { const out = { name }; ['setTitle', 'addMetaTag', 'setXFrameOptionsMode'].forEach(m => { out[m] = () => out; }); return out; },
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' } },
  appendAudit_: (action, type, id, details) => audits.push({ action, type, id, details }),
  guardDesk_: (name, work) => work(),
  deskMode_: () => 'dev'
};
vm.createContext(context);
vm.runInContext(read('EmailList.js'), context);

const result = context.getEmailList();
assert.equal(result.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(result.addresses)), [
  { email: 'ann@example.com', added: '2026-10-02' },
  { email: 'bo@example.org', added: '2026-11-01' }
], 'lower-cased, trimmed, first sign-up kept, blanks, repeats and non-addresses left out');
assert.equal(result.unsubscribeUrl, 'https://concordtabletennisclub.com/unsubscribe.html');
assert.equal(result.dailyLimit, 500);
assert.deepEqual(writes, [], 'reading the list never writes to the Sheet');
assert.deepEqual(JSON.parse(JSON.stringify(audits)), [{ action: 'email_list_opened', type: 'database', id: 'Subscribers', details: { count: 2 } }],
  'the desk log records the opening and the count, never an address');
tab = null;
assert.equal(context.getEmailList().addresses.length, 0, 'no Subscribers tab yet: an empty list, and no tab is made');
assert.equal(context.emailListPage_().name, 'EmailListPage');

// ----- Routing: only through the owner-only desk -----
assert.match(read('Code.js'), /view === 'subscribers' \? emailListPage_\(\)/, '?view=subscribers opens it, inside the desk');
assert.deepEqual(JSON.parse(read('appsscript.json')).webapp, { executeAs: 'USER_DEPLOYING', access: 'MYSELF' }, 'the desk opens only for the club account');

// ----- The page: the Bcc box, the unsubscribe line, the allowance -----
const pageHtml = read('EmailListPage.html');
function loadPage(addresses) {
  const dom = new JSDOM(pageHtml.replace(/<script>[\s\S]*<\/script>/, ''), { url: 'https://example.test/', runScripts: 'outside-only' });
  const runner = {};
  let ok = null;
  runner.withSuccessHandler = done => { ok = done; return runner; };
  runner.withFailureHandler = () => runner;
  runner.getEmailList = () => ok({ ok: true, addresses, dailyLimit: 500, unsubscribeUrl: 'https://concordtabletennisclub.com/unsubscribe.html' });
  dom.window.google = { script: { run: runner } };
  dom.window.eval(/<script>([\s\S]*)<\/script>/.exec(pageHtml)[1]);
  return dom.window.document;
}
let doc = loadPage(JSON.parse(JSON.stringify(result.addresses)));
assert.equal(doc.getElementById('bcc').value, 'ann@example.com, bo@example.org', 'comma separated, ready for Gmail Bcc');
assert.equal(doc.getElementById('count').textContent, '2');
assert.match(doc.getElementById('footer').value, /To stop these emails: https:\/\/concordtabletennisclub\.com\/unsubscribe\.html$/);
assert.match(doc.getElementById('howto').textContent, /Bcc[\s\S]*Never To or Cc/);
assert.equal(doc.getElementById('allowance').className, '', 'a short list: no warning');
assert.equal(doc.getElementById('rows').children.length, 2);
assert.equal(doc.getElementById('rows').children[0].textContent, 'bo@example.org2026-11-01', 'newest sign-up first');
assert.doesNotMatch(doc.getElementById('status').className, /busy/, 'the screenshot tool waits for busy to clear');

const many = Array.from({ length: 210 }, (_, i) => ({ email: 'p' + i + '@example.com', added: '2026-11-01' }));
doc = loadPage(many);
assert.equal(doc.getElementById('allowance').className, 'warn', 'a list near half the daily allowance warns');
assert.match(doc.getElementById('allowance').textContent, /send updates on a day with no round robin/);

doc = loadPage([]);
assert.equal(doc.getElementById('people').hidden, true);
assert.match(doc.getElementById('status').textContent, /Nobody is on the list yet/);

// ----- The club site's launcher, like cash.html and volunteer-admin.html -----
const launcher = fs.readFileSync(path.join(root, 'email-list.html'), 'utf8');
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(launcher)[1];
assert.match(csp, /default-src 'none'/);
assert.match(csp, /frame-src https:\/\/script\.google\.com(;|$)/, 'only Google can be framed');
assert.match(launcher, /<meta name="robots" content="noindex, nofollow">/);
const script = /<script>([\s\S]*?)<\/script>/.exec(launcher)[1];
const frame = { src: '' };
const direct = { href: '' };
vm.runInNewContext(script, { URL, URLSearchParams, document: { getElementById: id => (id === 'admin' ? frame : direct) } });
const base = /new URL\('([^']+)'\)/.exec(script)[1];
assert.equal(base, /new URL\('([^']+)'\)/.exec(fs.readFileSync(path.join(root, 'desk.html'), 'utf8'))[1], 'the released desk, never /dev');
assert.equal(frame.src, base + '?view=subscribers');
assert.equal(direct.href, frame.src);
const button = /<a id="email-list-launch"[^>]*>[\s\S]*?<\/a>/.exec(fs.readFileSync(path.join(root, 'membership.html'), 'utf8'));
assert.ok(button && /href="email-list\.html"/.test(button[0]) && /&#128274;[\s\S]*Email list/.test(button[0]), 'a lock button on the Membership page, beside Cash flow');

console.log('Email list checks passed');
