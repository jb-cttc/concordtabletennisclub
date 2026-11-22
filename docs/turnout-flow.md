# Tonight page and turnout app

The Tonight page (`tonight.html`, linked from Home and Round Robins) shows
how many people to expect at the next Monday, Wednesday or Saturday round robin,
grouped by rating, as a gym floor: a front desk and one court per rating
zone, each with two tables, a flip-scoreboard tally and a body for each
player. The plain table above the floor carries the same numbers.

## 1. What it shows

| Mark | Meaning | Where it comes from |
| --- | --- | --- |
| Solid body | **Playing tonight**: signed in at the desk | The desk Sheet: `SessionPlayers` rows for tonight's `Sessions` row, at `starting_rating`. |
| Solid body with a green bubble | **Playing tonight**: texted the club today | Forwarded Google Voice texts, collected by the desk's mail reader in the desk Sheet's `VoiceTexts` tab ([One Gmail reader](round-robin-operations.md#one-gmail-reader)), matched to a player by contact name (`Players.display_name`, then `Aliases`). The app never reads Gmail. |
| Ghost body | **Likely**: a regular with a 90% or better chance of coming | `turnout.js` `likelihood()` on the site's `data/session-roster.json`. |
| Chalk spot | **Expected**: the rest of the forecast | The night's total is the usual turnout for that weekday (`expectedTotal`: the last 8 same-weekday nights, recent ones counting most). Everyone playing is in it; the rest is shared out between the zones by each other recent player's chance. |
| Body at the front desk | Playing tonight, but no rating known (an unmatched text, a number with no contact name, a player with a blank rating) | Counted in the **New faces** column. |

Zones: under 600, 600–799, 800–999, 1000–1199, 1200–1399, 1400–1599 and
1600+. The bottom of each range is in it and the top is not.

Each person is counted once, at their firmest status: signed in, then
texted, then likely. People who sign in or text move from the forecast into
"playing tonight" rather than being added on top: the expected number holds
at the night's total until more people are playing than were expected
(`scripts/check-turnout.js` plays out a night to check this).

The "See who's playing tonight" button on the home and Round Robins pages
opens the Tonight page, which belongs to the Round Robins section (its menu
link is highlighted there). A bar at the top leads back: "Back to Home" or
"Back to Round Robins" after a tap on that page's button, working as the
browser's Back does; opened any other way (a shared link, a text), it links to
Round Robins. Coming back by either, `tonight-launch.js` puts the button where
it was on the screen: the home page is built as it loads, so the browser's own
guess at the old position lands well below it.

Beside the button, a box invites a text: "Want to be included? (925) 238-3505 Text us".
Tapping the number always opens Messages with "I'll join CTTC's RR today"
filled in, whatever the day: one plain link, `sms:+19252383505?&body=`, which
iPhone, iPad and Mac Messages read after the `&` and Android after the `?`,
with no script and no check of the clock or the schedule. Only texts sent on
the round robin day itself count. The app counts the text within a minute; no one has
to add it by hand. When the desk's automatic answers are on, the person also
gets a text back within a minute (see
[Automatic answers](round-robin-operations.md#automatic-answers)). A text
that only asks a question ("Is RR on tonight?") is not counted unless it
also says the person is coming ("I'll come"). A text is left out when it is a command for another
app (`COACH`, `STUDENT`, `STOP`, `STAFF`, `CONFIRM`, `RELEASE`, `YES`, `NO`)
or when the sender's latest text that day says they are not coming
("can't make it"). Someone whose text could not be matched and who later
signs in at the desk is counted twice (once at the front desk, once in
their zone) until the next day.

The same text has its own Home Screen icon, **Text CTTC** (`text.html`).
The header's Add to Home Screen button asks which icon to add, CTTC (the
website) or Text CTTC, and shows the steps on the page to be saved. Opened
from its icon, `text.html` goes straight to Messages with the join text
filled in; a phone that wants a tap first gets one big button instead.
Checked on an iPhone on November 4, 2026: one tap on the icon shows the page
for a moment, then Messages opens with the text ready to send, with nothing
else to tap. A later tap while the app is still open in the background does
not load the page again (the phone shows it as it was left), so a page back
on the screen after 2 minutes or more opens Messages again; back sooner
(straight after sending), it stays on the page.

Which night: today while it is a round robin day and the round robin is
still on (before 10 PM Pacific on a Monday or Wednesday, 6 PM on a
Saturday) and the gym is not closed (`data/closures.json`), otherwise the
next such day. After sign-up closes (7:15 PM, or 3:15 PM on Saturday) the
forecast is dropped and only people playing are shown. The days and times
are `NIGHTS` in `turnout.js`; the desk's automatic answers
(`VOICE_REPLY_DAYS`) and Voice signups refresh (`POLL_DAYS` in
`apps-script/Index.html`) keep their own copies, so change all three together.

**The Saturday pilot** (weekly from October 31, 2026) is an afternoon, so the
page says "today" where it says "tonight" on weeknights, and the tap-to-text
fills in "I'll join CTTC's RR today". Saturday's forecast reads only earlier
Saturdays, not Mondays or Wednesdays. Until the first Saturday is published
it has none, so it expects the club's show of hands, 20 players
(`firstExpected`), with no ratings: they wait at the front desk as chalk
spots ("New faces") and move into their zone as they sign in. From the
second Saturday on, the forecast works like any other day's.

**Privacy.** The page is public and says who will be at the gym tonight, so
it shows counts only. The app's answer never contains a name, phone number,
player id or text; `turnout-app/check-turnout-app.cjs` checks this.

## 2. How "likely" is worked out

`likelihood(roster, date)` takes the last 8 nights on the same weekday and
the last 8 on the other round robin weekday. The most recent night counts
fully, and each night before it counts 0.9 times as much as the one after.
The other weekday counts half as much. With one extra night of each kind
added to smooth the estimate (a Beta(1, 1) prior), the share of weighted
nights a player came is their chance.

The score is calibrated: across 2025–2026, players scored 0.7–0.8 came about
77% of the time and those scored 0.9 or more about 90%. Because 90% is
strict, usually only 1 or 2 perfect regulars are flagged a night; the chalk
spots carry the rest of the forecast.

The expected total is not the sum of everyone's chances: that ran about 2
players high on Wednesdays, because Monday's bigger crowd and the many
once-in-a-while players each add a little. The recent same-weekday average
has no such bias and has been off by about 3 players a night. A
same-time-last-year adjustment was tried and made Wednesdays worse (October
Wednesdays averaged about 30 in 2024 but about 24 in 2025). Check the
current figures with:

```sh
npm run turnout:backtest            # from 2025-01-01
npm run turnout:backtest 2026-04-01 # recent nights only
```

The bar is `LIKELY_AT` in `turnout.js`. After changing `turnout.js`, copy it
to `turnout-app/Turnout.js` (`npm test` checks they match), merge, and push
the app again.

## 3. Pieces

| File | Role |
| --- | --- |
| `turnout.js` | Pure logic: zones, the night and phase, likelihood, the tally. Published with the site. |
| `turnout-app/` | Public Apps Script project. `turnout()` answers the counts; `doGet` serves it as JSON. `Turnout.js` is an exact copy of `turnout.js`. `Prepay.js` starts card checkouts for paying ahead (section 7). |
| `tonight.html` | The page. Asks the app every minute (one answer is cached for 60 seconds on Google, so a busy page reads the Sheet about once a minute). |
| `scripts/check-turnout.js`, `turnout-app/check-turnout-app.cjs` | Checks, in `npm test`. |

Until `TURNOUT_URL` is set in `tonight.html`, or whenever the app cannot be
reached, the page shows the forecast from the site's own published files
and says so.

## 4. Setup (owner, once)

Like the coaching and staffing apps this is its own Apps Script project: a
public web app exposes every function in its project, so the desk's code
must never live in it. `check-turnout-app.cjs` asserts that only `doGet`,
`turnout` and `setup` are public and that the code writes nothing but its log
(and paying ahead's daily counter, section 7).

1. Create the project from this folder while signed in to the club account:

   ```sh
   cd turnout-app
   npx --no-install @google/clasp create --type standalone --title "CTTC turnout"
   npx --no-install @google/clasp push
   ```

   Commit the new `.clasp.json` (it holds only the script id).
2. In **Project Settings > Script properties**, set `DESK_SHEET_ID` to the
   id in the desk Sheet's address (the part after `/d/`). The app reads its
   `Players`, `Aliases`, `Sessions`, `SessionPlayers`, `VoiceTexts` and
   `MailReader` tabs by header name and never writes to them.
3. In the editor, run **`setup`** once and grant the permissions. It
   returns how many players and published nights it can read. From the web
   it does nothing.
4. **Deploy > New deployment > Web app**, *Execute as: me*, *Who has access:
   Anyone*. Open the `/exec` URL: it should answer JSON with `"ok": true`.
5. Put the `/exec` URL into `TURNOUT_URL` in `tonight.html` in a pull
   request. The page then shows **Live**.

The released app (project "CTTC turnout", script id in `turnout-app/.clasp.json`):
`https://script.google.com/macros/s/AKfycbyhCXunOPJi54n5HQTTiRuvyTs-pSUvmirVHk7sxqS4WAlxvLmSHfdqCrI0fYimh6dXPQ/exec`

`setup` prints its result to the editor's execution log ("Ready: … players in
the desk Sheet, … published nights"); the Run button shows only what is
logged. Before the owner has run `setup` once and approved its permissions,
the address answers "Access Denied" and the page shows the forecast only.

Scopes: `spreadsheets` (to read the desk Sheet, including the Voice texts the
desk collects), `script.external_request` (to read
`closures.json` and `session-roster.json` from the site, and to start Clover
checkouts), `userinfo.email` (for `setup`'s owner check).

## 5. The turnout log

The app keeps a **CTTC Turnout Logs** tab in the desk Sheet, with the same
columns as the desk's **CTTC Desk Logs** (`at, level, what, session, ref,
detail`). Read it from GitHub: **Actions > Desk log > Run workflow**, with
*log* set to **turnout**.

| what | level | detail |
| --- | --- | --- |
| `text_counted` | step | The zone the texter was counted in (`zone=1000–1199`), or why they wait at the front desk: no contact name, or a contact name that isn't exactly one player |
| `text_skipped` | step | Why the text was left out: says not coming, only asks a question, or only commands for the coaching or volunteer apps |
| `turnout_counts` | step | The totals whenever they change: phase, playing (here and texted), likely, expected |
| `turnout_setup` | step | How many players and published nights `setup` could read |
| `turnout_failed` | error | What went wrong, cleaned of anything personal |
| `texts_not_collected` | error | The desk's mail reader has not read mail for over 45 minutes, so new texts are missing; the page still answers. At most once in 10 minutes |
| `prepay_started` | step | A card checkout started for paying ahead: the fee chosen, the amount and the day's count (`kind=member amount=$10 count=3`). `ref` is `P` and a code for the name, never the name |
| `prepay_failed` | error | Clover refused or could not be reached (`HTTP 401 …`): the player was told to pay at the desk |
| `prepay_not_set_up` | error | `CLOVER_CHECKOUT_TOKEN` or `CLOVER_MERCHANT_ID` is missing from the Script Properties. At most once in 10 minutes |
| `prepay_cap_near` / `prepay_cap_reached` | warn / error | 120 checkouts started today; 150 reached, so paying ahead is off until tomorrow |

A texter appears only as a code in `ref` (`S` and six characters; the same
sender always gets the same code), never a name, number or message. The
page asks every minute, so each line is written once: a text's line once a
day, the counts when they change, the same failure at most once in ten
minutes. The tab keeps the latest 2,000 rows.

## 6. Where it can go wrong

| Symptom | Likely cause |
| --- | --- |
| Page says "Live sign-ins are not showing right now" | `TURNOUT_URL` empty, the app not deployed for *Anyone*, `DESK_SHEET_ID` unset, or the site's JSON unreachable. Open the `/exec` URL directly; failures are logged in the project's **Executions**. |
| Someone who texted is at the front desk, not their zone | Their Voice contact name does not match one desk player. Add an `Aliases` row in the desk Sheet, or fix the contact name in Google Voice. |
| Counts lag the desk by up to a minute | The 60-second cache, plus the desk's own save a moment after each change. |
| "Likely" never appears | Expected: at a 90% bar only near-perfect regulars qualify. See section 2. |

## 7. Paying ahead by card

On a round robin day, until 8:30 PM (or the end of Saturday's round robin, 6
PM, if sooner), a player can pay tonight's fee by card before they arrive.
It starts as a **pilot** (November 2026), kept quiet on purpose: the **Want to
be included?** box on the home and Round Robins pages has a small **PILOT Or
pay ahead by card** link (shown only while paying ahead is open; on the home
page it opens **Pay now: Venmo or Zelle** under Fees with the card open, as
the **Pay in advance** tip does), so does the text page (seen after sending the
text), and the pay page (`pay.html`, and **Pay now** under Fees on the home
page) has an outlined **PILOT Pay ahead by card** option below Venmo and
Zelle, with *We're trying out paying online before you arrive. If anything
looks off, pay at the desk as usual.* On other days it is not shown at all.

1. The player chooses who's playing (Member, Visitor, First visit, Under 18,
   or the night's special), as for Venmo.
2. They pick their name from the club's published player list
   (`data/player-index.json`, the desk's directory as the site last
   published it), or type it with **Not in the list? I'm new**. The page
   remembers it on that phone for next time.
3. They check what they are paying (name, fee, night) and press **Pay $10 by
   card**. The page sends the name, the fee, today's date and the amount
   shown to this app (`?prepay=1`).
4. `Prepay.js` checks it: a round robin day the gym is open, before 8:30 PM,
   the page's date is today, and the amount is the price it works out itself
   from the desk's fees (`PREPAY_FEES`, checked against
   `apps-script/NightFees.js`). Anything else is refused with a short reason,
   and the page says so. Then it asks Clover's Hosted Checkout
   (`api.clover.com/invoicingcheckoutservice/v1/checkouts`) for a checkout
   with the name as the customer and one line, *CTTC round robin, Mon Nov 23*,
   noted with the fee and the name, and answers only Clover's page address.
5. The player pays on Clover's page (no card number reaches the site or
   Google) and Clover sends them back to `pay.html?paid=<date>`: *Paid for
   tonight by card. Just check in at the desk*, with a link to text the club
   so they count on the Tonight page. Cancelled or declined, the page says
   nothing was charged.
6. The desk's Clover section reads the payment with every other Clover
   payment and matches it by the checkout's customer name and the amount
   (`docs/clover-payments.md`): a player who paid ahead shows **Credit ✓** as
   soon as they are signed in. A wrong fee (a visitor who chose Member), or a
   name the desk cannot place, waits for the organizer like any payment.

The page never learns whether a name is in the directory or what anyone's
status is: the app does not look names up, and the desk checks the amount.

**Setup (owner, done November 2026).** In this project's **Project Settings
> Script properties**: `CLOVER_CHECKOUT_TOKEN`, the Clover Ecommerce private
token made with the **Hosted checkout** integration type, and
`CLOVER_MERCHANT_ID`, the same merchant id the desk uses. In the Clover
dashboard, under **Settings > Ecommerce > Hosted Checkout**, leave the
**Redirect URLs** blank: set there, they replace the app's and players do not
come back to the pay page. If the token leaks, delete it on Clover's
Ecommerce API Tokens page, make a new one and replace the property.

**Limits.** One web call to Clover per checkout started. At most 150 a day
(`PREPAY_COUNT_<date>` in the Script Properties, earlier days removed), with
`prepay_cap_near` in the log at 120 (`docs/google-limits.md`). A checkout
page lasts 15 minutes; one never paid costs nothing.

| Symptom | Likely cause |
| --- | --- |
| *Card payment is not available right now* | `prepay_not_set_up` or `prepay_failed` in the log: the properties, the token (401) or Clover itself. |
| No Card button on a round robin day | After 8:30 PM, a closed night in `closures.json`, or the page could not read `closures.json` (then the button shows and the app decides). |
| A player who paid ahead is not Credit ✓ | The name they picked or typed is not exactly one player (or alias), or the fee they chose is not theirs: the payment is waiting in the desk's Clover section. |
