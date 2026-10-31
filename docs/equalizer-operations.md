# The Equalizer at the desk

The Equalizer is a second way to run a rated event on the same desk, Sheet and
roster as the round robin: a head start in every game based on club ratings,
and 8 rating points on every match. The plan, the decisions behind it and the
research are in [GitHub issue #104](https://github.com/jb-cttc/concordtabletennisclub/issues/104).
This page is how to run one and how to fix things.

## Running an event

**New to it?** Choosing **Equalizer** on the switch shows a short teaser
under it (until "Don't show this again" on that device). Its **How it works**,
or the **?** button while the desk is on the Equalizer, opens a guide: chapters
of made-up desk screens (the mockup's players, on the real rules and the real
printouts) walked through step by step with the tour's spotlight. It covers head
starts and their memory, the desk controls, both formats, doubles, scoring and
finishing, the printouts and how long a night takes. Nothing in it is saved. On a
round robin night **?** opens the usual desk tour.

1. **Open the date** as usual (Session date, Load session). Sign players in
   from the directory or Voice signups as for a round robin.
2. **Choose the Equalizer** with the **Round robin | Equalizer** switch in the
   toolbar. Everyone already signed in moves across at once, as long as the
   round robin has no results yet (and back again the same way).
3. **Choose the options** that replace the group size:
   - **Format**: RR → Finals (round robin groups of 4, or 3, then a
     single-elimination Finals for the group winners) or Double Elimination
     (Main Draw, Survivor Trail, Final).
   - **Play**: Singles or Doubles (partners drawn at random; a team plays at
     the average of its ratings, and both partners gain or give the 8).
   - **Best of**: 3 or 5, for every match. A best-of-5 match cut short can
     still be recorded: tap the winner's 2 ball, then **Winner**, as in round
     robins.

   The defaults are RR → Finals, singles, best of 3. Every change redraws at
   once; **Draw again** reshuffles. Players can be added (and the draw
   changes) until the first result is entered; after that the players,
   options and draw are fixed, and a late arrival plays Open Play.
4. **Odd number in doubles**: the desk shows a choice: someone sits out
   (picked, or drawn at random; they play Open Play), or one **team of
   three**. A team of three plays at the average of all three; the team
   chooses who sits out the first game, then whoever sat out comes in for
   whoever has been on longest, so nobody sits out twice in a row. All three
   gain or give the 8. To have someone fill in instead, add them before the
   first result.
5. **Print EQ Sheets** (the round robin's print button, renamed on an
   Equalizer night) prints the paper sheets. RR → Finals: one sheet per
   group, laid out like the round robin sheet, with each match's head start
   where that sheet has rating adjustments, then the Finals bracket (landscape).
   Double Elimination: the Main Draw with the Final, then the Survivor Trail
   (one landscape page when there are 8 or fewer sides). Each bracket box has a
   line per side and a box for games won, sized to fill the page (byes are not
   drawn: the player shows in the next round); a slot not decided yet says where it
   comes from ("Winner of W1-2", "Loser of W2-1", "Best group winner"), and a
   box shows its head start once both sides are known. Print again later in the
   evening and the sheets show the names and results so far.
6. **Score** with the balls, as in round robins. Each match shows its head
   start (the red **+N** and "starts every game at N–0"). Groups show live
   standings with the club's tie-break notes; the Finals start once every
   group is decided, with byes for the best group winners. **Collapse
   organizer** folds the player list away during play.
7. **Finalize Equalizer** once it is finished. Every player's rating moves by
   8 a match on top of their rating at that moment. The lock reopens it, as
   for round robins.

Payments, member badges, first visits, Clover matching, Open Play and the cash
flow page work the same for Equalizer players: fees are per day, so someone in
both the round robin and the Equalizer pays once.

## Both on one day

A round robin is `session-YYYY-MM-DD`; an Equalizer on the same date is
`session-YYYY-MM-DD-equalizer`. If the round robin already has results, the
switch just shows the Equalizer (each event keeps its own players). Finalize
the round robin first: the desk refuses to finalize an Equalizer while a
round robin with players on the same date is still open, and reopening goes
newest first.

## Where it is kept

| Tab | What |
| --- | --- |
| `Sessions` | One row per Equalizer (id ending `-equalizer`), like a round robin. |
| `SessionPlayers` | The Equalizer's roster, with each player's rating at the draw. |
| `Brackets` | One row per Equalizer: rule version, format, play, best of, the odd-player choice, and the saved draw (`draw_json`). |
| `BracketMatches` | One row per result: the two sides, the head start used, games, Winner (`won_by`), forfeit. |
| `RatingLedger` | One row per player when finalized, rule `cttc-equalizer-v1`. |

`Brackets` and `BracketMatches` are made by the first Equalizer save. Only
the draw and the results are stored; teams, groups, the bracket, head starts
and places are worked out from them by the shared rules (`equalizer.js` and
friends, copied into the desk by `npm run sync:desk`). Never edit these tabs
by hand: fix things at the desk.

## Fixing things

| Situation | What to do |
| --- | --- |
| Wrong result | Tap the balls again (or set Forfeit back to None). The desk refuses if a later match already depends on it and names that match: change that one first. After finalizing, the lock reopens it until the site publishes it. |
| A player has to leave | Set **Forfeit** on each remaining match. Forfeits move no rating points. |
| Someone arrives after the first result | They play Open Play. |
| "Changed on another device" | Another tab or device entered that result differently; the desk now shows Google's. Check it and enter it again if needed. |
| "Finalize the round robin first" | The same date has a round robin with players that is still open. |
| The site did not show the Equalizer | Equalizer results are not on the site pages yet (see below), but their ratings are. If the GitHub workflow failed with "Equalizer ... was not published", the reason is in its log; round robins still published. |
| A desk error with a *Reference* | The private `AuditLog` row whose `event_id` starts with it. The desk log (`CTTC Desk Logs`) shows Equalizer steps with `variant=equalizer`. |

## Not built yet

- The site's Equalizer pages (Rated Games, `/equalizer`, profile records,
  Hall of Fame) and an Equalizer results email. Until then the site and
  email show round robins only, and Equalizer ratings appear in each
  player's rating history (labelled Equalizer on their profile).
- The head-start memory reset (no automatic reset either), withdraw in one
  step, best-of changes after the draw, the TV board, and Voice
  automatic answers that name the Equalizer.
- A release switch: the Equalizer appears on `/exec` with the release that
  includes it.

## Checks

`npm test` runs the rules (`scripts/check-equalizer.js`), the server on the
simulated Sheet (`apps-script/check-equalizer-desk.cjs`), the real desk page
on the simulated desk (`apps-script/check-equalizer-night.cjs`) and
publication (`scripts/check-equalizer-publication.js`).
`npm run equalizer:desk-screenshots` saves screenshots of the desk with
made-up players to `docs/equalizer/screenshots/`.
