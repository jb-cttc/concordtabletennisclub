const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(__dirname + '/Index.html', 'utf8');
const tour = html.slice(html.indexOf('  var steps = [', html.indexOf("var exampleDate = '2026-09-23'")), html.indexOf('  var shield =', html.indexOf("var exampleDate = '2026-09-23'")));
assert.ok(tour.indexOf("target: '#device-save'") > tour.indexOf("title: 'Arrange the groups'"));
assert.ok(tour.indexOf("target: '#save'") > tour.indexOf("target: '#device-save'"));
assert.match(tour, /small dot appears on Save to Sheets; click it and wait for confirmation/);
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
  setGroups: groups => { context.state.groups = groups; },
  setStatus: message => { context.status = message; },
  confirm: () => true
};
context.recoverButton.name = 'recover';
context.exportButton.name = 'export';
context.discardButton.name = 'discard';
vm.createContext(context);
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

context.state.session.revision = 5;
context.offerDeviceDraft(context.date.value);
assert.equal(context.recoverButton.hidden, true, 'newer Sheet revision blocks recovery');
assert.equal(context.exportButton.hidden, false, 'conflicting device copy stays downloadable');
assert.equal(stored.has(key), true);
controls.discard();
assert.equal(stored.has(key), false);

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

const saveStart = html.indexOf('  async function save()');
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

checkSave().catch(function (error) { console.error(error); process.exitCode = 1; });