'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { fetchSheetRows } = require('./lib/google-sheets');
const { projectFinalizedSession } = require('./lib/finalized-session');
const { buildPlayers } = require('./fetch-and-parse');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const HEADERS = {
  Players: ['player_id', 'display_name', 'current_rating', 'active', 'created_at', 'updated_at'],
  Sessions: ['session_id', 'session_date', 'status', 'revision', 'created_at', 'updated_at', 'finalized_at'],
  SessionPlayers: ['session_id', 'player_id', 'group_number', 'starting_rating', 'promotion_from_group'],
  Matches: ['match_id', 'session_id', 'group_number', 'player_one_id', 'player_two_id', 'player_one_games', 'player_two_games', 'forfeit', 'updated_at'],
  RatingLedger: ['event_id', 'session_id', 'player_id', 'rating_before', 'adjustment', 'rating_after', 'rule_version', 'created_at']
};

function parseTable(table, rows) {
  const headers = HEADERS[table];
  if (!rows.length || rows[0].join('|') !== headers.join('|')) {
    throw new Error('Unexpected ' + table + ' header; publication stopped');
  }
  return rows.slice(1).filter(function (row) { return row.some(function (value) { return value !== ''; }); }).map(function (row) {
    return Object.fromEntries(headers.map(function (header, index) { return [header, row[index] === undefined ? '' : row[index]]; }));
  });
}

async function readDatabase(spreadsheetId, email, privateKey, reader) {
  const fetchRows = reader || fetchSheetRows;
  const tables = {};
  for (const table of Object.keys(HEADERS)) {
    tables[table] = parseTable(table, await fetchRows(spreadsheetId, table + '!A:Z', email, privateKey));
  }
  return tables;
}

async function loadPublished(dataDir) {
  const files = (await fs.readdir(dataDir)).filter(function (name) {
    return /^session-details-\d{4}\.json$/.test(name);
  });
  const sessions = [];
  for (const file of files) {
    sessions.push(...JSON.parse(await fs.readFile(path.join(dataDir, file), 'utf8')));
  }
  return sessions;
}

function buildPublication(existing, tables, startDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Set a valid CTTC_LIVE_START_DATE before publishing');
  const historical = existing.filter(function (session) { return session.date < startDate; });
  const later = existing.filter(function (session) { return session.date >= startDate; });
  if (later.some(function (session) { return session.source !== 'app'; })) {
    throw new Error('An old Drive report occupies the live cutover period; reconcile it before publishing');
  }

  const finalized = tables.Sessions.filter(function (session) {
    return session.status === 'finalized' && String(session.session_date) >= startDate;
  });
  const dates = new Set();
  const live = finalized.map(function (session) {
    const id = String(session.session_id);
    const date = String(session.session_date);
    if (dates.has(date)) throw new Error('More than one finalized session for ' + date);
    dates.add(date);
    return projectFinalizedSession(
      session,
      tables.SessionPlayers.filter(function (row) { return String(row.session_id) === id; }),
      tables.Matches.filter(function (row) { return String(row.session_id) === id; }),
      tables.RatingLedger.filter(function (row) { return String(row.session_id) === id; }),
      tables.Players
    );
  });
  const publishedByDate = new Map(live.map(function (session) { return [session.date, session]; }));
  later.forEach(function (session) {
    const replacement = publishedByDate.get(session.date);
    if (!replacement || JSON.stringify(session) !== JSON.stringify(replacement)) {
      throw new Error('Previously published session missing or changed: ' + session.date);
    }
  });
  const details = historical.concat(live).sort(function (left, right) { return right.date.localeCompare(left.date); });
  return { details, live };
}

async function publish(tables, dataDir, startDate) {
  const existing = await loadPublished(dataDir);
  const publication = buildPublication(existing, tables, startDate);
  const years = new Map();
  publication.details.forEach(function (session) {
    const year = session.date.slice(0, 4);
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(session);
  });
  const generatedAt = new Date().toISOString().slice(0, 10);
  const latestSessionDate = publication.details[0] ? publication.details[0].date : null;
  for (const [year, sessions] of years) {
    await fs.writeFile(path.join(dataDir, 'session-details-' + year + '.json'), JSON.stringify(sessions, null, 2) + '\n');
  }
  await fs.writeFile(path.join(dataDir, 'sessions.json'), JSON.stringify(publication.details.map(function (session) {
    return session.source === 'app'
      ? { date: session.date, sessionId: session.sessionId, source: 'app' }
      : { date: session.date, fileId: session.fileId };
  }), null, 2) + '\n');
  await fs.writeFile(path.join(dataDir, 'players.json'), JSON.stringify({
    generatedAt,
    latestSessionDate,
    players: buildPlayers(publication.details)
  }, null, 2) + '\n');
  await fs.writeFile(path.join(dataDir, 'site-status.json'), JSON.stringify({ generatedAt, latestSessionDate }, null, 2) + '\n');
  return publication;
}

async function main() {
  const spreadsheetId = process.env.GOOGLE_ROUND_ROBIN_DATABASE_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  const startDate = process.env.CTTC_LIVE_START_DATE;
  if (!spreadsheetId || !email || !privateKey || !startDate) {
    throw new Error('Live publication requires database ID, service account credentials, and CTTC_LIVE_START_DATE');
  }
  const tables = await readDatabase(spreadsheetId, email, privateKey);
  const publication = await publish(tables, DATA_DIR, startDate);
  console.log('Verified ' + publication.live.length + ' finalized live session(s). Latest: ' +
    (publication.details[0] ? publication.details[0].date : 'none'));
}

if (require.main === module) {
  main().catch(function (error) { console.error(error.stack || error.message); process.exitCode = 1; });
}

module.exports = { HEADERS, parseTable, readDatabase, loadPublished, buildPublication, publish };