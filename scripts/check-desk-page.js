'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'desk.html'), 'utf8');

// What the page may load and how it is indexed.
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
assert.match(csp, /default-src 'none'/);
assert.match(csp, /frame-src https:\/\/script\.google\.com(;|$)/, 'only Google can be framed');
assert.doesNotMatch(csp, /frame-src[^;]*\*/);
assert.match(csp, /form-action 'none'/);
assert.match(html, /<meta name="robots" content="noindex, nofollow">/, 'a private tool stays out of search results');
assert.doesNotMatch(html, /<script[^>]*\ssrc=|<link[^>]*rel="stylesheet"|<img\s/i, 'nothing is loaded from elsewhere');
assert.equal((html.match(/<iframe\b/g) || []).length, 1);
assert.doesNotMatch(html, /<iframe[^>]*\ssrc=/, 'the frame address is set by the script, from one place');

// The script: one fixed released address, and only a well-formed date is passed on.
const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
const frame = { src: '' };
const direct = { href: '' };
function run(search) {
  vm.runInNewContext(script, {
    URL, URLSearchParams,
    location: { search },
    document: { getElementById: id => id === 'desk' ? frame : direct }
  });
  return frame.src;
}
const base = /new URL\('([^']+)'\)/.exec(script)[1];
assert.match(base, /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/, 'only a released /exec address, never /dev');
assert.equal(run(''), base);
assert.equal(direct.href, base, 'the fallback link opens the same address');
assert.equal(run('?date=2026-09-28'), base + '?date=2026-09-28', 'a session date is passed on');
assert.equal(direct.href, base + '?date=2026-09-28');
for (const bad of ['?date=2026-9-28', '?date="><script>', '?date=2026-09-28%22', '?date=', '?date=../../x', '?date=2026-09-28&date=evil', '?src=https://evil.example', '?other=1']) {
  const src = run(bad);
  assert(src === base || src === base + '?date=2026-09-28', 'unexpected frame address for ' + bad + ': ' + src);
  assert(!src.includes('evil') && !src.includes('<'), 'nothing from the link leaks into the address');
}
assert.equal(new URL(run('?src=https://evil.example')).origin, 'https://script.google.com');

// The page is published, but is not part of the site menu and is left alone by the menu updater.
const navigation = /const NAV_LINKS = \[([\s\S]*?)\];/.exec(fs.readFileSync(path.join(root, 'scripts', 'sync-nav.js'), 'utf8'))[1];
assert.ok(navigation.includes('index.html'), 'the navigation list was found');
assert.ok(!navigation.includes('desk'), 'not in the site navigation');
assert.match(fs.readFileSync(path.join(root, 'scripts', 'sync-nav.js'), 'utf8'), /f !== 'desk\.html'/);
assert.match(fs.readFileSync(path.join(root, '.github', 'workflows', 'update-data.yml'), 'utf8'), /cp \*\.html /, 'top-level pages are published');

// Locally, /desk serves the same page as on the site.
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
assert.match(source, /if \(urlPath === '\/desk'\) urlPath = '\/desk\.html';/);

// The Organize button opens the framed desk page, never the raw Google address (which shows Google's banner).
const roundRobins = fs.readFileSync(path.join(root, 'roundrobins.html'), 'utf8');
assert.match(roundRobins, /<a id="organizer-launch"[^>]*href="desk\.html"/);
assert.doesNotMatch(roundRobins, /script\.google\.com/);

console.log('Club site desk page checks passed');
