// The storyboard's content, part 1: outside the desk (volunteers, texting ahead and the Tonight page, coaching)
// and the map of how the club's apps connect. Built by scripts/build-storyboard.js.
// Evidence is file:line at main 795ebbd (Nov 11, 2026). Made-up names only.
'use strict';
const E = (file, line, symbol, note) => ({ file, line, symbol, note });
const X = (when, happens, handling, status, evidence) => ({ when, happens, handling, status, evidence });
const T = (file, c, covers) => ({ file, case: c, covers });
const SA = 'staffing-app/Code.js', CA = 'coaching-app/Code.js', SF = 'docs/staffing-flow.md', CF = 'docs/coaching-flow.md', TF = 'docs/turnout-flow.md', OPS = 'docs/round-robin-operations.md';

const phases = [
{
  phase: 'staff', short: 'Volunteers', title: 'Volunteer Scheduling for Opening and Closing',
  intro: 'The club only opens if volunteers do: a desk organizer with the key, a money collector, table setup, and at the end a lock-up and people to put tables away. The volunteer app on the website lets players pick those shifts weeks ahead, confirms them by email, and the desk shows tonight\'s crew when they arrive.',
  steps: [
    { id: 'staff-1-pick', title: 'A player picks nights to open or close', who: 'Player', when: 'Days or weeks ahead',
      summary: 'From **Volunteer signups** on the home page, a player finds their name, picks nights on a three-month calendar and a position for each: **Desk organizer**, **Money collector (Front Desk)**, **Table/barrier setup**, **Lock-up**, or **Put tables and barriers away**. The pick holds the spot at once and shows as "waiting to confirm".',
      subtext: 'Only names from the desk\'s player list can sign up, and nobody can sign up as someone else: a pick counts only after a YES from that player\'s email on file.',
      caveats: ['One opening position and one closing spot per person per night; the desk organizer may also help with setup.', 'Desk organizer, Money collector and Lock-up need training, recorded on the desk\'s Volunteer Admin page. Untrained players see them greyed out.', 'Tonight can be picked until an hour before opening.'],
      exceptions: [
        X('The player has no email on file', 'They ask the club to approve an address once; the club gets an *Approve an email* message.', 'Approve it from the email. After 7 days it is declined.', 'handled', SF + ':342'),
        X('Two people pick the last spot at once', 'The server checks capacity; a submission is all or nothing, and the page marks the pick that failed and why.', 'Pick another night or position.', 'handled', SF + ':246')],
      screen: { kind: 'calendar', highlight: ['night'], note: 'The volunteer calendar: each night marked Needs people, Minimum crew, Fully staffed or Closed.' },
      tech: {
        entry: [E(SA, 96, 'POSITIONS', 'Each position, its capacity, opening or closing, and what counts as full.'), E(SA, 911, 'canTake_', 'Directory, training and sign-up mode.'), E(SA, 1364, '(submit)', 'Validates every pick; all or nothing.'), E(SA, 201, 'doPost', 'The website calls the app with fetch, no cookies.')],
        state: ['Signups rows: date, position, player_id, status (pending, confirmed, released, expired, dropped)'], writes: ['Staffing Sheet: Signups, Batches'], reads: ['Desk Sheet: Players (by DESK_SHEET_ID, cached 10 minutes)'],
        invariants: ['A sign-up is confirmed only by a reply from the player\'s email on file.', 'No night ever has two people in a one-person position.'],
        limits: ['At most 40 picks per submission, 3 submissions waiting per email address.'],
        tests: [T('staffing-app/check-staffing.cjs', '', 'Sign-up rules, replies, free spots, closures, both sign-up modes.')], untested: [],
        simulate: 'staffing-app/check-staffing.cjs loads Code.js with stubbed Google services; add a case there.' } },
    { id: 'staff-2-confirm', title: 'The volunteer confirms by email', who: 'Player', when: 'Within 24 hours',
      summary: 'One email lists every pick: *Please confirm your CTTC volunteer nights*. Replying **YES** confirms them all; **YES except Nov 4** leaves that night out; the **My nights** link lets them untick nights instead. Confirmed volunteers get a reminder the day before.',
      subtext: 'A hold expires 24 hours after picking, or 1 hour before the night, whichever is first; the spot opens again at once.',
      caveats: ['Replies are read when the desk\'s mail reader wakes the volunteer app, within about 5 minutes by day.', 'A volunteer whose mobile is on file and who texted STAFF also gets the question by text (reply CONFIRM or RELEASE).'],
      exceptions: [
        X('The reply can\'t be read ("yes except when it rains")', 'Nothing changes; the volunteer is told once, with their nights and My nights link.', 'They use My nights, or the club uses **Correct a volunteer\'s answer** on the setup page.', 'handled', SF + ':237'),
        X('The mail reader stops waking the app', 'Replies wait for the hourly sweep; the desk log records `app_wake_failed`.', 'Nothing urgent; confirmations arrive within the hour.', 'partial', OPS + ':423')],
      screen: { kind: 'email', status: 'Please confirm your CTTC volunteer nights', note: 'The confirm email listing each pick.' },
      tech: {
        entry: [E(SA, 3795, 'sweep', 'Hourly: expiries, retries, free spots, closures.'), E('apps-script/MailReader.js', 433, 'wakeApps_', 'Calls the staffing and coaching apps\' /exec when a text or a reply arrives.')],
        state: ['Signups.status', 'Batches.expires_at'], writes: ['Signups status changes', 'emails (MailApp)'], reads: ['Gmail replies tagged [CTTC shift …]', 'VoiceTexts (desk Sheet)'],
        invariants: ['Only a reply from the address the question went to, quoting the shift code, changes anything.', 'A reply naming dates never counts as a plain YES or NO.'],
        limits: ['Emails count against the club account\'s daily send quota, shared by every app.'], tests: [T('staffing-app/check-staffing.cjs', '', 'Reply parsing, YES except, late YES.')], untested: [],
        simulate: 'check-staffing.cjs fixtures.' } },
    { id: 'staff-3-status', title: 'The calendar shows which nights still need people', who: 'Club site', when: 'All week',
      summary: 'Each night is marked **Needs people** (!), **Minimum crew** (+), **Fully staffed** (✓) or **Closed** (×), counted from confirmed sign-ups only. **Share to WhatsApp** on a night types a message for the club group saying what is still needed.',
      subtext: 'A night marked Needs people the day before is the club\'s real risk: no one with the key, or no one to lock up.',
      caveats: ['Closed nights come from data/closures.json on the site; the app re-reads it at most hourly and keeps the last good copy.'],
      exceptions: [
        X('A night becomes closed after people confirmed', 'The hourly sweep cancels their shifts, emails each person once, and sends the club one summary.', 'Nothing to do.', 'handled', SF + ':461'),
        X('Nobody signs up for lock-up or the desk', 'The night stays at Needs people; the owner\'s daily summary lists it.', 'Share to WhatsApp, or ask someone trained directly.', 'partial', SF + ':331')],
      screen: { kind: 'calendar', highlight: ['legend', 'night'], note: 'Night markers: ! needs people, + minimum crew, ✓ fully staffed, × closed.' },
      tech: {
        entry: [E(SA, 635, 'closures_', 'Reads closures.json hourly, keeps the last good copy.'), E(SA, 96, 'POSITIONS', '`full` counts for Fully staffed.')],
        state: [], writes: [], reads: ['site data/closures.json'],
        invariants: ['A night\'s status counts only confirmed sign-ups.', 'A closed night asks for nobody and sends no reminders.'],
        limits: [], tests: [T('scripts/check-closures.js', '', 'Closures read by the site and the app.')], untested: [], simulate: 'check-staffing.cjs.' } },
    { id: 'staff-4-free', title: 'Friday and Saturday: early volunteers play free', who: 'Player', when: 'Nov 13 – Dec 31, 2026',
      summary: 'On the special nights everyone pays **$5**, and the first 2 people to sign up to open and the first 2 to close play free, in sign-up order. Their emails say *You play free*; the calendar shows a ★ on nights with a free spot left.',
      subtext: 'The volunteer app and the desk each work out who plays free with the same rule, copied word for word (`freeSpots_`), from the same Signups rows and the desk\'s Zeffy pass list.',
      caveats: ['Zeffy pass holders already play free, so they never take a free spot.', 'A pick waiting for its YES holds its place but is free only once confirmed.', 'The special\'s dates are typed in three places (see findings).'],
      exceptions: [X('Someone ahead drops or never confirms', 'The next person moves up; the hourly sweep emails them *Good news: you play free*.', 'Nothing to do.', 'handled', SA + ':1102')],
      screen: { kind: 'calendar', highlight: ['free'], note: 'A ★ on special nights with a free spot left.' },
      tech: {
        entry: [E(SA, 85, 'PERK_NIGHTS', 'The special\'s dates and fee in the volunteer app.'), E('apps-script/NightFees.js', 21, 'SPECIAL_NIGHTS', 'The same dates in the desk.'), E('index.html', 72, 'data-until', 'The same end date on the home page.'), E(SA, 1010, 'freeSpots_', 'Who plays free.'), E('apps-script/Volunteers.js', 46, 'freeSpots_', 'The desk\'s copy.')],
        state: ['Signups.free_night'], writes: ['FreeNightPasses tab (desk, hourly)'], reads: ['FreeNightPasses (volunteer app, cached 10 minutes)'],
        invariants: ['The desk and the volunteer app agree on who plays free each night.', 'The special\'s dates are the same in the volunteer app, the desk and the home page.'],
        limits: [], tests: [T('staffing-app/check-staffing.cjs', '', 'freeSpots_ is the same in both apps.'), T('apps-script/check-free-night-passes.cjs', '', 'Pass holders passed over.')],
        untested: ['PERK_NIGHTS, SPECIAL_NIGHTS and the home page\'s data-until agreeing.'], simulate: 'A check that loads both files and compares the arrays.' } },
    { id: 'staff-5-desk', title: 'At the desk: tonight\'s volunteers', who: 'Desk volunteer', when: 'On arrival',
      summary: 'Under **Tonight\'s volunteers** the desk lists everyone signed up to open or close tonight, with their roles. Each has **RR** and **Open** buttons, because volunteers are busy setting up and often forget to sign in. Free volunteers carry a gold **★** and their payment button reads **★ FREE**.',
      subtext: 'The desk only reads the volunteer app\'s Sheet. A volunteer is at the gym, not necessarily playing: they count on the Tonight page only once added to RR.',
      caveats: ['The section needs the owner-set script property `CTTC_STAFFING_DB_ID`; without it, it says it is not connected.'],
      exceptions: [X('A volunteer\'s name is not an active directory player', 'The row says so.', 'Find them under Show archived players, or add them under Add a player.', 'handled', OPS + ':483')],
      screen: { kind: 'desk', highlight: ['volunteers'], note: 'Tonight\'s volunteers with RR and Open beside each name.' },
      tech: {
        entry: [E('apps-script/Volunteers.js', 142, 'listVolunteers', 'Reads Signups for the date by header name; never emails or phones.'), E('apps-script/Volunteers.js', 17, 'staffingSignups_', 'Opens the staffing Sheet by CTTC_STAFFING_DB_ID.')],
        state: [], writes: ['None (read-only).'], reads: ['Staffing Sheet: Signups'],
        invariants: ['The desk never writes to the volunteer app\'s Sheet.'], limits: [],
        tests: [T('apps-script/check-volunteers.cjs', '', 'The desk\'s volunteer list and free spots.'), T('scripts/check-volunteer-signups.js', '', 'Sign-ups shown on the site.')], untested: [], simulate: 'check-volunteers.cjs.' } },
    { id: 'staff-6-admin', title: 'The club trains volunteers and fixes the schedule', who: 'Owner', when: 'As needed',
      summary: 'The **Volunteer Admin** page (club account only) shows the season by night and position, records who is trained for the desk, front desk and keys, and lets the club add someone to an open spot or correct an answer, each with a review step before saving.',
      subtext: 'This is the desk\'s page talking to the volunteer app with the desk\'s admin key: no one edits the volunteer Sheet by hand.',
      caveats: ['Some older steps in docs/staffing-flow.md still describe editing the Emails and Closures tabs: treat them as forms still to build.'],
      exceptions: [], screen: { kind: 'calendar', highlight: ['night'], note: 'Volunteer Admin: nights by position.' },
      tech: {
        entry: [E('apps-script/VolunteerAdmin.js', 21, '(admin key)', 'A long random value in the desk\'s hidden AppWake tab.'), E(SA, 4355, 'adminApply_', 'Applies a reviewed change.')],
        state: [], writes: ['Staffing Sheet via the app'], reads: [],
        invariants: ['Every change made here is reviewed and logged.'], limits: [],
        tests: [T('apps-script/check-volunteer-admin.cjs', '', 'The admin page.'), T('scripts/check-volunteer-admin-page.js', '', 'The site page.')], untested: [], simulate: 'check-volunteer-admin.cjs.' } }
  ],
  findings: [
    { severity: 'medium', kind: 'fragile', title: 'The Friday/Saturday special\'s dates are typed in three places, and no test compares them', detail: 'The dates live in the volunteer app (PERK_NIGHTS), the desk (SPECIAL_NIGHTS) and the home page (data-until). Today they agree. Extend the special into January in the desk only, and volunteers would be told they pay $5 and play free while the desk charges a different fee, or the reverse.', evidence: [SA + ':85', 'apps-script/NightFees.js:21', 'index.html:72', 'firstvisit.html:53'], confirmed: 'read code only; checked the three values agree today and that no check compares them.', suggest: 'Add a check in npm test that loads PERK_NIGHTS and SPECIAL_NIGHTS and the data-until dates and asserts they match.' }
  ]
},
{
  phase: 'text', short: 'Advance texts', title: 'Advance Texts and the Tonight Page',
  intro: 'On a round robin day players text the club\'s Google Voice number to say they are coming. One mail reader in the desk collects every text; the desk links each to a player and can answer automatically; the public Tonight page shows how many are coming at each rating level; the volunteer and coaching apps read the same texts for their own commands.',
  steps: [
    { id: 'text-1-send', title: 'A player texts "I\'ll join CTTC\'s RR today"', who: 'Player', when: 'Round robin day, from morning',
      summary: 'From the Tonight page, the home page box or the **Text CTTC** icon, a tap opens Messages with *I\'ll join CTTC\'s RR today* filled in, addressed to the club\'s number. Google Voice forwards the text to the club Gmail.',
      subtext: 'Only texts sent on the round robin day itself count, and only ones that say the person is coming.',
      caveats: ['Words like COACH, STUDENT, STAFF, CONFIRM, RELEASE, YES, NO and STOP are commands for the other apps and are never counted as a sign-up.'],
      exceptions: [X('The text only asks a question ("Is RR on tonight?")', 'Not counted and not answered automatically; it shows in Voice signups with a ?.', 'Answer it from Google Voice.', 'handled', 'apps-script/VoiceSuggestions.js:15')],
      screen: { kind: 'sms', highlight: ['bubble'], note: 'The pre-filled text to the club number.' },
      tech: {
        entry: [E('text.html', 1, '', 'The Text CTTC home screen icon.'), E('apps-script/VoiceSuggestions.js', 15, 'VOICE_JOINING_', 'What counts as "coming".'), E('apps-script/VoiceSuggestions.js', 18, 'VOICE_COMMAND_', 'Commands for other apps.')],
        state: [], writes: [], reads: [], invariants: ['A command for another app is never counted as joining.'], limits: [],
        tests: [T('apps-script/check-voice-service.cjs', '', 'Joining, not coming, commands.')], untested: [], simulate: 'check-voice-service.cjs fixtures.' } },
    { id: 'text-2-read', title: 'The mail reader collects the text', who: 'Timer', when: 'Within a minute near sign-up',
      summary: 'One job in the desk reads new mail and saves forwarded texts to the private **VoiceTexts** tab. It runs every minute in the 4 hours before sign-up closes, every 5 minutes otherwise, every 30 at night. Every other app reads texts from that tab, never from Gmail.',
      subtext: 'Before October 2026 each app searched Gmail on its own every minute and the club ran out of its daily Gmail allowance on round robin nights. One reader fixed that; it is now a single point everything depends on.',
      caveats: ['If the reader has not read in 45 minutes, the coaching and staffing checks fail and the Tonight page log notes texts_not_collected.'],
      exceptions: [
        X('Gmail calls run high', 'Past 6,000 calls in a day it slows to every 5 minutes and logs `gmail_reads_high`.', 'Nothing at the desk; Refresh on Voice signups still reads at once.', 'handled', 'apps-script/MailReader.js:54'),
        X('The reader\'s timer is missing', 'The desk puts it back (checked every 6 hours) and reads itself when the job has not read in the last minute.', 'Keep the desk open on sign-up nights.', 'handled', 'apps-script/MailReader.js:160')],
      screen: { kind: 'devices', highlight: ['google'], note: 'Google Voice → club Gmail → the desk\'s mail reader → VoiceTexts.' },
      tech: {
        entry: [E('apps-script/MailReader.js', 66, 'mailJob_', 'One read, then wakes the apps.'), E('apps-script/MailReader.js', 115, 'mailCadence_', 'Every minute, 5 minutes or 30 minutes.'), E('apps-script/MailReader.js', 296, 'recordMail_', 'Writes VoiceTexts rows.')],
        state: ['MailReader tab: read_at, cursor, gmail_calls'], writes: ['VoiceTexts (kept 90 days)', 'ZeffyPayments'], reads: ['Gmail, mail since the cursor'],
        invariants: ['Each text is recorded once.', 'No app other than the desk searches Gmail for texts.'],
        limits: ['Gmail: about 20,000 reads a day shared by every club app; timer run time about 90 minutes a day shared.'],
        tests: [T('apps-script/check-mail-reader.cjs', '', 'Cadence, cursor, recording.')], untested: [], simulate: 'check-mail-reader.cjs.' } },
    { id: 'text-3-answer', title: 'The desk answers the text automatically', who: 'Google (server)', when: 'Within a minute or five',
      summary: 'When automatic answers are on, a text whose Voice contact name is exactly one player gets **Received - you\'re on the list, Ana Reyes! See you tonight.** Anyone else gets **We\'re glad to have you! This number isn\'t linked to anyone in our club directory yet. Reply with your name and we\'ll add you.**',
      subtext: 'One automatic answer per person per day, only until sign-up closes (7:15 PM, or 3:15 PM on Saturday), and never on a closed day.',
      caveats: ['Off until the owner turns it on (`enableVoiceAutoReply`), because the mail job runs whatever code was pushed last, including a /dev preview.', 'Someone with a coaching lesson that day is left for a person.'],
      exceptions: [X('The texter\'s contact name matches two players, or none', 'They get the "isn\'t linked" answer.', 'Link the name with the pencil\'s **Other names** in the directory (not by editing the Sheet), or set their Voice contact name.', 'handled', 'apps-script/VoiceAutoReply.js:20')],
      screen: { kind: 'sms', highlight: ['reply'], note: 'The automatic answer in the player\'s Messages.' },
      tech: {
        entry: [E('apps-script/VoiceAutoReply.js', 55, 'answerVoiceSignups_', 'Runs after each read that brought a new text.'), E('apps-script/VoiceAutoReply.js', 24, 'VOICE_REPLY_DAYS', 'Days and times answers run.'), E('apps-script/VoiceAutoReply.js', 116, 'voiceClubClosed_', 'Reads closures.json.')],
        state: ['CTTC_VOICE_AUTO_REPLIED (who was answered today)'], writes: ['A Gmail reply in the Voice thread', 'desk log voice_auto_reply'], reads: ['VoiceTexts', 'Players, Aliases'],
        invariants: ['At most one automatic answer per person per day.', 'No answer after sign-up closes or on a closed day.'],
        limits: ['At most 20 answers per run.'], tests: [T('apps-script/check-voice-auto-reply.cjs', '', 'Who is answered and with what.')], untested: [], simulate: 'check-voice-auto-reply.cjs.' } },
    { id: 'text-4-tonight', title: 'The Tonight page shows who is coming, by rating', who: 'Club site', when: 'All day, updated each minute',
      summary: 'The public **Tonight** page draws the gym floor with one court per rating zone (under 600 up to 1600+). Solid figures are players signed in at the desk or who texted today; ghost figures are regulars likely to come; chalk spots fill out the expected total from the usual turnout for that weekday.',
      subtext: 'It shows counts only, never a name. Players use it to decide whether to come; the desk can use it to expect how many groups.',
      caveats: ['Someone whose text could not be matched shows at the front desk ("New faces") and, after signing in, is counted twice until the next day.', 'After sign-up closes (7:15 PM, 3:15 PM Saturday) the forecast drops and only players are shown.'],
      exceptions: [
        X('The turnout app cannot be reached', '**Live sign-ins are not showing right now**, with the forecast from the site\'s own files.', 'Nothing at the desk is affected.', 'handled', TF + ':195'),
        X('A texter shows at the front desk instead of their zone', 'Their Voice contact name does not match one player.', 'Link the name with the directory pencil\'s **Other names**. (The guide still says to add an Aliases row in the Sheet: see findings.)', 'partial', TF + ':200')],
      screen: { kind: 'tonight', note: 'The gym floor: one court per rating zone, solid, ghost and chalk figures.' },
      tech: {
        entry: [E('tonight.html', 114, 'TURNOUT_URL', 'Asks the turnout app every 60 s.'), E('turnout-app/Code.js', 46, 'turnout', 'Counts by zone, cached 60 s; no names.'), E('turnout.js', 97, 'likelihood', 'Weighted attendance over the last 8 same-weekday nights.'), E('turnout.js', 126, 'expectedTotal', 'The usual turnout for the weekday.'), E('turnout.js', 30, 'NIGHTS', 'Which days and times count.')],
        state: [], writes: ['Turnout log'], reads: ['Desk Sheet: Sessions, SessionPlayers, VoiceTexts, Players, Aliases', 'site data/session-roster.json'],
        invariants: ['The page never shows a name, number, player id or text.', 'Each person counts once, at their firmest status: signed in, then texted, then likely.'],
        limits: ['60 s cache on Google; the page asks every minute.'],
        tests: [T('scripts/check-turnout.js', '', 'Plays out a night: counts move from forecast to playing.'), T('turnout-app/check-turnout-app.cjs', '', 'Privacy and the answer\'s shape.')],
        untested: ['NIGHTS in turnout.js, VOICE_REPLY_DAYS and the desk\'s POLL_DAYS agreeing.'], simulate: '`npm run turnout:backtest` checks the forecast.' } },
    { id: 'text-5-desk', title: 'At the desk: Voice signups', who: 'Desk volunteer', when: 'From 6:45 PM',
      summary: 'The desk lists every text received today, grouped by sender, with likely directory matches. **✓** means the text says they are coming and the contact name is exactly one player; **?** means look first. **Add all ✓** signs in every ✓ sender not already placed; each sender also has **RR**.',
      subtext: 'From 6:45 to 7:30 PM (2:45 to 3:30 PM Saturday) the list refreshes itself every minute and highlights anyone new.',
      caveats: ['Texts from coaches and students with a lesson today are left out; they are under Open Play / Coaching.', 'Signing someone in sends them **Confirmed.** unless the automatic answer already went.'],
      exceptions: [X('The same person texts and also signs in at the desk', 'They are placed once; the RR button gives way to In RR.', 'Nothing to do.', 'handled', OPS + ':456')],
      screen: { kind: 'desk', highlight: ['voice'], note: 'Voice signups with ✓ and ? marks and Add all ✓.' },
      tech: {
        entry: [E('apps-script/VoiceSuggestions.js', 109, 'voiceSenders_', 'Texts for the date, by sender.'), E('apps-script/VoiceSuggestions.js', 129, 'voiceMatcher_', 'Contact name to player, through Aliases and name links.'), E('apps-script/Index.html', 4213, 'POLL_DAYS', 'When the list refreshes by itself.')],
        state: [], writes: ['Confirmed. reply'], reads: ['VoiceTexts'],
        invariants: ['Add all never adds a ? sender.'], limits: [],
        tests: [T('apps-script/check-voice-service.cjs', '', 'Matching and marks.')], untested: [], simulate: 'check-voice-service.cjs.' } }
  ],
  findings: [
    { severity: 'low', kind: 'doc-mismatch', title: 'Two guides tell people to add an Aliases row in the Sheet', detail: 'The Tonight page guide ("Add an Aliases row in the desk Sheet") and the automatic answers section ("or add an Aliases row") send people to edit the Sheet by hand, against the club\'s rule. A desk control already does this: the pencil beside a name in the directory, **Other names**, with Review and Confirm.', evidence: [TF + ':200', OPS + ':528', 'apps-script/PlayerEdits.js:61'], confirmed: 'read docs and code', suggest: 'Change both lines to point to the directory pencil\'s Other names.' },
    { severity: 'low', kind: 'fragile', title: 'The round robin schedule is copied in three places', detail: 'NIGHTS in turnout.js, VOICE_REPLY_DAYS in the desk\'s automatic answers and POLL_DAYS in the desk page each hold the days and sign-up times. The guide says to change all three together; nothing checks it. A new Friday round robin added to one would leave texts unanswered or the Tonight page on the wrong night.', evidence: ['turnout.js:30', 'apps-script/VoiceAutoReply.js:24', 'apps-script/Index.html:4213'], confirmed: 'read code only', suggest: 'One shared schedule file, or a check comparing the three.' }
  ]
},
{
  phase: 'coach', short: 'Coaching', title: 'Friday and Saturday Coaching Lessons',
  intro: 'Coaches offer lesson times on Friday evenings and Saturday afternoons; students book them on the website. A confirmed lesson means a player at a table with a coach during a club night: they come through the same door, pay the same desk, and need a table kept free.',
  steps: [
    { id: 'coach-1-offer', title: 'A coach offers times', who: 'Owner', when: 'Up to 28 days ahead',
      summary: 'A club coach picks times on the coaching page (Fridays 7–10 PM, Saturdays 3–6 PM, 30 or 60 minutes, on table 1 to 3) and confirms them by replying YES to *Confirm your coaching times*. Only then are the times published on the booking board.',
      subtext: 'Which coaches can offer is set by the club site\'s coaching page (USATT certified); the desk copies that list to its Sheet every hour for the coaching app to read.',
      caveats: ['A coach list not confirmed in 48 hours lapses; a late YES is answered and the list offered again if the times are still free.'],
      exceptions: [X('A coach is not shown on the coaching page', 'The hourly sweep disables them and hides their times.', 'Add or remove a coach in CLUB_COACHES and coaching.html, not in the Sheet.', 'handled', CF + ':389')],
      screen: { kind: 'booking', highlight: ['slot'], note: 'The booking board: Friday and Saturday times by coach and table.' },
      tech: {
        entry: [E(CA, 88, 'CLUB_COACHES', 'The club\'s coaches.'), E(CA, 1791, 'syncClubCoaches_', 'Matches the CoachList tab the desk writes.'), E('apps-script/CoachList.js', 14, 'publishCoachList_', 'Hourly copy of the shown coaches.'), E(CA, 113, 'Availability', 'avail_id, coach_id, date, start, minutes, confirmed, table.')],
        state: ['Coaches.ask_slots, ask_made', 'Availability rows'], writes: ['Coaching Sheet: Availability'], reads: ['Desk Sheet: CoachList'],
        invariants: ['A time is published only after the coach\'s YES.', 'Two lessons never share a table at the same time.'],
        limits: ['HORIZON_DAYS 28.'], tests: [T('coaching-app/check-coaching.cjs', '', 'Offers, bookings, replies, timing.')], untested: [], simulate: 'coaching-app/check-coaching.cjs.' } },
    { id: 'coach-2-book', title: 'A student books a lesson', who: 'Player', when: 'Any time before the lesson',
      summary: 'The student picks a time, fills in the form and presses **Send request**, checks the details in the confirm box and presses **Confirm submission**. The confirm box shows *We will email the coach’s answer to:* with the address in large bold type and an **✎ Edit** button, so a mistyped address can be fixed right there. The coach is asked at once by email (and text if registered) and replies YES or NO. Both get *Lesson confirmed* with each other\'s contact details.',
      subtext: 'A request waits up to 48 hours for the coach, and expires 12 hours before the lesson (or at its start on short notice).',
      caveats: ['Every email carries a six-character booking code; `?log=CODE` on the app shows exactly where a booking is.'],
      exceptions: [
        X('The student mistypes their email address', 'Leaving the email box points out a likely typo: *Did you mean sam@gmail.com?* with **Use gmail.com** and **Keep mine** (amber for a clear slip such as gmial.com, a quieter hint such as *Most Comcast addresses end in .net* for one worth a look). Pressing Send straight away shows no hint on the form; a clear slip is pointed out again in the confirm box, where one tap fixes it on the same screen.', 'Nothing to do: the student can always keep what they typed, and the app\'s own check of the address is unchanged.', 'handled', 'coaching-app/Index.html:536'),
        X('The coach never answers', 'The request expires; student, coach and club are emailed.', 'The club follows up with the coach.', 'handled', CF + ':40'),
        X('The student cancels or moves', 'They confirm the change by email YES; a move takes effect only if the new time is still open.', 'Nothing to do.', 'handled', CF + ':185')],
      screen: { kind: 'booking', highlight: ['form'], note: 'The request form and its confirm box.' },
      tech: {
        entry: [E('coaching-app/Index.html', 536, 'emailTypo', 'A likely typo in the address: clear or worth a look.'), E('coaching-app/Index.html', 725, 'showEmail', 'The confirm box: the address large, a clear typo pointed out.'), E(CA, 660, 'requestSlot', 'Saves the request as pending and asks the coach.'), E(CA, 28, 'HOLD_HOURS', '48.'), E(CA, 1595, 'sweep', 'Hourly: expiries, reminders, retries, the public Sheet.')],
        state: ['Requests.status: pending, confirmed, declined, expired, cancelled'], writes: ['Coaching Sheet: Requests', 'emails and texts'], reads: ['Replies tagged [CTTC ref …]', 'VoiceTexts'],
        invariants: ['A lesson is confirmed only by the coach\'s reply.', 'A student never holds two overlapping lessons.', 'A request is sent only by Confirm submission, to the address shown large in the confirm box (an edit there goes back into the form).', 'A typo hint never blocks a request: a clear slip is pointed out before sending, a softer one only on leaving the box, and the student can keep what they typed.'],
        limits: ['Email quota shared; sending pauses at 10 left.'], tests: [T('coaching-app/check-coaching.cjs', '', 'The whole request lifecycle.'), T('coaching-app/check-coaching.cjs', 'The student\'s email address on the request form', 'Typo levels, the hints, fixing and editing in the confirm box, what is sent.')], untested: ['How the hints look on a real phone (checked by hand in the local preview, npm run preview:coaching).'], simulate: 'check-coaching.cjs; DEMO=1 npm run preview:coaching for the page itself.' } },
    { id: 'coach-3-desk', title: 'On the night: lessons appear at the desk', who: 'Desk volunteer', when: 'Friday 7 PM, Saturday 3 PM',
      summary: 'Under **Open Play / Coaching** the desk lists every coach and student with a lesson confirmed tonight: *Coach Lee lessons 7:00 PM, 8:00 PM*, *Lesson with Coach Lee 7:00 PM*, each marked **Confirmed**. Students are matched to the directory by name so their payment can be taken like anyone\'s.',
      subtext: 'Coaching students are club players at a club night; they pay the night\'s fee at the desk and their texts are left out of Voice signups.',
      caveats: ['Needs the owner-set script property `CTTC_COACHING_DB_ID`; without it the list is simply empty.', 'The desk shows the coach and the time, not the table number the lesson was booked on.'],
      exceptions: [
        X('A student\'s name is not in the directory', 'The row has no player link; hovering says **Not matched to the directory. Add them under Add a player to track payment.**', 'Add them under Add a player.', 'handled', 'apps-script/Index.html:4031'),
        X('The coaching Sheet cannot be read', 'The status bar is overwritten with **Coaching lessons unavailable:** and the error.', 'Reload; check with the owner if it persists.', 'partial', 'apps-script/Index.html:4064')],
      screen: { kind: 'desk', highlight: ['open-play'], note: 'Open Play / Coaching with the night\'s confirmed lessons.' },
      tech: {
        entry: [E('apps-script/Coaching.js', 3, 'coachingLessons_', 'Confirmed Requests for the date, with coach and student; reads by CTTC_COACHING_DB_ID.'), E('apps-script/Coaching.js', 44, 'getCoachingParticipants', 'Matches each name to one directory player.'), E('apps-script/Index.html', 4011, 'renderOpen', 'Lists lessons first, then players added with Open.')],
        state: ['coaching (per page)'], writes: ['None (read-only).'], reads: ['Coaching Sheet: Requests, Coaches, Students'],
        invariants: ['Every lesson confirmed for tonight appears at the desk.', 'The desk never writes to the coaching Sheet.'],
        limits: [], tests: [T('apps-script/check-open-play.cjs', '', 'Open Play and the coaching list.')],
        untested: ['A lesson\'s table reaching the desk (it does not today).'], simulate: 'check-open-play.cjs.' } },
    { id: 'coach-4-tables', title: 'Keep the lesson tables free', who: 'Desk volunteer', when: 'During play',
      summary: 'Lessons are booked on table 1, 2 or 3. On a Friday the floor is open play around them; on a Saturday the round robin pilot runs in the same 3–6 PM window. The desk organizer has to keep those tables free when lessons start.',
      subtext: 'Today the table number lives only in the coaching app and the coach\'s confirmation email; the desk and the round robin sheets do not know which tables are booked.',
      caveats: ['On Saturdays, count lesson tables out before assigning round robin tables.'],
      exceptions: [X('Round robin groups need every table on a Saturday', 'Nothing warns that a lesson table is in use.', 'Check the coaching board for the day before printing.', 'gap', 'apps-script/Coaching.js:29')],
      screen: { kind: 'booking', highlight: ['table'], note: 'Lessons booked on tables 1–3.' },
      tech: {
        entry: [E('apps-script/Coaching.js', 29, 'lesson', '{ start, minutes, coachLabel }: no table.'), E(CA, 113, 'Availability.table', 'The table is stored here.')],
        state: [], writes: [], reads: [],
        invariants: ['On a night with lessons, the organizer can see which tables are booked and when.'], limits: [], tests: [], untested: ['Lesson tables vs round robin tables on Saturdays.'],
        simulate: 'Add table to coachingLessons_ and assert it reaches renderOpen.' } }
  ],
  findings: [
    { severity: 'medium', kind: 'design-gap', title: 'The desk does not show which table a lesson is booked on', detail: 'A lesson is booked on table 1, 2 or 3 (Availability.table), but the desk\'s lesson rows carry only the coach and time. On a Saturday the round robin pilot and lessons share the 3–6 PM window: the organizer can print groups onto a table a coach expects at 3:30.', evidence: ['apps-script/Coaching.js:29', CA + ':113'], confirmed: 'read code only', suggest: 'Carry the table into coachingLessons_ and show "Table 2, 3:30–4:30 PM" on the desk; on Saturdays, note lesson tables beside Print RR Sheets.' },
    { severity: 'low', kind: 'fragile', title: '"Coaching lessons unavailable" writes over the status bar', detail: 'If the coaching Sheet cannot be read, the page writes the error straight into the status bar, replacing whatever it said (for example the offline warning), and nothing clears it.', evidence: ['apps-script/Index.html:4064'], confirmed: 'read code only', suggest: 'Use the page\'s setStatus, or show it inside the Open Play / Coaching section.' }
  ]
}
];

// How the club's apps connect: shown before the parts.
const map = {
  nodes: [
    { id: 'players', label: 'Players', sub: 'phones, the website' },
    { id: 'voice', label: 'Google Voice', sub: 'the club number' },
    { id: 'gmail', label: 'Club Gmail', sub: 'texts and replies arrive here' },
    { id: 'desk', label: 'The desk', sub: 'apps-script/, the round robin Sheet', core: true },
    { id: 'staff', label: 'Volunteer app', sub: 'staffing-app/, its own Sheet' },
    { id: 'coach', label: 'Coaching app', sub: 'coaching-app/, its own Sheet' },
    { id: 'turnout', label: 'Tonight page', sub: 'tonight.html + turnout-app/' },
    { id: 'board', label: 'Projector', sub: 'Player board, follow mode' },
    { id: 'site', label: 'Club site', sub: 'GitHub Pages, data/*.json' },
    { id: 'pay', label: 'Clover and Zeffy', sub: 'card reader, monthly passes' }
  ],
  links: [
    ['Players', 'Google Voice → Club Gmail', 'Texts: "I\'ll join", STAFF, COACH, CONFIRM, YES/NO', 'As sent', 'Nobody learns who is coming'],
    ['Club Gmail', 'Desk mail reader → VoiceTexts tab', 'Every forwarded text, once', 'Every 1, 5 or 30 minutes', 'Voice signups, automatic answers, the Tonight page and both apps\' text replies all stop'],
    ['Desk mail reader', 'Volunteer app, Coaching app', 'A wake call with the new texts and replies', 'When something arrives', 'Replies wait for each app\'s hourly sweep'],
    ['VoiceTexts', 'Tonight page (turnout app)', 'Who texted today, matched to ratings', 'Every minute (60 s cache)', 'The page shows the forecast only'],
    ['Volunteer app Sheet', 'Desk: Tonight\'s volunteers, free spots', 'Signups for the date', 'On desk load', 'The section says not connected'],
    ['Desk', 'Volunteer app', 'FreeNightPasses (Zeffy holders) and the admin key', 'Hourly, and on a pass change', 'A pass holder could take a free spot for up to an hour'],
    ['Coaching app Sheet', 'Desk: Open Play / Coaching', 'Lessons confirmed for the date', 'On desk load', 'Lessons missing from the desk'],
    ['Club site', 'Desk → CoachList → Coaching app', 'Which coaches may offer times', 'Hourly', 'Coaches keep their last state'],
    ['Club site', 'Desk', 'Ratings (players.json), last week\'s winners (session details), closures', 'On load and hourly', 'Stale ratings; no promotions'],
    ['Desk', 'Projector', 'Every saved change, via stamps', 'Every 10 s', 'The projector shows the last picture'],
    ['Desk (finalize)', 'GitHub workflow → Club site', 'The finalized night, ratings, the results email', '2 minutes after finalize', 'Results not on the site; next week\'s promotions missing'],
    ['Clover, Zeffy', 'Desk', 'Card payments and monthly passes', 'Every minute on the night; Zeffy by email', 'Payments to check by hand']
  ]
};
module.exports = { phases, map };
