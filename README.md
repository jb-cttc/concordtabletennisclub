# Concord Table Tennis Club

Website and round-robin tools for the Concord Table Tennis Club (CTTC):
the public site at [concordtabletennisclub.com](https://concordtabletennisclub.com)
and the owner-only Google desk used to run Monday and Wednesday round robins.

> [!IMPORTANT]
> **Hand-off in progress.** This project is moving from
> [Latkecrszy/concordtabletennisclub](https://github.com/Latkecrszy/concordtabletennisclub)
> (built by Seth) to this repository. Until the hand-off is complete:
>
> - **The live site is still served from Seth's repository.** Transfer of the
>   `concordtabletennisclub.com` domain is pending. This repo is a staging
>   copy; its scheduled workflow is switched off (see
>   [Going live](#going-live)), so it cannot deploy the site or email members.
> - **MS Access is still the rating source.** Session results come from the
>   club's Access reports. The desk organizes, prints, and scores sessions,
>   but its **Finalize ratings** button is switched off until go-live.

## What's in here

| Path | What it is |
| --- | --- |
| `*.html`, `style.css`, `standings.js`, `rating-engine.js` | Public static site (GitHub Pages). No build step. |
| `data/` | Published JSON: sessions, players, ratings. Updated by automation. |
| `scripts/` | Data import, publishing, email, and check scripts. |
| `apps-script/` | Owner desk (Google Apps Script): roster, groups, promotions, scoring, printing, payments, Voice signups. |
| `docs/round-robin-operations.md` | How the desk and site fit together, rating rules, and the go-live checklist. |

## Request an app or website change

The long-term home for the club's website and Google desk code is
[jb-cttc/concordtabletennisclub](https://github.com/jb-cttc/concordtabletennisclub).
Keeping code there lets the club review changes, test them, and recover an
earlier version. You do not need to know how to code to suggest an improvement.

1. Open [New issue](https://github.com/jb-cttc/concordtabletennisclub/issues/new)
      and sign in to GitHub (or create a free account).
2. Describe what you were doing, what happened, and what you would like instead.
      Screenshots can help, but do **not** post private member, contact, or payment
      information: this repository and its issues are public.
3. A maintainer will discuss the request, make a branch, check the changes,
      and submit a pull request for review. You do not need to edit the Google
      script or open a pull request yourself.

During handoff the public website still runs from Seth's repository. Also,
merging code on GitHub does not update the Google desk: a maintainer tests
the script and deploys a numbered Google version separately.

## Agentic Development Context & Tips

Agents and people work from the same source: this GitHub repository. The
tools have different jobs, and knowing which one changes *code* versus *live
data* prevents surprises:

| Tool | Use it for | What it does not do |
| --- | --- | --- |
| Git and GitHub | Branches, issue discussions, pull requests, review, and a recoverable code history. | Merging a PR does not deploy the Google desk. |
| Local editor and Node.js checks | Edit `apps-script/` and site files, run `npm test`, and preview the website with `npm start`. | A local preview does not change either live app. |
| [clasp](https://github.com/google/clasp) | Push local Apps Script files to the Google project's latest code for testing at `/dev`; after approval, version and redeploy the live `/exec` app. | A push alone does not release a new live version; Google editor changes do not automatically flow back to GitHub. |
| Browser (manually or with an agent) | Inspect the real desk and site, check a release, and enter session data through the app's existing controls. | Browser automation is not the normal way to write or deploy source code. Saving a roster changes the private Google Sheet, not Git history. |

For effective agent-assisted changes:

1. Give the agent a specific behavior to improve and a way to tell whether it
      worked. Include the page or workflow and whether you mean the website,
      Google desk, or private Sheet. Ask it to check the owning code and nearby
      tests before editing, then keep the change focused.
2. Work on a branch, run `npm test`, and review the diff in a PR. Test visible
      changes in a browser as well; passing code checks cannot show whether a
      tutorial is clear or a screen is crowded. See [Contributing](#contributing).
3. Keep private names, contact details, payments, credentials, and Sheet
      exports out of public issues, prompts shared with collaborators, test
      fixtures, and commits. Use synthetic examples when describing a bug.
4. Distinguish a code release from a live-data edit. Before an agent changes
      a real session, have it inspect what is already saved and verify the result
      afterward. Never use **Finalize ratings** as a test action.
5. Have a maintainer release only approved source: check the merged commit at
      `/dev`, create an Apps Script version, redeploy the existing `/exec` URL,
      and verify it there. Note the Git commit and Apps Script version in the
      release record. See [Deploying the desk](#deploying-the-desk) and
      [round-robin operations](docs/round-robin-operations.md).

### Prototype at `/dev`, release at `/exec`

For a UI change, a maintainer can approve **preview pushes** from a feature
branch with clasp for the duration of its development. Check Google HEAD for
other editors' changes and run `npm test` before each push. The push updates
the script's latest code, which
project editors can open at the existing `/dev` URL. The agent and organizer
can try the real Google-hosted page, compare it with the requested behavior,
and iterate before the PR is approved. This is how we can prototype quickly
without editing source through the browser. A preview push is not a release:
the versioned `/exec` deployment remains on its previous code.

`/dev` is not an isolated test database. It still runs against the club's
Google Sheet and services, so use read-only checks or disposable test data;
do not finalize ratings, change real payments, or overwrite a real session
while previewing. A preview push also changes the shared project's latest
code for other editors, so coordinate it and do not push without the owner's
go-ahead. Once the PR is approved and merged, push the **merged commit** again,
verify `/dev`, create a numbered version, redeploy `/exec`, and check the live
page. A GitHub merge by itself never updates either Google URL.
Use the [CTTC dev preview skill](.github/skills/cttc-dev-preview/SKILL.md)
for the full branch preview and release sequence.

The shared club Google login can still edit scripts directly. These are
collaboration practices, not a technical access restriction; if someone makes
an urgent editor-side fix, bring it back into Git for review before the next
release.

## How results, ratings, and email work

**Ratings today:** MS Access session reports are the authority until cutover.
The importer reads those reports from Google Drive, records each player's
reported before/after rating in `data/session-details-*.json`, and derives
the latest rating and history in `data/players.json`. GitHub Pages serves
that JSON to the leaderboard and archive. The Google desk copies the public
ratings into the private round-robin Sheet's `Players.current_rating` when it
loads (and via an hourly trigger if enabled). The saved September 23 roster,
for example, did not recalculate or publish ratings.

**Printed match records:** The private Sheet's `RecordArchive` stores verified
Access Player win/loss baselines through September 21, 2026; dated
`RecordArchiveEvents` add the non-forfeit September 23 Access results.
Subsequent *finalized* desk matches contribute only after that cutoff. Print
sheets show records before the selected session. Cutover remains blocked while
26 operational player IDs still lack verified archive baselines. See
[record archive operations](docs/round-robin-operations.md#club-and-year-records).

**After cutover:** The desk's `RatingEngine.js` uses both players' ratings at
the start of the session to award points per match (forfeits award zero). On
finalization, `SessionService.js` updates `Players.current_rating` and records
the changes in `RatingLedger`. Its **Finalize ratings** action is off while
Access remains authoritative. GitHub Actions will then read *finalized*
Sheet sessions, check them against the matching `rating-engine.js` rule, and
publish public JSON through GitHub Pages. A saved draft alone is never
published. See [round-robin operations](docs/round-robin-operations.md#ratings).

**Session email:** The scheduled workflow refreshes published results, then
`scripts/build-session-email.js` makes the summary from `data/*.json` and
`scripts/send-session-email.js` sends it by Gmail SMTP using a GitHub Actions
secret. Recipients are BCC'd; a sent-date marker prevents repeat sends for
the same session. If configured, a *private subscriber Google Sheet* supplies
the addresses; otherwise the `EMAIL_SUBSCRIBERS` GitHub Actions secret does.
`TEST_EMAIL_OVERRIDE` sends only to a test address without advancing the
sent-date marker. The roster, membership status, and subscriber list are
separate: joining a round robin does not subscribe someone to email.

To add or remove a recipient, a maintainer updates the private subscriber
Sheet (one address per row, usually `Subscribers!A:A`) **or**, if the Sheet is
not configured, the `EMAIL_SUBSCRIBERS` secret in the repository's Actions
settings. Check which source is configured before making a change; there is
no public self-service signup/unsubscribe control here. Never put addresses
in an issue, commit, or the published `data/` directory.

## Backlog and roadmap

Use [GitHub Issues](https://github.com/jb-cttc/concordtabletennisclub/issues)
in `jb-cttc` for feature requests and bugs. Describe the problem and desired
outcome without private records; a maintainer can label issues and group
larger work into milestones or a GitHub Project if the backlog grows.

Tracked in [issue #2](https://github.com/jb-cttc/concordtabletennisclub/issues/2):
replace the manually maintained 2026 membership document with a private,
easier-to-use member/visitor registry and a clearer, access-limited history
of membership dues and per-session payments. The desk already keeps
`MemberStatus`, `MembershipDues`, and `SessionPayments` in a private Sheet,
but those are not a unified membership-management workflow. Any proposal
should cover reconciliation with the existing document, who may edit records,
and how payment corrections are audited. Track *requirements* in a public
issue; keep actual names, transactions, and documents in Google, not GitHub.

## Run it locally

You need [Node.js 24](https://nodejs.org/) and Git.

```sh
git clone https://github.com/<you>/concordtabletennisclub.git
cd concordtabletennisclub
npm install
npm start
```

Open <http://localhost:3000>. The server serves the files in this folder, so
edits to HTML, CSS, or JS show up on reload. Set `PORT` to use another port.

The **Organize** button on the Round Robins page opens the Google desk. The
desk only opens for the club's Google account; collaborators can review and
change its code in `apps-script/`, but a maintainer deploys it (see below).

Run all checks before opening a pull request:

```sh
npm test
```

`npm test` runs the desk, rating, standings, and publication checks. None of
them touch the network or change tracked files.

## Contributing

All changes go through pull requests. Nobody pushes directly to `main`.

1. **Get a copy.**
   Collaborators with write access: create a branch in this repo.
   Everyone else: fork this repo on GitHub and clone your fork.
2. **Branch from the latest `main`** with a short descriptive name, e.g.
   `fix/leaderboard-sort` or `feat/print-scorecards`.
   ```sh
   git switch main && git pull
   git switch -c fix/leaderboard-sort
   ```
3. **Make a focused change** and run `npm test`. Check pages you touched in
   the browser at <http://localhost:3000>.
4. **Commit** with a clear message, ideally in
   [Conventional Commits](https://www.conventionalcommits.org/) style
   (`fix: ...`, `feat: ...`, `docs: ...`).
5. **Push and open a pull request** against `main`. Describe what changed, why,
   and how you tested it. Add screenshots for visual changes.
6. **Wait for review.** A maintainer reviews, merges, and deploys.

Please don't:

- Commit changes to `data/` or `.cache/` unless the PR is about data. Those
  files are regenerated by automation; `npm run refresh:data` rewrites them.
- Commit secrets, passwords, service-account keys, or members' contact or
  payment details. Configuration lives in GitHub secrets and the desk's
  Google Sheet, never in the repo.
- Rename or delete the `CNAME` file; it controls the domain.

## Deploying the desk (maintainers)

The desk is a Google Apps Script project bound to the club's round-robin
Google Sheet. With [clasp](https://github.com/google/clasp) signed in to the
club account:

```sh
cd apps-script
npx --no-install @google/clasp push   # updates the test (/dev) version
# test at the /dev URL, then release to the live link:
npx --no-install @google/clasp version "what changed"
npx --no-install @google/clasp redeploy <live-deployment-id> -V <version> -d "what changed"
```

See [round-robin operations](docs/round-robin-operations.md) for details.

## Session data

Until go-live, the scheduled workflow (after each Monday and Wednesday
session, 10:30 PM Pacific with an 8 AM fallback) reads the club's Google
Drive session reports, rebuilds `data/`, deploys the site, and emails
subscribers. `npm run refresh:data` does the same import locally.

After go-live it publishes finalized desk sessions from the Google Sheet
instead (`npm run publish:finalized`). Session-list updates reject missing
existing dates by default; set `CTTC_ALLOW_SESSION_REMOVALS=true` only when
intentionally removing sessions.

## Going live

These steps finish the hand-off. Details are in the
[go-live checklist](docs/round-robin-operations.md#live-publication-cutover-go-live-checklist).
Track the single-sender email, subscriber, and credential transfer in
[handoff issue #4](https://github.com/jb-cttc/concordtabletennisclub/issues/4).

- [ ] Transfer the `concordtabletennisclub.com` domain and point it at this
      repository's GitHub Pages site.
- [ ] Add the repository secrets (Google service account, Gmail, subscriber
      list) and set the `CTTC_DEPLOY_ENABLED` repository variable to `true`.
      The workflow runs only in Seth's repository or where this variable is
      set, so it never runs in forks.
- [ ] Set `CTTC_LIVE_START_DATE` and run `npm run preflight:live`.
- [ ] Stop entering results in MS Access.
- [ ] **Turn finalizing back on in the desk:** in the Apps Script editor, open
      `SessionService.gs`, choose `enableClosedLoopMode`, and click **Run**.
      The desk's button changes from "Finalize off until go-live" to
      "Finalize ratings".
- [ ] Turn off the workflow in Seth's repository so the two don't both
      publish.

## Credits

The original site, session archive, leaderboard, and email system were
built by Seth ([@Latkecrszy](https://github.com/Latkecrszy)).
