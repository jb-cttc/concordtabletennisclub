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
`CTTC_RATINGS_SYNCED_THROUGH`. The site publishes Mon/Wed around 10:30 PM PT
(8 AM fallback), so ratings are current within an hour. Consequences:

- Finalizing a desk session dated on or before that date is refused, since
  those matches are already counted in the club's results.
- A finalized session can be reopened from the lock button (see
  [Finalizing and reopening](#finalizing-and-reopening)).
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
play pass. Manual holders in `ZeffyPasses` by player ID remain covered on every
date; archived players keep their manual pass and appear in the sidebar list.
To also recognize revenue-document passes, set the private Apps Script Script
Property `CTTC_REVENUE_DOC_ID` to the Google Doc ID (never put the ID or member
data in this repository). The first table must have marker, first name, last
name, and expiry (`M/D/YY` or `M/D/YYYY`) in its first four columns. Only exact
`M/Zeffy` rows with an unexpired date and one matching player display name
appear as passes for the selected session date. The expiry is inclusive; the
document has no start date, so it cannot enforce a purchase start date. Missing
or ambiguous names require a directory correction. If the configured document
cannot be read, the desk reports payments unavailable. Covered players show a
locked **Zeffy ✓**. Zeffy is not a membership payment: `MembershipDues` records
only the membership year.

## Voice signups

Google Voice forwards each text to the club Gmail from a
`@txt.voice.google.com` relay address. The desk lists every text received on
the selected date (Trash and Spam included), grouped by sender, newest first,
with a timestamp per message. It does not interpret the wording. Each sender
shows likely directory matches, including linked names; the organizer clicks
**RR** to add one to the local draft, then saves the draft. Senders without a
saved contact name show only the last four digits of their number.

## Finalizing and reopening

**Finalize RR Results** checks that every match is complete, updates every
player's rating, writes the rating ledger, and locks the session. The button
then reads **Finalized** with a lock. The scheduled website workflow publishes
finalized sessions.

Clicking the lock asks for confirmation and then **reopens** the session:
every rating change from that session is reversed from the ledger, the ledger
rows are removed, and the session is editable again. Finalize again after the
correction. Reopening is refused when

- the club site already lists the session (the site will not change a
  published session),
- a later session is already finalized (reopen the most recent one first), or
- a player's rating changed after the session was finalized.

The audit log records each reopen with the ratings it reversed.

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
   adjustments, and email against the desk's ledger. Remove the
   `TEST_EMAIL_OVERRIDE` secret once a test email has been checked.

`npm run refresh:data` is the historical Drive importer; do not run it after
cutover.

## Checks

`npm run check:app` (owner desk), `npm run check:ratings`,
`npm run check:standings`, `npm run check:publication`,
`npm run check:disposable`, and `npm run check:data`.
