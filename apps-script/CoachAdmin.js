// Coach Admin (?view=coaches, framed by the club site's coach-admin.html): the club's own page for the coaches. Like the rest
// of the desk it opens only for the club's Google account. It shows each coach's setup checklist (the green check on the
// coaching page: an email they have answered from, a mobile they have texted from, both lesson rates), and is where the club
// sets a coach's mobile number, after a Review and Confirm step. Emails are not set here: they are public on coaching.html and
// change in CLUB_COACHES (coaching-app/Code.js) by a reviewed PR.
//
// Below the coaches is the control center: every lesson and request with its steps and anything stuck, the coaching app's health
// and the day counts of the owner's daily summary, and controls that move a booking on through the app's own steps (answer for
// a coach or student who told the club, resend an email, run the sweep, send a test email or text, send the summary now). Each
// control is previewed (Review) before it is done (Confirm), and each one done is recorded in the desk log (who, when, what,
// the booking code or coach, and the result).
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
  if (!answer.ok && answer.message === 'Unknown request.') throw new Error('The coaching app does not know this request yet: it needs its latest release.');
  return answer;
}

// The page's data: every coach with their contacts, rates and checklist, and what USATT and the coaching page say about them
// (coachOffers_). If the site's coach file cannot be read, the coaches still come, with usatt saying why it is missing.
function getCoachAdmin() {
  var answer = coachAdminCall_({ action: 'coaches' });
  if (!answer.ok) return answer;
  try {
    answer.usatt = coachOffers_(answer.coaches || [], false);
  } catch (error) {
    answer.usatt = { ok: false, message: 'The USATT status could not be read from the club site just now (' + error.message + '). Reload in a minute.' };
  }
  return answer;
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

// The control center's data (coaching app 'overview'), read only.
function getCoachingOverview() {
  return coachAdminCall_({ action: 'overview' });
}

// The controls the coaching app knows (ADMIN_ACTIONS in coaching-app/Code.js), and what each is about: the app, a coach or a lesson.
var COACHING_ACTIONS_ = {
  sweep: 'app', summary: 'app',
  'test-email': 'coach', 'test-text': 'coach', 'publish-times': 'coach', 'drop-times': 'coach',
  accept: 'lesson', decline: 'lesson', remind: 'lesson', 'cancel-coach': 'lesson', 'apply-change': 'lesson', 'drop-change': 'lesson',
  'confirm-request': 'lesson', 'drop-request': 'lesson', 'resend-student': 'lesson', 'resend-coach': 'lesson'
};

function coachingAction_(kind, id, preview) {
  kind = String(kind || '');
  if (!Object.prototype.hasOwnProperty.call(COACHING_ACTIONS_, kind)) throw new Error('That control is not known. Reload the page.');
  var about = COACHING_ACTIONS_[kind];
  id = about === 'app' ? '' : String(id || '');
  if (about !== 'app' && !/^[a-f0-9]{16}$/.test(id)) throw new Error('That was not found. Reload the page.');
  var answer = coachAdminCall_({ action: 'act', kind: kind, id: id, preview: preview });
  // Who and when come with every audit entry; what it was about is the booking code (shown in the desk log) or the coach.
  if (!preview && answer.ok) appendAudit_('coaching_' + kind.replace(/-/g, '_'), 'coaching', id || 'app', Object.assign({ about: about }, answer.record || {}));
  return answer;
}

function previewCoachingAction(kind, id) { return coachingAction_(kind, id, true); }
function runCoachingAction(kind, id) { return coachingAction_(kind, id, false); }

// ---------- Who is offered, and why (USATT) ----------
// The coaching app offers a coach only when they are in its club list (CLUB_COACHES) and the club site's coaching page shows
// them: USATT-certified coaches, and the club's exceptions ("showWhilePending" in data/coach-certifications.json). The GitHub
// data update checks USATT's directory and writes that file (scripts/check-usatt-coaches.js); the desk copies who is shown to
// its hidden CoachList tab hourly (CoachList.js), and the coaching app's hourly sweep follows the tab. So each coach card says
// what USATT shows, and for a coach not offered, why, with the control that fits:
//   offer    a Pending coach the club wants offered anyway: the desk starts the data update with coach_exception
//            'offer:<name>' (the same GitHub token and workflow as publishing), which adds the exception and rebuilds the page.
//   end      the exception taken away: a Pending coach is hidden again until certified.
//   sync     the page already shows (or hides) them but the coaching app has not caught up: copy the list now and run the
//            coaching app's sweep, instead of waiting up to two hours.
//   recheck  the data update, now: a coach just certified by USATT is shown without waiting for the next scheduled run.
// A coach no longer in CLUB_COACHES, or not on coaching.html at all, comes back only by a reviewed pull request: the page says
// so. Each control is previewed, then done, and recorded in the desk log; GitHub records the change itself as a commit.
var USATT_ACTIVE_ = 'USATT Certification Active';
var COACH_REQUESTS_KEY_ = 'COACH_OFFER_REQUESTS';
// GitHub keeps one waiting run per workflow: a second change asked while the first waits would replace it, so one at a time.
var COACH_REQUEST_BUSY_MS_ = 10 * 60 * 1000;
// A change the page still does not show after this long was most likely skipped by GitHub: it may be asked again.
var COACH_REQUEST_STALE_MS_ = 30 * 60 * 1000;

// The site's coach file. fresh: past the desk's 5-minute cache and the site's own. Throws when it cannot be read.
function coachCertifications_(fresh) {
  var cache = CacheService.getScriptCache();
  var held = !fresh && cache.get('coach-certifications');
  if (held) {
    try { return JSON.parse(held); } catch (error) { held = null; }
  }
  var response = UrlFetchApp.fetch(COACH_LIST_URL_ + '?at=' + Date.now(), { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('the club site returned ' + response.getResponseCode());
  var text = response.getContentText();
  var data = JSON.parse(text);
  if (!data || !data.coaches || typeof data.coaches !== 'object') throw new Error('the coach file does not look right');
  if (text.length < 90000) cache.put('coach-certifications', text, 300);
  return data;
}

// The names the coaching app reads from the CoachList tab, lower case, or null before the desk has written it.
function coachListNames_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(COACH_LIST_TAB_);
  var values = sheet && sheet.getLastRow() >= 1 ? sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues() : [];
  if (!values.length || String(values[0][0]) !== COACH_LIST_HEADER_) return null;
  var names = {};
  values.slice(1).forEach(function (line) { var name = String(line[0] || '').trim().toLowerCase(); if (name) names[name] = true; });
  return names;
}

function coachRequests_() {
  try {
    var list = JSON.parse(PropertiesService.getScriptProperties().getProperty(COACH_REQUESTS_KEY_) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (error) {
    return [];
  }
}

// Whether the site's file shows a change asked for (a recheck shows nothing to look for: done once it is not busy).
function coachRequestDone_(request, data, now) {
  var allow = data.showWhilePending || [];
  var record = data.coaches[request.coach] || {};
  if (request.action === 'offer') return allow.indexOf(request.coach) >= 0 || (!!data.coaches[request.coach] && !record.hidden);
  if (request.action === 'end') return allow.indexOf(request.coach) < 0;
  return now - request.at >= COACH_REQUEST_BUSY_MS_;
}

function coachRequestBusy_(data, now) {
  return coachRequests_().filter(function (request) { return now - request.at < COACH_REQUEST_BUSY_MS_ && !coachRequestDone_(request, data, now); })[0] || null;
}

function pacificTime_(ms) { return Utilities.formatDate(new Date(ms), 'America/Los_Angeles', 'EEE h:mm a'); }

// One coach's USATT status, why they are or are not offered, and the controls that fit. coach is the coaching app's record.
function coachOffer_(coach, data, listed, now) {
  var cert = data.coaches[coach.name] || null;
  var exception = (data.showWhilePending || []).indexOf(coach.name) >= 0;
  var onPage = !!cert && !cert.hidden;
  var inList = listed ? !!listed[coach.name.toLowerCase()] : null;
  var offer = { status: cert ? cert.status : '', level: cert && cert.level || '', certified: !!cert && cert.status === USATT_ACTIVE_, exception: exception,
    onPage: onPage, inList: inList, reason: '', actions: [], request: null };
  var asked = coachRequests_().filter(function (request) { return request.coach === coach.name && now - request.at < 2 * 3600000; }).pop();
  if (asked && !coachRequestDone_(asked, data, now)) {
    var stale = now - asked.at >= COACH_REQUEST_STALE_MS_;
    offer.request = { action: asked.action, at: asked.at, stale: stale, text: (asked.action === 'offer' ? 'Asked to offer them' : 'Asked to stop offering them') + ' at ' + pacificTime_(asked.at) + '. ' +
      (stale ? 'The coaching page still does not show it: GitHub most likely skipped that run. Ask again.' : 'GitHub is updating the coaching page; that usually takes under 10 minutes.') };
    if (!stale) return offer;
  }
  if (!coach.club) {
    offer.reason = 'Not on the club\'s coach list (CLUB_COACHES in the coaching app, and the coach table on coaching.html), so the coaching app keeps their record and lessons but never offers them. Adding a coach back is a change to that list, made in a reviewed pull request: ask for it in a GitHub issue.';
  } else if (!cert) {
    offer.reason = 'On the club\'s coach list but not in the coaching page\'s coach table (coaching.html), so the USATT check does not follow them and the page never shows them. Adding their row to coaching.html is a reviewed pull request.';
  } else if (!coach.active && onPage) {
    offer.reason = 'The coaching page shows them' + (inList ? ', and the desk has passed that on' : '') + ', but the coaching app has not caught up yet: it follows the page within two hours. Sync now does it at once.';
    offer.actions.push('sync');
  } else if (coach.active && !onPage) {
    offer.reason = 'The coaching page no longer shows them (USATT certification pending), but the coaching app has not caught up yet. Sync now stops offering them at once.';
    offer.actions.push('sync');
  } else if (!coach.active) {
    offer.reason = 'USATT certification pending: USATT\'s Find a Coach directory does not list them with a coaching level, and the coaching page shows only certified coaches and the club\'s exceptions. They come back by themselves once USATT certifies them; Re-check USATT checks now. To offer them before that, make them a club exception.';
    offer.actions.push('offer');
  } else if (exception && !offer.certified) {
    offer.reason = 'Offered as the club\'s exception while USATT certification is pending. The exception ends by itself once USATT certifies them.';
    offer.actions.push('end');
  }
  return offer;
}

// Adds each coach's offer to Coach Admin's data, with what the page needs to explain it.
function coachOffers_(coaches, fresh) {
  var now = Date.now();
  var data = coachCertifications_(fresh);
  var listed = coachListNames_();
  coaches.forEach(function (coach) { coach.offer = coachOffer_(coach, data, listed, now); });
  var busy = coachRequestBusy_(data, now);
  return { ok: true, source: data.source || 'https://coaches.usatt.org/', exceptions: (data.showWhilePending || []).length,
    busy: busy ? (busy.action === 'recheck' ? 'A USATT re-check' : 'A change for ' + busy.coach) + ' asked at ' + pacificTime_(busy.at) + ' is still running.' : '' };
}

function previewCoachOffer(kind, coachId) { return coachOfferAction_(kind, coachId, true); }
function setCoachOffer(kind, coachId) { return coachOfferAction_(kind, coachId, false); }

function coachOfferAction_(kind, coachId, preview) {
  kind = String(kind || '');
  if (['offer', 'end', 'sync', 'recheck'].indexOf(kind) < 0) throw new Error('That control is not known. Reload the page.');
  var now = Date.now();
  var data = coachCertifications_(true);
  var coach = null;
  if (kind !== 'recheck') {
    if (!/^[a-f0-9]{16}$/.test(String(coachId || ''))) throw new Error('That coach was not found. Reload the page.');
    coach = (coachAdminCall_({ action: 'coaches' }).coaches || []).filter(function (entry) { return entry.id === coachId; })[0];
    if (!coach) throw new Error('That coach was not found. Reload the page.');
    var offer = coachOffer_(coach, data, coachListNames_(), now);
    if (offer.actions.indexOf(kind) < 0) return { ok: false, message: 'That is not needed for ' + coach.name + ' now. ' + (offer.request ? offer.request.text : offer.reason || 'They are offered.') };
  }
  var busy = kind !== 'sync' && coachRequestBusy_(data, now);
  if (busy) return { ok: false, message: (busy.action === 'recheck' ? 'A USATT re-check' : 'The change for ' + busy.coach) + ' asked at ' + pacificTime_(busy.at) + ' is still running. GitHub runs one at a time: try again in a few minutes.' };
  var name = coach ? coach.name : '';
  if (preview) {
    var effects = {
      offer: { title: 'Offer ' + name + ' while USATT certification is pending', effect: 'Makes ' + name + ' a club exception: GitHub\'s data update adds them to the exceptions in the coaching page\'s coach file and lists them on coaching.html as USATT Certification Pending, usually within 10 minutes. The coaching app then offers them within two hours, or at once with Sync now. The exception ends by itself once USATT certifies them. GitHub records the change as a commit.' },
      end: { title: 'Stop offering ' + name + ' until USATT certifies them', effect: 'Ends the club exception: GitHub\'s data update hides ' + name + ' from coaching.html, usually within 10 minutes, and the coaching app stops offering their times within two hours, or at once with Sync now. Lessons already booked stay booked. They come back by themselves once USATT certifies them.' },
      sync: { title: 'Sync ' + name + ' now', effect: 'Copies who the coaching page shows to the coaching app now, then runs the coaching app\'s sweep, so ' + name + (coach && coach.active ? ' stops being offered' : ' is offered') + ' at once instead of within two hours. Takes up to a minute.' },
      recheck: { title: 'Re-check USATT now', effect: 'Starts GitHub\'s data update now: it looks every coach up in USATT\'s Find a Coach directory, shows newly certified coaches on coaching.html and hides any whose certification lapsed (club exceptions stay). Usually under 10 minutes; then Sync now on a coach the coaching app has not caught up with.' }
    };
    return Object.assign({ ok: true, preview: true }, effects[kind]);
  }
  if (kind === 'sync') {
    var copied = publishCoachList_(true) || {};
    if (copied.skipped) return { ok: false, message: 'The coach list was not copied: ' + copied.skipped + '. Try again in a minute.' };
    var swept = coachAdminCall_({ action: 'act', kind: 'sweep', id: '' });
    appendAudit_('coach_list_synced', 'coaching', coachId, { coach: name });
    return { ok: !!swept.ok, message: swept.ok ? 'Synced: the coaching app now follows the coaching page for ' + name + '.' : swept.message };
  }
  dispatchCoachUpdate_(kind === 'recheck' ? '' : kind + ':' + name);
  var requests = coachRequests_().filter(function (request) { return now - request.at < 2 * 3600000; }).slice(-9);
  requests.push({ coach: name, action: kind, at: now });
  PropertiesService.getScriptProperties().setProperty(COACH_REQUESTS_KEY_, JSON.stringify(requests));
  appendAudit_({ offer: 'coach_exception_requested', end: 'coach_exception_end_requested', recheck: 'usatt_recheck_requested' }[kind], 'coaching', coachId || 'all', { coach: name });
  return { ok: true, message: kind === 'recheck' ? 'Asked GitHub to re-check USATT now. The coaching page updates in about 10 minutes.' :
    'Asked GitHub to ' + (kind === 'offer' ? 'offer ' : 'stop offering ') + name + '. The coaching page updates in about 10 minutes; then Sync now, or wait up to two hours for the coaching app.' };
}

// Starts the data update with the club's request (coach_exception), with the token publishing uses (PublishTimer.js).
function dispatchCoachUpdate_(exception) {
  var token = githubToken_();
  if (!token) throw new Error('The desk is not connected to GitHub yet (no GitHub token), so it cannot change the coaching page.');
  var response = UrlFetchApp.fetch(workflowUrl_() + '/dispatches', { method: 'post', contentType: 'application/json', headers: githubHeaders_(token),
    payload: JSON.stringify({ ref: 'main', inputs: exception ? { coach_exception: exception } : {} }), muteHttpExceptions: true });
  if (response.getResponseCode() !== 204) throw new Error(githubErrorMessage_(response.getResponseCode()));
}
