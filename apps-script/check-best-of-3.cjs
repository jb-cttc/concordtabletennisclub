const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { projectFinalizedSession } = require('../scripts/lib/finalized-session');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const desk = { window: {} };
vm.createContext(desk);
vm.runInContext(read('Standings.html').match(/<script>([\s\S]*)<\/script>/)[1], desk);
vm.runInContext(read('Organizer.html').match(/<script>([\s\S]*)<\/script>/)[1], desk);
const O = desk.window.CTTCOrganizer;
const match = (g1, g2, extra) => ({ playerOneId: 'a', playerTwoId: 'b', playerOneGames: g1, playerTwoGames: g2, forfeit: false, forfeitedBy: null, wonBy: null, ...extra });

// A match cut short to best of 3 needs the winner to be named; 2 games alone is not a result.
assert.equal(O.matchState(match(2, 0)), 'invalid');
assert.equal(O.matchState(match(2, 0, { wonBy: 'a' })), 'complete');
assert.equal(O.matchState(match(2, 1, { wonBy: 'a' })), 'complete');
assert.equal(O.matchState(match(0, 2, { wonBy: 'b' })), 'complete');
assert.equal(O.matchState(match(1, 2, { wonBy: 'b' })), 'complete');
assert.equal(O.matchState(match(2, 2, { wonBy: 'a' })), 'invalid', 'a tie cannot be a win');
assert.equal(O.matchState(match(1, 1, { wonBy: 'a' })), 'invalid', 'the winner needs 2 games');
assert.equal(O.matchState(match(2, 0, { wonBy: 'b' })), 'invalid', 'the named winner must be the one with 2');
assert.equal(O.matchState(match(3, 1, { wonBy: 'a' })), 'complete', 'a full match is unaffected');
assert.equal(O.matchState(match(2, 0, { wonBy: 'a', forfeit: true, forfeitedBy: 'b' })), 'conflict', 'forfeit and best of 3 cannot both apply');

// The winner is known as soon as someone has 3 (before the other score is in), or is named at 2.
assert.equal(O.matchWinner(match(null, null)), null);
assert.equal(O.matchWinner(match(3, null)), 'a');
assert.equal(O.matchWinner(match(null, 3)), 'b');
assert.equal(O.matchWinner(match(1, 3)), 'b');
assert.equal(O.matchWinner(match(2, 0)), null, 'nobody is the winner until named');
assert.equal(O.matchWinner(match(2, 0, { wonBy: 'a' })), 'a');
assert.equal(O.matchWinner(match(2, 2, { wonBy: 'a' })), null);
assert.equal(O.matchWinner(match(null, null, { forfeit: true, forfeitedBy: 'a' })), 'b');
assert.equal(O.matchWinner(match(null, null, { forfeit: true, forfeitedBy: 'both' })), null);

// A forfeit replaces any best-of-3 declaration.
const m = match(2, 0, { wonBy: 'a' });
O.applyForfeit(m, 'b');
assert.equal(m.wonBy, null);

// Standings count a best-of-3 win as an ordinary win with the games played.
const people = { a: { name: 'Ava', currentRating: 1400 }, b: { name: 'Ben', currentRating: 1300 } };
const table = O.standings(['a', 'b'], [match(2, 1, { wonBy: 'a' })], id => people[id], O.ratingAdjustment);
const ava = table.rows.find(r => r.name === 'Ava');
const ben = table.rows.find(r => r.name === 'Ben');
assert.deepEqual([ava.wins, ava.gamesWon, ava.gamesLost, ben.losses, table.finished], [1, 2, 1, 1, true]);
assert.ok(ava.adjustment > 0 && ben.adjustment === -ava.adjustment, 'a best-of-3 win moves rating points like any played match');

// Server: saved, read back, validated for finalizing.
const sheets = { SessionPlayers: [], Matches: [], Sessions: [{ session_id: 's', session_date: '2026-10-05', status: 'active', revision: 1 }], Players: [
  { player_id: 'a', display_name: 'Ava', current_rating: 1400, active: true },
  { player_id: 'b', display_name: 'Ben', current_rating: 1300, active: true }
] };
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
  ensureMatchesColumns_: () => {},
  displayDate_: value => String(value)
});
const draft = extra => ({
  sessionId: 's', revision: sheets.Sessions[0].revision, groups: [{ groupNumber: 1, playerIds: ['a', 'b'] }],
  matches: [{ groupNumber: 1, playerOneId: 'a', playerTwoId: 'b', playerOneGames: 2, playerTwoGames: 0, forfeit: false, forfeitedBy: null, ...extra }]
});
let saved = server.saveSessionDraft(draft({ wonBy: 'a' }));
assert.equal(sheets.Matches[0].won_by, 'a');
assert.equal(saved.matches[0].wonBy, 'a');
saved = server.saveSessionDraft(draft({}));
assert.equal(sheets.Matches[0].won_by, '', 'clearing removes the declaration');
assert.equal(saved.matches[0].wonBy, null);
assert.throws(() => server.saveSessionDraft(draft({ wonBy: 'b' })), /best-of-3 winner needs exactly 2 games/);
assert.throws(() => server.saveSessionDraft(draft({ wonBy: 'a', playerTwoGames: 2 })), /best-of-3 winner needs exactly 2 games/);
assert.throws(() => server.saveSessionDraft(draft({ wonBy: 'a', playerTwoGames: null })), /best-of-3 winner needs exactly 2 games/, 'the other score must be in');
assert.throws(() => server.saveSessionDraft(draft({ wonBy: 'a', forfeitedBy: 'b' })), /cannot also be a best-of-3 win/);

const players = [{ session_id: 's', player_id: 'a', group_number: 1 }, { session_id: 's', player_id: 'b', group_number: 1 }];
const row = extra => ({ player_one_id: 'a', player_two_id: 'b', player_one_games: 2, player_two_games: 1, forfeit: false, won_by: 'a', ...extra });
server.validateCompleteRoundRobin_(players, [row({})]);
server.validateCompleteRoundRobin_(players, [row({ player_two_games: 0 })]);
assert.throws(() => server.validateCompleteRoundRobin_(players, [row({ won_by: '' })]), /Incomplete or invalid match/, 'two games alone does not finish a match');
assert.throws(() => server.validateCompleteRoundRobin_(players, [row({ won_by: 'b' })]), /invalid best-of-3/);
assert.throws(() => server.validateCompleteRoundRobin_(players, [row({ player_two_games: 2 })]), /invalid best-of-3/);
assert.throws(() => server.validateCompleteRoundRobin_(players, [row({ player_two_games: '' })]), /invalid best-of-3/);
assert.throws(() => server.validateCompleteRoundRobin_(players, [row({ forfeited_by: 'b' })]), /cannot also be a best-of-3 win/);

// Publishing accepts a named best-of-3 win and still refuses an unnamed 2-game result.
const finalized = extra => projectFinalizedSession(
  { session_id: 's', session_date: '2026-10-05', status: 'finalized', revision: 3, finalized_at: '2026-10-05T23:00:00Z' },
  [{ session_id: 's', player_id: 'a', group_number: 1, starting_rating: 1400 }, { session_id: 's', player_id: 'b', group_number: 1, starting_rating: 1300 }],
  [{ session_id: 's', group_number: 1, player_one_id: 'a', player_two_id: 'b', player_one_games: 2, player_two_games: 1, forfeit: false, forfeited_by: '', won_by: 'a', ...extra }],
  [{ session_id: 's', player_id: 'a', rating_before: 1400, adjustment: 4, rating_after: 1404, rule_version: 'cttc-access-v1' },
   { session_id: 's', player_id: 'b', rating_before: 1300, adjustment: -4, rating_after: 1296, rule_version: 'cttc-access-v1' }],
  [{ player_id: 'a', display_name: 'Ava' }, { player_id: 'b', display_name: 'Ben' }]
);
const published = finalized({}).groups[0].players.find(p => p.name === 'Ava');
assert.deepEqual([published.wins, published.gamesWon, published.gamesLost], [1, 2, 1]);
assert.throws(() => finalized({ won_by: '' }), /Invalid or duplicate match/);
assert.throws(() => finalized({ won_by: 'b' }), /Invalid or duplicate match/);

console.log('Best-of-3 checks passed');
