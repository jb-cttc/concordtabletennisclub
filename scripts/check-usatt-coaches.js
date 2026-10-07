// Run: npm run check:usatt-coaches
// Looks up each coach listed on coaching.html in USATT's public "Find a Coach"
// directory (coaches.usatt.org, a JustGo widget) and rewrites the status column on
// the page: "USATT Certification Active" when the coach is listed with a coaching
// level, otherwise "USATT Certification Pending". Also writes
// data/coach-certifications.json. If the directory can't be read, nothing changes.

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

function readCoaches(html) {
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html);
  if (!body) throw new Error('coaching.html: coach table not found');
  return (body[1].match(/<tr>[\s\S]*?<\/tr>/g) || []).map(function (row) {
    return /<td>([^<]+)<\/td>/.exec(row)[1].trim();
  });
}

function statusCell(status) {
  return '<td class="usatt-status" data-usatt="' + (status === ACTIVE ? 'active' : 'pending') + '">' + status + '</td>';
}

function rewriteTable(html, statuses) {
  return html.replace(/<tr>([\s\S]*?)<\/tr>/g, function (row, inner) {
    const name = /<td>([^<]+)<\/td>/.exec(inner);
    if (!name || !(name[1].trim() in statuses)) return row;
    const cells = inner.replace(/\s*<td class="usatt-status"[^>]*>[^<]*<\/td>/, '').replace(/\s+$/, '');
    return '<tr>' + cells + '\n        ' + statusCell(statuses[name[1].trim()]) + '\n      </tr>';
  }).replace(/(<th>Contact<\/th>)(\s*<th>USATT<\/th>)?/, '$1\n        <th>USATT</th>');
}

async function main() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const coaches = readCoaches(html);
  const directory = await fetchDirectory();

  const statuses = {};
  const record = {};
  for (const coach of coaches) {
    const hits = directory.filter(function (d) { return matchesCoach(coach, d.Name); });
    let level = null;
    for (const hit of hits) {
      const details = await call({ Method: 'GetDetails', SyncGuid: hit.SyncGuid });
      if (hasCoachingLevel(details.Qualifications)) { level = details.Qualifications.filter(function (q) { return /coaching level/i.test(q); }).join(', '); break; }
    }
    statuses[coach] = level ? ACTIVE : PENDING;
    record[coach] = { status: statuses[coach], level: level };
    console.log(coach + ': ' + statuses[coach] + (level ? ' (' + level + ')' : ''));
  }

  const next = rewriteTable(html, statuses);
  if (next !== html) fs.writeFileSync(PAGE, next);
  const json = JSON.stringify({ source: 'https://coaches.usatt.org/', coaches: record }, null, 2) + '\n';
  if (!fs.existsSync(DATA) || fs.readFileSync(DATA, 'utf8') !== json) fs.writeFileSync(DATA, json);
}

module.exports = { parseCoachName, matchesCoach, hasCoachingLevel, readCoaches, rewriteTable, ACTIVE, PENDING };

if (require.main === module) {
  main().catch(function (err) {
    // Leave the page as it was: a directory outage must never flip anyone to Pending.
    console.error('USATT coach check skipped: ' + err.message);
    process.exitCode = 1;
  });
}
