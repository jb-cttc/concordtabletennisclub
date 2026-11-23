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
  { id: C, name: 'Cy Coach', label: 'Coach C', active: false, club: true, email: 'cy@example.com', phone: '', rates: { 50: '45', 25: '' }, steps: steps('untested', 'missing', 'missing') }],
  usatt: { ok: true, source: 'https://coaches.usatt.org/', exceptions: 1, busy: '' } };
// What USATT and the coaching page say about each (CoachAdmin.js coachOffer_): Ann certified, Bo the club's exception, Cy pending.
const offerOf = (status, level, extra) => Object.assign({ status, level, certified: status === 'USATT Certification Active', exception: false, onPage: true, inList: true, reason: '', actions: [], request: null }, extra);
board.coaches[0].offer = offerOf('USATT Certification Active', 'Coaching Level 1');
board.coaches[1].offer = offerOf('USATT Certification Pending', '', { exception: true, reason: 'Offered as the club\'s exception while USATT certification is pending.', actions: ['end'] });
board.coaches[2].offer = offerOf('USATT Certification Pending', '', { onPage: false, inList: false, reason: 'USATT certification pending: USATT\'s Find a Coach directory does not list them with a coaching level.', actions: ['offer'] });
const calls = [];
let answer = null;
// The control center's data, made up: a request waiting on Bo, a booked lesson whose email is stuck, a lesson booked ahead,
// one cancelled last week, and Bo's list of times waiting.
const H = 3600000;
const lessonOf = (id, code, date, status, attention, extra) => Object.assign({ id, code, date, start: '19:00', minutes: 60, day: 'Friday, December ' + Number(date.slice(8)) + ', 2026',
  time: '7:00 PM to 7:50 PM', when: '', table: 1, rate: '50', coachId: B, coach: 'Coach Bo', coachActive: true, student: 'Sam Student', guardian: '', status, recorded: status,
  waitingOn: '', change: '', deadline: 0, started: false, attention, next: 'Booked', steps: [{ state: 'done', text: 'Requested on the coaching page', at: Date.now() - H }], actions: [] }, extra);
const P = '1'.repeat(16);
const S = '2'.repeat(16);
const center = { ok: true, now: Date.now(), today: '2026-12-01', yesterday: '2026-11-30', textNumber: '(925) 238-3505', pastDays: 14,
  health: { sweep: { at: new Date().toISOString(), ok: true, failed: [] }, check: { at: new Date().toISOString(), ok: true, failed: [] }, failing: [], mailLeft: 80, mailReserve: 10,
    summarySent: '2026-12-01', summaryTo: 'o•••r@example.com', summaryHour: 7, runtime: { runs: 3, seconds: 30 } },
  counts: ['today', 'yesterday'].reduce((all, day, index) => Object.assign(all, { [day]: { counts: { 'student-v': 0, 'coach-request': index + 1, 'student-c': 0, 'coach-slots': 0 }, declined: 0, lists: 0, booked: 2, unanswered: 0, cancelledOnPage: 0, undone: 0, confirmed: index + 1 } }), { complete: true }),
  lessons: [
    lessonOf('3'.repeat(16), 'C0FFEE', '2026-11-27', 'cancelled', 'done', { student: 'Lou Gone', next: 'Cancelled by the student' }),
    lessonOf(P, '9E3D15', '2026-12-04', 'pending', 'waiting', { student: 'Pat Player', waitingOn: 'coach', deadline: Date.now() + 5 * H, next: 'Waiting for Coach Bo to accept',
      actions: ['accept', 'decline', 'remind', 'resend-student'], steps: [{ state: 'now', text: 'Waiting for Coach Bo to accept', at: Date.now() + 5 * H }] }),
    lessonOf(S, '32AF8F', '2026-12-04', 'confirmed', 'stuck', { student: 'Kim Learner', start: '20:00', next: 'Email to the student (confirmed) not sent yet',
      actions: ['resend-student', 'cancel-coach'], steps: [{ state: 'stuck', text: 'Email to the student (confirmed) not sent yet' }] }),
    lessonOf('4'.repeat(16), 'B71C22', '2026-12-05', 'confirmed', 'booked', { student: 'Jo Regular', actions: ['cancel-coach'] })],
  proposals: [{ coachId: B, coach: 'Coach Bo', times: 4, rates: true, sentAt: Date.now() - H, lapsesAt: Date.now() + 47 * H, texted: true, actions: ['publish-times', 'drop-times'] }],
  waitlist: 1, log: [{ at: new Date().toISOString(), channel: 'error', kind: 'send-student_emailed:confirmed', about: '32AF8F', detail: 'Service invoked too many times' }] };
const makePage = runnerFor => {
  const page = new JSDOM(html.replace(/<script>[\s\S]*<\/script>/, ''), { url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  page.window.google = { script: { run: runnerFor() } };
  page.window.eval(/<script>([\s\S]*)<\/script>/.exec(html)[1]);
  return page;
};
let overviews = 0;
const dom = makePage(() => {
  const runner = {};
  let onOk = null;
  runner.withSuccessHandler = done => { onOk = done; return runner; };
  runner.withFailureHandler = () => runner;
  runner.getCoachAdmin = () => onOk(JSON.parse(JSON.stringify(board)));
  runner.previewCoachPhone = (id, phone) => { calls.push(['preview', id, phone]); onOk(answer); };
  runner.setCoachPhone = (id, phone) => { calls.push(['set', id, phone]); onOk(answer); };
  runner.previewCoachOffer = (kind, id) => { calls.push(['offer?', kind, id]); onOk(answer); };
  runner.setCoachOffer = (kind, id) => { calls.push(['offer!', kind, id]); onOk(answer); };
  runner.getCoachingOverview = () => { overviews += 1; onOk(JSON.parse(JSON.stringify(center))); };
  runner.previewCoachingAction = (kind, id) => { calls.push(['review', kind, id]); onOk(answer); };
  runner.runCoachingAction = (kind, id) => { calls.push(['do', kind, id]); onOk(answer); };
  return runner;
});
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
assert.deepEqual([...cardOf('Bo Coach').querySelectorAll('.step')].map(node => node.className), ['step todo', 'step done', 'step todo', 'step todo'], 'each step marked, and USATT');
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

// Coach management folds away, and this browser remembers it folded.
assert.equal($('#manage').tagName, 'DETAILS');
assert.equal($('#manage').open, true, 'open the first time');
assert.equal(text($('#manage-note')), '1 of 2 coaches fully set up, 1 not offered', 'its summary line says how the coaches stand while folded');
$('#manage').open = false;
$('#manage').dispatchEvent(new dom.window.Event('toggle'));
assert.equal(dom.window.localStorage.getItem('cttc-coach-admin-manage'), 'closed');

// The control center: tiles, what needs attention (stuck first, then by deadline), and every lesson by day.
calls.length = 0;
const tiles = $$('#tiles .tile').map(node => [...node.children].map(part => part.textContent).join(' '));
assert.match(tiles[0], /^2 Waiting on coaches/, 'a request and a list of times');
assert.match(tiles[2], /^1 Stuck/);
assert.match(tiles[3], /^2 Upcoming lessons/);
assert.match(tiles[4], /^80 Emails left today/);
const attention = $$('#attention article').map(node => node.getAttribute('aria-label'));
assert.deepEqual(attention.map(label => label.split(':')[0]), ['Booking 32AF8F', 'Booking 9E3D15', 'Coach Bo’s list of times'], 'stuck first; booked and closed lessons are not listed');
const stuckStep = $('#attention article ol.steps li.stuck');
assert.ok(stuckStep, 'the stuck step, marked');
assert.equal(stuckStep.querySelector('.mark').getAttribute('aria-label'), 'stuck');
assert.match(text(stuckStep), /Email to the student \(confirmed\) not sent yet/);
assert.match(text($$('#attention article')[1]), /Deadline in 5 h/);
const shownCodes = () => $$('#lessons article').map(node => /Booking (\w+)/.exec(node.getAttribute('aria-label'))[1]);
assert.deepEqual(shownCodes(), ['9E3D15', '32AF8F', 'B71C22'], 'upcoming, in time order');
assert.deepEqual($$('#lessons .day').map(node => text(node)), ['Friday, December 4, 2026', 'Friday, December 5, 2026']);
const chip = label => $$('#filters .chip').find(node => node.textContent.startsWith(label));
assert.equal(text(chip('Past and closed')), 'Past and closed (1)');
chip('Past and closed').click();
assert.deepEqual(shownCodes(), ['C0FFEE']);
chip('All').click();
$('#search').value = 'kim';
$('#search').dispatchEvent(new dom.window.Event('input'));
assert.deepEqual(shownCodes(), ['32AF8F'], 'found by student');
$('#search').value = 'b71c';
$('#search').dispatchEvent(new dom.window.Event('input'));
assert.deepEqual(shownCodes(), ['B71C22'], 'found by booking code');
assert.equal($('#lessons .detail'), null, 'steps are folded in the full list');
buttonIn($('#lessons article'), 'Steps and controls').click();
assert.ok($('#lessons .detail'), 'until opened');
const countRow = label => [...$$('#counts tbody tr').find(row => row.firstChild.textContent === label).children].slice(1).map(node => node.textContent);
assert.deepEqual(countRow('Accepted by the coach'), ['1', '2'], 'today and yesterday, as in the daily summary');
assert.equal($$('#health dt').find(node => node.textContent === 'Emails left today').nextSibling.textContent, '80 (the app stops at 10)');
assert.ok($('#log li.error'), 'a failure stands out in the activity');

// A control: Review asks the coaching app (nothing done), Confirm does the same control on the same booking, then the view reloads.
answer = { ok: true, preview: true, title: 'Accept for Coach Bo', lesson: 'Pat Player’s lesson', effect: 'Confirms the lesson as if Coach Bo had replied YES.' };
const pat = () => $$('#attention article')[1];
buttonIn(pat(), 'Accept for the coach').click();
assert.deepEqual(calls, [['review', 'accept', P]]);
assert.match(text(pat().querySelector('.review')), /Accept for Coach Bo.*as if Coach Bo had replied YES.*recorded in the desk log/i);
assert.equal($$('.review').length, 1, 'shown only where it was asked');
answer = { ok: true, message: 'Accepted for Coach Bo.' };
const loaded = overviews;
buttonIn(pat().querySelector('.review'), 'Confirm').click();
assert.deepEqual(calls[1], ['do', 'accept', P], 'what was reviewed is what is done');
assert.equal(overviews, loaded + 1, 'the view reloads');
assert.equal(text($('#center-status')), 'Accepted for Coach Bo.');
assert.equal($('.review'), null);

// A refusal at Review says why, in place, and does nothing.
answer = { ok: false, message: 'That booking is confirmed now, so it cannot be accepted. Reload the page.' };
buttonIn(pat(), 'Accept for the coach').click();
assert.match(text(pat().querySelector('.notice')), /cannot be accepted/);
assert.equal(calls.filter(call => call[0] === 'do').length, 1);

// The admin tools: a test email to the coach picked; the sweep, which needs no coach.
answer = { ok: true, preview: true, title: 'Send Coach Bo a test email', effect: 'Emails b•••o@example.com.' };
const tool = name => $$('#tools .tool').find(node => node.querySelector('strong').textContent === name);
tool('Test email to a coach').querySelector('select').value = B;
buttonIn(tool('Test email to a coach'), 'Send test email').click();
assert.deepEqual(calls.pop(), ['review', 'test-email', B]);
assert.ok(tool('Test email to a coach').querySelector('.review'), 'reviewed under the tool');
assert.equal(tool('Test email to a coach').querySelector('select').value, B, 'the coach picked stays picked');
buttonIn(tool('Test email to a coach').querySelector('.review'), 'Cancel').click();
buttonIn(tool('Run the sweep and the check'), 'Run now').click();
assert.deepEqual(calls.pop(), ['review', 'sweep', '']);

// USATT on every card, and for a coach not offered, why, with the control that fits.
const usattOf = name => [...cardOf(name).querySelectorAll('.step')].find(node => /^USATT/.test(node.querySelector('.what').textContent));
assert.equal(usattOf('Ann Coach').className, 'step done');
assert.match(text(usattOf('Ann Coach')), /USATT: Active, Coaching Level 1/);
assert.match(text(usattOf('Bo Coach')), /USATT: Pending/);
assert.match(text(cardOf('Bo Coach').querySelector('.why')), /Offered as the club's exception/, 'the exception explained below');
assert.equal(cardOf('Ann Coach').querySelector('.why'), null, 'nothing to explain for a certified coach');
assert.equal(cardOf('Cy Coach').querySelector('.why.off strong').textContent, 'Why they are not offered');
assert.match(cardOf('Cy Coach').querySelector('.why.off p').textContent, /^USATT certification pending/);
assert.match(text($('#usatt')), /checked by every data update.*club's exceptions \(1 now\)/);
calls.length = 0;
answer = { ok: true, preview: true, title: 'Offer Cy Coach while USATT certification is pending', effect: 'Makes Cy Coach a club exception.' };
buttonIn(cardOf('Cy Coach'), 'Offer while pending').click();
assert.deepEqual(calls, [['offer?', 'offer', C]], 'Review asks the desk; nothing is done');
assert.match(text(cardOf('Cy Coach').querySelector('.review')), /Offer Cy Coach while USATT certification is pending.*recorded in the desk log/i);
answer = { ok: true, message: 'Asked GitHub to offer Cy Coach.' };
buttonIn(cardOf('Cy Coach').querySelector('.review'), 'Confirm').click();
assert.deepEqual(calls[1], ['offer!', 'offer', C], 'Confirm does what was reviewed, for the same coach');
assert.equal(text(cardOf('Cy Coach').querySelector('.notice')), 'Asked GitHub to offer Cy Coach.', 'the result stays on the card after the reload');
answer = { ok: false, message: 'The change for Cy Coach asked at Mon 12:00 PM is still running.' };
buttonIn(cardOf('Bo Coach'), 'Stop offering until certified').click();
assert.match(text(cardOf('Bo Coach').querySelector('.notice.error')), /still running/, 'a refusal says why, on the card');
answer = { ok: true, preview: true, title: 'Re-check USATT now', effect: 'Starts GitHub\'s data update now.' };
buttonIn($('#usatt'), 'Re-check USATT now').click();
assert.deepEqual(calls.pop(), ['offer?', 'recheck', '']);
assert.ok($('#usatt .review'), 'reviewed in the USATT bar');

// A coaching app without the control center yet: Coach Admin still works, and the control center says why it is empty.
const older = makePage(() => {
  const runner = {};
  let onOk = null;
  let onFail = null;
  runner.withSuccessHandler = done => { onOk = done; return runner; };
  runner.withFailureHandler = failed => { onFail = failed; return runner; };
  runner.getCoachAdmin = () => onOk(Object.assign(JSON.parse(JSON.stringify(board)), { usatt: { ok: false, message: 'The USATT status could not be read from the club site just now.' } }));
  runner.getCoachingOverview = () => onFail(new Error('The coaching app does not know this request yet: it needs its latest release.'));
  return runner;
});
assert.equal(older.window.document.querySelectorAll('#coaches section').length, 2);
assert.match(older.window.document.querySelector('#center-status').textContent, /needs its latest release/);
assert.match(older.window.document.querySelector('#usatt').textContent, /could not be read from the club site/, 'and says when USATT status is missing');
console.log('Coach Admin page checks passed');
