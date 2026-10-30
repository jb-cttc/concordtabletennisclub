# Claude Code starter

> **To the person reading this:** give this whole file to your AI agent
> (Claude Code on the web, the Claude app, or the `claude` command) and say
> *"Read this and walk me through it."* You don't need to read it all yourself.
> The agent will ask what you want to do and take you one step at a time.
>
> This is a tutorial, not your project's rulebook. Along the way your agent
> will suggest a few short rules for your own `AGENTS.md`, and you decide
> which ones to keep.

---

## Part A: Instructions for the agent

You're helping someone learn to build small apps and websites with Claude
Code, in the same way the Concord Table Tennis Club (CTTC) builds its website and
its Google Apps Script "desk". The CTTC owner wrote this guide. The learner
may never have used GitHub, a terminal or an AI coding agent. Your job is
to tutor them, not to finish everything for them.

### How to run this tutorial

1. **Start by asking, not telling.** Greet the learner and ask the
   [opening questions](#opening-questions) below. Then suggest a route
   through the [modules](#part-b-modules) that fits their answers. Let
   them pick. They can skip, reorder or stop at any point.
2. **Do one step at a time.** Give one small step, say what they should see
   when it worked, and wait for them before moving on. Keep each message short.
   Explain a word the first time you use it (repository, branch, commit,
   pull request, environment variable).
3. **Let them do it, then explain.** If you have tools (a cloud session or a
   terminal), offer to run commands yourself, but tell them what each one does.
   For anything that happens in a browser on *their* account (signing up,
   installing an app, approving access), give them the clicks and let them do it.
4. **Check what you have before giving instructions.** Menu names and buttons
   in Claude and GitHub change often. If you can read the current docs (see
   [References](#references)), check them before giving exact clicks. If what
   the learner sees differs from what you described, believe their screen.
   Describe what to look for instead of insisting on a label.
5. **Track progress in this file.** Once they have a repository, offer to
   save this tutorial in it as `docs/claude-code-starter.md` and tick the
   [progress checklist](#progress-checklist) there as modules are finished.
   Then a later session can pick up where this one stopped.
6. **Adapt.** This guide describes what worked for CTTC. If something simpler
   suits the learner (for example a website with no Google parts, or working
   on their own computer instead of the cloud), recommend it and say why.

### This tutorial and the learner's AGENTS.md

This file teaches setup. `AGENTS.md` (or `CLAUDE.md`) at the root of the
learner's repository is different: it holds the lasting rules for *their*
project, and every future session reads it. Keep the two separate:

- **Don't copy this tutorial, or big parts of it, into `AGENTS.md`.**
  Most of what's here is explanation the learner only needs once.
- **Grow `AGENTS.md` as you go.** Some modules end with **AGENTS.md
  candidates**: rules that might belong there once that step is done. Decide
  which fit this learner's project, suggest them in your own words, show the
  exact lines, and write only what the learner agrees to. Skip candidates that
  don't apply. Add rules of your own when this project needs them.
- **Keep it short.** A few lines on day one is fine. A good test for any line:
  "Would a new session get this wrong without being told?" If not, leave it out.
- **Explain why it matters.** Every rule in `AGENTS.md` is read by every
  future session, so the learner should understand and agree with each one.

### Safety rules (never break these)

- **Never ask the learner to paste a password, token, API key or private key
  into the chat.** Credentials go into the environment's settings screen or a
  file on their own computer, never into a conversation or a repository.
- **Public repositories are public.** Before the first commit, make sure they
  understand that anyone can read a public repository and its issues and
  history, and that deleting something later does not remove it from history. No
  personal contact details, member lists, payment details or credentials.
- **Don't take outward-facing or hard-to-undo actions without asking:** creating
  or deleting repositories, publishing a site, merging, sending email, or
  changing live data.
- **Least access first.** Give the agent read-only access unless a step really
  needs more. Grant access to one repository, not "all repositories", unless the
  learner chooses otherwise.

### Opening questions

Ask these (adapt the wording), then propose a route:

1. What would you like to build or change? (A personal or club website, a
   small tool, automating a spreadsheet, or "I just want to see how it works")
2. Which of these do you already have? A GitHub account, a paid Claude plan
   that includes Claude Code, a Google account you'd use for a project.
3. Where will you mostly work? Phone, a laptop browser, or a laptop where you're
   happy to install things.
4. How hands-on do you want to be? "Explain everything", "Show me and I'll
   follow", or "Do it and show me the result".

### Suggested routes

| If the learner wants… | Route |
| --- | --- |
| A first look, nothing to install | 0 → 1 → 2 → 3 |
| A simple website of their own | 0 → 1 → 2 → 3 → 4 |
| To work like CTTC (agent reads and pushes, reviews, checks) | 0 → 1 → 2 → 3 → 5 → 6 → 8 |
| Google Sheets or Apps Script tools | the CTTC route, then 7 |
| To work on their own computer instead of the cloud | swap module 2 for module 2L |

---

## Part B: Modules

Each module has a goal, steps, a **check** (how to know it worked) and
**options**. Do the steps in order inside a module.

### Module 0: The big picture (5 minutes, no setup)

**Goal:** the learner understands what the pieces are and how they fit together.

Explain this in plain words:

- **Claude Code** is an AI agent that can read and edit code, run commands and
  use GitHub. It runs in a few places: on the web at `claude.ai/code`, in
  the Claude phone and desktop apps, and as a `claude` command on a computer.
- **A cloud session** is a fresh, temporary computer that Claude gets for a
  conversation. It copies (clones) the learner's repository, works on it, and
  must **push** the work to GitHub before the session ends, or the work is lost.
- **GitHub** stores the code and its full history. Work happens on a
  **branch** (a separate line of changes). A **pull request (PR)** proposes
  merging a branch into `main`. The learner reviews and approves it.
- **The loop CTTC uses:** describe a change → the agent works on a branch →
  the agent runs automatic checks (`npm test`) → the agent opens a PR → a person
  reviews it → merge. For a website on GitHub Pages, merging is publishing.
  For Google apps, deploying is a separate, deliberate step (module 7).

**Check:** the learner can say in their own words what a branch and a PR are
for.

### Module 1: A GitHub account and a first repository

**Goal:** the learner has a GitHub account and an empty repository.

1. Sign up at `https://github.com/signup` (skip if they already have an
   account). Choose a username they're happy to have seen in public. Turn on
   two-factor authentication under *Settings → Password and authentication*. It
   protects everything built later.
2. Create a repository: the **+** menu at the top right → *New repository*.
   - Name: short, lowercase, with hyphens (for example `my-club-site`).
   - **Public or private?** Public is free for GitHub Pages websites and lets
     others see and suggest changes. Private keeps it hidden. Help them choose.
     Either works with Claude Code.
   - Tick *Add a README file*, so the repository is not empty (an agent can't
     clone an empty repository cleanly).
3. Explain what they're looking at: the file list, the *Commits* history, the
   *Issues* tab (a to-do and discussion list), the *Pull requests* tab.

**Check:** the repository page shows a README.

**Options:** if they belong to a club or team, they may later want an
*organization* account to own shared repositories. That isn't needed to start.

### Module 2: Connect Claude Code to GitHub (cloud)

**Goal:** a Claude Code cloud session that can read the repository and push
branches to it. This is the "unlocked" setup.

1. Make sure their Claude plan includes Claude Code. Open `https://claude.ai/code`
   (or the *Code* section of the Claude app) and sign in.
2. Connect GitHub: go to `https://claude.ai/connect-github` and authorize
   with their GitHub account.
3. Install the **Claude GitHub App** on the repository (the connect flow
   offers this, or use `https://github.com/apps/claude/installations/select_target`).
   Recommend *Only select repositories* and pick the new one. They can add more
   later from GitHub *Settings → Applications*.
4. Start a new Claude Code session with that repository selected. A session's
   repositories are chosen when it starts, so if one is missing, the fix is
   usually a new session with it selected.
5. In the session, ask Claude: *"List the files in this repository and tell me
   which branch you're on."*

**Check:** Claude lists the README and names a branch.

**If it doesn't work:** reconnect at `https://claude.ai/connect-github`, and
check that the GitHub App has access to that repository. A repository owned by
an organization may need an owner of that organization to approve the app.

**Options:**
- **Phone only:** everything in modules 2 to 4 works from the Claude app. Reviewing
  PRs is easier in the GitHub app.
- **Module 2L (local instead of cloud):** install Claude Code on their computer
  (see the docs in [References](#references) for the current install command),
  install Git, and sign in to GitHub with `gh auth login` or Git's own sign-in.
  Then run `claude` inside a cloned folder. Local is good for people who
  want their own editor. Cloud is good for working from anywhere and for not
  having to install anything.

### Module 3: The first change, start to finish

**Goal:** the learner has gone through branch → commit → push → PR → merge once.

1. Have the learner ask for something small and visible. For example:
   *"Add a line to the README describing what this project is for."*
2. Claude makes the edit on a branch, commits it, and pushes it. Point out the
   branch name and the commit message.
3. Ask Claude to open a pull request. Show them the PR on GitHub: the
   *Files changed* tab shows exactly what changed (red = removed,
   green = added).
4. The learner merges it on GitHub (*Merge pull request*). Explain that the
   merge is their decision, not the agent's.

**Check:** the README on `main` shows the new line, and the PR is marked *Merged*.

**Teach here:** a good request names the *behaviour* wanted and *how to tell
it worked*. "Make the page nicer" is vague. "On phones, the header text overlaps
the logo. Make it wrap under the logo" is a request Claude can check.

**AGENTS.md candidates:** this is a good moment to create the file, with
only a line or two. For example: always work on a branch and open a PR, and
the learner merges, never the agent.

### Module 4: Publish a website with GitHub Pages (optional)

**Goal:** a live website served from the repository, the way
`concordtabletennisclub.com` is.

1. Ask Claude to create a simple `index.html` (and `style.css`) on a branch,
   open a PR, and let the learner merge it.
2. On GitHub: *Settings → Pages* → *Deploy from a branch* → `main`, folder
   `/ (root)` → *Save*. (Pages on a private repository needs a paid GitHub plan.)
3. After a minute or two the site appears at
   `https://<username>.github.io/<repository>/`.
4. Optional: a custom domain. Add it under *Settings → Pages* and follow
   GitHub's DNS instructions at the domain registrar. Claude can explain each DNS
   record, but the learner makes the change at the registrar.

**Check:** the URL opens their page in a browser and on a phone.

From now on, merging to `main` updates the site. That's why reviewing the PR
matters.

**AGENTS.md candidates:** merging to `main` publishes the site, and the live
URL. Check visible changes at a phone width and a wide width.

### Module 5: Make the repository agent-ready

**Goal:** every new session starts already knowing the project's rules,
without the learner repeating them.

1. **Review `AGENTS.md` (or `CLAUDE.md`) together.** Claude reads it at the
   start of every session. If it doesn't exist yet, create it now. Go through
   the [template](#template-agentsmd) as a menu, not a form: pick the parts
   that fit this project and leave the rest out. It should be about *how to
   work here*: what the project is, how to test, what never to do, who
   approves what. Teach the habit: whenever the learner repeats an instruction
   to the agent, it may belong in `AGENTS.md`.
2. **Automatic checks (`npm test`).** Even a website benefits from a script
   that fails when something breaks: a page is missing its title, a link
   points nowhere, a number is computed wrong. Ask Claude to add a first
   check, and add a rule to `AGENTS.md` to run it before every PR. CTTC runs
   about twenty such checks before each review.
3. **A session-start hook.** This is a script that runs when each cloud
   session starts. It installs the project's packages and prints what the
   session can reach. See the [template](#template-session-start-hook). It lives
   in `.claude/hooks/session-start.sh` and is switched on by
   `.claude/settings.json`.
4. **Skills, for repeated procedures.** When a multi-step task keeps coming
   back (for example "preview and release the Google app"), write it up once as
   a skill file that the agent follows. CTTC keeps one at
   `.github/skills/cttc-dev-preview/SKILL.md`.

**Check:** start a *new* session and ask *"What are the rules for working in
this repository?"* Claude should answer from `AGENTS.md` without being told.

**AGENTS.md candidates:** run `npm test` before every PR and report the
result. If there's a hook, a short "What this session can access" list.

### Module 6: The cloud environment (secrets, network, setup)

**Goal:** the learner understands where a session's access comes from, and can
give it a credential safely when a project needs one.

A cloud session runs in an **environment**. The learner edits it from the
environment menu in the session's title bar, then *Edit*. The labels change
over time, so describe what to look for. It holds:

- **Environment variables / secrets:** values the session can read, such as
  an API key. This is the *only* place credentials go. Never in chat, never in
  the repository. A new session picks up changes.
- **Network access:** which websites the session may reach. Start with the
  default and widen it only when a step needs it.
- **Setup script:** commands run when the environment is prepared. It can't read
  the saved variables, so anything that needs a secret belongs in the
  session-start hook instead.

How CTTC uses it (a pattern, not a requirement):

- A credential that's a whole file (Google's `clasp` sign-in) is stored as one
  base64-encoded variable. The session-start hook decodes it into the home
  folder at startup, checks it's valid, and never prints it.
- Where possible each credential is **read-only** and scoped to one thing.
  For example, a Google service account that can only read one spreadsheet.
- `AGENTS.md` and the hook both list what the session can reach, so the agent
  doesn't wrongly say "I can't access that".

**Check:** the learner can explain where they would put a new API key, and why
it doesn't go in chat or in a file in the repository.

**Options:** most beginner projects (a static website) need no secrets at all.
Skip this module until a project needs one.

**AGENTS.md candidates:** for each credential added, one line on what it
reaches and the command that uses it. Never the value itself.

### Module 7: Google Sheets and Apps Script (advanced, optional)

**Goal:** edit a Google Apps Script project from GitHub, preview it safely, and
release it on purpose. This is how the CTTC desk works.

Concepts to explain first:
- **Apps Script** is code that runs on Google's servers, often attached to a
  Google Sheet. A **web app** deployment gives it a URL.
- **`clasp`** is Google's command-line tool that copies Apps Script code
  between a folder in the repository and Google.
- **`/dev` and `/exec`:** `/dev` always runs the latest pushed code (a preview
  for editors). `/exec` runs a numbered version (the live app). Pushing
  changes `/dev`. Releasing means making a version and redeploying `/exec`.
- **A GitHub merge does not deploy Google.** It's a separate step, done only
  from merged code.

Steps (walk through slowly, and the learner does the Google clicks):
1. Create or choose a test Google Sheet and its Apps Script project
   (*Extensions → Apps Script*). Use made-up data while learning.
2. Turn on the Apps Script API for their account at
   `https://script.google.com/home/usersettings`.
3. On their own computer (cloud sessions can't open a Google sign-in window):
   install Node.js, then `npm install -g @google/clasp`, then `clasp login`.
   This writes a sign-in file, `~/.clasprc.json`.
4. Store that file in the cloud environment as a base64 variable (for example
   `CLASPRC_B64`). Have Claude write the session-start hook code that restores it.
   The learner encodes it on their computer (`base64 < ~/.clasprc.json` on
   macOS/Linux) and pastes the result **only** into the environment settings
   screen.
5. In a session: `clasp clone <script id>` into an `apps-script/` folder,
   commit, PR, merge. Now GitHub is the source of truth.
6. The working loop: branch → edit → `npm test` → `clasp push` (updates `/dev`)
   → look at `/dev` → PR → merge → push the merged code → version and redeploy
   `/exec` → look at the live page.

Lessons CTTC learned the hard way. These are strong **AGENTS.md candidates**
for any Apps Script project. Adapt them to the learner's setup:
- `/dev` uses the **real** Sheet. Preview with read-only checks or throwaway
  rows, never with real records.
- Before pushing, check whether someone edited the code in Google's editor, and
  bring those edits into GitHub instead of overwriting them.
- After pushing, clone the code back and compare. `clasp` can skip a push
  without saying so.
- **Look at the page, don't just trust the tests.** CTTC uses a headless browser
  (Playwright) script to screenshot the real page at a wide width and at
  phone width.
- All scripts under one Google account **share that account's daily limits**
  (emails, run time, web calls). Add up usage before adding a timer or an
  email. Timers should wake only when there's work to do.
- Data people need to correct gets a control in the app, not "edit the Sheet
  on your phone".

**Check:** a small visible change goes through `/dev`, PR, merge and `/exec`,
and the learner looks at it at both widths.

### Module 8: Working habits that make it go well

Go over these once the learner has done a few changes:

1. **Small, specific requests.** One behaviour per request, with how to check it.
2. **Ask the agent to read first.** "Find the code that does X and the tests
   near it, then propose a change" catches wrong assumptions early.
3. **Review every PR.** Read *Files changed*. Ask Claude to explain anything
   unclear. Ask it to describe what it checked and what it didn't.
4. **See it, don't just trust it.** For anything visible, ask for screenshots
   or open it yourself on a phone and on a big screen.
5. **Write down what you learn.** When something goes wrong, decide together
   whether the lesson belongs in `AGENTS.md` so the next session doesn't repeat
   it. Now and then, reread `AGENTS.md` and remove lines that no longer apply.
6. **Issues as a to-do list.** Ideas and bugs go in GitHub Issues (no private
   details in a public repository). "Work on issue #12" is a good request.
7. **Privacy.** Use made-up examples when describing a bug that involves
   real people.

---

## Progress checklist

The agent ticks these off in the learner's copy of this file
(`docs/claude-code-starter.md`).

Goal: _(what the learner wants to build)_
Route: _(modules chosen)_

- [ ] 0  Big picture: branch, PR, cloud session explained
- [ ] 1  GitHub account (2FA on) and first repository
- [ ] 2  Claude connected to GitHub; session lists my files
- [ ] 3  First change merged through a PR; AGENTS.md started
- [ ] 4  (optional) Website live on GitHub Pages
- [ ] 5  AGENTS.md reviewed, a first automatic check, session-start hook
- [ ] 6  (when needed) Environment secrets / network understood
- [ ] 7  (optional) Apps Script with clasp, /dev and /exec
- [ ] 8  Working habits reviewed

Notes / next idea:

---

## Templates

### Template: AGENTS.md

A menu, not a form. Start with only the lines that fit this project, and add
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

Check these for current steps. Products change faster than this guide.

- Claude Code docs: `https://code.claude.com/docs`. Cloud sessions and
  environments: `https://code.claude.com/docs/en/claude-code-on-the-web`
- Connect GitHub to Claude: `https://claude.ai/connect-github`
- Claude GitHub App: `https://github.com/apps/claude`
- GitHub's beginner docs: `https://docs.github.com/en/get-started`
- GitHub Pages: `https://docs.github.com/en/pages`
- clasp (Google Apps Script CLI): `https://github.com/google/clasp`
- A working example of all of this: `https://github.com/jb-cttc/concordtabletennisclub`
  (see `AGENTS.md`, `README.md` and `.claude/`)
- The latest version of this tutorial:
  `https://github.com/jb-cttc/concordtabletennisclub/blob/main/docs/claude-code-starter.md`
