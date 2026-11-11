# CTTC code workflow

This repository (`jb-cttc/concordtabletennisclub`) is the home for
both the website and the Google Apps Script desk. GitHub is where changes are
reviewed, tested, and recorded. The public website is served from this
repository (custom domain `concordtabletennisclub.com`); a GitHub merge does
not deploy the Google desk.

## Never edit the Sheets by hand (binding on every developer and agent)

The club's Google Sheets (the round-robin desk Sheet, the staffing, coaching
and turnout apps' private Sheets) are databases. **Never tell anyone, the owner
included, to type into, fix, add or delete rows or cells in one, and never
write such a step into docs, PRs, issues, emails or app messages.** This holds
for one-off fixes and "just this once" too.

- **When data needs changing and an app has a control for it**, point to that
  control.
- **When no control exists, that is a missing feature, not a reason to edit the
  Sheet.** Say so plainly and propose a form designed for it: who may use it
  (normally the club account only), what it checks, a **Review and Confirm**
  step, and a record of each change (who, when, before and after) where the
  desk log or a tab shows it. Build it on a branch like any other change.
- **Reading is fine** (`npm run sheet:read`, read-only checks) for diagnosis.
- Docs written before this rule still describe Sheet edits (for example the
  staffing app's Emails and Closures tabs in `docs/staffing-flow.md`). Treat
  each as a form still to be built, not as instructions; replace the step with
  the form when it lands. Volunteer training is done on the desk's **Volunteer
  Admin** page (`docs/staffing-flow.md`, section 12).

## What this session can access

Cloud sessions are set up with the access below, and the session-start hook
prints the same list. Before telling the owner something is out of reach,
check here and try the command named. An error from some other route (another
sign-in, another API) does not mean the thing is unreachable. When the
environment gains a new kind of access, add it here and to
`.claude/hooks/session-start.sh`, not as a separate note.

- **The real Google desk** (`/dev`, `/exec`, and the `?view=cash`,
  `?view=clover` and `?view=volunteers` pages):
  `npm run desk:google -- [--exec] [--date YYYY-MM-DD] [--view cash|clover|volunteers] [--selector CSS] [--width 390] --out <scratchpad dir>`,
  then Read the screenshots it prints (`scripts/desk-google-view.js`). It only
  looks, never clicks or saves; keep any extra checks read-only too. Uses the
  clasp sign-in `~/.clasprc.json`, written at session start from
  `CLASPRC_B64` (the club Google account).
- **The private round-robin Sheet, read-only:** `npm run sheet:read -- <Tab>`
  prints a tab's columns and row count (`--rows` for the rows);
  `fetchSheetRows` in `scripts/lib/google-sheets.js` reads any range from a
  script. Uses the service account `GOOGLE_SERVICE_ACCOUNT_EMAIL` and
  `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` on the Sheet `GOOGLE_ROUND_ROBIN_DATABASE_ID`.
  Not the clasp sign-in: its Google project has the Sheets API switched off.
- **Apps Script code:** `clasp` from `apps-script/` pushes to `/dev` and
  versions and redeploys `/exec`, following the workflow below. Uses the clasp
  sign-in.
- **Other read-only Google API calls** (deployments, logs):
  `python3 -I .claude/google-api.py <https://*.googleapis.com/... URL>`. Uses
  the clasp sign-in.
- **Clover card payments:** only through the desk (the token is in the desk's
  Script Properties, never in the session):
  `npm run desk:google -- --view clover`.
- **GitHub (this repository):** the session's GitHub tools, and `git push` to
  branches.

All of this reaches real member data. Keep screenshots and rows outside the
repository, delete screenshots when done, report totals where you can, and
never commit, post, or quote member names or rows.

## Workflow

- Direct club members who want changes, including nontechnical requests, to
  [New issue](https://github.com/jb-cttc/concordtabletennisclub/issues/new).
  Explain that the repository and issues are public: never include private
  member links, contact details, payments, or credentials.
- Work on a branch and submit a PR to `jb-cttc/main` for approval. Before
  review, run the checks the test plan names (`npm run test:changed`; see
  *Size the checks to the change* below); GitHub runs the whole `npm test` on
  every PR. Do not treat edits in the Google editor as the source of truth;
  bring any such changes back into this repository for review.
- With owner approval for the branch, push Apps Script updates to `/dev` during
  development so the real Google-hosted UI can be tested before the PR. First
  check Google HEAD for editor-side changes and preserve any found in the repo;
  run the plan's checks. The shared `/dev` code uses the real Sheet, so use read-only
  checks or disposable data, never real-session finalization. Follow the
  [CTTC dev preview skill](.github/skills/cttc-dev-preview/SKILL.md).
  After PR approval and merge, push the merged commit, verify `/dev`, then
  version and redeploy the existing `/exec` deployment. Never deploy `/exec`
  from an unmerged branch. See [Prototype at `/dev`](README.md#prototype-at-dev-release-at-exec)
  and [Deploying the desk](README.md#deploying-the-desk).
- After every `/dev` push and every `/exec` release, look at the changed page
  with `npm run desk:google` (see below) at a wide and a phone width before
  reporting the change as working.
- These are collaboration instructions, not a technical restriction on a
  person signed in to the shared Google account. Avoid claiming a PR merge
  automatically updates Google.

## How a night works: the storyboard

[`docs/storyboard/`](docs/storyboard/README.md) walks a whole club night step by
step (volunteers, texts and the Tonight page, coaching, then the desk from
opening to published results), with a technical layer per step: entry points,
what is read and written, **what must stay true**, which tests cover it and
which do not, and how to simulate it. The page is `storyboard.html` on the
site; the same content as plain data is `docs/storyboard/night.json`.

- Before reporting a desk change as working, find the steps it touches
  (`npm run test:plan` lists the steps that cite the changed lines) and
  check their `tech.invariants`, especially those listed in `tech.untested`.
  Green tests prove only what they assert. A step is not affected just because
  its file changed: update it only when what it says is no longer true.
- When a change alters how a step works, update that step in
  `docs/storyboard/night-*.js` and run `npm run build:storyboard` in the same
  PR (`npm test` fails while the page is out of date). A new app or feature
  people meet on a night gets its own steps (and a part, and rows in the map of
  how the apps connect). Follow the
  [CTTC storyboard skill](.github/skills/cttc-storyboard/SKILL.md), and say in
  the PR which steps changed, or why none did.

## Size the checks to the change

Checking costs time; spend it where a change can break something, the way a
good developer keeps a running list of what they touched while they build.

- **Keep the list as you go.** `npm run test:plan` prints it from the branch at
  any moment: each file touched and the checks that read it; anything shared
  with another app that changed (a Sheet tab or its columns, a script property,
  a site data file, a call between apps) and that app's checks; and the
  storyboard steps citing the changed lines, or that none do. It works this out
  from the code and the storyboard, so there is no list of tests to keep up.
  Run it when shaping a change and again before review, and paste it in the PR.
- **Look for reuse while building.** Before writing a helper, search the other
  apps for one. When something you build would serve another app (the coaching
  page's email typo check suits every form that takes an email), say so in the
  PR instead of copying it.
- **Run what the plan names** with `npm run test:changed`. Run the whole
  `npm test` only when the plan says *full* (dependencies, the Node version,
  the test workflow, or most checks read the change). GitHub runs the whole
  suite on every PR (`.github/workflows/test.yml`), so never run it again "to
  be safe"; after a small follow-up fix, run the plan again, not the suite.
- **Match the effort to the change:**

  | Change | Tests to write | Storyboard | Look at it |
  | --- | --- | --- | --- |
  | One page's look or a self-contained feature (a table that sorts) | None, or one assertion where it could break silently | Not affected unless the plan lists a step | Once, wide and phone |
  | A clearer screen in a flow that works the same (the coaching confirm step) | One test of the handshake: what the page sends is what the person confirmed | Re-read the listed steps; change only what is no longer true | The changed screen, wide and phone |
  | Something another app reads (plan level *cross-app*) | The contract, on both sides | Update the steps and the map's links | `/dev` of each app touched |
  | Dependencies or shared libraries (plan level *full*) | As the change needs | As the plan lists | As the change needs |

- **Screenshots chase problems.** One wide and one phone look at the changed
  screen; take more only to follow up something that looks wrong.

## Designing for the whole system

Lessons from October 2026, when each fix was sized for one app or one limit and
the club paid for it (the Gmail allowance ran out; a phone edit of the Sheet
broke another player's alias; a new setting needed the owner's hands).

- **One set of Google limits for every app.** The desk, coaching, staffing and
  turnout apps all run as the club account and share its daily limits. Before
  adding or changing anything that runs on a timer, reads Gmail, sends email or
  calls the web, add up the cost across all apps in
  [Google limits and scheduled jobs](docs/google-limits.md), check every limit
  it touches (not only the one in view), and update that page in the same PR.
- **Timers wake only when work is due.** No fixed every-minute polling: a
  30-minute repeating timer plus a one-off timer for the next piece of work, as
  `apps-script/MailReader.js` and the coaching and staffing checks do. A run
  that wakes to do nothing still costs run time.
- **Measure new usage and guard it.** Anything that spends a shared limit
  records what it spent where the desk log or a tab shows it, and slows down or
  stops before the limit, with a warning first.
- **No new owner-only Google steps without saying so first.** Script
  properties, permission prompts, sharing and API switches can only be done by
  the owner in Google. Prefer a design that needs none; otherwise state it in
  the PR before building.
- **Fixable on the desk, never by editing the Sheet.** Data people need to
  correct (aliases, name links, passes, card links, volunteer training) gets a
  desk control with Review and Confirm. See *Never edit the Sheets by hand*
  above: no answer, doc or message may tell someone to edit a Sheet instead.
- **Test the path a fresh page takes.** Check state loaded when a page opens,
  not only state changed during the test's own visit.
- **Verify every release against `main`.** After pushing an app, clone it back
  and compare with the repository: clasp skips a push without saying so when
  the manifest changes (use `--force` deliberately, then verify).