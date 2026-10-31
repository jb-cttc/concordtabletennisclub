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
    const meta = () => tab.window.document.getElementById('session-meta').textContent;
    assert.match(meta(), /ratings current through 2026-10-12/, 'ratings are current through the desk\'s last finalized night');
    tab.finalize();
    await run(world, 60000);
    assert.equal(sim.googleSession(world, DATE).status, 'finalized');
    assert.match(meta(), /ratings current through 2026-10-14/, 'and through tonight once it is finalized, with no reload');
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
    const choice = b.$('.new-player-choice');
    assert.equal(choice.hidden, false, 'a new player asks where they play tonight');
    assert.equal(b.roster().length, 11, 'and is not put in the round robin until RR is chosen');
    assert.match(choice.querySelector('h2').textContent, /Newcomer Example/);
    assert.equal(b.window.document.activeElement, choice.querySelector('[data-place="rr"]'), 'RR has the focus');
    b.click(choice.querySelector('[data-place="rr"]'));
    assert.equal(choice.hidden, true);
    assert.equal(b.roster().length, 12, 'RR adds them to the draft');
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

    // The page stays where the organizer is: adding from the sidebar never scrolls to the groups.
    let scrolls = 0;
    tab.window.Element.prototype.scrollIntoView = () => { scrolls += 1; };
    tab.click(addAll);
    await run(world, 20000);
    assert.ok(tab.roster().includes(ava.player_id) && tab.roster().includes(cy.player_id), 'both ✓ players added');
    assert.equal(scrolls, 0, 'Add all does not scroll the page');
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

  // The texts still waiting stay on top, newest first. Anyone added folds into Added tonight; Hide tucks a sender into
  // Hidden tonight until Unhide, a new text from them, or the next day.
  async voiceSignupsFoldAndHide() {
    const world = sim.createWorld({ seed: 25 });
    const inbox = [];
    const voiceText = (name, phone, body, when) => {
      const message = {
        getId: () => name + phone + when,
        getFrom: () => '"' + name + ' (SMS)" <19255550100.19255550199.x@txt.voice.google.com>',
        getReplyTo: () => '"' + name + ' (SMS)" <19255550100.19255550199.x@txt.voice.google.com>',
        getSubject: () => 'New text message from ' + name + ' ' + phone,
        getPlainBody: () => body + '\nTo respond to this text message, reply to this email or visit Google Voice.\nYOUR ACCOUNT',
        getDate: () => new Date(when),
        getThread: () => ({ getMessages: () => [message] }),
        reply: () => {}
      };
      return message;
    };
    const pacific = (time, day) => Date.parse((day || DATE) + 'T' + time + ':00-07:00');
    const [ava, ben, cy, dee] = world.players;
    inbox.push(voiceText(dee.display_name, '(925) 555-0104', 'count me in', pacific('18:20')));
    inbox.push(voiceText(ava.display_name, '(925) 555-0101', 'I\'ll join CTTC\'s RR tonight', pacific('18:30')));
    inbox.push(voiceText(ben.display_name, '(925) 555-0102', 'Is RR on tonight?', pacific('18:35')));
    inbox.push(voiceText(cy.display_name, '(925) 555-0103', 'can\'t make it tonight', pacific('18:40')));
    world.server.gmail.threads = [{ getMessages: () => inbox }];

    const device = world.device();
    let tab = device.open();
    await run(world, 15000);
    let doc = tab.window.document;
    const namesIn = selector => [...doc.querySelectorAll(selector + ' > li')].map(li => li.querySelector('.voice-sender span').textContent);
    const waiting = () => namesIn('.voice-suggestions > ul');
    const added = () => doc.querySelector('.voice-added-group');
    const hidden = () => doc.querySelector('.voice-hidden-group');
    const press = (name, selector) => tab.click([...doc.querySelectorAll('.voice-suggestions li')]
      .find(li => li.querySelector('.voice-sender span').textContent === name).querySelector(selector));
    assert.deepEqual(waiting(), [cy, ben, ava, dee].map(p => p.display_name), 'newest text first');
    assert.ok(added().hidden && hidden().hidden, 'no folds until someone is added or hidden');

    // RR moves the sender into Added tonight, folded shut.
    press(ava.display_name, '[data-voice-add]');
    assert.deepEqual(waiting(), [cy, ben, dee].map(p => p.display_name));
    assert.ok(!added().hidden && !added().open, 'Added tonight shows, folded');
    assert.equal(added().querySelector('summary').textContent, 'Added tonight (1)');
    assert.deepEqual(namesIn('.voice-added-group ul'), [ava.display_name]);
    added().open = true;
    tab.click(doc.querySelector('.voice-suggestions > button.secondary'));
    await run(world, 15000);
    assert.ok(added().open, 'an opened fold stays open when the list refreshes');

    // Hide moves the sender below, out of Add all; Unhide brings them back to their place by time.
    press(dee.display_name, '[data-voice-hide]');
    press(cy.display_name, '[data-voice-hide]');
    assert.deepEqual(waiting(), [ben.display_name]);
    assert.ok(!hidden().hidden && !hidden().open, 'Hidden tonight shows, folded');
    assert.equal(hidden().querySelector('summary').textContent, 'Hidden tonight (2)');
    assert.deepEqual(namesIn('.voice-hidden-group ul'), [cy, dee].map(p => p.display_name));
    assert.ok(doc.querySelector('.voice-suggestions').lastElementChild.previousElementSibling === hidden() && hidden().previousElementSibling === added(), 'Hidden sits below Added');
    assert.equal(doc.querySelector('.voice-add-all').disabled, true, 'a hidden ✓ is not added by Add all');
    assert.equal(doc.querySelectorAll('.voice-hidden-group [data-voice-add]').length, 0, 'no RR buttons while hidden');
    press(dee.display_name, '[data-voice-unhide]');
    assert.deepEqual(waiting(), [ben, dee].map(p => p.display_name));
    assert.equal(doc.querySelector('.voice-add-all').textContent, 'Add all ✓ (1)');

    // Hidden survives a reload on this device; a new text from a hidden sender brings them back to the top.
    tab.close();
    tab = device.open();
    await run(world, 15000);
    doc = tab.window.document;
    assert.deepEqual(namesIn('.voice-hidden-group ul'), [cy.display_name], 'still hidden after a reload');
    inbox.push(voiceText(cy.display_name, '(925) 555-0103', 'actually I can come after all', pacific('18:55')));
    await world.clock.runUntil(pacific('18:56') + 5000);
    assert.equal(waiting()[0], cy.display_name, 'a new text brings them back, on top');
    assert.ok(hidden().hidden);
    press(cy.display_name, '[data-voice-hide]');
    assert.deepEqual(namesIn('.voice-hidden-group ul'), [cy.display_name]);

    // The next day starts with nothing hidden, and the night before is forgotten.
    tab.close();
    const nextDay = '2026-10-15';
    inbox.push(voiceText(cy.display_name, '(925) 555-0103', 'can\'t make it tonight either', pacific('18:10', nextDay)));
    await world.clock.runUntil(pacific('18:30', nextDay));
    tab = device.open();
    await run(world, 15000);
    doc = tab.window.document;
    doc.getElementById('date').value = nextDay;
    doc.getElementById('date').dispatchEvent(new tab.window.Event('change'));
    await run(world, 15000);
    assert.deepEqual(waiting(), [cy.display_name], 'not hidden on a new day');
    press(cy.display_name, '[data-voice-hide]');
    assert.deepEqual(Object.keys(JSON.parse(device.store.get('cttc-voice-hidden-v1'))), [nextDay], 'last night\'s hidden list is cleared');
    assert.deepEqual(tab.errors, []);
  },

  // Opening an earlier finalized night from a night with no session yet: the header gives the latest finalized night,
  // never the date the page was on before.
  async ratingsDateOnEarlierNight() {
    const world = sim.createWorld({ seed: 27 });
    const tab = world.device().open();
    await run(world, 15000);
    const meta = () => tab.$('#session-meta').textContent;
    assert.match(tab.status(), /No session exists/);
    assert.match(meta(), /ratings current through 2026-10-12/);
    tab.loadDate('2026-10-12');
    await run(world, 15000);
    assert.match(meta(), /Status: finalized/);
    assert.match(meta(), /ratings current through 2026-10-12/, 'not ' + DATE + ', the night the page was on');
    assert.deepEqual(tab.errors, []);
  },

  // Checking players in one at a time gives exactly the groups Rebuild by rating gives, promotions included, until
  // someone is moved by hand (then arrivals are slotted in around that) or the first score is in (then a late arrival
  // joins their group and nobody else changes table).
  async checkInMatchesRebuild() {
    const plain = value => JSON.parse(JSON.stringify(value));
    const sets = groups => plain(groups).map(ids => ids.slice().sort().join(','));
    const groupsOf = t => plain(t.desk().groups.map(group => group.playerIds));
    const groupOf = (t, id) => groupsOf(t).findIndex(ids => ids.includes(id)) + 1;
    // Last Wednesday's results: the 12th-rated player tonight won Group 2 there.
    let lastWeek = null;
    const site = url => {
      if (/sessions\.json/.test(url)) return [{ date: '2026-10-07' }];
      if (/session-details-2026\.json/.test(url)) return [lastWeek];
      if (/players\.json/.test(url)) return { latestSessionDate: '2026-09-28', players: [] };
      return undefined;
    };
    const world = sim.createWorld({ seed: 28, players: 30, site });
    const tonight = world.players.slice(0, 20);
    const winner = tonight[11];
    const result = (p, wins) => ({ name: p.display_name, wins, losses: 4 - wins, matches: [] });
    lastWeek = { date: '2026-10-07', groups: [
      { name: 'Group 1', players: tonight.slice(0, 5).map((p, i) => result(p, 4 - i)) },
      { name: 'Group 2', players: [result(winner, 4)].concat(tonight.slice(5, 9).map((p, i) => result(p, 3 - i))) }
    ] };
    const device = world.device();
    const tab = device.open();
    await run(world, 15000);

    // Everyone but the winner, in an order that is not rating order, a little apart as at the desk; the winner last.
    const order = tonight.filter(p => p !== winner).map((p, i) => [(i * 7919) % 101, p]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    for (const p of order.concat(winner)) {
      assert.ok(tab.addPlayer(p.player_id), p.display_name + ' checked in');
      await run(world, 20000);
    }
    const checkedIn = groupsOf(tab);
    assert.deepEqual(checkedIn.map(ids => ids.length), [5, 5, 5, 5]);
    assert.equal(groupOf(tab, winner.player_id), 1, 'last week\'s Group 2 winner is promoted, though they came in last');
    assert.doesNotMatch(tab.$('#group-summary').textContent, /rebalance/);
    tab.click(tab.$('#rebuild'));
    assert.equal(tab.confirms.length, 0, 'Rebuild has nothing to replace, so it does not ask');
    assert.deepEqual(sets(groupsOf(tab)), sets(checkedIn), 'Rebuild by rating gives the same groups');
    await run(world, 20000);
    assert.deepEqual(sets(sim.googleSession(world, DATE).groups.map(g => g.players.map(e => e.playerId))), sets(checkedIn), 'and Google has them');

    // Taking someone off rebuilds too, as Rebuild would.
    tab.removePlayer(tonight[3].player_id);
    await run(world, 20000);
    const afterRemoval = groupsOf(tab);
    assert.deepEqual(afterRemoval.map(ids => ids.length), [5, 5, 5, 4]);
    tab.click(tab.$('#rebuild'));
    assert.equal(tab.confirms.length, 0);
    assert.deepEqual(sets(groupsOf(tab)), sets(afterRemoval));

    // A move by hand is kept: later arrivals are slotted in around it, on this device and on another one after a reload.
    const moved = tonight[4].player_id;
    const before = groupOf(tab, moved);
    tab.movePlayer(moved, '1');
    assert.equal(groupOf(tab, moved), before + 1);
    await run(world, 20000);
    tab.addPlayer(world.players[20].player_id);
    await run(world, 20000);
    assert.equal(groupOf(tab, moved), before + 1, 'the move by hand stays after a check-in');
    const phone = world.device().open();
    await run(world, 15000);
    phone.addPlayer(world.players[21].player_id);
    await run(world, 20000);
    assert.equal(groupOf(phone, moved), before + 1, 'and on another device, which reads the move off the saved groups');
    tab.confirmAnswer = () => false;
    tab.click(tab.$('#rebuild'));
    assert.match(tab.confirms.pop(), /Manual moves are replaced/, 'Rebuild asks before undoing a move by hand');
    assert.deepEqual(tab.errors, []);
    assert.deepEqual(phone.errors, []);

    // Once a score is in, a late arrival joins their group and nobody else changes table.
    const night2 = sim.createWorld({ seed: 29 });
    const desk = await deskWith(night2, night2.device(), 12);
    assert.deepEqual(groupsOf(desk).map(ids => ids.length), [6, 6]);
    desk.scoreMatch(0, 'one', 1);
    await run(night2, 20000);
    const playing = groupsOf(desk);
    const late = night2.players[12];
    desk.addPlayer(late.player_id);
    await run(night2, 20000);
    const withLate = groupsOf(desk);
    assert.equal(withLate.length, 2, 'no new group');
    playing.forEach((ids, index) => ids.forEach(id => assert.ok(withLate[index].includes(id), 'nobody else changes table')));
    assert.equal(scored(sim.googleSession(night2, DATE).matches), 1, 'the score is kept');
    desk.confirmAnswer = () => false;
    desk.click(desk.$('#rebuild'));
    assert.match(desk.confirms.pop(), /Scores already entered stay only for players who stay in the same group together/);
    assert.deepEqual(desk.errors, []);
  },

  // Group size: 6 by default; choosing 5 or 7 rebuilds by rating in groups of that size (or one smaller). The choice is
  // kept for the night on this device, another device reads it off the groups Google holds, and a new night starts at 6.
  async groupSizePreference() {
    const world = sim.createWorld({ seed: 26 });
    const device = world.device();
    const tab = await deskWith(world, device, 13);
    const plain = value => JSON.parse(JSON.stringify(value));
    const sizes = t => plain(t.desk().groups.map(group => group.playerIds.length));
    const pressed = t => t.$('#group-size [aria-pressed="true"]').textContent;
    const googleSizes = () => plain(sim.googleSession(world, DATE).groups.map(group => group.players.length));
    const summary = t => t.$('#group-summary').textContent;
    assert.equal(pressed(tab), '6', '6 by default');
    assert.deepEqual(sizes(tab), [5, 4, 4]);

    // 7: the groups are as Rebuild made them, so nothing is lost and nothing is asked; rebuilt by rating and saved to
    // Google like any rebuild.
    tab.click(tab.$('[data-group-size="7"]'));
    assert.equal(tab.confirms.length, 0, 'no question when there is nothing to lose');
    assert.deepEqual(sizes(tab), [7, 6]);
    assert.equal(pressed(tab), '7');
    assert.match(tab.status(), /Groups rebuilt by rating in groups of 7 \(or 6\)/);
    assert.doesNotMatch(summary(tab), /rebalance/, 'groups of 7 are not flagged when 7 is chosen');
    const byRating = [...world.players.slice(0, 13)].sort((a, b) => b.current_rating - a.current_rating).map(p => p.player_id);
    assert.deepEqual(plain(tab.desk().groups[0].playerIds), byRating.slice(0, 7), 'the strongest seven in group 1');
    await run(world, 20000);
    assert.deepEqual(googleSizes(), [7, 6]);

    // After a move by hand it asks first, and saying no changes nothing. (Moved back, the groups are Rebuild's again.)
    const mover = byRating[6];
    tab.movePlayer(mover, '1');
    tab.confirmAnswer = () => false;
    tab.click(tab.$('[data-group-size="5"]'));
    assert.match(tab.confirms.pop(), /groups of 5 \(or 4\)\? Manual moves are replaced/);
    assert.deepEqual(sizes(tab), [6, 7]);
    assert.equal(pressed(tab), '7');
    tab.confirmAnswer = () => true;
    tab.movePlayer(mover, '-1');
    assert.deepEqual(sizes(tab), [7, 6]);
    await run(world, 20000);

    // A reload on this device keeps 7.
    tab.close();
    const again = device.open();
    await run(world, 15000);
    assert.equal(pressed(again), '7');

    // Another device has no choice stored, so it reads 7 off Google's groups: nothing is flagged, and a late arrival fills
    // the group of 6 instead of being passed down to a new group.
    const phone = world.device().open();
    await run(world, 15000);
    assert.equal(pressed(phone), '7');
    assert.doesNotMatch(summary(phone), /rebalance/);
    phone.addPlayer(world.players[13].player_id);
    await run(world, 20000);
    assert.deepEqual(sizes(phone), [7, 7]);
    assert.deepEqual(googleSizes(), [7, 7]);

    // 5 on the phone: 14 players in groups of 5 (or 4).
    phone.click(phone.$('[data-group-size="5"]'));
    assert.deepEqual(sizes(phone), [5, 5, 4]);
    assert.equal(pressed(phone), '5');
    await run(world, 20000);
    assert.deepEqual(googleSizes(), [5, 5, 4]);

    // A new night on the first device starts at 6, and last night's choice is cleared once it is no longer tonight.
    await world.clock.runUntil(Date.parse('2026-10-15T18:00:00-07:00'));
    again.loadDate('2026-10-15');
    await run(world, 15000);
    assert.equal(pressed(again), '6', 'a new night starts at 6');
    again.click(again.$('[data-group-size="7"]'));
    assert.match(again.status(), /Groups will be built in groups of 7 \(or 6\)/, 'with nobody added yet, it only sets the size');
    assert.deepEqual(Object.keys(JSON.parse(device.store.get('cttc-group-size-v1'))), ['2026-10-15']);
    assert.deepEqual(again.errors, []);
    assert.deepEqual(phone.errors, []);
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
    const device = world.device();
    const tab = device.open();
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

    // Pressed with Google not answering at all: both take effect on the press itself, and nothing shows as waiting.
    device.net.blackhole = true;
    let scrolls = 0;
    tab.window.Element.prototype.scrollIntoView = () => { scrolls += 1; };
    tab.click(doc.querySelector('[data-volunteer-rr="' + ray.player_id + '"]'));
    tab.click(doc.querySelector('[data-volunteer-open="' + ron.player_id + '"]'));
    assert.equal(scrolls, 0, 'the buttons do not scroll the page');
    assert.ok(tab.roster().includes(ray.player_id), 'RR adds to the draft at once');
    assert.ok(doc.querySelector('#open-roster [data-open-remove="' + ron.player_id + '"]'), 'Open adds to Open Play at once');
    assert.deepEqual(rows().map(r => r[2]), ['In RR', 'RR/Open', 'In Open']);
    assert.equal(doc.querySelectorAll('.volunteer-signups .request-pending').length, 0, 'no button waits on Google');
    await run(world, 60000);
    assert.deepEqual(tab.errors, []);
    device.net.blackhole = false;
    await run(world, 6 * 60000);
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

  // Picking a payment closes the list. It also opens on hover and focus, so it is held shut until the pointer moves and
  // leaves, and the row below (now under the pointer) does not open in its place.
  async paymentListClosesOnPick() {
    const world = sim.createWorld({ seed: 24 });
    const tab = await deskWith(world, world.device(), 4);
    const win = tab.window;
    const doc = win.document;
    const control = doc.querySelector('#groups .payment-control');
    const trigger = control.querySelector('.payment-trigger');
    const option = label => [...control.querySelectorAll('.payment-options button')].find(button => button.textContent === label);
    const press = (node, detail) => node.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, detail }));
    press(trigger, 1);
    assert.ok(control.classList.contains('open'));
    press(option('Cash'), 1);
    assert.equal(trigger.textContent, 'Cash ✓');
    assert.ok(!control.classList.contains('open') && control.classList.contains('picked'), 'the list closes and stays shut under the pointer');
    assert.ok(doc.documentElement.classList.contains('payment-hold'), 'no other list opens by hover until the mouse moves');
    win.dispatchEvent(new win.MouseEvent('mousemove'));
    assert.ok(!doc.documentElement.classList.contains('payment-hold'));
    control.dispatchEvent(new win.MouseEvent('mouseleave'));
    assert.ok(!control.classList.contains('picked'), 'hovering again later opens it as before');
    press(trigger, 1);
    press(trigger, 1);
    assert.ok(!control.classList.contains('open') && control.classList.contains('picked'), 'a second press closes it');
    control.dispatchEvent(new win.MouseEvent('mouseleave'));
    // From the keyboard (Enter gives a click with no detail), focus returns to the control's button.
    press(trigger, 0);
    option('Venmo').focus();
    press(option('Venmo'), 0);
    assert.equal(trigger.textContent, 'Venmo ✓');
    assert.equal(doc.activeElement, trigger);
    assert.ok(control.classList.contains('picked'));
    assert.deepEqual(tab.errors, []);
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
  },

  // After adding someone from a search, the search clears itself 20 seconds after the last add; typing keeps it.
  async searchClearsAfterAdding() {
    const world = sim.createWorld({ seed: 33 });
    const tab = await deskWith(world, world.device(), 2);
    const search = tab.$('#search');
    const type = text => { search.value = text; search.dispatchEvent(new tab.window.Event('input', { bubbles: true })); };
    const [a, b, c, d] = world.players.slice(2, 6);
    type(a.display_name);
    tab.click(tab.$('[data-add="' + a.player_id + '"]'));
    await run(world, 15000);
    assert.equal(search.value, a.display_name, 'the search stays for a while');
    type(b.display_name);
    await run(world, 100);
    tab.click(tab.$('[data-open-add="' + b.player_id + '"]'));
    await run(world, 15000);
    assert.equal(search.value, b.display_name, 'each add starts the 20 seconds again');
    await run(world, 6000);
    assert.equal(search.value, '', 'then it clears');
    assert.ok(tab.$('#results').children.length > 4, 'and the whole directory shows again');
    assert.ok(tab.roster().includes(a.player_id));

    type(c.display_name);
    tab.click(tab.$('[data-add="' + c.player_id + '"]'));
    await run(world, 5000);
    type(d.display_name);
    await run(world, 30000);
    assert.equal(search.value, d.display_name, 'typing a new search keeps it');
    assert.deepEqual(tab.errors, []);
  },

  // A new player: Open puts them in Open Play, not the round robin; Not tonight (or Escape) leaves them in the directory.
  async newPlayerOpenOrNotTonight() {
    const world = sim.createWorld({ seed: 31 });
    const tab = await deskWith(world, world.device(), 6);
    const doc = tab.window.document;
    const choice = tab.$('.new-player-choice');
    const addNew = async name => {
      tab.$('#new-name').value = name;
      tab.$('#new-player').dispatchEvent(new tab.window.Event('submit', { cancelable: true }));
      await run(world, 15000);
      assert.equal(choice.hidden, false, name + ': the choice is shown');
      return world.server.rows('Players').find(row => row.display_name === name).player_id;
    };
    const open = await addNew('Open Example');
    assert.equal(tab.roster().length, 6);
    tab.click(choice.querySelector('[data-place="open"]'));
    assert.equal(choice.hidden, true);
    assert.equal(tab.roster().length, 6, 'Open does not touch the round robin');
    assert.ok(doc.querySelector('#open-roster [data-open-remove="' + open + '"]'), 'Open puts them in Open Play at once');
    assert.equal(tab.status(), 'Open Example added to Open Play.');
    await run(world, 30000);
    assert.ok(world.server.rows('OpenPlay').some(r => String(r.player_id) === open), 'and Open Play reaches Google');

    const later = await addNew('Later Example');
    tab.click(choice.querySelector('[data-place=""]'));
    assert.equal(choice.hidden, true);
    assert.equal(tab.roster().length, 6, 'Not tonight adds them nowhere');
    assert.equal(doc.querySelector('#open-roster [data-open-remove="' + later + '"]'), null);
    assert.equal(doc.activeElement, tab.$('#new-name'), 'the name box is ready for the next player');

    await addNew('Escape Example');
    choice.dispatchEvent(new tab.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(choice.hidden, true, 'Escape closes it the same way');
    assert.equal(tab.roster().length, 6);
    await run(world, 30000);
    inStep(world, tab, 'new players');
  },

  // A coached student who is not in the directory yet, and a player moved from the round robin to Open: both as on the
  // night of 2026-10-31, when the student was added and Open bounced him back out.
  async coachedNewcomerAndRoundRobinToOpen() {
    const world = sim.createWorld({ seed: 32 });
    world.server.context.coachingLessons_ = () => [
      { role: 'coach', name: world.players[0].display_name, phone: '', lesson: { start: '16:00', minutes: 60, coachLabel: 'D' } },
      { role: 'student', name: 'Coached Newcomer', phone: '', lesson: { start: '16:00', minutes: 60, coachLabel: 'D' } }
    ];
    const tab = await deskWith(world, world.device(), 1);
    const doc = tab.window.document;
    const solo = world.players[1].player_id;
    assert.deepEqual(tab.roster(), [world.players[0].player_id]);
    const studentRow = () => [...doc.querySelectorAll('.coaching-row')].find(row => /Coached Newcomer/.test(row.textContent));
    assert.equal(studentRow().getAttribute('data-coaching'), null, 'a student not in the directory has no player to pay for');
    assert.equal(studentRow().querySelector('.payment-trigger'), null);

    tab.$('#new-name').value = 'Coached Newcomer';
    tab.$('#new-rating').value = '500';
    tab.$('#new-player').dispatchEvent(new tab.window.Event('submit', { cancelable: true }));
    await run(world, 15000);
    tab.click(tab.$('.new-player-choice [data-place=""]'));
    await run(world, 15000);
    const newcomer = world.server.rows('Players').find(row => row.display_name === 'Coached Newcomer').player_id;
    assert.equal(studentRow().getAttribute('data-coaching'), newcomer, 'adding them matches their lesson without a reload');
    assert.ok(studentRow().querySelector('.payment-trigger'), 'and their payment can be recorded');
    const search = tab.$('#search');
    search.value = 'Coached Newcomer';
    search.dispatchEvent(new tab.window.Event('input', { bubbles: true }));
    await run(world, 100);
    assert.equal(doc.querySelector('[data-open-add="' + newcomer + '"]').hidden, true, 'the directory shows them as coached');

    // The only round robin player moves to Open: the empty round robin is saved, and Open waits for that save.
    tab.addPlayer(solo);
    await run(world, 20000);
    tab.removePlayer(world.players[0].player_id);
    await run(world, 20000);
    assert.deepEqual(tab.roster(), [solo]);
    tab.removePlayer(solo);
    search.value = world.players[1].display_name;
    search.dispatchEvent(new tab.window.Event('input', { bubbles: true }));
    await Promise.resolve();
    tab.click(doc.querySelector('[data-open-add="' + solo + '"]'));
    assert.ok(doc.querySelector('#open-roster [data-open-remove="' + solo + '"]'), 'Open shows at once');
    await run(world, 60000);
    assert.ok(doc.querySelector('#open-roster [data-open-remove="' + solo + '"]'), 'and stays');
    assert.ok(world.server.rows('OpenPlay').some(r => String(r.player_id) === solo), 'Open Play reached Google');
    assert.equal(sim.googleSession(world, DATE).groups.length, 0, 'the empty round robin reached Google');
    assert.equal(tab.syncNote(), '', 'nothing is left waiting or refused');
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
