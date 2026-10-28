// Correcting a player's name, rating or email address from the pencil in the player directory, on the whole-desk
// simulator: the real server files and the real Index.html page. Synthetic players only.
const assert = require('node:assert/strict');
const sim = require('../scripts/lib/desk-sim');

const run = (world, ms) => world.clock.run(ms);
const table = (world, name) => {
  const sheet = world.server.spreadsheet.getSheetByName(name);
  if (!sheet) return null;
  const [headers, ...rows] = sheet.getDataRange().getValues();
  return rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
};
const player = (world, playerId) => table(world, 'Players').find(row => row.player_id === playerId);

(async () => {
  const world = sim.createWorld({ seed: 77, players: 12 });
  const server = world.server;
  const [ava, ben, cy] = world.players;
  const device = world.device();
  const tab = device.open();
  await run(world, 15000);
  [ava, ben, cy].forEach(p => tab.addPlayer(p.player_id));
  await run(world, 20000);

  // The pencil sits beside each name in the directory, and opens a window loaded with the current details.
  const search = tab.$('#search');
  search.value = ava.display_name;
  search.dispatchEvent(new tab.window.Event('input', { bubbles: true }));
  const pencil = tab.$('[data-edit-player="' + ava.player_id + '"]');
  assert.ok(pencil, 'a pencil beside the name');
  assert.equal(pencil.getAttribute('aria-label'), 'Edit ' + ava.display_name);
  const editor = tab.$('.player-editor');
  assert.equal(editor.hidden, true);
  tab.click(pencil);
  assert.equal(editor.hidden, false, 'the window opens at once');
  const field = name => editor.querySelector('[name="' + name + '"]');
  assert.equal(field('name').disabled, true, 'fields wait for the current details');
  await run(world, 5000);
  assert.equal(field('name').disabled, false);
  assert.equal(field('name').value, ava.display_name);
  assert.equal(field('rating').value, String(ava.current_rating));
  assert.equal(field('email').value, '', 'no email on file yet');

  const review = () => tab.click(editor.querySelector('[data-editor-review]'));
  const confirmStep = () => editor.querySelector('[data-step="confirm"]');
  const editError = () => editor.querySelector('[data-step="edit"] .player-editor-error').textContent;
  // Nothing to save, or a value the desk would refuse, never reaches the confirmation step.
  review();
  assert.match(editError(), /Nothing has changed/);
  assert.equal(confirmStep().hidden, true);
  field('rating').value = '4001';
  review();
  assert.match(editError(), /whole number from 0 to 4000/);
  field('rating').value = '1999';
  field('email').value = 'not-an-address';
  review();
  assert.match(editError(), /valid email/);

  // The confirmation lists each change; nothing is saved before Confirm.
  field('name').value = '  Ava   Exampel-Smith ';
  field('email').value = 'ava@example.test';
  review();
  assert.equal(confirmStep().hidden, false);
  const listed = [...confirmStep().querySelectorAll('.player-editor-changes li')].map(li => li.textContent);
  assert.deepEqual(listed, [
    'Name' + ava.display_name + ' → Ava Exampel-Smith',
    'Rating' + ava.current_rating + ' → 1999',
    'Email(none) → ava@example.test',
    'Other name added' + ava.display_name
  ], 'a renamed player keeps the old name as another name (the box starts ticked)');
  assert.equal(editor.querySelector('.player-editor-keep').hidden, false, 'the box shows once the name is changed');
  assert.equal(confirmStep().querySelectorAll('.player-editor-notes li').length, 4, 'what each change does is explained');
  assert.equal(player(world, ava.player_id).display_name, ava.display_name, 'not saved before Confirm');
  // Back keeps the edits; Confirm saves them.
  tab.click(editor.querySelector('[data-editor-back]'));
  assert.equal(confirmStep().hidden, true);
  assert.equal(field('name').value, '  Ava   Exampel-Smith ');
  review();
  tab.click(editor.querySelector('[data-editor-confirm]'));
  await run(world, 5000);
  assert.equal(editor.hidden, true, 'the window closes once Google confirms');
  assert.equal(tab.status(), 'Saved changes to Ava Exampel-Smith.');

  // Google holds the corrected record; the email address only in the private PlayerEmails tab.
  const saved = player(world, ava.player_id);
  assert.equal(saved.display_name, 'Ava Exampel-Smith');
  assert.equal(saved.current_rating, 1999);
  assert.ok(!Object.values(saved).includes('ava@example.test'), 'Players never holds an email address');
  assert.deepEqual(table(world, 'PlayerEmails').map(row => [row.player_id, row.email]), [[ava.player_id, 'ava@example.test']]);
  assert.deepEqual(table(world, 'NameChanges').map(row => [row.player_id, row.old_name, row.new_name]), [[ava.player_id, ava.display_name, 'Ava Exampel-Smith']]);

  // The page shows the new name and rating everywhere, and saves the draft again so the session uses the new rating.
  search.value = 'exampel';
  search.dispatchEvent(new tab.window.Event('input', { bubbles: true }));
  assert.match(tab.$('#results').textContent, /Ava Exampel-Smith/);
  assert.match(tab.$('#groups').textContent, /Ava Exampel-Smith/);
  assert.doesNotMatch(tab.$('#groups').textContent, new RegExp(ava.display_name + '(?!-)'));
  await run(world, 20000);
  const draft = server.run('getSessionByDate', world.date);
  assert.ok(draft, 'the draft was saved');
  const start = table(world, 'SessionPlayers').find(row => row.player_id === ava.player_id);
  assert.equal(start.starting_rating, 1999, 'the draft starts from the corrected rating');

  // The audit keeps what changed; the public desk log only which fields changed.
  const audit = table(world, 'AuditLog').filter(row => row.action === 'player_updated');
  assert.equal(audit.length, 1);
  const details = JSON.parse(audit[0].details_json);
  assert.deepEqual(details, { nameChanged: true, ratingChanged: true, emailChanged: true, name_from: ava.display_name, name_to: 'Ava Exampel-Smith', rating_from: String(ava.current_rating), rating_to: '1999',
    aliasesAdded: 1, aliasesChanged: 0, aliasesRemoved: 0, aliases: { added: [ava.display_name], changed: [], removed: [] } });
  assert.deepEqual(table(world, 'Aliases').filter(row => row.player_id === ava.player_id).map(row => row.alias), [ava.display_name], 'the old name is kept');
  assert.ok(!audit[0].details_json.includes('@'), 'the audit never holds the address');
  const logRow = table(world, 'CTTC Desk Logs').find(row => String(row.what).includes('player_updated'));
  assert.ok(logRow, 'the change is in the desk log');
  assert.doesNotMatch(String(logRow.detail), /Ava|Exampel|@|1999/);
  assert.match(String(logRow.detail), /aliasesAdded=1/, 'only how many other names changed');

  // Refused at Google: a name another player has, a name that was another player's before a correction, and a change
  // made on another device after the window loaded.
  assert.throws(() => server.run('updatePlayer', ben.player_id, { name: 'ava exampel-smith', rating: ben.current_rating, email: '' }), /already exists/);
  assert.throws(() => server.run('updatePlayer', ben.player_id, { name: ava.display_name, rating: ben.current_rating, email: '' }), /another player's name before a correction/);
  assert.throws(() => server.run('addPlayer', ava.display_name, 1500), /another player's name before a correction/);
  assert.throws(() => server.run('updatePlayer', ben.player_id, { name: 'Ben Example', rating: 1234, email: '' }, { name: ben.display_name, rating: ben.current_rating + 1, email: '' }), /changed on another device/);
  assert.throws(() => server.run('updatePlayer', ben.player_id, { name: '', rating: 1234, email: '' }), /1 through 80/);
  assert.throws(() => server.run('updatePlayer', ben.player_id, { name: 'Ben Example', rating: '', email: '' }), /whole number/);
  assert.throws(() => server.run('updatePlayer', 'nobody', { name: 'Nobody', rating: 1000, email: '' }), /Unknown player/);
  // A correction back to a player's own earlier name is theirs to make; the case of a name can be corrected too.
  assert.equal(server.run('updatePlayer', cy.player_id, { name: cy.display_name.toUpperCase(), rating: cy.current_rating, email: '' }).name, cy.display_name.toUpperCase());
  assert.equal(server.run('updatePlayer', cy.player_id, { name: cy.display_name, rating: cy.current_rating, email: '' }).name, cy.display_name);
  // Saving with nothing changed writes nothing.
  const before = table(world, 'AuditLog').length;
  server.run('updatePlayer', ben.player_id, { name: ben.display_name, rating: ben.current_rating, email: '' });
  assert.equal(table(world, 'AuditLog').length, before);

  // Name links (kept by name in the private NameLinks tab) follow a corrected name.
  const links = server.spreadsheet.getSheetByName('NameLinks');
  links.appendRow(['junior', ben.display_name, 'Ava Exampel-Smith', '']);
  server.run('updatePlayer', ava.player_id, { name: 'Ava Example-Smith', rating: 1999, email: 'ava@example.test' });
  assert.deepEqual(table(world, 'NameLinks').map(row => [row.kind, row.name, row.linked_name]), [['junior', ben.display_name, 'Ava Example-Smith']]);
  assert.equal(server.run('getMemberStatuses').statuses[ben.player_id], 'junior', 'the junior link still resolves');

  // A failure stays in the window, with the edits, so it can be tried again.
  search.value = ben.display_name;
  search.dispatchEvent(new tab.window.Event('input', { bubbles: true }));
  tab.click(tab.$('[data-edit-player="' + ben.player_id + '"]'));
  await run(world, 5000);
  field('name').value = 'Ava Example-Smith';
  review();
  tab.click(editor.querySelector('[data-editor-confirm]'));
  await run(world, 5000);
  assert.equal(editor.hidden, false);
  assert.match(confirmStep().querySelector('.player-editor-error').textContent, /already exists/);
  editor.dispatchEvent(new tab.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(editor.hidden, true, 'Escape closes the window');
  assert.equal(player(world, ben.player_id).display_name, ben.display_name);

  // ---- Other names (Aliases) ----
  const aliasesOf = id => table(world, 'Aliases').filter(row => row.player_id === id).map(row => row.alias);
  const openEditor = async p => {
    search.value = p.display_name;
    search.dispatchEvent(new tab.window.Event('input', { bubbles: true }));
    tab.click(tab.$('[data-edit-player="' + p.player_id + '"]'));
    await run(world, 5000);
  };
  const aliasInputs = () => [...editor.querySelectorAll('[data-aliases] input')];
  const listedChanges = () => [...confirmStep().querySelectorAll('.player-editor-changes li')].map(li => li.textContent);
  const confirm = async () => { tab.click(editor.querySelector('[data-editor-confirm]')); await run(world, 5000); };

  // Add: "+ Add another name" gives an empty row; the confirmation lists it.
  await openEditor(ben);
  assert.deepEqual(aliasInputs().map(input => input.value), [], 'no other names yet');
  tab.click(editor.querySelector('[data-alias-add]'));
  aliasInputs()[0].value = '  Benny   B ';
  review();
  assert.deepEqual(listedChanges(), ['Other name addedBenny B']);
  await confirm();
  assert.equal(editor.hidden, true);
  assert.deepEqual(aliasesOf(ben.player_id), ['Benny B']);
  // The directory finds Ben by it, and says why.
  search.value = 'benny';
  search.dispatchEvent(new tab.window.Event('input', { bubbles: true }));
  assert.match(tab.$('#results').textContent, new RegExp(ben.display_name + '.*Also goes by Benny B'));

  // Correct in place: typing over a name changes that row; it never adds a second one.
  await openEditor(ben);
  assert.deepEqual(aliasInputs().map(input => input.value), ['Benny B']);
  aliasInputs()[0].value = 'Benny Bee';
  review();
  assert.deepEqual(listedChanges(), ['Other name correctedBenny B → Benny Bee']);
  await confirm();
  assert.deepEqual(aliasesOf(ben.player_id), ['Benny Bee'], 'one row, corrected');

  // Remove, with a warning for what the name links today (here a Zeffy payment made under it).
  server.run('ensurePrivatePaymentTables_');
  server.spreadsheet.getSheetByName('ZeffyPayments').appendRow(['z1', '2026-09-01', 'purchase', 'Benny Bee', 'b@example.test', 'Benny Bee', '']);
  await openEditor(ben);
  tab.click(editor.querySelector('[data-alias-remove]'));
  assert.deepEqual(aliasInputs(), []);
  review();
  assert.deepEqual(listedChanges(), ['Other name removedBenny Bee']);
  assert.ok([...confirmStep().querySelectorAll('.player-editor-warning')].some(li => /^1 Zeffy payment under Benny Bee will no longer count for /.test(li.textContent)), 'the warning says what stops counting');
  await confirm();
  assert.deepEqual(aliasesOf(ben.player_id), []);

  // The window refuses a name listed twice, or the player's own name, before anything is sent.
  await openEditor(ben);
  tab.click(editor.querySelector('[data-alias-add]'));
  tab.click(editor.querySelector('[data-alias-add]'));
  aliasInputs()[0].value = 'Benny Bee';
  aliasInputs()[1].value = 'benny-bee';
  review();
  assert.match(editError(), /benny-bee is the same as Benny Bee/);
  aliasInputs()[1].value = ben.display_name.toUpperCase();
  review();
  assert.match(editError(), /is the same as the player's name/);
  editor.dispatchEvent(new tab.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  // Google refuses: a name that is another player's other name (case, punctuation and "Last, First" do not matter),
  // another player's directory name, or a name they had before a correction; renaming or adding a player to someone's
  // other name; and a list changed on another device after the window loaded.
  const keep = p => ({ name: p.display_name, rating: p.current_rating, email: '' });
  server.run('updatePlayer', ben.player_id, Object.assign(keep(ben), { aliases: [{ from: '', name: 'Benny Bee' }] }));
  assert.throws(() => server.run('updatePlayer', cy.player_id, Object.assign(keep(cy), { aliases: [{ from: '', name: 'Bee, Benny' }] })), new RegExp('Bee, Benny is already another name for ' + ben.display_name));
  assert.throws(() => server.run('updatePlayer', cy.player_id, Object.assign(keep(cy), { aliases: [{ from: '', name: 'ava example-smith' }] })), /another player's name in the directory/);
  assert.throws(() => server.run('updatePlayer', cy.player_id, Object.assign(keep(cy), { aliases: [{ from: '', name: 'Ava Example-Smith!' }] })), /another player's name in the directory/);
  assert.throws(() => server.run('updatePlayer', cy.player_id, Object.assign(keep(cy), { aliases: [{ from: '', name: 'Ava Exampel-Smith' }] })), /another player's name before a correction/);
  assert.throws(() => server.run('updatePlayer', cy.player_id, { name: 'Benny Bee', rating: cy.current_rating, email: '' }), /Benny Bee is another name for /);
  assert.throws(() => server.run('addPlayer', 'benny bee', 1500), /another name for an existing player/);
  assert.throws(() => server.run('updatePlayer', ben.player_id, Object.assign(keep(ben), { aliases: [] }), { aliases: [] }), /changed on another device/);
  assert.throws(() => server.run('updatePlayer', ben.player_id, Object.assign(keep(ben), { aliases: [{ from: 'Gone Name', name: 'X Y' }] })), /no longer one of this player's other names/);
  assert.throws(() => server.run('updatePlayer', ben.player_id, Object.assign(keep(ben), { aliases: [{ from: '', name: '!!!' }] })), /at least one letter or number/);
  // Left out, the list is kept as it is (an older page); sent unchanged, nothing is written.
  server.run('updatePlayer', ben.player_id, { name: ben.display_name, rating: ben.current_rating + 1, email: '' });
  assert.deepEqual(aliasesOf(ben.player_id), ['Benny Bee']);
  const quiet = table(world, 'AuditLog').length;
  server.run('updatePlayer', ben.player_id, Object.assign(keep(ben), { rating: ben.current_rating + 1, aliases: [{ from: 'Benny Bee', name: 'Benny Bee' }] }), { aliases: ['Benny Bee'] });
  assert.equal(table(world, 'AuditLog').length, quiet);
  // Several names at once: one corrected, one removed, one added; other players' rows stay where they are.
  server.run('updatePlayer', ben.player_id, Object.assign(keep(ben), { rating: ben.current_rating + 1, aliases: [{ from: 'Benny Bee', name: 'Benny Bee' }, { from: '', name: 'B. Example' }, { from: '', name: 'Benjamin E' }] }));
  server.run('updatePlayer', ben.player_id, Object.assign(keep(ben), { rating: ben.current_rating + 1, aliases: [{ from: 'B. Example', name: 'B Example' }, { from: '', name: 'Benji' }] }), { aliases: ['Benny Bee', 'B. Example', 'Benjamin E'] });
  assert.deepEqual(aliasesOf(ben.player_id).sort(), ['B Example', 'Benji']);
  assert.deepEqual(aliasesOf(ava.player_id), [ava.display_name]);
  assert.deepEqual(server.run('playerAliases_')['benji'], ben.player_id, 'the desk reads the new name at once');

  console.log('Player edit checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
