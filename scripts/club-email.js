'use strict';

// A short club message from the club account (a coaching update for a coach, say), sent only when the owner asks.
//
//   npm run club:email -- preview --dir <dir>             <dir>/email.html and email.txt from <dir>/message.json
//   npm run club:email -- send    --dir <dir> [--resend]  sends it through the meeting mailer (meeting-mailer/,
//                                                         sendClubMessage), subject "[CTTC] ...", with a copy (Cc) to
//                                                         the club account, always
//
// message.json is written by hand (fields: scripts/lib/club-email.js). It names people and their addresses: <dir> must be
// outside the repository, and its files are deleted once the message is sent. Steps: docs/meeting-app.md, "Club messages".

const fs = require('fs');
const path = require('path');
const { callApp, accountEmail } = require('./lib/apps-script-call');
const email = require('./lib/club-email');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const command = args[0];
const option = name => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : ''; };
const outside = dir => {
  const full = path.resolve(dir || '');
  if (!dir) throw new Error('Give --dir: a folder outside the repository.');
  if (full === ROOT || full.startsWith(ROOT + path.sep)) throw new Error('A message names people: use a folder outside the repository.');
  return full;
};

function build(dir) {
  const message = JSON.parse(fs.readFileSync(path.join(dir, 'message.json'), 'utf8'));
  return { message, subject: email.subject(message), html: email.html(message), text: email.text(message) };
}

(async () => {
  if (command === 'preview') {
    const dir = outside(option('dir'));
    const built = build(dir);
    fs.writeFileSync(path.join(dir, 'email.html'), built.html, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, 'email.txt'), built.text, { mode: 0o600 });
    console.log(JSON.stringify({ subject: built.subject, to: built.message.to.map(person => person.email), html: path.join(dir, 'email.html'), text: path.join(dir, 'email.txt') }, null, 1));
  } else if (command === 'send') {
    const dir = outside(option('dir'));
    const built = build(dir);
    // The club account, from its own sign-in: every message is copied there, so the club sees everything sent.
    const club = await accountEmail();
    const result = await callApp({ dir: 'meeting-mailer', marker: '#ready', fn: 'sendClubMessage',
      args: [{ to: built.message.to.map(person => person.email), copy: [club], subject: built.subject, html: built.html, text: built.text, resend: args.includes('--resend') }] });
    console.log(JSON.stringify(result, null, 1));
  } else {
    console.error('Use: npm run club:email -- preview --dir <dir> | send --dir <dir> [--resend]');
    process.exit(2);
  }
})().catch(error => { console.error(String(error.message || error)); process.exit(1); });
