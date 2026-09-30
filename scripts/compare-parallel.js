// Run: npm run compare:parallel [-- --since YYYY-MM-DD] [--date YYYY-MM-DD] [--out local/parallel]
// Admin only. Compares the Access reports (scraped, never published) with the sessions the desk
// finalized and the site published, then writes local/parallel/report.html and report.json.
// Pull the latest main first: the scheduled workflow commits both sides of the comparison.

'use strict';

const fs = require('fs');
const path = require('path');
const { loadAccessSessions, loadAppSessions } = require('./lib/parallel-load');
const { compareSessions, summarize } = require('./lib/parallel-compare');
const { LABELS, renderHtml } = require('./lib/parallel-report');

const ROOT = path.resolve(__dirname, '..');

function argument(name) {
  const index = process.argv.indexOf('--' + name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const appSessions = loadAppSessions();
const only = argument('date');
const since = only || argument('since') || process.env.CTTC_LIVE_START_DATE ||
  (appSessions.length ? appSessions.map(function (session) { return session.date; }).sort()[0] : undefined);
if (!appSessions.length) {
  console.log('No desk-finalized sessions are published yet, so there is nothing to compare.');
  process.exit(0);
}

let results = compareSessions(loadAccessSessions(), appSessions, { since: since });
if (only) results = results.filter(function (result) { return result.date === only; });
const counts = summarize(results);

results.forEach(function (result) {
  console.log(result.date + '  ' + LABELS[result.status] + (result.note ? ' (' + result.note + ')' : ''));
  result.findings.forEach(function (item) {
    console.log('    [' + item.level + '] ' + item.code + ' ' + item.group + ': ' + item.detail);
  });
});
console.log('\nSame: ' + counts.same + '  Expected: ' + counts.expected + '  Review: ' + counts.review + '  Waiting: ' + counts.pending);

const outDir = path.resolve(ROOT, argument('out') || path.join('local', 'parallel'));
fs.mkdirSync(outDir, { recursive: true });
const meta = { generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', since: since };
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ meta: meta, counts: counts, results: results }, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'report.html'), renderHtml(results, counts, meta));
console.log('Report: ' + path.relative(ROOT, path.join(outDir, 'report.html')));
process.exitCode = counts.review ? 1 : 0;
