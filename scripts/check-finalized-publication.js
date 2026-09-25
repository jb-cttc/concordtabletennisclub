'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ratings = require('../rating-engine');
const { buildPublication, publish } = require('./publish-finalized-sessions');

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cttc-publication-'));
  try {
    const historical = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'data', 'session-details-2026.json'), 'utf8'))
      .find(function (session) { return session.date === '2026-09-16'; });
    assert(historical);
    await fs.writeFile(path.join(directory, 'session-details-2026.json'), JSON.stringify([historical]));
    const points = ratings.adjustment(1000, 1100, false);
    const tables = {
      Sessions: [
        { session_id: 'live-1', session_date: '2026-09-23', status: 'finalized', revision: 2, finalized_at: '2026-09-23T23:00:00Z' },
        { session_id: 'draft', session_date: '2026-09-24', status: 'draft' }
      ],
      SessionPlayers: [
        { session_id: 'live-1', player_id: 'alice', group_number: 1, starting_rating: 1000 },
        { session_id: 'live-1', player_id: 'bob', group_number: 1, starting_rating: 1100 }
      ],
      Matches: [{ session_id: 'live-1', group_number: 1, player_one_id: 'alice', player_two_id: 'bob', player_one_games: 3, player_two_games: 1 }],
      RatingLedger: [
        { session_id: 'live-1', player_id: 'alice', rating_before: 1000, adjustment: points, rating_after: 1000 + points, rule_version: 'cttc-access-v1' },
        { session_id: 'live-1', player_id: 'bob', rating_before: 1100, adjustment: -points, rating_after: 1100 - points, rule_version: 'cttc-access-v1' }
      ],
      Players: [
        { player_id: 'alice', display_name: 'Alice', email: 'PRIVATE_ADDRESS' },
        { player_id: 'bob', display_name: 'Bob', phone: 'PRIVATE_PHONE' }
      ]
    };
    const result = await publish(tables, directory, '2026-09-23');
    assert.deepEqual(result.details.map(function (session) { return session.date; }), ['2026-09-23', '2026-09-16']);
    assert.equal(result.live[0].groups[0].players[0].name, 'Alice');
    assert.equal(result.live[0].groups[0].players[0].ratingAdj, points);
    const detailJson = await fs.readFile(path.join(directory, 'session-details-2026.json'), 'utf8');
    assert(!detailJson.includes('PRIVATE_'));
    assert(!(await fs.readFile(path.join(directory, 'players.json'), 'utf8')).includes('PRIVATE_'));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'sessions.json'), 'utf8'))[0],
      { date: '2026-09-23', sessionId: 'live-1', source: 'app' });
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'site-status.json'), 'utf8')).latestSessionDate, '2026-09-23');
    assert.throws(function () { buildPublication(result.details, { ...tables, Sessions: [] }, '2026-09-23'); }, /missing or changed/);
    assert.throws(function () { buildPublication(result.details, { ...tables, Players: [{ ...tables.Players[0], display_name: 'Different name' }, tables.Players[1]] }, '2026-09-23'); }, /missing or changed/);
    assert.throws(function () { buildPublication([historical, { date: '2026-09-23', fileId: 'old' }], tables, '2026-09-23'); }, /old Drive/);
    assert.throws(function () { buildPublication([historical], { ...tables, RatingLedger: [] }, '2026-09-23'); }, /ledger/);
    const nextYearTables = {
      ...tables,
      Sessions: [{ ...tables.Sessions[0], session_id: 'next-year', session_date: '2027-01-04' }],
      SessionPlayers: tables.SessionPlayers.map(function (row) { return { ...row, session_id: 'next-year' }; }),
      Matches: tables.Matches.map(function (row) { return { ...row, session_id: 'next-year' }; }),
      RatingLedger: tables.RatingLedger.map(function (row) { return { ...row, session_id: 'next-year' }; })
    };
    const nextYearDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cttc-next-year-'));
    try {
      await fs.writeFile(path.join(nextYearDirectory, 'session-details-2026.json'), JSON.stringify([historical]));
      await publish(nextYearTables, nextYearDirectory, '2026-09-23');
      assert.equal(JSON.parse(await fs.readFile(path.join(nextYearDirectory, 'session-details-2027.json'), 'utf8'))[0].date, '2027-01-04');
    } finally {
      await fs.rm(nextYearDirectory, { recursive: true, force: true });
    }
    console.log('Finalized publication, history, privacy, and rejection checks pass');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch(function (error) { console.error(error); process.exitCode = 1; });