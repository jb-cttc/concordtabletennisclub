// Corrections to a player's directory record from the desk (the pencil in the player directory): name, rating, email
// address and other names (the Aliases tab, below). Email addresses live only in the private PlayerEmails sheet, which the club site publisher never
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

function playerDetails_(player, email, aliases) {
  return {
    playerId: String(player.player_id),
    name: String(player.display_name),
    currentRating: Number(player.current_rating) || 0,
    email: email,
    active: asBoolean_(player.active),
    aliases: aliases || []
  };
}

// What the edit window starts from. The email address is fetched only here, never with the directory. Each other name
// comes with how much it links today, so removing or changing one can say what would stop counting for this player.
function getPlayerDetails(playerId) {
  var player = findRow_('Players', 'player_id', String(playerId || ''));
  if (!player) throw new Error('Unknown player');
  var names = playerAliasNames_(rows_('Aliases'), player.player_id);
  return playerDetails_(player, playerEmail_(player.player_id), aliasUses_(names));
}

// ---- Other names (the Aliases tab) ----
// One row per other name a player goes by: a Google Voice contact name, a Zeffy buyer or Clover cardholder name, an
// older spelling. The desk's Voice signups and answers, Zeffy passes, Clover payments, the cash page, and the staffing
// and turnout apps read them live, so a change counts from their next read. A name belongs to one player only, and is
// never another player's directory name or a name they had before a correction. Names compare without case, spacing or
// punctuation, and "Yi, Daeseop" is "Daeseop Yi".
function aliasKey_(name) {
  var plain = normalizeName_(name);
  var comma = plain.match(/^([^,]+),\s*(.+)$/);
  return linkedNameKey_(comma ? comma[2] + ' ' + comma[1] : plain);
}

function playerAliasNames_(aliasRows, playerId) {
  return aliasRows.filter(function (row) { return String(row.player_id) === String(playerId) && normalizeName_(row.alias); })
  .map(function (row) { return normalizeName_(row.alias); });
}

// Every player's other names, for the directory search: { playerId: [name, ...] }.
function listPlayerAliases() {
  var byPlayer = {};
  rows_('Aliases').forEach(function (row) {
    var id = String(row.player_id || '');
    var name = normalizeName_(row.alias);
    if (id && name) (byPlayer[id] = byPlayer[id] || []).push(name);
  });
  return byPlayer;
}

// [{name, zeffy, texts}]: the Zeffy payments and the Voice texts (kept 90 days) recorded under each name.
function aliasUses_(names) {
  var counts = {};
  names.forEach(function (name) { counts[aliasKey_(name)] = { zeffy: 0, texts: 0 }; });
  try {
    ensurePrivatePaymentTables_();
    rows_('ZeffyPayments').forEach(function (row) {
      var keys = {};
      [row.participant_name, row.payer_name].forEach(function (name) { if (normalizeName_(name)) keys[aliasKey_(name)] = true; });
      Object.keys(keys).forEach(function (key) { if (counts[key]) counts[key].zeffy += 1; });
    });
    mailTextRows_(mailReaderSheets_().texts).forEach(function (row) {
      var sender = String(row.subject).match(/^New (?:group )?text message from (.+)$/i);
      var name = sender ? sender[1].replace(/\(?\+?[\d][\d\s().-]{6,}\d\)?$/, '').trim() : '';
      if (name && counts[aliasKey_(name)]) counts[aliasKey_(name)].texts += 1;
    });
  } catch (error) {
    console.warn('Alias use counts unavailable: ' + error);
  }
  return names.map(function (name) { return { name: name, zeffy: counts[aliasKey_(name)].zeffy, texts: counts[aliasKey_(name)].texts }; });
}

// The window sends the whole list it shows: [{from, name}], from being the name it loaded ('' for a new one). Returns
// the rows to change, add and remove, or throws when a name cannot be this player's. Called with the desk lock held.
function aliasPlan_(playerId, displayName, wanted, aliasRows, players, changes) {
  var mine = aliasRows.filter(function (row) { return String(row.player_id) === playerId && normalizeName_(row.alias); });
  var mineByName = {};
  mine.forEach(function (row) { mineByName[normalizeName_(row.alias)] = row; });
  var seen = {};
  seen[aliasKey_(displayName)] = true;
  var kept = {};
  var plan = { edits: [], adds: [], removes: [] };
  wanted.forEach(function (entry) {
    var from = normalizeName_(entry.from);
    var name = normalizeName_(entry.name);
    var key = aliasKey_(name);
    if (from && !mineByName[from]) throw new Error(from + ' is no longer one of this player\'s other names. Close this window, then open the pencil again.');
    // The player's own name, or a name listed twice, needs no row.
    if (seen[key]) return;
    seen[key] = true;
    if (from === name) {
      kept[from] = true;
      return;
    }
    var clash = aliasRows.find(function (row) { return String(row.player_id) !== playerId && aliasKey_(row.alias) === key; });
    if (clash) {
      var owner = players.find(function (row) { return String(row.player_id) === String(clash.player_id); });
      throw new Error(name + ' is already another name for ' + (owner ? owner.display_name : 'another player') + '.');
    }
    if (players.some(function (row) { return String(row.player_id) !== playerId && aliasKey_(row.display_name) === key; })) {
      throw new Error(name + ' is another player\'s name in the directory.');
    }
    if (previousNameOwner_(name, playerId, changes)) throw new Error(name + ' was another player\'s name before a correction, so it cannot be used.');
    if (from) {
      kept[from] = true;
      plan.edits.push({ row: mineByName[from].__row, from: from, to: name });
    } else {
      plan.adds.push(name);
    }
  });
  mine.forEach(function (row) { if (!kept[normalizeName_(row.alias)]) plan.removes.push({ row: row.__row, name: normalizeName_(row.alias) }); });
  return plan;
}

// Rows are changed first, then removed from the bottom up, so no row number moves before it is used; new names go last.
function applyAliasPlan_(playerId, plan, now) {
  plan.edits.forEach(function (edit) { updateRow_('Aliases', edit.row, { alias: edit.to }); });
  var sheet = SpreadsheetApp.getActive().getSheetByName('Aliases');
  plan.removes.slice().sort(function (left, right) { return right.row - left.row; }).forEach(function (remove) { sheet.deleteRow(remove.row); });
  appendObjects_('Aliases', plan.adds.map(function (name) { return { alias: name, player_id: playerId, created_at: now }; }));
}

// changes: { name, rating, email, aliases }, every field as the window shows it (aliases: [{from, name}], or left out
// to keep them as they are). before: what the window loaded, so a change made on another device in between is not
// overwritten unseen.
function updatePlayer(playerId, changes, before) {
  playerId = String(playerId || '');
  changes = changes || {};
  before = before || {};
  var name = normalizeName_(changes.name);
  var rating = Number(changes.rating);
  var email = String(changes.email == null ? '' : changes.email).trim();
  var wanted = changes.aliases == null ? null : changes.aliases;
  if (!name || name.length > 80) throw new Error('Player name must be 1 through 80 characters.');
  if (changes.rating === '' || changes.rating == null || !Number.isInteger(rating) || rating < 0 || rating > 4000) throw new Error('Rating must be a whole number from 0 through 4000.');
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Enter a valid email address, or leave it blank.');
  if (wanted && (!Array.isArray(wanted) || wanted.length > 20)) throw new Error('A player can have up to 20 other names.');
  (wanted || []).forEach(function (entry) {
    var alias = normalizeName_(entry && entry.name);
    if (!alias || alias.length > 80 || !aliasKey_(alias)) throw new Error('Each other name must be 1 through 80 characters, with at least one letter or number.');
  });
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
    var aliasRows = rows_('Aliases');
    var oldAliases = playerAliasNames_(aliasRows, playerId);
    var sameNames = function (left, right) { return left.slice().sort().join('\n') === right.map(normalizeName_).sort().join('\n'); };
    if ((before.name !== undefined && normalizeName_(before.name) !== normalizeName_(oldName)) ||
        (before.rating !== undefined && Number(before.rating) !== oldRating) ||
        (before.email !== undefined && String(before.email) !== oldEmail) ||
        (before.aliases !== undefined && !sameNames(oldAliases, before.aliases || []))) {
      throw new Error(oldName + ' was changed on another device after this window opened. Close it, then open the pencil again to see the current details.');
    }
    var nameChanges = rows_('NameChanges');
    var renamed = name !== normalizeName_(oldName);
    if (renamed) {
      var taken = players.some(function (row) {
        return String(row.player_id) !== playerId && normalizeName_(row.display_name).toLowerCase() === name.toLowerCase();
      });
      if (taken) throw new Error(name + ' already exists in the directory.');
      if (previousNameOwner_(name, playerId, nameChanges)) throw new Error(name + ' was another player\'s name before a correction, so it cannot be used again.');
      var aliasOwner = aliasRows.find(function (row) { return String(row.player_id) !== playerId && aliasKey_(row.alias) === aliasKey_(name); });
      if (aliasOwner) {
        var owner = players.find(function (row) { return String(row.player_id) === String(aliasOwner.player_id); });
        throw new Error(name + ' is another name for ' + (owner ? owner.display_name : 'another player') + '.');
      }
    }
    var plan = wanted ? aliasPlan_(playerId, name, wanted, aliasRows, players, nameChanges) : { edits: [], adds: [], removes: [] };
    var aliasesChanged = plan.edits.length + plan.adds.length + plan.removes.length > 0;
    var now = new Date();
    var playerChanges = {};
    if (renamed) playerChanges.display_name = name;
    if (rating !== oldRating) playerChanges.current_rating = rating;
    var emailChanged = email !== oldEmail;
    if (!renamed && rating === oldRating && !emailChanged && !aliasesChanged) return playerDetails_(player, oldEmail, oldAliases);
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
    if (aliasesChanged) applyAliasPlan_(playerId, plan, now);
    // Text, not numbers, so the public desk log (DeskLog.js) shows only which fields changed, and how many other names.
    var details = { nameChanged: renamed, ratingChanged: rating !== oldRating, emailChanged: emailChanged };
    if (renamed) { details.name_from = oldName; details.name_to = name; }
    if (rating !== oldRating) { details.rating_from = String(oldRating); details.rating_to = String(rating); }
    if (aliasesChanged) {
      details.aliasesAdded = plan.adds.length;
      details.aliasesChanged = plan.edits.length;
      details.aliasesRemoved = plan.removes.length;
      details.aliases = { added: plan.adds, changed: plan.edits.map(function (edit) { return [edit.from, edit.to]; }), removed: plan.removes.map(function (remove) { return remove.name; }) };
    }
    appendAudit_('player_updated', 'player', playerId, details);
    return playerDetails_(Object.assign({}, player, playerChanges), email, playerAliasNames_(rows_('Aliases'), playerId));
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
