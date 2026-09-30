# Parallel operations: Access and the desk side by side

While MS Access is still entered alongside the desk, the two systems are compared
after every session. The site publishes only from the desk (closed-loop) data.
The Access reports are read from Google Drive for comparison and are never
published.

## How the modes work

| Mode | `CTTC_LIVE_START_DATE` | What the scheduled workflow does |
|---|---|---|
| Pre-cutover | not set | Scrapes the Access reports and publishes them. |
| **Parallel operations** | set | Publishes finalized desk sessions (`npm run publish:finalized`). Also scrapes the Access reports into `.cache/session-raw-cache.json` and `.cache/access-parallel/sessions.json` (`CTTC_ACCESS_DIR`), which the site never serves. A failed Access scrape does not stop publishing. |
| Desk only | set, Access scrape step removed | Publishes finalized desk sessions only. |

## Reviewing a session (admin only)

```
git pull
npm run compare:parallel            # sessions from CTTC_LIVE_START_DATE (or the first desk session)
npm run compare:parallel -- --date 2026-10-05
```

The command prints a line per session and writes `local/parallel/report.html`
and `report.json`. `local/` is git-ignored, so the report is never committed or
published. It exits with an error when any session needs review.

Each session gets one of three results:

1. **Same results, no issues.** Same groups, scores, records, rating changes, and rankings.
2. **Different rankings or records, all expected.** Every difference matches a documented
   code below, and **every rating point change is identical**.
3. **Unexpected differences: review.** Anything else. This is high priority: work it with
   the team, fix the cause, or document a new exception (see "Adding an exception").

A session that only one side has yet is shown as waiting.

## Expected differences

Ratings are never an expected difference. Both systems use the same rating table
and start from the same ratings, and forfeits move no rating points in either.

| Code | Why it is expected |
|---|---|
| `FORFEIT_DIRECTION` | Access prints `F` in both cells for any forfeit, so it cannot show who forfeited. The desk records the forfeiter, so the other player gets a win and the forfeiter a loss. A double forfeit is the same on both sides. |
| `FORFEIT_RANKING` | The group order differs only because of the recorded forfeit direction. |
| `ACCESS_ORDER_TIE` | The first row of the Access report is someone else in a tie for first. The club rule is game ratio among the tied players, then the lowest pre-session rating; Access asks the admin to pick in three-way ties. |
| `ACCESS_ORDER_FORFEIT` | The first row of the Access report is someone else in a group with forfeits. Access applies its own forfeit handling; the desk ranks by USATT match points (win 2, played loss 1, forfeited or unplayed loss 0). |

## Unexpected differences (always review)

| Code | What it means |
|---|---|
| `ACCESS_ORDER_UNEXPLAINED` | Clear winner, no forfeits, but Access lists someone else first. |
| `RANKING_DIFFERS` | The same ranking rules give a different order on the two sides with no forfeit direction to explain it. |
| `GROUP_MEMBERS` | A group has different players (or exists on one side only). |
| `MATCH_MISSING` | Two players in a group have a match on only one side. |
| `SCORE_DIFFERS` | The same match has different game scores. |
| `FORFEIT_MISMATCH` | A match was played on one side and forfeited on the other. |
| `RATING_BEFORE` | A player started with different ratings. |
| `RATING_ADJ` | A player gained or lost a different number of rating points. |
| `RATING_AFTER` | A player finished with a different rating. |
| `RECORD_DIFFERS` | A win-loss record differs by more than recorded forfeits explain. |

## What the comparison cannot tell you

- Access marks only the Group 1 winner (in red) and lists players in report order, which is mostly,
  but not always, finishing order. The comparison uses the first row as Access's winner and treats
  disagreement as expected only in ties and forfeit groups.
- Only sessions finalized in the desk are compared.
- Names are matched after the alias table (`data/player-aliases.json`); an unrecognized spelling shows up as
  `GROUP_MEMBERS`.
- Before the desk went live, the 2026 sessions are already compared against themselves as a calibration
  (`check-parallel-compare.js`): none may need review.

## Adding an exception

When a difference turns out to be intentional:

1. Add a code (or extend one) in `scripts/lib/parallel-compare.js` with the `expected` level and a plain
   explanation.
2. Add the code to the table above. `npm run check:parallel` fails if a code is undocumented.
3. Add a test case in `scripts/check-parallel-compare.js`.

When it is a real discrepancy, fix the data entry or the code, never the classifier.
