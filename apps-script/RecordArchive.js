var ACCESS_RECORD_HEADERS = ['Club Wins - Matches', 'Club Losses - Matches', 'League Wins - Matches', 'League Losses - Matches'];
var ACCESS_RECORD_SNAPSHOT_HASH = 'b8096e75e3f9c5ff868a34b4ebba4b3ecb833e615d50f444b266a91063e854bb';
var ACCESS_RECORD_THROUGH_HASH = '0bdf29fd9df14df6d6d0a048120ae49c56930540e0704874838b96b338069579';
var RECORD_ARCHIVE_HEADERS = ['player_id', 'record_year', 'club_wins', 'club_losses', 'year_wins', 'year_losses', 'through_date', 'source'];
var RECORD_ARCHIVE_EVENT_HEADERS = ['event_date', 'player_id', 'wins', 'losses', 'source'];
var RECORD_ARCHIVE_THROUGH = '2026-09-21';
var ACCESS_RECORD_COUNT = 1642;

function accessRecordRows_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName('AccessPlayers');
  if (!sheet) throw new Error('AccessPlayers archive is missing.');
  if (sheet.getRange('A1').getValue() !== 'Player ID' || sheet.getRange('Q1:T1').getValues()[0].join('|') !== ACCESS_RECORD_HEADERS.join('|')) {
    throw new Error('AccessPlayers record columns do not match the Access export.');
  }
  var count = sheet.getLastRow() - 1;
  var ids = sheet.getRange(2, 1, count, 1).getValues();
  var counters = sheet.getRange(2, 17, count, 4).getValues();
  var seen = {};
  return ids.map(function (idRow, index) {
    var id = Number(idRow[0]);
    if (!Number.isSafeInteger(id) || id <= 0 || seen[id]) throw new Error('Invalid or duplicate Access Player ID at row ' + (index + 2));
    seen[id] = true;
    var values = counters[index].map(function (value) {
      var number = Number(value);
      if (value === '' || !Number.isSafeInteger(number) || number < 0) throw new Error('Invalid record counter at row ' + (index + 2));
      return number;
    });
    return [id].concat(values);
  }).sort(function (left, right) { return left[0] - right[0]; });
}

function recordFingerprint_(rows) {
  var source = rows.map(function (row) { return row.join(':'); }).join('\n');
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, source, Utilities.Charset.UTF_8)
  .map(function (value) { return ('0' + (value & 255).toString(16)).slice(-2); }).join('');
}

function inspectAccessRecordCounters() {
  var rows = accessRecordRows_();
  return {
    rows: rows.length,
    counterHash: recordFingerprint_(rows),
    totals: [1, 2, 3, 4].map(function (column) {
      return rows.reduce(function (total, row) { return total + row[column]; }, 0);
    })
  };
}

function seedRecordArchive2026(delta) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var spreadsheet = SpreadsheetApp.getActive();
    if (spreadsheet.getSheetByName('RecordArchive') || spreadsheet.getSheetByName('RecordArchiveEvents')) {
      throw new Error('Record archive already exists; refusing to overwrite historical records.');
    }
    var rows = accessRecordRows_();
    if (recordFingerprint_(rows) !== ACCESS_RECORD_SNAPSHOT_HASH) throw new Error('AccessPlayers counters changed since reconciliation; import must be checked again.');
    var baseline = rows.map(function (row) { return row.slice(); });
    var byId = {};
    rows.forEach(function (row) { byId[row[0]] = row; });
    var seen = {};
    var wins = 0;
    var losses = 0;
    if (!Array.isArray(delta) || delta.length !== 27) throw new Error('Expected the 27-player September 23 Access match delta.');
    delta.forEach(function (entry) {
      var id = entry[0];
      var won = entry[1];
      var lost = entry[2];
      if (!byId[id] || seen[id] || !Number.isSafeInteger(won) || !Number.isSafeInteger(lost) || won < 0 || lost < 0 || won + lost === 0) {
        throw new Error('Invalid September 23 record delta.');
      }
      seen[id] = true;
      wins += won;
      losses += lost;
      byId[id][1] += won;
      byId[id][2] += lost;
      byId[id][3] += won;
      byId[id][4] += lost;
    });
    if (wins !== 58 || losses !== 58 || recordFingerprint_(rows) !== ACCESS_RECORD_THROUGH_HASH) {
      throw new Error('September 23 delta does not match the authoritative Access counters.');
    }
    var sheet = spreadsheet.insertSheet('RecordArchive');
    var values = [RECORD_ARCHIVE_HEADERS].concat(baseline.map(function (row) {
      return ['access-' + row[0], 2026, row[1], row[2], row[3], row[4], RECORD_ARCHIVE_THROUGH, 'Access Player'];
    }));
    sheet.getRange(1, 1, values.length, RECORD_ARCHIVE_HEADERS.length).setValues(values);
    sheet.setFrozenRows(1);
    var events = spreadsheet.insertSheet('RecordArchiveEvents');
    var eventValues = [RECORD_ARCHIVE_EVENT_HEADERS].concat(delta.map(function (entry) {
      return ['2026-09-23', 'access-' + entry[0], entry[1], entry[2], 'Access Match'];
    }));
    events.getRange(1, 1, eventValues.length, RECORD_ARCHIVE_EVENT_HEADERS.length).setValues(eventValues);
    events.setFrozenRows(1);
    return { rows: baseline.length, events: delta.length, throughDate: '2026-09-23', counterHash: ACCESS_RECORD_THROUGH_HASH };
  } finally {
    lock.releaseLock();
  }
}

function archivedRecords_() {
  var spreadsheet = SpreadsheetApp.getActive();
  var baselineSheet = spreadsheet.getSheetByName('RecordArchive');
  var eventSheet = spreadsheet.getSheetByName('RecordArchiveEvents');
  if (!baselineSheet || !eventSheet) throw new Error('Record archive is not seeded.');
  if (baselineSheet.getRange(1, 1, 1, RECORD_ARCHIVE_HEADERS.length).getValues()[0].join('|') !== RECORD_ARCHIVE_HEADERS.join('|') ||
      eventSheet.getRange(1, 1, 1, RECORD_ARCHIVE_EVENT_HEADERS.length).getValues()[0].join('|') !== RECORD_ARCHIVE_EVENT_HEADERS.join('|')) {
    throw new Error('Record archive headers changed.');
  }
  var baseline = rows_('RecordArchive');
  var events = rows_('RecordArchiveEvents');
  if (baseline.length < ACCESS_RECORD_COUNT || events.length !== 27) throw new Error('Record archive is incomplete.');
  var byId = {};
  var numeric = [];
  baseline.forEach(function (row) {
    var match = /^access-(\d+)$/.exec(String(row.player_id));
    if (Number(row.record_year) !== 2026 || displayDate_(row.through_date) !== RECORD_ARCHIVE_THROUGH || byId[row.player_id] ||
        (!match && !String(row.source).startsWith('Verified: '))) {
      throw new Error('Record archive has an invalid player baseline.');
    }
    var values = [row.club_wins, row.club_losses, row.year_wins, row.year_losses].map(Number);
    if (values.some(function (value) { return !Number.isSafeInteger(value) || value < 0; })) throw new Error('Record archive has invalid counters.');
    byId[row.player_id] = values;
    if (match) numeric.push([Number(match[1])].concat(values));
  });
  numeric.sort(function (left, right) { return left[0] - right[0]; });
  if (numeric.length !== ACCESS_RECORD_COUNT || recordFingerprint_(numeric) !== ACCESS_RECORD_SNAPSHOT_HASH) {
    throw new Error('Record archive baseline differs from Access.');
  }
  var seen = {};
  var wins = 0;
  var losses = 0;
  events.forEach(function (event) {
    var id = String(event.player_id);
    var won = Number(event.wins);
    var lost = Number(event.losses);
    if (displayDate_(event.event_date) !== '2026-09-23' || !byId[id] || seen[id] || !Number.isSafeInteger(won) || !Number.isSafeInteger(lost) || won < 0 || lost < 0) {
      throw new Error('Record archive has an invalid Access match event.');
    }
    seen[id] = true;
    wins += won;
    losses += lost;
    var row = numeric.find(function (entry) { return 'access-' + entry[0] === id; });
    row[1] += won;
    row[2] += lost;
    row[3] += won;
    row[4] += lost;
  });
  if (wins !== 58 || losses !== 58 || recordFingerprint_(numeric) !== ACCESS_RECORD_THROUGH_HASH) {
    throw new Error('Record archive does not reconcile with Access through September 23.');
  }
  return { baseline: byId, events: events };
}

function getPlayerRecordsForPrint(playerIds, sessionDate) {
  validateSessionDate_(sessionDate);
  if (!Array.isArray(playerIds) || playerIds.length > 100) throw new Error('Invalid print roster.');
  var archive = archivedRecords_();
  var selectedYear = Number(sessionDate.slice(0, 4));
  var records = {};
  playerIds.forEach(function (id) {
    var baseline = archive.baseline[String(id)];
    if (!baseline || sessionDate <= RECORD_ARCHIVE_THROUGH || selectedYear < 2026) return;
    records[String(id)] = {
      clubWins: baseline[0], clubLosses: baseline[1],
      yearWins: selectedYear === 2026 ? baseline[2] : 0,
      yearLosses: selectedYear === 2026 ? baseline[3] : 0
    };
  });
  archive.events.forEach(function (event) {
    if (displayDate_(event.event_date) >= sessionDate) return;
    var record = records[String(event.player_id)];
    if (!record) return;
    record.clubWins += Number(event.wins);
    record.clubLosses += Number(event.losses);
    if (selectedYear === 2026) {
      record.yearWins += Number(event.wins);
      record.yearLosses += Number(event.losses);
    }
  });
  var sessions = {};
  rows_('Sessions').forEach(function (session) {
    var date = displayDate_(session.session_date);
    if (String(session.status) === 'finalized' && date > '2026-09-23' && date < sessionDate) sessions[String(session.session_id)] = date;
  });
  rows_('Matches').forEach(function (match) {
    var date = sessions[String(match.session_id)];
    if (!date || asBoolean_(match.forfeit)) return;
    var first = Number(match.player_one_games);
    var second = Number(match.player_two_games);
    if (match.player_one_games === '' || match.player_two_games === '' || !Number.isSafeInteger(first) || !Number.isSafeInteger(second) || first === second) {
      throw new Error('A finalized match has no valid winner.');
    }
    var winner = records[String(first > second ? match.player_one_id : match.player_two_id)];
    var loser = records[String(first > second ? match.player_two_id : match.player_one_id)];
    if (winner) {
      winner.clubWins += 1;
      if (date.slice(0, 4) === String(selectedYear)) winner.yearWins += 1;
    }
    if (loser) {
      loser.clubLosses += 1;
      if (date.slice(0, 4) === String(selectedYear)) loser.yearLosses += 1;
    }
  });
  return { records: records, missing: playerIds.filter(function (id) { return !records[String(id)]; }).length };
}

function recordArchiveStatus() {
  var archive = archivedRecords_();
  var missing = rows_('Players').filter(function (player) { return !archive.baseline[String(player.player_id)]; }).length;
  var syncedThrough = ratingsSyncedThrough_();
  return {
    baselinePlayers: Object.keys(archive.baseline).length,
    missingPlayers: missing,
    throughDate: '2026-09-23',
    ratingsSyncedThrough: syncedThrough,
    readyForCutover: missing === 0 && syncedThrough === '2026-09-23'
  };
}

function addVerifiedRecordBaseline(playerId, clubWins, clubLosses, yearWins, yearLosses, evidence) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var id = String(playerId);
    if (!findRow_('Players', 'player_id', id) || /^access-\d+$/.test(id) || findRow_('RecordArchive', 'player_id', id)) {
      throw new Error('Baseline requires an existing non-Access player without an archive record.');
    }
    var values = [clubWins, clubLosses, yearWins, yearLosses].map(Number);
    if (values.some(function (value) { return !Number.isSafeInteger(value) || value < 0; }) ||
        !String(evidence || '').trim() || String(evidence).length > 160) {
      throw new Error('Four verified nonnegative counters and a short source description are required.');
    }
    archivedRecords_();
    appendObjects_('RecordArchive', [{
      player_id: id, record_year: 2026,
      club_wins: values[0], club_losses: values[1], year_wins: values[2], year_losses: values[3],
      through_date: RECORD_ARCHIVE_THROUGH, source: 'Verified: ' + String(evidence).trim()
    }]);
    return recordArchiveStatus();
  } finally {
    lock.releaseLock();
  }
}