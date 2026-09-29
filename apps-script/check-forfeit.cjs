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
vm.runInContext(read('Organizer.html').match(/<script>([\s\S]*)<\/script>/)[1], desk);
const O = desk.window.CTTCOrganizer;
const match = (g1, g2, extra) => ({ playerOneId: 'a', playerTwoId: 'b', playerOneGames: g1, playerTwoGames: g2, forfeit: false, forfeitedBy: null, ...extra });

assert.equal(O.matchState(match(3, 0, { forfeit: true, forfeitedBy: 'b' })), 'complete');
assert.equal(O.matchState(match(3, 0, { forfeit: true, forfeitedBy: 'a' })), 'conflict', 'the forfeiter cannot be the winner');
assert.equal(O.matchState(match(0, 3, { forfeit: true, forfeitedBy: 'a' })), 'complete');
assert.equal(O.matchState(match(3, 0, { forfeit: true })), 'complete', 'older forfeits without a recorded forfeiter still count');
assert.equal(O.matchState(match(null, null, { forfeit: true, forfeitedBy: 'a' })), 'pending');

let m = match(null, null);
assert.equal(O.applyForfeit(m, 'a'), true, 'a blank score is filled in');
assert.deepEqual([m.playerOneGames, m.playerTwoGames, m.forfeit, m.forfeitedBy], [0, 3, true, 'a']);
m = match(null, null);
O.applyForfeit(m, 'b');
assert.deepEqual([m.playerOneGames, m.playerTwoGames, m.forfeitedBy], [3, 0, 'b']);
m = match(3, 1);
assert.equal(O.applyForfeit(m, 'b'), false, 'an entered score is never overwritten');
assert.deepEqual([m.playerOneGames, m.playerTwoGames, m.forfeitedBy], [3, 1, 'b']);
O.applyForfeit(m, '');
assert.deepEqual([m.forfeit, m.forfeitedBy, m.playerOneGames], [false, null, 3], 'clearing keeps the score');
O.applyForfeit(m, '?');
assert.deepEqual([m.forfeit, m.forfeitedBy], [true, null], 'keeps an older unrecorded forfeit');
assert.throws(() => O.applyForfeit(match(null, null), 'c'), /not in this match/);

const people = { a: { name: 'Ava', currentRating: 1400 }, b: { name: 'Ben', currentRating: 1300 } };
const table = O.standings(['a', 'b'], [match(3, 0, { forfeit: true, forfeitedBy: 'b' })], id => people[id], O.ratingAdjustment);
assert.equal(table.rows.find(r => r.name === 'Ava').adjustment, 0, 'a forfeit moves no rating points');
assert.equal(table.rows.find(r => r.name === 'Ava').wins, 1);
assert.equal(O.standings(['a', 'b'], [match(3, 0, { forfeit: true, forfeitedBy: 'a' })], id => people[id], O.ratingAdjustment).complete, 0, 'a conflicting forfeit is not counted');

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
  rows_: name => sheets[name].map((row, index) => ({ ...row, __row: index + 2 })),
  updateRow_: (name, row, changes) => Object.assign(sheets[name][row - 2], changes),
  replaceSessionRows_: (name, id, rows) => { sheets[name] = sheets[name].filter(r => r.session_id !== id).concat(rows); },
  ensureMatchesColumns_: () => { upgrades += 1; },
  displayDate_: value => String(value)
});
const draft = (forfeitedBy, extra) => ({
  sessionId: 's', revision: sheets.Sessions[0].revision, groups: [{ groupNumber: 1, playerIds: ['a', 'b'] }],
  matches: [{ groupNumber: 1, playerOneId: 'a', playerTwoId: 'b', playerOneGames: 3, playerTwoGames: 0, forfeit: false, forfeitedBy, ...extra }]
});
let saved = server.saveSessionDraft(draft('b'));
assert.equal(upgrades, 1, 'the Sheet column is checked before every save');
assert.deepEqual([sheets.Matches[0].forfeited_by, sheets.Matches[0].forfeit], ['b', true], 'naming a forfeiter marks the match as a forfeit');
assert.equal(saved.matches[0].forfeitedBy, 'b');
saved = server.saveSessionDraft(draft(null));
assert.deepEqual([sheets.Matches[0].forfeited_by, sheets.Matches[0].forfeit], ['', false], 'clearing removes the forfeiter');
assert.equal(saved.matches[0].forfeitedBy, null);
saved = server.saveSessionDraft(draft(null, { forfeit: true }));
assert.deepEqual([sheets.Matches[0].forfeited_by, sheets.Matches[0].forfeit], ['', true], 'an older unrecorded forfeit is preserved');
assert.throws(() => server.saveSessionDraft(draft('zzz')), /not in the match/);
assert.deepEqual([sheets.Matches[0].forfeited_by, sheets.Matches[0].forfeit], ['', true], 'a rejected save changes nothing');

const players = [{ session_id: 's', player_id: 'a', group_number: 1 }, { session_id: 's', player_id: 'b', group_number: 1 }];
const row = extra => ({ player_one_id: 'a', player_two_id: 'b', player_one_games: 3, player_two_games: 1, forfeit: true, ...extra });
server.validateCompleteRoundRobin_(players, [row({ forfeited_by: 'b' })]);
assert.throws(() => server.validateCompleteRoundRobin_(players, [row({ forfeited_by: 'a' })]), /must have lost/);
assert.throws(() => server.validateCompleteRoundRobin_(players, [row({})]), /Choose who forfeited/);
server.validateCompleteRoundRobin_(players, [row({ forfeit: false })]);

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

const finalized = (forfeitedBy) => projectFinalizedSession(
  { session_id: 's', session_date: '2026-10-05', status: 'finalized', revision: 3, finalized_at: '2026-10-05T23:00:00Z' },
  [{ session_id: 's', player_id: 'a', group_number: 1, starting_rating: 1400 }, { session_id: 's', player_id: 'b', group_number: 1, starting_rating: 1300 }],
  [{ session_id: 's', group_number: 1, player_one_id: 'a', player_two_id: 'b', player_one_games: 3, player_two_games: 0, forfeit: true, forfeited_by: forfeitedBy }],
  [{ session_id: 's', player_id: 'a', rating_before: 1400, adjustment: 0, rating_after: 1400, rule_version: 'cttc-access-v1' },
   { session_id: 's', player_id: 'b', rating_before: 1300, adjustment: 0, rating_after: 1300, rule_version: 'cttc-access-v1' }],
  [{ player_id: 'a', display_name: 'Ava' }, { player_id: 'b', display_name: 'Ben' }]
);
const winnerEntry = finalized('b').groups[0].players.find(p => p.name === 'Ava').matches[0];
assert.deepEqual([winnerEntry.forfeit, winnerEntry.forfeitedBy, winnerEntry.adj], [true, 'Ben', 0], 'the public result names the forfeiter and moves no points');
assert.equal(finalized('').groups[0].players[0].matches[0].forfeitedBy, undefined, 'older forfeits publish without a forfeiter');
assert.throws(() => finalized('a'), /must have lost/);

// Desk page: the selector replaces the checkbox, and the sidebar no longer traps scrolling.
const page = read('Index.html');
assert.doesNotMatch(page, /type="checkbox" data-forfeit/);
assert.match(page, /data-forfeit="' \+ index/);
assert.match(page, /Who forfeited/);
assert.match(page, /forfeit: old\.forfeit, forfeitedBy: old\.forfeitedBy \|\| null/, 'reordering a group keeps the forfeiter');
assert.match(page, /forfeit: !!match\.forfeit, forfeitedBy: match\.forfeitedBy \|\| null/, 'loading a session restores the forfeiter');
assert.doesNotMatch(page, /\.sidebar\{max-height:calc\(100dvh/, 'the sidebar is not its own scroll area');
assert.doesNotMatch(page, /overscroll-behavior:contain/);
assert.match(page, /sidebar\.style\.top = Math\.min\(18, window\.innerHeight - sidebar\.offsetHeight - 18\)/);
assert.match(page, /new ResizeObserver\(stick\)\.observe\(sidebar\)/);

console.log('Forfeit recording, sheet upgrade, publication, and scrolling checks passed');
