const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Volunteer Admin, the desk side (VolunteerAdmin.js): the admin key, the calls to the volunteer app, and new players added
// to the desk's registry before their training, only once the volunteer app agrees to every change. Made-up people only.
const calls = [];
let answers = [];
let wake = [['key'], ['w'.repeat(64)]];
const cache = {};
const added = [];
const audits = [];
let players = [{ player_id: 'p-ann', display_name: 'Ann Example', active: true }];
const context = {
  JSON, Object, Array, Number, String, Error,
  CacheService: { getScriptCache: () => ({ get: key => cache[key] || null, put: (key, value) => { cache[key] = value; } }) },
  SpreadsheetApp: { getActive: () => ({ getSheetByName: name => (name === 'AppWake' ? {
    getLastRow: () => wake.length,
    getRange: (row, column, rows, columns) => ({
      getValues: () => [[(wake[row - 1] || [])[column - 1] || '']],
      setNumberFormat() { return this; },
      setValues: values => { values.forEach((line, index) => { (wake[row - 1 + index] = wake[row - 1 + index] || [])[column - 1] = line[0]; }); }
    })
  } : null) }) },
  Utilities: { getUuid: () => '1234abcd-1234-abcd-1234-abcd1234abcd' },
  UrlFetchApp: { fetch: (url, options) => {
    calls.push({ url, body: JSON.parse(options.payload) });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return { getResponseCode: () => (next === 500 ? 500 : 200), getContentText: () => JSON.stringify(next) };
  } },
  HtmlService: { createHtmlOutputFromFile: name => { assert.equal(name, 'VolunteerAdminPage'); const page = { setTitle: () => page, addMetaTag: () => page, setXFrameOptionsMode: () => page }; return page; }, XFrameOptionsMode: { ALLOWALL: 1 } },
  WAKE_TAB_: 'AppWake',
  wakeKey_: () => 'w'.repeat(64),
  listPlayers: () => players.map(row => ({ playerId: row.player_id, name: row.display_name, currentRating: 1500 })),
  rows_: name => (name === 'Players' ? players : name === 'Aliases' ? [{ alias: 'Annie', player_id: 'p-ann' }] : []),
  normalizeName_: value => String(value || '').trim().replace(/\s+/g, ' '),
  previousNameOwner_: name => (name === 'Old Name' ? 'p-ann' : ''),
  aliasKey_: name => String(name).toLowerCase(),
  addPlayer: (name, rating) => { const made = { playerId: 'player-' + (added.length + 1), name, currentRating: rating }; added.push(made); players.push({ player_id: made.playerId, display_name: name, active: true }); return made; },
  appendAudit_: (action, kind, id, details) => { audits.push({ action, id, details }); }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/VolunteerAdmin.js', 'utf8'), context);
const plain = value => JSON.parse(JSON.stringify(value));

// The admin key is made once, beside the wake key, and is not the wake key.
answers = [{ ok: true, nights: [], training: [], recent: [] }];
const board = plain(context.getVolunteerAdmin());
assert.deepEqual(wake.map(row => row[1]), ['admin_key', '1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd']);
assert.equal(calls[0].body.key, wake[1][1]);
assert.notEqual(calls[0].body.key, wake[1][0], 'its own key, not the wake key');
assert.deepEqual(calls[0].body, { fn: 'admin', key: wake[1][1], action: 'board' });
assert.match(calls[0].url, /^https:\/\/script\.google\.com\/macros\/s\/AKfycbx_[A-Za-z0-9_-]+\/exec$/, 'the volunteer app\'s released address');
assert.equal(calls[0].url, /staffing: \{ url: '([^']+)'/.exec(fs.readFileSync(__dirname + '/MailReader.js', 'utf8'))[1], 'the same app the mail reader wakes');
assert.deepEqual(board.players, [{ playerId: 'p-ann', name: 'Ann Example', rating: 1500 }], 'the desk\'s own registry to search');
assert.throws(() => { answers = [500]; context.getVolunteerAdmin(); }, /did not answer/);
assert.throws(() => { answers = [{ ok: false, message: 'Unknown request.' }]; context.getVolunteerAdmin(); }, /Unknown request/);

// A new player with training: checked by the volunteer app first, then added to the desk, then the training saved.
const bucket = { newPlayers: [{ tempId: 'new-42', name: '  Bea   Newcomb ', rating: 1200 }],
  changes: [{ kind: 'training', playerId: 'new-42', skill: 'front_desk', value: true }, { kind: 'remove', id: 's1', was: { date: '2026-11-20', position: 'close' } }] };
calls.length = 0;
answers = [{ ok: true, preview: true, emails: [] }];
assert.equal(context.previewVolunteerAdmin(bucket, 'hi').ok, true);
assert.equal(added.length, 0, 'a preview adds nobody');
assert.deepEqual(plain(calls[0].body.newPlayers), [{ playerId: 'new-42', name: 'Bea Newcomb' }]);
assert.equal(calls[0].body.preview, true);
assert.equal(calls[0].body.note, 'hi');

calls.length = 0;
answers = [{ ok: true, preview: true }, { ok: true, changeId: 'c1', changes: 2, emailed: 1, people: 1 }];
let result = plain(context.submitVolunteerAdmin(bucket, ''));
assert.equal(result.ok, true);
assert.deepEqual(added.map(player => [player.name, player.currentRating]), [['Bea Newcomb', 1200]], 'added to the desk with its rating, as from the desk');
assert.deepEqual(calls.map(call => !!call.body.preview), [true, false], 'checked, then applied');
assert.equal(calls[1].body.changes[0].playerId, 'player-1', 'the training is saved for the desk\'s new player');
assert.deepEqual(plain(calls[1].body.newPlayers), [{ playerId: 'player-1', name: 'Bea Newcomb' }]);
assert.deepEqual(result.added, [{ tempId: 'new-42', playerId: 'player-1', name: 'Bea Newcomb' }]);
assert.deepEqual(plain(audits.pop().details), { changes: 2, emailed: 1, people: 1, playersAdded: 1, ok: true });

// Refused by the volunteer app: nobody is added.
calls.length = 0;
answers = [{ ok: false, problems: [{ index: 1, reason: 'This shift changed since the page loaded.' }], message: 'One change cannot be made, so nothing was changed.' }];
const again = { newPlayers: [{ tempId: 'new-7', name: 'Cy Newcomb', rating: 900 }], changes: [{ kind: 'training', playerId: 'new-7', skill: 'keys', value: true }] };
result = plain(context.submitVolunteerAdmin(again, ''));
assert.equal(result.ok, false);
assert.equal(added.length, 1, 'nobody added');
assert.equal(calls.length, 1);

// What the desk would refuse is refused before anything is sent.
for (const [player, reason] of [[{ tempId: 'new-1', name: 'Dee', rating: '' }, /whole number from 0 through 4000/], [{ tempId: 'new-1', name: 'Dee', rating: 1.5 }, /whole number/],
  [{ tempId: 'new-1', name: 'ann example', rating: 1000 }, /already on the desk/], [{ tempId: 'new-1', name: 'Old Name', rating: 1000 }, /another player's name before a correction/],
  [{ tempId: 'new-1', name: 'Annie', rating: 1000 }, /another name for an existing player/], [{ tempId: 'bad', name: 'Eve', rating: 1000 }, /not valid/], [{ tempId: 'new-1', name: '', rating: 1000 }, /1 through 80/]]) {
  calls.length = 0;
  result = plain(context.submitVolunteerAdmin({ newPlayers: [player], changes: [] }, ''));
  assert.equal(result.ok, false);
  assert.match(result.problems.map(problem => problem.reason).join(' '), reason);
  assert.equal(calls.length, 0);
}
result = plain(context.submitVolunteerAdmin({ newPlayers: [{ tempId: 'new-1', name: 'Fay N', rating: 1 }, { tempId: 'new-2', name: 'fay n', rating: 1 }], changes: [] }, ''));
assert.match(result.problems[0].reason, /in this list twice/);

// The volunteer app fails after the players were added: the page is told who was added, so a second Submit adds nobody twice.
answers = [{ ok: true, preview: true }, new Error('Timeout')];
result = plain(context.submitVolunteerAdmin({ newPlayers: [{ tempId: 'new-9', name: 'Gil Newcomb', rating: 1000 }], changes: [{ kind: 'training', playerId: 'new-9', skill: 'open', value: true }] }, ''));
assert.equal(result.ok, false);
assert.match(result.message, /^Added Gil Newcomb to the desk, but the other changes were not made: Timeout/);
assert.deepEqual(result.added, [{ tempId: 'new-9', playerId: 'player-2', name: 'Gil Newcomb' }]);

// The page.
assert.ok(context.volunteerAdminPage_());
const desk = fs.readFileSync(__dirname + '/Code.js', 'utf8');
assert.match(desk, /view === 'volunteers' \? volunteerAdminPage_\(\)/, '?view=volunteers opens it, inside the owner-only desk');
const page = fs.readFileSync(__dirname + '/VolunteerAdminPage.html', 'utf8');
for (const name of ['getVolunteerAdmin', 'previewVolunteerAdmin', 'submitVolunteerAdmin']) assert.match(page, new RegExp("call\\('" + name + "'"), 'the page calls ' + name);
assert.match(page, /Volunteer Admin/);
assert.match(page, /draggable/, 'people can be dragged');
assert.match(page, /Review emails/, 'nothing is submitted without reviewing the emails');
assert.match(page, /\$\('submit'\)\.disabled = !reviewed/, 'Submit waits for the review');
console.log('Volunteer Admin desk checks passed');
