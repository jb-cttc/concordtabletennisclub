// Prints the round-robin desk's CTTC Desk Logs tab (see apps-script/DeskLog.js) as a report: what failed, when each key
// step last happened, steps that should have followed and did not, and the latest lines. Run by the "Desk log" GitHub
// workflow, whose logs are public: the tab holds no names, addresses, numbers or payment details by design, and this
// script takes out anything that still looks like an address or a phone number before printing.
//
//   node scripts/desk-log.js [--lines 150] [--session 2026-10-14] [--ref 9B1C2D3E]
'use strict';

const fs = require('node:fs');
const { fetchSheetRows } = require('./lib/google-sheets');

const TAB = 'CTTC Desk Logs';
const HOUR = 3600 * 1000;
const KEY_STEPS = ['session_created', 'session_saved', 'session_finalized', 'publish_dispatched', 'publish_confirmed', 'email_dispatched', 'ratings_synced', 'session_reopened'];
// After a session is finalized, these should follow within the time given; a missing one is a failure nobody saw.
const FOLLOW_UPS = [
  ['publish_dispatched', 1, 'the site publish was never started'],
  ['publish_confirmed', 3, 'the site never confirmed the publish'],
  ['email_dispatched', 4, 'the results email was never sent']
];

function redact(text) {
  return String(text == null ? '' : text).replace(/\S+@\S+/g, '<address>').replace(/\+?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '<number>');
}

function parseRows(values) {
  const [header, ...rows] = values;
  if (!header || header.join('|') !== 'at|level|what|session|ref|detail') throw new Error('The ' + TAB + ' tab does not have the expected columns');
  return rows.map(row => ({ at: row[0] || '', level: row[1] || '', what: row[2] || '', session: row[3] || '', ref: row[4] || '', detail: row[5] || '' }))
    .filter(row => row.at);
}

function line(row) {
  return [row.at.replace('T', ' ').slice(0, 19), row.level.padEnd(5), row.what, row.session, row.ref, redact(row.detail)].filter(Boolean).join('  ');
}

function buildReport(rows, now, options) {
  options = options || {};
  const out = [];
  const time = row => Date.parse(row.at);
  let shown = rows;
  if (options.session) shown = shown.filter(row => row.session === options.session);
  if (options.ref) shown = shown.filter(row => row.ref === options.ref);
  out.push('CTTC Desk Logs: ' + rows.length + ' rows' + (rows.length ? ', ' + rows[0].at.slice(0, 16) + ' to ' + rows[rows.length - 1].at.slice(0, 16) + ' UTC' : '') +
    (options.session ? '; session ' + options.session : '') + (options.ref ? '; reference ' + options.ref : ''));

  const recent = shown.filter(row => now - time(row) < 7 * 24 * HOUR);
  const problems = {};
  recent.filter(row => row.level === 'error' || row.level === 'warn').forEach(row => {
    const key = row.level + ' ' + row.what;
    problems[key] = problems[key] || { count: 0, last: null };
    problems[key].count += 1;
    problems[key].last = row;
  });
  const lastDay = level => shown.filter(row => row.level === level && now - time(row) < 24 * HOUR).length;
  out.push('', 'Last 24 hours: ' + lastDay('error') + ' errors, ' + lastDay('warn') + ' warnings, ' + lastDay('step') + ' steps.');
  out.push('', 'Problems in the last 7 days:');
  const keys = Object.keys(problems).sort((a, b) => problems[b].count - problems[a].count);
  if (!keys.length) out.push('  none');
  keys.forEach(key => out.push('  ' + String(problems[key].count).padStart(3) + 'x ' + key + '; last: ' + line(problems[key].last)));

  // Steps that should have followed a finalize and did not.
  const missing = [];
  shown.filter(row => row.what === 'session_finalized' && now - time(row) < 14 * 24 * HOUR).forEach(done => {
    const later = rows.filter(row => row.session === done.session && time(row) >= time(done));
    if (later.some(row => row.what === 'session_reopened')) return;
    FOLLOW_UPS.forEach(([what, hours, problem]) => {
      if (now - time(done) > hours * HOUR && !later.some(row => row.what === what)) missing.push(done.session + ': finalized ' + done.at.slice(0, 16) + ' UTC, but ' + problem + ' (no ' + what + ').');
    });
  });
  shown.filter(row => row.what === 'finalize_started').forEach(start => {
    const after = rows.filter(row => row.session === start.session && time(row) >= time(start));
    if (now - time(start) > HOUR && !after.some(row => row.what === 'session_finalized' || row.what === 'finalize_failed')) {
      missing.push(start.session + ': finalize started ' + start.at.slice(0, 16) + ' UTC and never finished or failed.');
    }
  });
  out.push('', 'Steps that should have happened and did not:');
  out.push(...(missing.length ? missing.map(text => '  ' + text) : ['  none']));

  out.push('', 'Last time each key step happened:');
  KEY_STEPS.forEach(what => {
    const last = shown.filter(row => row.what === what).pop();
    out.push('  ' + what.padEnd(19) + (last ? last.at.replace('T', ' ').slice(0, 16) + ' UTC' + (last.session ? '  ' + last.session : '') : 'not in the log'));
  });

  const count = options.lines || 150;
  out.push('', 'Latest ' + Math.min(count, shown.length) + ' lines (UTC):');
  shown.slice(-count).forEach(row => out.push('  ' + line(row)));
  return out.join('\n');
}

function option(args, name) {
  const index = args.indexOf('--' + name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    lines: Number(option(args, 'lines')) || 150,
    session: /^\d{4}-\d{2}-\d{2}$/.test(option(args, 'session') || '') ? option(args, 'session') : '',
    ref: /^[0-9A-F]{6,8}$/i.test(option(args, 'ref') || '') ? option(args, 'ref').toUpperCase() : ''
  };
  const id = process.env.GOOGLE_ROUND_ROBIN_DATABASE_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!id || !email || !key) throw new Error('Reading the desk log needs the round-robin database id and the service account credentials');
  let values;
  try {
    values = await fetchSheetRows(id, "'" + TAB + "'!A:F", email, key);
  } catch (error) {
    // No tab yet means nothing has been logged yet: that is not a failure, and must not email anyone.
    if (/Unable to parse range/i.test(error.message)) values = [['at', 'level', 'what', 'session', 'ref', 'detail']];
    else {
      // The API's own message is not printed: it can name the Sheet.
      const status = /HTTP (\d+)/.exec(error.message);
      throw new Error('Could not read the ' + TAB + ' tab' + (status ? ' (HTTP ' + status[1] + ')' : '') + '. Check that the service account can still view the round-robin Sheet.');
    }
  }
  const rows = parseRows(values);
  if (!rows.length) {
    const empty = 'CTTC Desk Logs: nothing logged yet. The desk makes the tab, and starts logging, with its first save, finalize or problem.';
    console.log(empty);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, empty + '\n');
    return;
  }
  const report = buildReport(rows, Date.now(), options);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + report + '\n```\n');
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { buildReport, parseRows, redact };
