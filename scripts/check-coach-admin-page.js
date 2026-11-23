'use strict';

// Coach Admin on the club site: the Coaching page's lock button opens coach-admin.html, which frames the desk's own released
// address with ?view=coaches, so only the club's Google account can open it (like volunteer-admin.html). Then the page itself
// (apps-script/CoachAdminPage.html) on made-up coaches: each coach's checklist, and a mobile number changed only after Review
// and Confirm, with Confirm sending exactly the number that was reviewed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const site = require('./lib/site-build');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
require('./lib/admin-launcher').checkAdminLauncher(site.read('coach-admin.html'), site.read('desk.html'), 'coaches');

const coaching = site.read('coaching.html');
const button = /<a id="coach-admin-launch"[^>]*>[\s\S]*?<\/a>/.exec(coaching);
assert.ok(button, 'the Coach Admin button is on the Coaching page');
assert.match(button[0], /class="organizer-launch"/, 'the same lock style as Volunteer Admin');
assert.match(button[0], /href="coach-admin\.html"/);
assert.match(button[0], /&#128274;[\s\S]*Coach Admin/);

const source = fs.readFileSync(path.join(root, 'apps-script', 'CoachAdminPage.html'), 'utf8');
const deskGuard = /<body>\s*<script>([\s\S]*?)<\/script>/;
assert.equal(deskGuard.exec(source)[1], deskGuard.exec(fs.readFileSync(path.join(root, 'apps-script', 'Index.html'), 'utf8'))[1], 'the desk\'s framing guard, word for word');
const html = source.replace(deskGuard, '<body>');

const steps = (email, text, rates) => ({ email, text, rates, left: [email, text, rates].filter(step => step !== 'done').length });
const A = 'a'.repeat(16);
const B = 'b'.repeat(16);
const C = 'c'.repeat(16);
const board = { ok: true, textNumber: '(925) 238-3505', coaches: [
  { id: A, name: 'Ann Coach', label: 'Coach A', active: true, club: true, email: 'ann@example.com', phone: '(925) 555-0101', rates: { 50: '50', 25: '30' }, steps: steps('done', 'done', 'done') },
  { id: B, name: 'Bo Coach', label: 'Coach B', active: true, club: true, email: 'bo@example.com', phone: '(925) 555-0102', rates: { 50: '', 25: '' }, steps: steps('untested', 'done', 'missing') },
  { id: C, name: 'Cy Coach', label: 'Coach C', active: false, club: true, email: 'cy@example.com', phone: '', rates: { 50: '45', 25: '' }, steps: steps('untested', 'missing', 'missing') }] };
const calls = [];
let answer = null;
const dom = new JSDOM(html.replace(/<script>[\s\S]*<\/script>/, ''), { url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
const runner = {};
let onOk = null;
runner.withSuccessHandler = done => { onOk = done; return runner; };
runner.withFailureHandler = () => runner;
runner.getCoachAdmin = () => onOk(JSON.parse(JSON.stringify(board)));
runner.previewCoachPhone = (id, phone) => { calls.push(['preview', id, phone]); onOk(answer); };
runner.setCoachPhone = (id, phone) => { calls.push(['set', id, phone]); onOk(answer); };
dom.window.google = { script: { run: runner } };
dom.window.eval(/<script>([\s\S]*)<\/script>/.exec(html)[1]);
const $ = selector => dom.window.document.querySelector(selector);
const $$ = selector => [...dom.window.document.querySelectorAll(selector)];
const cardOf = name => $('section[aria-label="' + name + '"]');
const text = node => node.textContent.replace(/\s+/g, ' ').trim();
const buttonIn = (node, label) => [...node.querySelectorAll('button')].find(item => item.textContent === label);

assert.equal(text($('#status')), '1 of 2 coaches fully set up.', 'counts only the coaches offered on the coaching page');
assert.deepEqual($$('#coaches section').map(node => node.getAttribute('aria-label')), ['Ann Coach', 'Bo Coach']);
assert.deepEqual($$('#off section').map(node => node.getAttribute('aria-label')), ['Cy Coach'], 'a hidden coach is listed apart');
assert.equal($('#off-heading').hidden, false);
assert.match(text(cardOf('Ann Coach')), /✓ Fully set up/);
assert.match(text(cardOf('Bo Coach')), /2 steps left/);
assert.deepEqual([...cardOf('Bo Coach').querySelectorAll('.step')].map(node => node.className), ['step todo', 'step done', 'step todo'], 'each step marked');
assert.match(text(cardOf('Bo Coach')), /Not confirmed yet: confirmed when they reply YES or NO to any of our emails/);
assert.match(text(cardOf('Cy Coach')), /\$45 for 50 min/);
assert.match(text(cardOf('Cy Coach')), /Not offered/);

// Change Bo's number: Review asks the coaching app (nothing saved), Confirm sends the same number, then the list reloads.
buttonIn(cardOf('Bo Coach'), 'Change mobile number').click();
const input = $('#phone-' + B);
assert.equal(input.value, '(925) 555-0102', 'starts from the number on file');
input.value = '925.555.0199';
answer = { ok: true, preview: true, name: 'Bo Coach', before: '(925) 555-0102', after: '(925) 555-0199', effect: 'Coach Bo\'s mobile shows as not yet confirmed until they text (925) 238-3505 from it.' };
buttonIn(cardOf('Bo Coach'), 'Review').click();
assert.deepEqual(calls, [['preview', B, '925.555.0199']]);
assert.match(text($('.review')), /Bo Coach’s mobile: \(925\) 555-0102 → \(925\) 555-0199/);
assert.match(text($('.review')), /recorded in the desk log/);
// Typing again after Review does not change what Confirm sends: Confirm saves the number that was reviewed.
$('#phone-' + B).value = '925.555.0000';
answer = { ok: true, name: 'Bo Coach', before: '(925) 555-0102', after: '(925) 555-0199' };
buttonIn($('.review'), 'Confirm').click();
assert.deepEqual(calls[1], ['set', B, '925.555.0199'], 'what was confirmed is what is sent');
assert.equal(text($('#status')), 'Saved: Bo Coach’s mobile is now (925) 555-0199.');
assert.equal($('.review'), null, 'the review closes');

// A refusal shows the coaching app's reason and saves nothing.
buttonIn(cardOf('Ann Coach'), 'Change mobile number').click();
$('#phone-' + A).value = '555-1234';
answer = { ok: false, message: 'Enter a 10 digit US mobile number, like (925) 555-0123, or leave it empty to remove the number.' };
buttonIn(cardOf('Ann Coach'), 'Review').click();
assert.match(text($('#status')), /10 digit US mobile number/);
assert.equal($('.review'), null);
assert.equal(calls.filter(call => call[0] === 'set').length, 1);
console.log('Coach Admin page checks passed');
