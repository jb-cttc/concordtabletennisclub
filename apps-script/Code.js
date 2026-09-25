// App source and change requests: https://github.com/jb-cttc/concordtabletennisclub
// Propose changes there for review; a GitHub merge does not deploy this Google app.
var DATABASE_VERSION = '1';

var TABLES = {
  Players: ['player_id', 'display_name', 'current_rating', 'active', 'created_at', 'updated_at'],
  Aliases: ['alias', 'player_id', 'created_at'],
  Sessions: ['session_id', 'session_date', 'status', 'revision', 'created_at', 'updated_at', 'finalized_at'],
  SessionPlayers: ['session_id', 'player_id', 'group_number', 'starting_rating', 'promotion_from_group'],
  Matches: ['match_id', 'session_id', 'group_number', 'player_one_id', 'player_two_id', 'player_one_games', 'player_two_games', 'forfeit', 'updated_at'],
  RecordArchive: ['player_id', 'record_year', 'club_wins', 'club_losses', 'year_wins', 'year_losses', 'through_date', 'source'],
  RecordArchiveEvents: ['event_date', 'player_id', 'wins', 'losses', 'source'],
  RatingLedger: ['event_id', 'session_id', 'player_id', 'rating_before', 'adjustment', 'rating_after', 'rule_version', 'created_at'],
  AuditLog: ['event_id', 'event_time', 'actor', 'action', 'entity_type', 'entity_id', 'details_json']
};

function onOpen() {
  SpreadsheetApp.getUi()
  .createMenu('CTTC Database')
  .addItem('Initialize / verify database', 'setupDatabase')
  .addItem('Show database status', 'showDatabaseStatus')
  .addItem('Request an app change', 'showChangeGuide')
  .addToUi();
}

function showChangeGuide() {
  var html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.5 Arial,sans-serif;padding:16px;color:#17211b">' +
    '<h2 style="margin:0 0 10px">Request a change</h2>' +
    '<p>The club keeps its app and website code on GitHub so changes can be reviewed, tested, and recovered. You do not need to edit code.</p>' +
    '<p>Open <a href="https://github.com/jb-cttc/concordtabletennisclub/issues/new" target="_blank" rel="noopener">New issue in the CTTC repository</a>, sign in to GitHub, and describe what you want or what went wrong in everyday language. A maintainer will handle review and deployment to Google.</p>' +
    '<p>Please do not include private member, contact, or payment details in a public issue.</p>' +
    '<p>Changes here are not live just because they were merged on GitHub; a maintainer tests and deploys the Google app separately.</p>' +
    '</div>'
  ).setWidth(460).setHeight(350);
  SpreadsheetApp.getUi().showModalDialog(html, 'CTTC app changes');
}

function setupDatabase() {
  var spreadsheet = SpreadsheetApp.getActive();
  var names = Object.keys(TABLES);
  names.forEach(function (name, index) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      var firstSheet = spreadsheet.getSheets()[0];
      if (index === 0 && spreadsheet.getSheets().length === 1 && firstSheet.getName() === 'Sheet1' && firstSheet.getLastRow() === 0) {
        sheet = firstSheet.setName(name);
      } else {
        sheet = spreadsheet.insertSheet(name);
      }
    }
    ensureHeader_(sheet, TABLES[name]);
    formatTable_(sheet, TABLES[name].length);
  });
  PropertiesService.getDocumentProperties().setProperty('CTTC_DATABASE_VERSION', DATABASE_VERSION);
  appendAudit_('database_initialized', 'database', spreadsheet.getId(), { version: DATABASE_VERSION });
  return databaseStatus();
}

function ensureHeader_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }
  var existing = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (existing.join('|') !== headers.join('|')) {
    throw new Error('Unexpected header structure in ' + sheet.getName() + '. No changes were made to that sheet.');
  }
}

function formatTable_(sheet, columnCount) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, columnCount)
  .setBackground('#1f4e78')
  .setFontColor('#ffffff')
  .setFontWeight('bold')
  .setWrap(true);
  sheet.autoResizeColumns(1, columnCount);
  for (var column = 1; column <= columnCount; column += 1) {
    sheet.setColumnWidth(column, Math.max(110, Math.min(220, sheet.getColumnWidth(column))));
  }
}

function databaseStatus() {
  var spreadsheet = SpreadsheetApp.getActive();
  var tables = {};
  Object.keys(TABLES).forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name);
    tables[name] = sheet ? Math.max(0, sheet.getLastRow() - 1) : null;
  });
  return {
    spreadsheetId: spreadsheet.getId(),
    version: PropertiesService.getDocumentProperties().getProperty('CTTC_DATABASE_VERSION'),
    tables: tables
  };
}

function showDatabaseStatus() {
  SpreadsheetApp.getUi().alert(JSON.stringify(databaseStatus(), null, 2));
}

function appendAudit_(action, entityType, entityId, details) {
  var sheet = SpreadsheetApp.getActive().getSheetByName('AuditLog');
  if (!sheet) return;
  sheet.appendRow([
    Utilities.getUuid(),
    new Date(),
    Session.getActiveUser().getEmail() || 'club-account',
    action,
    entityType,
    entityId,
    JSON.stringify(details || {})
  ]);
}

function doGet(event) {
  var template = HtmlService.createTemplateFromFile('Index');
  var requestedDate = event && event.parameter && event.parameter.date;
  template.initialDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate || '') ? requestedDate : '';
  return template.evaluate()
  .setTitle('CTTC Round Robin Manager')
  .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
