// Whole-desk checks: the real page (Index.html and its includes) and the real server files, on a simulated Google
// with a virtual clock (scripts/lib/desk-sim.js). Each case plays out something that happens at the club and checks
// what the volunteer sees and what Google ends up holding. Synthetic players only.
const assert = require('node:assert/strict');
const sim = require('../scripts/lib/desk-sim');

const DATE = '2026-10-14';
const run = (world, ms) => world.clock.run(ms);

// A desk with a small session loaded: 11 players in two groups, 25 matches.
async function deskWith(world, device, count) {
  const tab = device.open();
  await run(world, 15000);
  world.players.slice(0, count || 11).forEach(p => tab.addPlayer(p.player_id));
  await run(world, 20000);
  return tab;
}
const scored = list => list.filter(m => m.playerOneGames != null || m.forfeitedBy).length;
const googleScored = world => scored(sim.googleSession(world, DATE).matches);
function inStep(world, tab, label) {
  assert.equal(sim.googleKey(world, DATE), sim.pageKey(tab), label + ': Google and the page hold the same session');
  assert.deepEqual(tab.device.storageKeys('cttc-rr-draft-v1:'), [], label + ': no device copy left waiting');
  assert.equal(tab.notice(), '', label + ': no notice left showing');
  assert.deepEqual(tab.errors, [], label + ': no page errors');
}
async function scoreAll(world, tab, gap) {
  for (let i = 0; i < tab.matchCount(); i += 1) {
    tab.scoreMatch(i, i % 2 ? 'one' : 'two', i % 3);
    await run(world, gap || 4000);
  }
}

const cases = {
  // The ordinary night: roster, scores, finalize, with nothing going wrong and nothing to read.
  async ordinaryNight() {
    const world = sim.createWorld({ seed: 11 });
    const tab = await deskWith(world, world.device());
    await scoreAll(world, tab);
    await run(world, 20000);
    inStep(world, tab, 'ordinary night');
    assert.equal(googleScored(world), 25);
    tab.finalize();
    await run(world, 60000);
    assert.equal(sim.googleSession(world, DATE).status, 'finalized');
    assert.equal(world.server.problems().length, 0, 'nothing was reported as a problem');
    assert.equal(world.server.rows('RatingLedger').filter(r => r.session_id === 'session-' + DATE).length, 11);
  },

  // One lost reply and one error: the desk retries by itself without alarming anyone.
  async singleBlipsStayQuiet() {
    const world = sim.createWorld({ seed: 12 });
    const device = world.device();
    const tab = await deskWith(world, device);
    let worst = '';
    const watch = () => { worst = worst || tab.notice(); world.clock.after(500, watch, tab); };
    watch();
    device.net.failReply = 1;
    tab.scoreMatch(0, 'one', 1);
    await run(world, 3000);
    device.net.failReply = 0;
    await run(world, 30000);
    device.net.loseReply = 1;
    tab.scoreMatch(1, 'two', 2);
    await run(world, 3000);
    device.net.loseReply = 0;
    await run(world, 120000);
    assert.equal(worst, '', 'a single failed or lost save that fixes itself shows no notice');
    inStep(world, tab, 'after blips');
    assert.equal(googleScored(world), 2);
  },

  // Repeated failures still say so, keep the scores on the device, and catch up when Google answers again.
  async lastingTroubleIsShown() {
    const world = sim.createWorld({ seed: 13 });
    const device = world.device();
    const tab = await deskWith(world, device);
    device.net.failReply = 1;
    tab.scoreMatch(0, 'one', 0);
    await run(world, 40000);
    assert.match(tab.notice(), /Unsynced draft saved on this device/, 'lasting trouble is announced');
    tab.scoreMatch(1, 'one', 1);
    await run(world, 5000);
    device.net.failReply = 0;
    await run(world, 180000);
    inStep(world, tab, 'after lasting trouble');
    assert.equal(googleScored(world), 2);
  },

  // The Wi-Fi drops for a few minutes during scoring.
  async offlineSpell() {
    const world = sim.createWorld({ seed: 14 });
    const device = world.device();
    const tab = await deskWith(world, device);
    device.goOffline();
    tab.scoreMatch(0, 'one', 2);
    tab.scoreMatch(1, 'two', 0);
    await run(world, 5000);
    assert.match(tab.notice(), /Offline/);
    await run(world, 180000);
    device.goOnline();
    await run(world, 30000);
    inStep(world, tab, 'after the Wi-Fi returns');
    assert.equal(googleScored(world), 2);
  },

  // The tab is closed or reloaded a moment after a score is tapped, before or while it is saved, and opened again.
  async reloadRightAfterTapping() {
    for (const delay of [300, 2500]) {
      const world = sim.createWorld({ seed: 15 });
      const device = world.device();
      const tab = await deskWith(world, device);
      tab.scoreMatch(0, 'one', 1);
      await run(world, 20000);
      tab.scoreMatch(1, 'two', 1);
      tab.scoreMatch(2, 'one', 2);
      await run(world, delay);
      tab.close();
      const again = device.open();
      await run(world, 30000);
      assert.equal(again.confirms.length, 0, 'no question to answer after reopening');
      assert.doesNotMatch(again.status(), /choose which to keep/);
      inStep(world, again, 'reopened ' + delay + ' ms after tapping');
      assert.equal(googleScored(world), 3, 'every tapped score reached Google (' + delay + ' ms)');
    }
  },

  // The desk is opened again in a second tab of the same browser while the first tab is saving.
  async secondTab() {
    const world = sim.createWorld({ seed: 16 });
    const device = world.device();
    const first = await deskWith(world, device);
    first.scoreMatch(0, 'one', 1);
    await run(world, 400);
    const second = device.open();
    await run(world, 20000);
    assert.equal(first.covered(), true, 'the older tab steps aside');
    assert.equal(second.covered(), false);
    assert.equal(second.notice(), '', 'the new tab does not ask about a device copy');
    second.scoreMatch(1, 'two', 2);
    await run(world, 20000);
    first.scoreMatch(2, 'one', 0);
    assert.ok(first.blockedClicks > 0, 'the covered tab cannot be edited');
    first.takeOver();
    await run(world, 20000);
    assert.equal(second.covered(), true);
    first.scoreMatch(3, 'one', 0);
    await run(world, 20000);
    inStep(world, first, 'after switching tabs');
    assert.equal(googleScored(world), 3);
  },

  // Two devices score different groups of the same session: both keep saving and each shows the other's scores.
  async twoDevices() {
    const world = sim.createWorld({ seed: 17 });
    const laptop = world.device('laptop');
    const phone = world.device('phone');
    const a = await deskWith(world, laptop);
    const b = phone.open();
    await run(world, 15000);
    for (let i = 0; i < 25; i += 1) {
      (i % 2 ? a : b).scoreMatch(i, i % 3 ? 'one' : 'two', i % 3);
      await run(world, 3000 + (i % 4) * 1000);
    }
    await run(world, 150000);
    inStep(world, a, 'laptop');
    inStep(world, b, 'phone');
    assert.equal(googleScored(world), 25);
    assert.equal(a.status().includes('different version') || b.status().includes('different version'), false);
  },

  // The desk is opened (or reloaded) just as Google fails or drops a reply: it loads by itself once Google answers.
  async openedDuringABlip() {
    for (const fault of ['failReply', 'loseReply']) {
      const world = sim.createWorld({ seed: 23 });
      const device = world.device();
      const first = await deskWith(world, device);
      first.scoreMatch(0, 'one', 1);
      await run(world, 20000);
      first.close();
      device.net[fault] = 1;
      const tab = device.open();
      await run(world, 2000);
      device.net[fault] = 0;
      await run(world, 90000);
      assert.equal(tab.roster().length, 11, 'the session loads by itself (' + fault + ')');
      assert.doesNotMatch(tab.status(), /could not|unavailable/i, fault);
      assert.ok(tab.window.document.querySelectorAll('#groups .member-badge.visitor, #groups .member-badge.member').length > 0, 'membership badges load too (' + fault + ')');
      tab.scoreMatch(1, 'two', 0);
      await run(world, 20000);
      inStep(world, tab, 'opened during a blip (' + fault + ')');
      assert.equal(googleScored(world), 2);
    }
  },

  // The phone was opened before anyone started tonight's session; the laptop then builds the roster. The phone shows
  // it within a minute, and a player the phone adds later shows up on the laptop.
  async lateStarterAndNewPlayer() {
    const world = sim.createWorld({ seed: 21 });
    const laptop = world.device('laptop');
    const phone = world.device('phone');
    const b = phone.open();
    await run(world, 15000);
    const a = await deskWith(world, laptop);
    await run(world, 70000);
    assert.equal(b.roster().length, 11, 'the phone shows the session the laptop started');
    b.$('#new-name').value = 'Newcomer Example';
    b.$('#new-rating').value = '900';
    b.$('#new-player').dispatchEvent(new b.window.Event('submit', { cancelable: true }));
    await run(world, 15000);
    a.scoreMatch(0, 'one', 1);
    await run(world, 90000);
    assert.equal(a.roster().length, 12, 'the laptop shows the player the phone added');
    inStep(world, a, 'laptop');
    inStep(world, b, 'phone');
    assert.equal(a.notice() + b.notice(), '');
  },


  // Two devices record the same match differently: nothing is chosen silently, and a person is asked.
  async realDisagreementIsAsked() {
    const world = sim.createWorld({ seed: 18 });
    const laptop = world.device('laptop');
    const phone = world.device('phone');
    const a = await deskWith(world, laptop);
    const b = phone.open();
    await run(world, 15000);
    phone.goOffline();
    b.scoreMatch(0, 'two', 1);
    a.scoreMatch(0, 'one', 2);
    await run(world, 20000);
    phone.goOnline();
    await run(world, 30000);
    const google = sim.googleSession(world, DATE).matches.find(m => m.playerOneGames != null);
    assert.equal(google.playerOneGames, 3, 'the result Google had is not overwritten');
    assert.match(b.status() + b.notice(), /different version/, 'the phone says the copies differ');
    const kept = JSON.parse(phone.store.get('cttc-rr-draft-v1:' + DATE));
    assert.equal(kept.matches[0].playerTwoGames, 3, 'the phone keeps its own result on the device');
  },

  // Finalizing on one device while another still has a score on its way.
  async finalizedElsewhere() {
    const world = sim.createWorld({ seed: 19 });
    const laptop = world.device('laptop');
    const phone = world.device('phone');
    const a = await deskWith(world, laptop);
    await scoreAll(world, a, 2000);
    const b = phone.open();
    await run(world, 15000);
    phone.goOffline();
    b.scoreMatch(0, b.desk().matches[0].playerOneGames === 3 ? 'two' : 'one', 1);
    a.finalize();
    await run(world, 60000);
    phone.goOnline();
    await run(world, 30000);
    assert.equal(sim.googleSession(world, DATE).status, 'finalized');
    assert.match(b.status(), /finalized/i, 'the phone is told the session was finalized');
    assert.equal(world.server.audit.filter(a => a.action === 'session_saved' && a.at > world.clock.now() - 60000).length, 0, 'nothing was saved over the finalized session');
  },

  // The help tour shows an example night; closing it brings back tonight's session.
  async tourReturnsToTonight() {
    const world = sim.createWorld({ seed: 22 });
    const tab = await deskWith(world, world.device());
    tab.scoreMatch(0, 'one', 2);
    await run(world, 10000);
    tab.click(tab.$('#show-tour'));
    await run(world, 10000);
    assert.equal(tab.$('#date').value, '2026-09-23', 'the tour shows its example date');
    tab.click(tab.$('.tour-close'));
    await run(world, 15000);
    assert.equal(tab.$('#date').value, DATE, 'closing the tour goes back to tonight');
    assert.equal(tab.roster().length, 11);
    inStep(world, tab, 'after the tour');
  },

  // A slow Gmail (Zeffy pass emails) while a payment is recorded does not hold up score saves.
  async slowGmailDoesNotBlockSaves() {
    const world = sim.createWorld({ seed: 20 });
    const tab = await deskWith(world, world.device());
    world.server.gmail.searchMs = 25000;
    world.server.properties.CTTC_ZEFFY_SYNCED_AT = '0';
    tab.pay(world.players[0].player_id, 'cash');
    await run(world, 1500);
    tab.scoreMatch(0, 'one', 1);
    await run(world, 8000);
    assert.equal(googleScored(world), 1, 'the score was saved while Gmail was still being read');
    await run(world, 40000);
    assert.equal(world.server.rows('SessionPayments').length, 1);
  },

  // Texts come in while the desk is open: the list checks by itself every minute from 6:45 to 7:30, marks who is
  // validated (✓) and who needs a look (?), and Add all puts every ✓ on the round robin with one press.
  async voiceSignupsTonight() {
    const world = sim.createWorld({ seed: 21 });
    const replies = [];
    const inbox = [];
    const voiceText = (name, phone, body, when) => {
      const message = {
        getId: () => name + phone + when,
        getFrom: () => '"' + (name || phone) + ' (SMS)" <19255550100.19255550199.x@txt.voice.google.com>',
        getReplyTo: () => '"' + (name || phone) + ' (SMS)" <19255550100.19255550199.x@txt.voice.google.com>',
        getSubject: () => 'New text message from ' + (name ? name + ' ' : '') + phone,
        getPlainBody: () => body + '\nTo respond to this text message, reply to this email or visit Google Voice.\nYOUR ACCOUNT',
        getDate: () => new Date(when),
        getThread: () => ({ getMessages: () => [message] }),
        reply: text => replies.push({ to: name, text })
      };
      return message;
    };
    const pacific = time => Date.parse(DATE + 'T' + time + ':00-07:00');
    const [ava, ben, cy] = world.players;
    inbox.push(voiceText(ava.display_name, '(925) 555-0101', 'I\'ll join CTTC\'s RR tonight', pacific('18:30')));
    inbox.push(voiceText(ben.display_name, '(925) 555-0102', 'Is RR on tonight?', pacific('18:35')));
    inbox.push(voiceText('', '(925) 555-0103', 'coming tonight', pacific('18:36')));
    world.server.gmail.threads = [{ getMessages: () => inbox }];
    const checks = () => world.server.calls.filter(call => call.name === 'listVoiceSuggestions').length;

    const tab = world.device().open();
    await run(world, 15000);
    const doc = tab.window.document;
    const marks = () => Object.fromEntries([...doc.querySelectorAll('.voice-suggestions li')].map(li =>
      [li.querySelector('.voice-sender span').textContent, li.querySelector('.voice-check').textContent]));
    assert.deepEqual(marks(), { [ava.display_name]: '✓', [ben.display_name]: '?', 'Unknown number ending 0103': '?' });
    assert.match(doc.querySelector('.voice-suggestions .voice-preview-button[title*="Latest text"]').title, /doesn't say they're coming/, 'the ? says why');
    const addAll = doc.querySelector('.voice-add-all');
    assert.equal(addAll.textContent, 'Add all ✓ (1)');
    assert.match(doc.querySelector('.voice-suggestions .hint').textContent, /every minute until 7:30 PM/);

    // A new text at 6:50 shows up within a minute, with no Refresh.
    const before = checks();
    inbox.push(voiceText(cy.display_name, '(925) 555-0104', 'count me in', pacific('18:50')));
    await world.clock.runUntil(pacific('18:51') + 5000);
    assert.ok(checks() > before, 'checked again by itself');
    assert.equal(marks()[cy.display_name], '✓');
    assert.equal(addAll.textContent, 'Add all ✓ (2)');

    tab.click(addAll);
    await run(world, 20000);
    assert.ok(tab.roster().includes(ava.player_id) && tab.roster().includes(cy.player_id), 'both ✓ players added');
    assert.ok(!tab.roster().includes(ben.player_id), 'a ? is left for the organizer');
    assert.equal(addAll.textContent, 'All ✓ added');
    assert.equal(addAll.disabled, true);
    assert.deepEqual(replies.map(reply => reply.to).sort(), [ava.display_name, cy.display_name].sort(), 'each gets the usual Confirmed.');

    // After 7:30 it stops checking by itself.
    await world.clock.runUntil(pacific('19:31'));
    const after = checks();
    await run(world, 5 * 60000);
    assert.equal(checks(), after, 'no checks after 7:30');
    assert.doesNotMatch(doc.querySelector('.voice-suggestions .hint').textContent, /every minute/);
    assert.deepEqual(tab.errors, []);
  },

  // Tonight's volunteers: the people signed up to open or close are listed with RR and Open, and a press only adds them
  // (to the draft, or to Open Play), like the directory's buttons. Nothing is texted or emailed.
  async volunteersTonight() {
    const world = sim.createWorld({ seed: 23 });
    const [ray, ron, mia] = world.players;
    const header = ['signup_id', 'batch_id', 'date', 'position', 'finalize', 'player_id', 'name', 'email', 'status', 'created_at', 'expires_at'];
    const signups = [header,
      ['1', 'b', DATE, 'desk', '', ray.player_id, ray.display_name, 'r@example.com', 'confirmed', '', ''],
      ['2', 'b', DATE, 'close', '', ron.player_id, ron.display_name, 'o@example.com', 'confirmed', '', ''],
      ['3', 'b', DATE, 'money', '', mia.player_id, mia.display_name, 'm@example.com', 'pending', '', String(Date.parse(DATE + 'T23:00:00Z') + 86400000)]];
    world.server.properties.CTTC_STAFFING_DB_ID = 'staffing-sheet';
    world.server.context.SpreadsheetApp.openById = id => {
      assert.equal(id, 'staffing-sheet');
      return { getSheetByName: name => (name === 'Signups' ? { getDataRange: () => ({ getValues: () => signups.map(r => r.slice()) }) } : null) };
    };
    let sent = 0;
    world.server.gmail.threads = [{ getMessages: () => [] }];
    ['sendVoiceConfirmation', 'answerVoiceSignups'].forEach(name => {
      const real = world.server.context[name];
      world.server.context[name] = (...args) => { sent += 1; return real(...args); };
    });
    const tab = world.device().open();
    await run(world, 15000);
    const doc = tab.window.document;
    const rows = () => [...doc.querySelectorAll('.volunteer-signups li')].map(li => [li.querySelector('strong').textContent, li.querySelector('.identity span').textContent,
      [...li.querySelectorAll('.volunteer-actions button, .volunteer-actions .roster-status')].map(node => node.textContent).join('/')]);
    assert.deepEqual(rows(), [
      [ray.display_name, 'Desk organizer', 'RR/Open'],
      [mia.display_name, 'Front desk · waiting to confirm', 'RR/Open'],
      [ron.display_name, 'Put away', 'RR/Open']
    ]);
    assert.ok(doc.querySelector('.voice-suggestions').nextElementSibling.classList.contains('volunteer-signups'), 'right after Voice signups');

    tab.click(doc.querySelector('[data-volunteer-rr="' + ray.player_id + '"]'));
    tab.click(doc.querySelector('[data-volunteer-open="' + ron.player_id + '"]'));
    assert.ok(tab.roster().includes(ray.player_id), 'RR adds to the draft at once');
    assert.ok(doc.querySelector('#open-roster [data-open-remove="' + ron.player_id + '"]'), 'Open adds to Open Play at once');
    assert.deepEqual(rows().map(r => r[2]), ['In RR', 'RR/Open', 'In Open']);
    await run(world, 30000);
    assert.ok(JSON.parse(sim.googleKey(world, DATE)).groups.join(',').includes(ray.player_id), 'the draft with Ray reached Google');
    assert.ok(world.server.rows('OpenPlay').some(r => String(r.player_id) === ron.player_id), 'Ron reached Open Play on Google');
    assert.equal(sent, 0, 'no text or email was sent');
    assert.deepEqual(tab.errors, []);

    // Not connected: the section says so, and the rest of the desk works as before.
    delete world.server.properties.CTTC_STAFFING_DB_ID;
    tab.click(doc.querySelector('.volunteer-signups button.secondary'));
    await run(world, 10000);
    assert.match(doc.querySelector('.volunteer-signups .hint').textContent, /Not connected/);
    assert.equal(doc.querySelectorAll('.volunteer-signups li').length, 0);
  },

  // Add all never waits on Google: with Google not answering at all (or the Wi-Fi off), the players are on the draft the
  // moment it is pressed, and their Confirmed. texts go out by themselves once Google answers again.
  async addAllNeverWaitsForGoogle() {
    const world = sim.createWorld({ seed: 22 });
    const replies = [];
    const inbox = world.players.slice(0, 3).map((player, index) => {
      const message = {
        getId: () => 'v' + index,
        getFrom: () => '"' + player.display_name + ' (SMS)" <1@txt.voice.google.com>',
        getReplyTo: () => '"' + player.display_name + ' (SMS)" <1@txt.voice.google.com>',
        getSubject: () => 'New text message from ' + player.display_name + ' (925) 555-010' + index,
        getPlainBody: () => 'I\'ll join CTTC\'s RR tonight\nTo respond to this text message, reply to this email or visit Google Voice.',
        getDate: () => new Date(Date.parse(DATE + 'T18:3' + index + ':00-07:00')),
        getThread: () => ({ getMessages: () => [message] }),
        reply: text => replies.push(player.display_name)
      };
      return message;
    });
    world.server.gmail.threads = [{ getMessages: () => inbox }];
    const device = world.device();
    const tab = device.open();
    await run(world, 15000);
    const addAll = tab.$('.voice-add-all');
    assert.equal(addAll.textContent, 'Add all ✓ (3)');

    device.net.blackhole = true;
    tab.click(addAll);
    // No virtual time passes: everything below happened on the press itself.
    world.players.slice(0, 3).forEach(player => assert.ok(tab.roster().includes(player.player_id), player.display_name + ' is on the draft at once'));
    assert.equal(addAll.disabled, true);
    assert.equal(addAll.textContent, 'All ✓ added');
    assert.ok(!addAll.classList.contains('request-pending'), 'the button never shows as waiting');
    assert.equal(tab.$('#network-activity').textContent.includes('Working') && tab.$('.voice-add-all.request-pending') !== null, false);
    await run(world, 120000);
    assert.equal(replies.length, 0, 'nothing reached Google yet');
    assert.deepEqual(tab.errors, []);

    device.net.blackhole = false;
    await run(world, 6 * 60000);
    assert.deepEqual(replies.sort(), world.players.slice(0, 3).map(p => p.display_name).sort(), 'every Confirmed. went out once Google answered');
    const saved = JSON.parse(sim.googleKey(world, DATE)).groups.join(',');
    world.players.slice(0, 3).forEach(player => assert.ok(saved.includes(player.player_id), 'the draft reached Google'));
    assert.deepEqual(tab.errors, []);
  }
};

(async () => {
  const only = process.argv.slice(2);
  for (const [name, check] of Object.entries(cases)) {
    if (only.length && !only.includes(name)) continue;
    try {
      await check();
    } catch (error) {
      error.message = name + ': ' + error.message;
      throw error;
    }
  }
  console.log('Whole-desk night checks passed: ' + Object.keys(cases).filter(name => !only.length || only.includes(name)).join(', '));
})().catch(error => { console.error(error); process.exit(1); });
