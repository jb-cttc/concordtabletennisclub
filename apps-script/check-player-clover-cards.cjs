// Clover cards in the pencil window (Index.html's player editor, CloverPayments.js), on the whole-desk simulator: the
// section shows only for a player with a linked card, Unlink opens a review, and Confirm forgets the card and undoes
// only the matches left ticked. Synthetic players, cards and amounts only.
const assert = require('node:assert/strict');
const sim = require('../scripts/lib/desk-sim');

const run = (world, ms) => world.clock.run(ms);
const table = (world, name) => {
  const sheet = world.server.spreadsheet.getSheetByName(name);
  if (!sheet) return [];
  const [headers, ...rows] = sheet.getDataRange().getValues();
  return rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
};
const fill = (world, name, headers, rows) => {
  const sheet = world.server.spreadsheet.getSheetByName(name) || world.server.spreadsheet.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  rows.forEach(row => sheet.appendRow(headers.map(header => (header in row ? row[header] : ''))));
};

(async () => {
  const world = sim.createWorld({ seed: 57, players: 8 });
  const server = world.server;
  const [ava, ben] = world.players;
  const learned = new Date('2026-11-09T03:20:00Z');
  // Ben's card was remembered as Ava's by mistake on Nov 9, then matched her by itself on Nov 16.
  fill(world, 'CloverLinks', ['link_key', 'player_id', 'source', 'updated_at'], [
    { link_key: 'card:MC|511111|7777', player_id: ava.player_id, source: 'hand', updated_at: learned },
    { link_key: 'customer:C7', player_id: ava.player_id, source: 'hand', updated_at: learned }
  ]);
  const match = (date, id, minute) => ({ payment_id: id, session_id: 'session-' + date, player_id: ava.player_id, how: id === 'P1' ? 'hand' : 'card', amount: 10, card: 'MC ••7777', paid_at: new Date(Date.parse(date + 'T03:00:00Z') + minute * 60000), updated_at: learned });
  fill(world, 'CloverMatches', ['payment_id', 'session_id', 'player_id', 'how', 'amount', 'card', 'paid_at', 'updated_at'], [match('2026-11-09', 'P1', 20), match('2026-11-16', 'P2', 2)]);
  server.run('ensurePrivatePaymentTables_');
  fill(world, 'SessionPayments', table(world, 'SessionPayments').length ? Object.keys(table(world, 'SessionPayments')[0]) : ['session_id', 'player_id', 'method', 'updated_at'], [
    { session_id: 'session-2026-11-09', player_id: ava.player_id, method: 'credit' },
    { session_id: 'session-2026-11-16', player_id: ava.player_id, method: 'credit' }
  ]);
  const method = date => (table(world, 'SessionPayments').find(row => row.session_id === 'session-' + date && row.player_id === ava.player_id) || {}).method;

  const tab = world.device().open();
  await run(world, 15000);
  const editor = tab.$('.player-editor');
  const box = () => editor.querySelector('.player-editor-clover');
  async function openFor(person) {
    const search = tab.$('#search');
    search.value = person.display_name;
    search.dispatchEvent(new tab.window.Event('input', { bubbles: true }));
    tab.click(tab.$('[data-edit-player="' + person.player_id + '"]'));
    await run(world, 5000);
    assert.equal(editor.querySelector('[name="name"]').disabled, false, 'loaded');
  }
  const close = () => tab.click(editor.querySelector('[data-editor-cancel]'));

  // No linked card: no Clover cards section.
  await openFor(ben);
  assert.equal(box().hidden, true);
  close();

  // Ava's window lists the card with its Clover customer, and how it was learned.
  await openFor(ava);
  assert.equal(box().hidden, false);
  const cards = [...box().querySelectorAll('[data-clover-cards] > li')];
  assert.equal(cards.length, 1);
  assert.match(cards[0].textContent, /^MC ••7777 and its Clover customerMatched by hand, (Sun|Mon), Nov (8|9) · 2 payments matched/);

  // Unlink opens the review; nothing changes before Confirm. Before CLOVER_ENABLED it cannot be confirmed.
  tab.click(box().querySelector('[data-clover-unlink]'));
  const review = () => box().querySelector('[data-clover-review]');
  assert.match(review().textContent, new RegExp('Unlink MC ••7777 and its Clover customer from ' + ava.display_name + '\\?'));
  const ticks = [...review().querySelectorAll('input[type=checkbox]')];
  assert.deepEqual(ticks.map(tick => tick.checked), [true, true]);
  assert.match(ticks[0].parentNode.textContent, new RegExp('^Mon, Nov 16, .* \\$10: ' + ava.display_name + ' \\(card used before\\)$'), 'newest first');
  const confirm = () => [...review().querySelectorAll('button')].find(button => button.textContent === 'Confirm and unlink');
  assert.equal(confirm().disabled, true, 'Clover is not switched on yet');
  assert.match(review().textContent, /Unlinking turns on with CLOVER_ENABLED/);
  close();

  // Switched on: untick the first match (Nov 9 was right after all), confirm.
  Object.assign(server.properties, { CLOVER_API_TOKEN: 'test-token', CLOVER_MERCHANT_ID: 'ABC123DEF4567', CLOVER_ENABLED: 'true' });
  await openFor(ava);
  tab.click(box().querySelector('[data-clover-unlink]'));
  const nov9 = [...review().querySelectorAll('input[type=checkbox]')].find(tick => /Nov 9/.test(tick.parentNode.textContent));
  nov9.checked = false;
  assert.equal(confirm().disabled, false);
  tab.click(confirm());
  await run(world, 5000);
  assert.deepEqual(table(world, 'CloverLinks').filter(row => row.player_id === ava.player_id), [], 'the card and its Clover customer are forgotten');
  assert.equal(method('2026-11-16'), '', 'the ticked match goes back to unpaid');
  assert.equal(method('2026-11-09'), 'credit', 'the unticked one stays');
  assert.deepEqual(table(world, 'CloverMatches').filter(row => row.payment_id === 'P2').map(row => [row.player_id, row.how]), [['', 'held']]);
  assert.match(box().querySelector('[data-clover-note]').textContent, /^Unlinked MC ••7777 and its Clover customer\. 1 match undone: open that night on the desk/);
  assert.equal(box().querySelectorAll('[data-clover-cards] > li').length, 0);
  const audit = table(world, 'AuditLog').filter(row => row.action === 'clover_card_unlinked').pop();
  assert.deepEqual(JSON.parse(audit.details_json).before.map(entry => entry.link), ['MC ••7777', 'Clover customer']);
  const logRow = table(world, 'CTTC Desk Logs').filter(row => String(row.what).includes('clover_card_unlinked')).pop();
  assert.match(String(logRow.detail), /links=2 undone=1/);
  assert.ok(!/7777|MC/.test(String(logRow.detail)), 'the public desk log never holds the card');
  close();

  // Opened again: no card left, so no section.
  await openFor(ava);
  assert.equal(box().hidden, true);
  close();

  world.devices.forEach(device => device.close && device.close());
  console.log('Clover cards in the pencil window: checks passed');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
