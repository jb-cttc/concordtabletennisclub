'use strict';

// The executive committee meeting app against a fake Google (script properties with their real size limits, the
// script cache, the lock), then both pages in jsdom wired to it: the controller's changes reach the board on the same
// computer at once, and on another computer through followTick. Synthetic agenda text only, no member names.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const dir = __dirname;
const read = name => fs.readFileSync(path.join(dir, name), 'utf8');

// ---- The project: what Google gets, and what it may touch ----
const manifest = JSON.parse(read('appsscript.json'));
assert.equal(manifest.webapp.access, 'MYSELF', 'only the club\'s Google account opens the meeting app, like the desk');
assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
assert.deepEqual(manifest.oauthScopes, [], 'no permission prompt: script properties, cache and lock need no scope');
assert.equal(manifest.timeZone, 'America/Los_Angeles');
assert.equal(read('.claspignore').trim(), 'check-*', 'the test is never pushed to Google');

const code = read('Code.js');
const model = read('Model.js');
[code, model].forEach(source => {
  assert.doesNotMatch(source, /=>|`|^\s*(let|const|class)\s/m, 'ES5 style, like the other Apps Script projects (the model also runs in the page)');
  assert.doesNotMatch(source, /SpreadsheetApp|GmailApp|MailApp|UrlFetchApp|DriveApp|DocumentApp|newTrigger|Session\.get/, 'no Sheet, mail, web, Drive, timers or user lookups: nothing that spends a shared Google limit or needs a scope');
});
const publicFunctions = [...code.matchAll(/^function ([A-Za-z0-9_]+)\(/gm)].map(m => m[1]).filter(name => !name.endsWith('_')).sort();
assert.deepEqual(publicFunctions, ['deleteMeeting', 'doGet', 'followTick', 'getState', 'listFollowUps', 'openMeeting', 'saveChanges', 'startMeeting', 'updateFollowUp'], 'the calls the pages make, and nothing else public');
assert.deepEqual([...model.matchAll(/^function ([A-Za-z0-9_]+)\(/gm)].map(m => m[1]), ['MeetingModel_'], 'the model is one self-contained function: the page gets its source');

// ---- A fake Google ----
let clock = Date.parse('2026-11-21T19:30:00Z');
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
const pacific = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
const props = new Map();
let cache = new Map();
let cacheWorks = true;
const counts = { propReads: 0, propWrites: 0, cacheReads: 0 };
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty(key) { counts.propReads += 1; return props.has(key) ? props.get(key) : null; },
    setProperty(key, value) { this.setProperties({ [key]: value }); },
    setProperties(values) {
      counts.propWrites += 1;
      Object.keys(values).forEach(key => {
        const value = String(values[key]);
        // Google: about 9 KB per value, 500 KB for all of them together.
        if (Buffer.byteLength(key + value) > 9 * 1024) throw new Error('Argument too large: value (' + key + ')');
        props.set(key, value);
      });
      const total = [...props].reduce((sum, [k, v]) => sum + Buffer.byteLength(k + v), 0);
      if (total > 500 * 1024) throw new Error('You have exceeded the property storage quota.');
    },
    deleteProperty(key) { props.delete(key); }
  })
};
const CacheService = {
  getScriptCache: () => ({
    get(key) { counts.cacheReads += 1; if (!cacheWorks) throw new Error('cache down'); return cache.has(key) ? cache.get(key) : null; },
    putAll(values) { if (!cacheWorks) throw new Error('cache down'); Object.keys(values).forEach(key => { assert.ok(values[key].length <= 100 * 1024, 'a cache value holds at most 100 KB'); cache.set(key, values[key]); }); }
  })
};
let lockFree = true;
const LockService = { getScriptLock: () => ({ tryLock: () => lockFree, releaseLock() {} }) };
const files = { Board: read('Board.html'), Control: read('Control.html'), Theme: read('Theme.html'), Guard: read('Guard.html'), Sync: read('Sync.html') };
let lastTemplate = null;
// Templates as Google fills them: <?!= ?> prints as is, <?= ?> escaped. A piece read with createHtmlOutputFromFile is
// not filled at all, so a template tag left in a page means a piece was included the wrong way.
const htmlEscape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HtmlService = {
  XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
  createTemplateFromFile(name) {
    assert.ok(files[name], 'a page that exists: ' + name);
    const template = { name };
    template.evaluate = () => {
      if (['Board', 'Control'].includes(name)) lastTemplate = template;
      const content = files[name].replace(/<\?(!?)=\s*([\s\S]*?)\s*\?>/g, (tag, raw, expression) => {
        const include = /^include_\('(\w+)'\)$/.exec(expression);
        const value = include ? server.include_(include[1]) : template[expression];
        assert.notEqual(value, undefined, name + ': ' + tag + ' has a value');
        return raw ? String(value) : htmlEscape(value);
      });
      return { title: '', frame: '', getContent: () => content, setTitle(t) { this.title = t; return this; }, addMetaTag() { return this; }, setXFrameOptionsMode(m) { this.frame = m; return this; } };
    };
    return template;
  },
  createHtmlOutputFromFile: name => ({ getContent: () => files[name] })
};
const ScriptApp = { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/dev' }) };
const Utilities = {
  formatDate(date, zone, pattern) {
    assert.equal(zone, 'America/Los_Angeles');
    const [y, m, d] = pacific.format(date).split('-');
    return pattern.replace('yyyy', y).replace('MM', m).replace('dd', d);
  }
};
const server = vm.createContext({ PropertiesService, CacheService, LockService, HtmlService, ScriptApp, Utilities, Date: FakeDate, Math, JSON, console });
// Google loads the files in push order: Code.js before Model.js, so Code.js must not call the model while it loads.
vm.runInContext(code, server, { filename: 'Code.js' });
vm.runInContext(model, server, { filename: 'Model.js' });
const plain = value => JSON.parse(JSON.stringify(value));
const run = (name, ...args) => plain(server[name](...plain(args)));

// ---- The model on its own ----
// The model as the page runs it: its own source, alone, with nothing else around it.
const M = new Function(model + '\nreturn MeetingModel_();')();
const pasted = [
  'Agenda:',
  '•\tClosure dates:',
  '\t○\tNov 13, Friday',
  '\t○\tDecember 3 - 6 (part of the gym)',
  '•\tOperations feedback from the first two months',
  '•\tCashless next year',
  '',
  '1. New website features',
  '   - Online sign-up',
  'Saturday round robin?'
].join('\n');
assert.deepEqual(plain(M.parseAgenda(pasted)), [
  { title: 'Closure dates', details: 'Nov 13, Friday\nDecember 3 - 6 (part of the gym)' },
  { title: 'Operations feedback from the first two months', details: '' },
  { title: 'Cashless next year', details: '' },
  { title: 'New website features', details: 'Online sign-up' },
  { title: 'Saturday round robin?', details: '' }
], 'bullets and numbers start items; indented lines and sub-bullets are sub-points; "Agenda:" is skipped');
let n = 0;
const ids = () => 'id' + String(n += 1).padStart(4, '0');
assert.deepEqual(plain(M.parseAttendees('Pat Example (President), Sam Sample\nGuests: Lee Visitor', ids)).map(p => [p.name, p.role]), [['Pat Example', 'President'], ['Sam Sample', ''], ['Lee Visitor', 'Guest']]);
assert.throws(() => M.apply(M.blank({}, 1), { type: 'nope' }, 1), /Unknown change/);
{
  const m = M.blank({ id: 'mtest0001' }, 1);
  M.apply(m, { type: 'addItems', items: [{ id: 'aaaa1', title: 'One' }, { id: 'aaaa2', title: 'Two' }, { id: 'aaaa3', title: 'Three' }] }, 1);
  assert.equal(m.items.every(it => !it.added), true, 'items before the meeting starts are the planned agenda');
  M.apply(m, { type: 'current', id: 'aaaa1' }, 100);
  assert.equal(m.startedAt, 100, 'discussing an item starts the meeting');
  M.apply(m, { type: 'status', id: 'aaaa1', status: 'done' }, 200);
  assert.equal(m.current, 'aaaa2', 'checking off the item being discussed moves Now to the next open item');
  assert.equal(m.currentSince, 200);
  M.apply(m, { type: 'status', id: 'aaaa2', status: 'tabled' }, 300);
  assert.equal(m.current, 'aaaa3', 'moving it to the next meeting does the same');
  M.apply(m, { type: 'addItems', items: [{ id: 'aaaa4', title: 'Late topic' }] }, 400);
  assert.equal(m.items[3].added, true, 'an item added once the meeting is under way is marked Added');
  M.apply(m, { type: 'moveItem', id: 'aaaa4', to: 0 }, 400);
  assert.deepEqual(m.items.map(it => it.id), ['aaaa4', 'aaaa1', 'aaaa2', 'aaaa3']);
  M.apply(m, { type: 'addAction', action: { id: 'bbbb1', text: 'Email the closure dates', owner: 'Pat Example', itemId: 'aaaa1', due: '2026-12-01' } }, 400);
  M.apply(m, { type: 'removeItem', id: 'aaaa1' }, 400);
  assert.equal(m.actions[0].itemId, '', 'a follow-up outlives its agenda item');
  M.apply(m, { type: 'editItem', id: 'gone1', title: 'x' }, 400);
  assert.equal(m.items.length, 3, 'a change to an item another screen removed does nothing');
  // Check-in: the same name twice is one person; checking out keeps them on the list as expected.
  M.apply(m, { type: 'checkIn', person: { id: 'pppp1', name: 'Pat Example', role: 'President' } }, 400);
  M.apply(m, { type: 'checkIn', person: { id: 'pppp2', name: 'pat example' } }, 400);
  M.apply(m, { type: 'checkIn', person: { id: 'pppp3', name: 'Lee Visitor', role: 'Guest' } }, 400);
  assert.deepEqual(m.attendees.map(p => [p.name, p.role, p.present]), [['Pat Example', 'President', true], ['Lee Visitor', 'Guest', true]]);
  M.apply(m, { type: 'checkIn', person: { id: 'pppp3' }, present: false }, 400);
  assert.equal(m.attendees[1].present, false);
  assert.equal(M.counts(m).present, 1);
  // The projector settings, kept within bounds.
  assert.deepEqual(M.display(m), { layout: 'full', scale: 1, people: 'tab', follow: true });
  M.apply(m, { type: 'display', layout: 'spotlight', scale: 9, people: 'open', follow: false }, 400);
  assert.deepEqual(M.display(m), { layout: 'spotlight', scale: 3, people: 'open', follow: false });
  M.apply(m, { type: 'display', layout: 'cinema', scale: 0.1 }, 400);
  assert.deepEqual(M.display(m), { layout: 'spotlight', scale: 0.7, people: 'open', follow: false }, 'an unknown layout is ignored; the text is never smaller than 70%');
  assert.deepEqual(M.display({}), { layout: 'full', scale: 1, people: 'tab', follow: true }, 'a meeting saved before these settings shows the defaults');
  // Follow-ups: open, in progress or done; dated updates with who added them; due dates amber within 3 days, red after.
  M.apply(m, { type: 'editAction', id: 'bbbb1', status: 'progress' }, 500);
  assert.deepEqual([m.actions[0].status, m.actions[0].done], ['progress', false]);
  M.apply(m, { type: 'actionUpdate', id: 'bbbb1', update: { id: 'uuuu1', text: 'Draft sent to the board' }, by: 'Pat Example' }, 600);
  assert.deepEqual(m.actions[0].updates, [{ id: 'uuuu1', text: 'Draft sent to the board', by: 'Pat Example', at: 600 }]);
  M.apply(m, { type: 'editAction', id: 'bbbb1', done: true }, 700);
  assert.deepEqual([m.actions[0].status, m.actions[0].done], ['done', true], 'the ball and the status agree');
  M.apply(m, { type: 'editAction', id: 'bbbb1', done: false }, 700);
  assert.equal(m.actions[0].status, 'open');
  assert.equal(M.dueState({ due: '2026-11-30' }, '2026-12-01'), 'overdue');
  assert.equal(M.dueState({ due: '2026-12-04' }, '2026-12-01'), 'soon');
  assert.equal(M.dueState({ due: '2026-12-05' }, '2026-12-01'), '');
  assert.equal(M.dueState({ due: '2026-11-30', done: true }, '2026-12-01'), '', 'a done follow-up is never overdue');
  const minutes = M.minutes(m);
  assert.match(minutes, /Saturday, November 21|Date: /);
  assert.match(minutes, /\[ \] Pat Example: Email the closure dates \(due 2026-12-01\)/);
  assert.match(minutes, /\[>\] Two \(next meeting\)/);
  assert.match(minutes, /Attendees \(1\):\n  - Pat Example \(President\)\n/, 'the minutes list who was checked in');
}

// ---- The server: nothing yet, then a meeting ----
assert.equal(run('getState').meeting, null, 'no meeting until one is started');
assert.equal(run('getState').today, '2026-11-21', 'today in Pacific time');
assert.deepEqual(run('followTick', null), { stamp: 'none', meeting: null });
assert.deepEqual(run('followTick', 'none'), { stamp: 'none' });

let state = run('startMeeting', { title: 'Executive Committee Meeting', date: '2026-11-21', agenda: plain(M.parseAgenda(pasted)), carry: true });
let meeting = state.meeting;
assert.equal(meeting.items.length, 5);
assert.equal(meeting.version, 1);
assert.match(meeting.id, /^m20261121[a-z0-9]{8}$/);
assert.equal(state.meetings.length, 1);
assert.equal(props.get('MEETING_CURRENT'), meeting.id);

// The board's beat: one cache read when nothing moved; the meeting only when it did.
counts.cacheReads = 0; counts.propReads = 0;
let tick = run('followTick', meeting.id + ':1');
assert.deepEqual(tick, { stamp: meeting.id + ':1' }, 'nothing moved: just the stamp');
assert.equal(counts.cacheReads, 1);
assert.equal(counts.propReads, 0, 'a quiet beat reads no properties');

let saved = run('saveChanges', meeting.id, [
  { type: 'current', id: meeting.items[0].id },
  { type: 'addAction', action: { id: 'act00001', text: 'Post the closures on the site', owner: 'Sam Sample', itemId: meeting.items[0].id } }
]);
assert.equal(saved.meeting.version, 2);
tick = run('followTick', meeting.id + ':1');
assert.equal(tick.stamp, meeting.id + ':2');
assert.equal(tick.meeting.actions[0].owner, 'Sam Sample', 'the board gets the meeting when the stamp moved');

// Two controllers at once: each sends only its own changes, so both land.
run('saveChanges', meeting.id, [{ type: 'status', id: meeting.items[0].id, status: 'done' }]);
run('saveChanges', meeting.id, [{ type: 'addItems', items: [{ id: 'late0001', title: 'Added from the second laptop' }] }]);
meeting = run('getState').meeting;
assert.equal(meeting.items[0].status, 'done');
assert.equal(meeting.current, meeting.items[1].id);
assert.equal(meeting.items[5].added, true);
assert.equal(meeting.version, 4);

// The cache lost (or down): the board still gets the meeting, from the properties.
cache = new Map();
tick = run('followTick', meeting.id + ':3');
assert.equal(tick.meeting.version, 4);
cacheWorks = false;
tick = run('followTick', meeting.id + ':3');
assert.equal(tick.meeting.version, 4, 'with no cache at all, followTick reads the properties');
cacheWorks = true;

// A meeting larger than one property is split, read back whole, and its unused pieces removed when it shrinks.
const longNotes = 'Discussion notes. '.repeat(220);
saved = run('saveChanges', meeting.id, meeting.items.map(it => ({ type: 'editItem', id: it.id, notes: longNotes })));
const pieces = JSON.parse(props.get('MEETING_' + meeting.id)).pieces;
assert.ok(pieces >= 3, 'a long meeting takes several properties (' + pieces + ')');
assert.equal(run('getState').meeting.items[2].notes, longNotes.trim());
run('saveChanges', meeting.id, meeting.items.map(it => ({ type: 'editItem', id: it.id, notes: '' })));
assert.equal(JSON.parse(props.get('MEETING_' + meeting.id)).pieces, 1);
assert.equal(props.has('MEETING_' + meeting.id + '_1'), false, 'the pieces it no longer needs are deleted');
assert.throws(() => run('saveChanges', meeting.id, Array.from({ length: 40 }, (x, i) => ({ type: 'addItems', items: [{ id: 'big' + String(i).padStart(4, '0'), title: 'Big ' + i, details: 'x'.repeat(1500), notes: 'y'.repeat(4000) }] }))), /at most 60 items|meeting is full/);
assert.equal(run('getState').meeting.items.length, 6, 'a refused save changes nothing');
lockFree = false;
assert.throws(() => run('saveChanges', meeting.id, [{ type: 'meeting', title: 'x' }]), /Another screen is saving/);
lockFree = true;

// ---- The next meeting: open follow-ups, items moved to it, and the attendee list come along ----
run('saveChanges', meeting.id, [
  { type: 'status', id: meeting.items[4].id, status: 'tabled' },
  { type: 'addAction', action: { id: 'act00002', text: 'Already handled', owner: 'Pat Example' } },
  { type: 'editAction', id: 'act00002', done: true },
  { type: 'attendees', list: plain(M.parseAttendees('Pat Example (President), Sam Sample (Treasurer), Lee Visitor (Guest)', ids)) }
]);
const first = run('getState').meeting;
clock += 28 * 86400000;
state = run('startMeeting', { date: '2026-12-19', carry: true, agenda: [{ title: 'Holiday hours', details: '' }] });
const next = state.meeting;
assert.notEqual(next.id, first.id);
assert.equal(next.title, 'CTTC Executive Committee Meeting', 'the default title');
assert.deepEqual(next.items.map(it => [it.title, it.carried, it.added]), [['Holiday hours', false, false], ['Saturday round robin?', true, false]]);
assert.deepEqual(next.actions.map(a => [a.text, a.owner, a.carried, a.done]), [['Post the closures on the site', 'Sam Sample', '2026-11-21', false]]);
assert.deepEqual(next.attendees.map(p => [p.name, p.present]), [['Pat Example', false], ['Sam Sample', false]], 'last meeting\'s attendees come back expected, to check in; guests do not');
assert.deepEqual(state.meetings.map(e => e.date), ['2026-12-19', '2026-11-21'], 'newest first');

// The tracker: a follow-up brought forward is one follow-up (same ref), shown from the meeting it was made in and
// living in the latest meeting; a done one stays in its own meeting.
let tracked = run('listFollowUps');
assert.deepEqual(tracked.rows.map(r => [r.action.text, r.fromDate, r.meetingDate, r.action.done]), [
  ['Post the closures on the site', '2026-11-21', '2026-12-19', false],
  ['Already handled', '2026-11-21', '2026-11-21', true]
]);
assert.equal(tracked.rows[0].ref, 'act00001', 'the ref is the id it was made with');
assert.equal(tracked.current, next.id);
// A change from the tracker to a follow-up in an earlier meeting saves there, and leaves the meeting on screen alone.
const before = run('followTick', null).stamp;
let saved2 = run('updateFollowUp', first.id, 'act00002', [{ type: 'actionUpdate', id: 'act00002', update: { id: 'upd00001', text: 'Confirmed by email' }, by: 'Pat Example' }]);
assert.equal(saved2.row.action.updates[0].text, 'Confirmed by email');
assert.equal(props.get('MEETING_CURRENT'), next.id, 'the meeting on screen stays on screen');
assert.equal(run('followTick', null).stamp, before, 'and its screens are not told anything changed');
// One in the meeting on screen: its screens follow.
const live = next.actions[0];
saved2 = run('updateFollowUp', next.id, live.id, [{ type: 'actionUpdate', id: live.id, update: { id: 'upd00002', text: 'Asked the webmaster' }, started: true, by: 'Sam Sample' }]);
assert.equal(saved2.row.action.status, 'progress', 'a first update moves an open follow-up to In progress');
assert.notEqual(run('followTick', before).stamp, before, 'the screens of the meeting on screen follow');
assert.throws(() => run('updateFollowUp', next.id, live.id, [{ type: 'removeAction', id: live.id }]), /follow-ups only/, 'the tracker cannot delete or change anything else');
assert.throws(() => run('updateFollowUp', next.id, live.id, [{ type: 'editAction', id: 'someother1' }]), /follow-ups only/);
tracked = run('listFollowUps');
assert.deepEqual(tracked.rows[0].action.updates.map(u => u.text), ['Asked the webmaster']);
assert.deepEqual(run('saveChanges', first.id, [{ type: 'meeting', title: 'old' }]).moved, true, 'a change made on a meeting no longer on screen is not applied');
assert.equal(run('getState').meeting.id, next.id);
assert.throws(() => run('deleteMeeting', next.id), /on screen/);
state = run('openMeeting', first.id);
assert.equal(state.meeting.id, first.id, 'an earlier meeting can be put back on screen');
assert.equal(run('followTick', next.id + ':' + next.version).meeting.id, first.id, 'and the board follows');
state = run('openMeeting', next.id);
state = run('deleteMeeting', first.id);
assert.deepEqual(state.meetings.map(e => e.id), [next.id]);
assert.equal([...props.keys()].some(key => key.indexOf(first.id) >= 0), false, 'a deleted meeting leaves nothing behind');

// ---- doGet: two pages, framed only by the club site ----
let output = server.doGet({ parameter: {} });
assert.equal(lastTemplate.name, 'Control');
assert.equal(output.title, 'DEV - CTTC Executive Committee Meeting');
assert.equal(output.frame, 'ALLOWALL');
assert.equal(lastTemplate.model, server.MeetingModel_.toString(), 'the page gets the server\'s own model');
output = server.doGet({ parameter: { view: 'board' } });
assert.equal(lastTemplate.name, 'Board');
assert.equal(output.title, 'CTTC Meeting Board');
assert.match(files.Guard, /concordtabletennisclub\\\.com/);
assert.match(files.Guard, /cttcMeeting: 'ready'/, 'tells meeting.html it opened');
['Control', 'Board'].forEach(name => {
  assert.match(files[name], /<\?!= include_\('Guard'\) \?>/, name + ' covers itself when framed by anyone but the club site');
  assert.match(files[name], /<\?!= include_\('Sync'\) \?>/);
  assert.match(files[name], /id="status"/, 'npm run desk:google -- --app meeting waits for #status');
});

// ---- meeting.html on the club site: frames the released app, passes only view=board on ----
{
  const site = fs.readFileSync(path.join(dir, '..', 'meeting.html'), 'utf8');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(site)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-src https:\/\/script\.google\.com(;|$)/, 'only Google can be framed');
  assert.match(site, /<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(site, /<script[^>]*\ssrc=|<iframe[^>]*\ssrc=/, 'nothing loaded from elsewhere; the frame address is set by the script');
  assert.match(site, /<iframe id="meeting"[^>]*\sallow="fullscreen[;"]/, 'the board\'s Full screen works through the site frame');
  assert.match(files.Board, /\.waiting \{ position: absolute; inset: 0 0 7vh; pointer-events: none;/, 'the waiting message never covers Full screen in the bottom bar');
  const script = /<script>([\s\S]*?)<\/script>/.exec(site)[1];
  const appUrl = /var APP_URL = '([^']*)';/.exec(script)[1];
  assert.match(appUrl, /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/, 'the released /exec address, never /dev');
  const runSite = (search, url) => {
    const els = {};
    const el = id => els[id] = els[id] || { id, hidden: true, textContent: '', href: '', src: '', addEventListener() {} };
    const listens = [];
    const doc = { title: '', hidden: false, getElementById: el, querySelector: () => el('x'), addEventListener: name => listens.push(name) };
    const win = { addEventListener() {} };
    const asked = [];
    const navigator = { wakeLock: { request: kind => { asked.push(kind); return { then: ok => { ok({ addEventListener() {} }); return { catch() {} }; } }; } } };
    vm.runInNewContext(script.replace(/var APP_URL = '[^']*';/, "var APP_URL = '" + url + "';"), { URL, URLSearchParams, location: { search }, document: doc, window: win, navigator, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0 });
    els.asked = asked;
    els.listens = listens;
    return els;
  };
  const released = 'https://script.google.com/macros/s/RELEASED/exec';
  assert.equal(runSite('', released).meeting.src, released, 'the controls');
  assert.equal(runSite('?view=board&x=1', released).meeting.src, released + '?view=board', 'the board, and nothing else from the link');
  assert.equal(runSite('?view=other', released).meeting.src, released);
  // The projector board keeps the screen on: the site page holds the wake lock, and asks again when it comes back into
  // view; the controls do not.
  const board = runSite('?view=board', released);
  assert.deepEqual(board.asked, ['screen'], 'the board view asks for the screen wake lock');
  assert.ok(board.listens.includes('visibilitychange'), 'and asks again when the page comes back into view');
  assert.equal(board.awake.hidden, true, 'no note while the lock is held');
  assert.deepEqual(runSite('', released).asked, [], 'the controls let the screen sleep as usual');
  assert.match(site, /<iframe id="meeting"[^>]*allow="fullscreen; screen-wake-lock"/);
  assert.match(files.Board, /navigator\.wakeLock\.request\('screen'\)/, 'the board asks too, as the desk\'s Player board does');
  const unreleased = runSite('', '');
  assert.equal(unreleased.meeting.src, '', 'before the first release nothing is framed');
  assert.equal(unreleased.signin.hidden, false, 'and the page says the app is not released yet');
  assert.match(unreleased['signin-title'].textContent, /not released yet/);
}

// ---- Both pages in a browser, wired to this fake Google ----
function pageHtml(name) {
  const html = server.doGet({ parameter: name === 'Board' ? { view: 'board' } : {} }).getContent();
  assert.doesNotMatch(html, /<\?/, name + ': every template tag is filled, in the page and in every piece it includes');
  assert.match(html, /var Model = \(function MeetingModel_\(\)/, name + ': the page runs the server\'s model');
  assert.match(html, /var APP_URL = 'https:\/\/script\.google\.com\/macros\/s\/TEST\/dev';/);
  // Follow faster than on a projector, so the test does not wait seconds.
  assert.ok(html.includes(name === 'Board' ? 'var BEAT_MS = 3000;' : 'var POLL_MS = 2500;'), name + ': the follow beat this test speeds up');
  return html.replace('var BEAT_MS = 3000;', 'var BEAT_MS = 20;').replace('var POLL_MS = 2500;', 'var POLL_MS = 25;');
}
const channels = new Set();
class FakeChannel {
  constructor(name) { this.name = name; this.onmessage = null; channels.add(this); this.window = null; }
  postMessage(data) { const copy = plain(data); channels.forEach(c => { if (c !== this && c.name === this.name && c.onmessage) setTimeout(() => c.onmessage({ data: copy }), 0); }); }
}
const calls = [];
function open(name, sameComputer) {
  const dom = new JSDOM(pageHtml(name), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://n-test-0lu-script.googleusercontent.com/userCodeAppPanel',
    beforeParse(window) {
      const runner = (ok, fail) => new Proxy({}, {
        get(target, fn) {
          if (fn === 'withSuccessHandler') return h => runner(h, fail);
          if (fn === 'withFailureHandler') return h => runner(ok, h);
          return (...args) => setTimeout(() => {
            calls.push(name + ':' + String(fn));
            let result;
            try { result = run(fn, ...args); } catch (error) { if (fail) fail(new window.Error(error.message)); return; }
            if (ok) ok(result);
          }, 2);
        }
      });
      window.google = { script: { run: runner(null, null) } };
      window.BroadcastChannel = sameComputer ? FakeChannel : undefined;
      window.print = () => { window.printed = true; };
      // The desk's player directory, as the club site publishes it (data/player-index.json).
      window.fetch = url => { window.fetched = url; return Promise.resolve({ ok: true, json: () => Promise.resolve(['Pat Example', 'Sam Sample', 'Sammy Second', 'Alex Demo']) }); };
      window.open = (url, target) => { window.opened = { url, target }; return {}; };
      if (!window.crypto || !window.crypto.getRandomValues) window.crypto = require('node:crypto').webcrypto;
      const dialog = window.HTMLDialogElement && window.HTMLDialogElement.prototype;
      if (dialog && !dialog.showModal) { dialog.showModal = function () { this.open = true; }; dialog.close = function () { this.open = false; }; }
    }
  });
  return dom;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, what, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (test()) return; await wait(10); }
  assert.fail('timed out waiting for ' + what);
}

(async () => {
  // A fresh store: the controller opens with no meeting, so it asks to start one.
  props.clear(); cache = new Map(); clock = Date.parse('2026-11-21T19:30:00Z');
  const control = open('Control', true);
  const boardHere = open('Board', true);
  const boardThere = open('Board', false);
  const c = control.window.document;
  const here = boardHere.window.document;
  const there = boardThere.window.document;
  const click = (doc, selector) => { const el = doc.querySelector(selector); assert.ok(el, 'found ' + selector); el.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true })); };
  const type = (doc, selector, value, event = 'input') => { const el = doc.querySelector(selector); el.value = value; el.dispatchEvent(new doc.defaultView.Event(event, { bubbles: true })); };

  // First open on a computer: what is this screen for? (asked once, like the desk's Player board)
  await until(() => c.getElementById('status').hidden, 'the controller to open');
  assert.equal(c.getElementById('chooser').hidden, false, 'a new computer is asked what it is for');
  assert.equal(c.getElementById('start-dlg').open, false, 'before anything else');
  assert.equal(c.getElementById('choose-board').getAttribute('href'), 'https://script.google.com/macros/s/TEST/dev?view=board', 'Projector opens the board (through the club site when framed there)');
  assert.equal(c.getElementById('choose-board').getAttribute('target'), '_top');
  click(c, '#choose-control');
  assert.equal(control.window.localStorage.getItem('cttc-meeting-screen'), 'control', 'the answer is kept on this computer');
  assert.equal(here.getElementById('stop-follow').getAttribute('href'), 'https://script.google.com/macros/s/TEST/dev', 'the board\'s Stop following goes back to the controls');
  await until(() => c.getElementById('start-dlg').open, 'the start dialog on a first open');
  assert.equal(c.getElementById('status').hidden, true);
  assert.equal(c.getElementById('start-date').value, '2026-11-21');
  assert.equal(c.getElementById('carry-row').hidden, true, 'nothing to bring forward the first time');
  await until(() => !here.getElementById('waiting').hidden, 'the board waiting for a meeting');

  // The planned agenda, pasted. The review lists each line; one sub-point is made an item before starting. What the
  // person confirmed in that list is what Google saves.
  type(c, '#start-agenda', pasted);
  const rows = [...c.querySelectorAll('#start-preview li')];
  assert.equal(rows.length, 8);
  assert.equal(c.getElementById('start-summary').textContent, '5 items');
  click(c, '#start-preview li[data-n="2"] [data-flip]');
  assert.equal(c.getElementById('start-summary').textContent, '6 items');
  click(c, '#start-go');
  await until(() => !c.getElementById('start-dlg').open, 'the meeting to start');
  meeting = run('getState').meeting;
  assert.deepEqual(meeting.items.map(it => it.title), ['Closure dates', 'December 3 - 6 (part of the gym)', 'Operations feedback from the first two months', 'Cashless next year', 'New website features', 'Saturday round robin?']);
  assert.equal(meeting.items[0].details, 'Nov 13, Friday');
  assert.equal(c.querySelectorAll('#items .item').length, 6);

  // Both boards show it: the one on this computer at once, the other on its next beat.
  await until(() => here.querySelectorAll('#b-items .b-item').length === 6, 'the board here');
  await until(() => there.querySelectorAll('#b-items .b-item').length === 6, 'the board on another computer');
  assert.match(here.querySelector('#b-items .b-item .b-details').textContent, /Nov 13, Friday/, 'sub-points show under their item');

  // Discuss item 1, add a follow-up (it belongs to the item under discussion), check item 1 off.
  click(c, '#now-start');
  await until(() => c.querySelector('#items .item.current'), 'Now on item 1');
  assert.equal(c.getElementById('action-item').value, meeting.items[0].id, 'a new follow-up belongs to the item being discussed');
  type(c, '#action-text', 'Post the closures on the site');
  type(c, '#action-owner', 'Sam Sample');
  c.getElementById('add-action').dispatchEvent(new control.window.Event('submit', { bubbles: true, cancelable: true }));
  click(c, '#now-next');
  assert.equal(c.querySelector('#items .item').classList.contains('done'), true, 'the controller shows it at once');
  assert.equal(c.querySelectorAll('#items .item')[1].classList.contains('current'), true, 'and moves Now to the next item');
  await until(() => here.querySelector('#b-items .b-item.done'), 'the board here to check it off');
  assert.equal(here.querySelectorAll('#b-items .b-item')[1].classList.contains('current'), true);
  assert.match(here.getElementById('b-actions').textContent, /Post the closures on the site/);
  assert.match(here.querySelector('#b-actions .owner').textContent, /Sam Sample/, 'the owner shows with the follow-up');
  assert.equal(here.getElementById('n-done').textContent, '1');
  assert.equal(here.getElementById('n-left').textContent, '5');
  await until(() => there.querySelector('#b-items .b-item.done'), 'the board on another computer to check it off');
  assert.equal(there.querySelector('#b-items .b-item.done .ball.on') !== null, true);

  // Text is shown as text on both screens.
  type(c, '#new-item', '<img src=x onerror="window.bad=1">Budget & dues', 'input');
  c.getElementById('add-item').dispatchEvent(new control.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => there.querySelectorAll('#b-items .b-item').length === 7, 'the added item on the board');
  assert.equal(there.querySelector('#b-items img'), null);
  assert.equal(c.querySelector('#items img'), null);
  assert.match(there.querySelectorAll('#b-items .b-item')[6].textContent, /<img src=x.*Budget & dues/);
  assert.match(there.querySelectorAll('#b-items .b-item')[6].innerHTML, /tag added/, 'an item added during the meeting is marked Added');

  // An item edited in its editor; a change from a second controller reaches this one.
  click(c, '#items .item:nth-child(3) .item-main');
  const titleField = c.querySelector('#items .item:nth-child(3) [data-field="title"]');
  assert.ok(titleField, 'clicking an item opens its editor');
  type(c, '#items .item:nth-child(3) [data-field="title"]', 'Operations feedback', 'change');
  await until(() => run('getState').meeting.items[2].title === 'Operations feedback', 'the edit saved');
  const current = run('getState').meeting;
  run('saveChanges', current.id, [{ type: 'addAction', action: { id: 'other0001', text: 'Draft the rate proposal', owner: '' } }]);
  await until(() => /Draft the rate proposal/.test(c.getElementById('actions').textContent), 'the second controller\'s follow-up on this one');
  assert.match(c.getElementById('actions').textContent, /Owner needed/, 'a follow-up with no owner says so');
  await until(() => /Owner needed/.test(there.getElementById('b-actions').textContent), 'and on the board');

  // Check-in from the desk's player directory: typing finds names, Enter checks the first one in; a name not in the
  // directory checks in as typed; a guest is marked Guest. The board's attendee panel lists who is present.
  assert.equal(control.window.fetched, 'https://concordtabletennisclub.com/data/player-index.json');
  type(c, '#checkin-name', 'sam');
  assert.deepEqual([...c.querySelectorAll('#checkin-matches button')].map(b => b.getAttribute('data-name')), ['Sam Sample', 'Sammy Second']);
  c.getElementById('checkin').dispatchEvent(new control.window.Event('submit', { bubbles: true, cancelable: true }));
  type(c, '#checkin-name', 'Pat Ex');
  click(c, '#checkin-matches button[data-name="Pat Example"]');
  type(c, '#checkin-name', 'Lee Visitor');
  c.getElementById('checkin-guest').checked = true;
  c.getElementById('checkin').dispatchEvent(new control.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual([...c.querySelectorAll('#att-chips .chip .chip-name')].map(x => x.textContent), ['Sam Sample', 'Pat Example', 'Lee Visitor']);
  assert.equal(c.getElementById('att-count').textContent, '3 present');
  type(c, '#checkin-name', 'sam');
  assert.deepEqual([...c.querySelectorAll('#checkin-matches button')].map(b => b.getAttribute('data-name')), ['Sammy Second'], 'someone checked in is not offered again');
  type(c, '#checkin-name', '');
  click(c, '#att-chips .chip:nth-child(2) [data-act="present"]');
  assert.equal(c.getElementById('att-count').textContent, '2 present · 1 expected', 'a click on the ball checks out');
  click(c, '#att-chips .chip:nth-child(2) [data-act="present"]');
  await until(() => (run('getState').meeting.attendees || []).filter(p => p.present).length === 3, 'the check-ins saved');
  assert.equal(run('getState').meeting.attendees[2].role, 'Guest');

  // Projector screen: each choice on the controller reaches the board here and the one on another computer.
  click(c, '#screen-toggle');
  assert.equal(c.getElementById('screen-panel').hidden, false);
  click(c, '[data-display="people"] [data-value="open"]');
  await until(() => there.querySelector('.people.open'), 'the attendee panel on the board');
  assert.deepEqual([...there.querySelectorAll('.people-list .owner')].map(x => x.textContent.replace(/^[A-Z?]{1,2}/, '')), ['Sam Sample', 'Pat Example', 'Lee Visitor']);
  assert.match(there.querySelector('.people-list').textContent, /Guests/, 'guests listed under their own heading');
  click(c, '[data-display="people"] [data-value="tab"]');
  await until(() => there.querySelector('.people.tab') && /3\s*present/.test(there.querySelector('.people.tab').textContent), 'the folded tab with the count');
  click(c, '#scale-up');
  click(c, '#scale-up');
  assert.equal(c.getElementById('scale-value').textContent, '120%');
  // Past 150% the steps are 25%, up to 300%.
  for (let i = 0; i < 20; i += 1) click(c, '#scale-up');
  assert.equal(c.getElementById('scale-value').textContent, '300%');
  assert.equal(c.getElementById('scale-up').disabled, true);
  for (let i = 0; i < 9; i += 1) click(c, '#scale-down');
  assert.equal(c.getElementById('scale-value').textContent, '120%');
  await until(() => there.body.style.getPropertyValue('--scale') === '1.2', 'the text size on the board');
  click(c, '[data-display="layout"] [data-value="spotlight"]');
  await until(() => there.querySelector('.spot-title'), 'the spotlight');
  const now = run('getState').meeting;
  const at = now.items.findIndex(it => it.id === now.current);
  assert.match(there.querySelector('.spot-title').textContent, new RegExp(now.items[at].title.replace(/[()?]/g, '.')), 'the item being discussed, big');
  click(c, '[data-display="layout"] [data-value="focus"]');
  await until(() => there.querySelector('.b-folded'), 'focus folds the discussed items');
  assert.match(there.querySelector('.b-folded').textContent, /1 discussed: 1\. Closure dates/);
  click(c, '[data-display="layout"] [data-value="recap"]');
  await until(() => there.querySelector('.recap-group'), 'the follow-ups by owner');
  assert.match(there.querySelector('.recap').textContent, /Sam Sample[\s\S]*Post the closures/);
  click(c, '[data-display="layout"] [data-value="full"]');
  click(c, '[data-display="follow"] [data-value="false"]');
  await until(() => there.querySelector('#b-items') && !there.querySelector('#b-actions'), 'the agenda alone');
  click(c, '[data-display="follow"] [data-value="true"]');
  await until(() => there.querySelector('#b-actions'), 'the follow-ups back');

  // Two controllers: each names itself; what one adds glows on the other with its name, a removal is a small note, and
  // a deep dive fills the board with the points both of them add.
  type(c, '#my-name', 'Pat Example', 'change');
  const second = open('Control', false);
  const c2 = second.window.document;
  await until(() => c2.getElementById('status').hidden, 'the second controller to open');
  type(c2, '#chooser-name', 'Sam Sample', 'change');
  click(c2, '#choose-control');
  await until(() => c2.querySelectorAll('#items .item').length === 7, 'the second controller showing the agenda');
  type(c2, '#new-item', 'Volunteer schedule');
  c2.getElementById('add-item').dispatchEvent(new second.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => c.querySelector('#items .item.marked .by-badge'), 'the first controller marking the new item');
  assert.equal(c.querySelector('#items .item.marked .by-badge').textContent, 'Sam Sample');
  assert.match(c.querySelector('#items .item.marked').textContent, /Volunteer schedule/);
  await until(() => /SS/.test(c.getElementById('others').textContent), 'who else is here');
  assert.equal(c2.querySelector('#items .by-badge'), null, 'a controller\'s own changes are not marked');
  const volunteers = run('getState').meeting.items.find(it => it.title === 'Volunteer schedule');
  assert.equal(volunteers.by, 'Sam Sample');
  click(c, '#items .item:last-child .item-main');
  click(c, '#items .item:last-child [data-act="dive"]');
  await until(() => !c2.getElementById('dive').hidden, 'the deep dive on the second controller');
  await until(() => there.querySelector('.layout-topic, body.layout-topic') || /layout-topic/.test(there.body.className), 'the board pivoting to the topic');
  assert.match(there.querySelector('.spot-title').textContent, /Volunteer schedule/);
  type(c2, '#dive-text', 'Fridays need two closers');
  c2.getElementById('dive-form').dispatchEvent(new second.window.Event('submit', { bubbles: true, cancelable: true }));
  type(c, '#dive-text', 'Ask the Saturday regulars');
  c.getElementById('dive-form').dispatchEvent(new control.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => there.querySelectorAll('#b-points li .pt-text').length === 2, 'both points on the board');
  assert.deepEqual([...there.querySelectorAll('#b-points .pt-by')].map(x => x.textContent).sort(), ['Pat Example', 'Sam Sample']);
  await until(() => c.querySelectorAll('#points li[data-id]').length === 2 && c2.querySelectorAll('#points li[data-id]').length === 2, 'both points on both controllers (' + c.querySelectorAll('#points li[data-id]').length + ',' + c2.querySelectorAll('#points li[data-id]').length + ',' + c.getElementById('dive').hidden + ',' + c2.getElementById('sync').textContent + ')');
  click(c2, '#dive-end');
  await until(() => !/layout-topic/.test(there.body.className), 'the board back to the agenda');
  click(c2, '#items .item:last-child .item-main');
  click(c2, '#items .item:last-child [data-act="delete"]');
  click(c2, '#items .item:last-child [data-act="delete"]');
  await until(() => /Sam Sample removed/.test(c.getElementById('toasts').textContent), 'a note that the other controller removed it');
  assert.match(run('getState').meeting.activity.map(a => a.by + ' ' + a.what).join('|'), /Sam Sample added\|.*Pat Example started a deep dive on/);
  second.window.close();

  // Save: sends what is waiting, then says it is safe to reload, naming text typed in an Add box but not added.
  type(c, '#action-text', 'Half-typed follow-up');
  click(c, '#save-now');
  await until(() => /Everything is saved/.test(c.getElementById('status').textContent), 'Save to confirm');
  assert.match(c.getElementById('status').textContent, /Safe to reload\. Not added yet: text in the follow-up box/);
  type(c, '#action-text', '');
  click(c, '#items .item:nth-child(2) .item-main');
  const notes = c.querySelector('#items .item:nth-child(2) [data-field="notes"]');
  notes.value = 'Typed, then Save before leaving the field';
  notes.focus();
  click(c, '#save-now');
  await until(() => /Everything is saved \([^)]*\)\. Safe to reload\.$/.test(c.getElementById('status').textContent), 'Save to commit the field being typed in');
  assert.equal(run('getState').meeting.items[1].notes, 'Typed, then Save before leaving the field', 'Save finishes the field being typed in');

  // The tracker: every follow-up once, by owner; a first update moves one to In progress; Done from the tracker
  // shows on the controls of the meeting on screen.
  click(c, '#open-tracker');
  await until(() => c.querySelectorAll('#trk-list .trk').length > 0, 'the tracker');
  assert.equal(c.getElementById('tracker').hidden, false);
  const trkTexts = () => [...c.querySelectorAll('#trk-list .trk .trk-text')].map(x => x.textContent);
  assert.ok(trkTexts().includes('Post the closures on the site'));
  assert.match(c.querySelector('#trk-list .trk-group .trk-owner').textContent, /Sam Sample|Owner needed/);
  const row = [...c.querySelectorAll('#trk-list .trk')].find(li => /Post the closures/.test(li.textContent));
  const ref = row.getAttribute('data-ref');
  click(c, '#trk-list .trk[data-ref="' + ref + '"] .trk-main');
  const upd = c.querySelector('#trk-list .trk[data-ref="' + ref + '"] [data-tf-form] input');
  upd.value = 'Posted the December dates';
  c.querySelector('#trk-list .trk[data-ref="' + ref + '"] [data-tf-form]').dispatchEvent(new control.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => /In progress/.test((run('listFollowUps').rows.find(r => r.ref === ref) || { action: {} }).action.status === 'progress' ? 'In progress' : ''), 'the update saved');
  await until(() => c.querySelector('#trk-list .trk[data-ref="' + ref + '"] select.status').value === 'progress', 'the tracker showing In progress');
  await until(() => /In progress/.test(c.getElementById('actions').textContent), 'the controls showing In progress');
  click(c, '#trk-list .trk[data-ref="' + ref + '"] [data-tact="done"]');
  await until(() => c.querySelector('#trk-list .trk[data-ref="' + ref + '"]') === null, 'a done follow-up leaving the Open list');
  click(c, '#trk-show [data-value="done"]');
  assert.ok(trkTexts().includes('Post the closures on the site'), 'and showing under Done');
  await until(() => c.querySelector('#actions .action.done'), 'the controls showing it done');
  type(c, '#trk-search', 'nothing like this');
  assert.match(c.getElementById('trk-list').textContent, /No follow-ups match/);
  type(c, '#trk-search', '');
  click(c, '#trk-close');
  assert.equal(c.getElementById('tracker').hidden, true);

  // Minutes and the projector window.
  click(c, '#open-minutes');
  assert.match(c.getElementById('minutes-text').value, /\[x\] Closure dates/);
  assert.match(c.getElementById('minutes-text').value, /Sam Sample: Post the closures on the site/);
  click(c, '#minutes-print');
  assert.equal(control.window.printed, true);
  assert.match(c.getElementById('print-area').innerHTML, /Follow-ups/);
  click(c, '#open-board');
  assert.deepEqual(control.window.opened, { url: 'https://script.google.com/macros/s/TEST/dev?view=board', target: 'cttc-meeting-board' }, 'Board window opens the board on this computer (opened directly, at this app\'s own address)');
  assert.equal(control.window.bad, undefined);
  assert.equal(boardThere.window.bad, undefined);

  // The board's quiet beats read the cache only.
  await wait(80);
  counts.propReads = 0;
  await wait(120);
  assert.equal(counts.propReads, 0, 'while nothing changes, following reads no properties');

  [control, boardHere, boardThere].forEach(dom => dom.window.close());
  console.log('Meeting app checks passed');
  process.exit(0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
