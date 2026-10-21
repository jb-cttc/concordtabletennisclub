'use strict';

// Run: npm run turnout:backtest [first-date]
// How well turnout.js would have done on past Monday and Wednesday nights, using only the nights before each one:
// of the players it called likely, how many came, and how far its expected total (expectedTotal) was from the real one.
// Use it to check LIKELY_AT and the likelihood settings against the club's own history.

const T = require('../turnout');
const roster = require('../data/session-roster.json');

const from = process.argv[2] || '2025-01-01';
const nights = Object.keys(roster).sort().filter(function (date) { return date >= from && [1, 3].includes(T.weekday(date)); });
let called = 0;
let came = 0;
let error = 0;
let bias = 0;
let counted = 0;
let wedError = 0;
let wednesdays = 0;
const bands = {};
nights.forEach(function (date) {
  const chance = T.likelihood(roster, date);
  const there = new Set(roster[date]);
  const expected = T.expectedTotal(roster, date);
  Object.keys(chance).forEach(function (name) {
    const band = Math.min(9, Math.floor(chance[name] * 10));
    bands[band] = bands[band] || { players: 0, came: 0 };
    bands[band].players += 1;
    if (there.has(name)) bands[band].came += 1;
    if (chance[name] >= T.LIKELY_AT) {
      called += 1;
      if (there.has(name)) came += 1;
    }
  });
  if (expected === null) return;
  counted += 1;
  error += Math.abs(expected - there.size);
  bias += expected - there.size;
  if (T.weekday(date) === 3) { wedError += Math.abs(expected - there.size); wednesdays += 1; }
});

const pct = function (part, whole) { return whole ? (part / whole * 100).toFixed(1) + '%' : '-'; };
console.log(nights.length + ' nights from ' + from);
console.log('Likely (score ' + T.LIKELY_AT + '+): ' + (called / nights.length).toFixed(1) + ' a night, ' + pct(came, called) + ' of them came');
console.log('Expected total: off by ' + (error / counted).toFixed(1) + ' players a night on average (' + (bias >= 0 ? '+' : '') + (bias / counted).toFixed(1) + ' bias); Wednesdays ' + (wedError / wednesdays).toFixed(1));
console.log('Score band -> share who came:');
Object.keys(bands).sort().forEach(function (band) {
  console.log('  ' + (band / 10).toFixed(1) + '-' + ((Number(band) + 1) / 10).toFixed(1) + ': ' + pct(bands[band].came, bands[band].players) + ' of ' + bands[band].players);
});
