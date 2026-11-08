// Volunteer Admin (?view=volunteers, framed by the club site's volunteer-admin.html): the club's own page for the volunteer
// sign-ups. Like the rest of the desk it opens only for the club's Google account. It shows every upcoming night with full
// names, and the training lists that decide who may run the desk, collect money or lock up; changes are gathered in a bucket,
// reviewed (with the email each person will get) and submitted together.
//
// The volunteer app (staffing-app/) owns its Sheet, its rules and its emails, so this page asks it for everything through
// its web address (fn 'admin'), with the desk's admin key: column B of the hidden AppWake tab, made here on first use and
// read there. New players are added to this desk's own registry first (addPlayer, with a rating, exactly as on the desk),
// so the desk never meets a volunteer it does not know.
var VOLUNTEER_ADMIN_URL_ = 'https://script.google.com/macros/s/AKfycbx_ApmyAF8Yk6DCuzeD_3JR9HOo_QCbI5hGLyBLWMl8feuoTI969BYAWba268Er4_1h3g/exec';
var VOLUNTEER_ADMIN_MAX_NEW_ = 10;

function volunteerAdminPage_() {
  return HtmlService.createHtmlOutputFromFile('VolunteerAdminPage')
    .setTitle('CTTC Volunteer Admin')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// The admin key, made once: a long random value in AppWake!B2 (column A is the wake key, MailReader.js).
function volunteerAdminKey_() {
  var cache = CacheService.getScriptCache();
  var key = cache.get('admin-key');
  if (key) return key;
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getSheetByName(WAKE_TAB_);
  if (!sheet) {
    wakeKey_();
    sheet = spreadsheet.getSheetByName(WAKE_TAB_);
  }
  key = sheet.getLastRow() >= 2 ? String(sheet.getRange(2, 2, 1, 1).getValues()[0][0] || '') : '';
  if (key.length < 32) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    sheet.getRange(1, 2, 2, 1).setNumberFormat('@').setValues([['admin_key'], [key]]);
    // Saved before the volunteer app is asked: it reads the key from this Sheet, and Google holds writes until the end of
    // the run otherwise (the first Volunteer Admin visit was refused).
    SpreadsheetApp.flush();
  }
  cache.put('admin-key', key, 21600);
  return key;
}

// One call to the volunteer app. Its own refusals (a problem with a change) come back as they are; anything else is an error.
function volunteerAdminCall_(body) {
  var response = UrlFetchApp.fetch(VOLUNTEER_ADMIN_URL_, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, followRedirects: true,
    payload: JSON.stringify(Object.assign({ fn: 'admin', key: volunteerAdminKey_() }, body)) });
  var answer = null;
  try { answer = response.getResponseCode() === 200 ? JSON.parse(response.getContentText()) : null; } catch (error) { answer = null; }
  if (!answer) throw new Error('The volunteer sign-up app did not answer. Try again in a minute.');
  if (!answer.ok && !answer.problems) throw new Error(answer.message || 'The volunteer sign-up app refused the request.');
  return answer;
}

// The page's data: the volunteer app's board, and the desk's active players to search and add from.
function getVolunteerAdmin() {
  var board = volunteerAdminCall_({ action: 'board' });
  board.players = listPlayers().map(function (player) { return { playerId: player.playerId, name: player.name, rating: player.currentRating }; });
  return board;
}

// What a new player would hit on the desk (SessionService.js addPlayer), checked before anything is saved: '' or the reason.
function volunteerAdminNewPlayerProblem_(player, players, taken, aliases) {
  var name = normalizeName_(player && player.name);
  var given = player && player.rating;
  var rating = given === '' || given === null || given === undefined ? NaN : Number(given);
  if (!name || name.length > 80) return 'Player name must be 1 through 80 characters.';
  // A rating is required: an empty one is not 0.
  if (!Number.isInteger(rating) || rating < 0 || rating > 4000) return name + ': the rating must be a whole number from 0 through 4000.';
  var key = name.toLowerCase();
  if (players.some(function (row) { return normalizeName_(row.display_name).toLowerCase() === key; })) return name + ' is already on the desk. Search for them instead.';
  if (previousNameOwner_(name)) return name + ' was another player\'s name before a correction, so it cannot be used again.';
  if (aliases.some(function (row) { return aliasKey_(row.alias) === aliasKey_(name); })) return name + ' is another name for an existing player. Search for them instead.';
  if (taken[key]) return name + ' is in this list twice.';
  taken[key] = true;
  return '';
}

// bucket: { newPlayers: [{ tempId, name, rating }], changes: [...] } (see staffing-app/Code.js adminApply_; a training
// change may name a new player by tempId). note: a message for the emails. preview: only check, and return the emails.
function volunteerAdminSubmit_(bucket, note, preview) {
  bucket = bucket || {};
  var newPlayers = Array.isArray(bucket.newPlayers) ? bucket.newPlayers : [];
  var changes = Array.isArray(bucket.changes) ? bucket.changes : [];
  if (newPlayers.length > VOLUNTEER_ADMIN_MAX_NEW_) throw new Error('Add at most ' + VOLUNTEER_ADMIN_MAX_NEW_ + ' new players at once.');
  var players = rows_('Players');
  var aliases = rows_('Aliases');
  var taken = {};
  var problems = [];
  newPlayers.forEach(function (player, index) {
    var reason = volunteerAdminNewPlayerProblem_(player, players, taken, aliases);
    if (reason) problems.push({ newPlayer: index, reason: reason });
    if (!/^new-[0-9]{1,6}$/.test(String(player && player.tempId || ''))) problems.push({ newPlayer: index, reason: 'That new player is not valid.' });
  });
  if (problems.length) return { ok: false, problems: problems, message: 'A new player cannot be added, so nothing was changed.' };
  var ids = {};
  newPlayers.forEach(function (player) { ids[player.tempId] = player.tempId; });
  var withIds = function () {
    return changes.map(function (change) { return change && ids[change.playerId] ? Object.assign({}, change, { playerId: ids[change.playerId] }) : change; });
  };
  var listed = function () { return newPlayers.map(function (player) { return { playerId: ids[player.tempId], name: normalizeName_(player.name) }; }); };
  if (preview) return volunteerAdminCall_({ action: 'apply', preview: true, changes: withIds(), note: note, newPlayers: listed() });
  // The changes are checked before anyone is added, so a refused bucket adds no players either.
  var check = volunteerAdminCall_({ action: 'apply', preview: true, changes: withIds(), note: note, newPlayers: listed() });
  if (!check.ok) return check;
  var added = newPlayers.map(function (player) {
    var made = addPlayer(normalizeName_(player.name), Number(player.rating));
    ids[player.tempId] = made.playerId;
    return made;
  });
  var answer;
  try {
    answer = changes.length ? volunteerAdminCall_({ action: 'apply', changes: withIds(), note: note, newPlayers: listed() }) : { ok: true, changes: 0, emailed: 0, people: 0 };
  } catch (error) {
    // The players are on the desk now; the page swaps them in for the new-player rows so a second Submit adds nobody twice.
    answer = { ok: false, message: (added.length ? 'Added ' + added.map(function (player) { return player.name; }).join(', ') + ' to the desk, but the other changes were not made: ' : '') +
      (error.message || error) };
  }
  answer.added = newPlayers.map(function (player) { return { tempId: player.tempId, playerId: ids[player.tempId], name: normalizeName_(player.name) }; });
  appendAudit_('volunteer_admin_submitted', 'staffing', answer.changeId || 'players', { changes: answer.changes || 0, emailed: answer.emailed || 0, people: answer.people || 0,
    playersAdded: added.length, ok: !!answer.ok });
  return answer;
}

function previewVolunteerAdmin(bucket, note) { return volunteerAdminSubmit_(bucket, note, true); }
function submitVolunteerAdmin(bucket, note) { return volunteerAdminSubmit_(bucket, note, false); }
