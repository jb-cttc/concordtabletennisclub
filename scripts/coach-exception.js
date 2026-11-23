// Run by the data update (.github/workflows/update-data.yml) when the club asks on Coach Admin, with COACH_EXCEPTION set to
// 'offer:<coach name>' or 'end:<coach name>':
//   offer  adds the coach to "showWhilePending" in data/coach-certifications.json: the club's exception, so coaching.html
//          lists them (as USATT Certification Pending) and the coaching app offers them, while USATT has not certified them.
//          The exception ends by itself once they are certified (scripts/check-usatt-coaches.js).
//   end    takes the exception away: a Pending coach is hidden again until USATT certifies them.
// It rebuilds the page from the statuses already in the data file (no USATT call), so it works even when the USATT directory
// is down; the certification check that runs next keeps the exception. Only a coach the check already follows (on the page,
// or hidden by it) can be named; anything else changes nothing. The desk records who asked (apps-script/CoachAdmin.js), and
// the commit the workflow makes records the change.

'use strict';

const fs = require('fs');
const path = require('path');
const { roster, applyStatuses, ACTIVE } = require('./check-usatt-coaches');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'coaching.html');
const DATA = path.join(ROOT, 'data', 'coach-certifications.json');

// {html, data, message} for one request, or throws with why nothing can change.
function applyException(html, data, request) {
  const match = /^(offer|end):(.{1,80})$/.exec(String(request || '').trim());
  if (!match) throw new Error('expected offer:<coach name> or end:<coach name>');
  const action = match[1];
  const name = match[2].trim();
  if (!roster(html, data).some(function (row) { return row.name === name; })) throw new Error(name + ' is not a coach on coaching.html or hidden from it');
  const record = (data.coaches || {})[name] || {};
  const allow = (data.showWhilePending || []).filter(function (entry) { return entry !== name; });
  if (action === 'offer' && record.status !== ACTIVE) allow.push(name);
  const out = applyStatuses(html, Object.assign({}, data, { showWhilePending: allow }), {});
  const message = action === 'offer' ? (record.status === ACTIVE ? name + ' is certified, so already offered: no exception needed' : name + ' is offered while USATT certification is pending') :
    name + (record.status === ACTIVE ? ' is certified, so stays offered' : ' is no longer offered until USATT certifies them');
  return { html: out.html, data: out.data, message: message };
}

function main() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const out = applyException(html, data, process.env.COACH_EXCEPTION);
  if (out.html !== html) fs.writeFileSync(PAGE, out.html);
  const json = JSON.stringify(out.data, null, 2) + '\n';
  if (fs.readFileSync(DATA, 'utf8') !== json) fs.writeFileSync(DATA, json);
  console.log('Coach Admin: ' + out.message + '.');
}

module.exports = { applyException };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    // Nothing is written; the rest of the data update goes on.
    console.error('Coach Admin exception not applied: ' + error.message);
    process.exitCode = 1;
  }
}
