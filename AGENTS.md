# CTTC code workflow

This repository (`jb-cttc/concordtabletennisclub`) is the home for
both the website and the Google Apps Script desk. GitHub is where changes are
reviewed, tested, and recorded. The public website is served from this
repository (custom domain `concordtabletennisclub.com`); a GitHub merge does
not deploy the Google desk.

## What this session can access

Cloud sessions are set up with the access below, and the session-start hook
prints the same list. Before telling the owner something is out of reach,
check here and try the command named. An error from some other route (another
sign-in, another API) does not mean the thing is unreachable. When the
environment gains a new kind of access, add it here and to
`.claude/hooks/session-start.sh`, not as a separate note.

- **The real Google desk** (`/dev`, `/exec`, and the `?view=cash` and
  `?view=clover` pages):
  `npm run desk:google -- [--exec] [--date YYYY-MM-DD] [--view cash|clover] [--selector CSS] [--width 390] --out <scratchpad dir>`,
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
- Work on a branch and submit a PR to `jb-cttc/main` for approval. Run
  `npm test` before review. Do not treat edits in the Google editor as the
  source of truth; bring any such changes back into this repository for review.
- With owner approval for the branch, push Apps Script updates to `/dev` during
  development so the real Google-hosted UI can be tested before the PR. First
  check Google HEAD for editor-side changes and preserve any found in the repo;
  run `npm test`. The shared `/dev` code uses the real Sheet, so use read-only
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