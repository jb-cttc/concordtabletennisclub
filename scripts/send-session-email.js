// Sends the session summary email built by build-session-email.js via
// Gmail SMTP, to the subscriber list (from a private Google Sheet, or a
// plain env var if the sheet isn't configured).
//
// Subscriber addresses are NOT stored in any committed file. This repo is
// public and data/ is deployed straight to the live site, so real email
// addresses must only ever live in a Google Sheet or a GitHub Actions
// secret, never in git history.
//
// Safe to run any time: it no-ops (exit 0) if subscribers are empty,
// credentials aren't set, or this session's summary was already sent.
//
// Setup (one-time, when ready to go live):
//   1. Enable 2-Step Verification on the sending Gmail account.
//   2. Create an App Password: https://myaccount.google.com/apppasswords
//   3. In repo Settings -> Secrets and variables -> Actions, add:
//        GMAIL_USER            the sending Gmail address
//        GMAIL_APP_PASSWORD    the 16-character app password
//
//   Then pick ONE way to supply the subscriber list:
//
//   Option A - private Google Sheet (recommended, easiest to maintain):
//     a. In Google Cloud Console (same Google account is fine), create a
//        project, enable the "Google Sheets API", then create a Service
//        Account and generate a JSON key for it.
//     b. Open the private subscribers sheet, share it with the service
//        account's email address (looks like xyz@project.iam.gserviceaccount.com)
//        as a Viewer.
//     c. Put one email address per row in a column (a header row is fine,
//        anything that isn't a valid email address is ignored).
//     d. Add repo secrets:
//          GOOGLE_SHEETS_SUBSCRIBERS_ID     the spreadsheet ID from its URL
//          GOOGLE_SERVICE_ACCOUNT_EMAIL     the service account's email
//          GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   the key's "private_key" field
//        (GOOGLE_SHEETS_SUBSCRIBERS_RANGE defaults to "Subscribers!A:A")
//
//   Option B - plain list, no sheet:
//        EMAIL_SUBSCRIBERS     recipient addresses, comma or newline separated
//
//   Testing:
//        CTTC_TEST_SEND=true   sends to the real subscriber list with "[Test] " in the
//        subject, ignores the live-start date, and skips (does not update) the
//        already-sent marker, so a test never affects the real send.
//
// Run: node scripts/send-session-email.js [date]
// (date defaults to the latest session; omit it for normal/scheduled runs, which also send the newest Equalizer's
// email once: build-equalizer-email.js, marker .cache/last-emailed-equalizer.json)
//      node scripts/send-session-email.js --equalizer [date]

'use strict';

const fs = require('fs');
const path = require('path');
const { buildSessionEmail, latestSessionDate, UNSUBSCRIBE_URL } = require('./build-session-email');
const { buildEqualizerEmail, latestEqualizerDate } = require('./build-equalizer-email');
const { sendPersonalized, LINK_MARK } = require('./lib/personalized-send');

const ROOT = path.join(__dirname, '..');
// CTTC_CACHE_DIR: another folder for the already-sent markers (the checks).
const CACHE_DIR = process.env.CTTC_CACHE_DIR || path.join(ROOT, '.cache');
const LAST_SENT_FILE = path.join(CACHE_DIR, 'last-emailed-session.json');
const LAST_EQUALIZER_FILE = path.join(CACHE_DIR, 'last-emailed-equalizer.json');
const EMAIL_PATTERN = /^[a-z0-9][a-z0-9._%+'-]{0,63}@(?:[a-z0-9-]+\.)+[a-z]{2,24}$/i;

function parseSubscribers(raw) {
  return String(raw || '')
    .split(/[,\n]/)
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

// GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY commonly arrives mangled: wrapped in
// quotes (if someone pasted the JSON field verbatim, quotes and all), or
// with literal "\n" two-character sequences instead of real newlines.
// Normalize both cases and fail with a clear message if it still doesn't
// look like a PEM key, rather than letting OpenSSL's cryptic decoder error
// surface.
function normalizePrivateKey(raw) {
  let key = String(raw || '').trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, '\n').trim();
  if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(key)) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY does not look like a PEM key. ' +
      'Paste the full "private_key" value from the service account JSON file ' +
      '(including the -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY----- lines), ' +
      'without surrounding quotes.'
    );
  }
  return key;
}

async function loadSubscribers() {
  const sheetId = process.env.GOOGLE_SHEETS_SUBSCRIBERS_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (sheetId && clientEmail && rawPrivateKey) {
    const { fetchSheetColumn } = require('./lib/google-sheets');
    const range = process.env.GOOGLE_SHEETS_SUBSCRIBERS_RANGE || 'Subscribers!A:A';
    const privateKey = normalizePrivateKey(rawPrivateKey);
    const values = await fetchSheetColumn(sheetId, range, clientEmail, privateKey);
    return values
      .map(function (v) { return String(v).trim(); })
      .filter(function (v) { return EMAIL_PATTERN.test(v); });
  }

  return parseSubscribers(process.env.EMAIL_SUBSCRIBERS);
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

// The two kinds of results email, each with its own already-sent marker so neither is sent twice: the newest round
// robin, and the newest Equalizer (build-equalizer-email.js). A date on the command line is a round robin's;
// --equalizer [date] sends only the Equalizer email.
const KINDS = {
  roundRobin: { label: 'Session', marker: LAST_SENT_FILE, latest: latestSessionDate, build: buildSessionEmail },
  equalizer: { label: 'Equalizer', marker: LAST_EQUALIZER_FILE, latest: latestEqualizerDate, build: buildEqualizerEmail }
};

async function main() {
  const args = process.argv.slice(2);
  const equalizerOnly = args[0] === '--equalizer';
  const isTest = process.env.CTTC_TEST_SEND === 'true';
  // A test send (send-test-email.yml) stays the round robin's unless --equalizer is given.
  const jobs = equalizerOnly ? [{ kind: KINDS.equalizer, date: args[1] || latestEqualizerDate() }]
    : [{ kind: KINDS.roundRobin, date: args[0] || latestSessionDate() }].concat(args[0] || isTest ? [] : [{ kind: KINDS.equalizer, date: latestEqualizerDate() }]);
  let context = null;
  for (const job of jobs) {
    context = await sendOne(job.kind, job.date, isTest, context);
    if (process.exitCode) break;
  }
  if (context && context.transporter) context.transporter.close();
}

// Sends one email to the subscriber list, unless it was already sent. context: subscribers and the mail connection,
// set up once and shared with the next email of the run.
async function sendOne(kind, date, isTest, context) {
  if (!date) {
    console.log('No ' + kind.label.toLowerCase() + ' date available; nothing to send.');
    return context;
  }
  if (!isTest && process.env.CTTC_LIVE_START_DATE && date < process.env.CTTC_LIVE_START_DATE) {
    console.log('No finalized live ' + kind.label.toLowerCase() + ' to email; skipping historical results.');
    return context;
  }
  if (!isTest) {
    const lastSent = loadJson(kind.marker, { date: null });
    if (lastSent.date === date) {
      console.log(kind.label + ' ' + date + ' was already emailed; skipping.');
      return context;
    }
  }

  if (!context) {
    const subscribers = await loadSubscribers();
    if (!subscribers.length) {
      console.log('No subscribers found (checked Google Sheet and EMAIL_SUBSCRIBERS); skipping send.');
      return { subscribers: [] };
    }
    if (isTest) console.log('TEST MODE: sending to ' + (process.env.CTTC_TEST_SCOPE === 'sender-only' ? 'the sending account only' : 'the subscriber list') + '; the already-sent marker is bypassed.');
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailUser || !gmailPass) {
      console.log('GMAIL_USER / GMAIL_APP_PASSWORD not set; skipping send. (This is expected until credentials are configured.)');
      return { subscribers: [] };
    }
    let nodemailer;
    try {
      nodemailer = require('nodemailer');
    } catch (err) {
      console.error('nodemailer is not installed. Run: npm install nodemailer');
      process.exitCode = 1;
      return null;
    }
    const secret = process.env.UNSUBSCRIBE_TOKEN_SECRET;
    if (!secret) console.log('UNSUBSCRIBE_TOKEN_SECRET is not set; every message links to the plain unsubscribe page.');
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      pool: true,
      maxConnections: 1,
      auth: { user: gmailUser, pass: gmailPass }
    });
    context = { subscribers, transporter, secret, gmailUser };
  }
  if (!context.subscribers.length) return context;

  const { subscribers, transporter, secret, gmailUser } = context;
  const template = kind.build(date, { unsubscribeUrl: LINK_MARK });
  const subject = (isTest ? '[Test] ' : '') + template.subject;
  const from = 'Concord Table Tennis Club <' + gmailUser + '>';
  const senderOnly = isTest && process.env.CTTC_TEST_SCOPE === 'sender-only';
  const recipients = senderOnly ? [gmailUser] : subscribers;
  const result = await sendPersonalized(transporter, { from, subject, template, subscribers: recipients, secret, unsubscribeUrl: UNSUBSCRIBE_URL });
  if (!result.sent) {
    console.error('No message could be sent (' + JSON.stringify(result.failures) + '); the ' + kind.label.toLowerCase() + ' stays unmarked so the next run tries again.');
    process.exitCode = 1;
    return context;
  }

  // A copy for the sender, so the club can see exactly what went out; it never carries a personal token.
  if (!senderOnly) await sendPersonalized(transporter, { from, subject, template, subscribers: [gmailUser], unsubscribeUrl: UNSUBSCRIBE_URL });

  if (!isTest) writeJson(kind.marker, { date: date, sentAt: new Date().toISOString() });
  console.log('Sent "' + template.subject + '" to ' + result.sent + ' subscriber(s)' + (isTest ? ' (test send)' : '') + '.');
  // Not a failed step: the sent marker must still be committed, or the next run would email everyone twice.
  if (result.failed) console.log('::warning::' + result.failed + ' message(s) were not delivered (' + JSON.stringify(result.failures) + ').');
  return context;
}

main().catch(function (err) {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
