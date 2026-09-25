# Round-robin data and operations

## Systems

- **Public site** (GitHub Pages, `concordtabletennisclub.com`). Reads committed
  `data/*.json`. Before cutover, the scheduled workflow scrapes the club's
  Drive session reports (`scripts/fetch-and-parse.js`). After cutover
  (`CTTC_LIVE_START_DATE` set), it publishes finalized sessions from the
  private Google Sheet instead (`scripts/publish-finalized-sessions.js`).
- **Owner desk** (`apps-script/`, Google Apps Script bound to the round-robin
  Sheet, deployed for the club account only). Rosters, groups, scores, Open
  Play, payments, membership, and Voice signups. Push with
  `npx --no-install @google/clasp push` from `apps-script/`, then create a
  version and redeploy the existing `/exec` deployment.

The jb-cttc repository is a staging copy. The workflow runs only in
`Latkecrszy/concordtabletennisclub` or where the repository variable
`CTTC_DEPLOY_ENABLED` is `true`, so neither jb-cttc nor any fork can deploy
the site or email members alongside the live repository.

## Ratings

Until cutover, the club's session reports are the rating authority.
`RatingSync.js` pulls `data/players.json` from the live site hourly (and each
time the desk loads) and updates `Players.current_rating` for exact name or
`Aliases` matches, then records the latest posted session date as
`CTTC_RATINGS_SYNCED_THROUGH`. The site publishes Mon/Wed around 10:30 PM PT
(8 AM fallback), so ratings are current within an hour. Consequences:

- Finalizing a desk session dated on or before that date is refused, since
  those matches are already counted in the club's results.
- Finalizing is also off entirely until go-live; see the checklist below.
- Saving a draft refreshes every starting rating to the current rating, and
  finalizing is refused if a rating changed after the last save.
- Once the desk has finalized a session newer than the site's latest, the
  sync stops overwriting ratings; the desk is then the authority.

Install once from the Apps Script editor by running `enableRatingSyncTrigger`
(in `RatingSync.gs`) and approving the external-request and trigger
permissions. `ratingSyncStatus` reports the installed trigger and last check.

## Groups, promotions, scoring, printing

`apps-script/Organizer.html` holds the rules, tested by `check-organizer.cjs`:

- Groups of 5 or 6 by rating; the desk flags any group outside that range.
- Promotions: each winner (except Group 1) of the previous session on the same
  weekday, read from the public site, is guaranteed one group above the group
  they won, swapping with the lowest-rated non-winner there. A winner already
  rated into that group or higher is left alone. Promotions are saved per
  player (`SessionPlayers.promotion_from_group`).
- Once groups are saved or moved by hand, late arrivals are slotted in by
  rating rank without reshuffling anyone, and promoted players are never
  bumped down. **Rebuild by rating** resets groups and reapplies promotions.
- Matches follow a rotation schedule so a 6-player group uses three tables
  per round. Live standings show W-L, games, and projected rating; a group
  winner is marked once all its matches are complete.
- **Print groups** and **Print sheets** produce the group list and one
  tournament sheet per group (club rating and record, instructions, match
  schedule with expected/upset points).

Winner rule: best match-win ratio; ties go to the lower starting rating, then
name. `standings.js` implements it for the site and emails.
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

A link applies only when each name matches exactly one active player;
otherwise it is listed as needing a directory match. Other players default to
V; a `MemberStatus` row or a badge click makes them M.

Keep member-specific data (links, payments, dues, Zeffy passes, contact
details) in the Sheet, and use made-up names in tests.

## Session fees and Zeffy

Members and visitors pay a per-session fee ($10 or $15), recorded per date in
`SessionPayments` as Venmo, Zelle, or Cash. **Zeffy** is an optional monthly
play pass that covers every session fee for the month; holders are listed in
`ZeffyPasses` by player ID and show a locked **Zeffy ✓** on every date. Zeffy is
not a membership payment: `MembershipDues` records only the membership year.
Archived players keep their pass and appear in the sidebar list.

## Voice signups

Google Voice forwards each text to the club Gmail from a
`@txt.voice.google.com` relay address. The desk lists every text received on
the selected date (Trash and Spam included), grouped by sender, newest first,
with a timestamp per message. It does not interpret the wording. Each sender
shows likely directory matches, including linked names; the organizer clicks
**RR** to add one to the local draft, then saves the draft. Senders without a
saved contact name show only the last four digits of their number.

## Live publication cutover (go-live checklist)

> **Parallel run in progress.** MS Access is still the rating source, so the
> desk's **Finalize ratings** button is switched off (it reads
> "Finalize off until go-live") and `finalizeSession` refuses to run. Use
> the desk to organize, print, and score, but not to finalize. The switch is
> the `CTTC_CLOSED_LOOP` script property; step 5 below turns it on.

1. Give the service account (`GOOGLE_SERVICE_ACCOUNT_EMAIL`) Viewer access to
   the round-robin Sheet and enable the Sheets API for its project.
2. In the deploying repository, set `CTTC_LIVE_START_DATE` (first live session,
   strictly after the last Drive report) and the
   `GOOGLE_ROUND_ROBIN_DATABASE_ID` secret.
3. Run `npm run preflight:live` with those settings in a trusted terminal.
   It only reads the Sheet and lists what it would publish.
4. Confirm the club site's ratings match the desk (`ratingSyncStatus` shows
   the latest Access session) and stop entering results in MS Access.
5. **Turn finalizing on:** in the Apps Script editor, open
   `SessionService.gs`, choose `enableClosedLoopMode`, and click **Run**.
   Reload the desk; the button reads **Finalize ratings** again.
   (`disableClosedLoopMode` turns it back off.)
6. After the first live session, verify the archive, winner, scores,
   adjustments, and email against the desk's ledger.

`npm run refresh:data` is the historical Drive importer; do not run it after
cutover.

## Checks

`npm run check:app` (owner desk), `npm run check:ratings`,
`npm run check:standings`, `npm run check:publication`,
`npm run check:disposable`, and `npm run check:data`.
