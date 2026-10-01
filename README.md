# Concord Table Tennis Club

Website and round-robin tools for the Concord Table Tennis Club (CTTC):
the public site at [concordtabletennisclub.com](https://concordtabletennisclub.com)
and the owner-only Google desk used to run Monday and Wednesday round robins.

> [!IMPORTANT]
> **Hand-off in progress.** This project is moving from
> [Latkecrszy/concordtabletennisclub](https://github.com/Latkecrszy/concordtabletennisclub)
> (built by Seth) to this repository. Until the hand-off is complete:
>
> - **The site is now served from this repository.** `concordtabletennisclub.com`
>   is its GitHub Pages custom domain (HTTPS enforced) and its workflow is
>   enabled (`CTTC_DEPLOY_ENABLED=true`). Only one repository may publish and
>   email, so Seth's workflow must be off (see [Going live](#going-live)).
> - **The desk is the record from 2026-09-30.** The site, the session email,
>   and all rating changes come from sessions finalized in the desk. MS Access
>   is still entered in parallel and only used to double-check the desk
>   ([parallel operations](docs/parallel-operations.md)).

## What's in here

| Path | What it is |
| --- | --- |
| `*.html`, `style.css`, `standings.js`, `rating-engine.js` | Public static site (GitHub Pages). No build step. |
| `data/` | Published JSON: sessions, players, ratings. Updated by automation. |
| `scripts/` | Data import, publishing, email, and check scripts. |
| `apps-script/` | Owner desk (Google Apps Script): roster, groups, promotions, scoring, printing, payments, Voice signups. |
| `docs/round-robin-operations.md` | How the desk and site fit together, rating rules, and the go-live checklist. |
| `docs/parallel-operations.md` | Running Access and the desk side by side: the admin-only comparison and every expected difference. |

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

Merging code on GitHub does not update the Google desk: a maintainer tests
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
      afterward. Never use **Finalize RR Results** as a test action.
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

**Since 2026-09-30:** The desk's `RatingEngine.js` uses both players' ratings at
the start of the session to award points per match (forfeits award zero). On
finalization, `SessionService.js` updates `Players.current_rating` and records
the changes in `RatingLedger`. The lock button on a finalized session reopens
it and reverses those changes until the site publishes it. GitHub Actions
reads *finalized*
Sheet sessions, checks them against the matching `rating-engine.js` rule, and
publishes public JSON through GitHub Pages. A saved draft alone is never
published. See [round-robin operations](docs/round-robin-operations.md#ratings).

**Connection-loss trial:** Open the desk and load the session online before
going to the club. Roster, group, and score edits are saved to Google Sheets
automatically a moment after each change, and also kept in that browser's
device storage until Google confirms them. While everything works there is no
notice. If Google cannot be reached the yellow notice says the draft is kept
on the device; the desk then checks what Google holds before sending again (a
write that did arrive is not repeated, and a different version made elsewhere
is never overwritten), retries on its own for a few minutes, and sends as soon
as the connection returns. After repeated failures it stops and asks you to
click **Save to Sheets**. **Save on device** still confirms a local copy even
if Wi-Fi appears connected but Google is unreachable. Payments, Open Play,
membership badges and Voice confirmations use a separate queue that also syncs
by itself. The yellow notice distinguishes a device copy from a
confirmed Google Sheets save. Round-robin sheets can be previewed and printed
offline, but club/year record figures show `--/--` when Google cannot supply
them; the match schedule, names, and ratings remain. The logo may not load
offline unless the browser has cached it. If a tab is reloaded, reconnect
first: recovery is offered only if the Sheet session has not changed. If it
has changed, download the device copy for manual review rather than
overwriting newer Sheet data. Use a trusted club device, avoid private
browsing or clearing site data, and discard device copies when no longer
needed. Player creation and finalization still require internet. Opening the
desk from scratch while offline is unsupported.

**Session email:** The scheduled workflow refreshes published results, then
`scripts/build-session-email.js` makes the summary from `data/*.json` and
`scripts/send-session-email.js` sends it by Gmail SMTP using a GitHub Actions
secret. Each subscriber gets their own message, so the Unsubscribe link in it carries a signed token for that address; a sent-date marker prevents repeat sends for
the same session. The recipients are the `Subscribers` tab of the private
database Sheet (column A, one address per row); visitors add themselves with
the green **Subscribe** button on the Round Robins page, served by the
separate public app in `subscribe-app/`. The "Send Test Email" workflow sends
to the sending account only (or the whole list if you choose "everyone") with a "[Test]" subject and without advancing the
sent-date marker. The roster, membership status, and subscriber list are
separate: joining a round robin does not subscribe someone to email.

To remove a recipient, a subscriber uses the **Unsubscribe** link at the
bottom of their results email. It opens `unsubscribe.html` with their address
already known (the link is signed, so it cannot be changed or forged), asks
"Unsubscribe?", and a click on **Yes** removes the address and sends a
confirmation. Anyone without the email can still type their address there and
we email a 24-hour link to that address only.
New subscribers get a welcome email that includes the most recent results
(`data/latest-session-email.json`, built by the data workflow). A maintainer
can still delete a row in the private `Subscribers` tab. Never put
addresses in an issue, commit, or the published `data/` directory.

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

**Mode pill:** the desk header shows `/dev` or `/exec` beside the session date as a plain label.

**Desk page on the club site:** `desk.html` (served at `/desk`) shows the live desk inside a frame, which
hides the blue "created by a Google Apps Script user" banner that Google adds to a web app opened
directly. Users open `/desk` on the club site; `?date=YYYY-MM-DD` opens a given session. It frames the
released `/exec` address, never `/dev`: a released deployment frames fine, but Google refuses to
frame `/dev` ("You need access", tested in the VS Code browser), so `/dev` keeps its banner. To
allow framing, `doGet` uses `ALLOWALL`, which would let any website frame your signed-in desk, so the
desk covers itself unless it is opened directly or framed by `https://concordtabletennisclub.com`
(or `localhost`, for testing). If the desk moves to another address, update that list in
`apps-script/Index.html`. The page has a small "Open it directly" link because browsers that block
third-party cookies (Safari, Firefox) may show Google's sign-in page instead of a framed desk. The
frame works only after `/exec` is redeployed with this code; until then `/exec` refuses framing.

**Which tab is which:** the desk code always runs on Google, never on localhost, and `/dev` and
`/exec` both use the same real Sheet. `/dev` is whatever was last pushed from the working branch;
`/exec` changes only when a merged version is released. Keep two plain tabs open. The `/dev` tab is
titled "DEV - CTTC Desk", has an amber strip across the header and an amber `/dev` pill; the `/exec`
tab is titled "LIVE - CTTC Desk" with a green `/exec` pill.

**Forfeits:** a match records who forfeited in the private Sheet's `Matches.forfeited_by`
column: a player id (the other player wins, no score needed) or `both` (never played: no
winner, games or points). Following the USATT Tournament Guide, a forfeit win counts as a
win and a loss in the group standings; it carries no games and, as in the club's Access
records, moves no rating points and is left out of club/year records. The desk requires
any score entered to agree with the forfeiter and, at finalization, requires the forfeiter
to be named. The first desk save after this release adds the column to an existing
`Matches` sheet (header only, nothing reordered or overwritten); a sheet with any other
header is left untouched and the save stops. Publication still reads a `Matches` sheet
that has not been upgraded yet.

## Session data

Until go-live, the scheduled workflow (after each Monday and Wednesday
session, 11:45 PM Pacific with an 8 AM fallback) reads the club's Google
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

- [x] Domain: `concordtabletennisclub.com` is this repository's Pages custom
      domain, the DNS check passes, and HTTPS is enforced (2026-09-30).
- [x] Secrets and switch (2026-09-30): the Google service account, Gmail,
      subscriber Sheet access secrets are set, and
      `CTTC_DEPLOY_ENABLED` is `true`. The workflow runs only where this
      variable is set, so it never runs in forks.
      The first run here deployed the site successfully.
- [x] Publishing from the desk (2026-09-30): the
      `GOOGLE_ROUND_ROBIN_DATABASE_ID` secret is set, the service account has
      Viewer access to the round-robin Sheet, and `CTTC_LIVE_START_DATE` is
      `2026-09-30`. Still to do: run the workflow once to confirm it can read
      the Sheet.
- [ ] Confirm Seth's scheduled and manual workflow is disabled so only one
      repository deploys and emails. Reconcile
      `.cache/last-emailed-session.json` with the last email actually sent,
      and test with the "Send Test Email" workflow before any real send.
      The `TEST_EMAIL_OVERRIDE` secret is no longer used and can be deleted.
- [ ] **Parallel operations:** keep entering results in MS Access and review
      every session with `npm run compare:parallel` until the comparison has
      been clean for the period you agree on
      ([guide](docs/parallel-operations.md)). Stop Access entry only after that.
- [ ] **Bring the record archive up to 9/28** (printed records only; not
      required to finalize).
- [x] The desk's go-live switch is removed: **Finalize RR Results** is always
      available, and the lock button reopens a finalized session until the
      site publishes it.
- [x] Remove the hard-coded `Latkecrszy/concordtabletennisclub` exception from
      `.github/workflows/update-data.yml`.

## Credits

The original site, session archive, leaderboard, and email system were
built by Seth ([@Latkecrszy](https://github.com/Latkecrszy)).
