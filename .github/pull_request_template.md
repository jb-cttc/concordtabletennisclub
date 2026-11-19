## What changed and why

## How it was checked

<!-- Paste `npm run test:plan` here: what was touched, what it shares with other apps, the storyboard steps, and the checks. -->
- [ ] `npm run test:changed` (GitHub runs the whole `npm test` on this PR)
- [ ] Looked at the changed screen (`/dev` with `npm run desk:google`, or the offline preview) at a wide and a phone width, if a screen changed
- [ ] Nothing here tells anyone to edit a Sheet by hand: data changes go through a control, or a form listed under Missing controls in `docs/data-changes.md` (`npm run check:sheet-edits`)

Reused, or could be reused elsewhere:

## Storyboard

<!-- docs/storyboard: which steps this changes (by id), or why none. The test plan lists the steps citing the changed lines. See .github/skills/cttc-storyboard/SKILL.md. -->
- [ ] Steps updated and `npm run build:storyboard` run: …
- [ ] Not affected, because …
