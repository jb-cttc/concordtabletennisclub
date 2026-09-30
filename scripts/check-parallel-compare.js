const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tally } = require('../standings');
const { CODES, compareSession, compareSessions, summarize } = require('./lib/parallel-compare');
const { loadAccessSessions } = require('./lib/parallel-load');
const { renderHtml } = require('./lib/parallel-report');

// results: [a, b, gamesA, gamesB, forfeitedBy?]. Access prints a forfeit as 0-0 with no direction.
function group(name, names, results, options) {
  const ratings = (options && options.ratings) || {};
  const app = Boolean(options && options.app);
  const players = names.map((playerName, index) => ({ name: playerName, ratingBefore: ratings[playerName] || 1000 + index * 10, ratingAdj: 0, matches: [] }));
  const get = playerName => players.find(player => player.name === playerName);
  results.forEach(([a, b, gamesA, gamesB, by]) => {
    const flags = app && by ? { forfeit: true, forfeitedBy: by } : {};
    get(a).matches.push({ opponent: b, gamesWon: gamesA, gamesLost: gamesB, adj: 0, ...flags });
    get(b).matches.push({ opponent: a, gamesWon: gamesB, gamesLost: gamesA, adj: 0, ...flags });
  });
  players.forEach(player => {
    const record = tally(player);
    player.wins = record.wins;
    player.losses = record.losses + record.forfeitLosses;
    player.ratingAfter = player.ratingBefore + player.ratingAdj;
  });
  return { name, players };
}
const session = (date, groups, source) => ({ date, source, groups });
const codesOf = result => result.findings.map(item => item.code);

const names = ['A', 'B', 'C', 'D'];
const played = [['A', 'B', 3, 1], ['A', 'C', 3, 0], ['A', 'D', 3, 0], ['B', 'C', 3, 2], ['B', 'D', 3, 0], ['C', 'D', 3, 1]];
const make = (results, options, order) => {
  const built = group('Group 1', names, results, options);
  if (order) built.players.sort((left, right) => order.indexOf(left.name) - order.indexOf(right.name));
  return built;
};

// 1. Identical results.
let result = compareSession(session('2026-10-05', [make(played)]), session('2026-10-05', [make(played, { app: true })], 'app'));
assert.equal(result.status, 'same');
assert.deepEqual(result.findings, []);

// 2. A forfeit only the desk knows about: expected, ratings unchanged.
const forfeits = [['A', 'B', 3, 1], ['A', 'C', 3, 0], ['A', 'D', 0, 0, 'D'], ['B', 'C', 0, 0, 'both'], ['B', 'D', 3, 0], ['C', 'D', 3, 1]];
result = compareSession(session('2026-10-05', [make(forfeits)]), session('2026-10-05', [make(forfeits, { app: true })], 'app'));
assert.equal(result.status, 'expected');
assert.deepEqual(codesOf(result), ['FORFEIT_DIRECTION']);
assert.equal(result.findings.filter(item => item.code === 'FORFEIT_DIRECTION').length, 1, 'a double forfeit is not a difference');

// 2b. The recorded direction changes the order: Access data ranks C, B, A; the desk ranks C, A, B.
const direction = [['A', 'B', 0, 0, 'B'], ['B', 'C', 3, 0], ['C', 'A', 3, 0]];
const threeAccess = group('Group 1', ['A', 'B', 'C'], direction);
threeAccess.players.sort((left, right) => 'CBA'.indexOf(left.name) - 'CBA'.indexOf(right.name));
result = compareSession(session('d', [threeAccess]), session('d', [group('Group 1', ['A', 'B', 'C'], direction, { app: true })], 'app'));
assert.equal(result.status, 'expected');
assert.deepEqual(codesOf(result), ['FORFEIT_DIRECTION', 'FORFEIT_RANKING']);

// 3. Unexpected: a different score, a different rating change, a missing player, a forfeit on one side only.
const rescored = played.map(row => row[0] === 'B' && row[1] === 'C' ? ['B', 'C', 2, 3] : row);
result = compareSession(session('d', [make(played)]), session('d', [make(rescored, { app: true })], 'app'));
assert.equal(result.status, 'review');
assert.ok(codesOf(result).includes('SCORE_DIFFERS') && codesOf(result).includes('RECORD_DIFFERS'));
const adjusted = make(played, { app: true });
adjusted.players[0].ratingAdj = 5;
adjusted.players[0].ratingAfter += 5;
result = compareSession(session('d', [make(played)]), session('d', [adjusted], 'app'));
assert.deepEqual(codesOf(result), ['RATING_ADJ', 'RATING_AFTER']);
assert.equal(result.status, 'review');
const missing = make(played, { app: true });
missing.players = missing.players.slice(0, 3);
assert.deepEqual(codesOf(compareSession(session('d', [make(played)]), session('d', [missing], 'app'))), ['GROUP_MEMBERS']);
const oneSided = played.map(row => row[0] === 'C' && row[1] === 'D' ? ['C', 'D', 0, 0, 'both'] : row);
assert.ok(codesOf(compareSession(session('d', [make(played)]), session('d', [make(oneSided, { app: true })], 'app'))).includes('FORFEIT_MISMATCH'));

// 4. Access lists a different first place.
result = compareSession(session('d', [make(played, {}, ['B', 'A', 'C', 'D'])]), session('d', [make(played, { app: true })], 'app'));
assert.deepEqual(codesOf(result), ['ACCESS_ORDER_UNEXPLAINED'], 'a clear winner must be first in the Access report');
assert.equal(result.status, 'review');
const cycle = [['A', 'B', 3, 2], ['B', 'C', 3, 2], ['C', 'A', 3, 2], ['A', 'D', 3, 0], ['B', 'D', 3, 0], ['C', 'D', 3, 0]];
result = compareSession(session('d', [make(cycle, {}, ['B', 'A', 'C', 'D'])]), session('d', [make(cycle, { app: true })], 'app'));
assert.deepEqual(codesOf(result), ['ACCESS_ORDER_TIE']);
assert.equal(result.status, 'expected');

// 5. Sessions present on one side only.
const pending = compareSessions([session('2026-10-05', [make(played)])], [session('2026-10-07', [make(played, { app: true })], 'app')], { since: '2026-10-05' });
assert.deepEqual(pending.map(item => [item.date, item.status]), [['2026-10-05', 'pending'], ['2026-10-07', 'pending']]);
assert.deepEqual(summarize(pending), { same: 0, expected: 0, review: 0, pending: 2 });

// 6. Every code is documented.
const docs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'parallel-operations.md'), 'utf8');
Object.keys(CODES).forEach(code => assert.ok(docs.includes('`' + code + '`'), code + ' is missing from docs/parallel-operations.md'));

// 7. The report escapes names.
const html = renderHtml([{ date: '2026-10-05', status: 'review', findings: [{ code: 'SCORE_DIFFERS', level: 'unexpected', group: 'Group 1', players: [], detail: '<b>x</b>' }], groups: [] }], { same: 0, expected: 0, review: 1, pending: 0 }, { generatedAt: 'now' });
assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;') && !html.includes('<b>x</b>'));

// 8. Calibration: the published 2026 data is derived from the same Access reports, so nothing may need review.
const dataDir = path.join(__dirname, '..', 'data');
const published = fs.readdirSync(dataDir).filter(name => /^session-details-\d{4}\.json$/.test(name)).flatMap(name => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')));
const access = loadAccessSessions();
if (access.length) {
  const real = compareSessions(access, published, { since: '2026-01-01' });
  const counts = summarize(real);
  assert.equal(counts.review, 0, 'unexplained differences: ' + real.filter(item => item.status === 'review').map(item => item.date).join(', '));
  assert.ok(counts.same + counts.expected > 50);
}

console.log('Parallel comparison checks passed: classification, documentation, report, 2026 calibration');
