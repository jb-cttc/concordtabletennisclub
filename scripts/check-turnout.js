'use strict';

// The Tonight page (tonight.html) and the turnout logic it shares with the public turnout app (turnout.js, copied to
// turnout-app/Turnout.js). Made-up names only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const T = require('../turnout');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

assert.equal(read('turnout-app/Turnout.js'), read('turnout.js'), 'turnout-app/Turnout.js is an exact copy of turnout.js: cp turnout.js turnout-app/Turnout.js');
assert.match(read('.github/workflows/update-data.yml'), /cp \*\.html style\.css navtoggle\.js standings\.js turnout\.js favicon\.svg _site\//, 'the site publishes turnout.js');

// ---- Rating zones: the bottom of each range is in it, the top is not ----
[[0, 0], [599, 0], [600, 1], [799, 1], [800, 2], [999, 2], [1000, 3], [1199, 3], [1200, 4], [1399, 4], [1400, 5],
  [1599, 5], [1600, 6], [2600, 6], [-5, 0], ['850', 2]].forEach(([rating, zone]) => assert.equal(T.bracketIndex(rating), zone, String(rating)));
[null, undefined, '', 'n/a', NaN].forEach(rating => assert.equal(T.bracketIndex(rating), -1, 'no rating, no zone'));
assert.deepEqual(T.BRACKETS.map(b => b.label), ['Under 600', '600–799', '800–999', '1000–1199', '1200–1399', '1400–1599', '1600+']);
assert.equal(T.nameKey('  José  O\'Neil-Smith '), 'jose o neil smith');
assert.equal(T.nameKey('J. B. Birch'), T.nameKey('J B Birch'));

// ---- Which night: today until the gym closes, skipping closures ----
const closures = { days: { '2026-10-26': 'full', '2026-10-28': 'partial' } };
assert.deepEqual(T.sessionNight({ date: '2026-10-21', minutes: 9 * 60 }, closures), { date: '2026-10-21', phase: 'signup' });
assert.deepEqual(T.sessionNight({ date: '2026-10-21', minutes: 19 * 60 + 14 }, closures), { date: '2026-10-21', phase: 'signup' });
assert.deepEqual(T.sessionNight({ date: '2026-10-21', minutes: 19 * 60 + 15 }, closures), { date: '2026-10-21', phase: 'underway' }, 'sign-up closes at 7:15');
assert.deepEqual(T.sessionNight({ date: '2026-10-21', minutes: 22 * 60 }, closures), { date: '2026-10-28', phase: 'ahead' }, 'after 10 PM: the next open night, past a closed Monday; a partial day still plays');
assert.deepEqual(T.sessionNight({ date: '2026-10-23', minutes: 600 }, {}), { date: '2026-10-26', phase: 'ahead' }, 'Friday looks to Monday');
assert.equal(T.sessionNight({ date: '2026-10-21', minutes: 600 }, { days: Object.fromEntries(Array.from({ length: 28 }, (_, i) => [T.addDays('2026-10-21', i), 'full'])) }), null);

// ---- Likelihood: recent same-weekday nights count most ----
const mondays = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
const wednesdays = mondays.map(d => T.addDays(d, 2)).filter(d => d < '2026-10-21');
const roster = {};
mondays.forEach((d, i) => { roster[d] = ['Ada Every', 'Bo Mondays', 'Cy Lapsed'].concat(i < 4 ? ['Di Gone'] : []); });
wednesdays.forEach(d => { roster[d] = ['Ada Every', 'Cy Lapsed']; });
roster['2026-10-14'] = ['Ada Every'];
roster['2025-01-06'] = ['Old Timer'];
roster['2026-10-26'] = ['From The Future'];
roster['2026-09-20'] = ['Sunday Only'];
const chance = T.likelihood(roster, '2026-10-26');
assert.ok(chance['Ada Every'] >= T.LIKELY_AT, 'every Monday and Wednesday: likely');
assert.ok(chance['Bo Mondays'] < T.LIKELY_AT && chance['Bo Mondays'] > 0.6, 'every Monday but no Wednesdays: probable, not likely');
assert.ok(chance['Cy Lapsed'] < chance['Ada Every'], 'missing the latest Wednesday costs');
assert.ok(chance['Di Gone'] < 0.35, 'stopped coming a month ago');
assert.equal(chance['Old Timer'], undefined, 'only the last eight nights of each weekday count');
assert.equal(chance['From The Future'], undefined, 'nothing on or after the night itself');
assert.equal(chance['Sunday Only'], undefined, 'only Monday and Wednesday nights');
assert.deepEqual(T.likelyNames(roster, '2026-10-26'), ['Ada Every']);
assert.equal(T.LIKELY_AT, 0.9);

// ---- Tally: counts only, each person once at their firmest status ----
const tally = T.tally([
  { key: 'p1', rating: 1050, status: 'likely', chance: 0.95 },
  { key: 'p1', rating: 1050, status: 'here' },
  { key: 'p2', rating: 1100, status: 'texted' },
  { key: 'p2', rating: 1100, status: 'maybe', chance: 0.5 },
  { key: 'p3', rating: 1600, status: 'likely', chance: 0.92 },
  { key: 'p4', rating: 1610, status: 'maybe', chance: 0.6 },
  { key: 'p5', rating: 1620, status: 'maybe', chance: 0.3 },
  { key: 'p6', rating: 550, status: 'maybe', chance: 0.2 },
  { key: 'v1', rating: null, status: 'texted' },
  { key: 'v2', rating: null, status: 'here' },
  { key: 'n1', rating: null, status: 'likely', chance: 0.99 },
  { key: '', rating: 900, status: 'here' },
  { key: 'x', rating: 900, status: 'waving' }
]);
assert.deepEqual(tally.brackets[3], { label: '1000–1199', min: 1000, max: 1200, here: 1, texted: 1, likely: 0, expected: 2 });
assert.deepEqual(tally.brackets[6], { label: '1600+', min: 1600, max: null, here: 0, texted: 0, likely: 1, expected: 2 }, '0.92 + 0.6 + 0.3 rounds to 2');
assert.equal(tally.brackets[0].expected, 0, 'a 0.2 chance rounds to nobody');
assert.equal(tally.brackets[2].here, 0, 'no key or an unknown status is not counted');
assert.deepEqual(tally.unrated, { here: 1, texted: 1 }, 'a likely player with no rating is left out');
assert.equal(T.tally([{ key: 'a', rating: 700, status: 'likely', chance: 0.4 }]).brackets[1].expected, 1, 'expected is never below those shown');

// ---- The night's total: recent turnout on the same weekday, shared out by chance ----
const sizes = {};
['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'].forEach((d, i) => { sizes[d] = Array.from({ length: 20 + i * 4 }, (_, k) => 'P' + k); });
sizes['2026-10-14'] = Array.from({ length: 99 }, (_, k) => 'W' + k);
const weights = [1, 0.9, 0.81, 0.729];
assert.ok(Math.abs(T.expectedTotal(sizes, '2026-10-26') - (32 * 1 + 28 * 0.9 + 24 * 0.81 + 20 * 0.729) / weights.reduce((a, b) => a + b)) < 1e-9, 'recent Mondays count most; Wednesdays not at all');
assert.equal(T.expectedTotal(sizes, '2026-09-28'), null, 'no earlier Monday, no total');

const crowd = [
  { key: 'h1', rating: 1100, status: 'here' },
  { key: 't1', rating: null, status: 'texted' },
  { key: 'm1', rating: 1100, status: 'maybe', chance: 0.5 },
  { key: 'm2', rating: 500, status: 'maybe', chance: 0.5 },
  { key: 'l1', rating: 1700, status: 'likely', chance: 0.95 },
  { key: 'm3', rating: 1700, status: 'maybe', chance: 0.05 },
  { key: 'u1', rating: null, status: 'maybe', chance: 0.5 }
];
const sumOf = t => t.brackets.reduce((sum, b) => sum + b.expected, 0) + t.unrated.here + t.unrated.texted;
let split = T.tally(crowd, 9.5);
// 2 playing; 7.5 more shared by chance (2.5 in all, 0.5 of it with no rating): x3.
assert.deepEqual(split.brackets.map(b => b.expected), [2, 0, 0, 2, 0, 0, 3], 'under 600: 1.5; 1000-1199: 1 + 1.5; 1600+: 3; 7 in all, and the tied half goes to the lower zone');
assert.equal(sumOf(split), 8, 'the share of players with no rating is not drawn in any zone');
split = T.tally(crowd, 1);
assert.deepEqual(split.brackets.map(b => b.expected), [0, 0, 0, 1, 0, 0, 1], 'more already playing than usual: only who is playing, and the likely');
split = T.tally(crowd.filter(p => p.key !== 'u1'), 27.4);
assert.equal(sumOf(split), 27, 'whole people per zone that add up to the forecast');

// ---- The page ----
const html = read('tonight.html');
const turnoutUrl = /var TURNOUT_URL = "([^"]*)";/.exec(html);
assert.ok(turnoutUrl, 'the app address is set in one place');
assert.ok(turnoutUrl[1] === '' || /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(turnoutUrl[1]), 'empty, or a released /exec address, never /dev');
assert.ok(html.indexOf('<script src="turnout.js"></script>') > 0);
assert.ok(html.indexOf('id="tonight-summary-wrap"') < html.indexOf('id="gym-floor"'), 'the plain table sits above the floor');
assert.match(read('roundrobins.html'), /href="tonight\.html"/, 'the Round Robins page links to it');
assert.match(read('index.html'), /href="tonight\.html"/, 'the home page links to it');

const pageScript = /<script>\n([\s\S]*?)<\/script>\n\n<\/body>/.exec(html)[1];
const turnoutSource = read('turnout.js');
const publicRoster = JSON.parse(JSON.stringify(roster));
const publicPlayers = { players: [{ name: 'Ada Every', currentRating: 1250 }, { name: 'Bo Mondays', currentRating: 640 }, { name: 'Cy Lapsed', currentRating: 1700 }] };

function page({ now, url = '', answers = [] }) {
  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), { runScripts: 'outside-only', url: 'https://concordtabletennisclub.com/tonight.html', pretendToBeVisual: true });
  const window = dom.window;
  const calls = [];
  const timers = [];
  window.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  window.setInterval = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  window.fetch = (address, options) => {
    calls.push({ address, options });
    let body;
    if (address === 'data/session-roster.json') body = publicRoster;
    else if (address === 'data/players.json') body = publicPlayers;
    else if (address === 'data/closures.json') body = {};
    else if (address === url) body = answers.length ? answers.shift() : null;
    if (body === null || body === undefined) return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(body))) });
  };
  window.eval(turnoutSource);
  window.eval(url ? pageScript.replace('var TURNOUT_URL = "' + turnoutUrl[1] + '";', 'var TURNOUT_URL = "' + url + '";') : pageScript);
  return { window, calls, timers, $: id => window.document.getElementById(id) };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const MONDAY_10AM = Date.parse('2026-10-26T17:00:00Z');

(async function () {
  // Before the app is deployed: the forecast from the published files, and no polling.
  const offline = page({ now: MONDAY_10AM, url: '' });
  await settle();
  assert.equal(offline.$('tonight-title').textContent, 'Who’s playing tonight');
  assert.equal(offline.$('tonight-when').textContent, 'Tonight · Monday, October 26');
  assert.equal(offline.$('tonight-live').hidden, true);
  assert.equal(offline.$('tonight-status').hidden, false, 'says this is the forecast only');
  assert.equal(offline.$('stat-playing').textContent, '0');
  assert.equal(offline.$('stat-likely').textContent, '1', 'Ada');
  assert.equal(offline.timers.length, 0, 'nothing to poll');
  const courts = offline.window.document.querySelectorAll('#gym-floor .court');
  assert.equal(courts.length, 8, 'the front desk and seven zones');
  assert.equal(courts[5].querySelector('.court-label').textContent, '1200–1399');
  assert.equal(courts[5].querySelectorAll('.pp-table').length, 2, 'two tables a zone');
  assert.equal(courts[5].querySelectorAll('.body.is-likely').length, 1, 'Ada is drawn as likely');
  assert.equal(courts[2].querySelectorAll('.open-spot').length, 1, 'Bo, a probable Monday regular, is an expected spot');
  assert.equal(offline.window.document.querySelectorAll('#summary-head th').length, 9, 'Rating, seven zones and All');

  // Live: two looks a minute apart, the second with arrivals.
  const url = 'https://script.google.com/macros/s/TEST/exec';
  const zones = (counts) => T.BRACKETS.map((b, i) => Object.assign({ label: b.label, min: b.min, max: b.max, here: 0, texted: 0, likely: 0, expected: 0 }, counts[i] || {}));
  const first = { ok: true, date: '2026-10-26', phase: 'signup', today: true, updatedAt: MONDAY_10AM, brackets: zones({ 3: { here: 2, texted: 1, expected: 4 }, 6: { likely: 1, expected: 2 } }), unrated: { here: 0, texted: 1 } };
  const second = JSON.parse(JSON.stringify(first));
  second.brackets[3].here = 4;
  second.brackets[3].expected = 5;
  second.unrated.here = 1;
  const online = page({ now: MONDAY_10AM, url, answers: [first, second, null] });
  await settle();
  assert.equal(online.calls[0].address, url);
  assert.equal(online.calls[0].options.credentials, 'omit', 'no Google cookies, so a visitor\'s sign-ins never matter');
  assert.equal(online.calls.length, 1, 'the published files are not needed while the app answers');
  assert.equal(online.$('tonight-live').hidden, false);
  assert.equal(online.$('tonight-status').hidden, true);
  assert.equal(online.$('stat-playing').textContent, '4');
  assert.equal(online.$('stat-expected').textContent, '7');
  assert.match(online.$('tonight-lede').textContent, /4 already in: 2 signed in at the desk, 2 texted/);
  let floor = online.window.document.querySelectorAll('#gym-floor .court');
  assert.equal(floor[4].querySelector('.scoreboard').textContent, '03');
  assert.equal(floor[4].querySelectorAll('.body.is-here').length, 2);
  assert.equal(floor[4].querySelectorAll('.body.is-texted .bubble').length, 1);
  assert.equal(floor[4].querySelectorAll('.open-spot').length, 1);
  assert.equal(floor[0].querySelectorAll('.body').length, 1, 'a text with no known rating waits at the front desk');
  assert.equal(online.window.document.querySelectorAll('.is-arriving').length, 0, 'nothing animates on the first look');
  const newFaces = [...online.window.document.querySelectorAll('#summary-head th')].map(th => th.textContent);
  assert.deepEqual(newFaces.slice(-2), ['New faces', 'All'], 'new faces have their own column, so the zones add up to All');
  const poll = online.timers.find(timer => timer.ms === 60000);
  assert.ok(poll, 'looks again every minute');

  poll.fn();
  await settle();
  floor = online.window.document.querySelectorAll('#gym-floor .court');
  assert.equal(floor[4].querySelector('.scoreboard').textContent, '05');
  assert.ok(floor[4].querySelector('.scoreboard').classList.contains('is-flipping'));
  assert.equal(floor[4].querySelectorAll('.is-arriving').length, 2, 'the two newcomers walk in');
  assert.equal(floor[0].querySelectorAll('.is-arriving').length, 1);
  assert.equal(online.$('tonight-ticker').textContent, 'Just now: 3 more players in (1000–1199, front desk).');

  poll.fn();
  await settle();
  assert.equal(online.$('stat-playing').textContent, '7', 'a failed look keeps what is shown');
  assert.match(online.$('tonight-updated').textContent, /could not refresh/);

  // After sign-up closes there are no likely ghosts.
  const closed = Object.assign(JSON.parse(JSON.stringify(second)), { phase: 'underway' });
  const late = page({ now: MONDAY_10AM, url, answers: [closed] });
  await settle();
  assert.equal(late.$('stat-likely-box').hidden, true);
  assert.match(late.$('tonight-lede').textContent, /^Sign-up has closed: 7 players are on the floor tonight/);
  assert.equal([...late.window.document.querySelectorAll('#summary-body th')].map(th => th.textContent).join('|'), 'Playing tonight|Expected');

  // The app is down at first: the forecast, then the app once it answers.
  const recovering = page({ now: MONDAY_10AM, url, answers: [null, first] });
  await settle();
  assert.equal(recovering.$('tonight-status').hidden, false);
  recovering.timers.find(timer => timer.ms === 60000).fn();
  await settle();
  assert.equal(recovering.$('tonight-status').hidden, true);
  assert.equal(recovering.$('stat-playing').textContent, '4');

  // On a Friday it is about Monday.
  const friday = page({ now: Date.parse('2026-10-23T17:00:00Z'), url: '' });
  await settle();
  assert.equal(friday.$('tonight-title').textContent, 'Who’s playing Monday');
  assert.equal(friday.$('tonight-when').textContent, 'Next round robin · Monday, October 26');

  console.log('Turnout checks passed');
}()).catch(error => { console.error(error); process.exit(1); });
