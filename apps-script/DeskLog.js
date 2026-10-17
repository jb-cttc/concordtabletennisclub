// CTTC Desk Logs: a tab in this Sheet with one row per key step (level 'step'), retried failure ('warn') or problem ('error'), for maintainers checking that a session night
// went through and finding what failed. Maintainers read it from GitHub (Actions > "Desk log"), whose run logs are public,
// so a row never holds a name, email address, phone number, payment method or member status: players appear only as a
// code, and error text has addresses, numbers, quoted text and long ids taken out. The full record stays in the private
// AuditLog tab; an error row's ref is the same Reference the desk showed, which is the start of that AuditLog row's event_id.
//
// Every AuditLog entry is copied here (appendAudit_ calls deskLogFromAudit_), so each step the desk already audits is
// logged with no extra code. What never reaches the AuditLog is caught separately: the page reports every failed server
// call and every page error (Index.html, through logDeskEvents), and background jobs and page loads report their own
// failures (guardDesk_).
var DESK_LOG_TAB = 'CTTC Desk Logs';
var DESK_LOG_HEADERS = ['at', 'level', 'what', 'session', 'ref', 'detail'];
var DESK_LOG_KEEP = 2000;
// Text values shown as they are, only for session and database entries: dates, times, versions and states. Numbers and
// true/false are always shown. Anything else (a name, a payment method, a member status, a message) is left out.
var DESK_LOG_TEXT_KEYS = ['through', 'dueAt', 'emailDueAt', 'version', 'status', 'serverStatus', 'mode', 'call', 'checkedAt'];

function deskLogFromAudit_(action, entityType, entityId, details, eventId) {
  try {
    details = details || {};
    var failed = /_failed$/.test(action) || action === 'desk_problem';
    var what = action === 'desk_problem' ? 'page: ' + String(details.kind || 'problem').slice(0, 60) : action;
    var ref = failed && eventId ? referenceCode_(eventId) : entityType === 'player' && entityId ? 'P' + deskCode_(entityId) : '';
    var parts = [];
    if (failed && details.message) parts.push(cleanDeskText_(details.message));
    Object.keys(details).forEach(function (key) {
      var value = details[key];
      if (key === 'message' || key === 'kind' || key === 'at' || key === 'browser' || key === 'id' || key === 'date' || key === 'sessionDate') return;
      if (key === 'playerId' && value) parts.push('player=P' + deskCode_(value));
      else if (typeof value === 'number' || typeof value === 'boolean') parts.push(key + '=' + value);
      else if (entityType !== 'player' && DESK_LOG_TEXT_KEYS.indexOf(key) >= 0 && value != null && value !== '') {
        // A date or time is kept as it is; any other text is cleaned.
        parts.push(key + '=' + (/^\d{4}-\d\d-\d\d([T ][\d:.]+Z?)?$/.test(String(value)) ? String(value) : cleanDeskText_(value).slice(0, 40)));
      }
    });
    // A call that failed is a warning: the desk retries it, and an action that really failed is logged as its own error.
    var level = !failed ? 'step' : action === 'desk_problem' && details.kind === 'call failed' ? 'warn' : 'error';
    deskLog_(level, what, deskSessionDate_(entityType, entityId, details), ref, parts.join(' '));
  } catch (error) {
    console.error('Could not copy an audit entry to the desk log: ' + error);
  }
}

function deskLog_(level, what, session, ref, detail) {
  try {
    var book = SpreadsheetApp.getActive();
    var sheet = book.getSheetByName(DESK_LOG_TAB);
    if (!sheet) {
      sheet = book.insertSheet(DESK_LOG_TAB);
      sheet.getRange(1, 1, 1, DESK_LOG_HEADERS.length).setValues([DESK_LOG_HEADERS]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    // appendRow adds the whole row in one step, so two writers never share a row; the leading ' keeps each value as text.
    sheet.appendRow([new Date().toISOString(), level, what, session || '', ref || '', String(detail || '').slice(0, 300)]
      .map(function (value) { return "'" + value; }));
    var extra = sheet.getLastRow() - 1 - DESK_LOG_KEEP;
    if (extra >= 100) sheet.deleteRows(2, extra);
  } catch (error) {
    console.error('Could not write to the desk log: ' + error);
  }
}

// Runs a background job or a page load and, if it fails, records it (AuditLog, and so the desk log) before failing as
// before. Nobody is looking at a page when a timer or the hourly trigger fails, so without this it would go unseen.
function guardDesk_(name, work) {
  try {
    return work();
  } catch (error) {
    safeAudit_(name + '_failed', 'database', name, { message: error && error.message || String(error) });
    throw error;
  }
}

function deskSessionDate_(entityType, entityId, details) {
  var match = /(\d{4}-\d{2}-\d{2})/.exec(String(entityType === 'session' ? entityId : '') + ' ' + String(details.sessionDate || details.date || ''));
  return match ? match[1] : '';
}

// A short code for a player id: the same player always gets the same code, and it cannot be turned back into the id.
function deskCode_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'cttc-desk:' + value).slice(0, 3)
    .map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('').toUpperCase();
}

// Error text with nothing personal left in it.
function cleanDeskText_(text) {
  return String(text).replace(/\S+@\S+/g, '<address>').replace(/\bplayer-[A-Za-z0-9_-]+/g, '<player>').replace(/\+?\d[\d\s().-]{5,}\d/g, '<number>').replace(/"[^"]*"/g, '"…"')
    .replace(/“[^”]*”/g, '"…"').replace(/[A-Za-z0-9_-]{20,}/g, '<id>').slice(0, 200);
}
