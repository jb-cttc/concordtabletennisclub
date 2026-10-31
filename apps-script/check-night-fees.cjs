// What a night costs (NightFees.js): the $10 first visit, the organizer's choice on the desk, and each night's member
// status, through the cash flow, the payment overview, Clover matching and the real desk page, on the whole-desk
// simulator (scripts/lib/desk-sim.js). Synthetic players only.
process.env.TZ = 'America/Los_Angeles';
const assert = require('node:assert/strict');
const sim = require('../scripts/lib/desk-sim');

const DATE = '2026-10-14';
const EARLIER = '2026-10-07';
const LATER = '2026-10-21';
const plain = value => JSON.parse(JSON.stringify(value));

(async () => {
  // ---------------------------------------------------------------------------------------------------------------
  // The fee for one night.
  const world = sim.createWorld({ seed: 77, players: 8 });
  const server = world.server;
  const ctx = server.context;
  const run = (name, ...args) => server.run(name, ...args);
  const runPlain = (name, ...args) => plain(run(name, ...args));
  assert.equal(run('nightFee_', 'visitor', false), 15);
  assert.equal(run('nightFee_', 'visitor', true), 10, 'a first visit is $10');
  assert.equal(run('nightFee_', 'member', true), 10);
  assert.equal(run('nightFee_', 'member', false), 10);
  assert.equal(run('nightFee_', 'junior', true), 5, 'a junior pays $5 on any night');
  assert.equal(run('nightFee_', undefined, false), 15, 'an archived player counts as a visitor');

  // ---------------------------------------------------------------------------------------------------------------
  // A player added tonight is on a first visit; players from the older records (created on another day) are not.
  const [ava, ben, cy, dee] = world.players.map(player => player.player_id);
  const added = run('addPlayer', 'New Example', 800);
  const roster = (date, ids) => ctx.appendObjects_('SessionPlayers', ids.map(id => ({ session_id: 'session-' + date, player_id: id, group_number: 1, starting_rating: 1500, promotion_from_group: '' })));
  roster(EARLIER, [ben]);
  roster(DATE, [added.playerId, ava, ben, cy, dee]);
  roster(LATER, [added.playerId, ben, cy]);
  const hasTab = () => !!server.spreadsheet.getSheetByName('FirstVisits');
  assert.deepEqual(runPlain('getPrivatePaymentOverview', DATE).firstVisitIds, [added.playerId], 'the payment overview names tonight\'s first visits');
  assert.deepEqual(runPlain('getPrivatePaymentOverview', LATER).firstVisitIds, [], 'the next night is not a first visit');
  assert.equal(hasTab(), false, 'reading never adds the FirstVisits tab');

  const day = (flow, date, id) => flow.days.find(item => item.date === date).playerList.find(player => player.name === ctx.findRow_('Players', 'player_id', id).display_name);
  let flow = plain(run('getCashFlow', EARLIER, LATER));
  assert.deepEqual(flow.fees, { junior: 5, member: 10, visitor: 15, intro: 10 });
  assert.deepEqual(day(flow, DATE, added.playerId), { name: 'New Example', status: 'visitor', firstVisit: true, kind: 'rr', method: '', owed: 10, collected: 0 });
  assert.equal(day(flow, LATER, added.playerId).owed, 15, 'after the first visit, the visitor fee');
  assert.equal(day(flow, LATER, added.playerId).firstVisit, false);
  assert.equal(day(flow, DATE, ava).owed, 15, 'a player from the older records with no earlier desk night pays the visitor fee');
  assert.equal(hasTab(), false);

  // ---------------------------------------------------------------------------------------------------------------
  // The organizer's choice wins, for that night only.
  assert.deepEqual(runPlain('setFirstVisit', DATE, added.playerId, false), []);
  assert.deepEqual(runPlain('setFirstVisit', DATE, ava, true), [ava]);
  assert.deepEqual(runPlain('setFirstVisit', DATE, ava, true), [ava], 'choosing again changes the same row');
  assert.equal(server.rows('FirstVisits').length, 2);
  assert.deepEqual(runPlain('getPrivatePaymentOverview', DATE).firstVisitIds, [ava]);
  flow = plain(run('getCashFlow', EARLIER, LATER));
  assert.equal(day(flow, DATE, added.playerId).owed, 15);
  assert.equal(day(flow, DATE, ava).owed, 10);
  assert.deepEqual(plain(server.audit.filter(entry => entry.action === 'first_visit_updated').map(entry => entry.details)), [
    { playerId: added.playerId, firstVisit: false }, { playerId: ava, firstVisit: true }, { playerId: ava, firstVisit: true }
  ]);
  assert.throws(() => run('setFirstVisit', DATE, ava, 'yes'), /Valid player and first visit required/);
  assert.throws(() => run('setFirstVisit', DATE, 'player-nobody', true), /Unknown or inactive player/);
  assert.throws(() => run('setFirstVisit', 'tonight', ava, true), /date/i);
  run('setFirstVisit', DATE, added.playerId, true);
  run('setFirstVisit', DATE, ava, false);

  // ---------------------------------------------------------------------------------------------------------------
  // Each night's status. Ben joined on 10/18 (between DATE and LATER); Cy has been a member since before the desk kept a
  // record of changes; Dee is a junior.
  run('nameLinkRows_');
  ctx.appendObjects_('NameLinks', [{ kind: 'junior', name: 'Dee Example', linked_name: '' }]);
  run('ensureMemberStatusTable_');
  ctx.appendObjects_('MemberStatus', [{ player_id: ben, status: 'member', updated_at: new Date() }, { player_id: cy, status: 'member', updated_at: new Date() }]);
  ctx.appendObjects_('AuditLog', [{ event_id: 'sim-join', event_time: new Date('2026-10-18T19:10:00-07:00'), actor: 'sim', action: 'member_status_updated', entity_type: 'player', entity_id: ben, details_json: JSON.stringify({ status: 'member', linked: [] }) }]);
  flow = plain(run('getCashFlow', EARLIER, LATER));
  assert.deepEqual([EARLIER, DATE, LATER].map(date => [day(flow, date, ben).status, day(flow, date, ben).owed]), [['visitor', 15], ['visitor', 15], ['member', 10]], 'a visitor who joined later is a visitor on the nights before');
  assert.deepEqual([DATE, LATER].map(date => day(flow, date, cy).owed), [10, 10]);
  assert.deepEqual([day(flow, DATE, dee).status, day(flow, DATE, dee).owed], ['junior', 5]);
  const statusesOn = run('memberStatusFinder_', { [ben]: 'visitor' }, [], [], [
    { action: 'member_status_updated', entity_id: ben, event_time: new Date('2026-10-10T19:00:00-07:00'), details_json: '{"status":"member"}' },
    { action: 'member_status_updated', entity_id: ben, event_time: new Date('2026-10-17T19:00:00-07:00'), details_json: '{"status":"unclassified"}' }
  ]);
  assert.deepEqual([EARLIER, DATE, LATER].map(date => String(statusesOn(date)[ben])), ['visitor', 'member', 'visitor'], 'the last change by the end of each night');

  // ---------------------------------------------------------------------------------------------------------------
  // Clover: a first visit's $10 card payment fits the newcomer, and a card learns from it.
  assert.equal(run('cloverFee_', added.playerId, { statuses: { [added.playerId]: 'visitor' }, firstVisits: { [added.playerId]: true } }), 10);
  assert.equal(run('cloverFee_', added.playerId, { statuses: { [added.playerId]: 'visitor' } }), 15);
  const card = { kind: 'card', state: 'paid', net: 1000, brand: 'VISA', first6: '411111', last4: '1234', customer: null, time: 1 };
  const learned = plain(run('cloverLearnCards_', [{ date: DATE, payments: [card], credit: [added.playerId, ava], statuses: { [added.playerId]: 'visitor', [ava]: 'visitor' }, firstVisits: { [added.playerId]: true } }], {}, {}));
  assert.deepEqual(learned.links, { 'card:VISA|411111|1234': added.playerId }, 'the $10 card is the newcomer\'s, not the $15 visitor\'s');

  // ---------------------------------------------------------------------------------------------------------------
  // The desk page: a player added at the desk shows 1st, and the payment menu changes it for the night.
  const desk = sim.createWorld({ seed: 78, players: 6 });
  desk.server.run('nameLinkRows_');
  desk.server.context.appendObjects_('NameLinks', [{ kind: 'junior', name: 'Cy Example', linked_name: '' }]);
  const device = desk.device();
  const tab = device.open();
  await desk.clock.run(15000);
  desk.players.slice(0, 3).forEach(player => tab.addPlayer(player.player_id));
  await desk.clock.run(20000);
  const doc = tab.window.document;
  doc.getElementById('new-name').value = 'Newer Example';
  doc.getElementById('new-rating').value = '700';
  doc.getElementById('new-player').dispatchEvent(new tab.window.Event('submit', { bubbles: true, cancelable: true }));
  await desk.clock.run(15000);
  tab.click(doc.querySelector('.new-player-choice [data-place="rr"]'));
  await desk.clock.run(15000);
  const newer = desk.server.rows('Players').find(row => row.display_name === 'Newer Example').player_id;
  const row = (page, id) => page.window.document.querySelector('[data-payment-player="' + id + '"]').parentNode;
  const badge = (page, id) => row(page, id).querySelector('.member-badge');
  const firstButton = (page, id) => row(page, id).querySelector('.payment-options .first-visit');
  assert.equal(badge(tab, newer).textContent, '1st', 'a player added tonight shows 1st');
  assert.match(badge(tab, newer).getAttribute('data-tip'), /first visit: \$10 tonight/);
  assert.equal(firstButton(tab, newer).getAttribute('aria-pressed'), 'true');
  assert.equal(firstButton(tab, newer).textContent, 'First visit $10 ✓');
  assert.match(row(tab, newer).querySelector('.payment-trigger').title, /first visit, \$10/);
  const old = desk.players[0].player_id;
  assert.equal(badge(tab, old).textContent, 'V');
  assert.equal(firstButton(tab, old).getAttribute('aria-pressed'), 'false');
  const junior = desk.players[2].player_id;
  assert.equal(badge(tab, junior).textContent, 'J');
  assert.equal(firstButton(tab, junior).hidden, true, 'a junior pays $5 on any night: no first-visit choice');

  firstButton(tab, newer).dispatchEvent(new tab.window.MouseEvent('click', { bubbles: true, detail: 1 }));
  firstButton(tab, old).dispatchEvent(new tab.window.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.equal(badge(tab, newer).textContent, 'V', 'the badge changes at once');
  assert.equal(badge(tab, old).textContent, '1st');
  await desk.clock.run(30000);
  assert.deepEqual(plain(desk.server.rows('FirstVisits').map(entry => [entry.player_id, entry.first_visit])), [[newer, false], [old, true]]);
  assert.equal(firstButton(tab, old).getAttribute('aria-pressed'), 'true', 'Google\'s answer agrees with the page');
  assert.deepEqual(tab.errors, []);

  // A page opened afresh shows what Google holds.
  const fresh = desk.device().open();
  await desk.clock.run(30000);
  assert.equal(badge(fresh, newer).textContent, 'V');
  assert.equal(badge(fresh, old).textContent, '1st');
  assert.equal(firstButton(fresh, old).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(fresh.errors, []);

  console.log('Night fee checks passed: first visits, the organizer\'s choice, each night\'s status, Clover, the desk page');
})().catch(error => { console.error(error); process.exit(1); });
