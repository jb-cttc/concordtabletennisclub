const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { projectFinalizedSession } = require('../scripts/lib/finalized-session');
const { HEADERS, parseTable } = require('../scripts/publish-finalized-sessions');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');

// Shared match rules (desk page and print sheets).
const desk = { window: {} };
vm.createContext(desk);
vm.runInContext(read('Standings.html').match(/<script>([\s\S]*)<\/script>/)[1], desk);
vm.runInContext(read('Organizer.html').match(/<script>([\s\S]*)<\/script>/)[1], desk);
const O = desk.window.CTTCOrganizer;
const match = (g1, g2, extra) => ({ playerOneId: 'a', playerTwoId: 'b', playerOneGames: g1, playerTwoGames: g2, forfeit: false, forfeitedBy: null, ...extra });

// One player forfeits: the other wins without a score. A score, if entered, must agree.
assert.equal(O.matchState(match(null, null, { forfeit: true, forfeitedBy: 'b' })), 'complete', 'a forfeit needs no score');
assert.equal(O.matchState(match(3, 0, { forfeit: true, forfeitedBy: 'b' })), 'complete');
assert.equal(O.matchState(match(3, 0, { forfeit: true, forfeitedBy: 'a' })), 'conflict', 'the forfeiter cannot be the winner');
assert.equal(O.matchState(match(null, 2, { forfeit: true, forfeitedBy: 'b' })), 'incomplete', 'half a score is still an error');
assert.equal(O.matchState(match(3, 0, { forfeit: true })), 'complete', 'older forfeits without a recorded forfeiter still count');
assert.equal(O.matchState(match(null, null, { forfeit: true })), 'pending', 'an unnamed forfeit still needs a result');
assert.equal(O.matchState(match(null, null, { forfeit: true, forfeitedBy: 'zzz' })), 'conflict');
// Both forfeit: the match was never played.
assert.equal(O.matchState(match(null, null, { forfeit: true, forfeitedBy: 'both' })), 'complete');
assert.equal(O.matchState(match(3, 1, { forfeit: true, forfeitedBy: 'both' })), 'conflict', 'a match nobody played has no score');

let m = match(null, null);
O.applyForfeit(m, 'a');
assert.deepEqual([m.playerOneGames, m.playerTwoGames, m.forfeit, m.forfeitedBy], [null, null, true, 'a'], 'no score is invented');
O.applyForfeit(m, 'both');
assert.deepEqual([m.forfeit, m.forfeitedBy], [true, 'both']);
O.applyForfeit(m, '');
assert.deepEqual([m.forfeit, m.forfeitedBy], [false, null]);
O.applyForfeit(m, '?');
assert.deepEqual([m.forfeit, m.forfeitedBy], [true, null], 'keeps an older unrecorded forfeit');
m = match(3, 1);
O.applyForfeit(m, 'b');
assert.deepEqual([m.playerOneGames, m.playerTwoGames], [3, 1], 'an entered score is never changed');
assert.throws(() => O.applyForfeit(match(null, null), 'c'), /not in this match/);

const people = { a: { name: 'Ava', currentRating: 1400 }, b: { name: 'Ben', currentRating: 1300 }, c: { name: 'Cy', currentRating: 1350 } };
const standing = (matches, ids) => O.standings(ids || ['a', 'b'], matches, id => people[id], O.ratingAdjustment);
const row = (table, name) => table.rows.find(r => r.name === name);
let table = standing([match(null, null, { forfeit: true, forfeitedBy: 'b' })]);
assert.deepEqual([row(table, 'Ava').wins, row(table, 'Ava').losses, row(table, 'Ben').wins, row(table, 'Ben').losses], [1, 0, 0, 1], 'the forfeit win counts as a win and a loss');
assert.deepEqual([row(table, 'Ava').gamesWon, row(table, 'Ava').gamesLost], [0, 0], 'no games are invented');
assert.equal(row(table, 'Ava').adjustment, 0, 'a forfeit moves no rating points');
assert.equal(row(table, 'Ben').adjustment, 0);
assert.equal(table.finished, true);
table = standing([match(null, null, { forfeit: true, forfeitedBy: 'a' })]);
assert.deepEqual([row(table, 'Ben').wins, row(table, 'Ava').losses], [1, 1], 'the other side can win by forfeit too');
table = standing([match(null, null, { forfeit: true, forfeitedBy: 'both' })]);
assert.deepEqual(JSON.parse(JSON.stringify(table.rows.map(r => [r.wins, r.losses, r.gamesWon, r.adjustment]))), [[0, 0, 0, 0], [0, 0, 0, 0]], 'a match nobody played changes nothing');
assert.equal([table.complete, table.total].join('/'), '1/1', 'but it is finished');
assert.equal(standing([match(3, 0, { forfeit: true, forfeitedBy: 'a' })]).complete, 0, 'a conflicting forfeit is not counted');
table = standing([match(3, 0, { forfeit: true, forfeitedBy: 'b' })]);
assert.deepEqual([row(table, 'Ava').gamesWon, row(table, 'Ava').adjustment], [3, 0], 'an entered score still counts as games');
table = standing([match(3, 1), { ...match(null, null, { forfeit: true, forfeitedBy: 'both' }), playerTwoId: 'c' }, { ...match(null, null), playerOneId: 'b', playerTwoId: 'c' }], ['a', 'b', 'c']);
assert.equal([table.complete, table.total].join('/'), '2/3');
assert.equal(table.finished, false, 'a group with a pairing still unplayed is not finished');

// Server: saving, reading, and finalizing.
const sheets = { SessionPlayers: [], Matches: [], Sessions: [{ session_id: 's', session_date: '2026-10-05', status: 'active', revision: 1 }], Players: [
  { player_id: 'a', display_name: 'Ava', current_rating: 1400, active: true },
  { player_id: 'b', display_name: 'Ben', current_rating: 1300, active: true }
] };
let upgrades = 0;
const server = {
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) }
};
vm.createContext(server);
for (const file of ['Code.js', 'SessionService.js', 'RatingEngine.js']) vm.runInContext(read(file), server);
Object.assign(server, {
  appendAudit_() {},
  rows_: name => sheets[name].map((r, index) => ({ ...r, __row: index + 2 })),
  updateRow_: (name, rowNumber, changes) => Object.assign(sheets[name][rowNumber - 2], changes),
  replaceSessionRows_: (name, id, rows) => { sheets[name] = sheets[name].filter(r => r.session_id !== id).concat(rows); },
  ensureMatchesColumns_: () => { upgrades += 1; },
  displayDate_: value => String(value)
});
const draft = (forfeitedBy, extra) => ({
  sessionId: 's', revision: sheets.Sessions[0].revision, groups: [{ groupNumber: 1, playerIds: ['a', 'b'] }],
  matches: [{ groupNumber: 1, playerOneId: 'a', playerTwoId: 'b', playerOneGames: null, playerTwoGames: null, forfeit: false, forfeitedBy, ...extra }]
});
let saved = server.saveSessionDraft(draft('b'));
assert.equal(upgrades, 1, 'the Sheet column is checked before every save');
assert.deepEqual([sheets.Matches[0].forfeited_by, sheets.Matches[0].forfeit, sheets.Matches[0].player_one_games], ['b', true, ''], 'a forfeit saves without a score');
assert.equal(saved.matches[0].forfeitedBy, 'b');
assert.equal(saved.matches[0].playerOneGames, null);
saved = server.saveSessionDraft(draft('both'));
assert.deepEqual([sheets.Matches[0].forfeited_by, sheets.Matches[0].forfeit], ['both', true]);
saved = server.saveSessionDraft(draft(null));
assert.deepEqual([sheets.Matches[0].forfeited_by, sheets.Matches[0].forfeit], ['', false], 'clearing removes the forfeiter');
assert.equal(saved.matches[0].forfeitedBy, null);
saved = server.saveSessionDraft(draft(null, { forfeit: true }));
assert.deepEqual([sheets.Matches[0].forfeited_by, sheets.Matches[0].forfeit], ['', true], 'an older unrecorded forfeit is preserved');
assert.throws(() => server.saveSessionDraft(draft('zzz')), /not in the match/);
assert.deepEqual([sheets.Matches[0].forfeited_by, sheets.Matches[0].forfeit], ['', true], 'a rejected save changes nothing');

const players = [{ session_id: 's', player_id: 'a', group_number: 1 }, { session_id: 's', player_id: 'b', group_number: 1 }];
const sheetRow = extra => ({ player_one_id: 'a', player_two_id: 'b', player_one_games: 3, player_two_games: 1, forfeit: true, ...extra });
const blank = { player_one_games: '', player_two_games: '' };
server.validateCompleteRoundRobin_(players, [sheetRow({ forfeited_by: 'b' })]);
server.validateCompleteRoundRobin_(players, [sheetRow({ ...blank, forfeited_by: 'b' })]);
server.validateCompleteRoundRobin_(players, [sheetRow({ ...blank, forfeited_by: 'both' })]);
assert.throws(() => server.validateCompleteRoundRobin_(players, [sheetRow({ forfeited_by: 'a' })]), /must have lost/);
assert.throws(() => server.validateCompleteRoundRobin_(players, [sheetRow({ forfeited_by: 'both' })]), /not played cannot have a score/);
assert.throws(() => server.validateCompleteRoundRobin_(players, [sheetRow({ ...blank, forfeited_by: 'zzz' })]), /not in the match/);
assert.throws(() => server.validateCompleteRoundRobin_(players, [sheetRow({})]), /Choose who forfeited/);
assert.throws(() => server.validateCompleteRoundRobin_(players, [sheetRow({ ...blank })]), /Incomplete or invalid/, 'an unnamed forfeit still needs a result');
server.validateCompleteRoundRobin_(players, [sheetRow({ forfeit: false })]);

// Older Sheets gain the new column once, without reordering or overwriting anything.
function sheet(header, maxColumns, lastRow) {
  const cells = { header: header.slice(), writes: [], inserted: 0, maxColumns };
  return Object.assign(cells, {
    getLastRow: () => lastRow === undefined ? 2 : lastRow,
    getMaxColumns: () => cells.maxColumns,
    insertColumnsAfter: (_after, count) => { cells.inserted += count; cells.maxColumns += count; },
    getName: () => 'Matches',
    getRange: (_row, column, _rows, count) => ({
      getDisplayValues: () => [Array.from({ length: count }, (_, i) => cells.header[i] === undefined ? '' : cells.header[i])],
      setValue: value => { cells.writes.push([column, value]); cells.header[column - 1] = value; },
      setValues: values => { cells.writes.push(['all', values[0]]); }
    })
  });
}
const wanted = server.TABLES.Matches;
assert.equal(wanted[wanted.length - 1], 'forfeited_by');
const older = wanted.slice(0, -1);
let upgraded = sheet(older, 26);
server.ensureHeader_(upgraded, wanted);
assert.deepEqual(upgraded.writes, [[wanted.length, 'forfeited_by']], 'only the new header cell is written');
assert.deepEqual(upgraded.header, wanted);
upgraded = sheet(older, older.length);
server.ensureHeader_(upgraded, wanted);
assert.equal(upgraded.inserted, 1, 'a sheet with no spare column gets one');
const current = sheet(wanted, 26);
server.ensureHeader_(current, wanted);
assert.deepEqual(current.writes, [], 'an up-to-date sheet is left alone');
const reordered = sheet(['session_id', ...older.slice(1)], 26);
assert.throws(() => server.ensureHeader_(reordered, wanted), /Unexpected header structure/);
assert.deepEqual(reordered.writes, [], 'an unexpected sheet is never modified');
const other = sheet(['x', 'y'], 26);
other.getName = () => 'Players';
assert.throws(() => server.ensureHeader_(other, ['x', 'y', 'z']), /Unexpected header structure/);
const empty = sheet([], 26, 0);
server.ensureHeader_(empty, wanted);
assert.deepEqual(empty.writes, [['all', wanted]]);

// Publishing carries the forfeiter and still reads Sheets that predate the column.
assert.equal(HEADERS.Matches[HEADERS.Matches.length - 1], 'forfeited_by');
const publishedHeader = HEADERS.Matches.slice(0, -1);
assert.equal(parseTable('Matches', [publishedHeader, ['m', 's', 1, 'a', 'b', 3, 0, 'true', '']])[0].forfeited_by, '');
assert.equal(parseTable('Matches', [HEADERS.Matches, ['m', 's', 1, 'a', 'b', 3, 0, 'true', '', 'b']])[0].forfeited_by, 'b');
assert.throws(() => parseTable('Matches', [['match_id', 'oops']]), /Unexpected Matches header/);
assert.throws(() => parseTable('Matches', []), /Unexpected Matches header/);

const finalized = (forfeitedBy, games) => projectFinalizedSession(
  { session_id: 's', session_date: '2026-10-05', status: 'finalized', revision: 3, finalized_at: '2026-10-05T23:00:00Z' },
  [{ session_id: 's', player_id: 'a', group_number: 1, starting_rating: 1400 }, { session_id: 's', player_id: 'b', group_number: 1, starting_rating: 1300 }],
  [{ session_id: 's', group_number: 1, player_one_id: 'a', player_two_id: 'b', player_one_games: games[0], player_two_games: games[1], forfeit: true, forfeited_by: forfeitedBy }],
  [{ session_id: 's', player_id: 'a', rating_before: 1400, adjustment: 0, rating_after: 1400, rule_version: 'cttc-access-v1' },
   { session_id: 's', player_id: 'b', rating_before: 1300, adjustment: 0, rating_after: 1300, rule_version: 'cttc-access-v1' }],
  [{ player_id: 'a', display_name: 'Ava' }, { player_id: 'b', display_name: 'Ben' }]
);
const entry = (session, name) => session.groups[0].players.find(p => p.name === name);
let result = finalized('b', [3, 0]);
assert.deepEqual([entry(result, 'Ava').matches[0].forfeit, entry(result, 'Ava').matches[0].forfeitedBy, entry(result, 'Ava').matches[0].adj], [true, 'Ben', 0], 'the public result names the forfeiter and moves no points');
result = finalized('b', ['', '']);
assert.deepEqual([entry(result, 'Ava').wins, entry(result, 'Ben').losses, entry(result, 'Ava').gamesWon, entry(result, 'Ava').ratingAdj], [1, 1, 0, 0], 'a forfeit needs no score to publish');
assert.deepEqual(entry(result, 'Ben').matches[0], { opponent: 'Ava', gamesWon: 0, gamesLost: 0, adj: 0, forfeit: true, forfeitedBy: 'Ben' });
result = finalized('a', ['', '']);
assert.deepEqual([entry(result, 'Ben').wins, entry(result, 'Ava').losses], [1, 1], 'the forfeit win can go to either player');
result = finalized('both', ['', '']);
assert.deepEqual([entry(result, 'Ava').wins, entry(result, 'Ava').losses, entry(result, 'Ben').wins, entry(result, 'Ben').losses], [0, 0, 0, 0], 'a match nobody played gives no win or loss');
assert.equal(entry(result, 'Ava').matches[0].forfeitedBy, 'both');
assert.equal(finalized('', [3, 0]).groups[0].players[0].matches[0].forfeitedBy, undefined, 'older forfeits publish without a forfeiter');
assert.throws(() => finalized('a', [3, 0]), /must have lost/);
assert.throws(() => finalized('both', [3, 0]), /not played cannot have a score/);
assert.throws(() => finalized('zzz', ['', '']), /not in the match/);
assert.throws(() => finalized('', ['', '']), /Invalid/, 'a blank result needs a forfeit');

// Desk page and printed sheets.
const page = read('Index.html');
assert.doesNotMatch(page, /type="checkbox" data-forfeit/);
assert.match(page, /data-forfeit="' \+ index/);
assert.match(page, /Both forfeited \(not played\)/);
assert.match(page, /Who forfeited/);
assert.doesNotMatch(page, /credited 3-0/, 'the desk never invents a score');
assert.match(page, /forfeit: old\.forfeit, forfeitedBy: old\.forfeitedBy \|\| null/, 'reordering a group keeps the forfeiter');
assert.match(page, /forfeit: !!match\.forfeit, forfeitedBy: match\.forfeitedBy \|\| null/, 'loading a session restores the forfeiter');
assert.doesNotMatch(page, /\.sidebar\{max-height:calc\(100dvh/, 'the sidebar is not its own scroll area');
assert.doesNotMatch(page, /overscroll-behavior:contain/);
assert.match(page, /sidebar\.style\.top = Math\.min\(18, window\.innerHeight - sidebar\.offsetHeight - 18\)/);
assert.match(page, /new ResizeObserver\(stick\)\.observe\(sidebar\)/);
assert.match(read('Print.html'), /m\.forfeitedBy === 'both' \|\| m\.forfeitedBy === id \? 'F'/, 'printed sheets mark a forfeit with F');

console.log('Forfeit recording, sheet upgrade, publication, and scrolling checks passed');
