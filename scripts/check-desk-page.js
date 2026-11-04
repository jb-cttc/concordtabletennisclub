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
let frame, direct, page;
function element() { const el = { hidden: false, src: '', href: '', handlers: {} }; el.addEventListener = (name, fn) => { el.handlers[name] = fn; }; return el; }
function run(search) {
  const els = {};
  const timers = [];
  page = { els, timers, listeners: {} };
  frame = element();
  direct = element();
  vm.runInNewContext(script, {
    URL, URLSearchParams,
    location: { search },
    setTimeout: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    window: { addEventListener: (name, fn) => { page.listeners[name] = fn; } },
    document: { getElementById: id => id === 'desk' ? frame : id === 'direct' ? direct : (els[id] = els[id] || element()) }
  });
  return frame.src;
}
function wait(ms) { page.timers.filter(t => !t.cleared && t.ms <= ms).forEach(t => { t.cleared = true; t.fn(); }); }
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

// Not signed in: Google leaves the frame blank, so after 10 seconds without word from the desk a sign-in card covers it.
// Its button opens the desk directly in this tab, where Google shows its own sign-in page.
assert.match(html, /<a id="direct"[^>]*target="_top"[^>]*>Sign in with the club's Google account<\/a>/);
assert.match(html, /<div id="signin"[^>]*hidden>/, 'the card starts hidden');
run('');
assert.equal(page.els.signin.hidden, true, 'no card while the desk is loading');
wait(9000);
assert.equal(page.els.signin.hidden, true, 'still waiting at 9 seconds');
wait(10000);
assert.equal(page.els.signin.hidden, false, 'the card shows when the desk has not opened');
assert.equal(page.els.fallback.hidden, true);
// The desk opening later (a slow Google) closes it; a message from anywhere else does not.
page.listeners.message({ origin: 'https://evil.example', data: { cttcDesk: 'ready' } });
assert.equal(page.els.signin.hidden, false, 'only the desk itself can close the card');
page.listeners.message({ origin: 'https://n-abc123-0lu-script.googleusercontent.com', data: { cttcDesk: 'ready' } });
assert.equal(page.els.signin.hidden, true, 'the desk opened');
assert.equal(page.els.fallback.hidden, true);
// Signed in: the desk says so first, and the card never shows.
run('');
page.listeners.message({ origin: 'https://n-abc123-0lu-script.googleusercontent.com', data: { cttcDesk: 'ready' } });
wait(10000);
assert.equal(page.els.signin.hidden, true, 'a signed-in desk never sees the card');
// Try again reloads the frame and waits again.
run('');
wait(10000);
frame.src = '';
page.els.retry.handlers.click();
assert.equal(page.els.signin.hidden, true);
assert.match(frame.src, /\/exec$/, 'Try again reloads the desk');
wait(10000);
assert.equal(page.els.signin.hidden, false);
// The desk sends that word only when framed by the club site, to the club site's own address.
const desk = fs.readFileSync(path.join(root, 'apps-script', 'Index.html'), 'utf8');
assert.match(desk, /if \(embedded\) \{ try \{ window\.top\.postMessage\(\{ cttcDesk: 'ready' \}, ancestors\[2\]\);/);

// The page is published, but is not part of the site menu and is left alone by the menu updater.
const navigation = /const NAV_LINKS = \[([\s\S]*?)\];/.exec(fs.readFileSync(path.join(root, 'scripts', 'sync-nav.js'), 'utf8'))[1];
assert.ok(navigation.includes('index.html'), 'the navigation list was found');
assert.ok(!navigation.includes('desk'), 'not in the site navigation');
assert.match(fs.readFileSync(path.join(root, 'scripts', 'sync-nav.js'), 'utf8'), /OWN_PAGES = \[[^\]]*'desk\.html'/);
assert.match(fs.readFileSync(path.join(root, '.github', 'workflows', 'update-data.yml'), 'utf8'), /cp \*\.html /, 'top-level pages are published');

// Locally, /desk serves the same page as on the site.
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
assert.match(source, /if \(urlPath === '\/desk'\) urlPath = '\/desk\.html';/);

// The Organize button opens the framed desk page, never the raw Google address (which shows Google's banner).
const roundRobins = fs.readFileSync(path.join(root, 'roundrobins.html'), 'utf8');
assert.match(roundRobins, /<a id="organizer-launch"[^>]*href="desk\.html"/);
// The only Google address on the page is the public sign-up form, never the desk.
assert.doesNotMatch(roundRobins.replace(/SUBSCRIBE_URL = '[^']+'/, ''), /script\.google\.com/);

console.log('Club site desk page checks passed');

// The Subscribe button sits left of Organize and opens the public sign-up form (a separate app, not the desk).
assert.match(roundRobins, /<button id="subscribe-launch"[\s\S]*?Subscribe[\s\S]*?<a id="organizer-launch"/, 'Subscribe comes before Organize');
const subscribeUrl = /SUBSCRIBE_URL = '([^']+)'/.exec(roundRobins)[1];
assert.match(subscribeUrl, /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/);
assert.ok(!html.includes(subscribeUrl.split('/s/')[1]), 'the public form is a different app from the owner-only desk');
