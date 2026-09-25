var MEMBER_STATUS_HEADERS = ['player_id', 'status', 'updated_at'];

function ensureMemberStatusTable_() {
  var spreadsheet = SpreadsheetApp.getActive();
  TABLES.MemberStatus = MEMBER_STATUS_HEADERS;
  var sheet = spreadsheet.getSheetByName('MemberStatus');
  var created = !sheet;
  if (created) sheet = spreadsheet.insertSheet('MemberStatus');
  ensureHeader_(sheet, MEMBER_STATUS_HEADERS);
  if (created) formatTable_(sheet, MEMBER_STATUS_HEADERS.length);
}

function getMemberStatuses() {
  ensureMemberStatusTable_();
  var players = listPlayers();
  var linkRows = nameLinkRows_();
  var statuses = {};
  var notes = {};
  players.forEach(function (player) { statuses[player.playerId] = 'visitor'; });
  var seen = {};
  rows_('MemberStatus').forEach(function (row) {
    var playerId = String(row.player_id);
    if (seen[playerId]) throw new Error('Duplicate member status for ' + playerId);
    seen[playerId] = true;
    if (['', 'member', 'visitor'].indexOf(String(row.status)) < 0) throw new Error('Invalid member status for ' + playerId);
    if (Object.prototype.hasOwnProperty.call(statuses, playerId) && row.status) statuses[playerId] = String(row.status);
  });
  confirmedNameLinks_(players, linkRows).resolved.forEach(function (link) {
    var status = statuses[link.left.playerId] === 'member' || statuses[link.right.playerId] === 'member' ? 'member' : 'visitor';
    statuses[link.left.playerId] = status;
    statuses[link.right.playerId] = status;
    notes[link.left.playerId] = 'Also listed as ' + link.right.name;
    notes[link.right.playerId] = 'Also listed as ' + link.left.name;
  });
  juniorLinks_(players, linkRows).forEach(function (link) {
    statuses[link.junior.playerId] = 'junior';
    notes[link.junior.playerId] = 'Junior linked to member ' + link.member.name;
  });
  standaloneJuniors_(players, linkRows).forEach(function (junior) {
    statuses[junior.playerId] = 'junior';
    notes[junior.playerId] = 'Junior member';
  });
  return { statuses: statuses, notes: notes };
}

function setMemberStatus(playerId, status) {
  playerId = String(playerId || '');
  status = String(status || '').toLowerCase();
  if (['', 'member', 'visitor'].indexOf(status) < 0) throw new Error('Invalid member status');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureMemberStatusTable_();
    var players = listPlayers();
    if (!players.some(function (player) { return player.playerId === playerId; })) throw new Error('Unknown player');
    var junior = juniorLinks_(players).find(function (link) { return link.junior.playerId === playerId; });
    if (junior) throw new Error('Junior membership comes from ' + junior.member.name + "'s account");
    if (standaloneJuniors_(players).some(function (player) { return player.playerId === playerId; })) throw new Error('Junior members stay marked J');
    var ids = [playerId].concat(linkedPartnerIds_(playerId, confirmedNameLinks_(players).resolved));
    var rows = rows_('MemberStatus');
    var additions = [];
    ids.forEach(function (id) {
      var matches = rows.filter(function (row) { return String(row.player_id) === id; });
      if (matches.length > 1) throw new Error('Duplicate member status for ' + id);
      if (matches.length) updateRow_('MemberStatus', matches[0].__row, { status: status, updated_at: new Date() });
      else if (status) additions.push({ player_id: id, status: status, updated_at: new Date() });
    });
    appendObjects_('MemberStatus', additions);
    appendAudit_('member_status_updated', 'player', playerId, { status: status || 'unclassified', linked: ids.slice(1) });
    return getMemberStatuses();
  } finally {
    lock.releaseLock();
  }
}
