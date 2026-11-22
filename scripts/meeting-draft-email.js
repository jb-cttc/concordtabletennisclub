'use strict';

// The executive committee's DRAFT NOTES email: after a meeting, a summary for the secretary to review and send on.
//
//   npm run meeting:draft -- fetch   --out <dir>                       the meeting on screen in the meeting app, as
//                                                                      <dir>/meeting.json (read only)
//   npm run meeting:draft -- preview --dir <dir>                        <dir>/draft.html and draft.txt from
//                                                                      meeting.json and summary.json (written by hand)
//   npm run meeting:draft -- send    --dir <dir> [--resend]             sends that draft to summary.to through the
//                                                                      meeting mailer (meeting-mailer/), from the club
//                                                                      account, subject "[DRAFT NOTES] ..."
//
// summary.json is the part written for each meeting: the note to the secretary, decisions, what was said on each
// item, the follow-ups cleaned up, open questions (scripts/lib/meeting-email.js lists its fields). Meeting records
// name members: <dir> must be outside the repository, and its files are deleted once the draft is sent.
// Steps: docs/meeting-app.md, "Draft notes for the secretary".

const fs = require('fs');
const path = require('path');
const { callApp } = require('./lib/apps-script-call');
const email = require('./lib/meeting-email');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const command = args[0];
const option = name => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : ''; };
const outside = dir => {
  const full = path.resolve(dir || '');
  if (!dir) throw new Error('Give --dir (or --out): a folder outside the repository.');
  if (full === ROOT || full.startsWith(ROOT + path.sep)) throw new Error('Meeting records name members: use a folder outside the repository.');
  return full;
};
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function build(dir) {
  const meeting = readJson(path.join(dir, 'meeting.json'));
  const summary = readJson(path.join(dir, 'summary.json'));
  if (!summary.to || !/@/.test(summary.to.email || '') || !summary.to.name) throw new Error('summary.json needs to: { name, email }.');
  if (!summary.trackerUrl) throw new Error('summary.json needs trackerUrl.');
  if ((summary.agenda || []).length > (meeting.items || []).length) throw new Error('summary.json has more agenda entries than the meeting has items.');
  return { meeting, summary, subject: email.subject(meeting), html: email.html(meeting, summary), text: email.text(meeting, summary) };
}

(async () => {
  if (command === 'fetch') {
    const dir = outside(option('out'));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const state = await callApp({ dir: 'meeting-app', query: '?view=board', marker: '#b-main', fn: 'getState' });
    if (!state.meeting) throw new Error('No meeting is on screen in the meeting app.');
    fs.writeFileSync(path.join(dir, 'meeting.json'), JSON.stringify(state.meeting, null, 1), { mode: 0o600 });
    const m = state.meeting;
    console.log(JSON.stringify({ meeting: m.id, title: m.title, date: m.date, items: m.items.length, followUps: m.actions.length, attendees: m.attendees.length, file: path.join(dir, 'meeting.json') }, null, 1));
  } else if (command === 'preview') {
    const dir = outside(option('dir'));
    const draft = build(dir);
    fs.writeFileSync(path.join(dir, 'draft.html'), draft.html, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, 'draft.txt'), draft.text, { mode: 0o600 });
    console.log(JSON.stringify({ subject: draft.subject, to: draft.summary.to.email, html: path.join(dir, 'draft.html'), text: path.join(dir, 'draft.txt'), followUps: (draft.summary.followUps || []).length }, null, 1));
  } else if (command === 'send') {
    const dir = outside(option('dir'));
    const draft = build(dir);
    const result = await callApp({ dir: 'meeting-mailer', marker: '#ready', fn: 'sendDraftNotes', args: [{ to: [draft.summary.to.email], subject: draft.subject, html: draft.html, text: draft.text, meetingId: draft.meeting.id, resend: args.includes('--resend') }] });
    console.log(JSON.stringify(result, null, 1));
  } else {
    console.error('Use: npm run meeting:draft -- fetch --out <dir> | preview --dir <dir> | send --dir <dir> [--resend]');
    process.exit(2);
  }
})().catch(error => { console.error(String(error.message || error)); process.exit(1); });
