// Run: npm run preview:desk   then open http://localhost:3100/?date=2026-09-28
// (PREVIEW_CLOVER_DRY_RUN=1 shows the Clover list as it is before CLOVER_ENABLED is on.)
// The daily cash flow page: http://localhost:3100/?view=cash (synthetic players and payments, see cashPreview below).
// Volunteer Admin: http://localhost:3100/?view=volunteers (made-up volunteers, see volunteerPreview below).
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

// The Friday and Saturday special, read from the real apps-script/NightFees.js so the preview follows its dates.
const nightFees = {};
require('vm').runInNewContext(fs.readFileSync(path.join(DESK, 'NightFees.js'), 'utf8'), nightFees);
function specialNight(date) { return nightFees.specialNight_(date); }

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
const cloverNights = {};
// Junior and pays-for links by player id, as the pencil window shows them (made up; LinkedNames.js keeps real ones).
const playerLinks = {};
// A night's made-up Clover payments: one matched by a card used before, one overpaid (a member covering a second
// player), one with no name to go on, a refund, and a card used before by a player not checked in yet (offered at the top
// with RR and Open). Players are the saved roster's, when the date has one.
function cloverPreview(date) {
  const session = sessions['session-' + date];
  const roster = session ? [].concat.apply([], session.groups.map(function (group) { return group.players.map(function (entry) { return entry.playerId; }); })) : [];
  const ids = roster.length >= 5 ? roster : players.slice(0, 5).map(function (player) { return player.playerId; });
  if (!cloverNights[date]) {
    const seven = Date.parse(date + 'T02:00:00Z') + 86400000;
    const item = function (id, minutes, net, card, extra) {
      const time = seven + minutes * 60000;
      const clock = new Date(time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
      return Object.assign({ id: id, time: time, clock: clock, amount: net, net: net, kind: 'card', card: card, cardholder: '', customer: '', state: 'unmatched', reason: '', payerId: '',
        playerIds: [], note: '', notePlayerId: '', suggestions: [], notCheckedIn: [], verdicts: [], recorded: false, changed: [] }, extra);
    };
    // Not on the roster, and not the preview's coach (players[0]).
    const away = players.slice(1).find(function (player) { return ids.indexOf(player.playerId) < 0; });
    cloverNights[date] = [
      item('cv5', 16, 10, 'VISA \u2022\u20226610', { state: 'matched', reason: 'card', playerIds: [away.playerId], notCheckedIn: [away.playerId], recorded: !process.env.PREVIEW_CLOVER_DRY_RUN }),
      item('cv4', 14, 10, 'AMEX \u2022\u20223005', { state: 'ignored', note: 'Refunded' }),
      item('cv7', 20, 20, 'VISA \u2022\u20225150', { state: 'matched', reason: 'hand', playerIds: [ids[7], ids[8]], recorded: !process.env.PREVIEW_CLOVER_DRY_RUN, offer: { payerId: ids[7], playerIds: [ids[8]], times: 2 } }),
      item('cv6', 18, 20, 'MC \u2022\u20223391', { note: 'No player found', pairs: [[ids[4], ids[5]], [ids[5], ids[6]]] }),
      item('cv8', 19, 10, 'VISA \u2022\u20220427', { note: 'No player found', likely: ids[9], likelyWhy: 'history', suggestions: [ids[9], ids[4]], history: [{ playerId: ids[9], dates: ['2026-09-14', '2026-09-21'] }, { playerId: ids[10], dates: ['2026-09-07'] }] }),
      item('cv3', 9, 10, 'VISA \u2022\u20227702', { note: 'No player found', suggestions: [ids[3], ids[4]], likely: ids[3], likelyAt: seven + 10 * 60000 }),
      item('cv2', 6, 15, 'MC \u2022\u20221190', { state: 'needs-action', payerId: ids[1], playerIds: [ids[1]], reason: 'card', note: 'Paid $15, fee is $10: $5 more. Who else does it cover?', suggestions: [ids[2]] }),
      item('cv1', 2, 10, 'VISA \u2022\u20224821', { cardholder: 'SAMPLE/AVERY', state: 'matched', reason: 'card', playerIds: [ids[0]], recorded: !process.env.PREVIEW_CLOVER_DRY_RUN })
    ];
    if (!process.env.PREVIEW_CLOVER_DRY_RUN) (payments[date] = payments[date] || {})[ids[0]] = 'credit';
    // Marked Credit by hand at the desk, with no card payment matched yet: the likely payer of cv3.
    (payments[date] = payments[date] || {})[ids[3]] = 'credit';
  }
  const names = {};
  const fees = {};
  players.forEach(function (player) { names[player.playerId] = player.name; fees[player.playerId] = 10; });
  return { connected: true, enabled: !process.env.PREVIEW_CLOVER_DRY_RUN, date: date, checkedAt: Date.now(), items: cloverNights[date], names: names, fees: fees, onNight: roster.concat(openPlay[date] || []), usualCard: ids.slice(4, 5), payersOf: {}, pageUrl: '' };
}
function cloverPreviewItem(date, id) {
  const item = cloverPreview(date).items.find(function (entry) { return entry.id === id; });
  if (!item) throw new Error('Clover has no such payment on this date.');
  return item;
}
const emails = {};
const openPlay = {};
// Players on a first visit ($10), by date; apps-script/NightFees.js works these out for real. The third player on a
// night's roster starts as one, so the 1st badge can be seen.
const firstVisits = {};
const memberStatuses = {};
const firstVisitsOn = function (date) {
  const session = sessions['session-' + date];
  const roster = session ? [].concat.apply([], session.groups.map(function (group) { return group.players.map(function (entry) { return entry.playerId; }); })) : [];
  return firstVisits[date] || (firstVisits[date] = roster.slice(2, 3));
};
const equalizers = {};
// The round robin sheets' print mark, per session (SessionService.js keeps it in document properties).
const prints = {};
// Who was moved up with the arrows, per session (SessionService.js keeps it beside the print mark).
const movesBySession = {};
// Follow mode's change stamps (SessionIds.js keeps them in the script cache), bumped after each change below.
const stamps = {};
const STAMP_AREAS = { saveSessionDraft: 's', createSession: 's', finalizeSession: 's', reopenSession: 's', saveSessionPrint: 's', saveSessionMoves: 's', updatePlayer: 's', setSessionPayment: 'p', setFirstVisit: 'p', matchCloverPayment: 'p', unmatchCloverPayment: 'p', saveEqualizerSetup: 'e', saveEqualizerResult: 'e', switchDayEvent: 'e' };
function touchStamp(name, args) {
  const area = STAMP_AREAS[name];
  if (!area) return;
  const found = /\d{4}-\d{2}-\d{2}/.exec(JSON.stringify(args[0] || ''));
  const date = found ? found[0] : new Date().toISOString().slice(0, 10);
  stamps[date] = stamps[date] || { s: '', p: '', e: '' };
  stamps[date][area] = String(Date.now());
  if (name === 'switchDayEvent') stamps[date].s = String(Date.now());
}
const rpc = {
  getAppState: function (date) {
    return { players, session: sessions['session-' + date] || null, ratingsSyncedThrough: '2026-09-28', ratingsCheckedAt: new Date().toISOString(), printed: prints['session-' + date] || null, printedEq: prints['session-' + date + '-equalizer'] || null, movedUp: movesBySession['session-' + date] || null };
  },
  saveSessionMoves: function (sessionId, moves) {
    if (Object.keys(moves || {}).length) movesBySession[sessionId] = moves;
    else delete movesBySession[sessionId];
    return moves;
  },
  saveSessionPrint: function (sessionId, mark) {
    if (mark === null) delete prints[sessionId];
    else prints[sessionId] = mark;
    return mark;
  },
  listPlayers: function () { return players; },
  getFollowState: function (date) {
    const state = rpc.getAppState(date);
    return { session: state.session, printed: state.printed, printedEq: state.printedEq, movedUp: state.movedUp };
  },
  getDeskStamps: function (date) { return stamps[date] || { s: '', p: '', e: '' }; },
  logFollowMode: function () { return true; },
  noteDeskEvent: function (date, event) { stamps[date] = Object.assign({ s: '', p: '', e: '' }, stamps[date], { ev: event }); return true; },
  setFollowScreen: function (date, choice) { const screen = Object.assign({}, choice, { at: Date.now() }); stamps[date] = Object.assign({ s: '', p: '', e: '' }, stamps[date], { screen: screen }); return screen; },
  // The Equalizer, kept in memory only: enough to switch a night to it, draw it, and print its sheets.
  getEqualizerState: function (date) { return equalizers[date] || { session: null, roster: [], setup: null, results: {}, history: [] }; },
  switchDayEvent: function (date, to) { return { revision: 1, status: 'draft', sessionId: 'session-' + date + '-' + to }; },
  saveEqualizerSetup: function (date, setup) {
    const state = equalizers[date] = equalizers[date] || { session: { sessionId: 'session-' + date + '-equalizer', status: 'draft', revision: 0 }, roster: [], setup: null, results: {}, history: [] };
    state.roster = setup.roster.slice();
    state.setup = setup;
    state.session.revision += 1;
    return { revision: state.session.revision, status: 'draft', sessionId: state.session.sessionId };
  },
  saveEqualizerResult: function (date, matchId, result) {
    const state = equalizers[date];
    if (result) state.results[matchId] = result; else delete state.results[matchId];
    state.session.revision += 1;
    return { revision: state.session.revision, status: 'draft', sessionId: state.session.sessionId };
  },
  addPlayer: function (name, rating) {
    name = String(name || '').trim().replace(/\s+/g, ' ');
    rating = Number(rating);
    if (!name || name.length > 80) throw new Error('Player name must be 1 through 80 characters.');
    if (!Number.isInteger(rating) || rating < 0 || rating > 4000) throw new Error('Rating must be a whole number from 0 through 4000.');
    if (byName[name]) throw new Error(name + ' is already in the player directory.');
    return playerFor(name, rating);
  },
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
  // The pencil in the player directory; apps-script/PlayerEdits.js has the real checks.
  getPlayerDetails: function (id) {
    const player = players.find(function (item) { return item.playerId === id; });
    if (!player) throw new Error('Unknown player');
    const mine = playerLinks[id] || { junior: false, memberId: '', juniors: [], paysFor: [] };
    const paidBy = Object.keys(playerLinks).filter(function (other) { return playerLinks[other].paysFor.indexOf(id) >= 0; });
    const names = {};
    [mine.memberId].concat(mine.juniors, mine.paysFor, paidBy).filter(Boolean).forEach(function (other) { names[other] = (players.find(function (item) { return item.playerId === other; }) || {}).name; });
    return Object.assign({ email: emails[id] || '', active: true, links: Object.assign({}, mine, { paidBy: paidBy, names: names }) }, player);
  },
  updatePlayer: function (id, changes) {
    const player = players.find(function (item) { return item.playerId === id; });
    if (!player) throw new Error('Unknown player');
    player.name = changes.name;
    player.currentRating = changes.rating;
    emails[id] = changes.email;
    if (changes.links) playerLinks[id] = { junior: changes.links.junior, memberId: changes.links.memberId, juniors: changes.links.juniors, paysFor: changes.links.paysFor };
    return rpc.getPlayerDetails(id);
  },
  // The Clover section's "pays for" offer; apps-script/CloverPayments.js has the real checks.
  addCloverPaysFor: function (payerId, playerIds) {
    const mine = playerLinks[payerId] || (playerLinks[payerId] = { junior: false, memberId: '', juniors: [], paysFor: [] });
    playerIds.forEach(function (id) { if (mine.paysFor.indexOf(id) < 0) mine.paysFor.push(id); });
    return { added: playerIds.length };
  },
  getMemberStatuses: function () {
    const statuses = {};
    players.forEach(function (player) { statuses[player.playerId] = memberStatuses[player.playerId] || 'visitor'; });
    return { statuses: statuses, notes: {} };
  },
  // Sample texts and volunteers, so the sidebar's RR and Open buttons can be pressed here.
  listVoiceSuggestions: function () {
    return players.slice(10, 16).map(function (player, index) {
      return { senderName: player.name, senderKey: player.name.toLowerCase(), playerIds: [player.playerId], linkedPlayerId: player.playerId, validated: true, check: '',
        messages: [{ text: "I'll join CTTC's RR tonight", receivedAt: Date.now() - (index + 1) * 600000 }] };
    });
  },
  // On a Friday or Saturday of the special (apps-script/NightFees.js), two of them hold free spots and one is still waiting.
  listVolunteers: function (date) {
    const special = specialNight(date);
    const sample = special ? [['Desk organizer', false, 'open'], ['Tables and barriers', true, 'open'], ['Lock-up', false, 'close'], ['Put away', false, '']] :
      [['Open', false], ['Close', false], ['Open', false], ['Close', false]];
    const answer = { connected: true, volunteers: players.slice(20, 24).map(function (player, index) {
      const volunteer = { playerId: player.playerId, name: player.name, roles: [sample[index][0]], waiting: sample[index][1] };
      if (special) volunteer.free = sample[index][2];
      return volunteer;
    }) };
    if (special) answer.special = { fee: special.fee };
    return answer;
  },
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
  setMemberStatus: function (playerId, status) { memberStatuses[playerId] = status; return rpc.getMemberStatuses(); },
  getPrivatePaymentOverview: function (date) {
    const overview = { methods: payments[date] || {}, coveredIds: [], passes: [], firstVisitIds: firstVisitsOn(date) };
    const special = specialNight(date);
    if (special) {
      overview.special = { fee: special.fee };
      overview.freeVolunteers = { [players[20].playerId]: 'open', [players[22].playerId]: 'close' };
    }
    return overview;
  },
  setFirstVisit: function (date, playerId, firstVisit) {
    firstVisits[date] = firstVisitsOn(date).filter(function (id) { return id !== playerId; }).concat(firstVisit ? [playerId] : []);
    return firstVisits[date];
  },
  // Made-up Clover card payments for any date, so the sidebar's Clover list can be seen and used here. The rules that
  // decide matches are apps-script/CloverPayments.js; this only keeps what was pressed.
  getCloverDesk: function (date) { return cloverPreview(date); },
  matchCloverPayment: function (date, id, playerIds) {
    const item = cloverPreviewItem(date, id);
    if (item.state === 'matched') throw new Error('This Clover payment is already matched.');
    Object.assign(item, { state: 'matched', reason: 'hand', playerIds: playerIds, note: '', recorded: true, changed: [] });
    playerIds.forEach(function (playerId) { (payments[date] = payments[date] || {})[playerId] = 'credit'; });
    return cloverPreview(date);
  },
  unmatchCloverPayment: function (date, id) {
    const item = cloverPreviewItem(date, id);
    item.playerIds.forEach(function (playerId) { if ((payments[date] || {})[playerId] === 'credit') payments[date][playerId] = ''; });
    Object.assign(item, { state: 'unmatched', note: 'Undone at the desk: choose who it is for', suggestions: item.playerIds, playerIds: [], payerId: '', recorded: false });
    return cloverPreview(date);
  },
  setAsideCloverPayment: function (date, id) {
    Object.assign(cloverPreviewItem(date, id), { state: 'set-aside', note: 'Not a desk fee', playerIds: [] });
    return cloverPreview(date);
  },
  setSessionPayment: function (date, playerId, method) {
    (payments[date] = payments[date] || {})[playerId] = method;
    return method;
  }
};

// Daily cash flow stand-in for ?view=cash. Unlike the desk stand-in above, it runs the real CashFlow.js (and the
// payment, Zeffy, status and name-link code it uses) on a small in-memory Sheet of made-up players: members, visitors,
// juniors, Zeffy pass holders, ten weeks of round robin and Open Play nights, every payment method, unpaid players,
// saved cash counts and club targets (day $120, week $450, month $1,900).
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
  ['Code.js', 'SessionService.js', 'LinkedNames.js', 'MemberStatus.js', 'PrivatePayments.js', 'ZeffyTracking.js', 'OpenPlay.js', 'CashFlow.js', 'NightFees.js', 'SessionIds.js'].forEach(function (file) {
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
    'Indy Sample', 'Jules Sample', 'Kendall Sample', 'Logan Sample', 'Morgan Sample', 'Noel Sample', 'Oakley Sample', 'Parker Sample', 'Quinn Sample',
    'Reese Sample', 'Sage Sample', 'Tatum Sample', 'Umber Sample', 'Vale Sample', 'Wren Sample', 'Xen Sample', 'Yael Sample', 'Zuri Sample'];
  const pid = name => 'player-preview-' + (people.indexOf(name) + 1);
  tables.Players = people.map(name => ({ player_id: pid(name), display_name: name, current_rating: 1500, active: true }));
  tables.Aliases = [];
  tables.SessionPlayers = [];
  tables.NameLinks = [
    { kind: 'junior', name: 'Casey Sample', linked_name: 'Drew Sample' },
    { kind: 'junior', name: 'Indy Sample', linked_name: '' },
    { kind: 'junior', name: 'Tatum Sample', linked_name: '' }
  ];
  tables.MemberStatus = ['Avery Sample', 'Drew Sample', 'Finley Sample', 'Gray Sample', 'Kendall Sample', 'Morgan Sample', 'Noel Sample', 'Sage Sample', 'Wren Sample']
    .map(name => ({ player_id: pid(name), status: 'member', updated_at: '' }));
  tables.ZeffyPasses = [{ player_id: pid('Gray Sample'), player_name: 'Gray Sample', active: true, updated_at: '' }];
  tables.SessionPayments = [];
  tables.OpenPlay = [];
  tables.CashCounts = [];
  // Club-wide targets, as the owner might set them, so some periods meet them and some fall short.
  tables.CashTargets = [{ period: 'day', amount: 120, updated_at: '' }, { period: 'week', amount: 450, updated_at: '' }, { period: 'month', amount: 1900, updated_at: '' }];
  const iso = offset => { const date = new Date(); date.setDate(date.getDate() - offset); return day(date); };
  // Morgan's Zeffy pass was bought nine days ago: she paid by card before that.
  tables.ZeffyPayments = [{ message_id: 'preview-1', paid_on: iso(9), kind: 'purchase', payer_name: 'Morgan Sample', payer_email: 'morgan@example.test', participant_name: 'Morgan Sample', created_at: '' }];
  // A fixed seed, so every preview shows the same made-up club.
  let seed = 20261019;
  const random = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const methods = ['cash', 'cash', 'cash', 'venmo', 'venmo', 'venmo', 'zelle', 'zelle', 'credit', ''];
  const regulars = people.slice(0, 12);
  // Ten weeks of club nights: Monday and Wednesday round robins, Friday and Saturday Open Play. The club was closed one
  // week (a gap in the chart), Wednesdays draw the biggest crowds, and a few new players turn up in the last weeks.
  for (let offset = 72; offset >= 0; offset -= 1) {
    const date = iso(offset);
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    if ([1, 3, 5, 6].indexOf(weekday) < 0 || (offset >= 58 && offset <= 64)) continue;
    const roundRobin = weekday === 1 || weekday === 3;
    const base = { 1: 12, 3: 15, 5: 9, 6: 10 }[weekday];
    const count = Math.max(4, Math.round(base + (random() - 0.5) * 8));
    const pool = regulars.concat(people.slice(12, 12 + Math.max(2, Math.floor((72 - offset) / 6))));
    const playing = pool.slice().sort(() => random() - 0.5).slice(0, count);
    playing.forEach(function (name, index) {
      if (roundRobin && index < count - 1) tables.SessionPlayers.push({ session_id: 'session-' + date, player_id: pid(name), group_number: 1 + Math.floor(index / 4) });
      else tables.OpenPlay.push({ session_date: date, player_id: pid(name), updated_at: '' });
      const method = methods[Math.floor(random() * methods.length)];
      if (method) tables.SessionPayments.push({ session_id: 'session-' + date, player_id: pid(name), method: method, updated_at: '' });
    });
    // Someone who paid at the door but was never put on the sheet.
    if (offset % 9 === 2 && playing.indexOf('Reese Sample') < 0) tables.SessionPayments.push({ session_id: 'session-' + date, player_id: pid('Reese Sample'), method: 'cash', updated_at: '' });
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
    saveCashCount: (date, amount, note) => JSON.parse(JSON.stringify(context.saveCashCount(date, amount, note))),
    saveCashTarget: (period, amount) => JSON.parse(JSON.stringify(context.saveCashTarget(period, amount))),
    getCashTargets: () => JSON.parse(JSON.stringify(context.getCashTargets()))
  };
})();
rpc.getCashFlow = cashPreview.getCashFlow;
rpc.saveCashCount = cashPreview.saveCashCount;
rpc.saveCashTarget = cashPreview.saveCashTarget;
rpc.getCashTargets = cashPreview.getCashTargets;

// Volunteer Admin stand-in for ?view=volunteers: made-up volunteers on the real volunteer app's positions (staffing-app/Code.js)
// for the next weeks, so the page can be seen, dragged and submitted here. The rules and the emails are the volunteer app's
// (adminApply_), covered by staffing-app/check-staffing.cjs; this keeps only what was submitted.
const volunteerPreview = (function () {
  const staffing = {};
  require('vm').runInNewContext(fs.readFileSync(path.join(ROOT, 'staffing-app', 'Code.js'), 'utf8'), staffing);
  const names = ['Ann Sample', 'Ben Sample', 'Cy Sample', 'Di Sample', 'Ed Sample', 'Flo Sample', 'Gil Sample', 'Hap Sample', 'Ike Sample', 'Jud Sample', 'Kip Sample', 'Lu Sample'];
  const id = name => 'vol-' + name.split(' ')[0].toLowerCase();
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const today = process.env.PREVIEW_TODAY || '2026-11-09';
  const nights = [];
  let n = 0;
  for (let t = Date.parse(today + 'T12:00:00Z'); nights.length < 16; t += 86400000) {
    const d = new Date(t);
    const wd = d.getUTCDay();
    if (![1, 3, 5, 6].includes(wd)) continue;
    const date = d.toISOString().slice(0, 10);
    const slots = { desk: [], money: [], tables: [], lockup: [], close: [] };
    const add = (position, name, status) => slots[position].push({ id: 's' + (++n), playerId: id(name), name, status: status || 'confirmed', finalize: false, free: '', signedUp: '' });
    const k = nights.length;
    add('desk', names[k % 4]);
    if (k % 3) add('money', names[4 + k % 2]);
    add('tables', names[6 + k % 3], k % 4 === 1 ? 'pending' : 'confirmed');
    if (k % 2) add('tables', names[9 + k % 2]);
    if (k % 5 !== 2) add('lockup', names[(k + 1) % 4]);
    add('close', names[(k + 7) % 12]);
    const special = nightFees.specialNight_(date);
    if (special) { slots.desk[0].free = 'yes'; slots.lockup[0] && (slots.lockup[0].free = 'yes'); slots.tables[0].free = slots.tables[0].status === 'pending' ? 'held' : 'yes'; }
    const sat = wd === 6;
    nights.push({ date, day: DAYS[wd] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear(), short: DAYS[wd].slice(0, 3) + ', ' + MONTHS[d.getUTCMonth()].slice(0, 3) + ' ' + d.getUTCDate(),
      time: sat ? '3:00 PM to 6:00 PM' : '7:00 PM to 10:00 PM', start: sat ? '15:00' : '19:00', end: sat ? '18:00' : '22:00', closed: date === '2026-11-26', note: date === '2026-11-26' ? 'Thanksgiving' : '',
      status: k % 3 === 0 ? 'needs' : k % 3 === 1 ? 'covered' : 'full', open: true, free: special ? { fee: special.fee, open: 0, close: 1 } : null, slots });
  }
  const board = {
    ok: true, today, mode: 'directory', quota: 92, minQuota: 10, maxChanges: 60, noteMax: 500,
    months: [{ year: 2026, month: 11, title: 'November 2026' }, { year: 2026, month: 12, title: 'December 2026' }, { year: 2027, month: 1, title: 'January 2027' }],
    positions: staffing.POSITIONS.map(spec => ({ id: spec.id, label: spec.label, part: spec.part, min: spec.min, full: spec.full || spec.min, max: spec.max, training: spec.training, alsoWith: spec.alsoWith || [] })),
    skills: ['keys', 'open', 'front_desk'].map(skill => ({ id: skill, label: staffing.SKILLS[skill] })),
    nights,
    training: names.slice(0, 6).map((name, index) => ({ playerId: id(name), name, keys: index < 4, open: index < 4, front_desk: index >= 2 })),
    recent: [{ at: today + 'T18:05:00.000Z', kind: 'move', name: 'Ben Sample', before: 'Mon, Nov 9: Lock-up (closing, 10:00 PM)', after: 'Wed, Nov 11: Lock-up (closing, 10:00 PM)', emailed: 'yes' }],
    players: names.map((name, index) => ({ playerId: id(name), name, rating: 1800 - index * 70 })).concat([{ playerId: 'vol-mo', name: 'Mo Sample', rating: 950 }]),
    // Mo has no email on file, so adding Mo asks for one.
    withEmail: names.map(id)
  };
  const playerName = playerId => (board.players.find(player => player.playerId === playerId) || { name: playerId }).name;
  return {
    getVolunteerAdmin: () => JSON.parse(JSON.stringify(board)),
    previewVolunteerAdmin: bucket => ({ ok: true, preview: true, changes: bucket.changes.length, emails: bucket.changes.filter(change => change.kind !== 'training').map(change => {
      if (change.kind === 'add') {
        const name = playerName(change.playerId);
        return { name, to: (change.email || name)[0].toLowerCase() + '\u2022\u2022\u2022@example.com', subject: 'The club signed you up for a CTTC volunteer shift',
          text: 'Hello ' + name.split(' ')[0] + ',\n\nThe club made a change to your volunteer schedule. Here is what changed:\n\nAdded: ' + change.to.date + ' ' + change.to.position +
            ': you are confirmed, no reply needed\n\n(Preview only: the real text comes from the volunteer app.)' };
      }
      const slot = [].concat.apply([], nights.map(night => [].concat.apply([], Object.values(night.slots)))).find(entry => entry.id === change.id);
      return { name: slot.name, to: slot.name[0].toLowerCase() + '\u2022\u2022\u2022@example.com', subject: 'The club changed your CTTC volunteer shift',
        text: 'Hello ' + slot.name.split(' ')[0] + ',\n\nThe club made a change to your volunteer schedule. Here is what changed:\n\n' +
          (change.kind === 'remove' ? 'Removed: ' + change.was.date + ' ' + change.was.position + ': you are off this shift' : 'Moved: ' + change.was.date + ' ' + change.was.position + ' (replaced) to ' + change.to.date + ' ' + change.to.position) +
          '\n\n(Preview only: the real text comes from the volunteer app.)' };
    }) }),
    submitVolunteerAdmin: bucket => ({ ok: true, changes: bucket.changes.length, emailed: 0, people: 0, added: [] })
  };
})();
rpc.getVolunteerAdmin = volunteerPreview.getVolunteerAdmin;
rpc.previewVolunteerAdmin = volunteerPreview.previewVolunteerAdmin;
rpc.submitVolunteerAdmin = volunteerPreview.submitVolunteerAdmin;

const stub = '<script>(function(){function build(ok,bad){return new Proxy({},{get:function(_,name){' +
  'if(name==="withSuccessHandler")return function(f){return build(f,bad)};' +
  'if(name==="withFailureHandler")return function(f){return build(ok,f)};' +
  'return function(){var args=[].slice.call(arguments);fetch("/rpc/"+name,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(args)})' +
  '.then(function(r){return r.json()}).then(function(r){if(r.error){if(bad)bad({message:r.error})}else if(ok)ok(r.result)}).catch(function(e){if(bad)bad(e)})}}})}' +
  'window.google={script:{run:build(null,null),host:{close:function(){},setHeight:function(){}}}}})()</script>';

function cashPage() {
  return stub + fs.readFileSync(path.join(DESK, 'Cash.html'), 'utf8')
    .replace('var ancestors = window.location.ancestorOrigins ? Array.prototype.slice.call(window.location.ancestorOrigins) : null;', 'var ancestors = null; // preview only: skip the framing guard')
    .replace('<?= deskMode ?>', 'dev').replace(/<\?= deskBuild \?>/g, '0')
    .replace('<?= deskUrl ?>', '/');
}

function page(date) {
  const read = function (name) { return fs.readFileSync(path.join(DESK, name + '.html'), 'utf8'); };
  return stub + read('Index')
    .replace(/<\?!= include\('(\w+)'\) \?>/g, function (_, name) { return read(name); })
    .replace('var ancestors = window.location.ancestorOrigins ? Array.prototype.slice.call(window.location.ancestorOrigins) : null;', 'var ancestors = null; // preview only: skip the framing guard')
    .replace('<?= deskMode ?>', 'dev').replace(/<\?= deskBuild \?>/g, '0')
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
        const name = url.pathname.slice(5);
        const handler = rpc[name];
        if (!handler) throw new Error('Preview has no back end for ' + name);
        const args = JSON.parse(body || '[]');
        const result = handler.apply(null, args);
        touchStamp(name, args);
        response.end(JSON.stringify({ result: result }));
      } catch (error) {
        response.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '') ? url.searchParams.get('date') : '';
  response.setHeader('content-type', 'text/html; charset=utf-8');
  const view = url.searchParams.get('view');
  response.end(view === 'cash' ? cashPage() : view === 'volunteers' ? stub + fs.readFileSync(path.join(DESK, 'VolunteerAdminPage.html'), 'utf8') : page(date));
}).listen(PORT, function () { console.log('Desk preview (in-memory, not Google): http://localhost:' + PORT + '/?date=2026-09-28 and the cash flow page at http://localhost:' + PORT + '/?view=cash'); });
