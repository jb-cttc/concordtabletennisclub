// Coach Admin (?view=coaches, framed by the club site's coach-admin.html): the club's own page for the coaches. Like the rest
// of the desk it opens only for the club's Google account. It shows each coach's setup checklist (the green check on the
// coaching page: an email they have answered from, a mobile they have texted from, both lesson rates), and is where the club
// sets a coach's mobile number, after a Review and Confirm step. Emails are not set here: they are public on coaching.html and
// change in CLUB_COACHES (coaching-app/Code.js) by a reviewed PR.
//
// The coaching app (coaching-app/) owns its Sheet and its rules, so this page asks it for everything through its web address
// (fn 'admin'), with the same admin key Volunteer Admin uses (volunteerAdminKey_, AppWake!B2). Each mobile number change is
// recorded in the desk log (who, when, the coach, and the last four digits before and after); the coaching app's own Log tab
// records it too, as codes.
var COACH_ADMIN_URL_ = 'https://script.google.com/macros/s/AKfycbywI5OV0aaitPbzchxfyJUK4Q6_uLbFpF39O_cq8fLikbSO5Sy_NW3B3R-NlPtTS2YdTw/exec';

function coachAdminPage_() {
  return HtmlService.createHtmlOutputFromFile('CoachAdminPage')
    .setTitle('CTTC Coach Admin')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// One call to the coaching app. Its own refusals (a number it cannot take) come back as they are; anything else is an error.
function coachAdminCall_(body) {
  var response = UrlFetchApp.fetch(COACH_ADMIN_URL_, { method: 'post', contentType: 'text/plain', muteHttpExceptions: true, followRedirects: true,
    payload: JSON.stringify(Object.assign({ fn: 'admin', key: volunteerAdminKey_() }, body)) });
  var answer = null;
  try { answer = response.getResponseCode() === 200 ? JSON.parse(response.getContentText()) : null; } catch (error) { answer = null; }
  if (!answer) throw new Error('The coaching app did not answer. Try again in a minute.');
  if (!answer.ok && answer.message === 'Unknown request.') throw new Error('The coaching app does not know this desk yet: it needs the release with Coach Admin.');
  return answer;
}

// The page's data: every coach with their contacts, rates and checklist.
function getCoachAdmin() {
  return coachAdminCall_({ action: 'coaches' });
}

function coachAdminPhone_(coachId, phone, preview) {
  if (!/^[a-f0-9]{16}$/.test(String(coachId || ''))) throw new Error('That coach was not found. Reload the page.');
  var typed = String(phone == null ? '' : phone).trim();
  if (typed.length > 40) throw new Error('That is not a phone number.');
  var answer = coachAdminCall_({ action: 'phone', coachId: coachId, phone: typed, preview: preview });
  if (!preview && answer.ok) {
    var last4 = function (number) { var digits = String(number || '').replace(/\D/g, ''); return digits ? '…' + digits.slice(-4) : 'none'; };
    appendAudit_('coach_phone_set', 'coaching', coachId, { coach: answer.name, before: last4(answer.before), after: last4(answer.after) });
  }
  return answer;
}

function previewCoachPhone(coachId, phone) { return coachAdminPhone_(coachId, phone, true); }
function setCoachPhone(coachId, phone) { return coachAdminPhone_(coachId, phone, false); }
