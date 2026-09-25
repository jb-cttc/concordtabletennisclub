var RATINGS_SYNCED_THROUGH_KEY = 'CTTC_RATINGS_SYNCED_THROUGH';
var RATINGS_CHECKED_AT_KEY = 'CTTC_RATINGS_CHECKED_AT';
var PUBLIC_PLAYERS_URL = 'https://concordtabletennisclub.com/data/players.json';
var RATING_SYNC_HANDLER = 'syncRatingsFromPublicSite';

function ratingsSyncedThrough_() {
  return PropertiesService.getScriptProperties().getProperty(RATINGS_SYNCED_THROUGH_KEY) || '';
}

function ratingsCheckedAt_() {
  return PropertiesService.getScriptProperties().getProperty(RATINGS_CHECKED_AT_KEY) || '';
}

// Called by the hourly trigger and on desk load.
function syncRatingsFromPublicSite() {
  var response = UrlFetchApp.fetch(PUBLIC_PLAYERS_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('Club site returned HTTP ' + response.getResponseCode());
  var result = applyPublicRatings_(JSON.parse(response.getContentText()));
  result.checkedAt = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty(RATINGS_CHECKED_AT_KEY, result.checkedAt);
  return result;
}

function enableRatingSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === RATING_SYNC_HANDLER) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger(RATING_SYNC_HANDLER).timeBased().everyHours(1).create();
  appendAudit_('rating_sync_trigger_enabled', 'database', RATING_SYNC_HANDLER, { everyHours: 1 });
  return ratingSyncStatus();
}

function ratingSyncStatus() {
  var triggers = ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getHandlerFunction() === RATING_SYNC_HANDLER; });
  return {
    triggers: triggers.map(function (trigger) { return { handler: trigger.getHandlerFunction(), type: String(trigger.getEventType()) }; }),
    syncedThrough: ratingsSyncedThrough_(),
    checkedAt: ratingsCheckedAt_()
  };
}

function latestFinalizedSessionDate_() {
  return rows_('Sessions').filter(function (session) { return String(session.status) === 'finalized'; })
    .map(function (session) { return displayDate_(session.session_date); }).sort().pop() || '';
}

function applyPublicRatings_(data) {
  var latest = String(data && data.latestSessionDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latest) || !Array.isArray(data.players)) throw new Error('Unexpected public ratings format');
  var published = {};
  data.players.forEach(function (player) {
    var key = normalizeName_(player.name).toLowerCase();
    if (!key || published[key] !== undefined) throw new Error('Duplicate or blank public player: ' + player.name);
    if (!Number.isInteger(player.currentRating) || player.currentRating < 0 || player.currentRating > 4000) throw new Error('Invalid public rating for ' + player.name);
    published[key] = player.currentRating;
  });
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Once the app finalizes sessions the site hasn't posted, the app is the rating authority.
    var appLatest = latestFinalizedSessionDate_();
    if (appLatest && appLatest >= latest) return { skipped: true, syncedThrough: ratingsSyncedThrough_(), appFinalizedThrough: appLatest };
    // The site may still use an older spelling recorded in Aliases.
    var aliasRatings = {};
    var aliases = playerAliases_();
    Object.keys(aliases).forEach(function (alias) {
      if (published[alias] !== undefined) aliasRatings[aliases[alias]] = published[alias];
    });
    var now = new Date();
    var changes = {};
    var unmatched = 0;
    rows_('Players').forEach(function (player) {
      if (!asBoolean_(player.active)) return;
      var playerId = String(player.player_id);
      var rating = published[normalizeName_(player.display_name).toLowerCase()];
      if (rating === undefined) rating = aliasRatings[playerId];
      if (rating === undefined) { unmatched += 1; return; }
      if (Number(player.current_rating) === rating) return;
      updateRow_('Players', player.__row, { current_rating: rating, updated_at: now });
      changes[playerId] = rating;
    });
    var updated = Object.keys(changes).length;
    PropertiesService.getScriptProperties().setProperty(RATINGS_SYNCED_THROUGH_KEY, latest);
    if (updated) appendAudit_('ratings_synced', 'database', 'Players', { through: latest, updated: updated });
    return { skipped: false, syncedThrough: latest, updated: updated, unmatched: unmatched, changes: changes };
  } finally {
    lock.releaseLock();
  }
}
