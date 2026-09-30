'use strict';

const fs = require('fs');
const path = require('path');
const { buildCanonicalizer, applyCanonicalNames } = require('../fetch-and-parse');

const ROOT = path.resolve(__dirname, '..', '..');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

// Access side: the raw scrape cache with canonical names and the report's own row order.
function loadAccessSessions(root) {
  const base = root || ROOT;
  const raw = readJson(path.join(base, '.cache', 'session-raw-cache.json'), []);
  const aliases = readJson(path.join(base, 'data', 'player-aliases.json'), {});
  return applyCanonicalNames(raw, buildCanonicalizer(raw, aliases), { keepReportOrder: true }).filter(function (session) {
    return !session.error && session.groups.length;
  });
}

// Desk side: sessions the site published from the closed-loop data.
function loadAppSessions(root) {
  const dataDir = path.join(root || ROOT, 'data');
  const sessions = [];
  fs.readdirSync(dataDir).filter(function (name) { return /^session-details-\d{4}\.json$/.test(name); }).forEach(function (name) {
    readJson(path.join(dataDir, name), []).forEach(function (session) {
      if (session.source === 'app') sessions.push(session);
    });
  });
  return sessions;
}

module.exports = { loadAccessSessions, loadAppSessions };
