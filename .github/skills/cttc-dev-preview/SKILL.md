---
name: cttc-dev-preview
description: "Preview CTTC Apps Script branch changes on Google /dev using clasp, verify the shared script has no untracked edits, test safely, then prepare a PR and release merged code to /exec. Use when asked to push to dev, prototype the desk, test a Google app change, or deploy the desk."
metadata:
  version: "1.0.0"
---

# CTTC desk preview and release

Use the repository's Apps Script source as the reviewable codebase. A `/dev`
preview updates the shared script's latest code; `/exec` remains on its
numbered deployment. Both URLs use the real club Sheet.

## Procedure

1. Confirm you are on a feature branch, that the owner approved `/dev` pushes
   for this branch (standing approval is sufficient), and that no other editor
   is concurrently changing the Google script. Inspect `git status` and
   `git diff`; never discard someone else's work.
2. Check Google HEAD for drift **before each push**. Clone the script ID from
   `apps-script/.clasp.json` into a disposable directory, running clasp *from
   that directory* (clasp disallows `--rootDir` outside the current project).
   Compare the deployed source files there against the local `apps-script/`
   copies, accounting for intended branch edits. If Google has independent
   edits, preserve them in the branch and verify again; never blindly overwrite
   them. Avoid logging private data or credentials.
3. Run `npm test`. If checks fail, repair the relevant slice before previewing.
   From `apps-script/`, run `npx --no-install @google/clasp status` to confirm
   the files that would be pushed. Then run `npx --no-install @google/clasp push`.
   This updates shared HEAD only, not `/exec`.
4. Open the existing `/dev` deployment in a **fresh browser tab**; VS Code's
   integrated browser sometimes leaves reused Apps Script frames blank. Check
   the changed UI on narrow and wide viewports. Use read-only operations or
   disposable records only; never finalize a real session, change real payments,
   or rely on `/dev` as an isolated database. Recheck Google HEAD if another
   editor may have pushed while you were testing.
5. Iterate on the branch and repeat steps 2-4 until the preview meets the
   request. Report the preview behavior and checks in a PR to `jb-cttc/main`.
   A clasp push is not a Git commit or a PR, and a PR merge deploys neither URL.
6. **Only after approval and merge**, push the merged commit to Google, verify
   `/dev`, create an Apps Script version, and redeploy the *existing* `/exec`
   deployment. Verify the live URL, record the Git commit and Apps Script
   version, and never deploy `/exec` from an unmerged branch. Follow
   [the maintainer release commands](../../../README.md#deploying-the-desk).

For example: a group-layout branch can be pushed to `/dev` to inspect card
wrapping with read-only session data before its PR is merged. It must not use
the live session's **Finalize ratings** button as a test.