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
  // Two ratings: a player's first Equalizer starts their EQ rating from a copy of their round robin rating (here the
  // round robin finalized earlier that day), and the Equalizer moves only the EQ rating.
  const both = world.players.find(p => p.player_id === ids[2]).display_name;
  const rrResult = publication.details[0].groups[0].players.find(p => p.name === both);
  const eqResult = equalizer.groups[0].players.find(p => p.name === both);
  assert.equal(eqResult.ratingBefore, rrResult.ratingAfter, 'a first Equalizer starts from a copy of the RR rating');
  assert.equal(eqResult.ratingAdj, 8 * (eqResult.wins - eqResult.losses));

  const players = buildPlayers(publication.details);
  const record = players.find(p => p.name === both);
  assert.equal(record.currentRating, rrResult.ratingAfter, 'the RR rating leaves the Equalizer out');
  assert.equal(record.eqRating, eqResult.ratingAfter, 'the EQ rating is the Equalizer\'s');
  assert.deepEqual(record.ratingHistory.map(h => h.variant || 'rr'), ['rr'], 'the RR history (leaderboard, chart) is round robins only');
  assert.deepEqual(record.eqRatingHistory.map(h => [h.date, h.rating]), [[DATE, eqResult.ratingAfter]]);
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

    // The Equalizer's results email, from what was published.
    const { buildEqualizerEmail, latestEqualizerDate } = require('./build-equalizer-email');
    assert.equal(latestEqualizerDate(dir), DATE);
    const email = buildEqualizerEmail(DATE, { dataDir: dir, unsubscribeUrl: 'https://example.test/unsub' });
    const eqSession = JSON.parse(published).find(s => s.variant === 'equalizer');
    const champion = eqSession.equalizer.champion.join(' & ');
    assert.match(email.subject, /^CTTC Equalizer Results - Saturday, November 7, 2026$/);
    assert.ok(email.text.includes(champion + ' wins the Equalizer'), 'the champion leads');
    assert.ok(email.html.includes('Final Standings') && email.html.includes('Group Winners'));
    assert.equal(email.summary.groups.length, eqSession.equalizer.matches.filter(m => m.stage === 'G').map(m => m.id.split('-')[0]).filter((g, i, all) => all.indexOf(g) === i).length, 'one winner per group');
    const players = eqSession.groups[0].players;
    const top = players.slice().sort((a, b) => b.ratingAdj - a.ratingAdj)[0];
    assert.equal(email.summary.movers.gainers[0].ratingAdj, top.ratingAdj, 'movers are by EQ rating change');
    assert.ok(email.summary.explain && /round robin rating does not change/.test(email.text), 'the first Equalizer explains the EQ rating');
    assert.equal(email.summary.totals.players, players.length);
    assert.equal(email.summary.totals.matches, eqSession.equalizer.matches.length);
    assert.ok(email.html.includes('https://example.test/unsub'));
    // Every Equalizer email says, first thing and beside the changes, that these are not official ratings.
    [email.html, email.text].forEach(body => {
      assert.match(body, /These are NOT official ratings/i);
      assert.match(body, /experimental copy kept separately for this game variant/);
      assert.match(body, /not the official round robin rating/);
      assert.ok(body.search(/NOT official ratings/i) < body.indexOf(champion), 'the notice comes before the results');
    });
    assert.ok(email.html.includes('/roundrobins.html#eq-' + DATE) && email.text.includes('/roundrobins.html#eq-' + DATE), 'the link goes to the Equalizer on the Round Robins page');
    assert.doesNotMatch(email.html + email.text, /player-sim-|@/, 'no private ids or addresses');
    // CTTC_EMAIL_PREVIEW=<file>: also write this simulated email there, to look at.
    if (process.env.CTTC_EMAIL_PREVIEW) await fs.writeFile(process.env.CTTC_EMAIL_PREVIEW, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Equalizer Email Preview</title><body style="margin:0;padding:24px 16px;background:#f4f1ec"><div style="background:#fff;max-width:560px;margin:0 auto;padding:24px;border:1px solid #ddd8d0"><p style="font:12px Arial,sans-serif;color:#7a5200;margin:0 0 12px">Subject: ' + email.subject + ' · made-up players from the desk simulator</p>' + email.html + '</div></body>');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  {
    // The sender, on the simulated publication: a normal run sends the newest round robin and the newest Equalizer,
    // each once, and marks each; a second run sends nothing.
    const { execFileSync } = require('child_process');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cttc-equalizer-send-'));
    try {
      const data = path.join(dir, 'data');
      const cache = path.join(dir, 'cache');
      await fs.mkdir(cache);
      await fs.mkdir(data);
      await publish(tables(), data, '2026-11-01');
      const stub = path.join(dir, 'nodemailer-stub.js');
      await fs.writeFile(stub, "const Module=require('module');const orig=Module._resolveFilename;Module._resolveFilename=function(r,...a){return r==='nodemailer'?__filename:orig.call(this,r,...a)};module.exports={createTransport:()=>({sendMail:async m=>{require('fs').appendFileSync(process.env.SENT_LOG,m.to+' '+m.subject+'\\n');return{}},close(){}})};");
      const log = path.join(dir, 'sent.log');
      const env = Object.assign({}, process.env, { GMAIL_USER: 'club@example.test', GMAIL_APP_PASSWORD: 'x', EMAIL_SUBSCRIBERS: 'a@example.test', SENT_LOG: log, GOOGLE_SHEETS_SUBSCRIBERS_ID: '', CTTC_TEST_SEND: '', CTTC_LIVE_START_DATE: '', UNSUBSCRIBE_TOKEN_SECRET: '', CTTC_DATA_DIR: data, CTTC_CACHE_DIR: cache });
      const run = () => execFileSync(process.execPath, ['-r', stub, path.join(__dirname, 'send-session-email.js')], { env, encoding: 'utf8' });
      // The round robin was emailed already; the Equalizer never was.
      await fs.writeFile(path.join(cache, 'last-emailed-session.json'), JSON.stringify({ date: DATE }));
      const first = run();
      assert.match(first, /Session 2026-11-07 was already emailed; skipping/);
      assert.match(first, /Sent "CTTC Equalizer Results - Saturday, November 7, 2026" to 1 subscriber/);
      const sent = (await fs.readFile(log, 'utf8')).trim().split('\n');
      assert.deepEqual(sent.map(line => line.split(' ')[0]).sort(), ['a@example.test', 'club@example.test'], 'the subscriber, and a copy for the club');
      assert.ok(sent.every(line => / CTTC Equalizer Results/.test(line)), 'the round robin is not sent again');
      assert.equal(JSON.parse(await fs.readFile(path.join(cache, 'last-emailed-equalizer.json'), 'utf8')).date, DATE);
      const second = run();
      assert.match(second, /Equalizer 2026-11-07 was already emailed; skipping/, 'and never twice');
      assert.equal((await fs.readFile(log, 'utf8')).trim().split('\n').length, 2);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
  console.log('Equalizer publication checks passed');
})().catch(error => { console.error(error); process.exit(1); });
