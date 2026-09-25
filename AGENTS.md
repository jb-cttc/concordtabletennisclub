# CTTC code workflow

This repository (`jb-cttc/concordtabletennisclub`) is the intended home for
both the website and the Google Apps Script desk. GitHub is where changes are
reviewed, tested, and recorded. The public website is still served from
Seth's repository during the handoff; a GitHub merge does not deploy the
Google desk.

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
- These are collaboration instructions, not a technical restriction on a
  person signed in to the shared Google account. Avoid claiming a PR merge
  automatically updates Google.