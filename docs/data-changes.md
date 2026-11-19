# Changing the club's data

The club's Google Sheets (the round-robin desk Sheet, and the coaching,
staffing, turnout and subscribe apps' private Sheets) are databases. **Nobody
types into them, the owner included**, and no doc, PR, issue, email, app
message or agent answer may tell anyone to. See *Never edit the Sheets by hand*
in [AGENTS.md](../AGENTS.md). `npm run check:sheet-edits` (part of `npm test`)
fails when a doc, skill, storyboard step or app message tells someone to type
into, fix, add or delete Sheet rows, cells or tabs.

Reading is fine (`npm run sheet:read`, the apps' log pages). Script Properties
and the Apps Script editor's Run button are owner steps in Google, not Sheet
edits, and are named where needed.

When data is wrong, look it up below:

- **A control exists:** point to it.
- **None exists:** it is a missing feature. Say so, and propose or build the
  form listed under [Missing controls](#missing-controls). Never offer a Sheet
  edit as a stopgap.

## Where each kind of data is changed

| Data | Change it with | Code |
| --- | --- | --- |
| A player's name, rating or email | The desk: the pencil beside the name in the player directory, **Review changes**, then **Confirm and save** | `apps-script/PlayerEdits.js` |
| Other names a player goes by (Google Voice contacts, Zeffy or Clover names, old spellings) | The same pencil window, **Other names** | `apps-script/PlayerEdits.js` |
| Junior and member account, **Pays for** | The same pencil window, **Links** | `apps-script/LinkedNames.js` |
| Member, junior or visitor badge | The desk's badge on the player's row | `apps-script/MemberStatus.js` |
| A night's roster, groups and scores | The desk | `apps-script/SessionService.js` |
| How a player paid | The payment button on the player's row at the desk | `apps-script/PrivatePayments.js` |
| A Clover payment matched to the wrong player | The desk's Clover section: **Undo** under Matched | `apps-script/CloverPayments.js` |
| A card remembered for the wrong player | The player's pencil window, **Clover cards**, or **Cards linked to players** on the Clover payments page: **Unlink…**, then **Confirm and unlink** | `apps-script/CloverPayments.js` |
| Cash counted at the end of a night | The cash flow page (`?view=cash`) | `apps-script/CashFlow.js` |
| Volunteer shifts (add, move, remove) and who is trained | **Volunteer Admin**, then **Review emails** and **Submit** | `apps-script/VolunteerAdmin.js`, `staffing-app/Code.js` |
| A volunteer's NO, or a reply the app could not read | The staffing setup page: **Correct a volunteer's answer** | `staffing-app/Code.js` |
| An email a volunteer asked to use | The club's YES or NO reply to *Approve an email for staff sign-ups* | `staffing-app/Code.js` |
| A closed night | `data/closures.json` in this repository (a PR), which the home page, the volunteer app and the desk read | `staffing-app/Code.js` |
| Which coaches can offer lessons | `CLUB_COACHES` in `coaching-app/Code.js`, the table on `coaching.html` and `data/coach-certifications.json` (a PR) | `coaching-app/Code.js` |
| A coaching request or lesson | The student: **Mine** on the booking page (a request is cancelled at once; a lesson is cancelled or moved by their emailed YES). The coach: YES or NO to the request | `coaching-app/Code.js` |
| A results email subscriber | The subscriber: the **Unsubscribe** link in any results email, or `unsubscribe.html`, which emails them a link | `subscribe-app/Code.js` |

## Missing controls

Corrections that have no control yet, so nobody can make them today. Each
needs a form built like the others:

- **Who may use it:** the club account only.
- **What it checks:** listed per form below.
- **Review and Confirm:** the change is shown before it is saved.
- **A record:** who, when, before and after, where the desk log or a tab
  shows it.

| Correction | The form to build | Where |
| --- | --- | --- |
| Two directory names that are the same person (`same_person` name links) | The pencil window's **Links**, as for juniors and **Pays for**: the other name picked from the directory, one record per person | The desk |
| A volunteer's email or mobile on file (they changed address, or a confirmation went to an old one) | **Volunteer Admin**: change the email and mobile on file. It checks the address, shows the old one struck through and the new one, and marks the old row `replaced` | The volunteer app |
| A coach's mobile number (texts to coaches) | A coach list with name, email and mobile on the coaching page or the desk. The number is checked as a US mobile, and the record is kept in the coaching app's Log | The coaching app |
| The club cancels a confirmed lesson for a coach | **Cancel for the coach** on the club's view of the coaching board. It emails the student (*Lesson cancelled by your coach*) and records `cancelled_by = coach` | The coaching app |
| The club removes a subscriber (asked in person, or the address bounces) | The **Email list** page (`?view=subscribers`): **Remove**, with Review and Confirm and a confirmation email to the address | The desk and the subscribe app |

Until one is built, nobody makes that correction. Say plainly that the control
does not exist yet, and point to this list.
