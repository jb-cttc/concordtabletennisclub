'use strict';

// Publishing an Equalizer: a round robin and an Equalizer finalized on the same date at the desk (simulated Google, made-up
// players) go out together; ratings chain from one to the other; Equalizer wins and losses stay out of round robin
// records; and an Equalizer that cannot be checked is left out and reported without stopping the round robin.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWorld } = require('./lib/desk-sim');
const { buildPublication, publish } = require('./publish-finalized-sessions');
const { buildPlayers } = require('./fetch-and-parse');
const E = require('../equalizer');

const DATE = '2026-11-07';
const world = createWorld({ date: DATE, players: 16 });
const server = world.server;
const plain = value => JSON.parse(JSON.stringify(value));
const run = (name, ...args) => plain(server.run(name, ...args));
const ids = world.players.map(p => p.player_id);
const ratingOf = id => Number(server.rows('Players').find(p => p.player_id === id).current_rating);
function seededRandom(seed) {
  let value = seed;
  return () => { value = (value * 1103515245 + 12345) % 2147483648; return value / 2147483648; };
}

// The round robin: one group of 4, every match played, finalized first.
const rrPlayers = ids.slice(0, 4);
let rr = run('createSession', DATE);
const pairs = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
rr = run('saveSessionDraft', { sessionId: rr.sessionId, revision: rr.revision, groups: [{ groupNumber: 1, playerIds: rrPlayers }], promotions: {},
  matches: pairs.map(([a, b]) => ({ groupNumber: 1, playerOneId: rrPlayers[a], playerTwoId: rrPlayers[b], playerOneGames: 3, playerTwoGames: 1, forfeit: false })) });
run('finalizeSession', rr.sessionId, rr.revision);

// The Equalizer the same afternoon, with two round robin players in it too: they start from their new ratings.
const eqPlayers = ids.slice(2, 10);
const draw = E.draw({ players: eqPlayers.map(id => ({ id, rating: ratingOf(id) })) }, seededRandom(5));
run('saveEqualizerSetup', DATE, { roster: eqPlayers, format: 'groups', play: 'singles', bestOf: 3, draw });
const event = E.fromSnapshot(draw);
let results = {};
for (;;) {
  const view = E.resolve(event, results);
  if (view.finished) break;
  const m = E.callOrder(view)[0];
  run('saveEqualizerResult', DATE, m.id, { winnerId: m.players[1], games: [1, 2], headStart: { sideId: m.players[1], points: 2 } }, null);
  results = run('getEqualizerState', DATE).results;
}
const eqRevision = Number(server.rows('Sessions').find(r => r.session_id === 'session-' + DATE + '-equalizer').revision);
run('finalizeEqualizer', DATE, eqRevision);

const TABLES = ['Players', 'Sessions', 'SessionPlayers', 'Matches', 'RatingLedger', 'Brackets', 'BracketMatches'];
function tables() {
  const out = { NameChanges: [] };
  TABLES.forEach(name => {
    out[name] = plain(server.rows(name)).map(row => {
      delete row.__row;
      if (name === 'Sessions') row.session_date = String(row.session_date).slice(0, 10);
      return row;
    });
  });
  return out;
}

(async () => {
  const publication = buildPublication([], tables(), '2026-11-01');
  assert.deepEqual(publication.skipped, []);
  assert.deepEqual(publication.details.map(s => [s.date, s.variant || 'rr']), [[DATE, 'rr'], [DATE, 'equalizer']], 'the round robin first on a shared date');
  const equalizer = publication.details[1];
  assert.equal(equalizer.sessionId, 'session-' + DATE + '-equalizer');
  assert.equal(equalizer.groups[0].name, 'Equalizer');
  assert.equal(equalizer.groups[0].players.length, 8);
  assert.equal(equalizer.equalizer.format, 'groups');
  assert.equal(equalizer.equalizer.matches.length, Object.keys(results).length);
  assert.ok(equalizer.equalizer.matches.every(m => m.headStart && m.headStart.points === 2), 'head starts are published as played');
  assert.equal(equalizer.groups[0].players[0].place.place, 1, 'players in finishing order');
  // Ratings chain: a player in both starts the Equalizer from the round robin's result.
  const both = world.players.find(p => p.player_id === ids[2]).display_name;
  const rrResult = publication.details[0].groups[0].players.find(p => p.name === both);
  const eqResult = equalizer.groups[0].players.find(p => p.name === both);
  assert.equal(eqResult.ratingBefore, rrResult.ratingAfter, 'the Equalizer starts where the round robin ended');
  assert.equal(eqResult.ratingAdj, 8 * (eqResult.wins - eqResult.losses));

  const players = buildPlayers(publication.details);
  const record = players.find(p => p.name === both);
  assert.equal(record.currentRating, eqResult.ratingAfter, 'the rating includes the Equalizer');
  assert.deepEqual(record.ratingHistory.map(h => h.variant || 'rr'), ['rr', 'equalizer']);
  assert.equal(record.sessionsPlayed, 1, 'Equalizer wins, losses and sessions stay out of round robin records');
  assert.equal(record.totalWins + record.totalLosses, 3);

  // An Equalizer whose ledger does not match is left out and reported; the round robin still publishes.
  const broken = tables();
  const row = broken.RatingLedger.find(r => r.session_id === 'session-' + DATE + '-equalizer');
  row.adjustment = Number(row.adjustment) + 1;
  const partial = buildPublication([], broken, '2026-11-01');
  assert.deepEqual(partial.details.map(s => s.variant || 'rr'), ['rr']);
  assert.equal(partial.skipped.length, 1);
  assert.match(partial.skipped[0].reason, /ledger disagrees/);
  // Published already, then broken: the published copy stays.
  const kept = buildPublication(publication.details, broken, '2026-11-01');
  assert.deepEqual(kept.details.map(s => s.variant || 'rr'), ['rr', 'equalizer']);
  assert.equal(kept.skipped.length, 1);

  // The files: sessions.json marks the Equalizer, and site-status names the newest round robin for the email.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cttc-equalizer-publication-'));
  try {
    await publish(tables(), dir, '2026-11-01');
    const sessions = JSON.parse(await fs.readFile(path.join(dir, 'sessions.json'), 'utf8'));
    assert.deepEqual(sessions.map(s => s.variant || 'rr'), ['rr', 'equalizer']);
    const status = JSON.parse(await fs.readFile(path.join(dir, 'site-status.json'), 'utf8'));
    assert.equal(status.latestRoundRobinDate, DATE);
    assert.equal(status.equalizerNotPublished, undefined);
    // No private ids or contact details in what is published.
    const published = await fs.readFile(path.join(dir, 'session-details-2026.json'), 'utf8');
    assert.doesNotMatch(published, /player-sim-|@/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  console.log('Equalizer publication checks passed');
})().catch(error => { console.error(error); process.exit(1); });
