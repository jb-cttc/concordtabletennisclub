// Name links live in the private NameLinks sheet, never in code (the repo is public).
// kind 'same_person': name = record they play under, linked_name = their other directory name.
// kind 'junior': name = junior, linked_name = member account they belong to (blank if none).
// kind 'pays_for': name = a payer, linked_name = a player whose fee they often pay on the same Clover payment (CloverPayments.js).
var NAME_LINK_HEADERS = ['kind', 'name', 'linked_name', 'updated_at'];
var NAME_LINK_KINDS = ['same_person', 'junior', 'pays_for'];

function nameLinkRows_() {
  TABLES.NameLinks = NAME_LINK_HEADERS;
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getSheetByName('NameLinks');
  if (!sheet) {
    sheet = spreadsheet.insertSheet('NameLinks');
    ensureHeader_(sheet, NAME_LINK_HEADERS);
    formatTable_(sheet, NAME_LINK_HEADERS.length);
  }
  return rows_('NameLinks').filter(function (row) { return String(row.name || '').trim(); }).map(function (row) {
    var kind = String(row.kind || '').trim();
    if (NAME_LINK_KINDS.indexOf(kind) < 0) throw new Error('NameLinks row ' + row.__row + ' has unknown kind "' + kind + '"');
    return { kind: kind, name: String(row.name).trim(), linked: String(row.linked_name || '').trim() };
  });
}

function nameLinks_(kind, withLinkedName, linkRows) {
  return (linkRows || nameLinkRows_()).filter(function (link) { return link.kind === kind && !!link.linked === withLinkedName; })
  .map(function (link) { return withLinkedName ? [link.name, link.linked] : link.name; });
}

function standaloneJuniors_(players, linkRows) {
  var byKey = playersByLinkedKey_(players);
  return nameLinks_('junior', false, linkRows).map(function (name) { return byKey[linkedNameKey_(name)] || []; })
  .filter(function (matches) { return matches.length === 1; })
  .map(function (matches) { return matches[0]; });
}

function linkedNameKey_(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function playersByLinkedKey_(players) {
  var byKey = {};
  players.forEach(function (player) {
    var key = linkedNameKey_(player.name);
    (byKey[key] || (byKey[key] = [])).push(player);
  });
  return byKey;
}

function resolveLinks_(links, players) {
  var byKey = playersByLinkedKey_(players);
  var resolved = [];
  var unresolved = [];
  links.forEach(function (names) {
    var left = byKey[linkedNameKey_(names[0])] || [];
    var right = byKey[linkedNameKey_(names[1])] || [];
    if (left.length !== 1 || right.length !== 1 || left[0].playerId === right[0].playerId) unresolved.push(names);
    else resolved.push({ left: left[0], right: right[0] });
  });
  return { resolved: resolved, unresolved: unresolved };
}

function confirmedNameLinks_(players, linkRows) {
  return resolveLinks_(nameLinks_('same_person', true, linkRows), players);
}

function juniorLinks_(players, linkRows) {
  return resolveLinks_(nameLinks_('junior', true, linkRows), players).resolved.map(function (link) {
    return { junior: link.left, member: link.right };
  });
}

function linkedPartnerIds_(playerId, links) {
  return links.filter(function (link) {
    return link.left.playerId === playerId || link.right.playerId === playerId;
  }).map(function (link) {
    return link.left.playerId === playerId ? link.right.playerId : link.left.playerId;
  });
}

// ---- Links edited from the desk (the pencil's Links section, PlayerEdits.js) ----
// NameLinks rows name players by their directory name, so a link counts only while each name is exactly one active player
// (resolveLinks_). The window edits the rows that name this player on the left: their own 'junior' row (a junior, on a
// member's account or on their own), the 'junior' rows that name them as the member account, and their 'pays_for' rows.
// Rows that name them as someone else's payee are shown, and edited from the payer's window.
var LINK_LIST_MAX_ = 10;

// What the window shows: { junior, memberId, juniors: [ids], paysFor: [ids], paidBy: [ids], names: {id: name} }.
function playerLinks_(playerId, players, linkRows) {
  var byKey = playersByLinkedKey_(players);
  var one = function (name) { var found = byKey[linkedNameKey_(name)] || []; return found.length === 1 ? found[0] : null; };
  var links = { junior: false, memberId: '', juniors: [], paysFor: [], paidBy: [], names: {} };
  (linkRows || nameLinkRows_()).forEach(function (row) {
    if (row.kind !== 'junior' && row.kind !== 'pays_for') return;
    var left = one(row.name);
    var right = row.linked ? one(row.linked) : null;
    if (!left || (row.linked && (!right || right.playerId === left.playerId))) return;
    var note = function (player) { links.names[player.playerId] = player.name; return player.playerId; };
    if (row.kind === 'junior' && left.playerId === playerId) { links.junior = true; links.memberId = right ? note(right) : ''; }
    else if (row.kind === 'junior' && right && right.playerId === playerId) links.juniors.push(note(left));
    else if (row.kind === 'pays_for' && left.playerId === playerId && right) links.paysFor.push(note(right));
    else if (row.kind === 'pays_for' && right && right.playerId === playerId) links.paidBy.push(note(left));
  });
  return links;
}

function sameLinks_(left, right) {
  var ids = function (list) { return (list || []).map(String).slice().sort().join(','); };
  return !!left.junior === !!right.junior && String(left.memberId || '') === String(right.memberId || '') &&
    ids(left.juniors) === ids(right.juniors) && ids(left.paysFor) === ids(right.paysFor);
}

// wanted: { junior, memberId, juniors: [ids], paysFor: [ids] }. Returns { removes: [{row, kind, name, linked}],
// adds: [{kind, name, linked}] }, or throws when a link cannot be made. players: listPlayers(). rows: rows_('NameLinks').
// Call with the desk lock held.
function linkPlan_(playerId, wanted, players, rows) {
  var byId = {};
  players.forEach(function (player) { byId[player.playerId] = player; });
  var byKey = playersByLinkedKey_(players);
  var me = byId[playerId];
  if (!me) throw new Error('Only an active player can have links.');
  var clean = function (list, label) {
    if (list != null && !Array.isArray(list)) throw new Error(label + ' must be a list of players.');
    var ids = (list || []).map(String).filter(function (id, index, all) { return id && all.indexOf(id) === index; });
    if (ids.length > LINK_LIST_MAX_) throw new Error(label + ': up to ' + LINK_LIST_MAX_ + ' players.');
    return ids;
  };
  var juniors = clean(wanted.juniors, 'Juniors on this account');
  var paysFor = clean(wanted.paysFor, 'Pays for');
  var junior = wanted.junior === true;
  var memberId = junior ? String(wanted.memberId || '') : '';
  var unique = function (id) {
    var player = byId[id];
    if (!player) throw new Error('A linked player must be an active player in the directory.');
    if ((byKey[linkedNameKey_(player.name)] || []).length !== 1) throw new Error(player.name + ' shares a name with another player, so a link cannot tell them apart. Correct one of the names first.');
    if (id === playerId) throw new Error(me.name + ' cannot be linked to themselves.');
    return player;
  };
  if ((byKey[linkedNameKey_(me.name)] || []).length !== 1) throw new Error(me.name + ' shares a name with another player, so links cannot tell them apart. Correct one of the names first.');
  [memberId].filter(Boolean).concat(juniors, paysFor).forEach(unique);
  if (junior && juniors.length) throw new Error('A junior cannot have juniors on their account. Untick Junior, or remove the juniors.');
  if (memberId && juniors.indexOf(memberId) >= 0) throw new Error(byId[memberId].name + ' cannot be both the member account and a junior on it.');
  var one = function (name) { var found = byKey[linkedNameKey_(name)] || []; return found.length === 1 ? found[0].playerId : ''; };
  var current = rows.map(function (row) {
    return { row: row.__row, kind: String(row.kind || '').trim(), name: String(row.name || '').trim(), linked: String(row.linked_name || '').trim() };
  }).filter(function (row) { return row.name && (row.kind === 'junior' || row.kind === 'pays_for'); })
  .map(function (row) { return Object.assign(row, { left: one(row.name), right: row.linked ? one(row.linked) : '' }); });
  var memberOf = {};
  current.forEach(function (row) { if (row.kind === 'junior' && row.left && row.right) memberOf[row.left] = row.right; });
  if (memberId && current.some(function (row) { return row.kind === 'junior' && row.left === memberId; })) throw new Error(byId[memberId].name + ' is a junior. Choose the member whose account this is.');
  juniors.forEach(function (id) {
    if (current.some(function (row) { return row.kind === 'junior' && row.right === id; })) throw new Error(byId[id].name + ' has juniors on their account, so they cannot be a junior.');
  });
  var plan = { removes: [], adds: [], moved: [] };
  // Their own junior row: one, naming the member account (or none for a junior on their own).
  var own = current.filter(function (row) { return row.kind === 'junior' && row.left === playerId; });
  var ownKept = junior ? own.filter(function (row) { return (row.right || '') === memberId && (!!row.linked) === !!memberId; })[0] : null;
  own.forEach(function (row) { if (row !== ownKept) plan.removes.push(row); });
  if (junior && !ownKept) plan.adds.push({ kind: 'junior', name: me.name, linked: memberId ? byId[memberId].name : '' });
  // Juniors on this account: a junior added here leaves any other account (or being a junior on their own).
  current.filter(function (row) { return row.kind === 'junior' && row.right === playerId && juniors.indexOf(row.left) < 0; }).forEach(function (row) { plan.removes.push(row); });
  juniors.forEach(function (id) {
    var theirs = current.filter(function (row) { return row.kind === 'junior' && row.left === id; });
    var here = theirs.filter(function (row) { return row.right === playerId; })[0];
    theirs.forEach(function (row) { if (row !== here) plan.removes.push(row); });
    if (!here) {
      plan.adds.push({ kind: 'junior', name: byId[id].name, linked: me.name });
      if (memberOf[id]) plan.moved.push({ playerId: id, from: memberOf[id] });
    }
  });
  // Pays for.
  var paying = current.filter(function (row) { return row.kind === 'pays_for' && row.left === playerId && row.right; });
  paying.forEach(function (row, index) {
    var duplicate = paying.slice(0, index).some(function (other) { return other.right === row.right; });
    if (paysFor.indexOf(row.right) < 0 || duplicate) plan.removes.push(row);
  });
  paysFor.forEach(function (id) {
    if (!paying.some(function (row) { return row.right === id; })) plan.adds.push({ kind: 'pays_for', name: me.name, linked: byId[id].name });
  });
  plan.removes = plan.removes.filter(function (row, index, all) { return all.indexOf(row) === index; });
  return plan;
}

// Rows removed from the bottom up, so no row number moves before it is used; new rows go last.
function applyLinkPlan_(plan, now) {
  var sheet = SpreadsheetApp.getActive().getSheetByName('NameLinks');
  plan.removes.slice().sort(function (left, right) { return right.row - left.row; }).forEach(function (row) { sheet.deleteRow(row.row); });
  appendObjects_('NameLinks', plan.adds.map(function (add) { return { kind: add.kind, name: add.name, linked_name: add.linked, updated_at: now }; }));
}
