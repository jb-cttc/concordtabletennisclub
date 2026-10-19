# Staffing app: volunteer sign-ups to open and close the club

How the volunteer sign-up app (GitHub issue #51) is set up, how a sign-up
moves from a pick on the calendar to a confirmed shift, and where it can get
stuck. The source of truth is the **private** Sheet `CTTC Staffing (private -
do not share)`; the calendar on the home page only shows a summary. Code
references are to [`staffing-app/Code.js`](../staffing-app/Code.js).

> Keep real names, emails and phone numbers out of issues and commits when
> using this guide. Describe a case by date, position and first name.

## 1. What it does

- Club nights are Monday, Wednesday and Friday 7 to 10 PM and Saturday 3 to
  6 PM, Pacific. The calendar shows the current month and the next two (on
  November 1st, January opens). Past nights can't be picked; tonight can be
  picked until an hour before opening.
- Each night has, opening: **Desk organizer** (the opener and round robin
  organizer: first in at 6:40 PM, key lockbox, doors, side door, storage room,
  lights and AC, runs the round robin desk) plus a backup; **Money collector
  (Front Desk)** (Revenue Sheet, Clover device, Zelle/Venmo QR codes, records
  everyone entering, manages payments) plus a backup; **Table/barrier setup**
  (1 to 4: barriers, tables and nets, arrive by 6:45 PM). Closing: **Lock-up**
  (1, needs key access: last out, checks everyone is out and every door is
  locked, lights and AC off) and **Put tables and barriers away** (1 to 5).
  One closer may tick "I'll also do the desk's Finalize step".
- One person takes only **one opening position per night** (a backup counts),
  except that the **desk organizer may also help with table/barrier setup**.
  One closing position per person. The same person may open and close.
- **Night status**, from *confirmed* sign-ups only:
  - **Needs people** (`!`): no confirmed desk organizer, money collector,
    table/barrier setup, lock-up or anyone putting tables away.
  - **Covered** (`✓`): every minimum met, but a backup is still open.
  - **Fully staffed** (`★`): every minimum and **both backups** confirmed.
    Extra table setup and closing spots stay optional and are still shown as
    open spots. (We chose this over "every one of the 14 slots" because 4
    setters and 6 closers would almost never all be filled.)
  - **Closed** (`×`): the gym is closed that night (section 8). A closed
    night asks for no volunteers, is not counted and gets no reminders.
- The page shows **first names only** ("Sam", or "Sam K." when two different
  people that night share a first name; initials at the start stay together,
  so "J. B. Birch" is "J.B."). It never shows emails, phones or
  last names. Pending picks show as "waiting to confirm".
- **Nobody can sign up as someone else.** A sign-up is confirmed only by a YES
  from the player's **email on file**; the page never sees that address except
  masked (`s•••@gmail.com`). A player with no email on file asks the club to
  approve one, once (section 5).

## 2. Setup (owner, once)

The project exists: *CTTC Volunteer Signups* in the club account, linked by
`staffing-app/.clasp.json` (`clasp push` from `staffing-app/`; `.claspignore`
keeps the test out). A maintainer pushes and deploys it like the desk.

**From a phone, no editor needed:** open the project's `/dev` address with
`?setup`, signed in as the club account. Adding `&desk=<desk Sheet id>`,
`&seed=<open/close Sheet id>` or `&members=<membership list id>` sets those
properties if they are not set yet (a property already set is never changed
from a link). The page runs `setup()`; the first time, Google asks the club
account to allow the app's permissions, which is the one step nobody else can
do. It then offers a **preview** of the open/close import (`&import=preview`:
who would be emailed, masked, how many nights and which positions, and which
names need fixing; it writes and sends nothing) with a **Send** button that
runs the real import (`&import=seed`), and one tap for the membership email
import. The preview's list also includes anyone **already emailed and still waiting
for a YES** (marked "Re-send"), and the one **Send** button emails them again
too: the current email, to their email on file after the import (a SeedLinks
address replaces one found in Zeffy or coaching records; one the club typed
in the Emails tab stays), with a fresh 72 hours. A YES to the earlier email
still counts. Someone emailed less than an hour ago is not re-sent, so a
second tap on Send emails nobody twice (`&import=resend` re-sends without
importing). A hold that
expires with no answer can be offered again by the next import; a NO, a
confirmation or a drop is never re-offered. Anyone else sees "not available", and
`/dev` only opens for the project's editors anyway.

Or, from a computer:

1. Open the project in the Apps Script editor.
2. **Project Settings > Script properties**:

   | Property | Required | What |
   | --- | --- | --- |
   | `DESK_SHEET_ID` | yes | The id in the desk Sheet's address (the part after `/d/`). The app reads its `Players` tab (`player_id`, `display_name`, `active`, matched by header name; active rows only), and for the seed import its optional `Aliases` (`alias`, `player_id`) and `ZeffyPayments` (`payer_name`, `payer_email`) tabs. It never writes to it. |
   | `ADMIN_EMAIL` | no | Who hears about drops, failures and approval requests. Default: the club account. |
   | `SIGNUP_MODE` | no | `directory` (default) or `hybrid`. See section 9. |
   | `SEED_SHEET_ID` | for the import | The volunteer's open/close Sheet. |
   | `SEED_SHEET_TAB` | no | Its tab; default `Open/Close`. |
   | `COACHING_DB_ID` | no | The coaching app's **private** Sheet id, used only by the seed import to find emails and mobiles (`Coaches`, `Students`). |
   | `MEMBER_LIST_ID` | for the member import | The 2026 membership list: a Google Sheet, or a Google Doc with a table. |
   | `CLOSURES_URL` | no | Where closures are read; default `https://concordtabletennisclub.com/data/closures.json`. |
   | `STAFFING_DB_ID`, `TOKEN_SECRET`, `HEADERS`, `CLOSURES_LAST_GOOD` | set by the app | Don't edit. |

3. In the editor, run **`setup`** once and grant the permissions. It creates
   the private Sheet (its address is logged), the hourly `sweep` trigger and
   the minute-by-minute `checkReplies` trigger, and logs how many active
   players it can read. It is safe to run again; from the web page it does
   nothing.
4. Fill the **Training** tab (or let the seed import do it, section 6): one
   row per trained player, `player_id`, `name`, then `yes`/`no` in `keys`,
   `open` and `front_desk`.
5. Put emails on file: run **`importMemberEmails`** (section 7) and
   **`importSeedSheet`** (section 6), then type any missing ones into the
   **Emails** tab yourself (`player_id`, `name`, `email`, optional `phone`,
   `source` = `owner`, `status` = `approved`). Players still missing one can
   ask from the page (section 5).
6. **Deploy > New deployment > Web app**, *Execute as: me*, *Who has access:
   Anyone*. Put the `/exec` URL into `APP_URL` in `index.html` (the
   "Volunteer signups" block); the button stays hidden until then. The app
   posts `cttc-staffing-ready` and `{type: 'cttc-staffing-height', height}`
   to the page so the frame grows with it.

Every function without a trailing `_` in `Code.js` can be called by anyone on
the internet. `check-staffing.cjs` asserts the exact list: `doGet`,
`staffBoard`, `findPlayers`, `playerAccess`, `signUp`, `requestDrop` (the
page), `setup`, `importSeedSheet`, `importMemberEmails` (owner only; they
refuse to run unless the person running them is the owner), `sweep` and
`checkReplies` (triggers).

Scopes beyond the coaching app's: `documents` (only to read the membership
list when it is a Google Doc; DocumentApp has no read-only scope) and
`script.external_request` (only to fetch `closures.json`).

## 3. Private Sheet tabs

| Tab | Who writes | What |
| --- | --- | --- |
| `Signups` | app | One row per pick: `date`, `position`, `status`, `expires_at`, `drop_at`, `reminded`, `seed_key`. |
| `Batches` | app | One row per submission: the one email that asks YES or NO about all its picks. `emailed` / `texted` = the status last sent. |
| `Emails` | owner, imports, app | The one approved email (and mobile) on file per player, plus requests waiting for the club (`status` `pending`) and old rows (`replaced`, `declined`). |
| `People` | app | Everyone who signed up, by email; the mobile on file and text opt-in (`texts`). |
| `Training` | owner and the seed import | Who may take Desk organizer (`keys` and `open` = yes), Money collector (`front_desk` = yes) and Lock-up (`keys` = yes). Backups need no training: a backup spot is where someone learns alongside the primary. |
| `Closures` | owner | `date` (`2026-11-13` or `11/13/2026`) and a short public `note`. |
| `SeedLinks`, `SeedReport` | owner / import | The seed import's fix-up loop (section 6). |
| `MemberEmailReport` | import | What `importMemberEmails` added, kept and could not match (full names; private). |
| `Log` | app | One row per email/text sent, reply read, step or error. Recipients are codes; never an address or number. |

## 4. How a sign-up moves

| `Signups.status` | Meaning | Who acts | Public calendar |
| --- | --- | --- | --- |
| `pending` | Submitted; holds its slot. One email, subject *Please confirm your CTTC volunteer nights [CTTC shift …]*, lists every pick. | **Volunteer** replies YES (all), NO (all) or YES except some dates, or unticks nights on **My nights**. | Name, "waiting to confirm" |
| `confirmed` | YES received. *You are on the CTTC staff schedule*. Reminder the day before (from 9 AM). | Nobody | Name |
| `released` | NO received, or the night was left out of a YES (typed "YES except", or unticked on My nights). | Nobody | Open again |
| `expired` | No YES by the deadline: 24 hours after submitting, but never later than **1 hour before the earliest picked night**. The open/close list's first wave (section 6) is held a flat **72 hours** instead. *…expired*. | Nobody | Open again (at once, even before the sweep writes it) |
| `dropped` | The volunteer unticked a confirmed night on **My nights** and tapped Save, or pressed "This is me: drop this shift" on a confirmed slot and replied YES to *Drop your CTTC shift? [CTTC shift …]* (open 48 hours, sent at most once per 10 minutes). The volunteer and the club are emailed (one email listing every drop of one Save), and if a primary desk organizer or money collector dropped, that night's confirmed backup gets a heads-up. | Nobody | Open again |

**Some nights but not all.** Someone signed up for many nights (every
Wednesday, say, or a whole roster from the seed import) can leave out just the
nights they can't do, without losing the rest:

- **My nights page.** Every email about someone's shifts (the confirm email's
  blue *Yes, except some nights* button, the confirmation, the reminder and
  the drop notice) links to `concordtabletennisclub.com/?mine=CODE`. The home
  page opens the app straight at a "Your nights" list (and takes the code out
  of the address bar, so a copied home page link never carries it): every
  upcoming night ticked, marked *waiting* or *confirmed*; a night with two
  shifts has a box per shift. Untick, tap **Save**: ticked waiting nights are
  confirmed, unticked waiting ones released, unticked confirmed ones dropped.
  A sign-up with nothing left waiting is answered, so its confirmation email
  lists what was confirmed and, under *Left out, as you asked*, what was not.
  The code is made with the app's secret from the address on file (20
  characters), is the same in every email, and only works for that person's
  upcoming nights: having the link is like replying from their address, so it
  only ever goes to the email on file. A link with no upcoming nights says
  so; a page left open is safe (nights that changed since are skipped).
- **Typed reply.** *YES except Nov 4 and 18*, *Yes to all but not 11/4,
  12/2*, or the dates on the next lines. Every date must be one of the nights
  in that email and every word part of a date (or *and*, *or*, a weekday):
  then the rest are confirmed and the named nights released. Anything else
  (*yes except when it rains*, *yes except Wednesdays*, a date not in the
  email) **changes nothing**, and the sender is told once, with their nights
  and their My nights link. A plain YES is never read from such a reply.
  By text the same works as *CONFIRM except Nov 4*.

**Late YES.** A YES that arrives after the hold expired (up to 3 days later)
confirms whichever picks are still free, checked exactly like a new sign-up;
the confirmation email lists the ones that were no longer free. If none is
free, the person is told it expired.

**Rules enforced on the server** (the page checks them too, but only the
server counts): the night is a club night in the horizon, not closed, not too
late; the person may take the position (`canTake_`: directory, training,
mode); capacity; one opening position and one closing spot per person per
night; one finalizer per night; at most 40 picks per submission and 3
submissions waiting per email address. A submission is all or nothing: if any
pick fails, nothing is saved and the page marks each failing pick with its
reason.

**Replies.** Only a reply quoting the `[CTTC shift …]` code, from the same
address the question went to, counts; auto-replies are ignored, a reply from
another address gets a "reply from the right address" email, an unreadable
reply gets "we could not read your reply" (and "Yes, but…", "Yes except…" are
never read as a plain YES, nor "No for Oct 19 and Nov 2" as a NO to every
night: a NO that names dates changes nothing and the sender is told how to
leave out only some nights).

**The club corrects an answer.** When someone answers in words the app cannot
apply (say, a NO and then "yes to all those Mondays except Oct 19 and Nov 2"),
the setup page's **Correct a volunteer's answer** lists the sign-ups answered
NO or left to expire in the last 7 days with nights ahead. Open one, tick the
nights they asked to keep and confirm: each is checked again like a new
sign-up (someone may have taken it meanwhile), the rest are left out, and the
volunteer gets the usual confirmation email listing both. Only the club
account can open it, and a second tap changes nothing. The coaching app uses a different
tag (`[CTTC ref …]`), so neither app reads the other's replies.

**Texts (optional).** The public form takes no phone (it could be anyone's).
A volunteer whose mobile is **on file** (`Emails.phone`: typed by the owner, or
from the coaching app's Sheet during the seed import) **and** who texted
`STAFF` to the club's Google Voice number from it also gets the question by text: "Reply CONFIRM
to lock in … or RELEASE to cancel". The coaching app reads the same number and
takes a bare YES or NO from its own people as an answer, so staffing texts use
words coaching ignores. `STOP` turns staffing texts off silently (coaching
already answers STOP). Drops are by email only.

## 5. Emails on file, and approving a new one

- After someone picks a name, the page asks `playerAccess`, which returns the
  positions they may take and their email on file **masked**. The page then
  says "We'll email s•••@gmail.com to confirm. Not your address? Ask the club."
  and shows no email field. `signUp` ignores any email or phone the page
  sends and writes **only** to the email on file. Picking someone else's name
  just sends them an email they can ignore.
- At most one `approved` row per player: a newer approval marks the older row
  `replaced` (the hourly sweep tidies rows the owner typed). Imports never
  replace a row the owner typed; a SeedLinks fix replaces an earlier import;
  otherwise the first email found stays.
- Drops, reminders, backup heads-ups and closure notices go to the email on
  file **now**, so changing it later moves them to the new address.

**No email on file.** The page says "We don't have an email for you yet. Enter
it and the club will confirm it once; then we'll email you to confirm your
shifts." On sending, the picks are saved as a **request** (`Batches.status =
awaiting_club`, `Signups.status = requested`, an `Emails` row `pending`). A
request **holds nothing**. The club (`ADMIN_EMAIL`) gets one email, *Approve an
email for staff sign-ups [CTTC shift …]*: "<full name> wants to use <email> …
Reply YES to approve or NO to decline." Only a reply from `ADMIN_EMAIL` counts.

- **YES** (or the owner sets that `Emails` row's `status` to `approved`; picked
  up within a minute): the address becomes the email on file (`source =
  approved-request`), the picks still free become normal pending holds, and the
  person gets the normal confirmation email (their own YES is still needed),
  which lists any picks taken meanwhile. If none is free they are told so.
- **NO** (or `status` set to `declined`, or no answer in 7 days): nothing was
  held; the typed address is told once that the club couldn't confirm it.
- Limits: one open request per player and per email address, and at most 10
  open in all (then the page says "Please ask the club to add your email").

## 6. Importing the volunteer's open/close list (`importSeedSheet`)

**This is a one-time import.** The club's earlier open/close list is read once,
when Send is tapped on the preview (or `importSeedSheet` is run), and never
again: the script property `SEED_IMPORTED_AT` records when, and afterwards the
preview, Send, test copy and Prepare SeedLinks all say so instead (re-sending
to people still waiting keeps working, since it uses only this app's data).
From then on the club maintains only this app's private Sheet: training in
`Training`, emails in `Emails`, and volunteers sign up on the calendar
themselves (Repeat weekly helps); there is no standing weekly schedule.
**The first wave is held 72 hours** (`SEED_HOLD_MS`), not the usual 24 hours
capped an hour before the earliest night, so the club can remind people in
person on the next club nights: their nights show as "waiting to confirm"
(even a night that comes and goes meanwhile) until they answer. A re-send
gives a fresh 72 hours. The
`SeedLinks`, `SeedReport` and `SeedPlayers` tabs are not used after the
import. A maintainer can delete `SEED_IMPORTED_AT` to allow one more import.

The volunteer's Sheet has a tab `Open/Close` with a roster block (header row
with **Open** and **Front Desk**, one row per weekday holding first names; two
names in a cell may be split by a line break, `/`, `,`, `&` or "and") and a
**Training list** block (**Keys Access**, **Open**, **Front Desk** columns:
Yes, or No / N/A = not trained). `parseSeed_` finds both by these labels, not
by row numbers, and ignores everything else (the duty checklists). Unknown
roster columns are only counted. **Prepare SeedLinks** on the preview
(`&import=links`) adds a SeedLinks row for every name to fix (no player, more
than one, or no email) and refreshes the player dropdown, holding and sending
nothing, so emails can be filled in before Send.

Run **`importSeedSheet`** from the editor (after `setup`). It:

1. Links each sheet name to **one** active desk player: a filled `SeedLinks`
   row first; then the exact full name (case and spacing don't matter) or a
   desk `Aliases` row; then a first name that only one active player has.
   Ambiguous or unmatched names are skipped, never guessed.
2. Writes the training list to `Training`: it adds people it can link and fills blank cells, but never changes a value already in the tab, so the **Training tab is where the club manages training** (an edit there survives every later import).
3. Finds each linked person's email: their `SeedLinks` email, else the latest
   desk `ZeffyPayments` row under their display name or an alias, else the
   coaching app's `Coaches` / `Students` (if `COACHING_DB_ID` is set; these may
   also give a mobile). What it finds is **written to the Emails tab** as
   approved (`source` seedlinks, zeffy or coaching), never over a row the owner
   typed. Holds use the email on file. With none, their training still imports
   but their nights are skipped.
4. Makes the normal **pending** holds from the roster columns: **Open** is
   Desk organizer, **Front Desk** Money collector, **Barriers** and **Setup**
   Table/barrier setup, **Close** Lock-up, **Takedown** Put tables and barriers
   away; **RR Admin** is read but adds nothing (it is the desk organizer). In a
   one-person position a second name is the backup; in Setup or Takedown every
   name takes a spot ("Ryan/Peggy" is two people). Each is held on every
   matching weekday in the calendar
   (not closures, not past), checked by the normal rules (an untrained person
   or a taken slot is skipped). Each person gets the normal single
   confirmation email; nothing is confirmed until they reply YES.
5. Rewrites `SeedReport` (counts per reason, and each name to fix with up to 5
   candidate players by full name) and adds a blank `SeedLinks` row for each
   such name, with a dropdown of active players in `player_name`.

**Fix-up loop (before sending):** use Prepare SeedLinks, fill the matching
`SeedLinks` rows (pick the player in `player_name`, a `player_id` also works,
and/or type an `email`), and check the preview again until it is right, then
Send. (If a maintainer reopens the import, a re-run works the same way.) Re-runs never hold or email the same
pick twice (`seed_key`), so only newly resolved people are emailed. The
return value and execution log hold counts and the sheet's own first names
(plus last initial) only.

Two names for the same weekday and position (for example "Ron" and "Susan" on
separate lines under Front Desk) are the primary and the backup: the first name
gets Money collector, the second Money collector backup (Desk organizer and
its backup under Open). A third name has no slot and is ignored. Each still
needs the training for that position.

## 7. The membership list's emails (`importMemberEmails`)

Set `MEMBER_LIST_ID` to the 2026 membership list (a Sheet, or a Doc with a
table) and run **`importMemberEmails`** from the editor. `memberRow_` is the
only code that knows its columns, found by header name: a name column
(`Name`, `Member`, `Player`) or `First name` + `Last name`, and an `Email` /
`E-mail` column. A household row may list several names and emails (split on
`,` `;` `/` `&`, "and" or a line break); they are paired only when the counts
match one to one ("Ivo & Jan" + "Bly" are Ivo Bly and Jan Bly), otherwise the
row is reported. Each name is linked to one active desk player like the seed
import (exact full name, a desk alias, or a first name only one active player
has when the list gives just a first name); nothing is guessed. Emails go on
file as `member-list`, never over an owner or SeedLinks row or an email
already on file. `MemberEmailReport` lists what was added, kept, and every
name it could not match (with candidates). Safe to run again.

## 8. Closed nights

The main source is the home page's **`data/closures.json`** (edit that file in
the repository; the home page and this app both read it). The app fetches it
at most once an hour and keeps the last good copy, so a site outage or a
broken file never reopens a closed night. Per date:

- `full`: closed. Not offered, shown as Closed, no "needs people", not counted,
  no reminders.
- `partial` / `holiday`: open and still need volunteers. The night shows a
  short note: the home page notice that mentions that date, else "Reduced play
  area, 10 tables max" / "Open on holiday".

The private **Closures** tab is an extra, owner-only way to close a night;
both count. If a night that already has confirmed sign-ups becomes closed, the
hourly sweep cancels them (`status = cancelled`, `cancelled_by = closure`),
emails each person once ("The gym is closed on …; your … shift is cancelled.
Thank you!") and sends the club one summary. Pending picks on that night are
just released.

## 9. Directory and hybrid mode

`SIGNUP_MODE` = `directory` (default): only names from the desk's player list
can sign up; the page has no "I'm not listed" choice. Set the script property
to `hybrid` to switch it on (no code change, no redeploy needed):

- The page offers "I'm not listed"; the person types their name.
- They may take Table setup and Closing straight away.
- Desk organizer and Money collector still need training. The first time they
  try, the app adds a `Training` row with **their email in `player_id`** and
  emails the club. Type `yes` in the right columns and they can sign up from
  then on with that email.

All of this lives in `canTake_`; tests cover both modes.

## 10. Where it can get stuck

| Symptom | Check |
| --- | --- |
| Name search says the list is not available | `DESK_SHEET_ID` set, the desk Sheet shared with the club account, a `Players` tab with `player_id`, `display_name`, `active`. Changes to the list show within 10 minutes (cache). |
| A volunteer never got the confirm email | `Batches.emailed` is empty while `status = pending`: the send failed or the daily quota ran out; the hourly sweep retries for 3 days. The `Log` tab shows `email batch:pending` once it went. |
| They replied "YES except …" and nothing changed | A date was not among that email's nights or a word was not a date; they were emailed *We could not read the dates in your reply* with their My nights link. |
| Someone answered NO (or let it expire) but meant some nights | Setup page, **Correct a volunteer's answer** (within 7 days): tick the nights they asked for. |
| A My nights link says no upcoming nights | Their nights are past or released, or the email on file changed since (the link is made from the address; newer emails carry the new link). |
| They replied YES but it is still pending | Reply came from a different address (they got a notice), or from an auto-reply, or after 3 days. The minute trigger `checkReplies` must exist (Triggers page). |
| A hold disappeared | It expired (`Signups.status = expired`); look at `Batches.expires_at` (ms since 1970, UTC). |
| Desk, Money or Lock-up is greyed out for someone | Their `Training` row: `keys` and `open` must both say yes for Desk, `front_desk` for Money, `keys` for Lock-up. Backups are never greyed out. |
| Someone says the confirmation went to an old address | Their `Emails` row: type the new address as a new `approved` row (`source` owner); the old one becomes `replaced`. |
| A new email request is stuck | `Emails` row `pending`: answer the *Approve an email* message from `ADMIN_EMAIL`, or set `status` to `approved` / `declined`. After 7 days it is declined. |
| A closed night still shows as open | Check `data/closures.json` on the live site (`full` for that date) or add it to `Closures`. Changes show within an hour. |
| No texts | The person needs a mobile **on file** (`Emails.phone`) **and** `People.texts = yes` (they texted STAFF from that phone). |
