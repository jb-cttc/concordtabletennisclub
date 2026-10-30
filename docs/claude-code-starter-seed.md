# Claude Code starter seed

> **If someone sent you this file:** open the Claude app (or `claude.ai`),
> start a new chat, attach this file, and say *"Read this and walk me through
> it."* You don't need to read it all yourself. Claude will ask what you want
> to do and take you one step at a time.
>
> The file comes in two versions with the same content: the `.md` file is for
> Claude, and the `.html` file is easier for you to read in a browser. Claude
> can work from either one.
>
> This is a tutorial, not a rulebook. Along the way, Claude will suggest a
> few short rules for your own project's `AGENTS.md` file, and you decide which
> ones to keep.

---

## Part A: Instructions for the agent

The learner got this file directly, probably in a text from someone at the
Concord Table Tennis Club (CTTC), and has given it to you. Assume nothing is set
up yet. They may have no GitHub account, no Claude Code, and no access to
anything of the club's. Your job is to tutor them, not to finish everything for
them.

### About the club's project

CTTC keeps its work in one public GitHub repository,
`jb-cttc/concordtabletennisclub`
(`https://github.com/jb-cttc/concordtabletennisclub`). Anyone can read it. It
holds:

- the club's public website, `concordtabletennisclub.com`, served by GitHub Pages
- the "desk", a Google Apps Script app that runs club nights: check-in,
  round-robin groups, ratings and payments
- smaller Google apps for coaching bookings, volunteer sign-ups and turnout
- automatic checks (`npm test`), and an `AGENTS.md` file with the rules agents
  follow there

The club's owner works with Claude Code in cloud sessions linked to that
repository. Claude works on a branch, runs the checks and opens a pull request,
and the owner reviews and merges. The owner releases the Google apps as a
separate step. This seed teaches the learner that way of working. They can
learn it by contributing to the club's repository, by setting up their own, or
both.

### Where you're running

- **A plain Claude chat** (the app or `claude.ai`, without files or a
  terminal): you can explain things and guide the learner's clicks, but you
  can't run commands. That's enough for modules 0, C1 and 1. When they reach
  hands-on work, help them open Claude Code (the *Code* section of the Claude
  app, or `claude.ai/code`) and attach this file again in the new session.
- **A Claude Code session:** you can run commands, use git and edit files.
  Still let the learner do anything that happens on their own accounts.

Tell the learner in one sentence which of these you are.

### How to run this tutorial

1. **Start by asking, not telling.** Greet the learner and ask the
   [opening questions](#opening-questions). Suggest a route through the
   [modules](#part-b-modules) that fits their answers and let them pick. They
   can skip, reorder or stop at any point.
2. **Do one step at a time.** Give one small step, say what they should see
   when it worked, and wait for them before moving on. Keep each message short.
   Explain a word the first time you use it (repository, branch, commit, pull
   request, fork, environment variable).
3. **Let them do it, then explain.** If you can run commands, offer to, and
   say what each one does. For anything in a browser on *their* account
   (signing up, installing an app, approving access), give them the clicks and
   let them do it.
4. **Check before you give instructions.** Menu names and buttons in Claude and
   GitHub change often. If you can read the current docs (see
   [References](#references)), check them before giving exact clicks. If what
   the learner sees differs from what you described, believe their screen, and
   describe what to look for rather than insisting on a label.
5. **Track progress.** Keep the [progress checklist](#progress-checklist) up
   to date. Once they have a repository of their own, offer to save this file
   in it as `docs/claude-code-starter-seed.md` and tick the checklist there.
   Until then, show the checklist at the end of each sitting so they can bring
   it to the next one.
6. **Adapt.** This seed describes what worked for CTTC. If something simpler
   suits the learner (a website with no Google parts, or working on their own
   computer instead of the cloud), recommend it and say why.

### Safety rules (never break these)

- **Never ask the learner to paste a password, token, API key or private key
  into the chat.** Credentials go in the environment's settings screen or in a
  file on their own computer. They never go in a conversation or a repository.
- **Public repositories are public.** Before the first commit, make sure they
  understand that anyone can read a public repository, its issues and its
  history, and that deleting something later doesn't remove it from history.
  That means no personal contact details, member lists, payment details or
  credentials. This applies twice over in the club's repository: never post
  or commit anything about club members.
- **Don't take outward-facing or hard-to-undo actions without asking.** That
  covers creating or deleting repositories, publishing a site, opening or
  merging a pull request, sending email, and changing live data.
- **Least access first.** Start with read-only access and one repository, not
  "all repositories", unless the learner chooses otherwise.
- **Never try to get the club's credentials.** The club's Google desk, private
  Sheet, card payments and email are reached only through the owner's own
  sessions. See [module C1](#module-c1-explore-the-clubs-project).

### This tutorial and the learner's AGENTS.md

This file teaches setup. `AGENTS.md` (or `CLAUDE.md`) at the root of a
repository is different: it holds the lasting rules for that project, and every
future session reads it. Keep the two separate:

- **Don't copy this tutorial, or big parts of it, into `AGENTS.md`.** Most of
  what's here is explanation the learner only needs once.
- **Grow the learner's `AGENTS.md` as you go.** Some modules end with
  **AGENTS.md candidates**: rules that might belong there once that step is
  done. Decide which ones fit this learner's project, suggest them in your own
  words, show the exact lines, and write only what the learner agrees to. Skip
  the ones that don't apply, and add your own when the project needs them.
- **Keep it short.** A few lines on day one is fine. The test for any line:
  "Would a new session get this wrong without being told?" If not, leave it
  out.
- **Explain why each rule matters.** Every future session reads the file, so
  the learner should understand and agree with every line in it.
- **The club's `AGENTS.md` belongs to the club.** On the contributor path,
  follow it, and change it only when that change is the point of a pull request.

### Opening questions

Ask these, adapting the wording, then suggest a route:

1. **Which path?**
   - **Contribute to the club's project:** look around the club's website
     and apps, and propose changes to the club's repository.
   - **Set up your own:** a repository of their own, linked to Claude the
     way the club's is.
   - **Both:** many people explore the club's project first, then start their
     own.
2. What would you like to build or change? It could be a club page, a personal
   website, a small tool or a spreadsheet helper, or "I just want to see how it
   works."
3. Which of these do you already have? A GitHub account, a paid Claude plan
   that includes Claude Code, or a Google account you'd use for a project.
4. Where will you mostly work? A phone, a laptop browser, or a laptop where
   you're happy to install things.
5. How hands-on do you want to be? "Explain everything", "Show me and I'll
   follow", or "Do it and show me the result".

### Suggested routes

| Path | If the learner wants… | Route |
| --- | --- | --- |
| Contribute | Just to look around | 0 → C1 |
| Contribute | To propose changes to the club's project | 0 → C1 → 1 → C2 → 8 |
| Own | A first look | 0 → 1 → 2 → 3 |
| Own | A simple website | 0 → 1 → 2 → 3 → 4 |
| Own | A setup like the club's | 0 → 1 → 2 → 3 → 5 → 6 → 8 |
| Own | Google Sheets or Apps Script tools | the setup like the club's, then 7 |
| Both | To explore the club's project, then build their own | 0 → C1 → 1 → 2 → 3 → 5 → 6 → 8, with C2 whenever they're ready |

On any route, they can work on their own computer instead of in the cloud. Use
the local option in module 2.

---

## Part B: Modules

Each module has a goal, steps, a **check** (how to know it worked) and
**options**. Do the steps in order inside a module. Modules C1 and C2 are for
contributing to the club's project. Modules 1 to 7 mostly set up the learner's
own repository. Modules 0 and 8 apply to both.

### Module 0: The big picture (5 minutes, no setup)

**Goal:** the learner understands what the pieces are and how they fit.

Explain in plain words:

- **Claude Code** is an AI agent that can read and edit code, run commands and
  use GitHub. It runs on the web at `claude.ai/code`, in the Claude phone and
  desktop apps, and as a `claude` command on a computer.
- **A cloud session** is a fresh, temporary computer that Claude gets for one
  conversation. It copies (clones) a repository, works on it, and must
  **push** the work back to GitHub before the session ends, or the work is lost.
- **GitHub** stores code and its full history. Work happens on a **branch**,
  a separate line of changes. A **pull request (PR)** proposes merging a
  branch into `main`, and a person reviews and approves it.
- **The loop the club uses:** describe a change → the agent works on a branch →
  the agent runs automatic checks (`npm test`) → the agent opens a PR → a person
  reviews it → merge. For a website on GitHub Pages, merging publishes it.
  Google apps are deployed separately, on purpose (module 7).

**Check:** the learner can say in their own words what a branch and a pull
request are for.

### Module C1: Explore the club's project

**Goal:** the learner knows what's in the club's repository and how it's run,
without changing anything. They don't need an account for this.

1. Open the live site, `https://concordtabletennisclub.com`, and the
   repository, `https://github.com/jb-cttc/concordtabletennisclub`.
2. Take a tour of the repository:

   | Where | What it is |
   | --- | --- |
   | `README.md` | Overview, how results and ratings work, how to contribute |
   | `AGENTS.md` | The rules agents follow in this repository |
   | `*.html`, `style.css` | The public website |
   | `apps-script/` | The desk's code (Google Apps Script) |
   | `coaching-app/`, `staffing-app/`, `turnout-app/` | Smaller Google apps |
   | `docs/` | How each app works, and where things can get stuck |
   | `scripts/` | Data import, publishing, and the checks behind `npm test` |
   | `.claude/`, `.github/skills/` | The session-start hook and written procedures for agents |

3. Explore it with Claude:
   - **In a plain chat that can read web pages:** read `README.md` and
     `AGENTS.md` on GitHub and talk them through it.
   - **In a Claude Code session:** a public repository can usually be cloned
     with no setup: `git clone https://github.com/jb-cttc/concordtabletennisclub`.
     Then run `npm install`, and `npm test` to run the club's checks (they don't
     touch the network). Run `npm start` to preview the website at
     `http://localhost:3000`, and `npm run preview:desk` to see the desk with
     made-up players and no Google. If the clone is refused, fork the
     repository first (module C2, step 1) and start a session on the fork.
   - Let them ask questions, such as "How does the leaderboard page get its
     numbers?"
4. Look at the open **Issues** to see what the club wants done.

**What a contributor can't reach:** the desk, the private Sheet, card payments
and club email run under the club's Google account. Their credentials live only
in the owner's environment. The "What this session can access" list in the
club's `AGENTS.md` describes the owner's sessions. In anyone else's session,
those commands won't work. That's expected, not something to fix.

**Check:** the learner can say which folder holds the website and which holds
the desk, and what `AGENTS.md` is for.

### Module C2: Propose a change to the club's project

**Goal:** a pull request on the club's repository that the owner can review.

1. **Get a copy you can push to.** Either:
   - **Fork it (no permission needed):** on the club's repository, click
     *Fork*. That makes a copy under the learner's own account. Start with this.
   - **Become a collaborator (the owner decides):** ask the person who sent
     this file to add your GitHub username as a collaborator, then accept the
     invitation from GitHub's notifications or email. Collaborators can push
     branches to the club's repository directly.
2. **Link it to Claude:** do [module 2](#module-2-connect-claude-code-to-github)
   with the fork, or with the club's repository if they're a collaborator.
3. **Read the club's rules first.** In the session, ask Claude to read
   `AGENTS.md` and the README's *Contributing* section and summarize them. The
   main ones:
   - Work on a branch and open a pull request to `main`.
   - Run `npm test` first.
   - The repository is public, so no member names, contact details or payments.
   - Leave `data/` and the `CNAME` file alone.
   - Merging doesn't deploy the Google apps.
4. **Pick something small:** an open issue, or a wording or layout fix on the
   website. An idea that needs discussion starts as an issue:
   `https://github.com/jb-cttc/concordtabletennisclub/issues/new`.
5. **Make the change and open the pull request.** Claude works on a branch,
   runs `npm test`, and checks pages with `npm start`. Then it opens a pull
   request against `main` of `jb-cttc/concordtabletennisclub`. From a fork,
   GitHub offers this under *Contribute → Open pull request*. The description
   says what changed, why, and how it was tested, with screenshots for visual
   changes.
6. **Review.** The owner reviews it. The learner answers comments with
   Claude's help. The owner merges and handles any Google release.

**Check:** a pull request is open on the club's repository, and `npm test`
passes.

**AGENTS.md candidates:** none for the club's repository. If the learner also
has their own repository, the club's rules are a good source of candidates for
it.

### Module 1: A GitHub account and a first repository

**Goal:** a GitHub account and, on the own path, an empty repository.

1. Sign up at `https://github.com/signup` (skip this if they already have an
   account). Choose a username they're happy to have seen in public. Turn on
   two-factor authentication under *Settings → Password and authentication*,
   because it protects everything built later.
2. **Own path only:** create a repository from the **+** menu at the top
   right → *New repository*.
   - Name: short, lowercase, with hyphens (for example `my-club-site`).
   - **Public or private?** A public repository gets free GitHub Pages
     websites and lets others see and suggest changes. A private one stays
     hidden. Help them choose. Either works with Claude Code.
   - Tick *Add a README file*, so the repository isn't empty. An agent
     can't clone an empty repository cleanly.
3. Explain what they're looking at: the file list, the *Commits* history, the
   *Issues* tab (a to-do and discussion list) and the *Pull requests* tab.

**Check:** they're signed in to GitHub. On the own path, the repository page
shows a README.

**Options:** a club or team may later want an *organization* account to own
shared repositories. They don't need one to start.

### Module 2: Connect Claude Code to GitHub

**Goal:** a Claude Code cloud session that can read a repository and push
branches to it, linked the way the club's is. On the own path that's their new
repository. On the contributor path it's their fork, or the club's repository
if they're a collaborator.

1. Make sure their Claude plan includes Claude Code. Open `https://claude.ai/code`
   (or the *Code* section of the Claude app) and sign in.
2. Connect GitHub: go to `https://claude.ai/connect-github` and authorize
   with their GitHub account.
3. Install the **Claude GitHub App** on their repository. The connect flow
   offers this, or they can go to
   `https://github.com/apps/claude/installations/select_target`. Recommend
   *Only select repositories* and pick just that one. They can add more later
   from GitHub *Settings → Applications*. A collaborator on the club's
   repository skips this step, because the club has already installed the app
   there.
4. Start a new Claude Code session with that repository selected, and attach
   this file again so the session has the tutorial. A session's repositories
   are chosen when it starts, so if one is missing, the fix is usually a new
   session with it selected.
5. In the session, they ask: *"List the files in this repository and tell me
   which branch you're on."*

**Check:** Claude lists the files and names a branch.

**If it doesn't work:** reconnect at `https://claude.ai/connect-github`, and
check that the GitHub App has access to that repository. A repository owned by
an organization may need one of its owners to approve the app.

**Options:**
- **Phone only:** everything up to module 4 works from the Claude app.
  Reviewing pull requests is easier in the GitHub app.
- **Local instead of cloud:** install Claude Code on their computer (see
  [References](#references) for the current install steps), install Git, and
  sign in to GitHub (`gh auth login`, or Git's own sign-in). Then run `claude`
  inside a cloned folder. Local suits people who want their own editor. The
  cloud suits working from anywhere with nothing to install.

### Module 3: The first change, start to finish

**Goal:** the learner has gone through branch → commit → push → PR → merge once,
in their own repository.

1. The learner asks for something small and visible. For example: *"Add a
   line to the README saying what this project is for."*
2. Claude makes the edit on a branch, commits it and pushes it. Point out the
   branch name and the commit message.
3. Claude opens a pull request. Show them the PR on GitHub: the *Files
   changed* tab shows exactly what changed, with removed lines in red and added
   lines in green.
4. The learner merges it on GitHub (*Merge pull request*). Explain that the
   merge is their decision, not the agent's.

**Check:** the README on `main` shows the new line, and the PR says *Merged*.

**Teach here:** a good request names the *behavior* wanted and *how to tell it
worked*. "Make the page nicer" is vague. "On phones, the header text overlaps
the logo. Make it wrap under the logo" is a request Claude can check.

**AGENTS.md candidates:** this is a good moment to create the file, with a line
or two. For example: always work on a branch and open a PR, and the learner
merges, never the agent.

### Module 4: Publish a website with GitHub Pages (optional)

**Goal:** a live website served from their repository, the way
`concordtabletennisclub.com` is.

1. Claude creates a simple `index.html` (and `style.css`) on a branch and
   opens a PR, and the learner merges it.
2. On GitHub: *Settings → Pages* → *Deploy from a branch* → `main`, folder
   `/ (root)` → *Save*. Pages on a private repository needs a paid GitHub plan.
3. After a minute or two the site appears at
   `https://<username>.github.io/<repository>/`.
4. Optional: a custom domain. They add it under *Settings → Pages* and follow
   GitHub's DNS instructions at their domain registrar. Claude can explain
   each DNS record, but the learner makes the change at the registrar.

**Check:** the URL opens their page on a computer and on a phone.

From now on, merging to `main` updates the site, which is why reviewing the PR
matters.

**AGENTS.md candidates:** merging to `main` publishes the site, and where it's
live. Check visible changes at a phone width and a wide width.

### Module 5: Make the repository agent-ready

**Goal:** every new session starts already knowing the project's rules, without
the learner repeating them.

1. **Review `AGENTS.md` (or `CLAUDE.md`) together.** Claude reads it at the
   start of every session. If it doesn't exist yet, create it now. Use the
   [template](#template-agentsmd) as a menu, not a form: pick the parts that
   fit this project and leave the rest out. It's about *how to work here*: what
   the project is, how to test, what never to do, and who approves what. Teach
   the habit: whenever the learner repeats an instruction, it may belong in
   `AGENTS.md`.
2. **Automatic checks (`npm test`).** Even a website benefits from a script
   that fails when something breaks: a page missing its title, a link that
   points nowhere, a number computed wrong. Claude adds a first check. The club
   runs about twenty before each review.
3. **A session-start hook.** This is a script that runs when each cloud session
   starts. It installs the project's packages and prints what the session can
   reach. It lives in `.claude/hooks/session-start.sh` and is switched on in
   `.claude/settings.json`. See the [template](#template-session-start-hook).
4. **Skills for repeated procedures.** When a multi-step task keeps coming
   back (for example "preview and release the Google app"), write it up once
   as a skill file the agent follows. The club keeps one at
   `.github/skills/cttc-dev-preview/SKILL.md` in its repository.

**Check:** start a *new* session and ask *"What are the rules for working in
this repository?"* Claude should answer from `AGENTS.md` without being told.

**AGENTS.md candidates:** run `npm test` before every PR and report the result.
If there's a hook, add a short "What this session can access" list.

### Module 6: The cloud environment (secrets, network, setup)

**Goal:** the learner understands where a session's access comes from, and can
give it a credential safely when a project needs one.

A cloud session runs in an **environment**. The learner edits it from the
environment menu in the session's title bar, then *Edit*. Labels change over
time, so describe what to look for. An environment holds:

- **Environment variables and secrets:** values the session can read, such as
  an API key. This is the *only* place credentials go: never in chat, never in
  the repository. A new session picks up changes.
- **Network access:** which websites the session may reach. Start with the
  default and widen it only when a step needs it.
- **A setup script:** commands run when the environment is prepared. It can't
  read the saved variables, so anything that needs a secret belongs in the
  session-start hook instead.

How the club uses it. This is a pattern, not a requirement:

- A credential that's a whole file, such as Google's `clasp` sign-in, is
  stored as one base64-encoded variable. The session-start hook decodes it into
  the home folder at startup, checks that it's valid, and never prints it.
- Where possible, each credential is **read-only** and limited to one thing,
  such as a Google service account that can only read one spreadsheet.
- `AGENTS.md` and the hook both list what the session can reach, so the agent
  doesn't wrongly say "I can't access that".

**Check:** the learner can explain where a new API key would go, and why it
never goes in chat or in the repository.

**Options:** most beginner projects, such as a static website, need no secrets
at all. Skip this module until a project needs one.

**AGENTS.md candidates:** for each credential added, one line on what it
reaches and the command that uses it. Never the value itself.

### Module 7: Google Sheets and Apps Script (advanced, optional)

**Goal:** edit a Google Apps Script project from GitHub, preview it safely and
release it on purpose, the way the club's desk works.

Concepts to explain first:
- **Apps Script** is code that runs on Google's servers, often attached to a
  Google Sheet. A **web app** deployment gives it a URL.
- **`clasp`** is Google's command-line tool for copying Apps Script code
  between a folder in the repository and Google.
- **`/dev` and `/exec`:** `/dev` always runs the latest pushed code, as a
  preview for editors. `/exec` runs a numbered version, the live app. Pushing
  changes `/dev`. Releasing means making a version and redeploying `/exec`.
- **A GitHub merge doesn't deploy Google.** That's a separate step, done only
  from merged code.

Steps. Go slowly, and the learner does the Google clicks:
1. Create or choose a test Google Sheet and its Apps Script project
   (*Extensions → Apps Script*). Use made-up data while learning.
2. Turn on the Apps Script API for their account at
   `https://script.google.com/home/usersettings`.
3. On their own computer (a cloud session can't open a Google sign-in
   window): install Node.js, then `npm install -g @google/clasp`, then
   `clasp login`. That writes a sign-in file, `~/.clasprc.json`.
4. Store that file in the cloud environment as one base64 variable (for
   example `CLASPRC_B64`), and have Claude write the session-start hook code
   that restores it. The learner encodes it on their computer
   (`base64 < ~/.clasprc.json` on macOS or Linux) and pastes the result **only**
   into the environment's settings screen.
5. In a session: `clasp clone <script id>` into an `apps-script/` folder,
   then commit, open a PR and merge. From then on, GitHub is the source of truth.
6. The working loop: branch → edit → `npm test` → `clasp push` (updates `/dev`)
   → look at `/dev` → PR → merge → push the merged code → version and redeploy
   `/exec` → look at the live page.

Lessons the club learned the hard way. These are strong **AGENTS.md
candidates** for any Apps Script project, adapted to the learner's setup:
- `/dev` uses the **real** Sheet. Preview with read-only checks or throwaway
  rows, never real records.
- Before pushing, check whether someone edited the code in Google's editor,
  and bring those edits into GitHub instead of overwriting them.
- After pushing, clone the code back and compare, because `clasp` can skip a
  push without saying so.
- **Look at the page, don't just trust the tests.** The club uses a headless
  browser (Playwright) script to screenshot the real page at a wide width and
  at a phone width.
- All the scripts under one Google account **share its daily limits** for
  emails, run time and web calls. Add up usage before adding a timer or an
  email. Timers should wake only when there's work to do.
- Data people need to correct gets a control in the app, not "edit the Sheet
  on your phone".

**Check:** a small visible change goes through `/dev`, a PR, the merge and
`/exec`, and the learner looks at it at both widths.

### Module 8: Working habits that make it go well

Go over these once the learner has made a few changes:

1. **Small, specific requests.** One behavior per request, with a way to
   check it.
2. **Ask the agent to read first.** "Find the code that does X and the tests
   near it, then propose a change" catches wrong assumptions early.
3. **Review every PR.** Read *Files changed*, ask Claude to explain anything
   unclear, and ask what it checked and what it didn't.
4. **See it, don't just trust it.** For anything visible, ask for screenshots,
   or open it yourself on a phone and on a big screen.
5. **Write down what you learn.** When something goes wrong, decide together
   whether the lesson belongs in `AGENTS.md`, so the next session doesn't repeat
   it. Now and then, reread `AGENTS.md` and remove lines that no longer apply.
6. **Use issues as a to-do list.** Ideas and bugs go in GitHub Issues, with no
   private details in a public repository. "Work on issue #12" is a good
   request.
7. **Keep it private.** Use made-up examples when describing a bug that
   involves real people.

---

## Progress checklist

The agent keeps this up to date: in the learner's copy of this file once they
have a repository, and in the chat until then.

Path: _(contribute, own, or both)_
Goal: _(what the learner wants to build or change)_
Route: _(modules chosen)_

- [ ] 0  Big picture: branch, PR and cloud session explained
- [ ] C1 Explored the club's repository and website
- [ ] C2 A pull request open on the club's repository
- [ ] 1  GitHub account (two-factor on); own path: first repository
- [ ] 2  Claude linked to a repository; a session lists its files
- [ ] 3  First change merged through a PR; AGENTS.md started
- [ ] 4  (optional) Website live on GitHub Pages
- [ ] 5  AGENTS.md reviewed, a first automatic check, session-start hook
- [ ] 6  (when needed) Environment secrets and network understood
- [ ] 7  (optional) Apps Script with clasp, /dev and /exec
- [ ] 8  Working habits reviewed

Notes and next idea:

---

## Templates

### Template: AGENTS.md

A menu, not a form. Start with only the lines that fit the project, and add
more as the learner reaches the modules that call for them.

```markdown
# <Project name>: how to work here

<One or two sentences: what this project is and who uses it.>

## Rules
- Work on a branch and open a pull request to `main`. I review and merge; never
  merge yourself.
- Run `npm test` before opening a PR and report the result.
- This repository is public: never commit names, contact details, payments or
  credentials. Use made-up examples.
- For visible changes, check the page at a phone width and a wide width.
- Ask before anything hard to undo (deleting files, publishing, sending email,
  changing live data).

## What this session can access
- GitHub: this repository (read, push branches, open PRs).
- <Add each credential or service here as you add it, and how to use it.>

## Project notes
- <Things you had to tell the agent twice go here.>
```

### Template: session-start hook

`.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command",
        "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh" } ] }
    ]
  }
}
```

`.claude/hooks/session-start.sh` (make it executable with
`chmod +x .claude/hooks/session-start.sh`):

```bash
#!/bin/bash
# Prepares a Claude Code cloud session: installs packages and lists what the session can reach.
set -euo pipefail

# Only run in cloud sessions, not on a local computer.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
if [ -f package.json ]; then
  npm install --no-audit --no-fund --loglevel=error
fi

# Example: restore a file-shaped credential stored as a base64 environment variable.
# The value never goes in the repository and is never printed.
# if [ -n "${CLASPRC_B64:-}" ]; then
#   umask 077
#   printf '%s' "$CLASPRC_B64" | base64 -d > "$HOME/.clasprc.json"
# fi

echo "Access in this session (see AGENTS.md):"
echo "- GitHub (this repository): read, push branches, open PRs"
```

---

## References

Check these for current steps, because products change faster than this seed.

- Claude Code docs: `https://code.claude.com/docs`. Cloud sessions and
  environments: `https://code.claude.com/docs/en/claude-code-on-the-web`
- Connect GitHub to Claude: `https://claude.ai/connect-github`
- Claude GitHub App: `https://github.com/apps/claude`
- GitHub's beginner docs: `https://docs.github.com/en/get-started`
- Forking and pull requests from a fork:
  `https://docs.github.com/en/pull-requests/collaborating-with-pull-requests`
- GitHub Pages: `https://docs.github.com/en/pages`
- clasp (Google Apps Script command-line tool): `https://github.com/google/clasp`
- The club's repository, a working example of all of this:
  `https://github.com/jb-cttc/concordtabletennisclub`. See `AGENTS.md`,
  `README.md` (*Contributing*) and `.claude/`.
- The latest version of this seed:
  `https://github.com/jb-cttc/concordtabletennisclub/blob/main/docs/claude-code-starter-seed.md`
  (and `.html`)
