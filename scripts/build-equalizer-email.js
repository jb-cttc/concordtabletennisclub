// Builds the results email for a published Equalizer (data/session-details-YYYY.json, variant "equalizer", written by
// scripts/lib/finalized-equalizer.js): the champion and the Final, the places, the group winners (RR -> Finals), the
// biggest upset, the biggest EQ rating movers, and the totals. Same look as the round robin email
// (build-session-email.js).
//
// Usage:
//   node scripts/build-equalizer-email.js             # latest published Equalizer, writes a preview
//   node scripts/build-equalizer-email.js 2026-11-07  # a specific date
//
// No network or email here: it returns { subject, html, text }. scripts/send-session-email.js mails it.

'use strict';

const fs = require('fs');
const path = require('path');
const { sortByGroupResult, describeWinner } = require('../standings');

const ROOT = path.join(__dirname, '..');
// CTTC_DATA_DIR: another data folder (the checks' simulated publications).
const DATA_DIR = process.env.CTTC_DATA_DIR || path.join(ROOT, 'data');
const SITE_URL = 'https://concordtabletennisclub.com';
const UNSUBSCRIBE_URL = SITE_URL + '/unsubscribe.html';
// The two-ratings explainer goes in the first few Equalizer emails, while the EQ rating is new.
const EXPLAIN_FOR_FIRST = 3;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return DAYS[new Date(y, m - 1, d).getDay()] + ', ' + MONTHS[m - 1] + ' ' + d + ', ' + y;
}

// Every published Equalizer, oldest first.
function publishedEqualizers(dataDir) {
  const dir = dataDir || DATA_DIR;
  return fs.readdirSync(dir).filter(function (name) { return /^session-details-\d{4}\.json$/.test(name); }).sort()
    .reduce(function (all, name) { return all.concat(loadJson(path.join(dir, name), [])); }, [])
    .filter(function (session) { return session.variant === 'equalizer'; })
    .sort(function (a, b) { return a.date.localeCompare(b.date); });
}

function latestEqualizerDate(dataDir) {
  const all = publishedEqualizers(dataDir);
  return all.length ? all[all.length - 1].date : null;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function signed(n) { return n > 0 ? '+' + n : String(n); }
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function placeText(place) { return ordinal(place.place) + (place.to > place.place ? '–' + ordinal(place.to) : ''); }
function sideName(names) { return names.join(' & '); }

// Group tables from the published group matches, ranked by the club's round robin rules (as equalizer.js does).
function groupWinners(eq) {
  const ratingOf = {};
  eq.sides.forEach(function (side) { ratingOf[sideName(side.names)] = side.rating; });
  const groups = {};
  eq.matches.filter(function (m) { return m.stage === 'G'; }).forEach(function (m) {
    const number = Number(/^G(\d+)-/.exec(m.id)[1]);
    const rows = groups[number] = groups[number] || {};
    const names = m.sides.map(sideName);
    names.forEach(function (name) { rows[name] = rows[name] || { name: name, ratingBefore: ratingOf[name], matches: [] }; });
    const forfeitedBy = m.forfeit ? names[1 - m.winner] : '';
    [0, 1].forEach(function (i) {
      rows[names[i]].matches.push({ opponent: names[1 - i], gamesWon: m.forfeit ? 0 : m.games[i], gamesLost: m.forfeit ? 0 : m.games[1 - i], forfeitedBy: forfeitedBy });
    });
  });
  return Object.keys(groups).map(Number).sort(function (a, b) { return a - b; }).map(function (number) {
    const rows = Object.keys(groups[number]).map(function (name) { return groups[number][name]; });
    const winner = sortByGroupResult(rows)[0];
    const described = describeWinner(rows);
    let wins = 0;
    let losses = 0;
    winner.matches.forEach(function (m) {
      const won = m.forfeitedBy ? m.forfeitedBy !== winner.name : m.gamesWon > m.gamesLost;
      if (won) wins += 1; else losses += 1;
    });
    return { group: 'Group ' + number, name: winner.name, wins: wins, losses: losses, note: described ? described.text : null };
  });
}

// The biggest win by the side with the head start: the widest rating gap overcome.
function upset(eq) {
  const ratingOf = {};
  eq.sides.forEach(function (side) { ratingOf[sideName(side.names)] = side.rating; });
  let best = null;
  eq.matches.forEach(function (m) {
    if (m.forfeit || !m.headStart || m.headStart.side !== m.winner) return;
    const winner = sideName(m.sides[m.winner]);
    const loser = sideName(m.sides[1 - m.winner]);
    const gap = ratingOf[loser] - ratingOf[winner];
    if (!best || gap > best.gap) best = { gap: gap, winner: winner, loser: loser, winnerRating: ratingOf[winner], loserRating: ratingOf[loser], games: m.games[m.winner] + '–' + m.games[1 - m.winner], points: m.headStart.points };
  });
  return best && best.gap > 0 ? best : null;
}

function movers(players, count) {
  const moved = players.filter(function (p) { return typeof p.ratingAdj === 'number'; });
  return {
    gainers: moved.filter(function (p) { return p.ratingAdj > 0; }).sort(function (a, b) { return b.ratingAdj - a.ratingAdj || a.name.localeCompare(b.name); }).slice(0, count),
    losers: moved.filter(function (p) { return p.ratingAdj < 0; }).sort(function (a, b) { return a.ratingAdj - b.ratingAdj || a.name.localeCompare(b.name); }).slice(0, count)
  };
}

function summarize(session, options) {
  const eq = session.equalizer;
  const players = session.groups[0].players;
  const final = eq.matches.filter(function (m) { return m.stage !== 'G'; }).pop() || null;
  const champion = sideName(eq.champion || []);
  const runnerUp = final ? sideName(final.sides[1 - final.winner]) : '';
  const standings = eq.sides.filter(function (side) { return side.place && side.place.place <= 5; })
    .sort(function (a, b) { return a.place.place - b.place.place; })
    .reduce(function (rows, side) {
      const last = rows[rows.length - 1];
      if (last && last.place.place === side.place.place) last.names.push(sideName(side.names));
      else rows.push({ place: side.place, names: [sideName(side.names)] });
      return rows;
    }, []);
  const groups = eq.format === 'groups' ? groupWinners(eq) : [];
  const forfeits = eq.matches.filter(function (m) { return m.forfeit; }).length;
  return {
    date: session.date,
    format: eq.format,
    champion: champion,
    final: final && !final.forfeit ? { runnerUp: runnerUp, games: final.games[final.winner] + '–' + final.games[1 - final.winner] } : final ? { runnerUp: runnerUp, forfeit: true } : null,
    standings: standings,
    groups: groups,
    upset: upset(eq),
    movers: movers(players, (options && options.moverCount) || 3),
    totals: {
      players: players.length,
      groups: groups.length,
      finals: eq.format === 'groups' ? groups.length : 0,
      matches: eq.matches.length,
      forfeits: forfeits,
      bestOf: eq.bestOf,
      play: eq.play
    },
    explain: !!(options && options.explain)
  };
}

const H2 = 'font-size:1.05rem;border-bottom:1px solid #ddd8d0;padding-bottom:4px;';
const TABLE = 'width:100%;border-collapse:collapse;font-size:0.9rem;';

function totalsText(t, format) {
  return t.players + ' players · ' + (format === 'groups' ? t.groups + ' groups, then a Finals of ' + t.finals : 'double elimination') +
    ' · ' + t.matches + ' matches' + (t.forfeits ? ' (' + t.forfeits + ' forfeit' + (t.forfeits === 1 ? '' : 's') + ')' : '') +
    ' · best of ' + t.bestOf + ', ' + t.play;
}
// In every Equalizer email, at the top and beside the rating changes: the numbers are not official round robin ratings.
const NOT_OFFICIAL_TITLE = 'These are NOT official ratings.';
const NOT_OFFICIAL = 'Every rating and rating change in this email is an Equalizer (EQ) rating: an experimental copy kept separately for this game variant only. Your official round robin rating is not affected by the Equalizer and is not shown here.';
const EXPLAINER = 'New: your Equalizer rating. The Equalizer has its own rating. Everyone’s started as a copy of their round robin rating at their first Equalizer, and from then on only Equalizers move it. Your round robin rating does not change in an Equalizer. Each match is worth 8 EQ points; forfeits move none.';

function buildHtml(s, footer, unsubscribeUrl) {
  const winnerLine = s.champion ? '<p style="font-size:0.95rem;background:#fbf6e6;border-left:3px solid #c99934;padding:10px 12px;margin:0 0 20px;">🏆 <strong>' + escapeHtml(s.champion) + '</strong> wins the Equalizer' +
    (s.final ? (s.final.forfeit ? ' (the Final was a forfeit)' : ', beating <strong>' + escapeHtml(s.final.runnerUp) + '</strong> ' + s.final.games + ' in the Final') : '') + '.</p>' : '';
  const standings = s.standings.map(function (row) {
    return '<tr><td style="padding:6px 12px 6px 0;color:#666;width:70px;">' + placeText(row.place) + '</td><td style="padding:6px 0;' + (row.place.place === 1 ? 'font-weight:bold;' : '') + '">' + (row.place.place === 1 ? '🏆 ' : '') + escapeHtml(row.names.join(', ')) + '</td></tr>';
  }).join('');
  const groups = s.groups.map(function (g) {
    return '<tr><td style="padding:6px 12px 6px 0;color:#666;">' + escapeHtml(g.group) + '</td><td style="padding:6px 12px 6px 0;font-weight:bold;">' + escapeHtml(g.name) + (g.note ? '†' : '') + '</td><td style="padding:6px 0;text-align:right;color:#666;">' + g.wins + '-' + g.losses + '</td></tr>' +
      (g.note ? '<tr><td></td><td colspan="2" style="padding:0 0 6px;font-size:0.78rem;color:#666;">† ' + escapeHtml(g.note) + '</td></tr>' : '');
  }).join('');
  function moverRows(list, arrow, color) {
    if (!list.length) return '<tr><td style="padding:4px 0;color:#666;">None</td></tr>';
    return list.map(function (p) {
      return '<tr><td style="padding:4px 12px 4px 0;">' + arrow + ' ' + escapeHtml(p.name) + '</td><td style="padding:4px 0;text-align:right;color:' + color + ';font-weight:bold;">' + signed(p.ratingAdj) + '</td></tr>';
    }).join('');
  }
  return '' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;max-width:560px;margin:0 auto;color:#1a1a1a;">' +
    '<h1 style="color:#8B1A1A;font-size:1.3rem;margin:0 0 4px;">Concord Table Tennis Club</h1>' +
    '<p style="color:#666;margin:0 0 16px;font-size:0.95rem;">' + escapeHtml(formatDate(s.date)) + ' · The Equalizer</p>' +
    '<p style="font-size:0.9rem;border:2px solid #8B1A1A;background:#fdf3f3;color:#1a1a1a;padding:10px 12px;margin:0 0 20px;"><strong style="color:#8B1A1A;">' + escapeHtml(NOT_OFFICIAL_TITLE) + '</strong> ' + escapeHtml(NOT_OFFICIAL) + '</p>' +
    winnerLine +
    (standings ? '<h2 style="' + H2 + '">Final Standings</h2><table style="' + TABLE + 'margin-bottom:20px;">' + standings + '</table>' : '') +
    (groups ? '<h2 style="' + H2 + '">Group Winners</h2><table style="' + TABLE + 'margin-bottom:20px;">' + groups + '</table>' : '') +
    (s.upset ? '<h2 style="' + H2 + '">Upset of the Night</h2><p style="font-size:0.9rem;color:#333;margin:0 0 20px;">' + escapeHtml(s.upset.winner) + ' (EQ ' + s.upset.winnerRating + ') beat ' + escapeHtml(s.upset.loser) + ' (EQ ' + s.upset.loserRating + ') ' + s.upset.games + ', starting every game at ' + s.upset.points + '–0.</p>' : '') +
    '<h2 style="' + H2 + '">Biggest Equalizer Rating Changes (experimental)</h2>' +
    '<p style="font-size:0.8rem;color:#8B1A1A;margin:0 0 6px;font-weight:bold;">Experimental EQ rating only, not the official round robin rating.</p>' +
    '<table style="' + TABLE + 'margin-bottom:8px;">' + moverRows(s.movers.gainers, '⬆️', '#2a6a2a') + '</table>' +
    '<table style="' + TABLE + 'margin-bottom:' + (s.explain ? '12' : '20') + 'px;">' + moverRows(s.movers.losers, '⬇️', '#8B1A1A') + '</table>' +
    (s.explain ? '<p style="font-size:0.82rem;color:#555;margin:0 0 20px;background:#f7f9f7;padding:8px 10px;"><strong>New: your Equalizer rating.</strong> ' + escapeHtml(EXPLAINER.replace(/^New: your Equalizer rating\. /, '')) + '</p>' : '') +
    '<h2 style="' + H2 + '">Event Totals</h2><p style="font-size:0.9rem;color:#333;margin-bottom:20px;">' + escapeHtml(totalsText(s.totals, s.format)) + '</p>' +
    '<p style="font-size:0.85rem;"><a href="' + SITE_URL + '/roundrobins.html#eq-' + s.date + '" style="color:#8B1A1A;">See the groups and the Finals bracket →</a></p>' +
    '<p style="font-size:0.75rem;color:#999;margin-top:24px;">Concord Table Tennis Club &middot; Walnut Creek, CA</p>' +
    (footer ? '<p style="font-size:0.72rem;color:#999;margin-top:8px;">You are receiving this because this address subscribed to CTTC results. <a href="' + unsubscribeUrl + '" style="color:#999;">Unsubscribe</a></p>' : '') +
    '</div>';
}

function buildText(s, footer, unsubscribeUrl) {
  const lines = ['Concord Table Tennis Club - ' + formatDate(s.date) + ' - The Equalizer', '', NOT_OFFICIAL_TITLE.toUpperCase() + ' ' + NOT_OFFICIAL, ''];
  if (s.champion) lines.push(s.champion + ' wins the Equalizer' + (s.final ? (s.final.forfeit ? ' (the Final was a forfeit)' : ', beating ' + s.final.runnerUp + ' ' + s.final.games + ' in the Final') : '') + '.', '');
  if (s.standings.length) {
    lines.push('FINAL STANDINGS');
    s.standings.forEach(function (row) { lines.push('  ' + placeText(row.place) + '  ' + row.names.join(', ')); });
    lines.push('');
  }
  if (s.groups.length) {
    lines.push('GROUP WINNERS');
    s.groups.forEach(function (g) {
      lines.push('  ' + g.group + ': ' + g.name + (g.note ? '†' : '') + ' (' + g.wins + '-' + g.losses + ')');
      if (g.note) lines.push('    † ' + g.note);
    });
    lines.push('');
  }
  if (s.upset) lines.push('UPSET OF THE NIGHT', '  ' + s.upset.winner + ' (EQ ' + s.upset.winnerRating + ') beat ' + s.upset.loser + ' (EQ ' + s.upset.loserRating + ') ' + s.upset.games + ', starting every game at ' + s.upset.points + '-0.', '');
  lines.push('BIGGEST EQUALIZER RATING CHANGES (EXPERIMENTAL)', '  Experimental EQ rating only, not the official round robin rating.');
  s.movers.gainers.forEach(function (p) { lines.push('  Up   ' + p.name + ' ' + signed(p.ratingAdj)); });
  s.movers.losers.forEach(function (p) { lines.push('  Down ' + p.name + ' ' + signed(p.ratingAdj)); });
  lines.push('');
  if (s.explain) lines.push(EXPLAINER, '');
  lines.push('EVENT TOTALS', '  ' + totalsText(s.totals, s.format), '');
  lines.push('The groups and the Finals bracket: ' + SITE_URL + '/roundrobins.html#eq-' + s.date);
  if (footer) lines.push('', 'You are receiving this because this address subscribed to CTTC results.', 'Unsubscribe: ' + unsubscribeUrl);
  return lines.join('\n');
}

function buildEqualizerEmail(date, options) {
  const dataDir = options && options.dataDir;
  const all = publishedEqualizers(dataDir);
  const session = all.find(function (s) { return s.date === date; });
  if (!session || !session.equalizer || !session.groups || !session.groups.length) throw new Error('No published Equalizer for ' + date);
  const explain = all.findIndex(function (s) { return s.date === date; }) < EXPLAIN_FOR_FIRST;
  const summary = summarize(session, Object.assign({}, options, { explain: explain }));
  const footer = !options || options.footer !== false;
  const unsubscribeUrl = (options && options.unsubscribeUrl) || UNSUBSCRIBE_URL;
  return {
    subject: 'CTTC Equalizer Results - ' + formatDate(date),
    html: buildHtml(summary, footer, unsubscribeUrl),
    text: buildText(summary, footer, unsubscribeUrl),
    summary: summary
  };
}

module.exports = { buildEqualizerEmail, latestEqualizerDate, UNSUBSCRIBE_URL };

if (require.main === module) {
  const date = process.argv[2] || latestEqualizerDate();
  if (!date) {
    console.error('No Equalizer date given and none is published.');
    process.exitCode = 1;
    return;
  }
  const email = buildEqualizerEmail(date);
  const previewFile = path.join(ROOT, '.cache', 'equalizer-email-preview.html');
  fs.mkdirSync(path.dirname(previewFile), { recursive: true });
  fs.writeFileSync(previewFile, email.html);
  console.log('Subject:', email.subject);
  console.log('Preview written to', previewFile);
  console.log('\n--- text version ---\n');
  console.log(email.text);
}
