// Junior and pays-for links from the pencil in the player directory (the Links section of the edit window), on the
// whole-desk simulator: the real server files and the real Index.html page. Synthetic players only.
const assert = require('node:assert/strict');
const sim = require('../scripts/lib/desk-sim');

const run = (world, ms) => world.clock.run(ms);
const table = (world, name) => {
  const sheet = world.server.spreadsheet.getSheetByName(name);
  if (!sheet) return [];
  const [headers, ...rows] = sheet.getDataRange().getValues();
  return rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
};
const links = world => table(world, 'NameLinks').map(row => [row.kind, row.name, row.linked_name]);

(async () => {
  const world = sim.createWorld({ seed: 91, players: 12 });
  const server = world.server;
  const [ava, ben, cy, dee, eli] = world.players;
  const tab = world.device().open();
  await run(world, 15000);
  [ava, ben].forEach(p => tab.addPlayer(p.player_id));
  await run(world, 20000);

  const editor = tab.$('.player-editor');
  const field = name => editor.querySelector('[name="' + name + '"]');
  const box = () => editor.querySelector('.player-editor-links');
  async function openFor(person) {
    const search = tab.$('#search');
    search.value = person.display_name;
    search.dispatchEvent(new tab.window.Event('input', { bubbles: true }));
    tab.click(tab.$('[data-edit-player="' + person.player_id + '"]'));
    await run(world, 5000);
    assert.equal(field('name').disabled, false, 'loaded');
  }
  const listed = kind => Array.from(editor.querySelectorAll('[data-link-list="' + kind + '"] input')).map(input => input.value);
  const add = (kind, name) => { tab.click(editor.querySelector('[data-link-add="' + kind + '"]')); const inputs = editor.querySelectorAll('[data-link-list="' + kind + '"] input'); inputs[inputs.length - 1].value = name; };
  const review = () => tab.click(editor.querySelector('[data-editor-review]'));
  const editError = () => editor.querySelector('[data-step="edit"] .player-editor-error').textContent;
  const confirmText = () => editor.querySelector('[data-step="confirm"]').textContent;
  const confirm = async () => { tab.click(editor.querySelector('[data-editor-confirm]')); await run(world, 5000); };
  const tick = (checked) => { field('junior').checked = checked; field('junior').dispatchEvent(new tab.window.Event('change', { bubbles: true })); };

  // The window shows a Links section: not a junior, nobody on their account, pays for nobody.
  await openFor(ben);
  assert.equal(box().hidden, false);
  assert.equal(field('junior').checked, false);
  assert.equal(editor.querySelector('.player-editor-member').hidden, true, 'the member account appears only for a junior');
  assert.deepEqual(listed('juniors'), []);
  assert.deepEqual(listed('paysFor'), []);
  assert.ok(editor.querySelectorAll('#player-editor-directory option').length >= 12, 'every active player can be picked');

  // Junior, on Ava's account: listed for confirmation, then saved as one NameLinks row.
  tick(true);
  assert.equal(editor.querySelector('.player-editor-member').hidden, false);
  field('member').value = 'Nobody Here';
  review();
  assert.match(editError(), /Nobody Here is not one player in the directory/);
  field('member').value = ' ' + ava.display_name.toLowerCase() + ' ';
  review();
  assert.equal(editError(), '');
  assert.match(confirmText(), /JuniorNo → Yes/);
  assert.match(confirmText(), new RegExp('Member account\\(none\\) → ' + ava.display_name));
  assert.match(confirmText(), /pays the junior fee from now on/);
  assert.deepEqual(links(world), [], 'nothing saved before Confirm');
  await confirm();
  assert.equal(editor.hidden, true);
  assert.deepEqual(links(world), [['junior', ben.display_name, ava.display_name]]);
  assert.equal(server.run('getMemberStatuses').statuses[ben.player_id], 'junior');
  await run(world, 10000);
  const badge = tab.$('[data-move="' + ben.player_id + '"]').closest('li').querySelector('.member-badge');
  assert.equal(badge.textContent, 'J', 'the badge follows at once');
  const audit = table(world, 'AuditLog').filter(row => row.action === 'player_updated').pop();
  assert.deepEqual(JSON.parse(audit.details_json).links, { added: [['junior', ben.display_name, ava.display_name]], removed: [] });
  const logRow = table(world, 'CTTC Desk Logs').filter(row => String(row.what).includes('player_updated')).pop();
  assert.match(String(logRow.detail), /linksAdded=1/);
  assert.ok(!String(logRow.detail).includes(ava.display_name), 'the public desk log never holds a name');

  // Ava's window shows Ben on her account. She pays for Cy; Ben comes off her account.
  await openFor(ava);
  assert.deepEqual(listed('juniors'), [ben.display_name]);
  add('paysFor', cy.display_name);
  tab.click(editor.querySelector('[data-link-list="juniors"] [data-link-remove]'));
  review();
  assert.match(confirmText(), new RegExp('Now pays for' + cy.display_name));
  assert.match(confirmText(), new RegExp('Junior removed from this account' + ben.display_name));
  assert.match(confirmText(), /one payment from .*card can match the players they pay for/);
  await confirm();
  assert.deepEqual(links(world), [['pays_for', ava.display_name, cy.display_name]]);
  assert.notEqual(server.run('getMemberStatuses').statuses[ben.player_id], 'junior');
  // Cy's window says who pays for them, and the Clover rules read the link.
  await openFor(cy);
  assert.match(editor.querySelector('[data-paid-by]').textContent, new RegExp('Paid for by ' + ava.display_name));
  tab.click(editor.querySelector('[data-editor-cancel]'));
  assert.deepEqual(JSON.parse(JSON.stringify(server.run('cloverPaysFor_', server.run('listPlayers'), server.run('nameLinkRows_'))[ava.player_id])), [cy.player_id]);

  // The window refuses, before anything is sent: a player listed twice, the player themselves, and a junior with juniors.
  await openFor(dee);
  add('paysFor', eli.display_name);
  add('paysFor', eli.display_name);
  review();
  assert.match(editError(), /listed twice/);
  editor.querySelectorAll('[data-link-list="paysFor"] input')[1].value = dee.display_name;
  review();
  assert.match(editError(), /cannot be linked to themselves/);
  editor.querySelectorAll('[data-link-list="paysFor"] [data-link-remove]')[1].click();
  add('juniors', eli.display_name);
  tick(true);
  review();
  assert.match(editError(), /A junior cannot have juniors/);
  tab.click(editor.querySelector('[data-editor-cancel]'));

  // A junior added to another account moves there: one row, never two.
  server.run('updatePlayer', ava.player_id, { name: ava.display_name, rating: ava.current_rating, email: '', links: { junior: false, memberId: '', juniors: [eli.player_id], paysFor: [cy.player_id] } });
  server.run('updatePlayer', dee.player_id, { name: dee.display_name, rating: dee.current_rating, email: '', links: { junior: false, memberId: '', juniors: [eli.player_id], paysFor: [] } });
  assert.deepEqual(links(world).filter(row => row[0] === 'junior'), [['junior', eli.display_name, dee.display_name]]);

  // Google refuses: links changed on another device after the window loaded, a member who is a junior, and a player
  // whose name another player shares (links go by name). Nothing is written.
  const before = links(world);
  assert.throws(() => server.run('updatePlayer', ava.player_id, { name: ava.display_name, rating: ava.current_rating, email: '', links: { junior: false, memberId: '', juniors: [], paysFor: [] } },
    { links: { junior: false, memberId: '', juniors: [], paysFor: [] } }), /changed on another device/);
  assert.throws(() => server.run('updatePlayer', ben.player_id, { name: ben.display_name, rating: ben.current_rating, email: '', links: { junior: true, memberId: eli.player_id, juniors: [], paysFor: [] } }), /is a junior\. Choose the member/);
  server.run('updatePlayer', cy.player_id, { name: cy.display_name, rating: cy.current_rating, email: '' });
  const twin = server.run('addPlayer', cy.display_name.toUpperCase() + '.', 1500);
  assert.ok(twin);
  assert.throws(() => server.run('updatePlayer', ben.player_id, { name: ben.display_name, rating: ben.current_rating, email: '', links: { junior: false, memberId: '', juniors: [], paysFor: [cy.player_id] } }), /shares a name with another player/);
  assert.deepEqual(links(world), before);

  // A rename and a link change wait for each other; a rename with the links unchanged is fine.
  assert.throws(() => server.run('updatePlayer', dee.player_id, { name: 'Dee Renamed', rating: dee.current_rating, email: '', links: { junior: false, memberId: '', juniors: [], paysFor: [] } }), /Save the new name first/);
  server.run('updatePlayer', dee.player_id, { name: 'Dee Renamed', rating: dee.current_rating, email: '', links: { junior: false, memberId: '', juniors: [eli.player_id], paysFor: [] } });
  assert.deepEqual(links(world).filter(row => row[0] === 'junior'), [['junior', eli.display_name, 'Dee Renamed']], 'the junior row follows the new name');

  console.log('Player link checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
