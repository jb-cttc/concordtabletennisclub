---
name: cttc-storyboard
description: "Keep the storyboard (the site's Club Night Guide: docs/storyboard/, storyboard.html) true to the code: find the steps a change touches, check what must stay true, update steps, invariants, tests and findings, add a part for a new app, and rebuild. Use for any change to how a club night works (the desk, the Player board, the volunteer, coaching, turnout or subscribe apps, site pages players use on a night), when adding a new app or feature, when fixing a storyboard finding, and before reporting a desk change as working or checking the desk before a night."
metadata:
  version: "1.0.0"
---

# Keeping the storyboard true

The storyboard walks a whole club night step by step: volunteers, texting ahead
and the Tonight page, coaching, then the round robin desk from opening to
published results. Each step has a plain story, exceptions, and a technical
layer: entry points (`file:line`), what is read and written, **what must stay
true** (`tech.invariants`), the tests that cover it and what no test covers
(`tech.untested`), and how to simulate it. Read
[docs/storyboard/README.md](../../../docs/storyboard/README.md) first.

The storyboard exists because green tests missed three problems on a real
night (November 2026): each was an invariant nobody had written down. It only
keeps doing that job if every change keeps it current.

## When a change touches a night

1. **Find the steps.** `npm run test:plan` lists the steps whose citations
   (`tech.entry[]`, exception evidence) are near the changed lines, and says
   when none are. Read those steps, including their exceptions. A step is not
   affected just because its file changed: update it only when what it says
   is no longer true (a page that sorts its table changes no step).
2. **Check what must stay true.** For each step, confirm the change keeps every
   `tech.invariants` line. Those also in `tech.untested` have no test: check
   them with the step's `tech.simulate` (desk simulator, or the offline preview
   in a real browser) before calling the change working. Green tests prove only
   what they assert.
3. **Commit the code, then move the references.**
   `npm run build:storyboard -- --advance` moves every `file:line` to the
   current commit through git's diff and lists the references whose lines
   changed. Re-read each listed one in the code and fix the step by hand.
4. **Update the steps** in `docs/storyboard/night-desk.js` (the desk night) or
   `night-club.js` (volunteers, texts, coaching, and the map of how the apps
   connect):
   - Behaviour that changed: the step's summary, the on-screen text (quote it
     from the code), caveats and exceptions.
   - A new behaviour people meet on a night: a new step, in night order.
   - Every new rule that must hold: an invariant, plus the test that asserts it
     in `tech.tests`, or, if there is none yet, a line in `tech.untested`.
   - A new connection between apps (a Sheet another app reads, a wake call, a
     shared file): a row in `map.links` in `night-club.js`.
5. **Rebuild and test.** `npm run build:storyboard`, then `npm run test:changed`
   (`check:storyboard` fails while `storyboard.html` or `night.json` is out of
   date, a cited file is missing, or an entry point's name is not on its line).
6. **Say so in the PR:** "Storyboard: steps print-4, finish-3 updated", or
   "Storyboard: not affected, because …".

## A new app or a new part of the night

Add a part (a `phase`) to `night-club.js` (outside the desk) or
`night-desk.js` (at the desk), then add its id to `ORDER` (and a short name
to `SHORT` for desk parts) in `scripts/build-storyboard.js`. Give it a node in
`map.nodes` and a row in `map.links` for every connection to the other apps:
what passes, how often, and what stops if it breaks. Steps need a `screen`; if
none of the picture kinds fits (`desk`, `board`, `sheet`, `phone`, `devices`,
`site`, `email`, `calendar`, `tonight`, `booking`, `sms`), add a small
renderer to `docs/storyboard/template.html` beside the others.

## Findings

A finding is a problem found by walking the night, with evidence and how it was
confirmed. Reproduce it before calling it confirmed: a script in
`docs/storyboard/repro/` (run with `node`) that prints what goes wrong. When it
is fixed:

1. Add a test that would have caught it, and list it on the step.
2. Change the step's exception to `handled`, saying what happens now and, in
   brackets, what happened before and when it was fixed.
3. Remove the finding, and make its repro script print `FIXED` (keep it: it
   shows the fix holds).

Rate severity by harm times likelihood on a real night, not by harm alone.

## Before a club night

Walk the parts the night depends on (the projector, printing, scores,
publishing; Fridays and Saturdays add coaching). For each step, run its
`tech.simulate` where it names a check, and look at every `tech.untested` line.
Report what you checked, what you could not, and any finding, without calling
the desk ready on tests alone.

## Keep it public

`storyboard.html` is on the public site. Made-up names only (Ana Reyes, Ben
Okafor, Coach Lee …): never a member's name, email, phone, payment, Sheet id,
script id, token or private link. Never describe a data fix as editing a
Sheet; point to the desk control, or name the missing control as a finding
(AGENTS.md, *Never edit the Sheets by hand*).
