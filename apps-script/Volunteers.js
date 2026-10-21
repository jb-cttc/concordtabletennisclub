// Tonight's volunteers: who signed up to open or close the club on a date in the volunteer sign-up app (staffing-app/), so
// the organizer remembers to add them to the round robin or Open Play; they are often busy setting up and forget to sign
// in. Read-only: the desk only reads the volunteer app's private Sheet (tab Signups, by header name) and never writes to it,
// texts or emails anyone. The owner copies that Sheet's id into the desk's script property CTTC_STAFFING_DB_ID; without it
// the desk says the section is not connected and works as before.
var VOLUNTEER_ROLES = [
  ['desk', 'Desk organizer'], ['desk-backup', 'Desk organizer backup'], ['money', 'Front desk'], ['money-backup', 'Front desk backup'],
  ['tables', 'Tables and barriers'], ['lockup', 'Lock-up'], ['close', 'Put away']
];

// [{playerId, name, roles, waiting}] for sessionDate: everyone with a confirmed sign-up, or one still waiting for its YES
// (it holds the slot), in the order of their first role. playerId is '' for a name that is not an active directory player;
// waiting is true when none of their sign-ups is confirmed yet. Never an email address or a phone number.
function listVolunteers(sessionDate) {
  validateSessionDate_(sessionDate);
  var id = PropertiesService.getScriptProperties().getProperty('CTTC_STAFFING_DB_ID');
  if (!id) return { connected: false, volunteers: [] };
  var sheet = SpreadsheetApp.openById(id).getSheetByName('Signups');
  if (!sheet) return { connected: true, volunteers: [] };
  var values = sheet.getDataRange().getValues();
  var head = (values[0] || []).map(function (cell) { return String(cell).trim(); });
  var at = function (name) { return head.indexOf(name); };
  ['date', 'position', 'player_id', 'name', 'status', 'expires_at'].forEach(function (name) {
    if (at(name) < 0) throw new Error('The volunteer Signups tab has no ' + name + ' column.');
  });
  var now = Date.now();
  var players = {};
  listPlayers().forEach(function (player) { players[player.playerId] = player; });
  var order = VOLUNTEER_ROLES.map(function (role) { return role[0]; });
  var people = {};
  values.slice(1).forEach(function (row) {
    if (displayDate_(row[at('date')]).slice(0, 10) !== sessionDate) return;
    var status = String(row[at('status')]).trim();
    // A pending pick whose deadline passed is expired, as in the volunteer app (signupStatus_).
    if (status === 'pending' && Number(row[at('expires_at')]) <= now) return;
    if (status !== 'confirmed' && status !== 'pending') return;
    var playerId = String(row[at('player_id')] || '').trim();
    var player = players[playerId] || null;
    var name = player ? player.name : String(row[at('name')] || '').replace(/\s+/g, ' ').trim();
    var key = player ? playerId : 'name:' + name.toLowerCase();
    if (!name) return;
    var person = people[key] || (people[key] = { playerId: player ? playerId : '', name: name, roles: [], rank: order.length, waiting: true });
    var position = String(row[at('position')]).trim();
    var rank = order.indexOf(position);
    var label = rank >= 0 ? VOLUNTEER_ROLES[rank][1] : position;
    if (label && person.roles.indexOf(label) < 0) person.roles.push(label);
    if (rank >= 0 && rank < person.rank) person.rank = rank;
    if (status === 'confirmed') person.waiting = false;
  });
  var volunteers = Object.keys(people).map(function (key) { return people[key]; }).sort(function (left, right) {
    return left.rank - right.rank || left.name.localeCompare(right.name);
  }).map(function (person) {
    var labels = VOLUNTEER_ROLES.map(function (role) { return role[1]; });
    var roles = person.roles.slice().sort(function (a, b) { return (labels.indexOf(a) + 1 || 99) - (labels.indexOf(b) + 1 || 99); });
    return { playerId: person.playerId, name: person.name, roles: roles, waiting: person.waiting };
  });
  return { connected: true, volunteers: volunteers };
}
