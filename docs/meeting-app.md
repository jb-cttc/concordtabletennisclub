# Executive committee meeting app

An agenda tracker for the executive committee's meetings: the person running the
meeting works the **controls** on one laptop, and the **projector board** on
another computer (or a second window) follows every change within a few seconds.
It is its own Apps Script project (`meeting-app/`), separate from the desk, and
opens only for the club's Google account, like the desk.

Open it from the **Membership** page: the locked **Executive Committee Meeting**
button (`meeting.html` on the site, which frames the app so Google's banner stays
hidden).

## A meeting, step by step

1. **Projector computer first.** Open the button and answer *What is this screen
   for?* with **Projector**. The board opens; click **Full screen** (or
   double-click). The answer is kept on that computer, so next time it offers
   Projector again. **Stop following** at the bottom of the board asks again.
2. **Main laptop.** Open the same button and choose **Run the meeting**. The
   first time, **New meeting** asks for the title, the date and the planned
   agenda: paste it from the agenda document. Bulleted lines become items,
   indented lines and sub-bullets become sub-points; check the list and click
   **Sub-point** or **Make it an item** on any line it got wrong, then
   **Start meeting**.
3. **Check people in** under **Attendees**: type a few letters and pick the name
   (the desk's player directory, as the site publishes it in
   `data/player-index.json`), or type any other name and press Enter. A role
   goes in brackets, *Pat Example (Treasurer)*; tick **Guest** for a guest. Click
   a person's ball to check them out or in. People from the last meeting come
   back as *expected* (an empty ball) for a one-click check-in.
4. **Run the agenda.** **Discuss** puts an item under **Now** (the board
   highlights it and shows how long it has been on); **Done, next item** checks
   it off with the orange ball and moves on. Click an item to edit it, add
   discussion notes for the minutes, move it, send it to the next meeting, or
   delete it. Drag items to reorder. Items added once the meeting is under way are
   marked **Added**.
5. **Follow-ups**: what needs to happen, the owner (attendees are offered), an
   optional due date and the agenda item (the one being discussed, unless you
   pick another). A follow-up with no owner shows **Owner needed** on the board.
6. **Projector screen** (button at the top) chooses what the board shows:
   - **Full agenda**: every item with its sub-points, and the follow-ups.
   - **Focus**: discussed items fold into one line; only the item under
     discussion shows its sub-points.
   - **Spotlight**: the item under discussion fills the screen with its
     sub-points and its follow-ups; the next items wait at the side.
   - **Follow-ups**: every action item by owner, for the end of the meeting.
   - **Text** size (70% to 300%; the board still shrinks to fit if it must),
     the **Attendees** panel (open, folded to a tab with the count, or hidden),
     and the follow-ups beside the agenda (shown or hidden).
7. **Several controllers at once.** Each laptop signed in to the club account
   can open the controls; each person gives their name once (on the first
   screen, or at the bottom of the controls). What someone else adds or changes
   glows orange on your screen for a few seconds with their name; what they
   remove or a deep dive they start shows as a small note at the bottom left;
   their initials show at the top while they are active. Every laptop's changes
   reach the projector the same way.
8. **Deep dive.** When the meeting pivots into a big topic (finances,
   volunteers), click **Deep dive** on the item under Now (or in an item's
   editor). The projector fills with that topic: its sub-points, the discussion
   points every controller adds (each with who added it, sliding in as they are
   made), and the follow-ups on that topic. **End deep dive** (or checking the
   item off) returns the board to the layout chosen before. The points go into
   the minutes under their item.
9. **Minutes** gives the agenda with what was discussed, each item's notes, the
   attendees and the follow-ups as text to copy into the minutes document or an
   email, or to print.

## Follow-ups between meetings: the Tracker

**Tracker** (top of the controls) lists every follow-up from every meeting kept,
once each, grouped by owner (no owner last). Within an owner, overdue ones come
first, then by due date. Due dates turn amber within 3 days and red once overdue.

- **Show** Open (open and in progress), Overdue, Done or All; narrow it to one
  owner or one meeting, or search the follow-ups and their updates.
- Click the ball to mark a follow-up done (click again to reopen), or pick
  **Open / In progress / Done**.
- Click a follow-up to change its text, owner or due date, see its history, and
  **Add update**: a dated note with your name ("Dec 2: Rossmoor called back").
  The first update on an open follow-up moves it to In progress.
- A follow-up brought forward to the next meeting is the same follow-up there,
  with its status and history, so it appears once in the Tracker. Changes from
  the Tracker go to the meeting it lives in now; if that meeting is on the
  projector, the projector and the other laptops follow, and an earlier meeting
  never takes over the projector.
- The Tracker opens only for the club's Google account, like the rest of the app.

## Draft notes for the secretary

After each meeting, John asks Claude (in a Claude Code session on this repository) to
prepare the draft notes; the secretary reviews them and sends them on. The steps:

1. `npm run meeting:draft -- fetch --out <dir>` saves the meeting on screen in the
   meeting app as `<dir>/meeting.json` (read only). `<dir>` must be outside the
   repository: meeting records name members.
2. Write `<dir>/summary.json`: the note to the secretary, the decisions, what was
   said on each item (in the meeting's order), the follow-ups cleaned up, and open
   questions. Say "no decision recorded" where the notes recorded none; never
   guess. The fields are listed at the top of `scripts/lib/meeting-email.js`.
3. `npm run meeting:draft -- preview --dir <dir>` writes `draft.html` and
   `draft.txt`; look at them wide and at phone width.
4. `npm run meeting:draft -- send --dir <dir>` sends it from the club account to
   `summary.to` through the **meeting mailer** (`meeting-mailer/`, its own Apps
   Script project, club account only). The subject is always
   `[DRAFT NOTES] <title> – <date>`, and the email opens with the note to the
   secretary, then a clear line, then the draft. The club account gets a copy
   (Cc), so the club's Inbox keeps each draft: email a script sends is not filed
   in the account's Sent folder.
5. Delete `<dir>`.

The mailer sends only subjects starting with `[DRAFT NOTES]` (and `[CTTC]` club
messages, below), to at most 20 people plus a copy to the club account, always;
it keeps 10 of the club's daily email recipients for the other apps; it refuses
the same email to the same people twice within 30 minutes unless sent with
`--resend`; and it logs each send in its script property `SENT_LOG`. Every email
is copied (Cc) to the club account, so the club's Inbox shows everything the
mailer sends: the scripts take the club address from the club sign-in, and the
mailer refuses a send without that copy, and remembers the address from its
first send (script property `CLUB_COPY`) and refuses a copy to any other. The first
time after it is released, the club account must open the mailer's `/exec`
address once and click **Allow** (permission to send email as the account).

**Meetings** lists every meeting kept: open an earlier one (it goes on the
projector too), delete an old one, or start a new one. A new meeting can bring
forward the last one's open follow-ups, its items moved to the next meeting, and
its attendee list.

A projector plugged into the main laptop works too: **Projector screen →
Open the board on this laptop** opens the board in a new window there, and it
changes the moment the controls do.

## Club messages

When the owner asks for a short email to someone (a coaching update for a coach,
say), it goes from the club account through the same mailer:

1. Write `<dir>/message.json` in a folder outside the repository (it names
   people): `to` (1 to 20 `{ name, email }`), `subject` (one line; `[CTTC] ` is
   added), `body` (plain text: paragraphs split by a blank line, `- ` or `1. `
   lists, `**bold**`, web addresses become links) and `from` (who asked). The
   fields are listed at the top of `scripts/lib/club-email.js`.
2. `npm run club:email -- preview --dir <dir>` writes `email.html` and
   `email.txt`; look at them wide and at phone width.
3. `npm run club:email -- send --dir <dir>` sends it, subject `[CTTC] …`,
   sender *Concord Table Tennis Club*, with a copy to the club account. The
   footer says it was sent from the club account by Claude, an AI assistant, at
   the named person's request, and that a reply reaches the club.
4. Delete `<dir>`.

## How it works

- **Storage:** script properties of the meeting app's own project: each meeting
  as JSON split into 8,000-character pieces, the meeting on screen
  (`MEETING_CURRENT`) and the list (`MEETING_INDEX`). No Sheet, no Drive, no
  email, no web requests from Google, so the app needs no permission prompt.
  A meeting may use 60 KB and all of them 400 KB of the 500 KB Google allows;
  past that the app asks to delete an old meeting.
- **Saving:** the controls apply each change at once (the same rules as the
  server: `Model.js`, whose source the page runs) and send it to `saveChanges`,
  which applies it under the script lock. Two laptops editing at once each send
  only their own changes, so neither loses the other's.
- **Following:** `followTick` reads a stamp (meeting and version) from the
  script cache, and the meeting only when the stamp moved. Costs are on
  [Google limits](google-limits.md).
- **The player directory** is read by the controls page straight from the club
  site (`data/player-index.json`, built from the desk's players), not from the
  desk's Sheet, so the app needs no Sheet permission. Someone too new to be in
  the published list is checked in by typing their name.

## Releasing (maintainers)

The project was created with clasp in the club account
(`meeting-app/.clasp.json`). Like the desk, `/dev` follows pushes from a branch
and `/exec` is released only from merged code:

```sh
cd meeting-app
npx --no-install @google/clasp push --force           # /dev
npx --no-install @google/clasp version "what changed"
npx --no-install @google/clasp deploy -V <version> -d "what changed"      # the first release
npx --no-install @google/clasp redeploy <deployment-id> -V <version> -d "what changed"   # later releases
```

The live deployment is version 1 onward of `AKfycbwS31-…-l0vA` (released 21 November
2026); `meeting.html` frames its `/exec` address, so later releases use
`redeploy` with that id and the site needs no change. `/dev` and `/exec` share
the same stored meetings (the project's script properties). Look at
both pages with `npm run desk:google -- --app meeting [--view board]` at a wide
and a phone width, and pull the project back to compare with `main`.
