const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(__dirname + '/Index.html', 'utf8');
function block(marker) {
  const at = html.indexOf(marker);
  assert.ok(at > 0, 'missing script: ' + marker);
  return html.slice(html.lastIndexOf('<script>', at) + 8, html.indexOf('</script>', at));
}
const outboxCode = block("var KEY = 'cttc-outbox-v1'");
const paymentsCode = block("var CACHE_PREFIX = 'cttc-payment-overview-v1:'");
const openCode = block('function openKey(');
const DATE = '2026-10-05';
const OVERVIEW = { methods: {}, coveredIds: [], passes: [] };
const tick = () => new Promise(resolve => setImmediate(resolve));

function boot(store) {
  const server = [];
  const reads = [];
  const events = [];
  const timers = [];
  const byId = {};
  const windowListeners = {};
  const navigator = { onLine: true };
  let timerId = 0;
  function element(id) {
    const item = {
      id, hidden: false, textContent: '', value: '', listeners: {},
      setAttribute() {}, classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(type, handler) { (item.listeners[type] = item.listeners[type] || []).push(handler); },
      append() {}, appendChild() {}, replaceChildren() {}, dispatchEvent() {}, querySelector: () => null, querySelectorAll: () => []
    };
    return item;
  }
  const dateField = element('date');
  dateField.value = DATE;
  const count = element('count');
  const win = {
    addEventListener: (name, handler) => { (windowListeners[name] = windowListeners[name] || []).push(handler); },
    cttcRequest: (name, ...args) => new Promise((resolve, reject) => reads.push({ name, args, resolve, reject }))
  };
  const context = {
    window: win,
    navigator,
    localStorage: { getItem: key => store.has(key) ? store.get(key) : null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) },
    document: {
      getElementById: id => id === 'date' ? dateField : byId[id] || (byId[id] = element(id)),
      createElement: () => element(''),
      body: { appendChild(node) { if (node.id === 'sync-note') byId['sync-note'] = node; } },
      querySelectorAll: () => [],
      querySelector: selector => selector === '.open-play-section .count' ? count : null,
      addEventListener() {},
      dispatchEvent: event => { events.push(event.type); }
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Event: class { constructor(type) { this.type = type; } },
    MutationObserver: class { observe() {} },
    google: { script: { run: { withSuccessHandler: ok => ({ withFailureHandler: bad => new Proxy({}, { get: (_, name) => (...args) => server.push({ name, args, ok, bad }) }) }) } } },
    setTimeout: (fn, ms) => { timers.push({ id: ++timerId, fn, ms }); return timerId; },
    clearTimeout: id => { const at = timers.findIndex(timer => timer.id === id); if (at >= 0) timers.splice(at, 1); }
  };
  vm.createContext(context);
  for (const code of [outboxCode, paymentsCode, openCode]) vm.runInContext(code, context);
  const app = {
    server, reads, events, timers, navigator, win, count, dateField,
    sends: () => server.filter(call => call.name !== 'getPrivatePaymentOverview'),
    note: () => byId['sync-note'],
    waiting: () => JSON.parse(JSON.stringify(win.cttcOutbox.entries())),
    online: () => windowListeners.online.forEach(handler => handler()),
    fire: ms => { const at = timers.findIndex(timer => timer.ms === ms); assert.ok(at >= 0, 'expected a ' + ms + 'ms timer'); timers.splice(at, 1)[0].fn(); },
    answer: (name, value) => { const read = reads.find(item => item.name === name && !item.done); assert.ok(read, 'no pending read ' + name); read.done = true; read.resolve(value); },
    fail: (name, error) => { const read = reads.find(item => item.name === name && !item.done); read.done = true; read.reject(error); },
    addOpen: playerId => byId.results.listeners.click.forEach(handler => handler({ stopPropagation() {}, target: { closest: selector => selector === '[data-open-add]' ? { getAttribute: () => playerId } : null } })),
    removeOpen: playerId => byId['open-roster'].listeners.click.forEach(handler => handler({ target: { closest: selector => selector === '[data-open-remove]' ? { getAttribute: () => playerId } : null } }))
  };
  while (timers.some(timer => timer.ms === 0)) app.fire(0);
  return app;
}
const PLAYERS = ['a', 'b', 'c', 'd'].map((playerId, index) => ({ playerId, name: 'Player ' + playerId, currentRating: 1000 + index }));

(async () => {
  // Credit and Unpaid travel the same path as the other methods, and nothing waits on Google.
  const store = new Map();
  let app = boot(store);
  assert.equal(app.note().hidden, true, 'nothing to report at first');
  app.answer('getPrivatePaymentOverview', { methods: { a: 'cash' }, coveredIds: [], passes: [] });
  await tick();
  app.win.cttcPayments.choose('p1', 'credit');
  assert.deepEqual(app.sends().map(call => call.args), [[DATE, 'p1', 'credit']]);
  assert.ok(store.has('cttc-outbox-v1'), 'the choice is on the device before Google answers');
  assert.match(app.note().textContent, /1 change saved on this device/);
  app.sends()[0].ok('credit');
  await tick();
  assert.equal(app.waiting().length, 0);
  assert.equal(store.has('cttc-outbox-v1'), false, 'confirmed changes leave the device queue');
  assert.equal(app.note().hidden, true);
  app.win.cttcPayments.choose('a', '');
  assert.deepEqual(app.sends()[1].args, [DATE, 'a', ''], 'a paid player can be set back to unpaid');
  app.sends()[1].ok('');
  await tick();
  const before = app.sends().length;
  app.win.cttcPayments.choose('zz', '');
  assert.equal(app.sends().length, before, 'clearing a player who is already unpaid sends nothing');

  // Offline: changes are kept, the last one per item wins, and nothing is sent until the connection returns.
  app.navigator.onLine = false;
  app.win.cttcPayments.choose('p2', 'venmo');
  app.win.cttcPayments.choose('p3', 'cash');
  app.win.cttcPayments.choose('p3', 'credit');
  assert.equal(app.sends().length, before, 'no call is attempted while offline');
  assert.deepEqual(app.waiting().map(item => item.args[1] + ':' + item.args[2]), ['p2:venmo', 'p3:credit']);
  assert.match(app.note().textContent, /2 changes saved on this device.*\(offline\)/);

  const reloaded = boot(store);
  assert.deepEqual(reloaded.waiting().map(item => item.args[1]), ['p2', 'p3'], 'a reloaded desk keeps the queue');
  assert.equal(reloaded.sends()[0].args[1], 'p2', 'and resumes syncing');

  app.navigator.onLine = true;
  app.online();
  assert.deepEqual(app.sends()[before].args, [DATE, 'p2', 'venmo']);
  app.sends()[before].ok('venmo');
  await tick();
  assert.deepEqual(app.sends()[before + 1].args, [DATE, 'p3', 'credit'], 'queued changes send in order');

  // A network failure keeps the change and retries; Google's own refusal drops it and says why.
  app.sends()[before + 1].bad(new Error('A server error occurred'));
  await tick();
  assert.deepEqual(app.waiting().map(item => item.args[1]), ['p3']);
  assert.match(app.note().textContent, /waiting to sync \(A server error occurred\)/);
  app.fire(5000);
  assert.equal(app.sends().length, before + 3, 'the retry timer sends again');
  app.sends()[before + 2].bad({ message: 'Zeffy play pass covers this session' });
  await tick();
  assert.equal(app.waiting().length, 0, 'a refused change is not retried forever');
  assert.match(app.note().textContent, /was not saved: Zeffy play pass covers this session/);

  // A call that never answers is abandoned after its timeout and retried.
  app.win.cttcPayments.choose('p4', 'zelle');
  const hung = app.sends().length;
  app.fire(20000);
  await tick();
  assert.equal(app.waiting().length, 1);
  app.fire(5000);
  assert.equal(app.sends().length, hung + 1);
  app.sends()[hung].ok('zelle');
  await tick();
  assert.equal(app.waiting().length, 0);

  // Open Play: a rapid double click adds the player once; add then remove while offline is one change.
  const open = boot(new Map());
  open.answer('listPlayers', PLAYERS);
  open.answer('getOpenPlayParticipants', ['a']);
  open.answer('getCoachingParticipants', [{ playerId: 'a', name: 'Coach A', role: 'coach', lessons: [{ start: '19:00', minutes: 30, coachLabel: 'A' }] }]);
  await tick();
  assert.equal(open.count.textContent, '1', 'a coached player also added with Open is listed once');
  open.addOpen('b');
  open.addOpen('b');
  assert.equal(open.count.textContent, '2', 'two quick clicks must not list the player twice');
  assert.equal(open.waiting().length, 1);
  assert.deepEqual(open.sends().map(call => call.args), [[DATE, 'b', true]]);
  open.removeOpen('b');
  assert.equal(open.count.textContent, '1', 'one remove takes the player off the list');
  open.navigator.onLine = false;
  open.addOpen('c');
  open.removeOpen('c');
  assert.equal(open.count.textContent, '1');
  assert.deepEqual(open.waiting().map(item => item.args[1] + ':' + item.args[2]), ['b:false', 'c:false']);
  open.navigator.onLine = true;

  // A reload shows the server list with this device's unsent changes on top.
  const pending = new Map([['cttc-outbox-v1', JSON.stringify([{ key: 'open:' + DATE + ':d', fn: 'setOpenPlayParticipant', args: [DATE, 'd', true], version: 0 }])]]);
  const resumed = boot(pending);
  resumed.answer('listPlayers', PLAYERS);
  resumed.answer('getOpenPlayParticipants', ['a']);
  resumed.answer('getCoachingParticipants', []);
  await tick();
  assert.equal(resumed.count.textContent, '2');
  resumed.sends()[0].bad({ message: 'Player is already in the saved round robin' });
  await tick();
  assert.equal(resumed.count.textContent, '1', 'a refused add comes back off the list');
  assert.match(resumed.note().textContent, /Player d in Open Play was not saved/);

  // Opened with no connection: the last known payments show at once; with none, the desk says so instead of spinning.
  const cached = boot(new Map([['cttc-payment-overview-v1:' + DATE, JSON.stringify({ methods: { p9: 'cash' }, coveredIds: [], passes: [] })]]));
  assert.ok(cached.events.includes('cttc:payment-overview'), 'cached payments are used without waiting for Google');
  const bare = boot(new Map());
  bare.fail('getPrivatePaymentOverview', new Error('Google did not respond in 30 seconds'));
  await tick();
  assert.ok(bare.events.includes('cttc:payment-unavailable'));
  assert.match(bare.note().textContent, /Payment status not loaded/);
  bare.win.cttcPayments.choose('p5', 'cash');
  assert.equal(bare.sends().length, 1, 'choices are still accepted and sent');
  console.log('Offline action checks passed');
})().catch(error => { console.error(error); process.exit(1); });
