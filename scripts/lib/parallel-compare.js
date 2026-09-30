'use strict';

// Parallel operations: MS Access is still entered alongside the desk. The Access reports are scraped
// for comparison only; the site publishes the desk's finalized sessions. This module classifies every
// difference between the two as expected (documented in docs/parallel-operations.md) or unexpected.
//
// Session status:
//   same       1. identical results, no issues
//   expected   2. rankings or win/loss records differ, rating changes are identical, every difference is documented
//   review     3. anything else: high priority to review and fix
//   pending    only one side has the session yet

const { sortByGroupResult, describeWinner } = require('../../standings');

// Each code has one documented meaning; check-parallel-compare.js fails if docs/parallel-operations.md omits one.
const CODES = {
  FORFEIT_DIRECTION: { level: 'expected', title: 'Forfeit direction only in the desk', text: 'Access prints F in both cells for any forfeit. The desk records who forfeited, so the forfeit winner gets a win and the forfeiter a loss. Forfeits move no rating points on either side.' },
  FORFEIT_RANKING: { level: 'expected', title: 'Ranking follows the recorded forfeit direction', text: 'The group order differs only because the desk knows who forfeited and Access data does not.' },
  ACCESS_ORDER_TIE: { level: 'expected', title: 'Tie for first place', text: 'Access listed a different first place where the club tie-break applies (game ratio, then lowest pre-session rating). Access asks the admin to pick in three-way ties.' },
  ACCESS_ORDER_FORFEIT: { level: 'expected', title: 'Access order in a group with forfeits', text: 'Access listed a different first place in a group with forfeits. Access applies its own forfeit handling; the desk ranks by USATT match points.' },
  ACCESS_ORDER_UNEXPLAINED: { level: 'unexpected', title: 'Access first place differs without a tie or forfeit', text: 'The group had a clear winner and no forfeits, yet the first row of the Access report is someone else.' },
  RANKING_DIFFERS: { level: 'unexpected', title: 'Ranking differs with the same results', text: 'The same ranking rules applied to both sides give different orders without a recorded forfeit direction to explain it.' },
  GROUP_MEMBERS: { level: 'unexpected', title: 'Different players in a group', text: 'A group has different members in Access and in the desk.' },
  MATCH_MISSING: { level: 'unexpected', title: 'Match missing on one side', text: 'Two players in the same group have a match on only one side.' },
  SCORE_DIFFERS: { level: 'unexpected', title: 'Different score', text: 'The same match has different game scores.' },
  FORFEIT_MISMATCH: { level: 'unexpected', title: 'Forfeit on one side only', text: 'A match was played on one side and forfeited on the other.' },
  RATING_BEFORE: { level: 'unexpected', title: 'Different starting rating', text: 'A player started the session with different ratings in Access and in the desk.' },
  RATING_ADJ: { level: 'unexpected', title: 'Different rating change', text: 'A player gained or lost a different number of rating points.' },
  RATING_AFTER: { level: 'unexpected', title: 'Different final rating', text: 'A player finished the session with a different rating.' },
  RECORD_DIFFERS: { level: 'unexpected', title: 'Different win-loss record', text: 'A win-loss record differs by more than recorded forfeits explain.' }
};

function finding(code, group, players, detail) {
  return { code: code, level: CODES[code].level, group: group, players: players || [], detail: detail || '' };
}

function isUnplayed(match) {
  return !match.gamesWon && !match.gamesLost;
}

function namedForfeit(match) {
  return Boolean(match && match.forfeitedBy && match.forfeitedBy !== 'both');
}

function matchAgainst(player, opponentName) {
  return (player.matches || []).find(function (match) { return match.opponent === opponentName; }) || null;
}

function sameNumber(left, right) {
  return Number(left) === Number(right);
}

function compareGroup(groupName, accessPlayers, appPlayers) {
  const findings = [];
  const accessNames = accessPlayers.map(function (player) { return player.name; });
  const appNames = appPlayers.map(function (player) { return player.name; });
  const onlyAccess = accessNames.filter(function (name) { return appNames.indexOf(name) < 0; });
  const onlyApp = appNames.filter(function (name) { return accessNames.indexOf(name) < 0; });
  if (onlyAccess.length || onlyApp.length) {
    findings.push(finding('GROUP_MEMBERS', groupName, onlyAccess.concat(onlyApp),
      (onlyAccess.length ? 'Only in Access: ' + onlyAccess.join(', ') + '. ' : '') + (onlyApp.length ? 'Only in the desk: ' + onlyApp.join(', ') + '.' : '')));
    return findings;
  }

  const forfeitWins = {};
  const forfeitLosses = {};
  let directionFindings = 0;
  const appByName = {};
  appPlayers.forEach(function (player) { appByName[player.name] = player; });

  accessPlayers.forEach(function (accessPlayer, index) {
    accessPlayers.slice(index + 1).forEach(function (accessOther) {
      const accessMatch = matchAgainst(accessPlayer, accessOther.name);
      const appMatch = matchAgainst(appByName[accessPlayer.name], accessOther.name);
      const pair = [accessPlayer.name, accessOther.name];
      const label = pair.join(' v ');
      if (!accessMatch || !appMatch) {
        findings.push(finding('MATCH_MISSING', groupName, pair, label + ' is missing in ' + (accessMatch ? 'the desk' : 'Access')));
        return;
      }
      const accessUnplayed = isUnplayed(accessMatch);
      const appUnplayed = isUnplayed(appMatch);
      if (!accessUnplayed && !appUnplayed) {
        if (!sameNumber(accessMatch.gamesWon, appMatch.gamesWon) || !sameNumber(accessMatch.gamesLost, appMatch.gamesLost)) {
          findings.push(finding('SCORE_DIFFERS', groupName, pair, label + ': Access ' + accessMatch.gamesWon + '-' + accessMatch.gamesLost + ', desk ' + appMatch.gamesWon + '-' + appMatch.gamesLost));
        }
      } else if (accessUnplayed && appUnplayed) {
        if (namedForfeit(appMatch)) {
          const forfeiter = appMatch.forfeitedBy;
          const winner = forfeiter === accessPlayer.name ? accessOther.name : accessPlayer.name;
          forfeitWins[winner] = (forfeitWins[winner] || 0) + 1;
          forfeitLosses[forfeiter] = (forfeitLosses[forfeiter] || 0) + 1;
          directionFindings += 1;
          findings.push(finding('FORFEIT_DIRECTION', groupName, pair, label + ': the desk records ' + forfeiter + ' forfeiting; Access shows F for both.'));
        }
      } else {
        findings.push(finding('FORFEIT_MISMATCH', groupName, pair, label + ': ' + (accessUnplayed ? 'forfeit in Access, played in the desk' : 'played in Access, forfeit in the desk')));
      }
    });
  });

  accessPlayers.forEach(function (accessPlayer) {
    const appPlayer = appByName[accessPlayer.name];
    [['ratingBefore', 'RATING_BEFORE', 'starting rating'], ['ratingAdj', 'RATING_ADJ', 'rating change'], ['ratingAfter', 'RATING_AFTER', 'final rating']].forEach(function (check) {
      if (!sameNumber(accessPlayer[check[0]], appPlayer[check[0]])) {
        findings.push(finding(check[1], groupName, [accessPlayer.name], accessPlayer.name + ' ' + check[2] + ': Access ' + accessPlayer[check[0]] + ', desk ' + appPlayer[check[0]]));
      }
    });
    const expectedWins = accessPlayer.wins + (forfeitWins[accessPlayer.name] || 0);
    const expectedLosses = accessPlayer.losses + (forfeitLosses[accessPlayer.name] || 0);
    if (!sameNumber(expectedWins, appPlayer.wins) || !sameNumber(expectedLosses, appPlayer.losses)) {
      findings.push(finding('RECORD_DIFFERS', groupName, [accessPlayer.name], accessPlayer.name + ' record: Access ' + accessPlayer.wins + '-' + accessPlayer.losses + ', desk ' + appPlayer.wins + '-' + appPlayer.losses));
    }
  });

  const accessRanked = sortByGroupResult(accessPlayers).map(function (player) { return player.name; });
  const appRanked = sortByGroupResult(appPlayers).map(function (player) { return player.name; });
  if (accessRanked.join('|') !== appRanked.join('|')) {
    findings.push(directionFindings
      ? finding('FORFEIT_RANKING', groupName, appRanked.slice(0, 2), 'Access data ranks ' + accessRanked.join(' > ') + '; the desk ranks ' + appRanked.join(' > '))
      : finding('RANKING_DIFFERS', groupName, appRanked.slice(0, 2), 'Access data ranks ' + accessRanked.join(' > ') + '; the desk ranks ' + appRanked.join(' > ')));
  }

  const listedFirst = accessPlayers[0].name;
  if (listedFirst !== appRanked[0]) {
    const note = describeWinner(appPlayers);
    const hasForfeit = accessPlayers.some(function (player) { return (player.matches || []).some(isUnplayed); });
    const detail = 'Access lists ' + listedFirst + ' first; the desk ranks ' + appRanked[0] + ' first' + (note ? ' (' + note.text + ')' : '') + '.';
    if (hasForfeit) findings.push(finding('ACCESS_ORDER_FORFEIT', groupName, [listedFirst, appRanked[0]], detail));
    else if (note) findings.push(finding('ACCESS_ORDER_TIE', groupName, [listedFirst, appRanked[0]], detail));
    else findings.push(finding('ACCESS_ORDER_UNEXPLAINED', groupName, [listedFirst, appRanked[0]], detail));
  }
  return findings;
}

function statusOf(findings) {
  if (!findings.length) return 'same';
  return findings.some(function (item) { return item.level === 'unexpected'; }) ? 'review' : 'expected';
}

// accessSession keeps the report's row order; appSession is a desk-finalized (source "app") session.
function compareSession(accessSession, appSession) {
  const date = (accessSession || appSession).date;
  if (!accessSession || !appSession) {
    return { date: date, status: 'pending', findings: [], groups: [], note: accessSession ? 'Not finalized in the desk yet' : 'No Access report yet' };
  }
  const groups = [];
  const names = {};
  accessSession.groups.forEach(function (group) { names[group.name] = true; });
  appSession.groups.forEach(function (group) { names[group.name] = true; });
  Object.keys(names).sort(function (left, right) { return parseInt(left.replace(/\D/g, ''), 10) - parseInt(right.replace(/\D/g, ''), 10); }).forEach(function (groupName) {
    const accessGroup = accessSession.groups.find(function (group) { return group.name === groupName; });
    const appGroup = appSession.groups.find(function (group) { return group.name === groupName; });
    const findings = !accessGroup || !appGroup
      ? [finding('GROUP_MEMBERS', groupName, [], groupName + ' exists only in ' + (accessGroup ? 'Access' : 'the desk'))]
      : compareGroup(groupName, accessGroup.players, appGroup.players);
    groups.push({ name: groupName, status: statusOf(findings), findings: findings });
  });
  const findings = groups.reduce(function (all, group) { return all.concat(group.findings); }, []);
  return { date: date, status: statusOf(findings), findings: findings, groups: groups };
}

function compareSessions(accessSessions, appSessions, options) {
  const since = options && options.since;
  const accessByDate = {};
  accessSessions.forEach(function (session) { accessByDate[session.date] = session; });
  const appByDate = {};
  appSessions.forEach(function (session) { appByDate[session.date] = session; });
  const dates = {};
  Object.keys(appByDate).forEach(function (date) { dates[date] = true; });
  if (since) Object.keys(accessByDate).forEach(function (date) { if (date >= since) dates[date] = true; });
  return Object.keys(dates).filter(function (date) { return !since || date >= since; }).sort().map(function (date) {
    return compareSession(accessByDate[date], appByDate[date]);
  });
}

function summarize(results) {
  const counts = { same: 0, expected: 0, review: 0, pending: 0 };
  results.forEach(function (result) { counts[result.status] += 1; });
  return counts;
}

module.exports = { CODES, compareGroup, compareSession, compareSessions, summarize };
