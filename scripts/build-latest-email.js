// Writes data/latest-session-email.json: the most recent session's results email without the unsubscribe footer.
// The sign-up app (subscribe-app/) fetches it from the public site to include in its welcome email, so the
// layout stays defined in one place (build-session-email.js). It holds only what the public site already shows.
'use strict';

const fs = require('fs');
const path = require('path');
const { buildSessionEmail, latestSessionDate } = require('./build-session-email');

const OUTPUT = path.join(__dirname, '..', 'data', 'latest-session-email.json');

function buildLatestEmail() {
  const date = latestSessionDate();
  if (!date) throw new Error('No latest session date is available.');
  const email = buildSessionEmail(date, { footer: false });
  return { date: date, subject: email.subject, html: email.html, text: email.text };
}

module.exports = { buildLatestEmail };

if (require.main === module) {
  const latest = buildLatestEmail();
  fs.writeFileSync(OUTPUT, JSON.stringify(latest) + '\n');
  console.log('Wrote ' + path.relative(process.cwd(), OUTPUT) + ' for ' + latest.date);
}
