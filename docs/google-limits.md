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
| **Timer run time** | 90 minutes a day, every app's timers together | Each timer run, even one that finds nothing to do. Page calls (`google.script.run`, web requests) do not count. | Timers wake only when work is due (below). Each run is measured; past 45 minutes the desk log warns (`trigger_time_high`), past 60 every app runs its timers a third as often for the rest of the day. | `JobRuntime` tab in the desk Sheet; desk log `job_runtime_day` |
| **Gmail reads** | 20,000 calls | The desk's mail reader; replies to texts; coaching and staffing emailed YES/NO answers | One reader for every app, reading only new mail; a quiet read is one call. Past 6,000 calls it reads at most every 5 minutes and the desk log warns (`gmail_reads_high`). | `MailReader` tab (`gmail_calls`); desk log `mail_reader_day` |
| **Email recipients** (`MailApp`) | 100 | Coaching and staffing emails, club alerts | Both apps stop sending at 10 left (`MIN_QUOTA`); the hourly sweep retries for 3 days | Coaching and staffing `Log` tabs |
| Gmail SMTP sending | 500 messages | The results email (`scripts/send-session-email.js`, from GitHub) | One send per finalized session, to the subscriber list | GitHub Actions run log |
| Web requests (`UrlFetchApp`) | 20,000 calls | Clover API, the club site's data files, closures, GitHub dispatch | Cached (site files 1 hour, closures 1 hour, Clover customers 6 hours) | Executions page |
| Settings reads and writes (`PropertiesService`) | 50,000 | Every app's timers and pages keep small state in script properties | Each timer run reads a setting once, never in a loop (a 30-step loop at about 900 runs a day would be 27,000) | Not measured |
| One run | 6 minutes | Any timer or page call | Work is read in pages; slow steps take no lock | Executions page |
| Timers per app | 20 | Each app's timers | Each job keeps one repeating timer and at most one one-off timer, replacing it each run | Apps Script **Triggers** page |

Run time is measured from when our code starts, so Google's start-up time for each
run is not included: the real total is somewhat higher than `JobRuntime` shows.

## Scheduled jobs

Google can repeat a timer only at a fixed rate (1, 5, 10, 15 or 30 minutes, or
hours). A job whose needs change during the day therefore keeps a **30-minute
repeating timer** (which covers the night and restarts the chain if a run ever
fails) and, at the end of each run, sets a **one-off timer** for when its next
piece of work is due. It never wakes just to find nothing to do.

| App | Job | Wakes | Runs a day (estimate) |
| --- | --- | --- | --- |
| Desk | Mail reader (`readMailWatch` every 30 minutes; one-off `readMail`), then automatic answers when a new text came in | Every minute on a round robin day from 6 AM until sign-up closes; every 5 minutes otherwise by day; every 30 minutes from 11 PM to 7 AM | Mon/Wed about 890; Saturday pilot about 700; other days about 240 |
| Desk | Rating sync (`syncRatingsFromPublicSite`), if its hourly timer is on | Hourly | 24 |
| Desk | Publish backup (`publishDue`) | One-off, only after a session is finalized | 0 to 3 |
| Coaching | Check (`checkTextsWatch` every 30 minutes; one-off `checkTexts`) | Every 2 minutes by day while a coach or student owes an answer, else every 15; 30-minute timer only from 11 PM to 7 AM; a question sent brings it within 2 minutes | About 110 with nobody waiting; up to about 530 |
| Coaching | Sweep (`sweep`) | Hourly | 24 |
| Staffing | Check (`checkRepliesWatch` every 30 minutes; one-off `checkReplies`) | Same rules as coaching (an answer is owed: an open email or text question, or a request waiting on the club) | About 110 with nobody waiting; up to about 530 |
| Staffing | Sweep (`sweep`) | Hourly | 24 |
| Turnout | none | Only when the Tonight page asks (cached 60 seconds) | 0 timer runs |

A typical round robin day is about 1,100 to 1,200 timer runs, and 2,000 at most
if coaching and staffing both have answers owed all day. At 1 to 2 seconds a run
that is roughly 20 to 65 minutes of the 90. The `JobRuntime` tab shows the real
figure; if it regularly passes 45 minutes, the first thing to narrow is the desk's
every-minute stretch on round robin days, which is the largest share.

## Things only the club account can do in Google

These cannot be done from code or from a Claude session, so a change that needs
one must say so in its pull request, before it is built:

- Script properties in each Apps Script project (for example `DESK_SHEET_ID`).
- Approving new permissions (scopes) when a project first asks for them.
- Sharing a Sheet with someone, or changing the service account's access.
- Turning on a Google API for the club's Google Cloud project.
