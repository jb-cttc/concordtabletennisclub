# Coaching app: where is a booking stuck?

How to find exactly which step a lesson request, a coach's times, or a change
is at, who has to act next, what they were sent, and what can go wrong. The
source of truth is the **private** Sheet (`CTTC Coaching (private - do not
share)`); the public Sheet and the booking page only show a summary. All code
references are to [`coaching-app/Code.js`](../coaching-app/Code.js).

> Keep real names, emails and phone numbers out of issues and commits when
> using this guide. Describe a case by date, time, coach first name and status.

## 1. Two-minute triage

**Start on Coach Admin's control center** (the lock button on the Coaching
page, below the coaches). It lists every lesson and request, upcoming and from
the last two weeks, with its steps: what was sent, who it waits on and until
when, and anything **Stuck** (see *The control center* in section 5). Search
it by booking code, student or coach. Its controls move a booking on through
the app's own steps; nobody edits the Sheet.

**Then the booking code.** Every email about a booking ends with
*Booking code: 3F09A1*, the same six characters the log uses. Ask the student
or coach for it (it is safe to share: it says nothing about the person), then
open the web app's `/exec` address with `?log=3F09A1`. It needs no sign-in and
shows that booking's lesson time, current `status`, who it is waiting on and
the deadline (`booking`), and every line about it in order (`lines`): each
step (`step:pending`, `step:confirmed`, …), each email or text sent, each
YES or NO read and whether it was applied, and any failure. `runs` shows
whether the check and the sweep are running. Section 2 explains each
line. If that answers the question, stop here; otherwise use the private
Sheet:

1. Open the private Sheet, **Requests** tab. Find the row by `date`
   (`2026-10-16`) and `start` (`21:00`, 24-hour Pacific). A move creates a
   *new* row, so check every row for that student (`student_email`).
2. Read `status`, then check `expires_at` against now. `expires_at` is
   milliseconds since 1970 (UTC). In the Sheet, `=EPOCHTODATE(M2/1000)` gives
   the time in UTC; subtract 7 hours for PDT or 8 for PST. A waiting status
   whose `expires_at` has passed is already **expired** in the app, even
   before the hourly sweep writes it.
3. Use the table below.

| `status` | Meaning | Who must act | What they were sent | Deadline | Public board shows |
| --- | --- | --- | --- | --- | --- |
| `pending` | Student pressed **Confirm submission** on the page; the coach has been asked (`verified_at` is that moment). | **Coach**: reply YES or NO. | Coach: email *Lesson request from {student} [CTTC ref …]* with the student's name, email and mobile (if given), plus a text if the coach has a mobile on the list. Student: email *Coaching request sent to Coach … (not confirmed yet)*. | The earlier of 48 hours after the request, or 12 hours before the lesson (`HOLD_HOURS`, `RELEASE_BEFORE_HOURS`). When that leaves the coach under 2 hours (`MIN_ANSWER_MS`, a lesson booked at short notice), until the lesson starts. | "Waiting for Coach … to accept" |
| `unverified` | Only a request made before November 2026, when the student had to reply YES first. Nothing new is ever saved this way. | **Student**: reply YES. | Email *Confirm your coaching request [CTTC ref …]*. | 2 hours after submitting. | "Waiting for Student … to confirm" |
| `confirmed` | Coach said YES. Done. With `undo = done:{ms}`, the student cancelled it on the page and then replied UNDO, which put it back. | Nobody | Both: *Lesson confirmed: {date} {start}*, with each other's contact details. Texts too if opted in. After an UNDO both get *Lesson back on: {date} {start}* instead. | n/a | "booked" |
| `declined` | Coach said NO. | Nobody (student may pick another time) | Student: *Coaching request not accepted*. | n/a | time is open again |
| `expired` with empty `verified_at` | (Before November 2026 only.) Student never replied YES. | Nobody | Student: *Coaching request expired: we did not get your YES*, with how to book now. Coach was never told. | n/a | time is open again |
| `expired` with `verified_at` set | Coach never answered. | **Club** should follow up with the coach (while it waits, Coach Admin's **Remind the coach now**, or **Accept** / **Decline for the coach** once they told the club) | Student and coach both, with the club cc'd (`ADMIN_EMAIL`): *…expired: the coach did not answer* / *Lesson request expired: no answer*. | n/a | time is open again |
| `cancelled`, `cancelled_by = student` | Student cancelled a confirmed lesson on the page (from late November 2026, at once; `undo = open:{ms}`, the cancel time), or confirmed a cancel by emailed YES (before then), or replied NO to the confirm email (before November 2026). | Nobody (the student may reply UNDO, §3) | Student: *Coaching lesson cancelled [CTTC ref …]* with an **UNDO** button when cancelled on the page, else *Coaching lesson cancelled*. Coach: *Lesson cancelled by {student}*, only if the coach had been asked (`verified_at` set). | UNDO counts until the lesson starts, at most 3 days (`UNDO_MS`) | time is open again |
| `cancelled`, `cancelled_by = withdrawn` | Student cancelled the request on the page before the coach answered (from November 2026; no YES needed). | Nobody | Student: *Coaching request cancelled*. Coach: *Request withdrawn by {student}*, and a text if registered. | n/a | time is open again |
| `cancelled`, `cancelled_by = move` | Student moved to another time; look for the new row (status `pending`). | See the new row | Coach of the old time: *Lesson cancelled by {student}* ("moved"). | n/a | old time open; new time "requested" |
| `cancelled`, `cancelled_by = coach` | Set by hand by the club after a coach asked to cancel (coaches reply to their confirmation email; the app does not do this itself). | Nobody | Student: *Lesson cancelled by your coach*. | n/a | time is open again |

`proposed` appears in the code's status checks but is never set; ignore it.

The booking board, schedule list, coach page and public Sheet say who owes
the next reply: **"Waiting for Coach … to accept"** (`pending`), or, for a
request from before November 2026, **"Waiting for Student … to confirm"**
(`unverified`). Before this was added (the `/exec` release of 2026-10-10 and
earlier) both showed only "requested".

**How a request is made (from November 2026).** The student picks a time
that has not started yet (Pacific time), fills in the form and presses **Send
request**. With **50 minutes** chosen, the page offers each coach's 60-minute
slots, and also two back-to-back 30-minute slots of one coach at one table as
one 50-minute time over both (paired from the earliest: three in a row give one
hour and one 25-minute time). Its key is the two slot ids joined by `+`
(`openTime_` in `coaching-app/Code.js`); a move to such a time works the same
way. The page then shows a confirm box: the lesson, the coach, the
address we will email under *We will email the coach's answer to:* in large
bold type, and every other detail the coach will get (student, parent if under
18, mobile), with *Clicking Confirm submission sends a message to Coach … to
confirm the lesson and gives Coach … your contact information: the email
address above and these details*. Tapping the address (**✎ Edit**) corrects it
right in the box, and the correction goes back into the form.
**Confirm submission** sends it; **Go back** (or Esc) sends nothing. The
request is saved as `pending` and the coach is asked at once. There is no
emailed or texted YES from the student for a new request, and no student
reminder. The emailed YES is still how a student confirms a **move** (and,
before late November 2026, a cancel of a confirmed lesson).
Before November 2026 a new request waited up to 2 hours for the student's
emailed YES (`unverified`); a request still waiting when the change was
released finishes the old way (its YES still counts; it is not reminded).

**A likely typo in the email address (from November 2026).** When the student
leaves the email box (Tab, or a tap elsewhere), the page checks the part after
the `@` against common providers and shows *Did you mean …?* with **Use …**
and **Keep mine** under the box (`emailTypo` in `coaching-app/Index.html`). A
clear slip (one letter off a big provider such as `gmial.com`, a made-up ending
such as `.con`, `gmail.co`, `.com.com`) is amber; an address worth a look
(`comcast.com`, `hotmail.co`) gets a quieter hint that says why. A student who
presses **Send request** straight after typing sees no hint on the form (the
button would move under their finger); a clear slip is pointed out again in
the confirm box, where one tap fixes it, and a softer one is not. Editing the
address in the confirm box runs the same check. It is only a suggestion: the
student can always keep what they typed, and the server's own check of the
address is unchanged. Real providers next to a big one (`mail.com`,
`email.com`, `gmx.com`, `ymail.com`) and country endings (`hotmail.fr`) are
never flagged.

## 2. Did each message actually go out?

Each person is told about each status **once**. These columns record the last
status each side was told about. They are written only after the send
succeeded, so a mismatch means the message has not gone out yet:

| Column | Holds | Example reading |
| --- | --- | --- |
| `student_emailed` | the `status` the student was last emailed about | `status = unverified`, `student_emailed` empty → **the confirm email never went out** |
| `coach_emailed` | the `status` the coach was last emailed about | `status = pending`, `coach_emailed` empty → the coach has not been emailed |
| `coach_texted` | `pending` once the coach was **asked** by text; afterwards the last status texted | `status = pending`, `coach_texted` empty → the coach has not been texted (no mobile, never texted COACH, or another question is open, see §4) |
| `student_texted` | the last status texted to the student | only for students with `Students.texts = yes` |

**Reminders.** A request still waiting on the coach gets one reminder, sent
by the sweep (hourly or after any change), so it can come a little later than
due and is skipped in the last 2 minutes before the deadline: the coach 2
hours after the request, or halfway to the deadline when that is sooner (a
lesson booked at short notice): *Reminder: Lesson request from {student}
[CTTC ref …]*, plus the text question again if it is the coach's open one.
At that point the student is also emailed *Your coaching request is waiting
on Coach …*, saying nothing more is needed from them. The reminder keeps the
original reference code, so a reply to either email counts. The `reminded`
column holds the step already reminded (`pending`). Students are never
reminded: no new request waits for them (a cancel or move they asked for is
not reminded either).

Unsent messages are retried by every sweep (hourly, and after every booking
or answer), but only while `updated_at` is under 3 days old
(`RETRY_MAIL_DAYS`) and the daily mail quota is above 10 (`MIN_QUOTA`). After
that the app gives up silently.

**Send log.** Every email and text the app sends also writes one log line,
for example `coaching sent email student_emailed:pending ref=<request_id> to=D811B0`:
the channel, the kind of message (for the sweep's status messages, the column
above and the status), the request (or coach, wait or reply) it is about, and
the recipient as a six-character code. The same person always gets the same
code, but no name, address or number is ever logged. Two lines with the same
kind, `ref` and `to` mean someone really did get the same message twice. A
check that starts while the previous one is still running logs
`coaching checkTexts skipped: …` and does nothing. Read the lines in the
script editor under **Executions** (open a run to see its logs).

The same lines go to the private Sheet's **Log** tab (the latest 500 are
kept), and the web app shows the latest 300 to anyone at its `/exec` address
with `?log` added, as JSON:
`{"at":"2026-10-17T19:02:11.000Z","channel":"email","kind":"student_emailed:pending","ref":"3F09A1","to":"D811B0"}`.
There `ref` is a code too, so nothing from the private Sheet is shown; lines
with the same `kind`, `ref` and `to` are the same message sent twice. It
answers 20 reads a minute. Besides messages sent (`channel` `email` or `text`),
the log holds:

- **Replies read**: kind `reply:<who>:<yes|no>` (`student-v` confirms a
  request, `student-c` a cancel or move, `coach-request`, `coach-slots`), with
  `detail` `applied, now confirmed` or `not applied, now expired`. An UNDO is
  `reply:student-u:undo`, `applied, now confirmed` or, when it could not put
  the lesson back, `not applied, now cancelled (another student has booked
  that time since)`.
- **Failures**: `channel` `error`, kind naming what failed (for example
  `send-coach_emailed:pending`, `read-coach-texts`), and `detail` the error
  with addresses, numbers, quoted text and long ids replaced. The same failure
  is logged at most every 10 minutes.
- **Steps**: `channel` `step`, kind `step:<status>` each time a booking
  changes status (made, confirmed by the student, accepted, declined,
  cancelled, moved, expired), with `detail` saying who must act next and by
  when (`waiting on coach until Saturday, October 10, 2026, 3:00 PM Pacific
  Time`), who cancelled (`by student`, plus `cancelled on the page` for an
  instant cancel), `undone by the student` for a lesson an UNDO put back, or
  for a move, `moved from <old code>`.
- **Skipped checks**: kind `check-skipped`.

`?log=<code>` shows only that booking's lines, plus a `booking` summary
(`code`, `date`, `start`, `status`, `waitingOn`, `deadline`) from the private
Sheet; it finds bookings made in the last 60 days. The log keeps the latest
500 lines, so an older booking's early lines may be gone.

Above the lines, `runs` shows the last check and the last sweep: when they
finished, `ok`, and which steps failed; the check also has `mail`, the same
counts as the status read-out below. The check runs at least hourly (with the
sweep), so a `checkTexts` time more than about an hour old means the hourly
`sweep` timer has stopped.

## 3. The request lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending: student presses Confirm submission (time held)
    pending --> confirmed: coach replies YES
    pending --> declined: coach replies NO
    pending --> expired: 48 h, or 12 h before lesson (short notice: lesson start)
    confirmed --> cancelled: cancel (at once), move (on YES), or club cancels
    cancelled --> confirmed: student replies UNDO, time still free
    pending --> cancelled: cancel (at once) or move (on YES)
    confirmed --> [*]
    declined --> [*]
    expired --> [*]
    cancelled --> [*]
```

(A request from before November 2026 started as `unverified` and became
`pending` on the student's YES, `cancelled` on NO, or `expired` after 2
hours.)

**Cancelling a request the coach has not answered yet** (`pending`) is
instant: the student taps **Mine** on the time, **Cancel my request**, and
enters the email address or mobile number they requested with. The row becomes
`cancelled` with `cancelled_by = withdrawn` at once, with no YES. The student
gets *Coaching request cancelled*, and the coach *Request withdrawn by
{student}* (and a text, if registered) saying there is no need to answer. A
coach's YES read afterwards books nothing. The page gives the same answer
whoever asks, so it never tells anyone whose request a time is.

### Cancelling a lesson, and UNDO

**Cancelling a confirmed lesson** (from late November 2026) is instant too.
Students took asking for a cancel to be the cancel, and left it waiting for a
YES they never sent (two lessons waited that way on 21 November 2026). The
student taps **Mine** on the time, **Cancel this lesson**, enters the email
address or mobile number they booked with and presses **Cancel this lesson**.
The row becomes `cancelled` with `cancelled_by = student` at once, and `undo =
open:{ms}`; the time is open again, and the page gives the same answer
whoever asks. The step is logged as `step:cancelled` with *cancelled on the
page*. The student gets *Coaching lesson cancelled [CTTC ref …]*: *Done:
Student …'s lesson is cancelled*, the lesson, and an **UNDO** button (*Put the
lesson back, if nobody has booked the time since*) with the time it counts
until. The coach gets *Lesson cancelled by {student}* (and a text, if
registered), saying the student can undo it and that the coach will be told.
A student who gets our texts is texted *…is cancelled. By mistake? Reply UNDO
to our email.*

**UNDO** counts until the lesson starts, for at most 3 days (`UNDO_MS`, the
same 3 days the email check looks back). It puts the lesson back as it was
(`status = confirmed`, `undo = done:{ms}`, step *undone by the student*), and
the student and the coach both get *Lesson back on: {date} {start}* (texts
too). It cannot when the lesson has started, the coach or the time is no
longer offered, another student has booked the time since, or the same
student holds another lesson then; the student gets *Your coaching reply*
saying why, and that it stays cancelled. Either way the question closes, so a
second UNDO is not read. Only the word UNDO counts (`undoAnswer_`: *UNDO*,
*Undo please*, *Hi, undo*); any other reply to that email (*thanks!*) is left
alone, with no *could not read* email. UNDO is by email only: a texted UNDO
is not read.

**A move** does **not** change `status` until the student confirms. While it
waits, the row has `change = move:{avail_id}` and `change_at` (ms). The student
is emailed *Confirm: move your lesson [CTTC ref …]*. A move is applied only if
the new time is still open when they reply YES; the new row starts at
`pending` (the coach is asked straight away). Cancelling the lesson while a
move waits cancels it at once and drops the move; a YES to the move email
afterwards is not read. A cancel asked before late November 2026 and still
waiting (`change = cancel`, *Confirm: cancel your lesson*) still finishes by
the student's YES.

While a move waits, the booking page, the coach page and the public Sheet show
it on the lesson: **"Move requested: waiting for Student … to confirm"** (or,
for a cancel asked before late November 2026, "Cancel requested: …"). The
lesson still counts as booked until the student's YES.

### Everything waiting, in one email

A student can have several things waiting for their YES at one address: moves
of different lessons (and, before late November 2026, cancels; before November
2026, a new request), each asked by its own email.
People answer the newest email and expect that to be the answer. On 3 November
2026 a student asked to cancel two Friday lessons, then booked a Saturday one
and replied YES to that email; the two cancellations kept waiting. So **every
email to a student while more than one thing waits for them lists them all**,
numbered, under one new reference code, before the email's own details:

| Answer (each is a button) | What it does |
| --- | --- |
| **YES** | Every item listed. |
| **YES to ONLY THIS** | Only the item the email was sent about (marked *THIS EMAIL*); the rest stay waiting. |
| **NO** | Declines only that item (drops that request, or keeps that lesson); the rest stay waiting. |

A button opens a new email to the club with the subject (so the code) and the
answer already written; the student presses Send. Replying with the word works
the same. An email that asks nothing of its own (*Lesson confirmed*, *Coaching
request sent to …*, a reply to an answer) lists what is still waiting with
**YES** only, and its subject gets a code. With only one thing waiting, the
email is as before (YES and NO), with buttons. Earlier emails keep answering
their own item.

- What each list held is the private **Bundles** tab: `trigger` (the item that
  email was about, empty for a follow-up) and `items` (`v:{request_id}` for a
  new request, `c:{request_id}:{change_at}` for a cancel or move). A YES does
  exactly what was listed, never something asked later. The sweep drops a list
  once nothing on it waits.
- Read as **only**: `YES to ONLY THIS`, `yes, only this one`, `yes just this`,
  `only this`, `yes to only this, not the others`. To a list, any other yes
  that says *only*, *except* or *but* (`yes, only the Saturday one`) is
  unclear: nothing changes and the student gets *We could not read your
  reply*. `yes to all` and `yes, both` are a yes.
- In the log: `reply:student-b:yes` (or `:only`, `:no`) with `detail`
  `listed 3, done 3`, then one `reply:student-v` or `reply:student-c` line per
  item it did. Anything that could not be done (a new time was taken, a
  request expired) is explained in one *Your coaching reply* email.
- Texts are unchanged: a texted YES answers the one question last texted.

**One time, 4 November 2026.** At the owner's request the sweep counted that
student's Saturday YES for her two waiting cancellations (booking codes
9E3D15 and 32AF8F, from the YES to 367613), as this would have. It ran once
(script property `ONE_TIME_YES_TO_ALL_367613`) and logged each step as
`one-time-yes-to-all`.

### The owner's daily summary

The first hourly sweep after 7 AM Pacific emails the owner (the script
property `SUMMARY_EMAIL`, else `SUMMARY_TO` in `Code.js`) *Coaching daily
summary: N waiting for a YES, M confirmed yesterday*:

- **Waiting on students:** each move to confirm (and any request or cancel
  asked before those stopped needing a YES), with the student, coach, lesson time, booking code and how long it
  has waited. **Waiting on coaches:** each request to accept and each list of
  times to publish. *Nothing is waiting for an emailed YES* when there is none.
- **Yesterday** (the Pacific day), counted from the Log tab: YES answers
  applied (lessons accepted by coaches, cancels and moves, coaching times, and
  any request from before November 2026 a student confirmed); **cancels and
  moves**, the lessons cancelled on the page (and how many an UNDO put back)
  besides those confirmed by YES; **new requests**
  sent to the coach from the page (`step:pending` lines with *booked on the
  page*; these are not YES answers, so they are not in the *confirmed*
  total); **no answer**, requests that expired without the coach's answer
  (`step:expired` lines with *coach did not answer*); NO answers applied; and
  replies to an email listing several things. The Log keeps the latest 500
  lines; if it does not reach back to the start of yesterday, the email says
  the counts may be low.

  Before November 2026 every new request also counted as a YES (the student's),
  so *confirmed yesterday* in the subject reads lower from then on for the
  same number of lessons; compare *New requests* and *Lessons* instead.

- **Volunteers**, from the volunteer app's hidden `StaffingDigest` tab in the
  desk Sheet ([staffing flow](staffing-flow.md), *The owner's daily summary*):
  sign-ups and drops waiting for a volunteer's YES, emails waiting for the
  club's approval, anyone with several things waiting, and yesterday's counts.
  If that app has not written the tab for 2 hours, the email says so.

The subject is *CTTC daily summary: N waiting for a YES, M confirmed
yesterday*, counting both apps. It is sent once a day (`SUMMARY_SENT` holds
the day) and logged as `daily-summary`.

### When a newer ask replaces an older one

A request for a time that overlaps a lesson or request the **same student**
already holds (same email and name, another coach or table) is refused on the
page: *Student … already has a lesson at that time: … To change it, tap that
time on the schedule and choose Move it to another time.* Since a new request
no longer waits for a YES, letting it replace the older one would cancel a
lesson nobody confirmed cancelling. Another student booked from the same
address (a brother or sister) can still take the other table.

A student who asks again about the same lesson (a cancel, then a move) means
the newer ask. It replaces the older one, never anyone else's, but only once
they say YES to it; until then nothing changes and both are held. (Before
November 2026 an overlapping new request could also replace a lesson, on the
same terms; one still waiting when that changed finishes that way.) The newer email shows the change the way the desk shows a player
edit: *This replaces your earlier request: ~~Cancel it~~ → **Move it to …***
(in a list, the item is marked CHANGE). The older question stops counting: a
reply to it gets *you have since replaced that request … nothing changed* and
lists the newer one (`reply:student-r:…`, `not applied, replaced`). The YES to
an overlapping request cancels the one it replaces (`step:cancelled`, `by
student, replaced by {code}`); its coach is told as for any cancellation. A
second change of the same lesson takes the place of the first at once (the
lesson itself is untouched until the YES); `change_was` keeps what it
replaced, so the older email's code is still recognised.

## 4. How replies are recognised (the usual place things stick)

Answers are read by the check (`checkTexts`). It has no timer of its own,
because timer run time is shared by every club app
([Google limits](google-limits.md)) and a check that finds nothing still
counts. Instead the desk's one mail reader **wakes** it whenever a text or an
email reply to one of its questions comes in (within about 5 minutes by day, a
minute during round robin sign-up, 30 at night;
[Waking the apps](round-robin-operations.md#waking-the-coaching-and-staffing-apps)).
The wake calls the app's `/exec` address, which counts as a web request, not
timer time. The app looks only when what came in can matter: a YES or NO,
STUDENT or STOP, any text from a coach waiting to be verified, or an email
reply; a round robin sign-up text is answered "nothing to check" at once. The
hourly `sweep` runs the check too, so nothing waits more than an hour if a
wake is missed.

**Email replies** (`checkMail_`) count only if **all** of these hold:

- the reply's subject still contains the `[CTTC ref XXXXXXXXXX]` code (a normal
  "Reply" keeps it; editing the subject or writing a new email loses it);
- it comes **from the address the question went to** (case, and for Gmail
  dots and `+tags`, do not matter). A reply from another account, alias or
  relay address (for example Apple's *Hide My Email*) does not count, but the
  sender is told to reply from the right address (the club is not emailed);
- the **first line of the person's own words starts with yes or no**, in any
  case, optionally after a greeting or `ok` (`Yes, see you Friday`, `ok yes`,
  `Hi Dee, yes`, `no thanks`, `y`, `yep`, `nope`); a greeting on its own line
  (`Hi John,` then `Yes`) is skipped. A yes or no further in (`there is no
  parking`, an out-of-office note) is not an answer, nor is a line with both
  (`Yes, but I can't make it`). Automatic replies are skipped. The quoted
  earlier message (`On … wrote:`, `>` lines, `-------- Original message
  --------`, an Outlook `From:` block, our own `Reply YES`/`[CTTC ref`
  lines) and signatures (`Sent from my …`, `-- `) are cut off, even when an
  HTML-only reply arrives with lines run together (`YESSent from my
  Galaxy`): when an email has an HTML version, its own line breaks are used.
Invisible characters are removed first. An unreadable reply to an
  open question gets one "please reply again" email (the club is not emailed);
- it arrives within 3 days and after the question was asked, and the
  question is still open.

The *Coaching lesson cancelled* email of a lesson cancelled on the page asks
nothing: its code counts only for a reply whose first line is **UNDO** (from
the same address, while UNDO is offered; §3). Any other reply to it is left
alone, and a reply from another address is told to reply UNDO from the right
one.

**Text replies** go through the club's Google Voice number, forwarded to Gmail.
The app reads texts from the desk Sheet's `VoiceTexts` tab, where the desk's one
mail reader collects them (every minute in the last 4 hours of round robin sign-up, every 5 minutes otherwise by day, every 30 overnight; [One Gmail reader](round-robin-operations.md#one-gmail-reader)),
so set the script property `DESK_SHEET_ID` to the desk Sheet's id. It searches
Gmail for texts only to text back someone whose last text came before the desk
started collecting them. Emailed answers are searched from the last check (5
minutes back), not from the oldest open question.

- The app can only text someone who has **texted the club number first**:
  coaches text `COACH` once (this sets `Coaches.registered_at` and `phone_ok`), students text
  `STUDENT` (sets `Students.texts = yes`, `texts_at`).
- The sender is matched by the mobile number on the list, or by the Google
  Voice contact name matching the name on the list.
- Each person has **one open question at a time** (`ask_ref`, `ask_at` on the
  Coaches or Students row). A bare YES answers that one question. Coaches:
  `ask_ref` is `slots` or a `request_id`; students: `v:{request_id}`
  (confirm) or `c:{request_id}` (change). Other pending requests are texted
  after the open one is answered; a fresh request replaces an open question
  only after 10 minutes (`PROPOSE_WAIT_MS`).

An email reply to an open question that cannot be used gets an explanation
(unreadable, or wrong address) within about 5 hours of arriving; the club is
not emailed. Text replies with no yes/no are still ignored without a message.
Each step of the check runs on its own, so a failing step (for
example Google Voice) does not stop email answers being read. A step that
fails at every attempt for 30 minutes (`ALERT_AFTER_MS`) is emailed to the club
once, as *Action needed: the coaching app cannot …*, with what to do; when it
works again the club gets *Resolved: the coaching app can … again*. A failure
that clears sooner (Google outages of a few minutes are common) is logged, not
emailed. A student's YES sent
before the deadline but read after it still counts if the lesson is still
offered, free, at least about an hour from its own deadline, and the coach
is active.

**Status read-out.** After each check the app renames a separate,
empty spreadsheet in the club's Drive (recreated if deleted), *CTTC Coaching
status | {time, rounded down to 10 minutes} | mail
q=… late=… threads=… messages=… coded=… answers=… | failed: …*. It holds
counts only: open email questions, late-YES look-backs, threads and messages
read, replies quoting a code, answers applied, unreadable replies (with the
length of the first line and any invisible or unusual space characters in it,
as code points; never letters), and failed steps (addresses, numbers and
quoted text masked). If
it has not changed for more than an hour, the check is not running.

## 5. Coaches' offered times

| Where | What it tells you |
| --- | --- |
| **Coaches** `ask_slots` (JSON) and `ask_made` (ms) | The coach submitted times on the page and we are waiting for their YES (email *Confirm your coaching times [CTTC ref …]* and/or a text). Nothing is published until then. The email and text say when the coach must reply by: 48 hours after sending (`ASK_TTL_MS`). A lapsed list is kept another 14 days (`LATE_ASK_MS`) so a late reply is answered, never ignored (below). |
| **Coaches** `registered_at`, `phone_ok` | The coach's texts work: they texted the club number (`registered_at` is when) from the number in `phone_ok`. Empty, or a `phone_ok` that differs from `phone`, means the mobile is not confirmed (see *The setup checklist*, below). |
| **Coaches** `email_ok` | The address the coach last answered one of our emails from. When it differs from `email` (a new address in `CLUB_COACHES`), the email is not confirmed. |
| **Coaches** `phone_set_at` (ms) | When the club last set the mobile number on Coach Admin; only a text after this confirms the new number. |
| **Coaches** `rate_50`, `rate_25` | The coach's published lesson rates in whole dollars; empty means no rate listed. Set by the coach on the page and published by their YES (below), never typed in the Sheet. |
| **Coaches** `ask_rates` (JSON) | The rates in the list waiting for the coach's YES, only when that list changes them. Cleared with `ask_slots`. |
| **Requests** `rate` | The rate the student saw and confirmed for that lesson; empty when the coach listed none (and for requests made before rates). Every email about the lesson quotes this, even after the coach changes their rates. |
| **Coaches** `status = disabled` | The coach and all their times are hidden. The hourly sweep sets this for anyone not in `CLUB_COACHES` in `coaching-app/Code.js`, and for a club coach the coaching page does not show (Pending at USATT and not one of the club's exceptions, `showWhilePending` in `data/coach-certifications.json`, set on Coach Admin). It clears it for a club coach the page shows. The desk copies who is shown from the site to the hidden `CoachList` tab of its Sheet every hour; until that tab exists, or when it cannot be read, club coaches stay as they are. Add or remove a coach in `CLUB_COACHES` and the table on `coaching.html`, not in the Sheet. |
| **Availability** rows with `confirmed = yes` | Published times. A row is one slot: `minutes` 30 or 60, `table` 1 to 3. A 25-minute booking on a 60-minute slot splits it into two 30-minute rows. Two open 30-minute rows of one coach, back to back at one table, can be booked together as one 50-minute lesson: the request (`minutes` 60) covers both rows, which stay as they are and reopen as 30-minute times if it is cancelled, declined or expires. Past rows are deleted by the sweep. |
| **Waitlist** | People emailed (*A coaching time you wanted is open*) when a held time frees up; each is removed once told. |

**Lesson rates (from late November 2026).** A coach may list what they charge
for a 50-minute and for a 25-minute lesson, in the **Your lesson rates
(optional)** box at the top of their page (whole dollars, $1 to $500; an empty
box means no rate shown). Rates go out with the times: the same **Email me to
confirm** button, the same *Confirm your coaching times* list (*Confirm your
coaching times and rates*, or *Confirm your lesson rates* when only rates
change) with a line such as *Rates: 50 minute lesson: $… (was not listed)*,
the same text, and the same YES publishes both. So a stranger who picks a
coach on the page changes nothing, and rates cost no extra email or text. The
coach's *Done* reply ends *Your lesson rates: $… for 50 minutes, $… for 25
minutes.*

Students see a listed rate:

- in a **Lesson rates** box under the length buttons (each coach with times on
  the board, and *Coaches not listed here have not posted a rate* when some have
  none), and on each open time on the board (*$…*);
- under the time they pick (*Rate: $… for this 50 minute lesson, paid directly
  to Coach …*, or *Coach … has not listed a rate on the site*) and in the
  confirm box;
- in their emails: *Coaching request sent to …* and *Lesson confirmed* (and
  *Lesson back on*) have a **Rate** row; the *Confirm: move your lesson* email
  has a **New rate** row for the new time; the *confirmed* text adds *Rate: $…,
  paid to your coach.* The coach's request and confirmation emails have the same
  rate (*your listed rate, as the student saw it when they asked*).

The page sends the rate its confirm box showed. If the coach changed it since
the page loaded, nothing is sent and the page shows the new rate (§7). The
request keeps that rate (`Requests.rate`); a later change by the coach applies
to new requests only. A move takes the new time's rate when the student says
YES to it. The general *Payment* line (*Pay the lesson fee directly to your
coach…*) is unchanged.

**A late reply to a list** (after its 48 hours, within 14 more days), by email or text:

- **YES, and every time is still free:** the coach is told the reply came after
  the 48-hour window and that the times are all still open, and the same list
  is sent again with a new 48 hours (*Confirm your coaching times [CTTC ref …]*,
  with a new reference). One more YES publishes it.
- **YES, but another coach has since taken one of the times:** the coach is
  told which times were taken (and which were still open), that nothing was
  published, and to pick their times again on the coaching page (*Your
  coaching times were not published*).
- **NO:** the coach is told nothing changed.

Each is logged as `reply:coach-slots:yes` or `:no` with `not applied, now late,
offered again`, `late, taken` or `late, no`.

Students can only request times that are confirmed, **have not started yet**
(Pacific time; until November 2026 they had to be at least 24 hours away) and
are **at most 28 days ahead** (`HORIZON_DAYS`), on Fridays 7 to 10 PM or
Saturdays 3 to 6 PM Pacific. Emails ask students to cancel or move at least 24
hours ahead when they can (`CANCEL_NOTICE_HOURS`); that is not enforced.

### The setup checklist (the green ✓) and Coach Admin

A coach's button on the coaching page (*I am a coach*) shows a green ✓ only
when the coach is fully set up (`setupSteps_` in `coaching-app/Code.js`):

| Step | Done when | Not done |
| --- | --- | --- |
| Email | The coach has answered one of our emails (a list of times or a lesson request) from the address on file (`email_ok` = `email`). | *untested*: an address is on file but no answer has come from it; *missing*: no address. |
| Mobile | The coach has texted the club number from the number on file (`registered_at`, and `phone_ok` = `phone`). | *untested*, or *missing* (the app emails only). |
| Rates | Both lesson rates (50 and 25 minutes) are published, since a student may book either length with any coach. | *missing*. |

A changed address or number goes back to *untested* until the coach answers
from it, so the ✓ never stays on a contact nobody has tried. A coach with steps
left shows *Coach D · 2 steps left*; picking the name shows the checklist with
a button for each step not done:

- **Send me a test email** (`coachEmailCheck`): emails *Confirm your email for
  CTTC coaching [CTTC ref …]* to the address on file (the page shows only a hint
  of it, such as `t•••y@gmail.com`). Any YES or NO from that address within 48
  hours ticks Email (`email_check_at` holds when it was sent). At most one every
  10 minutes and 3 a day per coach; it only ever goes to the coach's own address.
- **Text COACH now**: an `sms:` link that opens the phone's Messages with the
  club number and COACH filled in, with the steps written out for a computer.
  The app cannot text a coach first (Google Voice only replies), so this is the
  coach's own text.
- **Set my rates**: scrolls to the rate boxes and puts the cursor in the first
  empty one. The ✓ changes nothing else: any coach with an email or
a mobile can offer times and be booked, as before.

When the checklist arrived (December 2026) the sweep looked back once through
the Log tab (its latest 500 rows): a coach who had already answered an email
from the address now on file keeps the email step, and a coach verified by text
before keeps the mobile step. The Log gets one `setup-steps-filled` row with
the counts.

**Coach Admin** (`coach-admin.html` on the site, the lock button on the
Coaching page; the desk's `?view=coaches`, `apps-script/CoachAdmin.js`) opens
only for the club's Google account. It lists every coach with the three steps,
and is the one place a coach's mobile number is set or removed: type the number,
**Review** (the coaching app checks it: a 10-digit US number, not another
coach's), then **Confirm**. The desk log records `coach_phone_set` with who, the
coach and the last four digits before and after; the coaching app's Log tab
records `coach-phone-set` with codes. A new number starts *untested*. Email
addresses are not set there: they are public on `coaching.html` and change in
`CLUB_COACHES` by a reviewed PR.

### Who is offered, and why (Coach Admin, USATT)

Each coach card on Coach Admin has a **USATT** line (Active with the coaching
level, or Pending, from `data/coach-certifications.json` on the site, which the
GitHub data update writes after checking USATT's Find a Coach directory:
`scripts/check-usatt-coaches.js`). A coach who is not offered, and a Pending
coach offered as the club's exception, has a box saying why, with the control
that fits (`coachOffer_` in `apps-script/CoachAdmin.js`):

| Why | Control |
| --- | --- |
| USATT certification pending (hidden from `coaching.html`) | **Offer while pending**: the desk starts the data update with `coach_exception: offer:<name>`, which adds them to `showWhilePending` and lists them on `coaching.html` as Pending (`scripts/coach-exception.js`). The exception ends by itself once USATT certifies them. |
| Offered as the club's exception | **Stop offering until certified** (`end:<name>`): hidden again; lessons already booked stay. |
| The page shows (or hides) them but the coaching app has not caught up (it follows within two hours: the desk's hourly copy to `CoachList`, then the coaching app's hourly sweep) | **Sync now**: the copy and the coaching app's sweep, at once. |
| Not on the club's coach list (`CLUB_COACHES`), or not in `coaching.html`'s table | None: that list changes only by a reviewed pull request, and the box says so. |

**Re-check USATT now** (above the cards) starts the data update with no
exception, so a coach USATT has just certified shows without waiting for the
next scheduled run. The data update takes about 10 minutes; GitHub keeps one
waiting run, so Coach Admin starts one change at a time, and shows a change the
page still does not show after 30 minutes as skipped, to be asked again. Each
control is previewed (Review) and done on Confirm, and recorded in the desk log
(`coach_exception_requested`, `coach_exception_end_requested`,
`usatt_recheck_requested`, `coach_list_synced`) with the coach; GitHub records
the change itself as a commit. It uses the GitHub token publishing already uses.

### The control center (Coach Admin, below the coaches)

The coach list folds away (**Coach management**, with how many are set up in
its summary line), and below it the control center shows every lesson and
request (`Requests` rows for lessons from 14 days ago on, and any still holding
a time), from the coaching app's `admin` call `overview` (`adminOverview_`):

- **Tiles:** waiting on coaches (requests to accept, lists of times to publish),
  waiting on students (a YES to a change), stuck, upcoming lessons, emails left
  today, and the app's health. A tile filters the list below.
- **Needs attention:** everything stuck or waiting, stuck first, each with its
  steps and controls. **All lessons:** by day, filtered (Upcoming, Waiting,
  Stuck, Past and closed, All) and searchable by booking code, student or coach.
- **Steps** (`lessonOverview_`): ✓ done, ● waiting on someone, ○ the app does it
  at its next run, **!** stuck. A step is stuck when it should have happened
  by now: an email or text for the booking's status still not sent 2 hours
  after the status changed (or never, once the sweep stopped retrying after 3
  days), a coach reminder overdue, or a deadline passed more than 2 hours ago
  without the sweep recording the expiry.
- **Today and yesterday:** the daily summary's counts (`dayCounts_`, shared
  with the email), the waitlist, the app's health (last sweep and check,
  failing steps, emails left, the summary, timer run time) and the latest 25
  lines of the Log tab.

Each control asks the coaching app first (**Review**: what it would do, and
nothing changes), then does it on **Confirm** (`adminAct_`). Each one moves a
booking only through the app's own steps, so the usual emails, texts, public
schedule and Log lines follow. Each one done is a `club-action:<kind>` row in
the Log tab (codes only) and a `coaching_<kind>` entry in the desk log with
who, when, and the booking code or coach.

| Control | When | What it does |
| --- | --- | --- |
| Accept / Decline for the coach | `pending` | The coach's YES or NO, applied by the club (channel `club`: it never ticks the coach's email or mobile). Use only when the coach told the club. |
| Remind the coach now | `pending` | The coach's request email again, marked *Reminder* (and the text, if it is the question open by text). The automatic reminder still goes. |
| Cancel for the coach | `confirmed`, not started | `cancelled_by = coach`. The coach's confirmation email tells them to reply to the club to cancel; this is how the club does it. The student gets *Lesson cancelled by your coach* (and a text if they get texts), the coach *Lesson cancelled*, and the time opens again. |
| Apply / Drop the student's change | a cancel or move waiting for the student's YES | Their YES or NO, applied by the club; a move that lost its time is refused. |
| Confirm for the student / Drop the request | `unverified` (before November 2026) | The student's YES or NO. |
| Resend the student's / coach's email | any status with an email | The email for the step it is at, again, as it reads now. |
| Publish / Drop for the coach | a list of times waiting for the coach's YES | Their YES (publishes times and rates; they get the usual email) or NO. |
| Run the sweep and the check | any time | What the hourly run does, now: expiries, unsent messages, due reminders, the public schedule, then new replies. |
| Send the daily summary now | any time | Today's summary email as it stands; the usual one still goes. |
| Test email / text to a coach | a coach offered on the page | The test email the coaching page sends (its YES ticks the email step), or a text from the club number (only to a coach who has texted it). One every 10 minutes per coach; at most 3 test emails a day. |

## 6. How the website shows the app

The **Coaching** page's button opens the site's own copy of the page,
`coaching-app.html`, which the deploy workflow publishes from
`coaching-app/Index.html`. That copy calls the app at
`https://script.google.com/macros/s/AKfycbywI5OV0aaitPbzchxfyJUK4Q6_uLbFpF39O_cq8fLikbSO5Sy_NW3B3R-NlPtTS2YdTw/exec`
(`API_URL` in `Index.html`) with `fetch` and **no cookies** (`doPost`, which
answers only the page's seven calls). Nobody needs a Google account, and a
browser signed in to several Google accounts cannot trip Google's "Sorry,
unable to open the file at this time" page. Until 2026-10-22 the button framed
Google's page host directly, and some members got that page instead of the
app. The same page still works served by Google at that address (with
`google.script.run`).

If the copy's first call gets no answer from the app (for example the site was
deployed before the `/exec` release that added `doPost`), the copy hands over to
Google's own page, as the button worked before. A change to `Index.html`
reaches the website with the next site deploy (any push to `main`), and a change
to `Code.js` with the usual `/exec` release.

| Symptom | Check |
| --- | --- |
| A member sees "Sorry, unable to open the file at this time" | The copy handed over to Google's page: the `/exec` release with `doPost` is not out yet, or the app did not answer. Open `/exec?log` to see whether the app runs. |
| The page stays on "Loading" | Open `concordtabletennisclub.com/coaching-app.html` directly; a blank page or a console error points at the page, a "Something went wrong" message at the app. |

## 7. What the page said, and what it means

Each form shows its answer right under its own Send button (and at the top of the page), scrolls to it, and outlines and
focuses the field to fix. Before 2026-10-10 errors appeared only at the top of the page, which on a phone is usually off
screen, so a refused request looked like nothing happened.

| Message on the page | What happened |
| --- | --- |
| A box *Send this request to Coach …?* with **Confirm submission** and **Go back** | Nothing is sent yet. Only Confirm submission sends it. |
| "Did you mean …?" under the email box or in the confirm box | A likely typo in the address (§1). Nothing is sent or blocked; **Keep mine** keeps what was typed. |
| "Request sent to Coach … It is not booked until Coach … accepts. We emailed a copy to …" | Saved as `pending`. Waiting for the coach. |
| "Almost done: we emailed you… Reply YES… within 2 hours" | Only from an app released before November 2026 (the site's page can be a release ahead of the app): saved as `unverified`, waiting for the student. |
| "Coach …'s rate for a 50 minute lesson is now $… Nothing was sent." (or "…no longer lists a rate…") | The coach changed their rate after the page loaded. The page now shows the new rate; pressing Send request again sends the request at that rate. |
| Coach page: "Please enter your 50 minute rate in whole dollars, from $1 to $500, or leave it blank." | The rate box holds cents, words or a number out of range. Nothing was sent. |
| "Student … already has a lesson (or a request) at that time…" | The same student (email and name) already holds an overlapping time. Use Move on that time instead. |
| "That time is no longer available. Please pick another." | Someone holds that time, **including the same student's own earlier request**. Look for an existing row before assuming a bug. |
| "Please enter the parent or guardian's name…" / "Please check the parent or guardian name…" | "The student is under 18" is ticked and the guardian name is blank, or has numbers or symbols. Names may use letters, spaces and `- ' . , & / ( )`. |
| "You already have 2 requests waiting for an answer." | The student has 2 `unverified`/`pending` rows (`MAX_OPEN_REQUESTS_PER_STUDENT`). |
| "Too many requests right now." | More than 30 calls in a minute across the whole app (`MAX_PER_MINUTE`). |
| "Requests are closed for now." | The Requests or Students tab hit its size cap (`MAX_REQUESTS`, `MAX_STUDENTS`). |
| "Something went wrong. Please try again." | The server threw an error (the page never shows the real message). Look in the Apps Script editor, **Executions**, for a failed `requestSlot`, `studentChange` etc. **Before the fix in this branch** a request could be saved and still show this (see §8). |

## 8. Known failure modes

| Symptom | Likely cause | Check | Fix |
| --- | --- | --- | --- |
| Page said "Something went wrong", retries say the time is taken, but a "requested" row exists for the student | Before `fix(coaching): never report a saved lesson request as a failure`, an error *after* saving (email, text, public Sheet rebuild) was shown as a failure. | Row is `unverified`; `student_emailed` may be empty. Executions show a failed `requestSlot`. | Fixed in code. For the stuck case, the next sweep sends the confirm email if it has not gone out. The student replies YES before `expires_at`. |
| Student replied UNDO but the lesson stayed cancelled | Too late (the lesson had started, or 3 days had passed), another student booked the time first, the coach no longer offers it, or the reply was not read (another address, edited subject, first line not UNDO). | `?log=<code>`: `reply:student-u:undo` with `not applied, now cancelled (…)` says why, and the student was emailed it. No such line: the reply was not read (§4). | They book the time again on the page if it is open. |
| Student says they replied YES to a cancel or move but nothing changed (or, before November 2026, a request is still `unverified`) | Reply not recognised (§4): different address, edited subject, a first line that does not start with yes, or too late. Check the status read-out for `unreadable=`. | Find the reply in the club Gmail. | Ask them to reply to the original email with just `YES`, or ask again from the page. |
| Student never got any email about their request | The address was mistyped (the confirm box shows it large and points out likely typos, but it can still be wrong), or it went to spam. | `student_email` on the row; `student_emailed = pending` means it went out. | The coach has the address the student typed in their request email; correct it by cancelling and booking again. |
| Row is `pending` for a long time | Coach has not answered, or their answer was not recognised (§4). | Coach Admin: the booking's steps show what was sent and when the reminder went. | **Remind the coach now** on Coach Admin; if they answered the club another way, **Accept** or **Decline for the coach**. |
| Coach never gets texts | They never texted the club number, or the Voice contact name/number does not match the list. | Coach Admin: the coach's **Mobile** step is not ticked, or no number is on file. | Have them text `COACH` to the club number; set or correct the number on Coach Admin (Review and Confirm). |
| No emails at all for a while | Daily mail quota low (sending pauses at 10 left), or Gmail/MailApp errors. | Coach Admin: **Emails left today**, and bookings marked **Stuck** with an email not sent. | Wait for the quota reset; the sweep retries for 3 days. After that, **Resend** on the booking. |
| A coach asks the club to cancel a confirmed lesson | Their confirmation email tells them to reply to the club. | The booking on Coach Admin. | **Cancel for the coach** on Coach Admin. |
| A time is missing from the board | It has started (Pacific time), so it no longer takes requests. Expected. ("Closed (less than a day ahead)" is only shown by an app released before November 2026.) | `date`/`start`. | None in the app. |
| Public Sheet out of date | It is rebuilt only after changes and hourly; a failed rebuild is logged, never fatal. | Executions log for "Could not update the public schedule". | **Run the sweep and the check** on Coach Admin. |

## 9. Timing reference

| Constant | Value | Effect |
| --- | --- | --- |
| `HOLD_HOURS` | 48 hours | max time for the coach's YES |
| `RELEASE_BEFORE_HOURS` | 12 hours | a waiting request expires this long before the lesson |
| `MIN_ANSWER_MS` | 2 hours | when 12 hours before the lesson would leave the coach less than this, the request waits until the lesson starts |
| `CANCEL_NOTICE_HOURS` | 24 hours | the notice emails ask for before a cancel or move (not enforced) |
| `HORIZON_DAYS` | 28 days | how far ahead times can be offered or requested |
| `ASK_TTL_MS` | 48 hours | a coach's submitted list of times lapses |
| `CHANGE_WAIT_MS` | 10 minutes | gap between move requests for one lesson |
| `UNDO_MS` | 3 days | how long a student can reply UNDO to a lesson cancelled on the page (never after the lesson starts) |
| `REMIND_COACH_MS` | 2 hours | when the one reminder to the coach goes out (halfway to the deadline, if sooner) |
| `RETRY_MAIL_DAYS` | 3 days | unsent messages are retried this long |
| Timers | `sweep` hourly, which also runs the check; the desk's mail reader wakes the check when a text or email reply comes in | replies are picked up within about 5 minutes by day (a minute during round robin sign-up, 30 at night), at most an hour if a wake is missed |
