'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'cash.html'), 'utf8');
const desk = fs.readFileSync(path.join(root, 'desk.html'), 'utf8');

// What the page may load and how it is indexed.
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
assert.match(csp, /default-src 'none'/);
assert.match(csp, /frame-src https:\/\/script\.google\.com(;|$)/, 'only Google can be framed');
assert.doesNotMatch(csp, /frame-src[^;]*\*/);
assert.match(csp, /form-action 'none'/);
assert.match(csp, /base-uri 'none'/);
assert.match(html, /<meta name="robots" content="noindex, nofollow">/, 'a private page stays out of search results');
assert.doesNotMatch(html, /<script[^>]*\ssrc=|<link[^>]*rel="stylesheet"|<img\s/i, 'nothing is loaded from elsewhere');
assert.equal((html.match(/<iframe\b/g) || []).length, 1);
assert.doesNotMatch(html, /<iframe[^>]*\ssrc=/, 'the frame address is set by the script, from one place');
assert.equal((html.match(/<script>/g) || []).length, 1);

// The script: the desk's own released address with view=cash, and nothing from the link is passed on.
const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
const frame = { src: '' };
const direct = { href: '' };
function run(search) {
  vm.runInNewContext(script, {
    URL, URLSearchParams,
    location: { search, href: 'https://concordtabletennisclub.com/cash.html' + search },
    document: { getElementById: id => id === 'cash' ? frame : direct }
  });
  return frame.src;
}
const base = /new URL\('([^']+)'\)/.exec(script)[1];
assert.match(base, /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/, 'only a released /exec address, never /dev');
assert.equal(base, /new URL\('([^']+)'\)/.exec(desk)[1], 'the same deployment as the desk, so the same owner-only access');
const expected = base + '?view=cash';
assert.equal(run(''), expected);
assert.equal(direct.href, expected, 'the fallback link opens the same address');
for (const bad of ['?date=2026-09-28', '?view=desk', '?view=cash&from=2026-01-01', '?src=https://evil.example', '?"><script>', '?view=cash%22', '?other=1']) {
  assert.equal(run(bad), expected, 'nothing from the link leaks into the address: ' + bad);
  assert.equal(direct.href, expected);
}
assert.equal(new URL(run('?src=https://evil.example')).origin, 'https://script.google.com');
assert.match(html, /Open it directly/);

// The page is published, but is not part of the site menu and is left alone by the menu updater.
const syncNav = fs.readFileSync(path.join(root, 'scripts', 'sync-nav.js'), 'utf8');
const navigation = /const NAV_LINKS = \[([\s\S]*?)\];/.exec(syncNav)[1];
assert.ok(navigation.includes('index.html'), 'the navigation list was found');
assert.ok(!navigation.includes('cash'), 'not in the site navigation');
assert.match(syncNav, /f !== 'cash\.html'/);
assert.doesNotMatch(html, /<nav>|<footer>/);
assert.match(fs.readFileSync(path.join(root, '.github', 'workflows', 'update-data.yml'), 'utf8'), /cp \*\.html /, 'top-level pages are published');

// Locally, /cash serves the same page as on the site.
assert.match(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), /if \(urlPath === '\/cash'\) urlPath = '\/cash\.html';/);

console.log('Club site cash flow page checks passed');
