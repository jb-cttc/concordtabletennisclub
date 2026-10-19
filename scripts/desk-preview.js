// Run: npm run preview:desk   then open http://localhost:3100/?date=2026-09-28
// The daily cash flow page: http://localhost:3100/?view=cash (synthetic players and payments, see cashPreview below).
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

// Publishing countdown stand-in: a short hold (PREVIEW_PUBLISH_SECONDS, default 20) instead of 2 minutes.
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
  logDeskEvents: function (entries) { entries.forEach(function (entry) { console.log('Desk problem reported:', JSON.stringify(entry)); }); return true; },
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
  getCoachingParticipants: function () {
    return [
      { playerId: players[0].playerId, name: players[0].name, role: 'coach', lessons: [{ start: '19:00', minutes: 60, coachLabel: 'D' }, { start: '20:00', minutes: 30, coachLabel: 'D' }] },
      { playerId: '', name: 'Sample Student', role: 'student', lessons: [{ start: '19:00', minutes: 60, coachLabel: 'D' }] }
    ];
  },
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

// Daily cash flow stand-in for ?view=cash. Unlike the desk stand-in above, it runs the real CashFlow.js (and the
// payment, Zeffy, status and name-link code it uses) on a small in-memory Sheet of made-up players: members, visitors,
// juniors, Zeffy pass holders, round robin and Open Play nights, every payment method, unpaid players and a saved cash count.
const cashPreview = (function () {
  const vm = require('vm');
  const tables = {};
  const sheets = {};
  const zone = 'America/Los_Angeles';
  const day = date => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  function sheet(name) {
    if (!sheets[name]) {
      tables[name] = tables[name] || [];
      sheets[name] = {
        getName: () => name,
        getLastRow: () => tables[name].length + 1,
        getMaxColumns: () => 26,
        deleteRow: row => { tables[name].splice(row - 2, 1); }
      };
    }
    return sheets[name];
  }
  const context = {
    console,
    TABLES: {},
    SpreadsheetApp: { getActive: () => ({ getSheetByName: name => (tables[name] ? sheet(name) : null), insertSheet: name => { tables[name] = []; return sheet(name); } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, hasLock: () => false, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
    GmailApp: { search: () => [] },
    Session: { getScriptTimeZone: () => zone, getActiveUser: () => ({ getEmail: () => 'preview@example.test' }) },
    Utilities: { formatDate: date => day(date), getUuid: () => String(Math.random()).slice(2) },
    HtmlService: {}, ScriptApp: {}
  };
  vm.createContext(context);
  ['Code.js', 'SessionService.js', 'LinkedNames.js', 'MemberStatus.js', 'PrivatePayments.js', 'ZeffyTracking.js', 'OpenPlay.js', 'CashFlow.js'].forEach(function (file) {
    vm.runInContext(fs.readFileSync(path.join(DESK, file), 'utf8'), context, { filename: file });
  });
  // A plain table stand-in: rows are objects, written and read as they are.
  context.rows_ = name => {
    if (!tables[name]) throw new Error('Missing database table: ' + name);
    return tables[name].map((row, index) => Object.assign({ __row: index + 2 }, row));
  };
  context.appendObjects_ = (name, objects) => { objects.forEach(object => tables[name].push(Object.assign({}, object))); };
  context.updateRow_ = (name, row, changes) => { Object.assign(tables[name][row - 2], changes); };
  context.ensureHeader_ = () => {};
  context.formatTable_ = () => {};
  context.appendAudit_ = (action, type, id, details) => { console.log('Audit (preview only):', action, id, JSON.stringify(details)); return ''; };

  const people = ['Avery Sample', 'Blake Sample', 'Casey Sample', 'Drew Sample', 'Emery Sample', 'Finley Sample', 'Gray Sample', 'Harper Sample',
    'Indy Sample', 'Jules Sample', 'Kendall Sample', 'Logan Sample', 'Morgan Sample', 'Noel Sample', 'Oakley Sample', 'Parker Sample', 'Quinn Sample', 'Reese Sample'];
  const pid = name => 'player-preview-' + (people.indexOf(name) + 1);
  tables.Players = people.map(name => ({ player_id: pid(name), display_name: name, current_rating: 1500, active: true }));
  tables.Aliases = [];
  tables.SessionPlayers = [];
  tables.NameLinks = [
    { kind: 'junior', name: 'Casey Sample', linked_name: 'Drew Sample' },
    { kind: 'junior', name: 'Indy Sample', linked_name: '' }
  ];
  tables.MemberStatus = ['Avery Sample', 'Drew Sample', 'Finley Sample', 'Gray Sample', 'Kendall Sample', 'Morgan Sample']
    .map(name => ({ player_id: pid(name), status: 'member', updated_at: '' }));
  tables.ZeffyPasses = [{ player_id: pid('Gray Sample'), player_name: 'Gray Sample', active: true, updated_at: '' }];
  tables.SessionPayments = [];
  tables.OpenPlay = [];
  tables.CashCounts = [];
  const iso = offset => { const date = new Date(); date.setDate(date.getDate() - offset); return day(date); };
  // Morgan's Zeffy pass was bought nine days ago: she paid by card before that.
  tables.ZeffyPayments = [{ message_id: 'preview-1', paid_on: iso(9), kind: 'purchase', payer_name: 'Morgan Sample', payer_email: 'morgan@example.test', participant_name: 'Morgan Sample', created_at: '' }];
  const methods = ['cash', 'venmo', 'zelle', 'credit', 'cash', 'venmo', ''];
  // Club nights over the last five weeks: Monday and Wednesday round robins, Friday and Saturday Open Play.
  for (let offset = 34; offset >= 0; offset -= 1) {
    const date = iso(offset);
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    if ([1, 3, 5, 6].indexOf(weekday) < 0) continue;
    const roundRobin = weekday === 1 || weekday === 3;
    const count = 7 + (offset * 5) % 8;
    const playing = people.slice((offset * 3) % 6, (offset * 3) % 6 + count);
    playing.forEach(function (name, index) {
      if (roundRobin && index < count - 2) tables.SessionPlayers.push({ session_id: 'session-' + date, player_id: pid(name), group_number: 1 + Math.floor(index / 4) });
      else tables.OpenPlay.push({ session_date: date, player_id: pid(name), updated_at: '' });
      const method = methods[(index + offset) % methods.length];
      if (method) tables.SessionPayments.push({ session_id: 'session-' + date, player_id: pid(name), method: method, updated_at: '' });
    });
    // Someone who paid at the door but was never put on the sheet.
    if (offset % 7 === 2) tables.SessionPayments.push({ session_id: 'session-' + date, player_id: pid('Reese Sample'), method: 'cash', updated_at: '' });
  }
  // Gray's pass covers every night, so a recorded payment would never be made for him.
  tables.SessionPayments = tables.SessionPayments.filter(row => row.player_id !== pid('Gray Sample'));
  tables.SessionPayments = tables.SessionPayments.filter(row => !(row.player_id === pid('Morgan Sample') && row.session_id.slice(8) >= iso(9)));
  const counted = context.getCashFlow(iso(34), iso(0)).days.filter(item => item.cash.expected).slice(1, 4);
  counted.forEach(function (item, index) {
    context.saveCashCount(item.date, String(item.cash.expected + [0, -5, 2.5][index]), ['', 'Two fives missing from the box', 'Extra quarter coins'][index]);
  });
  return {
    getCashFlow: (from, to) => JSON.parse(JSON.stringify(context.getCashFlow(from, to))),
    saveCashCount: (date, amount, note) => JSON.parse(JSON.stringify(context.saveCashCount(date, amount, note)))
  };
})();
rpc.getCashFlow = cashPreview.getCashFlow;
rpc.saveCashCount = cashPreview.saveCashCount;

const stub = '<script>(function(){function build(ok,bad){return new Proxy({},{get:function(_,name){' +
  'if(name==="withSuccessHandler")return function(f){return build(f,bad)};' +
  'if(name==="withFailureHandler")return function(f){return build(ok,f)};' +
  'return function(){var args=[].slice.call(arguments);fetch("/rpc/"+name,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(args)})' +
  '.then(function(r){return r.json()}).then(function(r){if(r.error){if(bad)bad({message:r.error})}else if(ok)ok(r.result)}).catch(function(e){if(bad)bad(e)})}}})}' +
  'window.google={script:{run:build(null,null),host:{close:function(){},setHeight:function(){}}}}})()</script>';

function cashPage() {
  return stub + fs.readFileSync(path.join(DESK, 'Cash.html'), 'utf8')
    .replace('var ancestors = window.location.ancestorOrigins ? Array.prototype.slice.call(window.location.ancestorOrigins) : null;', 'var ancestors = null; // preview only: skip the framing guard')
    .replace('<?= deskMode ?>', 'dev')
    .replace('<?= deskUrl ?>', '/');
}

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
  response.end(url.searchParams.get('view') === 'cash' ? cashPage() : page(date));
}).listen(PORT, function () { console.log('Desk preview (in-memory, not Google): http://localhost:' + PORT + '/?date=2026-09-28 and the cash flow page at http://localhost:' + PORT + '/?view=cash'); });
