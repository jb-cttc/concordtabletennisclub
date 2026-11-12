// The storyboard's content, part 2: the round robin night at the desk, step by step.
// Built into storyboard.html and docs/storyboard/night.json by scripts/build-storyboard.js (npm run build:storyboard).
// Evidence is file:line at main 795ebbd (Nov 11, 2026). Made-up names only.
'use strict';
const I = 'apps-script/Index.html', O = 'apps-script/Organizer.html', B = 'apps-script/PlayerBoard.html', P = 'apps-script/Print.html';
const S = 'apps-script/SessionService.js', ID = 'apps-script/SessionIds.js', OPS = 'docs/round-robin-operations.md';
const E = (file, line, symbol, note) => ({ file, line, symbol, note });
const X = (when, happens, handling, status, evidence) => ({ when, happens, handling, status, evidence });
const T = (file, c, covers) => ({ file, case: c, covers });
const PB = 'apps-script/check-player-board.cjs';

const phases = [
{
  phase: 'open', title: 'Opening the Round Robin Desk',
  intro: 'A volunteer arrives, opens the desk on the main laptop, and checks it is on tonight\'s date with the right players and last week\'s winners. Everything later rests on this: the wrong date or a stale page means every sign-in lands on the wrong night.',
  steps: [
    { id: 'open-1-reach', title: 'Open the desk from the club site', who: 'Desk volunteer', when: 'About 6:30 PM',
      summary: 'The volunteer opens **/desk** on the club site (or the bookmarked Google link). The site frames the Google Apps Script web app; Google checks the club account is signed in and serves the desk page. The header pill says **/exec** on the live desk and **/dev** on the test copy.',
      subtext: 'Both /dev and /exec use the same real Sheet. Only /exec is the released code; /dev is whatever was last pushed from a branch.',
      caveats: ['A tab titled "DEV - CTTC Desk" with an amber /dev pill is the test copy. Do not run a night from it.', 'Each page carries a fingerprint of its code, made when Google serves it. A page stays on the code it opened with until it is reloaded.'],
      exceptions: [
        X('The laptop is not signed in to the club Google account', 'After about 10 seconds the /desk page covers the frame with a sign-in card whose button opens the desk directly.', 'Click the button, sign in with the club account, then reopen /desk.', 'handled', 'README.md:357'),
        X('Someone opened the /dev link by mistake', 'It works, on the real Sheet, with untested code. The header pill and tab title say DEV.', 'Close it and open the /exec bookmark. Changes already made are in the real Sheet either way.', 'partial', 'apps-script/Code.js:166')],
      screen: { kind: 'desk', highlight: ['header-date'], status: 'Loading player directory...', note: 'The header, with the /exec pill and the date picker.' },
      tech: {
        entry: [E('apps-script/Code.js', 146, 'doGet', 'Routes ?view=cash|clover|volunteers, otherwise the desk.'), E('apps-script/Code.js', 153, 'deskPage_', 'Builds the page from Index.html, passing initialDate, deskMode and deskBuild.'), E('apps-script/Code.js', 174, 'deskBuild_', 'MD5 of Index.html plus every included file, 12 hex characters.'), E(I, 2489, 'DESK_BUILD', 'The page keeps its own fingerprint for Refresh projector.')],
        state: ['deskMode: dev | live | unknown', 'DESK_BUILD (this page\'s code fingerprint)'], writes: ['None.'], reads: ['ScriptApp.getService().getUrl() to tell /dev from /exec'],
        invariants: ['The main desk on a night runs /exec.', 'A page\'s DESK_BUILD equals deskBuild_ of the code that served it; it never changes without a reload.'],
        limits: ['Google web app: executes as the club account, access MYSELF.'],
        tests: [T('apps-script/check-embed.cjs', '', 'The club site frame and its sign-in fallback.')],
        untested: ['Nothing checks that the main desk is on /exec rather than /dev on a night.'],
        simulate: '`npm run desk:google -- --exec` opens the real live desk read-only and prints the deployment label; the local preview is `PORT=3100 node scripts/desk-preview.js`.' } },
    { id: 'open-2-date', title: 'Check the desk is on tonight\'s date', who: 'Desk volunteer', when: 'On opening',
      summary: 'The date picker starts on today\'s date as the laptop\'s clock sees it, unless the link carries `?date=`. If tonight has no session yet the status bar says **No session exists for this date. Add players to begin.**; if one was started earlier (on any device) it loads with **Session loaded. Changes are stored in Google Sheets.**',
      subtext: 'The date is the key for everything: the session id is `session-YYYY-MM-DD`, and payments, Voice texts, volunteers and promotions are all looked up by it.',
      caveats: ['A desk page left open since yesterday still shows yesterday. It does not roll over at midnight.', 'The picker follows the laptop\'s own time zone. A laptop set to another zone shows a different "today" near midnight.'],
      exceptions: [
        X('The page was left open from a previous night', 'The picker still shows that night. Sign-ins would be added to the old night\'s session (finalized nights are locked; an unfinalized one is not).', 'Reload the page at the start of every night, or set the date and click **Load session**. Check the header date before the first sign-in.', 'gap', 'apps-script/Index.html:568'),
        X('The laptop\'s clock or time zone is wrong', 'The desk opens on the date the laptop believes it is.', 'Set the laptop to Pacific time with automatic time.', 'partial', 'apps-script/Index.html:568')],
      screen: { kind: 'desk', highlight: ['header-date', 'status-bar'], status: 'No session exists for this date. Add players to begin.', note: 'The date picker and the status bar on a fresh night.' },
      tech: {
        entry: [E(I, 568, 'today', 'new Date(now - getTimezoneOffset) .toISOString().slice(0,10): the browser\'s local date.'), E(I, 1020, '(club date)', 'Elsewhere the page uses Intl with timeZone America/Los_Angeles; the two can differ on a laptop not set to Pacific.'), E('apps-script/Code.js', 156, 'initialDate', '?date=YYYY-MM-DD overrides the default.'), E(S, 156, 'getSessionByDate', 'Looks up session-<date>.')],
        state: ['date.value (the picker)', 'loadedDate (the night the page holds)'], writes: ['None until the first change.'], reads: ['getAppState(date)'],
        invariants: ['The date the desk is on equals the club\'s calendar date in Pacific time while the club is open.', 'loadedDate moves only after a load of that date has finished.'],
        limits: [],
        tests: [T('apps-script/check-session-startup.cjs', '', 'Startup history and loading a night.')],
        untested: ['A page left open across midnight.', 'A browser time zone other than Pacific.', 'The two different "today" calculations in Index.html (568 and 1003) agreeing.'],
        simulate: 'In a sim world, set the clock to 00:10 the next day without reloading the tab and add a player: assert which session id the save goes to. Playwright: `context = browser.newContext({ timezoneId: "America/New_York" })` on the preview and read #date at 21:30 Pacific.' } },
    { id: 'open-3-load', title: 'The night loads: players, ratings and last week\'s winners', who: 'Google (server)', when: 'Seconds after opening',
      summary: 'The desk reads the player directory and tonight\'s session from Google, asks the club site for the latest ratings, and reads last week\'s results on the same weekday to find group winners to promote. The workspace line says **ratings current through** a date, and a line under the toolbar names the promotions.',
      subtext: 'Promotions come from the public site, matched to tonight\'s players by name. The ratings line tells you whether last session was finalized.',
      caveats: ['Promotions skip an Equalizer and look only at the same weekday.', 'If the ratings date is older than the last club night, that night was never finalized: its rating changes are not in tonight\'s groups.'],
      exceptions: [
        X('The club site cannot be reached', 'The line reads **Promotion history unavailable:** with the error. Ratings stay as the desk last had them; the next load tries again.', 'Carry on: groups build by rating without promotions. Move last week\'s winners up by hand with the arrows if needed.', 'partial', 'apps-script/Index.html:1400'),
        X('This is the first time this weekday has been played', '**No earlier Monday session found for promotions.**', 'Nothing to do.', 'handled', 'apps-script/Organizer.html:262'),
        X('A winner\'s name changed since last week', 'Winners are matched by exact display name, so a renamed winner is not promoted.', 'Move them up by hand. A desk control to link old and new names would fix it for good.', 'gap', 'apps-script/Index.html:1515')],
      screen: { kind: 'desk', highlight: ['toolbar', 'status-bar'], status: 'Session loaded. Changes are stored in Google Sheets.', note: 'The workspace header with "ratings current through" and the promotions line.' },
      tech: {
        entry: [E(I, 1522, 'load', 'Starts fetchHistory in parallel, calls getAppState, then setGroups.'), E(S, 161, 'getAppState', 'players, session, ratingsSyncedThrough, ratingsFinalizedThrough, print and move marks.'), E(I, 1469, 'syncRatings', 'Calls syncRatingsFromPublicSite once per page; failures are silent.'), E(I, 1490, 'fetchHistory', 'sessions.json then session-details-YYYY.json from the site.'), E(O, 262, 'previousSameWeekday', 'Latest earlier date with the same UTC weekday.'), E(I, 1501, 'loadHistory', 'Group winners by name: byName[name] (line 1515).')],
        state: ['state.players, state.session, state.winners, state.previousDate, state.ratingsSyncedThrough'], writes: ['Players.current_rating when the site has newer results (RatingSync).'], reads: ['getAppState', 'syncRatingsFromPublicSite', 'site: data/sessions.json, data/session-details-YYYY.json, data/players.json'],
        invariants: ['A winner of group N (N > 1) last week starts tonight in group N-1 or higher, unless absent.', 'Starting ratings equal the latest finalized results.'],
        limits: ['RatingSync also runs hourly on a timer.'],
        tests: [T('apps-script/check-organizer.cjs', '', 'Promotions and grouping rules, cross-checked against real groups.'), T('apps-script/check-rating-sync.cjs', '', 'Rating sync from the site.')],
        untested: ['A renamed winner (name match fails).', 'The site unreachable during load: what the organizer sees.'],
        simulate: 'Preview: `PORT=3100 node scripts/desk-preview.js`, open http://localhost:3100/?date=2026-09-28. For the history path, stub siteJson to reject and assert the context line text.' } },
    { id: 'open-4-draft', title: 'An unsaved copy from earlier is waiting on this laptop', who: 'Desk volunteer', when: 'On opening, sometimes',
      summary: 'If this laptop kept changes that never reached Google (wifi dropped, tab closed early), a notice offers the device copy against Google\'s. The status bar says **Session loaded. This device also has an unsaved copy: choose which to keep in the notice above.** Editing waits until someone chooses.',
      subtext: 'The device copy is a safety net. Choosing it replaces what Google has for the night; choosing Google\'s discards the device copy.',
      caveats: ['Choosing the device copy can overwrite sign-ins made on another device since. The confirm shows both versions\' counts: read them.'],
      exceptions: [
        X('The device copy names a player since removed from the directory', '**The device copy contains players no longer in the directory. Download it for review.**', 'Download it and keep Google\'s version; re-add anyone missing by hand.', 'handled', 'apps-script/Index.html:927'),
        X('Nobody notices the notice', 'Edits are blocked (pendingRecovery) until a choice is made, so the desk does not quietly fork.', 'Answer it before signing anyone in.', 'handled', 'apps-script/Index.html:881')],
      screen: { kind: 'desk', highlight: ['draft-notice', 'status-bar'], status: 'Session loaded. This device also has an unsaved copy: choose which to keep in the notice above.', note: 'The amber notice offering the device copy or Google\'s.' },
      tech: {
        entry: [E(I, 881, 'offerDeviceDraft', 'Compares the device draft with the loaded session.'), E(I, 687, 'persistDeviceDraft', 'Writes the draft to localStorage on every change.')],
        state: ['pendingRecovery', 'localStorage device drafts by date'], writes: ['saveSessionDraft when the device copy is chosen.'], reads: [],
        invariants: ['No edit is accepted while pendingRecovery is set.', 'A device copy is never applied without a person choosing it.'],
        limits: [],
        tests: [T('apps-script/check-offline-draft.cjs', '', 'Drafts kept offline and recovered.')],
        untested: [],
        simulate: 'desk-sim: a tab with the network dropped, add players, close, reopen with the network up: assert the notice and that addPlayer is refused until a choice.' } },
    { id: 'open-5-board-laptop', title: 'Open the projector laptop', who: 'Projector laptop', when: 'Before the first sign-ins',
      summary: 'On the second laptop: sign in, open /desk, load tonight, click **Player board**, and choose **Show the main laptop\'s desk**. That turns on follow mode and goes full screen in the same click. From then on the projector shows the main desk\'s changes about 10 seconds behind.',
      subtext: 'The projector laptop runs its own copy of the desk, read-only while following. Its code is whatever it loaded; a release later in the night does not reach it until its desk page is reloaded.',
      caveats: ['Reload the projector\'s desk page at the start of each night, so it runs the same code as the main desk.', 'The question "What is this screen for?" is asked once per computer and remembered there.'],
      exceptions: [
        X('The browser blocks the board\'s pop-up window', '**The browser blocked the Player board window. Allow pop-ups for this page, then click Player board again.**', 'Allow pop-ups for the desk in the browser\'s address bar.', 'handled', 'apps-script/PlayerBoard.html:1787'),
        X('The projector laptop opened before the main desk started the night', 'The board waits and starts following once the main desk saves.', 'Nothing to do.', 'handled', 'apps-script/check-player-board.cjs:473')],
      screen: { kind: 'board', highlight: ['chooser'], note: 'The one-time question on a new computer.' },
      tech: {
        entry: [E(B, 1787, 'open', 'Opens or reuses the named window and writes the board page when its fingerprint differs.'), E(I, 2504, 'startFollow', 'Follow mode on the projector\'s desk.')],
        state: ['board settings in localStorage (cttc-player-board-settings-v1): concept, follow, asked'], writes: ['None (following is read-only).'], reads: ['getDeskStamps every 10 s, getFollowState when a stamp moves'],
        invariants: ['A following desk never writes the session.', 'The board window\'s code matches its desk page after a Player board click.'],
        limits: ['Follow checks every 10 s, once a minute after 20 quiet minutes, end at finalize or after 6 hours (docs/round-robin-operations.md).'],
        tests: [T(PB, 'projectorFirst', 'Projector opened before the main desk.'), T(PB, 'followMode', 'Following, read-only, its read pattern.')],
        untested: ['The real browser pop-up and full screen permissions.'],
        simulate: 'Preview + Playwright: click Player board, wait for the popup page, click #choose-follow; assert document.fullscreenElement.' } }
  ],
  findings: [
    { severity: 'low', kind: 'fragile', title: 'The default date depends on the laptop, and an open page never rolls over', detail: 'today() uses the browser\'s own time zone while the rest of the page uses Pacific time, and nothing moves the picker at midnight. A desk left open from Monday and used on Wednesday adds Wednesday\'s players to Monday\'s night if Monday was not finalized.', evidence: [I + ':568', I + ':1020'], confirmed: 'read code only', suggest: 'Default the picker with the Pacific formatter at line 1003, and warn when loadedDate is not today on the first sign-in of a page loaded more than 12 hours ago.' },
    { severity: 'low', kind: 'design-gap', title: 'Promotions match last week\'s winners by display name', detail: 'If last week\'s Group 3 winner "Dev M." is renamed "Dev Malhotra" in the directory, the promotion silently does not happen.', evidence: [I + ':1515'], confirmed: 'read code only', suggest: 'Publish player ids with session details and match by id, falling back to name and aliases.' }
  ]
},
{
  phase: 'signin', title: 'Player Sign-In and Group Formation',
  intro: 'Players arrive, pay, and are signed in from the directory, from Voice texts, or as new players. Until the sheets print, the desk keeps the groups as Rebuild by rating would make them; after someone moves a player by hand, it stops reshuffling.',
  steps: [
    { id: 'signin-1-rr', title: 'Sign a player in to the round robin', who: 'Desk volunteer', when: 'From about 6:45 PM',
      summary: 'Search the directory and click **RR** beside the name. The player joins the roster and the groups rebuild by rating in groups of 6 (or 5 where the numbers do not divide), with last week\'s winners moved up. The row shows **In RR**.',
      subtext: 'Before printing, every sign-in can move other players between groups. That is intended: the board says "Signing in · groups can still change".',
      caveats: ['Choosing **Groups of 5 / 6 / 7** rebuilds like **Rebuild by rating**.', '**Open** puts the player on Open Play / Coaching instead of the round robin.'],
      exceptions: [
        X('Someone was already moved by hand', 'The desk no longer rebuilds: a new player slots in by rating without reshuffling anyone, and promoted players are never bumped down.', 'Use **Rebuild by rating** if a clean rebuild is wanted; it asks first.', 'handled', 'apps-script/Organizer.html:79'),
        X('Two people with the same name', 'Both can sign in; standings tell them apart by id.', 'Check the rating shown beside the name before clicking RR.', 'partial', 'apps-script/Organizer.html:193')],
      screen: { kind: 'desk', highlight: ['directory', 'groups'], note: 'The directory with RR and Open buttons, and the groups rebuilding.' },
      tech: {
        entry: [E(I, 1140, 'addToRoster', 'Refuses while locked, pending recovery or following.'), E(I, 1108, 'organize', 'O.organize then O.applyPromotions, then setGroups.'), E(O, 36, 'organize', 'Sort by rating, cut into sizes from sizeGroups.'), E(O, 17, 'sizeGroups', 'Fewest groups of the preferred size or one smaller.'), E(O, 49, 'applyPromotions', 'Each winner one group up; the overfull group passes its lowest non-winner down.'), E(I, 1070, 'keepArrangement', 'arrangedByHand() or playAfterPrint() switches to insert.')],
        state: ['state.roster', 'state.groups', 'state.promotions'], writes: ['saveSessionDraft (autosave, Sessions, SessionPlayers, Matches)'], reads: [],
        invariants: ['Before print and with no hand moves, groups equal Rebuild by rating.', 'After a hand move, a sign-in moves nobody already placed.', 'A promoted player is never bumped below the group they were promoted to.'],
        limits: [],
        tests: [T('apps-script/check-organizer.cjs', '', 'Sizes, promotions, insert; 459 real groups cross-checked.'), T(PB, 'roundRobinNight', 'Sign-ins on the desk reach the board.')],
        untested: [],
        simulate: 'desk-sim: `tab.addPlayer(id)` for 30 players; assert groupsNow() equals O.organize + applyPromotions on the same roster.' } },
    { id: 'signin-2-voice', title: 'Add players who texted in', who: 'Desk volunteer', when: 'Through the evening',
      summary: 'Players who text the club\'s Voice number appear under **Voice signups**, matched to directory names. **Add all** signs in every confident match; each row also has its own **RR** and **Hide**.',
      subtext: 'Texts arrive through Gmail. A timer reads the mailbox every few minutes in the evening, so a text can take minutes to show; **Refresh** reads at once.',
      caveats: ['A match is a suggestion. Check it is the right person before adding, especially for first names only.'],
      exceptions: [
        X('A text matches the wrong player', 'The suggestion is shown with a question mark when unsure; nothing is added until someone clicks.', 'Search the right name and add with RR instead; Hide the wrong suggestion.', 'handled', 'apps-script/VoiceSuggestions.js'),
        X('The mail reader timer has stopped', 'No new texts appear.', 'Click **Refresh**. If texts still do not show, sign players in by hand and report it.', 'partial', 'apps-script/MailReader.js:160')],
      screen: { kind: 'desk', highlight: ['voice'], note: 'Voice signups with Add all and per-row RR.' },
      tech: {
        entry: [E('apps-script/MailReader.js', 66, 'mailJob_', 'Timer-driven read of Voice texts into the VoiceTexts tab.'), E('apps-script/MailReader.js', 49, 'MAIL_DAY_EVERY_MS_', 'Every 5 minutes in the day, every 30 minutes 11 PM to 7 AM.')],
        state: ['VoiceTexts tab rows'], writes: ['VoiceTexts (mail reader)'], reads: ['Gmail search for Voice mail'],
        invariants: ['A text is suggested only for the date it was received (Pacific).', 'Nothing is added to the roster without a click.'],
        limits: ['Gmail reads count against the club account\'s shared daily limits: see docs/google-limits.md.'],
        tests: [T('apps-script/check-mail-reader.cjs', '', 'Mail reading cadence and parsing.'), T('apps-script/check-voice-service.cjs', '', 'Matching texts to players.')],
        untested: [],
        simulate: 'Offline only through check-voice-service.cjs fixtures.' } },
    { id: 'signin-3-new', title: 'Add a new player', who: 'Desk volunteer', when: 'When someone new arrives',
      summary: 'Type the full name and a rating under **Add a player** and click **Add**. The player is saved to the directory at once and can then be signed in. First visits are marked on the board with "1st visit · welcome!".',
      subtext: 'A new player is written to Google immediately, separately from the night\'s autosave.',
      caveats: ['Check the directory first. A duplicate under a slightly different spelling splits that person\'s history.'],
      exceptions: [
        X('The rating is not a whole number from 0 to 4000', '**Rating must be a whole number from 0 through 4000.**', 'Correct it and add again.', 'handled', 'apps-script/SessionService.js:53'),
        X('Offline when adding', 'The add waits; the night\'s draft syncs once the player exists on Google ("A player is still being made active on Google...").', 'Keep going; check the player appears after the connection returns.', 'handled', 'apps-script/check-offline-actions.cjs')],
      screen: { kind: 'desk', highlight: ['add-player'], note: 'Add a player: name, rating, Add.' },
      tech: {
        entry: [E(S, 53, 'addPlayer', 'Validates and appends to Players.')],
        state: ['state.players'], writes: ['Players row'], reads: [],
        invariants: ['A player id is never reused or renamed by adding.'],
        limits: [], tests: [T('apps-script/check-player-edits.cjs', '', 'Adding and editing players.')], untested: ['Near-duplicate names (no warning exists).'],
        simulate: 'desk-sim world.server.run("addPlayer", "Ana Reyes", 1200).' } },
    { id: 'signin-4-pay', title: 'Take payment', who: 'Desk volunteer', when: 'At sign-in',
      summary: 'Each row has a **Payment** button. Monthly Zeffy pass holders show **Zeffy ✓** automatically; card payments taken on the Clover reader appear under **Clover card payments** and are matched to players by the name on the card. Someone a known card paid for who is not signed in yet is listed at the top of that section under **Paid by card, not checked in**, with **RR** and **Open** as for Voice signups. Cash, Venmo and Zelle are chosen on the button. Choosing **Credit** on the button is a clue too: a card payment the desk cannot place is ticked for whoever was marked Credit at about that time ("Likely Drew: marked Credit at 7:03 PM"), and one person paying for two gets pairs whose fees add up, then **Whose card?**. With no Credit mark, what the same card paid for on earlier nights is the next clue, and players who usually pay by card come first.',
      subtext: 'Payments are kept per player per night. The Clover list checks every minute while tonight is open.',
      caveats: ['A card name that does not match a player waits under "Cards to check" on the Clover page; once linked, that card is remembered.', 'Free spots and volunteer play follow the night\'s fee rules.', 'Juniors (and their member account) and who pays for whom are set in the player\'s pencil window, under **Links**. A member\'s card covering their junior then matches by itself.'],
      exceptions: [
        X('A player pays on someone else\'s card', 'Marked Credit at the desk, the player is ticked for the payment no card fits ("Likely ..."). A card the desk knows (the cardholder\'s) is asked about instead, with the cardholder ticked.', 'Tick the right player and Match. When the same card has paid for them twice, save the offered "pays for" link.', 'handled', 'apps-script/CloverPayments.js:392'),
        X('A Zeffy pass holder pays for someone else (their junior, a friend)', 'The holder\'s fee never counts. With a junior or pays-for link that adds up, the other player is matched by itself. Otherwise: "{holder} has a Zeffy play pass, so their card paid for someone else. Who?", with the holder shown as whose card it is, never ticked.', 'Tick who it was for and Match: the card is remembered as the holder\'s. After a second time, save the offered "pays for" link.', 'handled', 'apps-script/CloverPayments.js:294'),
        X('One person pays for two', 'A $20 payment from a card the desk does not know: **For two?** offers pairs whose fees add up, those marked Credit (or linked) first. Ticking two asks **Whose card?**.', 'Press the pair, choose whose card, Match. The card is remembered as theirs; after a second time the desk offers to save that they pay for the other.', 'handled', 'apps-script/CloverPayments.js:937'),
        X('A paid player is removed or moves to Open Play', 'unconfirmed: the payment stays recorded for the player and night.', 'Check the payment still shows where they now are.', 'partial', '')],
      screen: { kind: 'desk', highlight: ['clover', 'zeffy', 'group-row'], note: 'A row\'s Payment button beside the Clover and Zeffy lists.' },
      tech: {
        entry: [E('apps-script/CloverPayments.js', 319, 'cloverMatchNight_', 'Matches the night\'s card payments to players.'), E('apps-script/CloverPayments.js', 249, 'cloverByName_', 'Name match, with learned card links first.'), E('apps-script/NightFees.js', 1, '', 'Night fees and the Friday/Saturday special.'), E(I, 3850, 'arrivalsOf', 'Card payers on this date not yet in RR, Open Play or Coaching, offered with RR and Open.'), E('apps-script/CloverPayments.js', 392, 'cloverCreditClues_', 'Credit marked by hand as the clue for payments no card fits: likely player, pairs, and the one case matched by itself.'), E('apps-script/CloverPayments.js', 937, 'cloverPaysForOffers_', 'Offers to save "X pays for Y" once a card has covered the same player twice.'), E('apps-script/CloverPayments.js', 970, 'addCloverPaysFor', 'Saves the offer after Confirm, with the pencil window\'s link checks.'), E('apps-script/LinkedNames.js', 115, 'linkPlan_', 'Junior and pays-for links from the pencil window: one active player per name, a junior on one account.')],
        state: ['window.cttcPayments.status(id)'], writes: ['Payment rows (PrivatePayments.js); CloverLinks', 'NameLinks pays_for rows (the offer, or the pencil window)'], reads: ['Clover API through the desk (token in Script Properties)'],
        invariants: ['A payment belongs to a player id and a date, not to a group or a position.', 'Adding a card payer from Clover only puts them in this device\'s draft or Open Play, as the directory\'s buttons do; it changes nothing on Clover, and only a payment the desk knows the player for (matched, or a payer whose amount needs a look) suggests anyone.', 'A Credit marked by hand matches a card payment by itself only when each is the only one at that amount, within 15 minutes, on a payment the organizer never undid; no card is learned from it.', 'A card is remembered only for the person the organizer says it is (the one player ticked, or Whose card?).', 'A card\'s history and who usually pays by card only order and tick suggestions; neither matches a payment by itself.'],
        limits: ['Clover requests: at most 3 at once, 4 retries.'],
        tests: [T('apps-script/check-clover-desk.cjs', '', 'Clover on the desk.'), T('apps-script/check-clover-section.cjs', '', 'The Clover section: card payers offered with RR and Open, Credit clues, pairs, Whose card?, the pays-for offer.'), T('apps-script/check-clover-payments.cjs', '', 'Matching rules, including Credit clues and juniors as paid for.'), T('apps-script/check-player-links.cjs', '', 'Junior and pays-for links in the pencil window.'), T('apps-script/check-night-fees.cjs', '', 'Fees.'), T('apps-script/check-free-night-passes.cjs', '', 'Free spots and passes.')],
        untested: ['A player removed after paying.', 'Credit marked on two desks at once: each desk\'s check sees the other\'s Credit only once Google has it.'],
        simulate: 'Clover paths are covered offline by the check-clover-* fixtures; the real list only through `npm run desk:google -- --view clover` (read-only).' } },
    { id: 'signin-5-move', title: 'Move players between groups by hand', who: 'Desk volunteer', when: 'Before printing',
      summary: 'The ↑ and ↓ arrows move a player up or down one group. Moving up marks them with ▲ on the board. Once anyone is moved by hand, new sign-ins slot in without reshuffling, and **Rebuild by rating** asks before undoing the moves.',
      subtext: '"Moved by hand" is read off the groups themselves (they differ from what Rebuild would make), so it survives a reload and another device.',
      caveats: ['Rebuild by rating and changing the group size replace hand moves and reapply promotions.'],
      exceptions: [
        X('Rebuild clicked by mistake after moves', 'A confirm names what would be lost ("Manual moves are replaced; promotions are reapplied.").', 'Cancel it.', 'handled', 'apps-script/Index.html:1074')],
      screen: { kind: 'desk', highlight: ['group-row'], note: 'The ↑ ↓ × controls on a row.' },
      tech: {
        entry: [E(I, 1182, 'move', 'Moves within groupArrays and records movedUp.'), E(I, 1074, 'rebuildQuestion', 'The confirm text before a rebuild.')],
        state: ['movedUp (shared via saveSessionMoves)'], writes: ['saveSessionMoves (document property cttc-moves:<session>)', 'autosave'], reads: [],
        invariants: ['Arrangement by hand is detected from the groups, not a flag that can go stale.'],
        limits: [], tests: [T(PB, 'roundRobinNight', 'Moves reach the board with ▲.')], untested: [],
        simulate: 'desk-sim: tab.movePlayer(id, "-1"); then addPlayer; assert nobody else moved.' } }
  ],
  findings: []
},
{
  phase: 'print', title: 'Printing Score Sheets and Later Changes',
  intro: 'Once groups are set, the sheets are printed and handed to each table. From that moment the paper is the source of truth at the tables: nobody already printed should change table, and the order of matches on screen must match the paper.',
  steps: [
    { id: 'print-1-print', title: 'Print the round robin sheets', who: 'Desk volunteer', when: 'About 7:10 PM',
      summary: 'Click **Print RR Sheets**. The desk saves to Google first, fetches each player\'s club and year records, and shows one sheet per group: **Table #** with the group number, the players with rating and records, and the match schedule with boxes for games won.',
      subtext: 'Printing makes the **print mark**: who was in which group, and the match order on each sheet. Everything after the print is placed relative to it.',
      caveats: ['Records that take longer than 8 seconds print as --/--. The sheet is still correct for play.', 'A group of 7 (21 matches) uses tighter rows to fit one page.'],
      exceptions: [
        X('The save before printing fails', 'The print waits for a save; offline, the device copy is used.', 'Reconnect and print again if the sheets must carry records.', 'partial', 'apps-script/Index.html:1979'),
        X('The print dialog is cancelled', 'unconfirmed: whether the mark is made before or after the dialog.', 'If no sheets came out, use **Undo the print** in Print labels.', 'partial', 'apps-script/Print.html:294')],
      screen: { kind: 'sheet', highlight: ['register', 'schedule'], note: 'One table\'s sheet: players on the left, the match schedule on the right.' },
      tech: {
        entry: [E(P, 294, 'print', 'Collects groups and matches from cttcDesk.print(), fetches records with an 8 s timeout.'), E(P, 243, 'tournamentSheets', 'One sheet per group; Table # is group.groupNumber; matches in state.matches order.'), E(B, 1809, 'printed', 'Records { at, groups, first, order } for tonight.'), E(B, 1879, 'sheetOrder', 'For each group, pairs of places in the printed lineup.')],
        state: ['print mark in localStorage cttc-player-board-printed-v1'], writes: ['saveSessionPrint (document property cttc-print:session-<date>)'], reads: ['getPlayerRecordsForPrint'],
        invariants: ['The schedule on the paper lists matches in the same order and with the same sides as the scoring section.', 'Table # on the paper equals the group number on the desk.'],
        limits: ['Records fetch: 8 s, then --/--.', 'Print mark: 8000 characters, kept 21 days.'],
        tests: [T('apps-script/check-print.cjs', '', 'Sheet content.'), T(PB, 'playOrderAfterPrint', 'The printed order is kept with the mark.')],
        untested: ['The printed page layout itself (only the DOM is checked).', 'Cancelling the print dialog.'],
        simulate: 'desk-sim: tab.window.cttcPlayerBoard.printed(); read world.server.run("getAppState", date).printed.' } },
    { id: 'print-2-share', title: 'Every device learns the sheets printed', who: 'Second device', when: 'Within a minute of printing',
      summary: 'The print mark goes to Google. Other desks (an officer\'s phone, the projector laptop) pick it up on their once-a-minute refresh or on load, and from then on follow the same after-print rules. The board switches from sign-ins to live scores.',
      subtext: 'Without the mark, a second device would still rebuild groups on each sign-in and reshuffle printed players.',
      caveats: ['A device that was offline at the print learns of it when it reconnects; anything it changed in between is merged with care.'],
      exceptions: [
        X('Printed offline', 'The mark waits in the outbox and is sent when the connection returns.', 'Nothing to do.', 'handled', 'apps-script/PlayerBoard.html:1842')],
      screen: { kind: 'devices', highlight: ['main-desk', 'google', 'phone', 'projector'], note: 'The mark travels from the main desk through Google to every other device.' },
      tech: {
        entry: [E(B, 1842, 'fromGoogle', 'Applies Google\'s mark unless this device\'s own change is newer or still in the outbox.'), E(S, 235, 'saveSessionPrint', 'Validates and stores the mark; touches the desk stamps.'), E(S, 228, 'pruneBoardMarks_', 'Drops marks older than 21 days.')],
        state: ['print mark'], writes: ['document property cttc-print:session-<date>'], reads: ['getAppState.printed (load and refresh)'],
        invariants: ['Every device that has the mark applies the same after-print rules.'],
        limits: ['Other desks refresh about once a minute; the projector within about 10 s.'],
        tests: [T(PB, 'printMarkAcrossDevices', 'A second device learns of the print, follows the rules, and Undo the print reaches it.')], untested: [],
        simulate: 'desk-sim: two devices; print on one, run 70 s, assert the other\'s printedRoster().' } },
    { id: 'print-3-late', title: 'A late arrival joins after printing', who: 'Desk volunteer', when: 'After 7:10 PM',
      summary: 'Sign them in as usual. They join the group their rating gives them, even if that makes a group of 7 or 8, and nobody else moves. The status says the player was added **as a late add. Nobody else moved**, and the row carries a **Late add** label. Their matches go at the end of that group\'s list.',
      subtext: 'The group\'s printed matches keep their places, so the paper still lines up with the screen for everything already on it.',
      caveats: ['Write the late add\'s matches onto the table\'s sheet by hand, or reprint that one group (**Print labels** names it).'],
      exceptions: [
        X('Several late adds land in the same group', 'The group grows; nobody is passed down.', 'Use the arrows if a group gets too big; moving someone after print changes two sheets.', 'handled', 'apps-script/check-player-board.cjs:137')],
      screen: { kind: 'desk', highlight: ['print-labels', 'group-row'], status: 'Ana Reyes added to Group 2 as a late add. Nobody else moved.', note: 'A Late add badge on Group 2 and the Print labels note.' },
      tech: {
        entry: [E(O, 79, 'insert', 'stay = true after print: joins the target group, nobody bumped.'), E(O, 113, 'keptPairs', 'Printed pairs keep order and sides; new pairs follow.'), E(I, 1120, 'buildMatches', 'Uses keptPairs whenever a print mark exists.')],
        state: ['state.groups', 'state.matches'], writes: ['autosave'], reads: [],
        invariants: ['After print, no printed player changes group because of a sign-in.', 'The printed matches of a group keep their relative order and sides; new matches come after them.'],
        limits: [], tests: [T(PB, 'lateAddAfterPrint', 'Late adds move nobody and carry labels.'), T(PB, 'playOrderAfterPrint', 'A late add\'s matches go at the end.')], untested: [],
        simulate: 'desk-sim: print, addPlayer(late); compare orderOf(group) with the printed order.' } },
    { id: 'print-4-remove', title: 'A player leaves after printing', who: 'Desk volunteer', when: 'During play',
      summary: 'Click **×** on their row. Only their matches leave the group\'s list; every other match stays where it is on the paper, with its score. Nobody else changes table, and every group keeps the number on its sheet ("Table #").',
      subtext: 'Before Monday\'s fix this rebuilt the whole order and the screen stopped matching the paper.',
      caveats: ['Strike the player\'s matches through on the paper sheet.'],
      exceptions: [
        X('Everyone in one group leaves', 'That group goes; every other group keeps its printed number, so Table #3\'s sheet is still Group 3 on the desk, the board and the results. No sheet is named to replace. (Before Nov 11, 2026 the later groups were renumbered.)', 'Nothing to do; the table is free for open play.', 'handled', 'apps-script/Index.html:964'),
        X('A player with scores is removed', 'Their matches and scores are dropped from the night.', 'Use a forfeit instead if the results should count.', 'partial', 'apps-script/Index.html:1164')],
      screen: { kind: 'desk', highlight: ['group-row', 'scoring'], note: 'A removed row, and the scoring list with the remaining matches in printed order.' },
      tech: {
        entry: [E(I, 1164, 'removeFromRoster', 'After print: setGroups with the player filtered out (no reorganize).'), E(I, 964, 'setGroups', 'With KEEP_NUMBERS after the print, each group keeps its number and an emptied group goes; numbers from Google, device copies and merges are kept too. Before the print, groups are numbered 1, 2, 3.'), E(B, 1254, 'groupsByNumber', 'Group N at index N - 1, [] for a gap: how the print mark records groups.'), E(B, 1261, 'changedGroups', 'Compares each group with the printed sheet of the same number; a gone group has no sheet to replace.')],
        state: ['state.groups (groupNumber can skip one after the print)', 'state.matches'], writes: ['autosave (SessionPlayers.group_number keeps the printed number)'], reads: [],
        invariants: ['After print, a group keeps its printed number for the rest of the night, on every device and after reload.', 'Removing a player removes only matches that include them.'],
        limits: [], tests: [T(PB, 'playOrderAfterPrint', 'Removals keep the printed order and scores.'), T(PB, 'groupEmptiedAfterPrint', 'An emptied group keeps every other number: desk, scores, Google, another device, Clear labels; no sheet named to replace.')],
        untested: [],
        simulate: '`node docs/storyboard/repro/empty-group.cjs` prints FIXED: groups stay 1 and 3 after Group 2 empties.' } },
    { id: 'print-5-labels', title: 'Print labels: replace a sheet, clear labels, or undo the print', who: 'Desk volunteer', when: 'Whenever the groups differ from the paper',
      summary: 'While any group differs from its printed sheet, a note above the groups lists **Late add** players and **Updated** groups. **Clear labels** counts the groups as they are now as printed. **Undo the print** is for a print made by mistake: the desk acts as if the sheets never printed (**Print undone: the desk acts as if the sheets never printed. Other devices follow within a minute.**).',
      subtext: 'Undo the print also gives up the kept play order: the matches go back to the plain order for the groups as they are.',
      caveats: ['Never use Undo the print once sheets are on the tables: sign-ins start rebuilding groups again.'],
      exceptions: [X('Clear after a print', 'Clear also undoes the sheets print.', 'Only clear the roster when starting over.', 'handled', 'apps-script/check-player-board.cjs:244')],
      screen: { kind: 'desk', highlight: ['print-labels'], status: 'Print labels cleared: the groups as they are now count as printed.', note: 'The Print labels note with Clear labels and Undo the print.' },
      tech: {
        entry: [E(B, 1922, 'labels', 'Late and updated, or null.'), E(B, 1932, 'keepAsPrinted', 'Rewrites the mark with the current groups and order.'), E(B, 1941, 'forgetPrint', 'Shares { undone: true }.'), E(I, 1289, 'renderPrintLabels', 'Shows the note only while a label exists.')],
        state: ['print mark'], writes: ['saveSessionPrint'], reads: [],
        invariants: ['The note is visible exactly while some group differs from its printed sheet.'],
        limits: [], tests: [T(PB, 'printLabels', 'Labels, Clear labels, Undo the print.')], untested: [], simulate: 'desk-sim: print, add late, call keepAsPrinted(); assert labels() is null.' } }
  ],
  findings: [
  ]
},
{
  phase: 'board', title: 'The Projector Display',
  intro: 'The projector shows every group to the room: who is where before printing, then live standings. It must stay readable from across the gym, never cover a name, and keep up with the main desk.',
  steps: [
    { id: 'board-1-layouts', title: 'Pick a layout: Wall, Carousel or Spotlight', who: 'Owner', when: 'Before play, or from the main desk',
      summary: '**Wall** shows every group at once; **Carousel** slides through two groups at a time; **Spotlight + names** shows one group large beside an A–Z list. The board is drawn at 1920×1080 and scaled to the screen, so a 4:3 projector gets bars above and below.',
      subtext: 'The main desk can change the projector\'s layout without walking over: **Projector screen** next to Player board.',
      caveats: ['On Wall, more than 8 groups do not fit names at full width (see findings). Carousel never truncates in the measurements.'],
      exceptions: [
        X('9 groups on Wall', 'Panels get narrow; long names are cut off with an ellipsis: 43 of 54 names in the measurement, at every screen size.', 'Switch to Carousel on big nights.', 'gap', 'apps-script/PlayerBoard.html:624'),
        X('Groups of 7 or 8 on Spotlight', '2 names cut off in the measurement.', 'Use Wall or Carousel for big groups.', 'gap', 'apps-script/PlayerBoard.html:796')],
      screen: { kind: 'board', highlight: ['panels'], note: 'Six groups on the Wall layout.' },
      tech: {
        entry: [E(B, 989, 'fit', 'scale = min(w/1920, h/1080); centered.'), E(B, 624, 'wallFill', 'cols = n ≤ 2 ? n : n ≤ 4 ? 2 : ceil(n/2); at most two rows; .many at 4+ columns.'), E(B, 542, 'carouselFill', 'Two panels at a time.'), E(B, 796, 'spotFill', 'One panel and the index.')],
        state: ['S.concept, S.look, S.secs, S.pay, S.rating'], writes: ['localStorage settings'], reads: [],
        invariants: ['No player name is cut off or hidden in any layout for up to 9 groups of up to 8 at any 16:9 or 4:3 screen.', 'Nothing on top of the board covers a row while full screen.'],
        limits: ['Smallest name text measured: 11.7 px on Wall at 800×600; 14.9 px at 1024×768.'],
        tests: [T(PB, 'roundRobinNight', 'Layouts render the night (DOM only).')],
        untested: ['Any measurement of clipping or truncation: jsdom has no layout. Only a real browser can check it.'],
        simulate: 'Preview + Playwright at 1024×768, 1280×720, 1366×768, 1920×1080, 1400×1050, 800×600; for each .name compare scrollWidth with clientWidth (docs/storyboard/repro/measure-board.js).' } },
    { id: 'board-2-strip', title: 'Go full screen; the settings strip goes away', who: 'Projector laptop', when: 'Once the board is up',
      summary: 'The green settings strip stays up until **Full screen** is clicked, in every layout. In full screen it is gone and the mouse does not bring it back; **Esc** leaves full screen and the strip returns.',
      subtext: 'Outside full screen the strip sits over the bottom of the board: at 1280×720 it covered 3 to 4 rows in the measurements. That is expected now; full screen is the projector\'s mode.',
      caveats: ['Change settings, then press Full screen last.'],
      exceptions: [X('The browser refuses full screen', 'The strip stays up over the bottom rows.', 'Use the browser\'s own full screen (F11) or zoom out.', 'partial', 'apps-script/PlayerBoard.html:1091')],
      screen: { kind: 'board', highlight: ['strip'], note: 'The strip over the bottom of the board before Full screen.' },
      tech: {
        entry: [E(B, 1091, 'showStrip', 'Hidden exactly while document.fullscreenElement is set.')],
        state: ['document.fullscreenElement'], writes: [], reads: [],
        invariants: ['In full screen the strip is hidden in every layout, following or not.'],
        limits: ['Mouse pointer hides after 4 s in full screen.'],
        tests: [T(PB, 'stripGoesInFullScreen', 'All three layouts and a following board.')],
        untested: ['Real full screen in a projector\'s browser.'], simulate: 'Playwright: click #bc-full; assert .bc.hidden; press Escape; assert not hidden.' } },
    { id: 'board-3-follow', title: 'The projector follows the main desk', who: 'Projector laptop', when: 'All night',
      summary: 'Every 10 seconds the projector\'s desk asks Google whether anything changed and reads only what did. A sign-in, a score or a payment on the main desk shows on the projector about 10 to 20 seconds later, with the same animations.',
      subtext: 'After 20 quiet minutes it checks once a minute. Following ends when the night is finalized or after 6 hours, and the projector\'s desk cannot edit while following.',
      caveats: ['A change shows only after the main desk has saved it to Google; if the main desk is offline, the projector shows the last picture.'],
      exceptions: [
        X('Google stops answering', 'After 90 seconds: **Following the main desk: Google has not answered for N min. Showing the last picture.**', 'Check the main desk\'s status bar; the projector catches up by itself.', 'handled', 'apps-script/PlayerBoard.html:965'),
        X('The projector\'s desk tab is closed or reloaded', '**Not connected to the desk. Click Player board on the desk to reconnect.**', 'Reopen the desk tab and click Player board.', 'handled', 'apps-script/PlayerBoard.html:977')],
      screen: { kind: 'board', highlight: ['stage-pill', 'panels'], status: 'Sheets printed · live scores', note: 'Live standings on the projector.' },
      tech: {
        entry: [E(I, 2526, 'followCheck', 'Reads getDeskStamps, then only the changed areas.'), E(ID, 94, 'getDeskStamps', 'Stamps s, p, e, d plus ev, screen, refresh.'), E(ID, 77, 'touchDeskSession_', 'Bumped on every session save.')],
        state: ['follow { on, lastOk, lastCheck, refreshAt, screenAt }'], writes: ['logFollowMode stats'], reads: ['getDeskStamps every 10 s', 'getFollowState / getAppState on change'],
        invariants: ['The projector never shows a state the main desk has not saved.', 'Worst case lag ≈ autosave delay + 10 s beat + one read.'],
        limits: ['10 s beat; 60 s after 20 quiet minutes; ends at finalize or 6 h.'],
        tests: [T(PB, 'followMode', 'Read pattern and lag.'), T(PB, 'followEventSwitch', 'Round robin / Equalizer switch.')], untested: [],
        simulate: 'desk-sim: device A edits, device B follows; count world.traffic getAppState reads.' } },
    { id: 'board-4-release', title: 'A release during the night', who: 'Projector laptop', when: 'Only if code is released mid-night',
      summary: '**Refresh projector** on the main desk makes the projector read the night again; if its code is older it says **This laptop is running an older version of the desk than the main desk. Reload this page on this laptop...** Someone must reload the desk page on the projector laptop, then click **Player board**: the open board window is rewritten with the new code.',
      subtext: 'Nothing on the main desk can reload the projector laptop. Until Monday\'s fix, a board window left open kept its old code even after that reload.',
      caveats: ['Avoid releasing during play. If you must, reload every open desk afterwards: main, projector, phones.'],
      exceptions: [X('The release changes what the desk saves (a new field)', 'Older pages keep running until reloaded and may not carry the new field when they save.', 'Reload every device right after a release.', 'partial', 'apps-script/Index.html:2489')],
      screen: { kind: 'board', highlight: ['notice'], status: 'This laptop is running an older version of the desk than the main desk. Reload this page on this laptop, then click Player board.', note: 'The older-code notice on the projector.' },
      tech: {
        entry: [E(ID, 61, 'requestFollowRefresh', 'Stores { at, build }.'), E(I, 2489, 'DESK_BUILD', 'Compared with refresh.build.'), E(B, 1753, 'VERSION', 'Fingerprint of the board page; open() rewrites a window with another.')],
        state: ['follow.oldCode'], writes: ['desk-stamp:<date>:refresh'], reads: [],
        invariants: ['After a reload and a Player board click, the board window runs the same code as its desk page.'],
        limits: [], tests: [T(PB, 'followRefresh', 'Refresh and the older-code message.'), T(PB, 'boardLeftOpenAcrossRelease', 'A board window is rewritten on new code.')], untested: ['Old and new code saving the same night at once.'],
        simulate: 'desk-sim: world.device().open({ build: "other" }) as the follower.' } }
  ],
  findings: [
    { severity: 'medium', kind: 'bug', title: 'Wall layout cuts off names on nights with 8 or 9 groups', detail: 'With 54 players in 9 groups of 6, 43 names were cut off with an ellipsis on Wall at every screen size tried (800×600 to 1920×1080). With 8 groups, 3 names. Spotlight with groups of 7 or 8 cut off 2. Carousel cut off none. A projector on a big night would show "Dev Malh…".', evidence: [B + ':624', B + ':796'], confirmed: 'measured in a real browser on the local preview: Playwright compared each name\'s full width with its box at 6 screen sizes, 3 layouts, 36 to 54 players (docs/storyboard/repro/measure-board.js).', suggest: 'Wrap long names to two lines or shrink the name font to fit on Wall when there are more than 4 columns; add a Playwright measurement to the test suite for 9 groups.' }
  ]
},
{
  phase: 'finish', title: 'Score Entry, Ratings and Publishing',
  intro: 'Score sheets come back from the tables; the desk enters them, checks the standings, finalizes the night (which changes ratings), and the results publish to the club site and go out by email.',
  steps: [
    { id: 'finish-1-score', title: 'Enter scores from the sheets', who: 'Desk volunteer', when: 'From about 7:30 PM',
      summary: 'For each match, tap the number of games each player won (0 to 3). The winner is marked and the group\'s standings update at once. Forfeits are chosen under each match. The list is in the same order, with the same sides, as the paper.',
      subtext: 'Each score saves within seconds, first to the laptop, then to Google.',
      caveats: ['A match cut short (best of 3 when time runs out) is entered as 2 games to the winner.', 'Check the player on the left of the screen is the player on the top line of the paper.'],
      exceptions: [
        X('A score is entered on the wrong line', 'Tap the right numbers on both lines; the last value wins.', 'Watch the standings change as you enter.', 'handled', 'apps-script/Index.html:2127'),
        X('A player did not play a match', 'Choose **Forfeit** for that player, or for both if the match was never played.', '', 'handled', 'apps-script/Organizer.html:168')],
      screen: { kind: 'desk', highlight: ['scoring'], note: 'The scoring section: games-won balls for each player.' },
      tech: {
        entry: [E(I, 1373, 'data-score', 'Each ball carries the match\'s index in state.matches.'), E(I, 2127, '(click handler)', 'Reads state.matches[Number(dataset.score)].'), E(O, 138, 'matchWinner', 'Winner from games, forfeit or wonBy.'), E(O, 168, 'applyForfeit', 'A player id or both.')],
        state: ['state.matches'], writes: ['autosave'], reads: [],
        invariants: ['A tap changes the match drawn under the finger: every rebuild of state.matches re-renders before the next tap.'],
        limits: [], tests: [T('apps-script/check-forfeit.cjs', '', 'Forfeits.'), T('apps-script/check-best-of-3.cjs', '', 'Short matches.')],
        untested: ['A refresh from another device landing between render and tap (the index addressing).'],
        simulate: 'desk-sim: tab.scoreMatch(index, "one", 1) while a second device adds a late player; assert the score lands on the right pair.' } },
    { id: 'finish-2-finalize', title: 'Finalize the night', who: 'Owner', when: 'After the last match',
      summary: 'Click **Finalize RR Results**. The desk checks every match is complete and that the latest save reached Google, then Google computes every rating change, writes them, and locks the night: **Session finalized. Ratings are now authoritative.** The confirmation also says how many Clover payments are still to match and how many players are marked Credit with no Clover payment; those can be matched after finalizing too.',
      subtext: 'Finalize is the one step that changes ratings. Later nights start from them.',
      caveats: ['Finalize in date order. The desk does not stop you finalizing an earlier night after a later one (see findings).'],
      exceptions: [
        X('The latest changes are not confirmed on Google', '**Finalization requires a confirmed Google Sheets save. Reconnect and save to Sheets first.**', 'Reconnect, wait for "Changes saved to Google Sheets", then finalize.', 'handled', 'apps-script/Index.html:3346'),
        X('Finalize stopped partway (Google timed out)', 'On the next load: **An earlier finalize or reopen of this session did not finish. Check the scores, then click Finalize RR Results: it repairs the earlier attempt, so no rating change counts twice.**', 'Do as it says.', 'handled', 'apps-script/SessionService.js:447'),
        X('An earlier night is finalized after a later one', 'Allowed. Its rating changes are applied on top of the later night\'s ratings.', 'Do not do it; reopen the later night first.', 'gap', 'apps-script/SessionService.js:378')],
      screen: { kind: 'desk', highlight: ['finalize-button'], status: 'Session finalized. Ratings are now authoritative.', note: 'The Finalize RR Results button.' },
      tech: {
        entry: [E(S, 361, 'finalizeSession', 'Under the desk lock.'), E(S, 368, 'finalizeLocked_', 'Revision check, synced-through check, completeness, ledger, ratings.'), E(S, 738, 'validateCompleteRoundRobin_', 'Every pair played or forfeited.'), E(S, 447, 'finalizeLeftovers_', 'Repairs an interrupted finalize.')],
        state: ['Sessions.status'], writes: ['RatingLedger rows', 'Players.current_rating', 'Sessions row (status, revision)', 'record archive events', 'CTTC_PENDING_PUBLISH'], reads: [],
        invariants: ['Each night\'s rating changes start from the ratings left by the previous night in date order.', 'A finalize applies each rating change exactly once, even when retried.'],
        limits: ['Script lock 30 s; Apps Script 6 minute execution limit.'],
        tests: [T('apps-script/check-finalize-session.cjs', '', 'Finalize, retry, interrupted repair.')],
        untested: ['Finalizing a night dated before the latest finalized one.'],
        simulate: 'docs/storyboard/repro/out-of-order-finalize.cjs: with 2026-10-12 finalized, 2026-10-05 still finalizes (ledger 2100→2067...).' } },
    { id: 'finish-3-publish', title: 'Results publish to the club site', who: 'Timer', when: 'About 2 minutes after finalize',
      summary: 'The desk shows a countdown; after about 2 minutes (or at once with **Publish now**) Google starts the GitHub workflow, which reads the finalized night from the Sheet, commits the site\'s data files ("Update session data"), and the results and new ratings appear on the site. The results email follows.',
      subtext: 'The 2-minute hold is the window to catch a mistake and reopen before the world sees it.',
      caveats: ['Reopen during the 2-minute hold if a correction is needed. Once publishing starts, the lock refuses, and once the site lists the night it refuses for good.'],
      exceptions: [
        X('Someone clicks the lock while publishing is running', 'Refused: **This night is being published to the club site right now, so it can no longer be reopened here...** (Before Nov 11, 2026 it was allowed, and every later publication then failed.)', 'Wait for the site to list the night; corrections after publication need a separate fix. If the run failed and the site never lists it, the lock works again 30 minutes after publishing started.', 'handled', 'apps-script/SessionService.js:632'),
        X('The GitHub token is missing or expired', 'The publish panel shows GitHub\'s error.', 'Owner renews the token in Script Properties.', 'partial', 'apps-script/PublishTimer.js:85')],
      screen: { kind: 'desk', highlight: ['publish-panel'], note: 'The publish countdown with Publish now.' },
      tech: {
        entry: [E('apps-script/PublishTimer.js', 7, 'PUBLISH_HOLD_MS', '2 minutes.'), E('apps-script/PublishTimer.js', 98, 'dispatchWorkflow_', 'Starts update-data.yml.'), E('apps-script/PublishTimer.js', 191, 'advancePublish_', 'scheduled → dispatched → done.'), E(S, 620, 'sessionOnSite_', 'Reopen guard: is it on the site yet?'), E(S, 632, 'reopenBlockedByPublish_', 'Reopen guard: is it being published (dispatched in the last 30 minutes, or past the site step)?')],
        state: ['CTTC_PENDING_PUBLISH { state, dispatchedAt }'], writes: ['GitHub: data/*.json commits'], reads: ['site data/sessions.json'],
        invariants: ['A night cannot be reopened from the moment publishing starts.', 'What the site shows equals the finalized rows.'],
        limits: ['Publish check every 3 minutes; GitHub Actions run time.'],
        tests: [T('apps-script/check-publish-timer.cjs', '', 'The hold, Publish now, the timer.'), T('apps-script/check-reopen-session.cjs', '', 'Reopen guards, including each publishing state: refused while dispatched or emailing, allowed in the hold, after a failed run (30 min) and for another night.')],
        untested: [],
        simulate: '`node docs/storyboard/repro/reopen-while-publishing.cjs` prints FIXED: the reopen is refused while dispatched.' } },
    { id: 'finish-4-review', title: 'Look back at a finalized night', who: 'Second device', when: 'After finalize',
      summary: 'Anyone can load the finalized night to check results. The page that finalized shows the right ratings. A fresh page, or another device, shows each player\'s rating column using today\'s rating as the starting point, so the changes shown are wrong.',
      subtext: 'The results saved are correct; only the display on a fresh page is off.',
      caveats: ['Use the club site\'s results page to check rating changes, not the desk.'],
      exceptions: [X('Checking rating changes on a phone after finalize', 'Shows starting rating = the new rating, and a second, smaller change on top.', 'Trust the site.', 'gap', 'apps-script/Organizer.html:197')],
      screen: { kind: 'phone', highlight: ['status-bar'], status: 'Session loaded. Changes are stored in Google Sheets.', note: 'A finalized night on a second device.' },
      tech: {
        entry: [E(O, 188, 'standings', 'startRating from player(id).currentRating, not the session\'s starting rating.')],
        state: [], writes: [], reads: ['getAppState'],
        invariants: ['A finalized night shows the same rating column on every device and after reload.'],
        limits: [], tests: [], untested: ['Standings of a finalized night on a fresh page.'],
        simulate: 'docs/storyboard/repro/finalized-standings.cjs.' } }
  ],
  findings: [
    { severity: 'medium', kind: 'bug', title: 'An earlier night can be finalized after a later one', detail: 'Monday Oct 12 is finalized; Monday Oct 5 was left open. Finalizing Oct 5 now is allowed, and its rating changes are applied on top of the ratings after Oct 12, while the site takes ratings from the latest-dated night.', evidence: [S + ':378'], confirmed: 'reproduced with simulator: latest finalized 2026-10-12, 2026-10-05 finalized; ledger 2100→2067, 2006→2039 (docs/storyboard/repro/out-of-order-finalize.cjs).', suggest: 'Refuse finalizing a date before latestFinalizedSessionDate_ with a message naming the later night.' },
    { severity: 'medium', kind: 'bug', title: 'A finalized night shows wrong rating changes on a fresh page', detail: 'After finalizing, the same tab shows Ana 2100 → 1997 (−103). A reload or another device shows Ana 1997 → 1966 (−31): it uses the new rating as the start and computes again.', evidence: [O + ':197'], confirmed: 'reproduced with simulator (docs/storyboard/repro/finalized-standings.cjs).', suggest: 'Use each player\'s saved starting rating (SessionPlayers) for standings when the session has one.' }
  ]
},
{
  phase: 'save', title: 'Saving, Connection Loss and Recovery',
  intro: 'Underneath everything, every change goes to the laptop first and to Google a moment later. The desk has to survive slow Google, dropped wifi, two devices editing, and a reload at the wrong moment, and say plainly what state it is in.',
  steps: [
    { id: 'save-1-normal', title: 'Every change saves by itself', who: 'Google (server)', when: 'All night',
      summary: 'Each change is kept on the laptop at once and sent to Google a moment later. The status bar reads **Changes saved to Google Sheets at** a time. **Save to Sheets** forces a save now.',
      subtext: 'Google accepts a save only if it is based on the latest version (the revision). That is what stops two devices overwriting each other.',
      caveats: ['The print mark, moved-up marks and payments travel by their own routes, not with the session save.'],
      exceptions: [X('Google is busy with another change', '**The desk is still finishing another change (from this or another device). Wait a few seconds, then try again.**', 'It retries by itself.', 'handled', 'apps-script/SessionService.js:580')],
      screen: { kind: 'desk', highlight: ['status-bar', 'save-button'], status: 'Changes saved to Google Sheets at 7:42 PM.', note: 'The status bar after a save.' },
      tech: {
        entry: [E(I, 687, 'persistDeviceDraft', 'localStorage first.'), E(I, 634, 'canAutoSync', 'When autosave may run.'), E(I, 1635, 'save', 'saveSessionDraft with the revision.'), E(S, 276, 'saveSessionDraft', 'Under withDeskLock_; writes only this session\'s rows.'), E(S, 583, 'withDeskLock_', 'Script lock, 30 s wait.')],
        state: ['state.session.revision', 'saveInFlight', 'unconfirmedSaves'], writes: ['Sessions, SessionPlayers, Matches rows'], reads: [],
        invariants: ['A save based on an older revision is never written over a newer one.', 'The device copy holds every change not yet confirmed by Google.'],
        limits: ['Script lock wait 30 s.'], tests: [T('scripts/check-desk-nights.js', '', 'Whole nights with slow Google, drops, reloads and a second tab.')], untested: [],
        simulate: 'scripts/lib/desk-night.js runs simulated nights; `node scripts/check-desk-nights.js`.' } },
    { id: 'save-2-offline', title: 'The wifi drops', who: 'Desk volunteer', when: 'Any time',
      summary: 'The desk keeps working on the laptop: **Draft saved on this device only. It will sync to Google Sheets automatically when the connection returns.** Slow replies say **Google Sheets is slow to answer; still saving. Your changes are kept on this device, so keep entering scores.**',
      subtext: 'The projector and other devices see nothing new until the main desk reconnects.',
      caveats: ['Do not close the tab while it says device only.', 'Finalize needs a confirmed save.'],
      exceptions: [X('A save was sent but no answer came back', '**Checking Google Sheets before saving again...** then it either confirms or merges.', 'Keep going.', 'handled', 'apps-script/Index.html:1745')],
      screen: { kind: 'desk', highlight: ['status-bar'], status: 'Draft saved on this device only. It will sync to Google Sheets automatically when the connection returns.', note: 'Offline status.' },
      tech: {
        entry: [E(I, 1723, 'withSaveTimeout', 'Slow-reply message.'), E(I, 1745, 'reconcile', 'Asks Google what it holds before sending again.'), E(I, 1738, 'contentKey', 'Compares groups and matches ignoring order.'), E(I, 324, 'AUTO_RETRY_LIMIT', 'Autosave retries before stopping.'), E(I, 275, 'cttcOutbox', 'Print mark, moves and similar small writes, retried across reloads.')],
        state: ['unconfirmedSaves', 'syncFailures'], writes: [], reads: ['getAppState'],
        invariants: ['A save that may have arrived is never sent again blindly.'],
        limits: [], tests: [T('apps-script/check-offline-draft.cjs', '', 'Offline drafts.'), T('apps-script/check-offline-actions.cjs', '', 'Offline adds and outbox.')], untested: [],
        simulate: 'desk-sim network controls (see scripts/lib/desk-sim.js).' } },
    { id: 'save-3-two', title: 'Two devices change the same night', who: 'Second device', when: 'Any time',
      summary: 'If another device saved first, the desk combines the two where it safely can: **Another tab or device saved changes to this session. Combining them with yours; check the scores, then try again in a moment.** If it cannot, it keeps both: **Google Sheets has a different version of this session. Nothing was overwritten; your edits are kept on this device. Reload to review it.**',
      subtext: 'Desks also refresh about once a minute when quiet, so a second device normally shows the other\'s changes before it edits.',
      caveats: ['Keep one device for sign-ins and one for scores where possible.'],
      exceptions: [X('Finalized elsewhere while this page had edits', '**This session was finalized in Google Sheets (on another device or tab) before these edits were saved. Nothing was overwritten...**', 'Reload and check; reopen only if the edits matter and the site does not list the night yet.', 'handled', 'apps-script/Index.html')],
      screen: { kind: 'devices', highlight: ['main-desk', 'phone', 'google'], note: 'Two desks saving to the same night.' },
      tech: {
        entry: [E(I, 2440, 'quietForRefresh', 'The once-a-minute refresh.'), E(I, 869, 'applyCopy', 'Applies Google\'s version.')],
        state: ['syncConflict', 'saveNeedsReload'], writes: [], reads: ['getAppState'],
        invariants: ['No device\'s confirmed change is silently reverted by another\'s save.'],
        limits: ['Refresh about once a minute.'], tests: [T('scripts/check-desk-nights.js', '', 'Second tab scenarios.')], untested: ['The print mark changed on one device while the other has unsaved group changes.'],
        simulate: 'desk-sim: two devices, both add players within the same minute.' } }
  ],
  findings: [
    { severity: 'low', kind: 'design-gap', title: 'The printed play order is saved only with the print mark', detail: 'Matches are saved without an order; the printed order lives in the print mark (a document property kept 21 days). Undo the print, or a lost mark, puts every group back to the plain order. Reasonable, but nothing records which order the paper had if the mark is lost.', evidence: [S + ':235', S + ':188', I + ':1738'], confirmed: 'read code only', suggest: 'Accept, or save the match order with the matches once printed.' }
  ]
},
{
  phase: 'ops', title: 'Scheduled Jobs, Google Limits and Updates',
  intro: 'Things nobody at the desk sees until they break: the timers that read texts, sync ratings and publish; the club account\'s shared Google limits; and how new code reaches each open device.',
  steps: [
    { id: 'ops-1-timers', title: 'Timers work in the background', who: 'Timer', when: 'All day',
      summary: 'Google timers read Voice texts (every 5 minutes by day, 30 at night), sync ratings from the site (hourly), and publish finalized nights. All run as the club account and share its daily Google limits with the coaching, staffing and turnout apps.',
      subtext: 'A timer that stops shows nothing on the desk until its effect is missed: no new texts, stale ratings, results not on the site.',
      caveats: ['docs/google-limits.md is the map of what each job spends; update it with any new timer.'],
      exceptions: [X('A timer has been removed or failed', 'Nothing visible on the desk.', 'The owner checks triggers in the Apps Script editor; ratingSyncStatus and checkPublishSetup report.', 'partial', 'apps-script/RatingSync.js:45')],
      screen: { kind: 'devices', highlight: ['google', 'site', 'github'], note: 'Google, the site and GitHub working without the desk.' },
      tech: {
        entry: [E('apps-script/MailReader.js', 115, 'mailCadence_', 'Day, busy and night cadence.'), E('apps-script/RatingSync.js', 16, 'syncRatingsFromPublicSite', 'Hourly and on each desk load.'), E('apps-script/PublishTimer.js', 233, 'publishDue_', 'Publishing timer.')],
        state: ['Script properties: CTTC_MAIL_TIMER, CTTC_RATINGS_SYNCED_THROUGH, CTTC_PENDING_PUBLISH'], writes: [], reads: [],
        invariants: ['Every timer wakes only when work is due (AGENTS.md).'], limits: ['Shared club-account daily limits: Gmail reads, email sends, UrlFetch, run time.'],
        tests: [T('apps-script/check-mail-reader.cjs', '', 'Cadence.'), T('apps-script/check-publish-timer.cjs', '', 'Publishing.')], untested: ['That the triggers are actually installed on Google.'],
        simulate: '`python3 -I .claude/google-api.py` can read deployments and logs read-only.' } },
    { id: 'ops-2-release', title: 'Releasing new code', who: 'Owner', when: 'Between nights, ideally',
      summary: 'Code is reviewed in a pull request, pushed to /dev and checked, then a numbered version is made and the live /exec deployment is pointed at it. Every open desk keeps the code it loaded until it is reloaded.',
      subtext: 'A merge on GitHub deploys nothing to Google. A release reaches a device only when that device reloads.',
      caveats: ['After a release, reload every open desk, and on the projector click Player board again.', 'clasp can skip a push silently when the manifest changes: clone back and compare.'],
      exceptions: [X('Released while a night is running', 'Devices run mixed versions until reloaded.', 'Release between nights. If it cannot wait, reload every device at once.', 'partial', 'apps-script/Code.js:174')],
      screen: { kind: 'devices', highlight: ['github', 'google', 'main-desk', 'projector'], note: 'Code goes GitHub → Google; each device picks it up on reload.' },
      tech: {
        entry: [E('apps-script/Code.js', 174, 'deskBuild_', 'Fingerprint used to spot old pages.'), E('.github/skills/cttc-dev-preview/SKILL.md', 1, '', 'The release procedure.')],
        state: [], writes: ['Apps Script versions and the /exec deployment'], reads: [],
        invariants: ['/exec only runs merged code.', 'Google HEAD equals main after a release.'],
        limits: [], tests: [], untested: ['Old and new code on different devices during one night.'],
        simulate: 'Clone Google HEAD with clasp into a scratch folder and compare with main (see the skill).' } },
    { id: 'ops-3-precheck', title: 'The check before a night', who: 'Owner', when: 'Before doors open',
      summary: 'What an automated check can do today: run `npm test`, open the real live desk read-only (`npm run desk:google`), confirm /exec matches main, and drive the local preview in a real browser. What it cannot do: click on the real desk, print, or see the real projector.',
      subtext: 'Monday\'s check did the first three and missed all three problems, because each needed a night walked through with a printed sheet, a removal, and the board full screen.',
      caveats: ['A green test suite proves only what a test asserts. Each "Must stay true" line in this storyboard should become one.', 'The procedure, for agents and developers: .github/skills/cttc-storyboard/SKILL.md (before a night, and with every change to how a night works).'],
      exceptions: [],
      screen: { kind: 'devices', highlight: ['main-desk', 'projector'], note: 'What the check can see and what it cannot.' },
      tech: {
        entry: [E('scripts/desk-google-view.js', 1, '', 'Looks at the real desk; never clicks or saves.'), E('scripts/desk-preview.js', 1, '', 'The desk with a made-up back end, for real-browser checks.'), E('scripts/lib/desk-sim.js', 1, '', 'Whole nights in milliseconds, jsdom (no layout).')],
        state: [], writes: [], reads: [],
        invariants: ['Before a night: every must-stay-true line has a passing check, or is listed as not covered.'],
        limits: ['jsdom has no layout: clipping, overlap and full screen need Playwright.'],
        tests: [], untested: ['A rehearsal that walks a whole night (sign-ins, print, remove, late add, scores, follow, full screen) and fails on any of these invariants.'],
        simulate: 'Proposed: a new rehearsal script under scripts/ combining desk-sim (logic) and the preview + Playwright (screens).' } }
  ],
  findings: [
    { severity: 'medium', kind: 'design-gap', title: 'No rehearsal of a whole night, and nothing checks what is on screen', detail: 'Tests are many and detailed but each checks one rule; none walks a night end to end, and none can see layout (jsdom). Monday\'s three problems and two of today\'s findings (group renumbering, names cut off) are exactly what such a rehearsal would catch.', evidence: ['package.json', 'scripts/lib/desk-sim.js'], confirmed: 'read code only', suggest: 'Build a rehearsal script from this storyboard\'s invariants and run it before each night and in CI.' }
  ]
}
];

const meta = {
  commit: '968f14045b8deb9076c5b517cdb47c5902126a8d',
  intro: 'A round robin night at the club, from opening the desk to results on the site: what each person does, what the screen shows, what can go wrong at each step, and the code underneath.',
  source: 'Read from the repository at commit `{commit}`: the desk in apps-script/, its tests and simulator, and docs/round-robin-operations.md. Findings marked "reproduced" were run in the repository simulator (scripts/lib/desk-sim.js) or measured in a real browser on the local preview; the scripts that reproduce them are in docs/storyboard/repro/. Every repository file reference opens that line on GitHub.',
  findingsNote: 'Items noticed while walking a night through the code, most important first, each with how it was confirmed. None stops the club from running; each is a candidate for a future improvement.'
};
module.exports = { meta, phases };
