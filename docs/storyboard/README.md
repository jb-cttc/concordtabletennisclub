# Round Robin Night Storyboard

A night at the club, step by step: the volunteers who sign up to open and
close, players texting ahead and the Tonight page, coaching lessons, then the
round robin desk from opening to results on the site. Each step has what a
person does and sees, what is going on underneath, what can go wrong and what
to do, and a technical layer: the functions involved, what is read and written,
what must stay true, which tests cover it and which do not, and how to simulate
it.

- **Page:** [`storyboard.html`](../../storyboard.html), on the site at
  <https://concordtabletennisclub.com/storyboard.html> (linked from About).
- **Plain data, for agents:** [`night.json`](night.json). The same content as
  the page, one object per step.

## Using it

**Before a night, or before calling something "working".** Walk the parts the
change touches. Each step's `tech.invariants` are the things that must stay true
(for example "After print, a group keeps its printed number for the rest of the
night"); `tech.untested` lists the ones no check asserts yet. A passing
`npm test` proves only what a test asserts, so check the untested ones by hand
or with the simulator before reporting a change as working.

**Simulating a step.** `tech.simulate` says how: most steps run in the desk
simulator (`scripts/lib/desk-sim.js`, used by `apps-script/check-*.cjs`), and
anything visual in a real browser against the offline preview
(`PORT=3100 node scripts/desk-preview.js`, made-up back end). Neither touches
Google or the club's data.

**Findings.** Each part ends with what the walk turned up, most severe first,
with how it was confirmed. The scripts that reproduce them are in
[`repro/`](repro/); run one with `node docs/storyboard/repro/<name>.cjs`.
`repro/measure-board.js` measures the Player board in a real browser (see its
first lines). When a finding is fixed, add a test for it and remove it here.

## Changing it

The content is two files: [`night-club.js`](night-club.js) (volunteers,
texting ahead, coaching, and the map of how the apps connect) and
[`night-desk.js`](night-desk.js) (the round robin night). The page is
[`template.html`](template.html). After editing either:

```sh
npm run build:storyboard   # writes storyboard.html and docs/storyboard/night.json
npm test                   # check:storyboard: both are up to date, every cited file exists
```

File references are `path:line` and link to that line at `meta.commit` in
`night-desk.js`, so they stay right as the code moves on. When you revise a
step, re-read the code at today's `main`, update its line numbers, and set
`meta.commit` to that commit.

**Keep it public-safe.** The page is on the public site. Use made-up names only
(Ana Reyes, Ben Okafor, Coach Lee …), never a member's name, email, phone,
payment, Sheet id, script id, token or private link. Describe a data fix as a
desk control (see AGENTS.md, *Never edit the Sheets by hand*).
