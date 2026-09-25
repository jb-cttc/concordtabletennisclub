'use strict';

const path = require('node:path');
const { readDatabase, loadPublished, buildPublication } = require('./publish-finalized-sessions');

async function preflight(spreadsheetId, email, privateKey, startDate, dataDir, reader) {
  if (!spreadsheetId || !email || !privateKey || !startDate) {
    throw new Error('Preflight needs database ID, service account credentials, and CTTC_LIVE_START_DATE');
  }
  const tables = await readDatabase(spreadsheetId, email, privateKey, reader);
  const existing = await loadPublished(dataDir);
  const publication = buildPublication(existing, tables, startDate);
  return {
    startDate,
    historical: publication.details.length - publication.live.length,
    finalized: publication.live.map(function (session) {
      return { date: session.date, sessionId: session.sessionId, groups: session.groups.length };
    })
  };
}

if (require.main === module) {
  const dataDir = path.resolve(__dirname, '..', 'data');
  preflight(
    process.env.GOOGLE_ROUND_ROBIN_DATABASE_ID,
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim(),
    process.env.CTTC_LIVE_START_DATE,
    dataDir
  ).then(function (summary) {
    console.log('Read-only preflight passed:', JSON.stringify(summary));
    console.log('No files changed; no email sent.');
  }).catch(function (error) { console.error(error.message); process.exitCode = 1; });
}

module.exports = { preflight };