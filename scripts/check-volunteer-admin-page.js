'use strict';

// Volunteer Admin on the club site: the home page's lock button opens volunteer-admin.html, which frames the desk's own
// released address with ?view=volunteers, so only the club's Google account can open it (like cash.html).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'volunteer-admin.html'), 'utf8');
const desk = fs.readFileSync(path.join(root, 'desk.html'), 'utf8');
const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
assert.match(csp, /default-src 'none'/);
assert.match(csp, /frame-src https:\/\/script\.google\.com(;|$)/, 'only Google can be framed');
assert.match(html, /<meta name="robots" content="noindex, nofollow">/, 'a private page stays out of search results');
assert.doesNotMatch(html, /<script[^>]*\ssrc=|<link[^>]*rel="stylesheet"|<img\s/i, 'nothing is loaded from elsewhere');
assert.doesNotMatch(html, /<iframe[^>]*\ssrc=/, 'the frame address is set by the script, from one place');

const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
const frame = { src: '' };
const direct = { href: '' };
vm.runInNewContext(script, { URL, URLSearchParams, document: { getElementById: id => (id === 'admin' ? frame : direct) } });
const base = /new URL\('([^']+)'\)/.exec(script)[1];
assert.match(base, /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/, 'only a released /exec address, never /dev');
assert.equal(base, /new URL\('([^']+)'\)/.exec(desk)[1], 'the same deployment as the desk, so the same owner-only access');
assert.equal(frame.src, base + '?view=volunteers');
assert.equal(direct.href, frame.src);

// The home page's button: the Organize button's red style and lock, next to Volunteer signups.
const button = /<a id="volunteer-admin-launch"[^>]*>[\s\S]*?<\/a>/.exec(home);
assert.ok(button, 'the Volunteer Admin button is on the home page');
assert.match(button[0], /class="organizer-launch"/, 'the same colour and style as Organize');
assert.match(button[0], /href="volunteer-admin\.html"/);
assert.match(button[0], /&#128274;[\s\S]*Volunteer Admin/, 'a lock and the words Volunteer Admin');
assert.ok(home.indexOf('id="volunteer-launch"') < home.indexOf('id="volunteer-admin-launch"'), 'beside the Volunteer signups button');
console.log('Volunteer Admin page checks passed');
