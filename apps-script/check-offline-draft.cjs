const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(__dirname + '/Index.html', 'utf8');
const tour = html.slice(html.indexOf('  var steps = [', html.indexOf("var exampleDate = '2026-09-23'")), html.indexOf('  var shield =', html.indexOf("var exampleDate = '2026-09-23'")));
assert.ok(tour.indexOf("target: '#device-save'") > tour.indexOf("title: 'Arrange the groups'"));
assert.ok(tour.indexOf("target: '#save'") > tour.indexOf("target: '#device-save'"));
assert.match(tour, /changes sync to Google Sheets by themselves/);
const start = html.indexOf('  function showDraftNotice(');
const end = html.indexOf('  function setGroups(', start);
assert.ok(start > 0 && end > start, 'device draft functions must exist');

const stored = new Map();
const controls = {};
function button() {
  return {
    hidden: true,
    addEventListener: function (event, handler) { controls[this.name] = handler; }
  };
}
const classes = new Set();
const syncClasses = new Set();
const context = {
  localStorage: {
    getItem: key => stored.get(key) || null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: key => stored.delete(key)
  },
  document: { hidden: true, querySelector: () => ({ classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) } }) },
  draftNotice: { hidden: true },
  draftMessage: { textContent: '' },
  saveButton: {
    classList: { toggle: (name, enabled) => enabled ? syncClasses.add(name) : syncClasses.delete(name) },
    setAttribute: function (name, value) { this[name] = value; }
  },
  navigator: { onLine: false },
  deviceDraftUnsynced: false,
  connectionConfirmed: false,
  probeInFlight: false,
  probeSequence: 0,
  lastProbeAt: 0,
  saveNeedsReload: false,
  saveInFlight: false,
  AUTO_SYNC_DELAY_MS: 1500,
  AUTO_RETRY_MS: [5000, 15000, 30000, 60000],
  AUTO_RETRY_LIMIT: 6,
  autoSyncTimer: null,
  syncBlocked: false,
  syncConflict: false,
  reconcileNeeded: false,
  reconciling: false,
  syncFailures: 0,
  lastSyncError: '',
  runAutoSync: function () {},
  setTimeout: function () { return 1; },
  clearTimeout: function () {},
  groupArrays: () => context.state.groups.map(group => group.playerIds.slice()),
  recoverButton: button(),
  exportButton: button(),
  discardButton: button(),
  draftKeyPrefix: 'cttc-rr-draft-v1:',
  date: { value: '2026-10-07' },
  loadedDate: '2026-10-07',
  pendingRecovery: null,
  state: {
    session: { revision: 4, status: 'active', groups: [], matches: [] },
    roster: ['player-example'], groups: [{ groupNumber: 1, playerIds: ['player-example'] }],
    matches: [{ playerOneId: 'player-example', playerTwoId: 'player-other', playerOneGames: 3, playerTwoGames: 1 }],
    promotions: {}, customized: true
  },
  byId: { 'player-example': { name: 'Example Player' } },
  locked: () => false,
  pendingActivations: () => false,
  setGroups: arrays => { context.state.groups = arrays.map((playerIds, index) => ({ groupNumber: index + 1, playerIds })); },
  setStatus: message => { context.status = message; },
  confirm: () => true,
  lockBusy: '',
  renderFinalizeButton: () => {},
  reports: [],
  reportDeskProblem: (kind, message, extra) => { context.reports.push({ kind, message, extra }); }
};
const keyStart = html.indexOf('  function matchSignature(');
vm.createContext(context);
vm.runInContext(html.slice(keyStart, html.indexOf('\n  }\n', html.indexOf('  function contentKey(')) + 4), context);
context.recoverButton.name = 'recover';
context.exportButton.name = 'export';
context.discardButton.name = 'discard';
vm.runInContext(html.slice(start, end), context);

context.deviceDraftUnsynced = true;
context.updateSyncCue();
context.probeConnection();
context.deviceDraftUnsynced = false;
const key = context.draftKeyPrefix + context.date.value;
context.persistDeviceDraft();
const original = stored.get(key);
assert.equal(JSON.parse(original).revision, 4);
assert.equal(JSON.parse(original).matches[0].playerOneGames, 3);
assert.equal(context.draftMessage.textContent.includes('Unsynced'), true);

context.state.roster = [];
context.state.matches = [];
context.offerDeviceDraft(context.date.value);
assert.equal(context.recoverButton.hidden, false);
assert.equal(classes.has('draft-pending'), true);
context.persistDeviceDraft();
assert.equal(stored.get(key), original, 'pending recovery must not be overwritten');
controls.recover();
assert.deepEqual(Array.from(context.state.roster), ['player-example']);
assert.equal(context.state.matches[0].playerOneGames, 3);
assert.equal(context.pendingRecovery, null);
assert.equal(classes.has('draft-pending'), false);

// A copy older than Google's version is never restored by itself, but it can be chosen on purpose.
context.state.session.revision = 5;
context.offerDeviceDraft(context.date.value);
assert.equal(context.canRecoverDraft(context.pendingRecovery, context.state.session), false, 'newer Sheet revision blocks plain recovery');
assert.equal(context.recoverButton.hidden, false, 'a stale copy can still be chosen');
assert.equal(context.recoverButton.textContent, "Use this device's copy");
assert.equal(context.discardButton.textContent, "Keep Google's version");
assert.match(context.draftMessage.textContent, /Google Sheets: 0 players, 0 of 0 matches scored\. This device: 1 player, 1 of 1 match scored\. They differ in 1 match result and the groups\. Google Sheets changed after this copy was made.*Choose which to keep\./);
assert.match(context.draftMessage.textContent, /Finalize and the other buttons are paused until you choose/);
assert.equal(context.exportButton.hidden, false, 'conflicting device copy stays downloadable');
assert.equal(context.reports.pop().kind, 'device copy not restorable', 'a copy that needs a choice is reported');
context.confirm = () => false;
controls.recover();
assert.notEqual(context.pendingRecovery, null, 'declining to replace Google keeps the choice open');
controls.discard();
assert.equal(stored.has(key), true, 'declining to discard keeps the copy');
context.confirm = () => true;
controls.discard();
assert.equal(stored.has(key), false);
assert.equal(classes.has('draft-pending'), false);

// Choosing the stale copy loads it at Google's revision, so it syncs over Google's version.
stored.set(key, original);
context.state.roster = [];
context.state.matches = [];
context.offerDeviceDraft(context.date.value);
controls.recover();
assert.deepEqual(Array.from(context.state.roster), ['player-example']);
assert.equal(context.pendingRecovery, null);
assert.equal(JSON.parse(stored.get(key)).revision, 5, 'the chosen copy now builds on Google\'s revision');
assert.match(context.status, /replaces Google Sheets' version/);

// A finalized session is never replaced by a device copy.
context.state.session = { revision: 6, status: 'finalized', groups: [], matches: [] };
stored.set(key, original);
context.offerDeviceDraft(context.date.value);
assert.equal(context.recoverButton.hidden, true);
assert.match(context.draftMessage.textContent, /already finalized in Google Sheets/);
controls.recover();
assert.notEqual(context.pendingRecovery, null, 'the recover action refuses over a finalized session');
controls.discard();

// A copy Google already holds (a save that arrived after its reply was lost) goes quietly.
context.state.session = {
  revision: 9, status: 'active', groups: [{ groupNumber: 1, players: [{ playerId: 'player-example' }] }],
  matches: [{ playerOneId: 'player-example', playerTwoId: 'player-other', playerOneGames: 3, playerTwoGames: 1, forfeit: false, forfeitedBy: null, wonBy: null }]
};
stored.set(key, original);
context.reports.length = 0;
context.offerDeviceDraft(context.date.value);
assert.equal(stored.has(key), false, 'an identical copy is dropped');
assert.equal(context.pendingRecovery, null);
assert.equal(context.draftNotice.hidden, true, 'and nothing asks the desk to choose');
assert.equal(context.reports.length, 0);

// Copies that differ only in what contentKey ignores are kept: a promotion, or which group number holds whom.
const twoGroups = { version: 1, date: '2026-10-07', revision: 3, roster: ['p1', 'p2'], groups: [{ groupNumber: 1, playerIds: ['p1'] }, { groupNumber: 2, playerIds: ['p2'] }], matches: [], promotions: { p2: { fromGroup: 3 } } };
const serverTwo = (first, second, promoted) => ({ revision: 9, status: 'active', groups: [{ groupNumber: 1, players: [{ playerId: first }] }, { groupNumber: 2, players: [{ playerId: second, promotionFromGroup: promoted }] }], matches: [] });
context.state.session = serverTwo('p1', 'p2', 3);
stored.set(key, JSON.stringify(twoGroups));
context.offerDeviceDraft(context.date.value);
assert.equal(stored.has(key), false, 'same groups, numbering and promotions: identical');
context.state.session = serverTwo('p1', 'p2', null);
stored.set(key, JSON.stringify(twoGroups));
context.offerDeviceDraft(context.date.value);
assert.equal(stored.has(key), true, 'a promotion only on this device is not dropped');
assert.match(context.draftMessage.textContent, /They differ in promotions\./);
context.state.session = serverTwo('p2', 'p1', 3);
context.offerDeviceDraft(context.date.value);
assert.match(context.draftMessage.textContent, /They differ in the groups and promotions\./, 'swapped group numbers are a difference');
context.clearDeviceDraft(context.date.value);

context.state.session = null;
context.state.roster = ['player-example'];
context.persistDeviceDraft();
context.state.session = { revision: 1, status: 'draft', groups: [], matches: [] };
context.offerDeviceDraft(context.date.value);
assert.equal(context.recoverButton.hidden, false, 'empty session created before a lost response can recover');
context.state.session.groups = [{ groupNumber: 1, players: [{ playerId: 'player-example' }] }];
assert.equal(context.canRecoverDraft(context.pendingRecovery, context.state.session), false, 'nonempty server session blocks recovery');

stored.set(key, '{broken');
context.offerDeviceDraft(context.date.value);
assert.equal(context.recoverButton.hidden, true, 'unreadable copy cannot be restored');
assert.equal(context.exportButton.hidden, false, 'unreadable copy can be downloaded');
context.persistDeviceDraft();
assert.equal(stored.get(key), '{broken', 'unreadable copy must not be overwritten');

const saveStart = html.indexOf('  async function save(');
const saveEnd = html.indexOf('  async function finalize()', saveStart);
assert.ok(saveStart > 0 && saveEnd > saveStart, 'save functions must exist');
let googleCalls = 0;
let probeCalls = 0;
let probeSuccess;
let probeFailure;
let saveTimeout;
context.pendingRecovery = null;
context.state.session = null;
context.state.roster = ['player-example'];
context.saveNeedsReload = false;
context.saveInFlight = false;
context.call = function () { googleCalls += 1; return new Promise(function () {}); };
context.google = { script: { run: {
  withSuccessHandler: function (handler) { probeSuccess = handler; return this; },
  withFailureHandler: function (handler) { probeFailure = handler; return this; },
  checkDeskConnection: function () { probeCalls += 1; }
} } };
context.printState = function () { return JSON.stringify(context.state); };
context.render = function () {};
context.setTimeout = function (handler) { saveTimeout = handler; return 1; };
context.clearTimeout = function () {};
stored.delete(key);
vm.runInContext(html.slice(saveStart, saveEnd), context);

async function checkSave() {
  const deviceResult = await context.save();
  assert.equal(deviceResult.deviceOnly, true);
  assert.equal(googleCalls, 0, 'offline save must not call Google');
  assert.equal(stored.has(key), true);
  assert.match(context.status, /device only/);
  assert.equal(syncClasses.has('sync-ready'), false, 'offline device copies must not suggest Google is reachable');

  context.navigator.onLine = true;
  context.probeConnection(true);
  assert.equal(probeCalls, 1);
  assert.equal(googleCalls, 0, 'read-only probe must not save a session');
  probeSuccess(true);
  assert.equal(syncClasses.has('sync-ready'), true);
  assert.match(context.saveButton.title, /ready to save/);
  context.probeConnection();
  assert.equal(probeCalls, 1, 'editing a draft must not repeatedly ping Google');
  context.probeConnection(true);
  probeFailure();
  assert.equal(syncClasses.has('sync-ready'), false, 'failed probe clears the cue');

  context.connectionConfirmed = true;
  context.updateSyncCue();
  assert.equal(syncClasses.has('sync-ready'), true);
  const uncertain = context.save();
  assert.equal(syncClasses.has('sync-ready'), false, 'the save spinner must not be replaced by the sync dot');
  assert.equal(googleCalls, 1);
  saveTimeout();
  assert.equal(await uncertain, null);
  assert.equal(context.saveNeedsReload, true);
  assert.equal(stored.has(key), true);
  assert.equal(await context.save(), null);
  assert.equal(googleCalls, 1, 'uncertain Google write must not be retried blindly');
  assert.equal(context.saveOnDevice().deviceOnly, true);
  assert.equal(googleCalls, 1, 'explicit device save never contacts Google');
  assert.equal(syncClasses.has('sync-ready'), false, 'uncertain writes cannot be marked ready to retry');
  const finalizeStart = html.indexOf('  async function finalize()');
  const finalizeEnd = html.indexOf('  window.cttcDesk =', finalizeStart);
  assert.ok(finalizeStart > 0 && finalizeEnd > finalizeStart);
  vm.runInContext(html.slice(finalizeStart, finalizeEnd), context);
  context.navigator.onLine = false;
  await context.finalize();
  assert.equal(googleCalls, 1, 'device-only saves cannot finalize ratings');
  assert.match(context.status, /Finalization requires a confirmed Google Sheets save/);
  context.saveNeedsReload = false;
  context.clearDeviceDraft(context.date.value);
  context.probeConnection(true);
  assert.equal(probeCalls, 2, 'no background ping is needed without a device draft');
  assert.equal(syncClasses.has('sync-ready'), false);
  console.log('Offline draft recovery and save checks passed');
}

async function checkAutoSync() {
  context.printState = function () { const s = context.state; return JSON.stringify({ roster: s.roster, groups: s.groups, matches: s.matches, promotions: s.promotions }); };
  const timers = [];
  context.setTimeout = (handler, ms) => { timers.push({ handler, ms, live: true }); return timers.length; };
  context.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].live = false; };
  const fire = async ms => {
    const timer = timers.filter(item => item.live && item.ms === ms).pop();
    assert.ok(timer, 'expected a ' + ms + 'ms timer');
    timer.live = false;
    await timer.handler();
  };
  const live = ms => timers.some(item => item.live && item.ms === ms);

  let server = null;
  let failNext = 0;
  let applyBeforeFailing = false;
  const sent = [];
  const apply = payload => {
    server = {
      sessionId: 'session-2026-10-07', status: 'active', revision: (server ? server.revision : 1) + 1,
      groups: payload.groups.map(group => ({ groupNumber: group.groupNumber, players: group.playerIds.map(playerId => ({ playerId })) })),
      matches: JSON.parse(JSON.stringify(payload.matches))
    };
  };
  context.call = async (name, payload) => {
    sent.push(name);
    if (name === 'getAppState') return { session: server && JSON.parse(JSON.stringify(server)) };
    if (name === 'createSession') {
      server = { sessionId: 'session-2026-10-07', status: 'draft', revision: 1, groups: [], matches: [] };
      return JSON.parse(JSON.stringify(server));
    }
    if (payload.revision !== server.revision) throw new Error('This session changed on another device. Reload before saving.');
    if (failNext) {
      failNext -= 1;
      if (applyBeforeFailing) apply(payload);
      throw new Error('Google did not respond in 10 seconds');
    }
    apply(payload);
    return JSON.parse(JSON.stringify(server));
  };
  const reset = () => {
    context.navigator.onLine = true;
    context.pendingRecovery = null;
    context.saveNeedsReload = false;
    context.saveInFlight = false;
    context.reconcileNeeded = false;
    context.reconciling = false;
    context.syncBlocked = false;
    context.syncConflict = false;
    context.syncFailures = 0;
    context.deviceDraftUnsynced = false;
    context.draftNotice.hidden = true;
    context.draftMessage.textContent = '';
    stored.delete(key);
    context.status = 'untouched';
  };

  // Online: an edit is sent a moment later, with no notice and no status message.
  reset();
  server = null;
  context.state.session = null;
  context.state.groups = [{ groupNumber: 1, playerIds: ['player-example'] }];
  context.persistDeviceDraft();
  assert.equal(context.draftNotice.hidden, true, 'no offline notice while online');
  assert.equal(live(1500), true);
  await fire(1500);
  assert.deepEqual(sent, ['createSession', 'saveSessionDraft']);
  assert.equal(stored.has(key), false, 'the device copy is dropped once Google confirms');
  assert.equal(context.draftNotice.hidden, true);
  assert.equal(context.status, 'untouched', 'a quiet sync does not touch the status bar');

  // A failed send keeps the device copy, says so, and retries after checking what Google holds.
  context.state.matches[0].playerOneGames = 2;
  context.persistDeviceDraft();
  failNext = 1;
  await fire(1500);
  assert.equal(context.draftNotice.hidden, false);
  assert.match(context.draftMessage.textContent, /retrying automatically/);
  assert.equal(context.reconcileNeeded, true);
  assert.equal(stored.has(key), true);
  const beforeRetry = sent.filter(name => name === 'saveSessionDraft').length;
  await fire(5000);
  assert.equal(sent.filter(name => name === 'saveSessionDraft').length, beforeRetry, 'checking Google does not save');
  assert.equal(live(0), true, 'nothing newer on Google, so the save is retried');
  await fire(0);
  assert.equal(stored.has(key), false);
  assert.equal(context.draftNotice.hidden, true);
  assert.match(context.status, /Changes saved to Google Sheets/);

  // The failed send had actually arrived: it is adopted, never sent twice.
  context.state.matches[0].playerOneGames = 1;
  context.persistDeviceDraft();
  failNext = 1;
  applyBeforeFailing = true;
  await fire(1500);
  applyBeforeFailing = false;
  const savesBefore = sent.filter(name => name === 'saveSessionDraft').length;
  await fire(5000);
  assert.equal(sent.filter(name => name === 'saveSessionDraft').length, savesBefore, 'a write that arrived is not repeated');
  assert.equal(stored.has(key), false);
  assert.equal(context.state.session.revision, server.revision);
  assert.equal(context.reconcileNeeded, false);

  // Google holds something different: nothing is overwritten and the device copy stays.
  context.state.matches[0].playerOneGames = 0;
  context.persistDeviceDraft();
  failNext = 1;
  await fire(1500);
  server.revision += 1;
  server.matches[0].playerOneGames = 3;
  const writes = sent.filter(name => name === 'saveSessionDraft').length;
  await fire(5000);
  assert.equal(context.syncConflict, true);
  assert.match(context.draftMessage.textContent, /different version/);
  assert.equal(sent.filter(name => name === 'saveSessionDraft').length, writes);
  assert.equal(stored.has(key), true);
  context.persistDeviceDraft();
  assert.equal(live(1500), false, 'a conflicted draft is never auto-sent');

  // Offline: kept on the device with a notice, then sent when the connection returns.
  reset();
  server = { sessionId: 'session-2026-10-07', status: 'active', revision: 9, groups: [{ groupNumber: 1, players: [{ playerId: 'player-example' }] }], matches: [] };
  context.state.session = JSON.parse(JSON.stringify(server));
  context.navigator.onLine = false;
  context.persistDeviceDraft();
  assert.match(context.draftMessage.textContent, /Offline: it will sync to Google Sheets automatically/);
  assert.equal(live(1500), false, 'nothing is sent while offline');
  context.navigator.onLine = true;
  context.scheduleAutoSync(0);
  await fire(0);
  assert.equal(stored.has(key), false);
  assert.equal(context.draftNotice.hidden, true);

  // After repeated failures it stops retrying by itself and tells the user how to retry.
  reset();
  context.state.session = JSON.parse(JSON.stringify(server));
  context.persistDeviceDraft();
  context.syncFailures = 5;
  failNext = 1;
  await fire(1500);
  assert.match(context.draftMessage.textContent, /Click Save to Sheets to try again/);
  assert.equal(live(60000), false, 'no further automatic retries');
  console.log('Automatic sync checks passed');
}

checkSave().then(checkAutoSync).catch(function (error) { console.error(error); process.exitCode = 1; });