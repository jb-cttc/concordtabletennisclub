'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { fetchSheetRows } = require('./lib/google-sheets');
const { projectFinalizedSession } = require('./lib/finalized-session');
const { projectFinalizedEqualizer } = require('./lib/finalized-equalizer');
const { buildPlayers } = require('./fetch-and-parse');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const HEADERS = {
  Players: ['player_id', 'display_name', 'current_rating', 'active', 'created_at', 'updated_at'],
  Sessions: ['session_id', 'session_date', 'status', 'revision', 'created_at', 'updated_at', 'finalized_at'],
  SessionPlayers: ['session_id', 'player_id', 'group_number', 'starting_rating', 'promotion_from_group'],
  Matches: ['match_id', 'session_id', 'group_number', 'player_one_id', 'player_two_id', 'player_one_games', 'player_two_games', 'forfeit', 'updated_at', 'forfeited_by', 'won_by'],
  RatingLedger: ['event_id', 'session_id', 'player_id', 'rating_before', 'adjustment', 'rating_after', 'rule_version', 'created_at']
};

// Sheets created before these trailing columns existed are still accepted.
const ADDED_COLUMNS = { Matches: ['forfeited_by', 'won_by'] };
// Name corrections made at the desk (apps-script/PlayerEdits.js), and the Equalizer's draw and results
// (apps-script/EqualizerService.js). Each tab is made by the first change that needs it.
const OPTIONAL_HEADERS = {
  NameChanges: ['player_id', 'old_name', 'new_name', 'changed_at'],
  Brackets: ['session_id', 'rule_version', 'format', 'play', 'best_of', 'odd_player', 'sit_out_id', 'draw_json', 'drawn_at', 'updated_at'],
  BracketMatches: ['match_id', 'session_id', 'stage', 'side_one_id', 'side_two_id', 'head_start_side_id', 'head_start_points', 'best_of', 'side_one_games', 'side_two_games', 'won_by', 'forfeited_by', 'table_number', 'called_at', 'finished_at', 'updated_at']
};
const isEqualizer = function (session) { return /-equalizer$/.test(String(session.session_id || session.sessionId || '')); };

function parseTable(table, rows) {
  const headers = HEADERS[table] || OPTIONAL_HEADERS[table];
  const accepted = [headers.join('|')];
  (ADDED_COLUMNS[table] || []).forEach(function (_name, index) { accepted.push(headers.slice(0, headers.length - 1 - index).join('|')); });
  const actual = rows.length ? rows[0].join('|') : '';
  if (accepted.indexOf(actual) < 0) {
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
  for (const table of Object.keys(OPTIONAL_HEADERS)) {
    let rows;
    try {
      rows = await fetchRows(spreadsheetId, table + '!A:Z', email, privateKey);
    } catch (error) {
      // The Sheets API cannot parse a range on a tab that does not exist yet.
      if (!/Unable to parse range/.test(error.message)) throw error;
      rows = [];
    }
    tables[table] = rows.length ? parseTable(table, rows) : [];
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

// Each name a player had before a desk correction, mapped to the name they have now. The desk never gives a corrected
// name to anyone else; a name that some player has now is left as it is, so a published session that still shows it
// stops publication instead of being changed.
function correctedNames(nameChanges, players) {
  const current = new Map(players.map(function (player) { return [String(player.player_id), String(player.display_name)]; }));
  const inUse = new Set(current.values());
  const corrected = new Map();
  (nameChanges || []).forEach(function (change) {
    const name = current.get(String(change.player_id));
    const old = String(change.old_name);
    if (name !== undefined && old && old !== name && !inUse.has(old)) corrected.set(old, name);
  });
  return corrected;
}

function withCorrectedNames(session, corrected) {
  if (!corrected.size) return session;
  const fix = function (name) { return corrected.has(name) ? corrected.get(name) : name; };
  return {
    ...session,
    groups: session.groups.map(function (group) {
      return {
        ...group,
        players: group.players.map(function (player) {
          const fixed = { ...player, name: fix(player.name) };
          if (Array.isArray(player.matches)) {
            fixed.matches = player.matches.map(function (match) {
              const named = { ...match, opponent: Array.isArray(match.opponents) ? match.opponents.map(fix).join(' & ') : fix(match.opponent) };
              if (Array.isArray(match.opponents)) named.opponents = match.opponents.map(fix);
              if (Array.isArray(match.partners)) named.partners = match.partners.map(fix);
              if (match.forfeitedBy !== undefined && match.forfeitedBy !== 'both') named.forfeitedBy = fix(match.forfeitedBy);
              return named;
            });
          }
          return fixed;
        })
      };
    }),
    ...(session.equalizer ? { equalizer: fixEqualizerNames(session.equalizer, fix) } : {})
  };
}

function fixEqualizerNames(block, fix) {
  const all = function (names) { return names.map(fix); };
  return {
    ...block,
    sides: block.sides.map(function (side) { return { ...side, names: all(side.names) }; }),
    sitOut: all(block.sitOut),
    champion: all(block.champion),
    matches: block.matches.map(function (match) { return { ...match, sides: match.sides.map(all) }; })
  };
}

function buildPublication(existing, tables, startDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Set a valid CTTC_LIVE_START_DATE before publishing');
  // A name corrected at the desk is corrected in every session the site already shows, so a player's history stays
  // under one name.
  const corrected = correctedNames(tables.NameChanges, tables.Players);
  existing = existing.map(function (session) { return withCorrectedNames(session, corrected); });
  const historical = existing.filter(function (session) { return session.date < startDate; });
  const later = existing.filter(function (session) { return session.date >= startDate; });
  if (later.some(function (session) { return session.source !== 'app'; })) {
    throw new Error('An old Drive report occupies the live cutover period; reconcile it before publishing');
  }

  const finalized = tables.Sessions.filter(function (session) {
    return session.status === 'finalized' && String(session.session_date) >= startDate;
  });
  const dates = new Set();
  const live = finalized.filter(function (session) { return !isEqualizer(session); }).map(function (session) {
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
  // Equalizers are published in their own step: one that cannot be checked is left out (and reported), never stopping
  // the round robins. An Equalizer already on the site stays as published.
  const skipped = [];
  const previousEqualizers = new Map(later.filter(isEqualizer).map(function (session) { return [session.sessionId, session]; }));
  finalized.filter(isEqualizer).forEach(function (session) {
    const id = String(session.session_id);
    try {
      live.push(projectFinalizedEqualizer(
        session,
        (tables.Brackets || []).find(function (row) { return String(row.session_id) === id; }),
        (tables.BracketMatches || []).filter(function (row) { return String(row.session_id) === id; }),
        tables.RatingLedger.filter(function (row) { return String(row.session_id) === id; }),
        tables.Players
      ));
    } catch (error) {
      skipped.push({ sessionId: id, date: String(session.session_date), reason: error.message });
      if (previousEqualizers.has(id)) live.push(previousEqualizers.get(id));
    }
  });
  const publishedById = new Map(live.map(function (session) { return [session.sessionId, session]; }));
  later.forEach(function (session) {
    const replacement = publishedById.get(session.sessionId);
    if (!replacement || JSON.stringify(session) !== JSON.stringify(replacement)) {
      if (isEqualizer(session) && skipped.some(function (entry) { return entry.sessionId === session.sessionId; })) return;
      throw new Error('Previously published session missing or changed: ' + session.date);
    }
  });
  // Newest first; on a shared date the round robin comes before the Equalizer (it was finalized first), so a lookup by
  // date finds the round robin and the rating history runs in order.
  const details = historical.concat(live).sort(function (left, right) {
    return right.date.localeCompare(left.date) || (isEqualizer(left) ? 1 : 0) - (isEqualizer(right) ? 1 : 0);
  });
  return { details, live, skipped };
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
    if (session.source !== 'app') return { date: session.date, fileId: session.fileId };
    return session.variant === 'equalizer'
      ? { date: session.date, sessionId: session.sessionId, source: 'app', variant: 'equalizer' }
      : { date: session.date, sessionId: session.sessionId, source: 'app' };
  }), null, 2) + '\n');
  await fs.writeFile(path.join(dataDir, 'players.json'), JSON.stringify({
    generatedAt,
    latestSessionDate,
    players: buildPlayers(publication.details)
  }, null, 2) + '\n');
  // The newest round robin, for the results email and the home page (Equalizer results have their own pages).
  const latestRoundRobin = publication.details.find(function (session) { return session.variant !== 'equalizer'; });
  const status = { generatedAt, latestSessionDate, latestRoundRobinDate: latestRoundRobin ? latestRoundRobin.date : null };
  if (publication.skipped.length) status.equalizerNotPublished = publication.skipped.map(function (entry) { return entry.date; });
  await fs.writeFile(path.join(dataDir, 'site-status.json'), JSON.stringify(status, null, 2) + '\n');
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
  // Round robins are published by now; an Equalizer that could not be checked fails the run afterwards, so the usual
  // GitHub failure email says so.
  publication.skipped.forEach(function (entry) {
    console.error('Equalizer ' + entry.date + ' was not published: ' + entry.reason);
  });
  if (publication.skipped.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(function (error) { console.error(error.stack || error.message); process.exitCode = 1; });
}

module.exports = { HEADERS, parseTable, readDatabase, loadPublished, buildPublication, publish };