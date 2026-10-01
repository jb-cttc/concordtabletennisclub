// Run: npm run preview:desk   then open http://localhost:3100/?date=2026-09-28
// Dev only. Serves the real desk page (apps-script/Index.html and its includes) with a small in-memory
// stand-in for the Google Sheet back end, so the screen can be seen and clicked without Google.
// Nothing here talks to Google or to the club Sheet. The back end is deliberately simple (it does not
// compute rating changes); the real behavior is covered by the apps-script/check-*.cjs tests.

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DESK = path.join(ROOT, 'apps-script');
const PORT = Number(process.env.PORT || 3100);

const players = [];
const byName = {};
function playerFor(name, rating) {
  if (!byName[name]) {
    byName[name] = { playerId: 'p' + (players.length + 1), name, currentRating: rating };
    players.push(byName[name]);
  }
  return byName[name];
}
JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'players.json'), 'utf8')).players.forEach(function (player) {
  if (Number.isFinite(player.currentRating)) playerFor(player.name, player.currentRating);
});

const sessions = {};
function seedSession(date) {
  const details = [].concat.apply([], fs.readdirSync(path.join(ROOT, 'data')).filter(function (name) { return /^session-details-\d{4}\.json$/.test(name); }).map(function (name) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name), 'utf8'));
  })).find(function (session) { return session.date === date; });
  if (!details) return;
  const groups = [];
  const matches = [];
  details.groups.forEach(function (group, index) {
    const number = index + 1;
    const ordered = group.players.slice().sort(function (left, right) { return right.ratingBefore - left.ratingBefore; });
    groups.push({ groupNumber: number, players: ordered.map(function (player) {
      return { playerId: playerFor(player.name, player.ratingBefore).playerId, startingRating: player.ratingBefore, promotionFromGroup: null };
    }) });
    const seen = {};
    group.players.forEach(function (player) {
      (player.matches || []).forEach(function (match) {
        const key = [player.name, match.opponent].sort().join('::');
        if (seen[key]) return;
        seen[key] = true;
        const one = byName[player.name].playerId;
        const two = byName[match.opponent].playerId;
        const unplayed = !match.gamesWon && !match.gamesLost;
        let forfeitedBy = null;
        if (match.forfeit || unplayed) forfeitedBy = match.forfeitedBy === 'both' || !match.forfeitedBy ? 'both' : byName[match.forfeitedBy].playerId;
        matches.push({
          matchId: 'm' + matches.length, groupNumber: number, playerOneId: one, playerTwoId: two,
          playerOneGames: unplayed ? null : match.gamesWon, playerTwoGames: unplayed ? null : match.gamesLost,
          forfeit: Boolean(forfeitedBy), forfeitedBy: forfeitedBy
        });
      });
    });
  });
  sessions['session-' + date] = { sessionId: 'session-' + date, sessionDate: date, status: 'active', revision: 3, groups, matches };
}
seedSession('2026-09-28');

// Publishing countdown stand-in: a short hold (PREVIEW_PUBLISH_SECONDS, default 20) instead of 15 minutes.
const HOLD_MS = Number(process.env.PREVIEW_PUBLISH_SECONDS || 20) * 1000;
let publishing = null;
function publishPayload() {
  const now = Date.now();
  if (publishing && publishing.state === 'dispatched' && now > publishing.doneAt) {
    publishing.state = 'email_pending';
    publishing.emailDueAt = now + HOLD_MS;
  }
  if (publishing && publishing.state === 'email_dispatched' && now > publishing.doneAt) publishing.state = 'emailed';
  const base = { now, tokenSet: !process.env.PREVIEW_NO_TOKEN, holdMinutes: 15 };
  return publishing ? Object.assign({ message: '' }, publishing, base) : Object.assign({ state: 'none' }, base);
}

const payments = {};
const openPlay = {};
const rpc = {
  getAppState: function (date) {
    return { players, session: sessions['session-' + date] || null, ratingsSyncedThrough: '2026-09-28', ratingsCheckedAt: new Date().toISOString() };
  },
  listPlayers: function () { return players; },
  listArchivedPlayers: function () { return []; },
  syncRatingsFromPublicSite: function () { return { skipped: true, checkedAt: new Date().toISOString() }; },
  createSession: function (date) {
    sessions['session-' + date] = { sessionId: 'session-' + date, sessionDate: date, status: 'draft', revision: 1, groups: [], matches: [] };
    return sessions['session-' + date];
  },
  saveSessionDraft: function (payload) {
    const session = sessions[payload.sessionId];
    if (!session) throw new Error('Session not found');
    if (session.status === 'finalized') throw new Error('Finalized sessions are read-only.');
    session.status = 'active';
    session.revision += 1;
    session.groups = payload.groups.map(function (group) {
      return { groupNumber: group.groupNumber, players: group.playerIds.map(function (id) {
        const player = players.find(function (item) { return item.playerId === id; });
        return { playerId: id, startingRating: player.currentRating, promotionFromGroup: (payload.promotions || {})[id] || null };
      }) };
    });
    session.matches = payload.matches.map(function (match, index) { return Object.assign({ matchId: 'm' + index }, match); });
    return session;
  },
  finalizeSession: function (id) {
    sessions[id].status = 'finalized'; sessions[id].revision += 1;
    publishing = { sessionId: id, sessionDate: sessions[id].sessionDate, dueAt: Date.now() + HOLD_MS, state: 'pending' };
    return sessions[id];
  },
  reopenSession: function (id) { sessions[id].status = 'active'; sessions[id].revision += 1; publishing = null; return sessions[id]; },
  getPublishState: function () { return publishPayload(); },
  publishNow: function () { if (publishing && (publishing.state === 'pending' || publishing.state === 'failed')) { publishing.state = 'dispatched'; publishing.doneAt = Date.now() + 6000; } return publishPayload(); },
  sendEmailNow: function () { if (publishing && publishing.state === 'email_pending') { publishing.state = 'email_dispatched'; publishing.doneAt = Date.now() + 6000; } return publishPayload(); },
  publishDue: function () {
    publishPayload();
    if (publishing && publishing.state === 'pending' && Date.now() >= publishing.dueAt) return rpc.publishNow();
    if (publishing && publishing.state === 'email_pending' && Date.now() >= publishing.emailDueAt) return rpc.sendEmailNow();
    return publishPayload();
  },
  getMemberStatuses: function () { return {}; },
  listVoiceSuggestions: function () { return []; },
  sendVoiceConfirmation: function () { return { sent: true, reason: '' }; },
  getOpenPlayParticipants: function (date) { return openPlay[date] || []; },
  setOpenPlayParticipant: function (date, playerId, attending) {
    const ids = (openPlay[date] || []).filter(function (id) { return id !== playerId; });
    if (attending) ids.push(playerId);
    openPlay[date] = ids;
    return attending;
  },
  setMemberStatus: function () { return { statuses: {}, notes: {} }; },
  getPrivatePaymentOverview: function (date) { return { methods: payments[date] || {}, coveredIds: [], passes: [] }; },
  setSessionPayment: function (date, playerId, method) {
    (payments[date] = payments[date] || {})[playerId] = method;
    return method;
  }
};

const stub = '<script>(function(){function build(ok,bad){return new Proxy({},{get:function(_,name){' +
  'if(name==="withSuccessHandler")return function(f){return build(f,bad)};' +
  'if(name==="withFailureHandler")return function(f){return build(ok,f)};' +
  'return function(){var args=[].slice.call(arguments);fetch("/rpc/"+name,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(args)})' +
  '.then(function(r){return r.json()}).then(function(r){if(r.error){if(bad)bad({message:r.error})}else if(ok)ok(r.result)}).catch(function(e){if(bad)bad(e)})}}})}' +
  'window.google={script:{run:build(null,null),host:{close:function(){},setHeight:function(){}}}}})()</script>';

function page(date) {
  const read = function (name) { return fs.readFileSync(path.join(DESK, name + '.html'), 'utf8'); };
  return stub + read('Index')
    .replace(/<\?!= include\('(\w+)'\) \?>/g, function (_, name) { return read(name); })
    .replace('var ancestors = window.location.ancestorOrigins ? Array.prototype.slice.call(window.location.ancestorOrigins) : null;', 'var ancestors = null; // preview only: skip the framing guard')
    .replace('<?= deskMode ?>', 'dev')
    .replace('<?= initialDate ?>', date);
}

http.createServer(function (request, response) {
  const url = new URL(request.url, 'http://localhost');
  if (request.method === 'POST' && url.pathname.startsWith('/rpc/')) {
    let body = '';
    request.on('data', function (chunk) { body += chunk; });
    request.on('end', function () {
      response.setHeader('content-type', 'application/json');
      try {
        const handler = rpc[url.pathname.slice(5)];
        if (!handler) throw new Error('Preview has no back end for ' + url.pathname.slice(5));
        response.end(JSON.stringify({ result: handler.apply(null, JSON.parse(body || '[]')) }));
      } catch (error) {
        response.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '') ? url.searchParams.get('date') : '';
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(page(date));
}).listen(PORT, function () { console.log('Desk preview (in-memory, not Google): http://localhost:' + PORT + '/?date=2026-09-28'); });
