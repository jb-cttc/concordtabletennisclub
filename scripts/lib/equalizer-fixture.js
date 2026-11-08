'use strict';

// A made-up Equalizer, published the way the site gets one: drawn, played and finalized on the simulated desk
// (desk-sim.js), then turned into session details by publish-finalized-sessions.js. For the site's page checks and
// previews (scripts/check-equalizer-results-page.js). Made-up players only.
const { createWorld } = require('./desk-sim');
const { buildPublication } = require('../publish-finalized-sessions');
const E = require('../../equalizer');

function seededRandom(seed) {
  let value = seed;
  return () => { value = (value * 1103515245 + 12345) % 2147483648; return value / 2147483648; };
}

// players: how many (20 gives five groups of 4, a Finals of 5 with three byes); forfeits: matches a player gave up.
function publishedEqualizer(options) {
  const settings = Object.assign({ date: '2026-11-07', players: 20, seed: 9, forfeits: 2 }, options);
  const world = createWorld({ date: settings.date, players: settings.players + 2, seed: settings.seed });
  const server = world.server;
  const plain = value => JSON.parse(JSON.stringify(value));
  const run = (name, ...args) => plain(server.run(name, ...args));
  const ids = world.players.map(p => p.player_id).slice(0, settings.players);
  const ratingOf = id => Number(server.rows('Players').find(p => p.player_id === id).current_rating);
  const rng = seededRandom(settings.seed);
  const draw = E.draw({ players: ids.map(id => ({ id, rating: ratingOf(id) })) }, rng);
  run('saveEqualizerSetup', settings.date, { roster: ids, format: 'groups', play: 'singles', bestOf: 3, draw });
  const event = E.fromSnapshot(draw);
  let results = {};
  let forfeits = settings.forfeits;
  for (let guard = 0; guard < 200; guard += 1) {
    const view = E.resolve(event, results);
    if (view.finished) break;
    const m = E.callOrder(view)[0];
    const hs = E.headStart(event, m.players[0], m.players[1], []);
    let result;
    if (m.bracket === 'G' && forfeits > 0 && rng() < 0.1) {
      forfeits -= 1;
      result = { winnerId: m.players[0], forfeitedBy: m.players[1] };
    } else {
      // The lower-rated side wins a fair share with its head start.
      const under = hs.lowerId && rng() < 0.45 ? hs.lowerId : m.players[rng() < 0.5 ? 0 : 1];
      const side = m.players.indexOf(under);
      result = { winnerId: under, games: side === 0 ? [2, rng() < 0.5 ? 1 : 0] : [rng() < 0.5 ? 1 : 0, 2] };
      if (hs.lowerId && hs.headStart) result.headStart = { sideId: hs.lowerId, points: hs.headStart };
    }
    run('saveEqualizerResult', settings.date, m.id, result, null);
    results = run('getEqualizerState', settings.date).results;
  }
  const revision = Number(server.rows('Sessions').find(r => r.session_id === 'session-' + settings.date + '-equalizer').revision);
  run('finalizeEqualizer', settings.date, revision);
  const tables = { NameChanges: [] };
  ['Players', 'Sessions', 'SessionPlayers', 'Matches', 'RatingLedger', 'Brackets', 'BracketMatches'].forEach(name => {
    tables[name] = plain(server.rows(name)).map(row => {
      delete row.__row;
      if (name === 'Sessions') row.session_date = String(row.session_date).slice(0, 10);
      return row;
    });
  });
  const publication = buildPublication([], tables, '2026-11-01');
  return publication.details.find(s => s.variant === 'equalizer');
}

module.exports = { publishedEqualizer };
