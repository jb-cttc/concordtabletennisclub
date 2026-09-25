var MEMBERSHIP_DUES_HEADERS = ['player_id', 'membership_year', 'expires_on', 'payment_method', 'source_name', 'updated_at'];

function ensureMembershipDuesTable_() {
  TABLES.MembershipDues = MEMBERSHIP_DUES_HEADERS;
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getSheetByName('MembershipDues');
  var created = !sheet;
  if (created) sheet = spreadsheet.insertSheet('MembershipDues');
  ensureHeader_(sheet, MEMBERSHIP_DUES_HEADERS);
  if (created) formatTable_(sheet, MEMBERSHIP_DUES_HEADERS.length);
}

function getMembershipDues2026() {
  ensureMembershipDuesTable_();
  var result = {};
  rows_('MembershipDues').forEach(function (row) {
    if (String(row.membership_year) !== '2026') return;
    var playerId = String(row.player_id);
    if (Object.prototype.hasOwnProperty.call(result, playerId)) throw new Error('Duplicate membership dues for ' + playerId);
    result[playerId] = { method: String(row.payment_method || ''), expiresOn: String(row.expires_on || '') };
  });
  return result;
}
