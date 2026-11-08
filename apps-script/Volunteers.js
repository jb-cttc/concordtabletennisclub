// Tonight's volunteers: who signed up to open or close the club on a date in the volunteer sign-up app (staffing-app/), so
// the organizer remembers to add them to the round robin or Open Play; they are often busy setting up and forget to sign
// in. Read-only: the desk only reads the volunteer app's private Sheet (tab Signups, by header name) and never writes to it,
// texts or emails anyone. The owner copies that Sheet's id into the desk's script property CTTC_STAFFING_DB_ID; without it
// the desk says the section is not connected and works as before.
//
// On a special night (NightFees.js, SPECIAL_NIGHTS) the first 2 openers and the first 2 closers play free. Who that is comes
// from freeSpots_ below, the same rule the volunteer app uses to tell them; the desk marks them and charges them nothing.
var VOLUNTEER_ROLES = [
  ['desk', 'Desk organizer'], ['desk-backup', 'Desk organizer backup'], ['money', 'Front desk'], ['money-backup', 'Front desk backup'],
  ['tables', 'Tables and barriers'], ['lockup', 'Lock-up'], ['close', 'Put away']
];
var VOLUNTEER_COLUMNS = ['date', 'position', 'player_id', 'name', 'status', 'expires_at'];

// The volunteer app's Signups rows as objects, keyed by header name, each with its night as 'YYYY-MM-DD' in date.
// { connected: false } without the script property; rows [] without the tab.
function staffingSignups_() {
  var id = PropertiesService.getScriptProperties().getProperty('CTTC_STAFFING_DB_ID');
  if (!id) return { connected: false, rows: [] };
  var sheet = SpreadsheetApp.openById(id).getSheetByName('Signups');
  if (!sheet) return { connected: true, rows: [] };
  var values = sheet.getDataRange().getValues();
  var head = (values[0] || []).map(function (cell) { return String(cell).trim(); });
  VOLUNTEER_COLUMNS.forEach(function (name) {
    if (head.indexOf(name) < 0) throw new Error('The volunteer Signups tab has no ' + name + ' column.');
  });
  var rows = values.slice(1).map(function (line) {
    var entry = {};
    head.forEach(function (name, index) { if (name) entry[name] = line[index]; });
    entry.date = displayDate_(entry.date).slice(0, 10);
    return entry;
  });
  return { connected: true, rows: rows };
}

// THE FREE-NIGHT RULE, kept word for word the same in staffing-app/Code.js and apps-script/Volunteers.js (a test compares
// them). entries: one night's Signups rows, any status. Returns the people holding a free spot, openers first, as
// [{key, part, confirmed, entries}]: in each part of the night (opening, closing) the first 2 people by sign-up time among
// everyone holding a slot (confirmed, or waiting for their YES before its deadline). Someone already free as an opener is
// skipped among the closers, so that spot passes to the next closer: up to 4 different people. People already told they
// play free (free_night set) keep their place ahead of the rest, so nobody is told and then loses it. A spot held by someone
// still waiting to confirm is theirs, but free only once they confirm: if they never do, or drop, the next person moves up.
function freeSpots_(entries, now) {
  var parts = { desk: 'open', 'desk-backup': 'open', money: 'open', 'money-backup': 'open', tables: 'open', lockup: 'close', close: 'close' };
  var people = { open: {}, close: {} };
  entries.forEach(function (entry) {
    var status = String(entry.status || '').trim();
    if (status === 'pending' && Number(entry.expires_at) <= now) return;
    if (status !== 'pending' && status !== 'confirmed') return;
    var part = parts[String(entry.position || '').trim()];
    if (!part) return;
    var key = String(entry.player_id || '').trim() ? 'p:' + String(entry.player_id).trim() : 'e:' + String(entry.email || '').trim().toLowerCase();
    var person = people[part][key] || (people[part][key] = { key: key, part: part, confirmed: false, told: false, at: 8.64e15, id: '', entries: [] });
    var at = Date.parse(entry.created_at) || 8.64e15;
    var id = String(entry.signup_id || '');
    if (at < person.at || (at === person.at && id < person.id)) { person.at = at; person.id = id; }
    if (status === 'confirmed') person.confirmed = true;
    if (String(entry.free_night || '').trim()) person.told = true;
    person.entries.push(entry);
  });
  var chosen = {};
  var spots = [];
  ['open', 'close'].forEach(function (part) {
    Object.keys(people[part]).map(function (key) { return people[part][key]; }).filter(function (person) { return !chosen[person.key]; }).sort(function (a, b) {
      return (Number(b.told) - Number(a.told)) || (a.at - b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }).slice(0, 2).forEach(function (person) {
      chosen[person.key] = true;
      spots.push({ key: person.key, part: person.part, confirmed: person.confirmed, entries: person.entries });
    });
  });
  return spots;
}

// function (date) -> { playerId: 'open' | 'close' } for the confirmed volunteers who play free that night (special nights
// only). rows: staffingSignups_().rows, read here when not given. A volunteer app the desk cannot read gives nobody a free
// night rather than stopping the desk, the cash flow page or Clover matching.
function freeVolunteerFinder_(rows) {
  if (!rows) {
    try {
      rows = staffingSignups_().rows;
    } catch (error) {
      rows = [];
    }
  }
  var byDate = {};
  rows.forEach(function (entry) { (byDate[entry.date] || (byDate[entry.date] = [])).push(entry); });
  var now = Date.now();
  var found = {};
  return function (date) {
    date = String(date || '').slice(0, 10);
    if (found[date]) return found[date];
    var free = {};
    if (specialNight_(date)) {
      freeSpots_(byDate[date] || [], now).forEach(function (spot) {
        var playerId = spot.key.indexOf('p:') === 0 ? spot.key.slice(2) : '';
        if (spot.confirmed && playerId) free[playerId] = spot.part;
      });
    }
    found[date] = free;
    return free;
  };
}

// [{playerId, name, roles, waiting, free}] for sessionDate: everyone with a confirmed sign-up, or one still waiting for its
// YES (it holds the slot), in the order of their first role. playerId is '' for a name that is not an active directory
// player; waiting is true when none of their sign-ups is confirmed yet. free, on a special night only: 'open' or 'close' when
// they hold one of the free spots (they play free once confirmed), else ''. special: that night's special ({fee}), only on a special night.
// Never an email address or a phone number.
function listVolunteers(sessionDate) {
  validateSessionDate_(sessionDate);
  var signups = staffingSignups_();
  var special = specialNight_(sessionDate);
  var answer = function (volunteers) {
    var result = { connected: signups.connected, volunteers: volunteers };
    if (special) result.special = { fee: special.fee };
    return result;
  };
  if (!signups.connected) return answer([]);
  var now = Date.now();
  var players = {};
  listPlayers().forEach(function (player) { players[player.playerId] = player; });
  var order = VOLUNTEER_ROLES.map(function (role) { return role[0]; });
  var tonight = signups.rows.filter(function (entry) { return entry.date === sessionDate; });
  var freeBy = {};
  if (special) {
    freeSpots_(tonight, now).forEach(function (spot) {
      spot.entries.forEach(function (entry) { freeBy[volunteerKey_(entry, players)] = spot.part; });
    });
  }
  var people = {};
  tonight.forEach(function (entry) {
    var status = String(entry.status).trim();
    // A pending pick whose deadline passed is expired, as in the volunteer app (signupStatus_).
    if (status === 'pending' && Number(entry.expires_at) <= now) return;
    if (status !== 'confirmed' && status !== 'pending') return;
    var playerId = String(entry.player_id || '').trim();
    var player = players[playerId] || null;
    var name = player ? player.name : String(entry.name || '').replace(/\s+/g, ' ').trim();
    var key = volunteerKey_(entry, players);
    if (!name) return;
    var person = people[key] || (people[key] = { playerId: player ? playerId : '', name: name, roles: [], rank: order.length, waiting: true, free: '' });
    var position = String(entry.position).trim();
    var rank = order.indexOf(position);
    var label = rank >= 0 ? VOLUNTEER_ROLES[rank][1] : position;
    if (label && person.roles.indexOf(label) < 0) person.roles.push(label);
    if (rank >= 0 && rank < person.rank) person.rank = rank;
    if (status === 'confirmed') person.waiting = false;
    if (freeBy[key]) person.free = freeBy[key];
  });
  var volunteers = Object.keys(people).map(function (key) { return people[key]; }).sort(function (left, right) {
    return left.rank - right.rank || left.name.localeCompare(right.name);
  }).map(function (person) {
    var labels = VOLUNTEER_ROLES.map(function (role) { return role[1]; });
    var roles = person.roles.slice().sort(function (a, b) { return (labels.indexOf(a) + 1 || 99) - (labels.indexOf(b) + 1 || 99); });
    var volunteer = { playerId: person.playerId, name: person.name, roles: roles, waiting: person.waiting };
    if (special) volunteer.free = person.free;
    return volunteer;
  });
  return answer(volunteers);
}

// One person on the desk's list: the directory player, else the name they typed.
function volunteerKey_(entry, players) {
  var playerId = String(entry.player_id || '').trim();
  return players[playerId] ? playerId : 'name:' + String(entry.name || '').replace(/\s+/g, ' ').trim().toLowerCase();
}
