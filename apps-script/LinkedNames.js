// Name links live in the private NameLinks sheet, never in code (the repo is public).
// kind 'same_person': name = record they play under, linked_name = their other directory name.
// kind 'junior': name = junior, linked_name = member account they belong to (blank if none).
var NAME_LINK_HEADERS = ['kind', 'name', 'linked_name', 'updated_at'];
var NAME_LINK_KINDS = ['same_person', 'junior'];

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

function nameLinks_(kind, withLinkedName) {
  return nameLinkRows_().filter(function (link) { return link.kind === kind && !!link.linked === withLinkedName; })
  .map(function (link) { return withLinkedName ? [link.name, link.linked] : link.name; });
}

function standaloneJuniors_(players) {
  var byKey = playersByLinkedKey_(players);
  return nameLinks_('junior', false).map(function (name) { return byKey[linkedNameKey_(name)] || []; })
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

function confirmedNameLinks_(players) {
  return resolveLinks_(nameLinks_('same_person', true), players);
}

function juniorLinks_(players) {
  return resolveLinks_(nameLinks_('junior', true), players).resolved.map(function (link) {
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
