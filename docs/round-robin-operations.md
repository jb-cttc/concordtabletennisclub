# Round-robin data and operations

## Systems

- **Public site** (GitHub Pages, `concordtabletennisclub.com`). Reads committed
  `data/*.json`. Before cutover, the scheduled workflow scrapes the club's
  Drive session reports (`scripts/fetch-and-parse.js`). After cutover
  (`CTTC_LIVE_START_DATE` set), it publishes finalized sessions from the
  private Google Sheet instead (`scripts/publish-finalized-sessions.js`).
- **Owner desk** (`apps-script/`, Google Apps Script bound to the round-robin
  Sheet, deployed for the club account only). Rosters, groups, scores, Open
  Play, payments, membership, Voice signups, and the club's one Gmail reader
  (below). Push with
  `npx --no-install @google/clasp push` from `apps-script/`, then create a
  version and redeploy the existing `/exec` deployment.

The jb-cttc repository now serves `concordtabletennisclub.com`. The workflow
runs only where the repository variable `CTTC_DEPLOY_ENABLED` is `true` (set
in jb-cttc on 2026-09-30), so forks cannot deploy or email. Seth's workflow
must stay disabled so only one repository deploys and emails.

## Club and Year Records

The private Google Sheet holds the raw `AccessPlayers` import and a separate, record-only `RecordArchive` baseline with `RecordArchiveEvents`. Match records are wins/losses, not games won/lost. They are keyed by `player_id`, never matched by display name. The Access `Player` counters are the historical authority; they do not need to be reconstructed by summing old matches. Access league 17 is the 2026 season. The printed year follows the selected session date.

The 1,642 imported Access player counters were last current through September 21, 2026. The local Access file includes 60 more matches on September 23, of which 58 are non-forfeits. Subtracting those 58 outcomes from the local Access counters reproduces the Sheet's **per-player** SHA-256 fingerprint exactly. The one-time archive seed verifies both fingerprints before writing the September 21 baselines and dated September 23 outcomes. For a sheet dated September 23, the printed records therefore exclude that day's matches; a later sheet includes them. Only finalized desk matches **after** September 23 contribute subsequently, with forfeits excluded. Drafts and the selected session itself never contribute.

Run `recordArchiveStatus()` in the Apps Script editor to verify the archive, its cutoff, and player coverage. At migration time, 26 operational `Players` IDs had no matching Access Player ID. Their records remain unavailable (`--/--`) until independently verified; do not assign zero by assumption. After checking a player's source, `addVerifiedRecordBaseline(playerId, clubWins, clubLosses, yearWins, yearLosses, evidence)` stores the four counters and provenance in the private archive. `recordArchiveStatus()` reports whether any player lacks a baseline and whether the archive ends before the latest Access session; it no longer gates finalizing. Records print as `--/--` for a player without a baseline and leave out any Access session after September 23 until its matches are added to `RecordArchiveEvents`. Because every entry is dated, adding them later corrects earlier printouts. Historical year-specific records before 2026 are not imported and will remain unavailable for historical print dates.

The raw Access Match history and original VBA calculation code are not in the desk Sheet. The stored Access Player counters are reproduced for the current season, and future win/loss updates follow the non-forfeit match rule verified against league 17; this does **not** claim every older Access counter can be reconstructed from match rows (28 older club totals differed in the comparison). The rating engine is a separate calculation and must be verified on its own terms.

## Ratings

Until cutover, the club's session reports are the rating authority.
`RatingSync.js` pulls `data/players.json` from the live site hourly (and each
time the desk loads) and updates `Players.current_rating` for exact name or
`Aliases` matches, then records the latest posted session date as
`CTTC_RATINGS_SYNCED_THROUGH`. A finalized session publishes about 2 minutes
after it is finalized (or at once with Publish now), so ratings are current
within minutes. Consequences:

- Finalizing a desk session dated on or before that date is refused, since
  those matches are already counted in the club's results.
- A finalized session can be reopened from the lock button (see
  [Finalizing and reopening](#finalizing-and-reopening)).
- Saving a draft refreshes every starting rating to the current rating, and
  finalizing is refused if a rating changed after the last save (the message
  names the player and both ratings).
- Once the desk has finalized a session newer than the site's latest, the
  sync stops overwriting ratings; the desk is then the authority.

Install once from the Apps Script editor by running `enableRatingSyncTrigger`
(in `RatingSync.gs`) and approving the external-request and trigger
permissions. `ratingSyncStatus` reports the installed trigger and last check.

## Groups, promotions, scoring, printing

`apps-script/Organizer.html` holds the rules, tested by `check-organizer.cjs`:

- Groups by rating in the organizer's chosen size: **Groups of 5, 6 or 7** in the
  desk toolbar (6 by default) means groups of that size or one smaller, as few
  groups as possible. Choosing a size rebuilds the groups like **Rebuild by
  rating**; late arrivals then fill groups up to that size. The desk flags any
  group outside the range. The choice is kept per night on that device; another
  device reads it off the saved groups (all 7 or 6 means 7, all 5 or 4 means 5),
  and a new night starts at 6. A sheet for a group of 7 (21 matches) uses
  tighter match rows so it still prints on one page.
- Promotions: each winner (except Group 1) of the previous session on the same
  weekday, read from the public site, is guaranteed one group above the group
  they won: the winner moves up as if the up arrow were clicked. Any group
  then left larger than before gives its lowest-rated non-winner to the group
  below, so table sizes stay balanced and nobody else moves more than one
  group. A winner already rated into that group or higher is left alone. Promotions are saved per
  player (`SessionPlayers.promotion_from_group`).
- Once groups are saved or moved by hand, late arrivals are slotted in by
  rating rank without reshuffling anyone, and promoted players are never
  bumped down. **Rebuild by rating** resets groups and reapplies promotions.
- Matches follow a rotation schedule so a 6-player group uses three tables
  per round. Live standings show W-L, games, and projected rating in the
  order the players are listed, so rows never move while scores are entered;
  once all of a group's matches are complete the winner is marked (with a
  note when a tie-break decided it).
- **Print groups** and **Print sheets** produce the group list and one
  tournament sheet per group (club rating and record, instructions, match
  schedule with expected/upset points).

Group ranking (`standings.js`, used by the site, emails, and the desk):

1. Match points: a win is 2, a played loss 1, and a forfeited or unplayed
   match 0 for the loser (USATT Rule Interpretations 6.3). The winner of a
   forfeit gets 2 points and a 3-0 game credit for tie-breaks; a double
   forfeit gives neither player anything.
2. Two players tied on points: head-to-head result (a forfeit win counts).
3. Three or more tied, or two players whose match was not played (double
   forfeit): game ratio among the tied players, then the lowest rating before
   the session, then name.

The site shows an asterisk and a one-line note under a group only when its
winner needed more than the win count: same wins but different match points,
or a tie on points. Other places in the group follow the same rules without
a note.

The Access reports print `F` in both cells for any forfeit, so who forfeited
is lost. `data/forfeit-overrides.json` records it for sessions posted before
the desk took over (9/28 only); `fetch-and-parse.js` applies it on every
rebuild. Desk-finalized sessions carry `forfeit` and `forfeitedBy` on each
match. The desk runs a copy of `standings.js` (`apps-script/Standings.html`):
run `npm run sync:desk` after editing `standings.js`; `check-organizer.cjs`
fails when the copy is stale.

The desk records games won with clickable balls per player. Three games win a
match. If time runs short and a match is cut to best of 3, tap the 2 ball and
then the gray Winner badge under that player; the other player's games default
to 0 and can be changed to 1. The Matches sheet keeps this in `won_by`, it counts
as an ordinary played win for ratings and records, and a 2-game score without
a named winner cannot be finalized.

`rating-engine.js` (site) and `RatingEngine.js` (desk) use both players'
session-start ratings for every match adjustment, with a zero floor.

## Membership, linked names, juniors

Name links are kept in the private `NameLinks` sheet of the round-robin
Google Sheet (columns `kind`, `name`, `linked_name`, `updated_at`), never in
code, because this repository is public. Edit the sheet directly; the desk
reads it on every load. `LinkedNames.js` rejects any other `kind`.

- `same_person`: the same person under two directory names; `name` is the
  record they play under. Linked names share membership status and Zeffy
  coverage; toggling either badge updates both. Player IDs, ratings, and
  attendance are never merged. Old spellings of a single record belong in the
  `Aliases` sheet instead.
- `junior` with a `linked_name`: a junior and the member account they belong
  to. Juniors show a **J** badge whose tooltip names the member.
- `junior` with a blank `linked_name`: a junior member with no linked adult
  account (J badge, "Junior member").
- `pays_for`: `name` regularly pays `linked_name`'s fee on the same Clover
  card payment. The desk then matches one payment to both when their fees add
  up to it (see [Clover card payments](clover-payments.md)).

A link applies only when each name matches exactly one active player;
otherwise it is listed as needing a directory match. Other players default to
V; a `MemberStatus` row or a badge click makes them M.

Keep member-specific data (links, payments, dues, Zeffy passes, contact
details) in the Sheet, and use made-up names in tests.

### Correcting a name, rating, email, or other names

The pencil beside a name in the player directory (active or archived) opens a
window with the player's name, rating, email address, and other names.
**Review changes**
lists every change as old → new; nothing is saved until **Confirm and save**.
It needs a connection to Google, and `PlayerEdits.js` refuses a change made
on another device after the window opened.

- **Name.** The `Players` row keeps its player ID, so ratings, records,
  payments, and membership stay with the player. The old and new names are
  added to the private `NameChanges` sheet, and `NameLinks` rows naming the old
  spelling are updated. The next publication (`publish:finalized`) reads
  `NameChanges` and shows the corrected name in every session the site already
  lists, Access-era and desk sessions alike, so the player's history stays
  under one name. A name that any player had before a correction is never
  given to another player (the desk refuses it), because the site could not
  tell whose results it names; if it happens anyway, publication stops with
  "Previously published session missing or changed" instead of guessing.
- **Rating.** Sets `Players.current_rating` for correcting a wrong rating.
  A rostered player's draft is saved again so the session starts from the new
  rating. The site shows it after the player's next finalized session.
  Changing the rating of a player in a finalized, not yet published session
  means that session can no longer be reopened.
- **Email.** Kept only in the private `PlayerEmails` sheet (`player_id`,
  `email`, `updated_at`), which publication never reads. The AuditLog records
  that it changed, not the address.
- **Other names.** The private `Aliases` sheet (`alias`, `player_id`,
  `created_at`): names the player goes by elsewhere, such as a Google Voice
  contact name, a Zeffy buyer or Clover cardholder name, or an old spelling.
  Voice signups and automatic answers, Zeffy passes, Clover payments, the cash
  page, and the staffing and turnout apps use them from their next read.
  Typing over a name corrects that row in place; **x** removes it; **+ Add
  another name** adds one. A player can have up to 20.
  - A name belongs to one player. The desk refuses a name that is already
    another player's other name, another player's directory name, or a name
    another player had before a correction. Case, spacing, punctuation and
    "Last, First" order do not matter. Adding or renaming a player to someone's
    other name is refused too.
  - Renaming a player keeps the old name as another name unless **Keep the old
    name as another name** is unticked, so Voice contacts, Zeffy and Clover
    still match.
  - Removing or correcting a name that links Zeffy payments or Voice texts
    today says so in the confirmation ("1 Zeffy payment under ... will no
    longer count").
  - The directory search also finds a player by another name, shown as "Also
    goes by ...". Search ignores case and accents: "darselo" finds "Dárselo".
  - The AuditLog records each name added, corrected or removed; the desk log
    only how many.

## Session fees and Zeffy

Members and visitors pay a per-session fee ($10 or $15), recorded per date in
`SessionPayments` as Venmo, Zelle, Cash, or Credit (or cleared back to unpaid).
Juniors pay $5. A player's **first visit** costs $10 (see the club site's First
Visit page). The desk works it out: a night is a first visit when the player's
directory record was created that day and they have no earlier night on the
desk, so a player added at the desk tonight shows a green **1st** badge in
place of V. Players from the older records were created on another day and
never count. If the desk gets it wrong (someone who came before but was never
recorded, or a record added the day before), the player's payment menu has a
**First visit $10** choice that changes it for that night only; the choice is
kept in the private `FirstVisits` tab, made by the first one. All fees come
from `apps-script/NightFees.js`, which the desk, the cash flow page and Clover
matching share. A player's status on an earlier night is the one they had
then, from the membership changes in the `AuditLog`: a visitor who joins
tonight is still a visitor on the nights before.
Payment, Open Play and membership changes are kept on the device first and sync
to the Sheet in the background, so they keep working when the connection
drops. **Zeffy** is an optional monthly
play pass, tracked from Zeffy's payment emails to the club Gmail. The mail
reader (see [One Gmail reader](#one-gmail-reader)) reads new Zeffy mail and
records purchase, renewal
(`recurring payment` in the subject) and cancellation emails in the private
`ZeffyPayments` sheet, one row per person covered (a renewal covers everyone the
buyer first purchased for). An email counts as a play pass when its subject or
its order summary says "Playpass", so a renamed form still counts; donations and
other Zeffy mail are left alone. A play pass email whose buyer the desk cannot
find (Zeffy changed its wording) is recorded as `unreadable`, and for 90 days
the Zeffy list says how many there are, so the buyer can be looked up in Gmail
and covered by hand. When the reader learns a new format
(`ZEFFY_READER_VERSION_` in `apps-script/ZeffyTracking.js`), its first sync
reads the whole mailbox again and picks up the emails it skipped before. Zeffy names
match a directory player by display name or a private `Aliases` row; unmatched
buyers still appear in the list. A payment covers sessions until the next
charge date: the start day in each following month, or that month's last day
when shorter, inclusive. The sidebar shows `(Nd left)` for active passes, a red
**(Expired)** for passes that lapsed (or were cancelled) within the past 90
days, and a superscript count of consecutive monthly payments. A cancellation
does not end a month already paid. Manual holders in `ZeffyPasses` by player ID
remain covered on every date unless Zeffy mail mentions them; archived players
keep their manual pass and appear in the sidebar list. Covered players show a
locked **Zeffy ✓**. Zeffy is not a membership payment: `MembershipDues` records
only the membership year.

## One Gmail reader

Gmail allows a free account about 20,000 reads a day, and every club app (desk,
coaching, staffing, turnout) shares that allowance. Until October 2026 each app
searched the same Google Voice texts on its own every minute, re-reading each
person's whole text history (Voice keeps all of a person's texts in one Gmail
thread), and the allowance ran out on round robin nights ("Service invoked too
many times for one day: gmail").

Now one job in the desk (`apps-script/MailReader.js`) reads only mail that
arrived since its last read, once. It wakes only as often as texts matter:
**every minute** in the 4 hours before a round robin's sign-up closes, when
most signups come in (3:15 to 7:15 PM on Mondays and Wednesdays; 11:15 AM to
3:15 PM for the Saturday pilot), **every 30 minutes** from 11 PM to 7 AM, and
**every 5 minutes** otherwise, including from 6 AM on a round robin day. Each
run costs timer run time, which every club app shares
([Google limits](google-limits.md)), and so does each change to a timer: the job
keeps **one repeating timer** (`readMail`) at the pace due now, and replaces it
only when the pace changes, a run ahead of a busier stretch so that stretch
starts on time. A quiet run makes no timer calls. A desk with Voice signups
open still reads within the minute. It records:

- forwarded Voice texts go to the private **`VoiceTexts`** tab (`message_id`,
  `received_at` in milliseconds, `from`, `subject`, `text` without Voice's
  links and footer), kept for 90 days;
- Zeffy play pass emails go to `ZeffyPayments`.

The desk's Voice signups and automatic answers, and the coaching, staffing and
turnout apps (which open this Sheet by their `DESK_SHEET_ID` script property)
read texts from `VoiceTexts`, never by searching Gmail. Gmail is opened only to
send a reply, by message id. A quiet read costs one Gmail search, so a day
with no texts costs a few hundred Gmail calls at most.

The **`MailReader`** tab has one row: when it last read (`read_at`), how far it
has read (`cursor`), and its Gmail calls today (`gmail_calls`). Past 6,000 calls
in a day it reads at most every 5 minutes and the desk log gets
a `gmail_reads_high` warning; each new day logs `mail_reader_day` with the
previous day's count. The desk sets up the timer the first time it reads mail
and puts it back if it goes missing (checked every 6 hours, and when automatic
answers are switched on); the job's first run of a new schedule removes the old
timers (the every-minute ones used until October 2026, then `readMailWatch`
and the one-off `readMail`). The desk reads mail itself when the job has not
read in the last minute. If `read_at` is more than 45 minutes old, the coaching
and staffing checks fail (and, when that lasts past 30 minutes, email the club
at their next hourly check) and the turnout log records `texts_not_collected`.

### Waking the coaching and staffing apps

The coaching and staffing apps wait for YES and NO answers by text and email.
Until November 2026 each looked every 2 to 15 minutes on timers of its own,
which spent most of the 90 minutes of timer run time a day every club app
shares. Now they have only their hourly `sweep` (which runs the check too), and
the mail reader **wakes** them when something they may be waiting for came in:

- every new text wakes both apps;
- an email reply to a coaching question (`[CTTC ref …]` in the subject) wakes
  coaching, and one to a staffing question (`[CTTC shift …]`) wakes staffing.
  The search includes those subjects; the replies are not recorded anywhere.
  Our own questions wake nothing, except the club's own reply from this
  account (it starts "Re:"), which approves a staffing request.

A wake is a call to the app's `/exec` address, so the app's work counts as a
web request, not timer time; the reader's run waits only for it, and calls both
apps at once. The call carries what came in (each text cut to its first 120
characters, at most 10 a call), so an app waiting on none of it (a round robin
sign-up, say) answers "nothing to check" without opening a Sheet. What the app
acts on, it still reads from `VoiceTexts` and Gmail, never from the call, and
the call must carry the desk's key, kept in this Sheet's hidden **`AppWake`**
tab (made by the desk the first time; the apps read it by `DESK_SHEET_ID`).
What a desk page's own read finds wakes the apps at the job's next run, so a
page never waits on them.

A call that fails is tried at the job's next two runs; after that the app's
hourly check picks up what came in, and the desk log gets an `app_wake_failed`
warning (at most hourly). Each new day logs `app_wakes_day` with the previous
day's calls by app (`coaching_failed` for failed calls). Because a wake goes to
the apps' `/exec` addresses, release coaching and staffing before the desk when
this changes.

## Voice signups

Google Voice forwards each text to the club Gmail from a
`@txt.voice.google.com` relay address, and the mail reader records it in
`VoiceTexts`. The desk lists every text received on
the selected date (Trash and Spam included), grouped by sender, newest first,
with a timestamp per message. It does not interpret the wording. Each sender
shows likely directory matches, including linked names; the organizer clicks
**RR** to add one to the local draft, then saves the draft. Senders without a
saved contact name show only the last four digits of their number.

Each sender's envelope carries a mark. **✓** means the latest text says they
are coming and their Voice contact name is exactly one active player (or an
`Aliases` name of one). **?** means look first; hovering the envelope says
why ("Latest text doesn't say they're coming", "Contact name isn't exactly
one player", ...). These are the same checks as the
[automatic answers](#automatic-answers). **Add all ✓** adds every ✓ sender
not already in RR, Open Play or Coaching, exactly as pressing **RR** on each
would, including the **Confirmed.** text. A **?** is never added by it.

On Monday and Wednesday nights from 6:45 to 7:30 PM Pacific, and on
Saturdays from 2:45 to 3:30 PM (the [Saturday pilot](#saturday-pilot)), while today's
date is open and the tab is in view, the list checks for new texts every
minute by itself and briefly highlights anyone new. It skips a minute while
a message preview is open or the device is offline. **Refresh** still works
at any time.

## Tonight's volunteers

Under **Voice signups**, **Tonight's volunteers** lists everyone signed up in
the volunteer app (`staffing-app/`) to open or close on the selected date,
with their roles. A sign-up still waiting for its YES shows "waiting to
confirm"; released, expired, dropped and cancelled ones are left out. Each
person has **RR** and **Open** buttons that do exactly what the directory's
buttons do (add to the draft, or to Open Play), because volunteers are busy
setting up and often forget to sign in. Nothing is texted or emailed. Once
someone is placed the buttons give way to *In RR*, *In Open* or *Coaching*.
A name that is not an active directory player says so; find them in the
directory (Show archived players) or add them under **Add a player**.

The desk only reads the volunteer app's private Sheet (tab `Signups`, by
header name; never emails or phone numbers) and never writes to it
(`apps-script/Volunteers.js`). To connect it, set the desk's script property
`CTTC_STAFFING_DB_ID` to the id of the Sheet named "CTTC Staffing (private -
do not share)" (the part of its address after `/d/`); until then the section
says it is not connected and the rest of the desk works as before.

Volunteering does not count toward the Tonight page by itself: a volunteer
is at the gym, not necessarily in the round robin. Once one is added to RR
here they count as playing tonight like anyone signed in.

### Automatic answers

When switched on, the desk answers round robin texts by itself
(`apps-script/VoiceAutoReply.js`), on Mondays and Wednesdays from 6 AM until
sign-up closes at 7:15 PM Pacific, and on Saturdays from 6 AM until 3:15 PM,
except on days the club site lists as closed. They have no timer of their own:
the mail job runs them after each read that brought a new text (within a
minute in the last 4 hours of sign-up, within 5 minutes earlier in the day),
and once when sign-up opens, so a text from the night is answered by 6:05 AM. Each person gets at most one automatic answer a day:

| The Voice contact name is | The answer |
| --- | --- |
| exactly one active player, or an `Aliases` name of one | "Received - you're on the list, *directory name*! See you tonight." ("today" on a Saturday) |
| anything else: no contact name, several players, part of a name, someone not in the directory | "We're glad to have you! This number isn't linked to anyone in our club directory yet. Reply with your name and we'll add you." |

Only texts that plainly say the person is coming are answered (the Tonight
page's tap-to-text fills in "I'll join CTTC's RR tonight"). Questions, "can't
make it", commands for the coaching and volunteer apps, and anyone with a
coaching lesson that day are left for a person, as is everything after sign-up closes.
A name sent back after the second answer is not read automatically: match
the sender in **Voice signups** as usual, and save their name as the contact
in Google Voice (or add an `Aliases` row) so their next text links. An
automatic answer counts as a reply, so **Confirmed.** is not sent on top of
it. Each answer is logged as `voice_auto_reply` with the player id when
linked, never the number or the text.

It is off until the owner turns it on, because the mail job runs whatever
code was pushed last, including a `/dev` preview. Run `enableVoiceAutoReply`
once in the Apps Script editor (it sets `CTTC_VOICE_AUTO_REPLY` to `on` and
makes sure the mail job's timers exist). `disableVoiceAutoReply` turns it off;
`voiceAutoReplyStatus` shows the state. Until October 2026 the answers had
their own timer firing every minute, all week; the mail job removes it.

## Saturday pilot

From October 31, 2026 the club is piloting a weekly Saturday afternoon round
robin. The gym is open 3 to 6 PM, so sign-up is 2:45 to 3:15 PM and play
starts at 3:30. It runs on the same desk, Sheet, publication and results
email as Monday and Wednesday; only the clock differs:

- **Desk.** Open the Saturday date and run it like any night. Promotions
  look at the previous *Saturday*, so the first one has none. Most players'
  ratings are known from weeknights; give anyone new a rating as usual.
- **Voice.** Automatic answers run until 3:15 PM and say "See you today."
  Voice signups refresh by themselves from 2:45 to 3:30 PM.
- **Publishing and email.** Finalizing starts the same 2-minute publish and
  results email. The scheduled fallback runs at 8:45 PM Saturday and 8 AM
  Sunday, Pacific.
- **Site.** The Round Robins page has a collapsible panel per day; the
  Saturday panel fills in once the first Saturday is published. The archive
  has a Saturday filter.
- **Tonight page.** Says "today" on Saturday, and until the first Saturday is
  published it expects 20 players with no ratings (see
  [Tonight page and turnout app](turnout-flow.md)).

## The Equalizer

The desk's second event, chosen with the **Round robin | Equalizer** switch:
head starts by rating, RR → Finals or Double Elimination, singles or doubles,
best of 3 or 5. It shares the roster, sidebar, payments and publication; see
[Equalizer operations](equalizer-operations.md).

## Finalizing and reopening

**Finalize RR Results** checks that every match is complete, updates every
player's rating, writes the rating ledger, and locks the session. The button
then reads **Finalized** with a lock. A banner starts a 2-minute countdown;
when it reaches zero the desk asks GitHub to run the "Update Data and Deploy"
workflow, which publishes the session and sends the session email. **Publish
now** in the banner skips the wait (after publishing, a session can no longer
be reopened here). The countdown is stored on the server, so it survives a
reload, and a backup trigger covers a closed tab. If publishing is not
connected (see below) or GitHub refuses the request, the banner says so and the
workflow's own fallback runs (11:45 PM and 8:00 AM Pacific after Mon/Wed nights,
8:45 PM and 8:00 AM after a Saturday) publish the session instead.

**Results email.** When the desk sees the club site list the session, the banner
starts a second 2-minute countdown. At zero (or with **Send now**) the desk
runs the workflow again with `send_email` on, which sends the session summary
email to the distribution list, then reports when that run finishes. Only that
run, and the scheduled fallback runs, send the email; pushes and plain manual
runs never do. The email's group winners and tie-breaker notes come from the
same `standings.js` as the Round Robins page, so ranking or wording changes
reach it automatically (`npm run check:email` enforces this). The distribution
list is the `Subscribers` tab of the private database Sheet, never the
repository. Visitors join with the green **Subscribe** button on the Round
Robins page, which opens a small form served by a separate public Apps Script
app (`subscribe-app/`, deployed with its own `/exec` address and a
`DATABASE_ID` script property). That app can only add one validated,
de-duplicated address; it cannot read the list or reach the desk. A new
address gets a welcome email with the latest results (the pipeline publishes
`data/latest-session-email.json` for this), and every results email ends with
an **Unsubscribe** link to `unsubscribe.html`. The link in a results or welcome
email is personal: it carries a token signed for that one address (valid a
year), so it opens a question page that names the address, and only a click on
**Yes** deletes the row and sends a confirmation email. A link that was altered,
forged, or signed with another secret does nothing, and merely opening it
removes nobody, so mail scanners are harmless. Someone without the email types
their address on `unsubscribe.html` instead: a link valid for 24 hours is emailed
to that address only (the page gives the same answer whether or not the address
is on the list). Links are signed with a `TOKEN_SECRET` script
property. The results job signs its links with the same secret, kept as the
GitHub Actions secret `UNSUBSCRIBE_TOKEN_SECRET`; set both to one long random
value (for example the output of `openssl rand -base64 48`, pasted into both
places and never into chat or a commit). Without the GitHub secret the results
emails fall back to the plain page where the address is typed. The results job
sends one message per subscriber and prints only counts and error codes, never
addresses, because the Actions log is public. The welcome and unsubscribe emails go out through
Apps Script `MailApp` from the account that owns the sign-up project, so after
this project gains the mail permission, open it in the editor and run
`authorizeEmail` once and approve the prompt; until then `/exec` must not be
redeployed. The daily mail quota is shared, and the last few messages are kept
for unsubscribe confirmations. To send a
check email without touching the sent marker, run the
"Send Test Email" workflow from the Actions tab (subject starts with
"[Test]"). Its scope defaults to **sender-only**, one message to the sending
account with a real personal link; choose **everyone** to send to the whole list.

**Connecting publishing (one time).** Create a fine-grained GitHub personal
access token for the `jb-cttc/concordtabletennisclub` repository only, with the
repository permission **Actions: Read and write** (nothing else), and save it
in the Apps Script project under Project Settings, Script properties, as
`CTTC_GITHUB_TOKEN`. Never put it in the repository or a chat. Then run
`checkPublishSetup` from the editor to confirm the token can see the workflow.
Rotate the token when it expires.

Clicking the lock asks for confirmation and then **reopens** the session:
every rating change from that session is reversed from the ledger, the ledger
rows are removed, and the session is editable again. Finalize again after the
correction. Reopening is refused when

- the club site already lists the session (the site will not change a
  published session),
- a later session is already finalized (reopen the most recent one first), or
- a player's rating changed after the session was finalized.

The audit log records each reopen with the ratings it reversed.

### When finalizing or reopening fails

The button is disabled and the status bar counts the seconds while Google
works, so a slow reply is not a reason to click again. Finalizing writes the
rating ledger first, then the player ratings, and marks the session finalized
last, in one write. If Google stops partway, the desk undoes what it wrote and
says *Nothing was changed*; click **Finalize RR Results** again. If Google
also refuses the undo, the ledger rows stay behind, and the next finalize
repairs that run: each player still at the ledger's `rating_before` or already
at its `rating_after` is put back to `rating_before` (and so is the session's
starting rating), so no rating change is applied twice. It refuses, and names
the player, only when a rating has moved to some third value since. Loading a
session that has such leftover rows shows a warning saying so. If the session
row itself may already read *finalized* when Google stops, the desk leaves the
ratings and ledger in place (a finalized session stays consistent) and asks
you to reload to see which it is. A reopen that stops before the session is
open puts the ratings back; one that stops later is finished by clicking the
lock again. Table rewrites (`replaceSessionRows_`) write the new rows before
clearing the old tail, so an interrupted rewrite never leaves a table empty.

After an error the page asks Google what actually happened: if the session did
finalize (or reopen) and only the reply was lost, it says so instead of
showing an error, and a repeated request with the same revision returns the
result rather than failing.

**Finding the cause later.** Every failed finalize or reopen, including
refusals, adds a `finalize_failed` or `reopen_failed` row to the `AuditLog`
sheet with the message, the step that failed, and whether the undo worked, and
the error on the desk ends with *(Reference XXXXXXXX)*: the first eight
characters of that row's `event_id`. Search the sheet for it. Each finalize
also logs `finalize_started` (with `repairing`, the number of leftover ledger
rows) before writing. Problems the page sees itself (a save Google did not
confirm, a device copy it could not restore, a finalize or reopen whose cause
it could not confirm, a save conflict, a save that found another tab's or
device's newer version and combined with it) are logged as `desk_problem` rows with
the time, session revision, connection state, and browser. Reports made
offline wait on the device and go with the next one.

Each `session_saved` row records `ms` (how long the save took) and `lockMs`
(how much of that was waiting for other desk work, such as payments). If the
desk says Google is slow, those two numbers show whether the save itself or
the queue behind other work was slow. The page waits up to a minute for a
save's reply and never sends a second save while one is still pending. Gmail
is never read while holding the script lock that saves wait on: Zeffy emails are
read first and only the new rows are added under the lock, and Voice
confirmations use the separate document lock.

### The desk log (`CTTC Desk Logs`)

The `CTTC Desk Logs` tab (made the first time the desk logs something) has one
row per key step or problem, readable without opening the Sheet:
**Actions → Desk log → Run workflow** on GitHub (optionally one session date,
or the Reference from a desk error). The report lists problems in the last 7
days, steps that should have followed a finalize and did not (site publish
started and confirmed, results email sent), a finalize that started and never
finished, the last time each key step happened, and the latest lines.

Columns: `at` (UTC), `level`, `what`, `session` (date), `ref`, `detail`.

- **`step`**: every row the desk adds to the `AuditLog` is copied here:
  session created and saved (with revision, player and match counts and
  timings), payments, member and open-play changes, finalize started and
  done, publish scheduled, started and confirmed, results email sent,
  ratings synced, reopen.
- **`error`**: a failed finalize or reopen (`ref` is the same *Reference* the
  desk showed, so the private `AuditLog` row is easy to find), a problem the
  page reported (`page: …`, including any error in the page itself), and a
  publish timer, hourly rating sync or page load that failed with nobody
  watching (`publish_timer_failed`, `rating_sync_failed`, `page_load_failed`).
- **`warn`**: a call to Google that failed or timed out (`page: call failed`,
  with which call). The desk retries these itself; the same failure is
  logged at most every 10 minutes, and a report Google kept but whose reply
  was lost is logged once.

The workflow's logs are public, so this tab never holds a name, email
address, phone number, payment method or member status: players appear only
as a code (`player=P1A2B3C`), and error text has addresses, numbers, quoted
text, player ids and long ids replaced. The full detail stays in the private
`AuditLog`. The tab keeps the latest 2,000 rows.

## Live publication cutover (go-live checklist)

> **The desk is the record.** Finalizing is always available. MS Access is
> still entered in parallel and only used to double-check the desk's results
> ([parallel operations](parallel-operations.md)).

1. Give the service account (`GOOGLE_SERVICE_ACCOUNT_EMAIL`) Viewer access to
   the round-robin Sheet and enable the Sheets API for its project.
2. In the deploying repository, set `CTTC_LIVE_START_DATE` (first live session,
   strictly after the last Drive report) and the
   `GOOGLE_ROUND_ROBIN_DATABASE_ID` secret.
3. Run `npm run preflight:live` with those settings in a trusted terminal.
   It only reads the Sheet and lists what it would publish.
4. Confirm the club site's ratings match the desk (`ratingSyncStatus` shows
   the latest Access session). Access entry continues in parallel; review
   each session with `npm run compare:parallel` (see
   [parallel operations](parallel-operations.md)) and stop Access only after
   the agreed clean period.
5. **Bring the record archive up to the last Access session** (not required
   to finalize). Until the 9/28 Access matches are added to
   `RecordArchiveEvents`, printed club and year records leave them out, and
   players without a baseline print `--/--`. Run `recordArchiveStatus()` to
   see the current values.
6. After the first live session, verify the archive, winner, scores,
   adjustments, and email against the desk's ledger.

`npm run refresh:data` is the historical Drive importer; do not run it after
cutover.

## Checks

`npm run check:app` (owner desk), `npm run check:ratings`,
`npm run check:standings`, `npm run check:publication`,
`npm run check:disposable`, and `npm run check:data`.

`npm run check:app` includes the whole-desk night checks
(`apps-script/check-night.cjs`): the real `Index.html` and server files run
against an in-memory Sheet with a modelled script lock, on a virtual clock, with
the connection slowed, cut, or losing replies. They check what the volunteer
sees and what the Sheet ends up holding. `npm run check:nights` runs longer
randomized nights. When a night goes wrong at the club, reproduce it there
first: a case that fails before the fix and passes after is the best guard
against the same problem coming back.
