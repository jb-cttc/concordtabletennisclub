// The desk log report (scripts/desk-log.js): problems are counted, steps that should have followed a finalize are
// flagged when missing, filters work, and anything that looks like an address or a phone number is taken out.
const assert = require('node:assert/strict');
const { buildReport, parseRows, redact } = require('./desk-log');

const NOW = Date.parse('2026-10-15T12:00:00Z');
const row = (at, level, what, session, ref, detail) => [at, level, what, session || '', ref || '', detail || ''];
const values = [
  ['at', 'level', 'what', 'session', 'ref', 'detail'],
  row('2026-10-14T01:00:00.000Z', 'step', 'session_created', '2026-10-13'),
  row('2026-10-14T02:00:00.000Z', 'step', 'session_saved', '2026-10-13', '', 'revision=4 players=20 matches=40'),
  row('2026-10-14T03:00:00.000Z', 'warn', 'page: call failed', '2026-10-13', '', 'saveSessionDraft: NetworkError'),
  row('2026-10-14T04:00:00.000Z', 'step', 'session_finalized', '2026-10-13'),
  row('2026-10-14T04:15:00.000Z', 'step', 'publish_dispatched', '2026-10-13'),
  row('2026-10-15T02:00:00.000Z', 'step', 'finalize_started', '2026-10-15'),
  row('2026-10-15T03:00:00.000Z', 'error', 'finalize_failed', '2026-10-15', '9B1C2D3E', 'Service Spreadsheets timed out; mail sam@example.com or call 925-555-1234'),
  row('2026-10-15T09:00:00.000Z', 'step', 'finalize_started', '2026-10-15')
];
const rows = parseRows(values);
assert.equal(rows.length, 8);
assert.throws(() => parseRows([['at', 'what']]), /expected columns/);

const report = buildReport(rows, NOW, {});
assert.match(report, /^CTTC Desk Logs: 8 rows, 2026-10-14T01:00 to 2026-10-15T09:00 UTC/);
assert.match(report, /Last 24 hours: 1 errors, 0 warnings, 2 steps\./);
assert.match(report, /  {2}1x error finalize_failed; last: 2026-10-15 03:00:00  error  finalize_failed  2026-10-15  9B1C2D3E  Service Spreadsheets timed out; mail <address> or call <number>/);
assert.match(report, /  {2}1x warn page: call failed/);
assert.match(report, /2026-10-13: finalized 2026-10-14T04:00 UTC, but the site never confirmed the publish \(no publish_confirmed\)\./, 'a missing follow-up is flagged');
assert.match(report, /2026-10-13: finalized .* but the results email was never sent \(no email_dispatched\)\./);
assert.doesNotMatch(report, /publish was never started/, 'a follow-up that happened is not flagged');
assert.match(report, /2026-10-15: finalize started 2026-10-15T09:00 UTC and never finished or failed\./, 'a finalize that never ended is flagged');
assert.doesNotMatch(report, /finalize started 2026-10-15T02:00/, 'one that failed is not');
assert.match(report, /session_saved {6}2026-10-14 02:00 UTC  2026-10-13/);
assert.match(report, /ratings_synced {5}not in the log/);
assert.doesNotMatch(report, /@|555-1234/, 'nothing that looks like an address or a number is printed');

const one = buildReport(rows, NOW, { session: '2026-10-15', lines: 2 });
assert.match(one, /; session 2026-10-15/);
assert.match(one, /Latest 2 lines \(UTC\):\n {2}2026-10-15 03:00:00 {2}error.*\n {2}2026-10-15 09:00:00 {2}step {3}finalize_started  2026-10-15$/);
assert.doesNotMatch(one, /session_created  2026-10-13/);
const byRef = buildReport(rows, NOW, { ref: '9B1C2D3E' });
assert.match(byRef, /Latest 1 lines/);
// A reopened session is not expected to publish.
const reopened = buildReport(parseRows(values.concat([row('2026-10-14T05:00:00.000Z', 'step', 'session_reopened', '2026-10-13')])), NOW, {});
assert.doesNotMatch(reopened, /2026-10-13: finalized/);
assert.equal(redact('call (925) 555-1234 or +1 925.555.1234, mail a@b.co'), 'call <number> or +1 <number>, mail <address>');

// The turnout app's log (log: turnout) reads the same way, with its own key steps and no finalize follow-ups.
const turnoutRows = parseRows([
  ['at', 'level', 'what', 'session', 'ref', 'detail'],
  row('2026-10-15T01:00:00.000Z', 'step', 'turnout_setup', '', '', 'players=120 nights=250'),
  row('2026-10-15T09:00:00.000Z', 'step', 'text_counted', '2026-10-15', 'S0A1B2C', 'zone=1000–1199'),
  row('2026-10-15T09:01:00.000Z', 'step', 'text_skipped', '2026-10-15', 'S3D4E5F', 'latest text only asks a question'),
  row('2026-10-15T09:01:00.000Z', 'step', 'turnout_counts', '2026-10-15', '', 'phase=signup playing=1 here=0 texted=1 likely=1 expected=27'),
  row('2026-10-15T10:00:00.000Z', 'error', 'turnout_failed', '', '', 'The site answered 503 for /data/closures.json'),
  row('2026-10-15T09:30:00.000Z', 'step', 'finalize_started', '2026-10-15')
]);
const turnout = buildReport(turnoutRows, NOW, { log: 'turnout' });
assert.match(turnout, /^CTTC Turnout Logs: 6 rows/);
assert.match(turnout, /1x error turnout_failed/);
assert.match(turnout, /  text_counted {7}2026-10-15 09:00 UTC  2026-10-15/, 'its own key steps');
assert.doesNotMatch(turnout, /session_finalized|Steps that should have happened/, 'no desk follow-ups');
console.log('Desk log report checks passed');
