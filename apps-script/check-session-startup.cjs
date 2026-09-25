const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(__dirname + '/Index.html', 'utf8');
const start = html.indexOf('  function fetchHistory(sessionDate) {');
const end = html.indexOf('  async function load() {', start);
assert.ok(start >= 0 && end > start, 'session history functions exist');

const calls = [];
const context = {
  state: { winners: [], previousDate: null, historyError: '' },
  byName: {},
  historyRequest: 0,
  O: {
    previousSameWeekday: () => '2026-09-16',
    publishedWinner: () => 'Avery Park'
  },
  siteJson: file => {
    calls.push(file);
    if (file === 'sessions.json') return Promise.resolve([{ date: '2026-09-16' }]);
    return Promise.resolve([{ date: '2026-09-16', groups: [{ players: [] }, { name: 'Group 2', players: [] }] }]);
  }
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

async function check() {
  const pending = context.fetchHistory('2026-09-23');
  assert.deepEqual(calls, ['sessions.json'], 'history fetch starts before app state completes');
  const outcome = await pending;
  assert.deepEqual(calls, ['sessions.json', 'session-details-2026.json']);
  assert.equal(context.state.winners.length, 0, 'fetch does not resolve player IDs early');
  context.byName['Avery Park'] = 'player-a';
  await context.loadHistory('2026-09-23', Promise.resolve(outcome));
  assert.equal(context.state.previousDate, '2026-09-16');
  assert.equal(context.state.winners[0].playerId, 'player-a');
  assert.equal(context.state.winners[0].groupName, 'Group 2');

  await context.loadHistory('2026-09-23', Promise.resolve({ error: new Error('Offline') }));
  assert.equal(context.state.historyError, 'Offline');
  assert.equal(context.state.winners.length, 0);

  const playerExpressions = [...html.matchAll(/var playerRequest = (initialPlayers \? .* : .*);/g)].map(match => match[1]);
  assert.equal(playerExpressions.length, 2, 'Open Play and Voice share startup players');
  for (const expression of playerExpressions) {
    let fallbackCalls = 0;
    const fallback = () => { fallbackCalls += 1; return Promise.resolve(['fallback']); };
    const players = ['shared'];
    const shared = vm.runInNewContext(expression, { initialPlayers: Promise.resolve(players), request: fallback, window: { cttcRequest: fallback } });
    assert.equal((await shared)[0], 'shared');
    assert.equal(fallbackCalls, 0, 'normal startup should not request another player list');
    const failed = vm.runInNewContext(expression, { initialPlayers: Promise.reject(new Error('App state unavailable')), request: fallback, window: { cttcRequest: fallback } });
    assert.equal((await failed)[0], 'fallback');
    assert.equal(fallbackCalls, 1, 'failed app state should not disable the other sections');
  }
  console.log('Session startup history checks passed');
}

check().catch(error => { console.error(error); process.exitCode = 1; });