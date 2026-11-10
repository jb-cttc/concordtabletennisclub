'use strict';

// The Equalizer on the Round Robins page (roundrobins.html): a made-up Equalizer published through the real desk and
// publish code (lib/equalizer-fixture.js) shows its pilot banner, every group with its winner, and the Finals bracket
// with the byes and the champion's trophy. Made-up players only.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { publishedEqualizer } = require('./lib/equalizer-fixture');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'roundrobins.html'), 'utf8');
const block = (html.match(/<script>[\s\S]*?<\/script>/g) || []).find(text => text.includes('var PILOTS'));
assert.ok(block, 'the Equalizer script was found');
const body = /<body>([\s\S]*)<\/body>/.exec(html)[1].replace(/<script[\s\S]*?<\/script>/g, '').replace(/<script[^>]*src=[^>]*><\/script>/g, '');

const session = publishedEqualizer();
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

async function page(sessions, details) {
  const dom = new JSDOM('<!doctype html><body>' + body + '</body>', { runScripts: 'outside-only', url: 'https://example.test/roundrobins.html' });
  const fetched = [];
  dom.window.fetch = url => {
    fetched.push(url);
    const data = url === 'data/sessions.json' ? sessions : url === 'data/session-details-2026.json' ? details : null;
    return data ? Promise.resolve({ json: () => Promise.resolve(JSON.parse(JSON.stringify(data))) }) : Promise.reject(new Error('not found'));
  };
  dom.window.Element.prototype.scrollIntoView = () => {};
  dom.window.eval(fs.readFileSync(path.join(ROOT, 'standings.js'), 'utf8'));
  dom.window.eval(block.replace(/^<script>|<\/script>$/g, ''));
  for (let i = 0; i < 10; i += 1) await settle();
  return { dom, fetched, $: s => dom.window.document.querySelector(s), $$: s => [...dom.window.document.querySelectorAll(s)] };
}

(async () => {
  // No Equalizer published: nothing shows.
  const none = await page([{ date: '2026-11-04', sessionId: 'session-2026-11-04', source: 'app' }], []);
  assert.ok(none.$('#equalizer-results').hidden, 'no Equalizer, no section');
  assert.deepEqual(none.fetched, ['data/sessions.json'], 'and no details are fetched');

  const sessions = [{ date: session.date, sessionId: session.sessionId, source: 'app', variant: 'equalizer' }, { date: '2026-11-04', sessionId: 'session-2026-11-04', source: 'app' }];
  const shown = await page(sessions, [session]);
  const root = shown.$('#eq-2026-11-07');
  assert.ok(root && !root.hidden, 'the section shows, with an anchor for the email link');
  // Below the three regular nights' recent results, above the archive.
  const order = [...shown.dom.window.document.querySelectorAll('#recent-results, #eq-2026-11-07, #archive')].map(node => node.id);
  assert.deepEqual(order, ['recent-results', 'eq-2026-11-07', 'archive'], 'the Equalizer sits under the regular nights');
  const text = root.textContent;
  // The pilot banner, with the rules and the request for feedback.
  const banner = shown.$('.eq-pilot');
  assert.ok(banner, 'tonight is a pilot');
  assert.match(banner.textContent, /Experimental pilot/);
  assert.match(banner.textContent, /collecting feedback/);
  assert.equal(banner.querySelectorAll('li').length, 4);
  assert.match(banner.textContent, /round robin rating never changes/);
  // Every rating shown is said, at the top, to be the experimental EQ rating and not the official one.
  const official = shown.$('#eq-2026-11-07 .eq-not-official');
  assert.ok(official, 'the not-official notice');
  assert.match(official.textContent, /NOT official ratings/);
  assert.match(official.textContent, /experimental Equalizer \(EQ\) rating/);
  assert.ok(root.firstElementChild.nextElementSibling === official, 'right under the heading, before anything else');
  assert.deepEqual(shown.$$('#eq-2026-11-07 .latest-results-group thead th').slice(0, 4).map(th => th.textContent), ['Name', 'Matches', 'Games', 'EQ rating*']);
  assert.match(text, /\* EQ rating: each player’s experimental Equalizer rating at the start of the night, not their official round robin rating/);
  // The champion.
  const champion = session.equalizer.champion.join(' & ');
  assert.ok(text.includes(champion + ' wins the Equalizer'), 'the champion leads');
  // Every group, with one winner each.
  const groups = shown.$$('#eq-2026-11-07 .latest-results-group');
  assert.equal(groups.length, 5);
  groups.forEach(group => {
    assert.equal(group.querySelectorAll('tbody tr').length, 4);
    assert.equal(group.querySelectorAll('.group-winner-row').length, 1, 'one group winner, marked');
    assert.equal(group.querySelector('tbody tr').className, 'group-winner-row', 'listed first');
  });
  // The Finals: quarterfinals with three byes, the semifinals, the Final, and the champion's trophy.
  const rounds = shown.$$('#eq-2026-11-07 .eq-round h4').map(h => h.textContent);
  assert.deepEqual(rounds, ['Quarterfinals', 'Semifinals', 'Final', 'Champion']);
  assert.equal(shown.$$('#eq-2026-11-07 .eq-match.bye').length, 3, 'three byes, named');
  shown.$$('#eq-2026-11-07 .eq-match.bye').forEach(bye => assert.ok(bye.querySelector('.eq-name a'), 'each bye names who went through'));
  const final = shown.$('#eq-2026-11-07 .eq-match.final');
  assert.ok(final.querySelector('.eq-slot.won .eq-trophy'), 'the trophy on the Final\'s winner');
  assert.equal(final.querySelector('.eq-slot.won .eq-name').textContent.replace(/^\S+\s/, ''), champion);
  assert.equal(shown.$('#eq-2026-11-07 .eq-champion a').textContent, champion);
  // Each played Finals match has one winner with a check.
  shown.$$('#eq-2026-11-07 .eq-match:not(.bye)').forEach(match => assert.equal(match.querySelectorAll('.eq-slot.won').length, 1));

  // A later Equalizer, not a pilot: no banner.
  const later = Object.assign({}, session, { date: '2026-11-14', sessionId: 'session-2026-11-14-equalizer' });
  const next = await page([{ date: later.date, sessionId: later.sessionId, source: 'app', variant: 'equalizer' }].concat(sessions), [later, session]);
  assert.ok(next.$('#eq-2026-11-14'), 'the newest Equalizer');
  assert.equal(next.$('.eq-pilot'), null, 'no pilot banner after the pilot');
  assert.ok(next.$('.eq-not-official'), 'the not-official notice on every Equalizer, pilot or not');
  console.log('Equalizer results page checks passed');
})().catch(error => { console.error(error); process.exit(1); });
