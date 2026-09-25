'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ratings = require('../rating-engine');
const { HEADERS, publish } = require('./publish-finalized-sessions');
const { preflight } = require('./preflight-live-publication');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cttc-disposable-session-'));
  const dataDir = path.join(root, 'data');
  const tablesFile = path.join(root, 'private-tables.json');
  const date = '2099-12-28';
  const sessionId = 'disposable-session-2099-12-28';
  try {
    await fs.mkdir(dataDir);
    const historical = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'data', 'session-details-2026.json'), 'utf8'))
      .find(function (session) { return session.date === '2026-09-16'; });
    assert(historical, 'Historical test anchor is missing');
    await fs.writeFile(path.join(dataDir, 'session-details-2026.json'), JSON.stringify([historical]));

    const tables = {
      Players: [
        { player_id: 'test-one', display_name: 'Test One', current_rating: 1000, email: 'PRIVATE_TEST_EMAIL' },
        { player_id: 'test-two', display_name: 'Test Two', current_rating: 1100, phone: 'PRIVATE_TEST_PHONE' }
      ],
      Sessions: [{ session_id: sessionId, session_date: date, status: 'draft', revision: 1, finalized_at: '' }],
      SessionPlayers: [
        { session_id: sessionId, player_id: 'test-one', group_number: 1, starting_rating: 1000 },
        { session_id: sessionId, player_id: 'test-two', group_number: 1, starting_rating: 1100 }
      ],
      Matches: [],
      RatingLedger: []
    };
    async function save() { await fs.writeFile(tablesFile, JSON.stringify(tables)); }
    async function reload() { return JSON.parse(await fs.readFile(tablesFile, 'utf8')); }
    async function mockSheetReader(_spreadsheetId, range) {
      const table = range.split('!')[0];
      const saved = await reload();
      return [HEADERS[table]].concat(saved[table].map(function (row) {
        return HEADERS[table].map(function (header) { return row[header] === undefined ? '' : String(row[header]); });
      }));
    }

    await save();
    assert.equal((await reload()).Sessions[0].status, 'draft');
    assert.equal((await preflight('test-sheet', 'test-email', 'test-key', '2099-01-01', dataDir, mockSheetReader)).finalized.length, 0);
    await publish(await reload(), dataDir, '2099-01-01');
    assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'site-status.json'), 'utf8')).latestSessionDate, historical.date);
    const baseline = await Promise.all((await fs.readdir(dataDir)).map(async function (name) {
      return [name, await fs.readFile(path.join(dataDir, name))];
    }));

    tables.Matches.push({ session_id: sessionId, group_number: 1, player_one_id: 'test-one', player_two_id: 'test-two', player_one_games: 3, player_two_games: 1, forfeit: false });
    await save();
    assert.equal((await reload()).Matches[0].player_one_games, 3);
    await publish(await reload(), dataDir, '2099-01-01');
    assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'site-status.json'), 'utf8')).latestSessionDate, historical.date);

    const points = ratings.adjustment(1000, 1100, false);
    tables.Sessions[0].status = 'finalized';
    tables.Sessions[0].revision = 2;
    tables.Sessions[0].finalized_at = '2099-12-28T23:00:00Z';
    tables.RatingLedger.push(
      { session_id: sessionId, player_id: 'test-one', rating_before: 1000, adjustment: points, rating_after: 1000 + points, rule_version: 'cttc-access-v1' },
      { session_id: sessionId, player_id: 'test-two', rating_before: 1100, adjustment: -points, rating_after: 1100 - points, rule_version: 'cttc-access-v1' }
    );
    await save();
    assert.equal((await preflight('test-sheet', 'test-email', 'test-key', '2099-01-01', dataDir, mockSheetReader)).finalized[0].sessionId, sessionId);
    assert(!(await fs.readdir(dataDir)).includes('session-details-2099.json'));
    const result = await publish(await reload(), dataDir, '2099-01-01');
    assert.equal(result.live.length, 1);
    const live = JSON.parse(await fs.readFile(path.join(dataDir, 'session-details-2099.json'), 'utf8'))[0];
    assert.equal(live.sessionId, sessionId);
    assert.equal(live.groups[0].players[0].wins, 1);
    assert.equal(live.groups[0].players[0].matches[0].gamesWon, 3);
    assert.equal(live.groups[0].players[0].ratingAfter, 1000 + points);
    assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'site-status.json'), 'utf8')).latestSessionDate, date);
    for (const name of await fs.readdir(dataDir)) {
      assert(!(await fs.readFile(path.join(dataDir, name), 'utf8')).includes('PRIVATE_TEST_'));
    }

    await fs.rm(path.join(dataDir, 'session-details-2099.json'));
    for (const [name, content] of baseline) await fs.writeFile(path.join(dataDir, name), content);
    assert.deepEqual((await fs.readdir(dataDir)).sort(), baseline.map(function (entry) { return entry[0]; }).sort());
    for (const [name, content] of baseline) assert.deepEqual(await fs.readFile(path.join(dataDir, name)), content);
    console.log('Disposable draft -> scores -> finalize -> public JSON -> restore passed');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  console.log('Private test tables and published files removed');
}

main().catch(function (error) { console.error(error); process.exitCode = 1; });