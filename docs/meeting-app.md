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
   - **Text** size (70% to 160%; the board still shrinks to fit if it must),
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

**Meetings** lists every meeting kept: open an earlier one (it goes on the
projector too), delete an old one, or start a new one. A new meeting can bring
forward the last one's open follow-ups, its items moved to the next meeting, and
its attendee list.

A projector plugged into the main laptop works too: **Projector screen →
Open the board on this laptop** opens the board in a new window there, and it
changes the moment the controls do.

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

After the first release, set `APP_URL` in `meeting.html` to the deployment's
`/exec` address (until then the page says the app is not released yet). Look at
both pages with `npm run desk:google -- --app meeting [--view board]` at a wide
and a phone width, and pull the project back to compare with `main`.
