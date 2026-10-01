const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(__dirname + '/Index.html', 'utf8');
function slice(from, to) {
  const start = html.indexOf(from);
  assert.ok(start > 0, 'missing: ' + from);
  const end = html.indexOf(to, start);
  assert.ok(end > start, 'missing: ' + to);
  return html.slice(start, end);
}
const outboxAt = html.indexOf("var KEY = 'cttc-outbox-v1'");
assert.ok(outboxAt > 0, 'missing outbox script');
const outboxCode = html.slice(html.lastIndexOf('<script>', outboxAt) + 8, html.indexOf('</script>', outboxAt));
const directoryCode = slice('  function pendingActivations()', '  function renderGroups()');
const clickCode = slice("  results.addEventListener('click', function (e) {\n    var button = e.target.closest('[data-activate]');", "  groups.addEventListener('click'");

const tick = () => new Promise(resolve => setImmediate(resolve));
const server = [];
const events = [];
const calls = { autoSync: [], removed: [], status: [] };
const listeners = [];
const navigator = { onLine: true };
const node = () => ({ hidden: false, textContent: '', setAttribute() {}, addEventListener() {} });
const context = {
  window: { addEventListener() {} },
  navigator,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { body: { appendChild() {} }, createElement: node, dispatchEvent: event => events.push(event.type + ':' + (event.detail && event.detail.playerId)) },
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  google: { script: { run: { withSuccessHandler: ok => ({ withFailureHandler: bad => new Proxy({}, { get: (_, name) => (...args) => server.push({ name, args, ok, bad }) }) }) } } },
  setTimeout: () => 1,
  clearTimeout() {},
  esc: value => String(value),
  search: { value: '' },
  results: { innerHTML: '', addEventListener: (type, handler) => listeners.push(handler) },
  state: { players: [], archived: [], roster: [], showArchived: false },
  byId: {},
  byName: {},
  scheduleAutoSync: delay => calls.autoSync.push(delay),
  removeFromRoster: id => calls.removed.push(id),
  setStatus: message => calls.status.push(message)
};
vm.createContext(context);
vm.runInContext(outboxCode, context);
vm.runInContext(directoryCode, context);
vm.runInContext(clickCode, context);
const outbox = context.window.cttcOutbox;
const click = target => listeners.forEach(handler => handler({ target: Object.assign({ dataset: {}, closest: () => null }, target) }));
const press = (selector, id) => click({ closest: found => found === selector ? { getAttribute: () => id } : null });

(async () => {
  context.state.players = [{ playerId: 'a', name: 'Anna Lim', currentRating: 1200 }];
  context.state.archived = [{ playerId: 'x', name: 'Phil Lim', currentRating: 1890 }, { playerId: 'y', name: 'Old Limson', currentRating: 900 }];
  context.search.value = 'lim';

  context.renderDirectory();
  assert.match(context.results.innerHTML, /Show archived players \(2\)/, 'archived matches are offered, not shown');
  assert.doesNotMatch(context.results.innerHTML, /Phil Lim/);
  assert.match(context.results.innerHTML, /Anna Lim/, 'active matches still show');

  press('[data-show-archived]');
  assert.match(context.results.innerHTML, /class="archived"[^>]*data-archived="x"/);
  assert.match(context.results.innerHTML, /archived-badge">Archived</);
  assert.match(context.results.innerHTML, /data-activate="x">Make Active</);
  assert.doesNotMatch(context.results.innerHTML, /data-add="x"/, 'archived players have no RR or Open buttons');

  // Online: the row turns into an active player at once and Google is told in the background.
  press('[data-activate]', 'x');
  assert.deepEqual(server.map(call => [call.name, ...call.args]), [['activatePlayer', 'x', 'Phil Lim', 1890]]);
  assert.ok(context.state.players.some(p => p.playerId === 'x'), 'listed as active before Google answers');
  assert.equal(context.state.archived.some(p => p.playerId === 'x'), false);
  assert.match(context.results.innerHTML, /data-add="x"/, 'an active row has the normal buttons');
  assert.doesNotMatch(context.results.innerHTML, /data-archived="x"/);
  assert.equal(context.byId.x.name, 'Phil Lim');
  assert.ok(events.includes('cttc:players:x'), 'other panels learn about the player');
  assert.equal(context.pendingActivations(), true);
  assert.equal(calls.autoSync.length, 0);

  server[0].ok({ playerId: 'x' });
  await tick();
  assert.equal(context.pendingActivations(), false);
  assert.deepEqual(calls.autoSync, [0], 'the held-back draft sync restarts once Google knows the player');

  // Offline: nothing is sent, the change is queued, and a reload re-applies it to the lists Google returns.
  navigator.onLine = false;
  press('[data-activate]', 'y');
  assert.equal(server.length, 1, 'no call while offline');
  assert.ok(context.state.players.some(p => p.playerId === 'y'));
  assert.equal(outbox.entries('activatePlayer').length, 1);
  context.state.players = [{ playerId: 'a', name: 'Anna Lim', currentRating: 1200 }];
  context.state.archived = [{ playerId: 'y', name: 'Old Limson', currentRating: 900 }];
  context.applyPendingActivations();
  assert.deepEqual(context.state.players.map(p => p.playerId), ['a', 'y']);
  assert.equal(context.state.archived.length, 0);

  // Google refusing the change puts the player back and takes them out of the draft.
  navigator.onLine = true;
  outbox.flush();
  const refused = server[server.length - 1];
  assert.equal(refused.name, 'activatePlayer');
  refused.bad(new Error('Unknown player'));
  await tick();
  assert.equal(outbox.entries('activatePlayer').length, 0);
  assert.deepEqual(calls.removed, ['y']);
  assert.equal(context.state.players.some(p => p.playerId === 'y'), false);
  assert.ok(context.state.archived.some(p => p.playerId === 'y'));

  console.log('Archived player checks passed');
})().catch(error => { console.error(error); process.exit(1); });
