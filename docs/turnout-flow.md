# Tonight page and turnout app

The Tonight page (`tonight.html`, linked from Home and Round Robins) shows
how many people to expect at the next Monday or Wednesday round robin,
grouped by rating, as a gym floor: a front desk and one court per rating
zone, each with two tables, a flip-scoreboard tally and a body for each
player. The plain table above the floor carries the same numbers.

## 1. What it shows

| Mark | Meaning | Where it comes from |
| --- | --- | --- |
| Solid body | **Playing tonight**: signed in at the desk | The desk Sheet: `SessionPlayers` rows for tonight's `Sessions` row, at `starting_rating`. |
| Solid body with a green bubble | **Playing tonight**: texted the club today | Forwarded Google Voice texts in the club's Gmail, matched to a player by contact name (`Players.display_name`, then `Aliases`). |
| Ghost body | **Likely**: a regular with a 90% or better chance of coming | `turnout.js` `likelihood()` on the site's `data/session-roster.json`. |
| Chalk spot | **Expected**: the rest of the forecast | Everyone playing, plus each other recent player's chance, rounded per zone. |
| Body at the front desk | Playing tonight, but no rating known (an unmatched text, a number with no contact name, a player with a blank rating) | Counted in the **New faces** column. |

Zones: under 600, 600–799, 800–999, 1000–1199, 1200–1399, 1400–1599 and
1600+. The bottom of each range is in it and the top is not.

Each person is counted once, at their firmest status: signed in, then
texted, then likely. A text is left out when it is a command for another
app (`COACH`, `STUDENT`, `STOP`, `STAFF`, `CONFIRM`, `RELEASE`, `YES`, `NO`)
or when the sender's latest text that day says they are not coming
("can't make it"). Someone whose text could not be matched and who later
signs in at the desk is counted twice (once at the front desk, once in
their zone) until the next day.

Which night: today while it is a Monday or Wednesday before 10 PM Pacific
and the gym is not closed (`data/closures.json`), otherwise the next such
night. After sign-up closes at 7:15 PM the forecast is dropped and only
people playing are shown.

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
spots carry the rest of the forecast. The expected total has been off by
about 4 players a night. Check the current figures with:

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
| `turnout-app/` | Public Apps Script project. `turnout()` answers the counts; `doGet` serves it as JSON. `Turnout.js` is an exact copy of `turnout.js`. |
| `tonight.html` | The page. Asks the app every minute (one answer is cached for 60 seconds on Google, so a busy page reads the Sheet and Gmail about once a minute). |
| `scripts/check-turnout.js`, `turnout-app/check-turnout-app.cjs` | Checks, in `npm test`. |

Until `TURNOUT_URL` is set in `tonight.html`, or whenever the app cannot be
reached, the page shows the forecast from the site's own published files
and says so.

## 4. Setup (owner, once)

Like the coaching and staffing apps this is its own Apps Script project: a
public web app exposes every function in its project, so the desk's code
must never live in it. `check-turnout-app.cjs` asserts that only `doGet`,
`turnout` and `setup` are public and that the code makes no writes.

1. Create the project from this folder while signed in to the club account:

   ```sh
   cd turnout-app
   npx --no-install @google/clasp create --type standalone --title "CTTC turnout"
   npx --no-install @google/clasp push
   ```

   Commit the new `.clasp.json` (it holds only the script id).
2. In **Project Settings > Script properties**, set `DESK_SHEET_ID` to the
   id in the desk Sheet's address (the part after `/d/`). The app reads its
   `Players`, `Aliases`, `Sessions` and `SessionPlayers` tabs by header name
   and never writes to them.
3. In the editor, run **`setup`** once and grant the permissions. It
   returns how many players and published nights it can read. From the web
   it does nothing.
4. **Deploy > New deployment > Web app**, *Execute as: me*, *Who has access:
   Anyone*. Open the `/exec` URL: it should answer JSON with `"ok": true`.
5. Put the `/exec` URL into `TURNOUT_URL` in `tonight.html` in a pull
   request. The page then shows **Live**.

Scopes: `spreadsheets` (to read the desk Sheet), `mail.google.com` (to read
forwarded Voice texts; it never replies), `script.external_request` (to read
`closures.json` and `session-roster.json` from the site), `userinfo.email`
(for `setup`'s owner check).

## 5. Where it can go wrong

| Symptom | Likely cause |
| --- | --- |
| Page says "Live sign-ins are not showing right now" | `TURNOUT_URL` empty, the app not deployed for *Anyone*, `DESK_SHEET_ID` unset, or the site's JSON unreachable. Open the `/exec` URL directly; failures are logged in the project's **Executions**. |
| Someone who texted is at the front desk, not their zone | Their Voice contact name does not match one desk player. Add an `Aliases` row in the desk Sheet, or fix the contact name in Google Voice. |
| Counts lag the desk by up to a minute | The 60-second cache, plus the desk's own save a moment after each change. |
| "Likely" never appears | Expected: at a 90% bar only near-perfect regulars qualify. See section 2. |
