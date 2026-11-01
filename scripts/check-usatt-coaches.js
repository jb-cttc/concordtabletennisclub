// Run: npm run check:usatt-coaches
// Looks up each coach listed on coaching.html in USATT's public "Find a Coach"
// directory (coaches.usatt.org, a JustGo widget) and rewrites the coach table on the
// page: "USATT Certification Active" when the coach is listed with a coaching level,
// otherwise "USATT Certification Pending". Only Active coaches are shown, plus any
// Pending coach named in "showWhilePending" in data/coach-certifications.json (that
// exception ends once the coach is certified). A hidden coach stays in that file with
// "hidden": true and their contact cell, keeps being checked, and is put back on the
// page in their old place once USATT lists them as certified. To add a coach, add a
// row to coaching.html; to drop one for good, delete their row (and, if hidden, their
// entry in the data file). If the directory can't be read, nothing changes.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'coaching.html');
const DATA = path.join(ROOT, 'data', 'coach-certifications.json');

const ENDPOINT = 'https://usatt.justgo.com/WidgetService.mvc/ExecuteWidgetCommandAlt';
const WEBLET_ID = '8f3b7777-941e-fc44-1782-953221e70f22';
const MIN_DIRECTORY_SIZE = 50; // a smaller list means the directory misbehaved, not that coaches left

const ACTIVE = 'USATT Certification Active';
const PENDING = 'USATT Certification Pending';

function tokens(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
}

// "Fuqun (Bill) Xing" -> given names [fuqun, bill], family name xing.
function parseCoachName(display) {
  const given = [];
  const nicknames = (display.match(/\(([^)]*)\)/g) || []).map(function (m) { return tokens(m); });
  const plain = tokens(display.replace(/\([^)]*\)/g, ' '));
  const family = plain[plain.length - 1];
  plain.slice(0, -1).forEach(function (t) { given.push(t); });
  nicknames.forEach(function (list) { list.forEach(function (t) { given.push(t); }); });
  return { given: given, family: family };
}

// A directory entry matches when it contains the family name and one of the given names
// (or nicknames), in either order, so "Zeng Xiaoyun" matches "Tom (Xiaoyun) Zeng".
function matchesCoach(display, directoryName) {
  const coach = parseCoachName(display);
  const have = new Set(tokens(directoryName));
  return Boolean(coach.family) && have.has(coach.family) &&
    coach.given.some(function (g) { return have.has(g); });
}

function hasCoachingLevel(qualifications) {
  return (qualifications || []).some(function (q) { return /coaching level/i.test(q); });
}

async function call(args) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: { commands: [{ Id: 1, Service: 'GDE', Method: 'FetchObjectsPublic', Arguments: ['Weblet', Object.assign({ Area: 'Coach', WebletId: WEBLET_ID }, args)] }] }, paths: ['commands'] })
  });
  if (!res.ok) throw new Error('USATT directory returned HTTP ' + res.status);
  const body = await res.json();
  const out = body[0] && body[0].Result;
  if (!out || !out.Success) throw new Error('USATT directory returned an error');
  return out.Result;
}

async function fetchDirectory() {
  const result = await call({ Method: 'GetFilterData', Distance: '', DistanceUnit: 'Mile', SortBy: 'relevant', Latlng: '', OrderBy: 'asc', PageNumber: 1, NumberOfRows: 1000, KeySearch: '' });
  if (!result || !Array.isArray(result.Data) || result.Data.length < MIN_DIRECTORY_SIZE || result.Data.length !== result.Count) {
    throw new Error('USATT directory list looks incomplete (' + (result && result.Data ? result.Data.length : 0) + ' of ' + (result && result.Count) + ')');
  }
  return result.Data;
}

// Coach rows on the page, in order: { name, contact } (contact is the cell's inner HTML).
function readRows(html) {
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html);
  if (!body) throw new Error('coaching.html: coach table not found');
  return (body[1].match(/<tr>[\s\S]*?<\/tr>/g) || []).map(function (row) {
    const cells = [];
    row.replace(/<td>([\s\S]*?)<\/td>/g, function (m, inner) { cells.push(inner.trim()); return m; });
    return { name: cells[0], contact: cells[1] || '' };
  });
}

function readCoaches(html) {
  return readRows(html).map(function (r) { return r.name; });
}

function statusCell(status) {
  return '<td class="usatt-status" data-usatt="' + (status === ACTIVE ? 'active' : 'pending') + '">' + status + '</td>';
}

// Every coach the check follows: the rows on the page plus coaches it hid earlier for being
// Pending (kept in data with "hidden": true). A hidden coach goes back to its old place in the
// list. A coach someone deletes from the page who was not hidden is dropped for good.
function roster(html, data) {
  const prev = (data && data.coaches) || {};
  const list = readRows(html);
  const onPage = new Set(list.map(function (r) { return r.name; }));
  const prevNames = Object.keys(prev);
  prevNames.forEach(function (name, i) {
    if (onPage.has(name) || !prev[name].hidden) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = list.findIndex(function (r) { return r.name === prevNames[j]; });
      if (k >= 0) { at = k + 1; break; }
    }
    list.splice(at, 0, { name: name, contact: prev[name].contact || '' });
  });
  return list;
}

// Shown on the page: Active coaches, and Pending coaches named in showWhilePending.
function isShown(name, status, showWhilePending) {
  return status === ACTIVE || (showWhilePending || []).indexOf(name) >= 0;
}

// Rebuilds the coach table and the data record from the roster and fresh statuses.
// statuses: { name: { status, level } }.
function applyStatuses(html, data, statuses) {
  const list = roster(html, data);
  const allow = ((data && data.showWhilePending) || []).filter(function (name) {
    // The exception ends once the coach is certified: a later lapse hides them like anyone else.
    return !statuses[name] || statuses[name].status !== ACTIVE;
  });
  const record = {};
  const rows = [];
  list.forEach(function (r) {
    const s = statuses[r.name] || (data && data.coaches && data.coaches[r.name]) || { status: PENDING, level: null };
    const entry = { status: s.status, level: s.level || null };
    if (isShown(r.name, s.status, allow)) {
      rows.push('      <tr>\n        <td>' + r.name + '</td>\n        <td>' + r.contact + '</td>\n        ' + statusCell(s.status) + '\n      </tr>');
    } else {
      entry.hidden = true;
      entry.contact = r.contact;
    }
    record[r.name] = entry;
  });
  const page = html.replace(/<tbody>[\s\S]*?<\/tbody>/, '<tbody>\n' + rows.join('\n') + '\n    </tbody>')
    .replace(/(<th>Contact<\/th>)(\s*<th>USATT<\/th>)?/, '$1\n        <th>USATT</th>');
  return { html: page, data: { source: 'https://coaches.usatt.org/', showWhilePending: allow, coaches: record } };
}

function readData() {
  return fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA, 'utf8')) : {};
}

async function main() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const data = readData();
  const coaches = roster(html, data).map(function (r) { return r.name; });
  const directory = await fetchDirectory();

  const statuses = {};
  for (const coach of coaches) {
    const hits = directory.filter(function (d) { return matchesCoach(coach, d.Name); });
    let level = null;
    for (const hit of hits) {
      const details = await call({ Method: 'GetDetails', SyncGuid: hit.SyncGuid });
      if (hasCoachingLevel(details.Qualifications)) { level = details.Qualifications.filter(function (q) { return /coaching level/i.test(q); }).join(', '); break; }
    }
    statuses[coach] = { status: level ? ACTIVE : PENDING, level: level };
  }

  const out = applyStatuses(html, data, statuses);
  coaches.forEach(function (coach) {
    const r = out.data.coaches[coach];
    console.log(coach + ': ' + r.status + (r.level ? ' (' + r.level + ')' : '') + (r.hidden ? ', hidden from the page' : ''));
  });
  if (out.html !== html) fs.writeFileSync(PAGE, out.html);
  const json = JSON.stringify(out.data, null, 2) + '\n';
  if (!fs.existsSync(DATA) || fs.readFileSync(DATA, 'utf8') !== json) fs.writeFileSync(DATA, json);
}

module.exports = { parseCoachName, matchesCoach, hasCoachingLevel, readRows, readCoaches, roster, applyStatuses, ACTIVE, PENDING };

if (require.main === module) {
  main().catch(function (err) {
    // Leave the page as it was: a directory outage must never flip anyone to Pending.
    console.error('USATT coach check skipped: ' + err.message);
    process.exitCode = 1;
  });
}
