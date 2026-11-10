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
// The Volunteer Admin page itself (apps-script/VolunteerAdminPage.html), on a made-up board: every week is one row with
// Monday, Wednesday, Friday and Saturday always in that order, and an open spot adds someone (confirmed, and emailed).
const { JSDOM } = require('jsdom');
const adminHtml = fs.readFileSync(path.join(root, 'apps-script', 'VolunteerAdminPage.html'), 'utf8');
const positions = [
  { id: 'desk', label: 'Desk organizer', part: 'open', min: 1, full: 1, max: 1, training: ['keys', 'open'], alsoWith: ['tables'] },
  { id: 'tables', label: 'Table/barrier setup', part: 'open', min: 1, full: 3, max: 4, training: [], alsoWith: ['desk'] },
  { id: 'close', label: 'Put tables and barriers away', part: 'close', min: 1, full: 2, max: 5, training: [], alsoWith: [] }];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Starting on a Wednesday, so the first row has an empty Monday; Fri, Nov 20 is left out (as with "Nights with sign-ups only").
const dates = ['2026-11-11', '2026-11-13', '2026-11-14', '2026-11-16', '2026-11-18', '2026-11-21', '2026-11-23'];
const nightFor = date => ({ date, day: date, short: WEEKDAYS[new Date(date + 'T12:00:00Z').getUTCDay()] + ' ' + date.slice(5), time: '7:00 PM to 10:00 PM', start: '19:00', end: '22:00',
  closed: false, note: '', status: 'needs', open: true, free: null,
  slots: { desk: [], tables: date === '2026-11-11' ? [{ id: 's1', playerId: 'p-ann', name: 'Ann Sample', status: 'confirmed', finalize: false, free: '' }] : [], close: [] } });
const adminBoard = { ok: true, today: '2026-11-11', quota: 90, noteMax: 500, months: [{ year: 2026, month: 11, title: 'November 2026' }], positions,
  skills: [{ id: 'keys', label: 'key access' }, { id: 'open', label: 'opening' }, { id: 'front_desk', label: 'Front Desk' }], nights: dates.map(nightFor),
  training: [], recent: [], withEmail: ['p-ann'],
  players: [{ playerId: 'p-ann', name: 'Ann Sample', rating: 1500 }, { playerId: 'p-mo', name: 'Mo Sample', rating: 900 }] };
const calls = [];
const dom = new JSDOM(adminHtml.replace(/<script>[\s\S]*<\/script>/, ''), { url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
const runner = {};
let onOk = null;
runner.withSuccessHandler = done => { onOk = done; return runner; };
runner.withFailureHandler = () => runner;
runner.getVolunteerAdmin = () => onOk(JSON.parse(JSON.stringify(adminBoard)));
runner.previewVolunteerAdmin = bucket => { calls.push(bucket); onOk({ ok: true, preview: true, changes: bucket.changes.length, emails: [] }); };
dom.window.google = { script: { run: runner } };
dom.window.eval(/<script>([\s\S]*)<\/script>/.exec(adminHtml)[1]);
const $ = selector => dom.window.document.querySelector(selector);
const $$ = selector => [...dom.window.document.querySelectorAll(selector)];
const rows = () => {
  const cells = $$('#nights > *').map(node => (node.classList.contains('night-gap') ? '-' : node.querySelector('h3').textContent.slice(0, 3)));
  const out = [];
  for (let i = 0; i < cells.length; i += 4) out.push(cells.slice(i, i + 4).join(' '));
  return out;
};
assert.deepEqual(rows(), ['- Wed Fri Sat', 'Mon Wed - Sat', 'Mon'], 'one week per row, Monday, Wednesday, Friday, Saturday, a gap where a night is not shown');
assert.match(adminHtml, /\.nights \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/, 'four columns on a wide screen');

// Tap an open spot: pick someone, type the email they have none on file for, and the add waits in the bucket.
const spotAt = (date, position) => $$('.slot.addable').find(node => node.getAttribute('data-date') === date && node.getAttribute('data-position') === position);
spotAt('2026-11-13', 'tables').click();
assert.equal($('#picker').hidden, false, 'the add window opens');
assert.match($('#picker').textContent, /Table\/barrier setup, Fri 11-13/);
const search = $('#picker input[type=search]');
search.value = 'sample';
search.dispatchEvent(new dom.window.Event('input'));
const picks = $$('#picker .finds button').filter(button => /Sample/.test(button.textContent));
assert.deepEqual(picks.map(button => button.disabled), [false, false]);
picks.find(button => /Mo Sample/.test(button.textContent)).click();
const emailBox = $('#picker input[type=email]');
assert.ok(emailBox, 'Mo has no email on file, so one is asked for');
$('#picker .primary').click();
assert.match($('#picker .problem').textContent, /Type the email/);
emailBox.value = 'mo@example.com';
$('#picker .primary').click();
assert.equal($('#picker').hidden, true);
assert.equal($('#bucketOpen').textContent, 'Changes to submit (1)');
const added = $('.card.added');
assert.ok(added && /Mo Sample/.test(added.textContent), 'shown on the night, marked as being added');
// Ann already has that Wednesday spot: she is listed but cannot be picked.
spotAt('2026-11-11', 'tables').click();
const again = $('#picker input[type=search]');
again.value = 'ann';
again.dispatchEvent(new dom.window.Event('input'));
const ann = $$('#picker .finds button').find(button => /Ann Sample/.test(button.textContent));
assert.equal(ann.disabled, true, 'already on that spot');
assert.match(ann.textContent, /Already here/);
dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
assert.equal($('#picker').hidden, true, 'Esc closes the add window');
// Review sends the add, with its email, to the volunteer app.
$('#bucketOpen').click();
$('#review').click();
assert.deepEqual(JSON.parse(JSON.stringify(calls.pop().changes)).map(change => [change.kind, change.playerId, change.to.date, change.to.position, change.email]), [['add', 'p-mo', '2026-11-13', 'tables', 'mo@example.com']]);
assert.match($('#drawerBody').textContent, /ADDMo Sample: Fri 11-13, Table\/barrier setup \(confirmed by the club; email to put on file: mo@example\.com\)/);
// Undo takes it back off the board.
$$('#drawerBody .undo')[0].click();
assert.equal($$('.card.added').length, 0);
assert.equal($('#bucketOpen').textContent, 'Changes to submit (0)');

console.log('Volunteer Admin page checks passed');
