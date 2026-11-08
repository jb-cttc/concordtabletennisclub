# Google limits and scheduled jobs

Every club app runs as the one club Google account (a free gmail.com account), so
**all of them share one set of daily Google limits**. A limit that runs out stops
every app at once, not just the one that used it up. In October 2026 the Gmail
allowance ran out on round robin nights because four apps each searched the same
texts every minute; each app looked cheap on its own.

Before adding or changing anything that runs on a timer, reads Gmail, sends email,
or calls the web, check the budget below for **all** the apps together, and update
this page in the same pull request.

Limits from [Google's quota page](https://developers.google.com/apps-script/guides/services/quotas)
(free account, per day unless noted):

| Limit | Allowance | What uses it | Guard | Where to see it |
| --- | --- | --- | --- | --- |
| **Timer run time** | 90 minutes a day, every app's timers together | Each timer run, even one that finds nothing to do, including the run's own timer calls (each is slow). Page calls (`google.script.run`, web requests, the desk's wakes of coaching and staffing) do not count. | Timers wake only when work is due (below), and a quiet run changes no timer. Each run is measured; past 45 minutes the desk log warns (`trigger_time_high`), past 60 the desk reads mail a third as often for the rest of the day. | `JobRuntime` tab in the desk Sheet; desk log `job_runtime_day` |
| **Gmail reads** | 20,000 calls | The desk's mail reader; replies to texts; coaching and staffing emailed YES/NO answers | One reader for every app, reading only new mail; a quiet read is one call. Past 6,000 calls it reads at most every 5 minutes and the desk log warns (`gmail_reads_high`). | `MailReader` tab (`gmail_calls`); desk log `mail_reader_day` |
| **Email recipients** (`MailApp`) | 100 | Coaching and staffing emails, club alerts; the owner's daily summary (1 a day, sent by coaching, with the volunteer app's part in it). A volunteer email listing everything waiting is likewise the same email with more in it. A coaching email that lists everything waiting for a student's YES is the same email as before with more in it, so it adds none, and one YES to it can save the separate replies and their follow-ups. Volunteer Admin (the desk's `?view=volunteers`) sends one email per person whose shifts the club changed in a submission, and refuses a submission that would leave fewer than the reserve (`MIN_QUOTA`) for the day. The Friday and Saturday special (November to December 2026) adds at most one *Good news: you play free* email per volunteer who moves up into a free spot after someone ahead drops or never confirms (a few a week at most); the confirmation and reminder emails say who plays free inside the email they already send. A new coaching request (November 2026) sends 2 emails at once, the coach's request and the student's copy, plus 2 more (coach reminder, student update) only if the coach has not answered in 2 hours; before, the student's confirm email, its reminder and the reply it needed added up to 2 more emails and a Gmail read per request | Both apps stop sending at 10 left (`MIN_QUOTA`); the hourly sweep retries for 3 days; the summary is skipped (and tried the next hour) below 10 | Coaching and staffing `Log` tabs (`daily-summary` for the summary) |
| Gmail SMTP sending | 500 messages | The results email (`scripts/send-session-email.js`, from GitHub) | One send per finalized session, to the subscriber list | GitHub Actions run log |
| Web requests (`UrlFetchApp`) | 20,000 calls | Clover API, the club site's data files, closures, GitHub dispatch; the desk waking coaching and staffing (at most one call per app per mail read, a few hundred a day at most); the desk reading the site's coach file for the coaching app (`CoachList.js`, 24 a day); Volunteer Admin, 1 call when the page opens and 2 or 3 per Review and Submit (only when the club uses it) | Cached (site files 1 hour, closures 1 hour, coach file 1 hour, Clover customers 6 hours); wakes only when a text or an app's email reply came in | Executions page; desk log `app_wakes_day`, `coach_list_changed` |
| Settings reads and writes (`PropertiesService`) | 50,000 | Every app's timers and pages keep small state in script properties; the desk keeps each night's sheets-printed mark and its moved-up arrows in the Sheet's document properties (one read for both per desk load or once-a-minute refresh, about 240 a night per open desk; one write per print, Clear labels, Undo the print or move up a group) | Each timer run reads a setting once, never in a loop (a 30-step loop at about 900 runs a day would be 27,000) | Not measured |
| One run | 6 minutes | Any timer or page call | Work is read in pages; slow steps take no lock | Executions page |
| Timers per app | 20 | Each app's timers | Each job keeps one repeating timer and at most one one-off timer, replacing it each run | Apps Script **Triggers** page |

Run time is measured from when our code starts, so Google's start-up time for each
run is not included: the real total is somewhat higher than `JobRuntime` shows.

The Equalizer ([operations](equalizer-operations.md)) adds no timers, Gmail reads,
emails or web requests: each change at the desk (the setup, a result, the Round
robin | Equalizer switch) is one page call, like a round robin save, and a page call
does not count toward timer run time.

The Player board (the desk's TV window) makes no Google calls at all: the desk page
draws it from what it already holds, and its slides run on the computer's own clock.
The desk shares the round robin's sheets-printed mark (`saveSessionPrint`): one
page call per print, and the mark rides along with the desk's existing
`getAppState` load and refresh, so it adds no calls, only the settings read above.

**Follow mode** (a second computer's Player board following the main desk) runs
only on a computer whose board was answered *Show the main laptop's desk* (asked
once per computer; *Follow the main desk* on the board changes it), and only while
that board is open. A board opened before its desk has loaded retries locally
with no Google calls; one opened before the main desk starts the night checks
from then on, so an early setup adds about six stamp checks a minute (once a
minute after 20 quiet minutes) until the night starts, within the same 6-hour
cap. The saves the
desk already makes also set a tiny change stamp in the script cache, after the
save lets go of the script lock (sessions, payments, the Equalizer, player
corrections; `touchDesk_` in `SessionIds.js`). A switch between the round robin
and the Equalizer also notes which event the main desk shows, in the same cache
(`noteDeskEvent`, one cache write per switch), so the follower shows the same one
even when the switch moves no players. **Projector screen** on the main desk
(`setFollowScreen`) is one cache write per choice, returned with the same stamps,
so it adds no calls on the following desk. The desk's directory (`listPlayers` with no rows) also reads the
small `EqualizerRatings` tab for EQ ratings: one extra Sheet read per directory
load, no new timers or mail. **Refresh projector** is one cache write per click
(`requestFollowRefresh`), returned with the same stamps; the follower then reads
the night once, as when follow mode starts. The following desk asks for the
stamps (`getDeskStamps`, a cache read: no Sheet, Gmail or settings reads) every
10 seconds, once a minute after 20 quiet minutes, and reads only the part that
moved: the night's session and marks (`getFollowState`, which skips the player
directory and rating ledger `getAppState` reads), the payments without the Zeffy
mail, the Equalizer, or the directory. It never takes the script lock, has at
most one call in flight, and pauses that desk's own once-a-minute Open Play and
voice sign-up checks. It ends when the night is finalized or after 6 hours, and
logs its checks and reads to the desk log (`follow_mode`) every 30 minutes and
when it ends.

Measured on the desk simulator, a 2.8-hour round robin night (40 sign-ins, 40
payments, 95 matches) cost the following computer 997 stamp checks, 136 session
reads, 80 payment reads and 2 full loads (when follow mode started); the main
desk made exactly the calls it makes without follow mode. For 3 hours, 4 nights
a week, that is at most about 4,300 stamp checks and 900 reads a week:

| Limit | Follow mode adds | Allowance |
| --- | --- | --- |
| Timer run time | nothing (page calls only, no timers) | 90 min a day |
| Gmail reads, emails, web requests | nothing | 20,000 / 100 / 20,000 a day |
| Settings reads | about 140 a night (one per session read) | 50,000 a day |
| Settings writes | one per print and per move up | 50,000 a day |
| Script lock | never taken | (saves wait on it) |
| Desk log rows | about 7 a night | 2,000 kept |

## Scheduled jobs

Google can repeat a timer only at a fixed rate (1, 5, 10, 15 or 30 minutes, or
hours), and every timer call (listing, creating or deleting one) is slow and
counts toward the run that makes it. So a job whose needs change during the day
keeps **one repeating timer** at the pace due now and replaces it only when the
pace changes; a job whose work comes from mail has **no timer of its own** and
is woken by the desk's mail reader with a web request, which does not count.

| App | Job | Wakes | Runs a day (estimate) |
| --- | --- | --- | --- |
| Desk | Mail reader (`readMail`, one repeating timer), then automatic answers when a new text came in, then wakes coaching and staffing when something came in for them, then (hourly, inside the same run) copies who the coaching page shows to the hidden `CoachList` tab | Every minute in the 4 hours before a round robin's sign-up closes (3:15 to 7:15 PM Mon/Wed; 11:15 AM to 3:15 PM Saturday pilot); every 5 minutes otherwise by day, and from 6 AM on a round robin day; every 30 minutes from 11 PM to 7 AM. The timer speeds up one run ahead of a busier stretch. | Mon/Wed and Saturday about 415; other days about 215 |
| Desk | Rating sync (`syncRatingsFromPublicSite`), if its hourly timer is on | Hourly | 24 |
| Desk | Publish backup (`publishDue`) | One-off, only after a session is finalized | 0 to 3 |
| Coaching | Sweep (`sweep`, which also switches club coaches on or off to match the desk's `CoachList` tab, one extra Sheet read), then the reply check. The first sweep after 7 AM Pacific also sends the owner's daily summary (three Sheet reads it already makes; no Gmail reads) | Hourly. In between, the desk wakes the check (not timer time) when a text or an email reply came in. | 24 |
| Staffing | Sweep (`sweep`), then the reply check, then this app's part of the owner's daily summary (one write to a hidden `StaffingDigest` tab of the desk Sheet) | Same as coaching | 24 |
| Turnout | none | Only when the Tonight page asks (cached 60 seconds) | 0 timer runs |

**Measured before this design** (Wednesday 28 October 2026, a round robin day,
`JobRuntime` at 4:20 PM): desk 184 runs, 3.9 seconds each; coaching 86 runs, 9.2
seconds; staffing 66 runs, 5.9 seconds; 32 minutes by 4:20 PM and about 60 by
midnight. Runs took 2 to 5 times longer than first assumed, and most of them
found nothing to do. Coaching and staffing's own checks (every 2 to 15 minutes)
were 62% of it; every desk read also listed, deleted and made a timer.

**Expected now:** about 465 timer runs on a round robin day (415 desk, 24 each
for coaching and staffing) and about 265 on other days, against about 750 and
600 before. If a quiet desk read drops to 2 to 3 seconds without its timer
calls, and a coaching or staffing hourly run takes 10 to 15 seconds, a round
robin day is roughly 25 to 35 minutes of the 90 and another day 15 to 20, plus
a second or two of desk time for each wake. The `JobRuntime` tab shows the real
figure; Google's start-up time for each run is not in it, so the real total is
somewhat higher. If it regularly passes 45 minutes, look first at whichever
app's row is largest there.

## Things only the club account can do in Google

These cannot be done from code or from a Claude session, so a change that needs
one must say so in its pull request, before it is built:

- Script properties in each Apps Script project (for example `DESK_SHEET_ID`).
- Approving new permissions (scopes) when a project first asks for them.
- Sharing a Sheet with someone, or changing the service account's access.
- Turning on a Google API for the club's Google Cloud project.
