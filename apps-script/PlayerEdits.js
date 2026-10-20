// Corrections to a player's directory record from the desk (the pencil in the player directory): name, rating and
// email address. Email addresses live only in the private PlayerEmails sheet, which the club site publisher never
// reads. A corrected name is recorded in NameChanges; the publisher reads it to carry the correction into results the
// site already shows, so a name may never be reused by a different player once any player has had it.
var PLAYER_EMAIL_HEADERS = ['player_id', 'email', 'updated_at'];
var NAME_CHANGE_HEADERS = ['player_id', 'old_name', 'new_name', 'changed_at'];

function ensurePlayerEditTable_(name, headers) {
  var spreadsheet = SpreadsheetApp.getActive();
  TABLES[name] = headers;
  var sheet = spreadsheet.getSheetByName(name);
  var created = !sheet;
  if (created) sheet = spreadsheet.insertSheet(name);
  ensureHeader_(sheet, headers);
  if (created) formatTable_(sheet, headers.length);
}

// Read without creating the sheet, so adding a player never adds a tab.
function nameChangeRows_() {
  if (!SpreadsheetApp.getActive().getSheetByName('NameChanges')) return [];
  TABLES.NameChanges = NAME_CHANGE_HEADERS;
  return rows_('NameChanges');
}

// The player who had this name before a correction, if it was not playerId. Such a name stays theirs.
function previousNameOwner_(name, playerId, changes) {
  var key = normalizeName_(name).toLowerCase();
  var row = (changes || nameChangeRows_()).find(function (change) {
    return String(change.player_id) !== String(playerId || '') &&
      (normalizeName_(change.old_name).toLowerCase() === key || normalizeName_(change.new_name).toLowerCase() === key);
  });
  return row ? String(row.player_id) : '';
}

function playerEmail_(playerId) {
  ensurePlayerEditTable_('PlayerEmails', PLAYER_EMAIL_HEADERS);
  var row = rows_('PlayerEmails').find(function (entry) { return String(entry.player_id) === String(playerId); });
  return row ? String(row.email || '') : '';
}

function playerDetails_(player, email) {
  return {
    playerId: String(player.player_id),
    name: String(player.display_name),
    currentRating: Number(player.current_rating) || 0,
    email: email,
    active: asBoolean_(player.active)
  };
}

// What the edit window starts from. The email address is fetched only here, never with the directory.
function getPlayerDetails(playerId) {
  var player = findRow_('Players', 'player_id', String(playerId || ''));
  if (!player) throw new Error('Unknown player');
  return playerDetails_(player, playerEmail_(player.player_id));
}

// changes: { name, rating, email }, every field as the window shows it. before: what the window loaded, so a change
// made on another device in between is not overwritten unseen.
function updatePlayer(playerId, changes, before) {
  playerId = String(playerId || '');
  changes = changes || {};
  before = before || {};
  var name = normalizeName_(changes.name);
  var rating = Number(changes.rating);
  var email = String(changes.email == null ? '' : changes.email).trim();
  if (!name || name.length > 80) throw new Error('Player name must be 1 through 80 characters.');
  if (changes.rating === '' || changes.rating == null || !Number.isInteger(rating) || rating < 0 || rating > 4000) throw new Error('Rating must be a whole number from 0 through 4000.');
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Enter a valid email address, or leave it blank.');
  return withDeskLock_(function () {
    var players = rows_('Players');
    var player = players.find(function (row) { return String(row.player_id) === playerId; });
    if (!player) throw new Error('Unknown player');
    ensurePlayerEditTable_('PlayerEmails', PLAYER_EMAIL_HEADERS);
    ensurePlayerEditTable_('NameChanges', NAME_CHANGE_HEADERS);
    var emailRows = rows_('PlayerEmails').filter(function (row) { return String(row.player_id) === playerId; });
    if (emailRows.length > 1) throw new Error('Duplicate email rows for ' + playerId);
    var oldName = String(player.display_name);
    var oldRating = Number(player.current_rating) || 0;
    var oldEmail = emailRows.length ? String(emailRows[0].email || '') : '';
    if ((before.name !== undefined && normalizeName_(before.name) !== normalizeName_(oldName)) ||
        (before.rating !== undefined && Number(before.rating) !== oldRating) ||
        (before.email !== undefined && String(before.email) !== oldEmail)) {
      throw new Error(oldName + ' was changed on another device after this window opened. Close it, then open the pencil again to see the current details.');
    }
    var renamed = name !== normalizeName_(oldName);
    if (renamed) {
      var taken = players.some(function (row) {
        return String(row.player_id) !== playerId && normalizeName_(row.display_name).toLowerCase() === name.toLowerCase();
      });
      if (taken) throw new Error(name + ' already exists in the directory.');
      if (previousNameOwner_(name, playerId, rows_('NameChanges'))) throw new Error(name + ' was another player\'s name before a correction, so it cannot be used again.');
    }
    var now = new Date();
    var playerChanges = {};
    if (renamed) playerChanges.display_name = name;
    if (rating !== oldRating) playerChanges.current_rating = rating;
    var emailChanged = email !== oldEmail;
    if (!renamed && rating === oldRating && !emailChanged) return playerDetails_(player, oldEmail);
    if (renamed || rating !== oldRating) {
      playerChanges.updated_at = now;
      updateRow_('Players', player.__row, playerChanges);
    }
    if (renamed) {
      appendObjects_('NameChanges', [{ player_id: playerId, old_name: oldName, new_name: name, changed_at: now }]);
      renameNameLinks_(oldName, name, players, playerId);
    }
    if (emailChanged) {
      if (emailRows.length) updateRow_('PlayerEmails', emailRows[0].__row, { email: email, updated_at: now });
      else appendObjects_('PlayerEmails', [{ player_id: playerId, email: email, updated_at: now }]);
    }
    // Text, not numbers, so the public desk log (DeskLog.js) shows only which fields changed.
    var details = { nameChanged: renamed, ratingChanged: rating !== oldRating, emailChanged: emailChanged };
    if (renamed) { details.name_from = oldName; details.name_to = name; }
    if (rating !== oldRating) { details.rating_from = String(oldRating); details.rating_to = String(rating); }
    appendAudit_('player_updated', 'player', playerId, details);
    return playerDetails_(Object.assign({}, player, playerChanges), email);
  });
}

// NameLinks rows name players by name, so a corrected name is corrected there too. A name another player shares
// (ignoring punctuation) never resolved to one player, so those rows are left alone.
function renameNameLinks_(oldName, newName, players, playerId) {
  var oldKey = linkedNameKey_(oldName);
  var shared = players.some(function (row) { return String(row.player_id) !== playerId && linkedNameKey_(row.display_name) === oldKey; });
  if (shared) return;
  nameLinkRows_();
  rows_('NameLinks').forEach(function (row) {
    var update = {};
    if (linkedNameKey_(row.name) === oldKey) update.name = newName;
    if (String(row.linked_name || '').trim() && linkedNameKey_(row.linked_name) === oldKey) update.linked_name = newName;
    if (Object.keys(update).length) {
      update.updated_at = new Date();
      updateRow_('NameLinks', row.__row, update);
    }
  });
}
