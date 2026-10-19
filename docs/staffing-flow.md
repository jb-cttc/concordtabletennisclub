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
- Each night has: **Desk organizer** (the opener: first in at 6:40 PM, key
  lockbox, doors, side door, storage room, lights and AC) plus a backup;
  **Money collector (Front Desk)** (Revenue Sheet, Clover device, Zelle QR
  codes, records everyone entering) plus a backup; **Table setup** (1 to 4);
  **Closing** (2 to 6, putting tables away; one closer may tick "I'll also do
  the desk's Finalize step").
- One person takes only **one opening position per night** (a backup counts).
  The same person may open and close.
- **Night status**, from *confirmed* sign-ups only:
  - **Needs people** (`!`): no confirmed desk organizer, money collector or
    table setup, or fewer than 2 closers.
  - **Covered** (`✓`): every minimum met, but a backup is still open.
  - **Fully staffed** (`★`): every minimum and **both backups** confirmed.
    Extra table setup and closing spots stay optional and are still shown as
    open spots. (We chose this over "every one of the 14 slots" because 4
    setters and 6 closers would almost never all be filled.)
  - **Closed** (`×`): the date is in the Closures tab.
- The page shows **first names only** ("Sam", or "Sam K." when two different
  people that night share a first name). It never shows emails, phones or
  last names. Pending picks show as "waiting to confirm".

## 2. Setup (owner, once)

1. Create a new Apps Script project (script.google.com, signed in as the club
   account) named *CTTC staffing*, and copy in `Code.js`, `Index.html` and
   `appsscript.json` (or `clasp create` in `staffing-app/` and `clasp push`;
   `.claspignore` keeps the test out). The project needs its own
   `.clasp.json`, which is not in the repo yet.
2. **Project Settings > Script properties**:

   | Property | Required | What |
   | --- | --- | --- |
   | `DESK_SHEET_ID` | yes | The id in the desk Sheet's address (the part after `/d/`). The app reads its `Players` tab (`player_id`, `display_name`, `active`, matched by header name; active rows only), and for the seed import its optional `Aliases` (`alias`, `player_id`) and `ZeffyPayments` (`payer_name`, `payer_email`) tabs. It never writes to it. |
   | `ADMIN_EMAIL` | no | Who hears about drops, failures and approval requests. Default: the club account. |
   | `SIGNUP_MODE` | no | `directory` (default) or `hybrid`. See section 6. |
   | `SEED_SHEET_ID` | for the import | The volunteer's open/close Sheet. |
   | `SEED_SHEET_TAB` | no | Its tab; default `Open/Close`. |
   | `COACHING_DB_ID` | no | The coaching app's **private** Sheet id, used only by the seed import to find emails (`Coaches`, `Students`). |
   | `STAFFING_DB_ID`, `TOKEN_SECRET`, `HEADERS` | set by the app | Don't edit. |

3. In the editor, run **`setup`** once and grant the permissions. It creates
   the private Sheet (its address is logged), the hourly `sweep` trigger and
   the minute-by-minute `checkReplies` trigger, and logs how many active
   players it can read. It is safe to run again; from the web page it does
   nothing.
4. Fill the **Training** tab (or let the seed import do it, section 5): one
   row per trained player, `player_id`, `name`, then `yes`/`no` in `keys`,
   `open` and `front_desk`.
5. **Deploy > New deployment > Web app**, *Execute as: me*, *Who has access:
   Anyone*. Put the `/exec` URL into `APP_URL` in `index.html` (the
   "Volunteer signups" block); the button stays hidden until then. The app
   posts `cttc-staffing-ready` and `{type: 'cttc-staffing-height', height}`
   to the page so the frame grows with it.

Every function without a trailing `_` in `Code.js` can be called by anyone on
the internet. `check-staffing.cjs` asserts the exact list: `doGet`,
`staffBoard`, `findPlayers`, `playerAccess`, `signUp`, `requestDrop` (the
page), `setup`, `importSeedSheet` (owner only; they refuse to run unless the
person running them is the owner), `sweep` and `checkReplies` (triggers).

## 3. Private Sheet tabs

| Tab | Who writes | What |
| --- | --- | --- |
| `Signups` | app | One row per pick: `date`, `position`, `status`, `expires_at`, `drop_at`, `reminded`, `seed_key`. |
| `Batches` | app | One row per submission: the one email that asks YES or NO about all its picks. `emailed` / `texted` = the status last sent. |
| `People` | app | Everyone who signed up, by email; mobile and text opt-in (`texts`). |
| `Training` | owner and the seed import | Who may take Desk (`keys` and `open` = yes) and Money (`front_desk` = yes). |
| `Closures` | owner | `date` (`2026-11-13` or `11/13/2026`) and a short public `note`. |
| `SeedLinks`, `SeedReport` | owner / import | The seed import's fix-up loop (section 5). |
| `Log` | app | One row per email/text sent, reply read, step or error. Recipients are codes; never an address or number. |

## 4. How a sign-up moves

| `Signups.status` | Meaning | Who acts | Public calendar |
| --- | --- | --- | --- |
| `pending` | Submitted; holds its slot. One email, subject *Confirm your CTTC staff sign-up [CTTC shift …]*, lists every pick. | **Volunteer** replies YES (all) or NO (all). | Name, "waiting to confirm" |
| `confirmed` | YES received. *You are on the CTTC staff schedule*. Reminder the day before (from 9 AM). | Nobody | Name |
| `released` | NO received. *…is cancelled*. | Nobody | Open again |
| `expired` | No YES by the deadline: 24 hours after submitting, but never later than **1 hour before the earliest picked night**. *…expired*. | Nobody | Open again (at once, even before the sweep writes it) |
| `dropped` | The volunteer pressed "This is me: drop this shift" on a confirmed slot and replied YES to *Drop your CTTC shift? [CTTC shift …]* (open 48 hours, sent at most once per 10 minutes). The club is emailed, and if a primary desk organizer or money collector dropped, that night's confirmed backup gets a heads-up. | Nobody | Open again |

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
reply gets "we could not read your reply". The coaching app uses a different
tag (`[CTTC ref …]`), so neither app reads the other's replies.

**Texts (optional).** A volunteer who gave a mobile **and** texted `STAFF` to
the club's Google Voice number also gets the question by text: "Reply CONFIRM
to lock in … or RELEASE to cancel". The coaching app reads the same number and
takes a bare YES or NO from its own people as an answer, so staffing texts use
words coaching ignores. `STOP` turns staffing texts off silently (coaching
already answers STOP). Drops are by email only.

## 5. Importing the volunteer's open/close list (`importSeedSheet`)

The volunteer's Sheet has a tab `Open/Close` with a roster block (header row
with **Open** and **Front Desk**, one row per weekday holding first names; two
names in a cell may be split by a line break, `/`, `,`, `&` or "and") and a
**Training list** block (**Keys Access**, **Open**, **Front Desk** columns:
Yes, or No / N/A = not trained). `parseSeed_` finds both by these labels, not
by row numbers, and ignores everything else (the duty checklists). Unknown
roster columns are only counted.

Run **`importSeedSheet`** from the editor (after `setup`). It:

1. Links each sheet name to **one** active desk player: a filled `SeedLinks`
   row first; then the exact full name (case and spacing don't matter) or a
   desk `Aliases` row; then a first name that only one active player has.
   Ambiguous or unmatched names are skipped, never guessed.
2. Writes the training list to `Training` (updated in place by `player_id`).
3. Finds each linked roster person's email: their `SeedLinks` email, else the
   latest desk `ZeffyPayments` row under their display name or an alias, else
   the coaching app's `Coaches` / `Students` (if `COACHING_DB_ID` is set). With
   no email their training still imports but their nights are skipped.
4. Makes the normal **pending** holds: Open becomes Desk organizer, Front
   Desk becomes Money collector, on every matching weekday in the calendar
   (not closures, not past), checked by the normal rules (an untrained person
   or a taken slot is skipped). Each person gets the normal single
   confirmation email; nothing is confirmed until they reply YES.
5. Rewrites `SeedReport` (counts per reason, and each name to fix with up to 5
   candidate players by full name) and adds a blank `SeedLinks` row for each
   such name, with a dropdown of active players in `player_name`.

**Fix-up loop:** open `SeedReport`, fill the matching `SeedLinks` rows (pick
the player in `player_name`, a `player_id` also works, and/or type an
`email`), run `importSeedSheet` again. Re-runs never hold or email the same
pick twice (`seed_key`), so only newly resolved people are emailed. The
return value and execution log hold counts and the sheet's own first names
(plus last initial) only.

Two names for the same weekday and position (for example "Ron" and "Susan" on
separate lines under Front Desk) are the primary and the backup: the first name
gets Money collector, the second Money collector backup (Desk organizer and
its backup under Open). A third name has no slot and is ignored. Each still
needs the training for that position.

## 6. Directory and hybrid mode

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

## 7. Where it can get stuck

| Symptom | Check |
| --- | --- |
| Name search says the list is not available | `DESK_SHEET_ID` set, the desk Sheet shared with the club account, a `Players` tab with `player_id`, `display_name`, `active`. Changes to the list show within 10 minutes (cache). |
| A volunteer never got the confirm email | `Batches.emailed` is empty while `status = pending`: the send failed or the daily quota ran out; the hourly sweep retries for 3 days. The `Log` tab shows `email batch:pending` once it went. |
| They replied YES but it is still pending | Reply came from a different address (they got a notice), or from an auto-reply, or after 3 days. The minute trigger `checkReplies` must exist (Triggers page). |
| A hold disappeared | It expired (`Signups.status = expired`); look at `Batches.expires_at` (ms since 1970, UTC). |
| Desk or Money is greyed out for someone | Their `Training` row: `keys` and `open` must both say yes for Desk, `front_desk` for Money. |
| A closed night still has people on it | Adding a date to `Closures` after people signed up does not tell them; the app only stops reminders and new sign-ups. Email them yourself. |
| No texts | The person needs a mobile in `People` **and** `texts = yes` (they texted STAFF from that phone). |
