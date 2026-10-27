// Run: npm run sheet:read -- <Tab> [--rows]
// Reads one tab of the private round-robin Google Sheet with the read-only service account the environment provides
// (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, GOOGLE_ROUND_ROBIN_DATABASE_ID). By default it prints
// only the tab's columns and how many rows it has, to confirm access; --rows prints the rows as JSON for analysis.
// The rows are real member data: keep them out of the repository, issues and chat, and report totals where you can.
// For anything more, use scripts/lib/google-sheets.js (fetchSheetRows) from a script of your own.

'use strict';

const { fetchSheetRows } = require('./lib/google-sheets');

(async () => {
  const tab = process.argv[2];
  if (!tab || tab.startsWith('--')) throw new Error('Name the tab to read, for example: npm run sheet:read -- SessionPayments');
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  const id = process.env.GOOGLE_ROUND_ROBIN_DATABASE_ID || '';
  if (!email || !key || !id) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY and GOOGLE_ROUND_ROBIN_DATABASE_ID must be set in the environment.');
  const rows = await fetchSheetRows(id, tab + '!A:Z', email, key);
  const [headers = [], ...data] = rows;
  if (process.argv.includes('--rows')) {
    console.log(JSON.stringify(data.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] === undefined ? '' : row[index]])))));
  } else {
    console.log(JSON.stringify({ tab, columns: headers, rows: data.length }));
  }
})().catch(error => {
  console.error(String(error.message || error).slice(0, 300));
  process.exit(1);
});
