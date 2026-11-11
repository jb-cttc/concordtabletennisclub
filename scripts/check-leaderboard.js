'use strict';

// The Leaderboard (leaderboard.html): every column heading sorts its table, a second tap reverses it, and the Rank column
// keeps showing each player's real rank. Made-up players only.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'leaderboard.html'), 'utf8');
const block = (html.match(/<script>[\s\S]*?<\/script>/g) || []).find(text => text.includes('leaderboard-body'));
assert.ok(block, 'the leaderboard script was found');
const body = /<body>([\s\S]*)<\/body>/.exec(html)[1].replace(/<script[\s\S]*?<\/script>/g, '');

const day = daysAgo => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
// Ranked as data/players.json lists them: by rating.
const player = (name, rating, sessions, wins, losses, history) => ({
  name, currentRating: rating, sessionsPlayed: sessions, totalWins: wins, totalLosses: losses, headToHead: {},
  ratingHistory: history.map(([daysAgo, value]) => ({ date: day(daysAgo), rating: value }))
});
const players = [
  player('Ana Reyes', 1800, 12, 30, 10, [[400, 1700], [10, 1800]]),
  player('ben Okafor', 1600, 40, 50, 45, [[400, 1650], [5, 1600]]),
  player('Cara Lim', 1500, 40, 50, 30, [[400, 1300], [3, 1500]]),
  player('Dev Patel', 1400, 3, 4, 6, [[3, 1400]])
];

(async () => {
  const dom = new JSDOM('<!doctype html><body>' + body + '</body>', { runScripts: 'outside-only', url: 'https://example.test/leaderboard.html' });
  dom.window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(JSON.stringify({ players }))) });
  dom.window.eval(block.replace(/^<script>|<\/script>$/g, ''));
  for (let i = 0; i < 10; i += 1) await new Promise(resolve => setTimeout(resolve, 10));
  const doc = dom.window.document;
  const rankings = doc.querySelector('.leaderboard-table:not(.improved-table)');
  const heading = (tableEl, label) => [...tableEl.querySelectorAll('thead th')].find(th => th.textContent.replace(/[▲▼]/g, '') === label);
  const tap = (tableEl, label) => heading(tableEl, label).querySelector('button.sort-button').click();
  // Rank and name of each row, top to bottom.
  const rows = () => [...doc.querySelectorAll('#leaderboard-body tr.player-row')].map(tr => tr.children[0].textContent + ' ' + tr.children[1].querySelector('a').textContent);

  assert.deepEqual([...rankings.querySelectorAll('thead th')].map(th => th.textContent.replace(/[▲▼]/g, '')), ['Rank', 'Player', 'Rating', 'Trend', 'Sessions', 'W-L']);
  assert.ok([...rankings.querySelectorAll('thead th')].every(th => th.querySelector('button.sort-button[type=button]')), 'every heading is a button');
  assert.deepEqual(rows(), ['1 Ana Reyes', '2 ben Okafor', '3 Cara Lim', '4 Dev Patel'], 'rank order at first');
  assert.equal(heading(rankings, 'Rank').getAttribute('aria-sort'), 'ascending');

  // Sessions: most first; a tie keeps rank order; the Rank column still shows the real rank.
  tap(rankings, 'Sessions');
  assert.deepEqual(rows(), ['2 ben Okafor', '3 Cara Lim', '1 Ana Reyes', '4 Dev Patel'], 'most sessions first');
  assert.equal(heading(rankings, 'Sessions').getAttribute('aria-sort'), 'descending');
  assert.equal(heading(rankings, 'Rank').getAttribute('aria-sort'), null, 'only the sorted column says so');
  assert.match(heading(rankings, 'Sessions').textContent, /▼$/, 'an arrow shows the sorted column');
  tap(rankings, 'Sessions');
  assert.deepEqual(rows(), ['4 Dev Patel', '1 Ana Reyes', '2 ben Okafor', '3 Cara Lim'], 'a second tap reverses it');
  assert.equal(heading(rankings, 'Sessions').getAttribute('aria-sort'), 'ascending');

  // Names A to Z, whatever their case; W-L by wins, then fewer losses; Trend by the change the sparkline shows.
  tap(rankings, 'Player');
  assert.deepEqual(rows(), ['1 Ana Reyes', '2 ben Okafor', '3 Cara Lim', '4 Dev Patel']);
  tap(rankings, 'Player');
  assert.deepEqual(rows(), ['4 Dev Patel', '3 Cara Lim', '2 ben Okafor', '1 Ana Reyes']);
  tap(rankings, 'W-L');
  assert.deepEqual(rows(), ['3 Cara Lim', '2 ben Okafor', '1 Ana Reyes', '4 Dev Patel'], '50-30 before 50-45');
  tap(rankings, 'Trend');
  assert.deepEqual(rows(), ['3 Cara Lim', '1 Ana Reyes', '4 Dev Patel', '2 ben Okafor'], 'biggest rise first');
  tap(rankings, 'Rating');
  assert.deepEqual(rows(), ['1 Ana Reyes', '2 ben Okafor', '3 Cara Lim', '4 Dev Patel']);

  // The sort holds while searching, and an opened player keeps their details under their own row.
  tap(rankings, 'Sessions');
  const search = doc.getElementById('leaderboard-search');
  search.value = 'a';
  search.dispatchEvent(new dom.window.Event('input'));
  assert.deepEqual(rows(), ['2 ben Okafor', '3 Cara Lim', '1 Ana Reyes', '4 Dev Patel'], 'every name has an a');
  search.value = 'e';
  search.dispatchEvent(new dom.window.Event('input'));
  assert.deepEqual(rows(), ['2 ben Okafor', '1 Ana Reyes', '4 Dev Patel']);
  assert.equal(doc.getElementById('leaderboard-count').textContent, '3 of 4 players');
  doc.querySelectorAll('#leaderboard-body tr.player-row')[1].click();
  const opened = doc.querySelector('#leaderboard-body tr.player-row.expanded');
  assert.equal(opened.children[1].querySelector('a').textContent, 'Ana Reyes');
  assert.equal(opened.nextElementSibling.className, 'player-detail-row');

  // Most Improved sorts the same way; its Rank is the rank by gain.
  doc.querySelector('.leaderboard-tab[data-tab=improved]').click();
  const improved = doc.querySelector('.improved-table');
  const improvedRows = () => [...doc.querySelectorAll('#improved-body tr')].map(tr => [...tr.children].map(td => td.textContent).join(' '));
  doc.querySelector('#improved-period-btns [data-days="365"]').click();
  assert.deepEqual(improvedRows(), ['1 Cara Lim +200 1300 1500 1', '2 Ana Reyes +100 1700 1800 1', '3 ben Okafor -50 1650 1600 1'], 'by gain at first');
  tap(improved, 'Now');
  assert.deepEqual(improvedRows(), ['2 Ana Reyes +100 1700 1800 1', '3 ben Okafor -50 1650 1600 1', '1 Cara Lim +200 1300 1500 1']);
  tap(improved, 'Was');
  tap(improved, 'Was');
  assert.deepEqual(improvedRows(), ['1 Cara Lim +200 1300 1500 1', '3 ben Okafor -50 1650 1600 1', '2 Ana Reyes +100 1700 1800 1'], 'lowest first on the second tap');
  doc.querySelector('#improved-period-btns [data-days="90"]').click();
  assert.equal(heading(improved, 'Was').getAttribute('aria-sort'), 'ascending', 'a new period keeps the sort');

  // Phones keep Sessions on screen (only Trend is hidden), so the list can be sorted by it there too.
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const phone = /@media \(max-width: 640px\) \{[\s\S]*?\n\}/g;
  const phoneCss = (css.match(phone) || []).join('\n');
  assert.match(phoneCss, /\.leaderboard-table:not\(\.improved-table\) th:nth-child\(4\),\n\s*\.leaderboard-table:not\(\.improved-table\) td:nth-child\(4\) \{\n\s*display: none;/);
  assert.doesNotMatch(phoneCss, /\.leaderboard-table:not\(\.improved-table\) td:nth-child\(5\)/, 'the Sessions column is not hidden on a phone');

  dom.window.close();
  console.log('Leaderboard checks passed');
})().catch(error => { console.error(error); process.exit(1); });
