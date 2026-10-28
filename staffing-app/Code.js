// Public staff sign-up app (GitHub issue #51): volunteers sign up for the positions that open and close the club. Like
// coaching-app/ this is its own Apps Script project: a public web app exposes every function in its project, so the desk's
// code must never live here, and every function without a trailing _ is callable by anyone on the internet.
//
// Nobody needs a Google account. The web app runs as the club owner and does all the work. Its data lives in a PRIVATE Sheet
// (script property STAFFING_DB_ID) that setup() creates: names, emails, mobile numbers and the sign-ups themselves. The page
// and every public function show first names only ("Sam", or "Sam K." when two people that night are called Sam); never a
// last name, an email address or a phone number.
//
// Who can sign up: v1 is the desk's player list only (SIGNUP_MODE 'directory'). People find their name with findPlayers,
// which reads the desk's private Sheet (script property DESK_SHEET_ID, tab Players, active rows only). In 'hybrid' mode a
// person may also type a name that is not on the list; canTake_ is the one place that decides who may take what.
//
// How a sign-up moves: a person picks any number of shifts in the next three months and submits once. The picks are saved as
// 'pending': they hold their slots, so nobody else can take them, and show as "waiting to confirm". One email lists every pick
// and asks for YES (confirm all) or NO (release all). No answer by the deadline and the holds expire. A confirmed shift can be
// dropped later the same way: the page asks, the app emails the address that confirmed it, and only a YES drops it.
// Steps, columns and where a sign-up can get stuck: docs/staffing-flow.md.
var TZ = 'America/Los_Angeles';
// Club nights by weekday (0 is Sunday): Monday, Wednesday and Friday 7 to 10 PM, Saturday 3 to 6 PM, Pacific.
var NIGHTS = { 1: { start: '19:00', end: '22:00' }, 3: { start: '19:00', end: '22:00' }, 5: { start: '19:00', end: '22:00' }, 6: { start: '15:00', end: '18:00' } };
// The calendar shows the current month and the next two, in Pacific time: on November 1st, January opens.
var MONTHS_SHOWN = 3;
// Tonight can be picked until an hour before the club opens, and a hold never lasts past that point either.
var CUTOFF_MINUTES = 60;
var HOLD_MS = 24 * 60 * 60 * 1000;
// The open/close list's first wave (importSeedSheet, and its re-sends) is held a flat 72 hours, so the club can remind people
// in person on the next club nights. Nights inside those hours stay "waiting to confirm" until the person answers.
var SEED_HOLD_MS = 72 * 60 * 60 * 1000;
// Someone still waiting is re-sent their email only if the last one went out longer ago than this.
var RESEND_AFTER_MS = 60 * 60 * 1000;
// A YES that comes after the hold expired is still read for this long (lateConfirm_), and confirms whatever is still free.
var LATE_MS = 3 * 24 * 60 * 60 * 1000;
// A "drop this shift" email can be answered for this long, and is sent at most once per sign-up in DROP_WAIT_MS.
var DROP_TTL_MS = 48 * 60 * 60 * 1000;
var DROP_WAIT_MS = 10 * 60 * 1000;
var MAX_PICKS = 40;
// A player with no email on file asks the club to approve one, once. The club has this long to answer, and at most this many
// such requests can be open at a time (beyond that the page says to ask the club).
var CLUB_WAIT_MS = 7 * 24 * 60 * 60 * 1000;
var MAX_OPEN_REQUESTS = 10;
// Where an email on file came from, and so which import may replace which: a higher rank is never replaced by a lower one,
// and an equal rank only by a newer SeedLinks fix. A row the owner typed (any other source) ranks highest.
var EMAIL_RANK = { owner: 3, seedlinks: 2, 'approved-request': 2, 'member-list': 1, zeffy: 1, coaching: 1 };
var MAX_PENDING_PER_EMAIL = 3;
var MAX_SIGNUPS = 20000;
var MAX_WRITES_PER_MINUTE = 20;
var MAX_READS_PER_MINUTE = 120;
// Name search runs as people type (the page waits for a pause), so it has its own, higher limit.
var MAX_FINDS_PER_MINUTE = 120;
var FIND_LIMIT = 8;
var DIRECTORY_CACHE_SECONDS = 600;
// The day-before reminder goes out from this time (Pacific) on the day before the shift.
var REMIND_FROM = '09:00';
var RETRY_MAIL_DAYS = 3;
var MIN_QUOTA = 10;
var THREAD_DAYS = 90;
// Each email check reaches this far back before the last one, for mail Gmail is slow to make searchable.
var MAIL_OVERLAP_MS = 5 * 60 * 1000;
var LOG_KEEP = 500;
// A step of the minute check that fails without a break for this long is emailed to the club. Google's services have outages
// of a few minutes that clear by themselves; those go to the Log tab, not the club inbox.
var ALERT_AFTER_MS = 30 * 60 * 1000;
// Who a club alert says to forward it to when the club cannot fix it.
var MAINTAINER = 'JB';
// The footer of every email to the club account except the sample of a volunteer's email.
var CLUB_FOOTER = 'Sent by the CTTC staff sign-up app to the club account.';
// 'directory' (only names on the desk's player list) or 'hybrid' (also "I'm not listed"). The script property SIGNUP_MODE
// overrides this, so hybrid can be switched on without a code change.
var SIGNUP_MODE = 'directory';

var SITE_URL = 'https://concordtabletennisclub.com';
var PAGE_URL = SITE_URL + '/';
var FROM_NAME = 'Concord Table Tennis Club';
var TEXT_NUMBER = '(925) 238-3505';
var LOCATION = 'Walnut Creek Christian Academy, 2336 Buena Vista Ave, Walnut Creek, CA 94597';
// The home page's list of gym closures (data/closures.json): the main source of closed nights. Script property CLOSURES_URL
// overrides it (the preview serves the repository's copy). Read at most once an hour.
var CLOSURES_URL = SITE_URL + '/data/closures.json';
var CLOSURES_CACHE_SECONDS = 3600;
var SITE_NOTES = { partial: 'Reduced play area, 10 tables max', holiday: 'Open on holiday' };

// Every slot a night has, as the club's open/close list names them. 'open' positions are the opening crew: one person may
// hold only one of them per night (a backup counts), except the pairs in alsoWith (the desk organizer may also help set up).
// 'close' positions are the closing crew: the lock-up keyholder and the people putting tables away; one each per person,
// and the same person may open and close. training lists the Training tab columns that must say yes before someone may
// take the position (canTake_); does is the line the page shows under it (the page swaps in the night's own time where it
// says "X PM (Y PM on Saturdays)").
var POSITIONS = [
  { id: 'desk', label: 'Desk organizer', part: 'open', min: 1, max: 1, training: ['keys', 'open'], alsoWith: ['tables'],
    does: 'The opener and round robin organizer: first in at 6:40 PM (2:40 PM on Saturdays), has the key lockbox, opens the doors, side door and storage room, turns on the lights and AC, and runs the round robin desk on round robin nights.' },
  // Backups need no training: a backup spot is how someone learns alongside the trained primary.
  { id: 'desk-backup', label: 'Desk organizer backup', part: 'open', min: 0, max: 1, training: [], backupOf: 'desk',
    does: 'Works alongside the desk organizer, learning the role, and helps out if they cannot make it. No training needed.' },
  { id: 'money', label: 'Money collector (Front Desk)', part: 'open', min: 1, max: 1, training: ['front_desk'],
    does: 'Prints the Revenue Sheet, takes out the Clover device and the Zelle/Venmo QR codes, records everyone entering on the Revenue Sheet and manages the payments.' },
  { id: 'money-backup', label: 'Money collector backup', part: 'open', min: 0, max: 1, training: [], backupOf: 'money',
    does: 'Works alongside the money collector at the Front Desk, learning the role, and helps out if they cannot make it. No training needed.' },
  { id: 'tables', label: 'Table/barrier setup', part: 'open', min: 1, max: 4, training: [], alsoWith: ['desk'],
    does: 'Arrives by 6:45 PM (2:45 PM on Saturdays): brings out the barriers, tables and nets, and knows the gym layout.' },
  { id: 'lockup', label: 'Lock-up', part: 'close', min: 1, max: 1, training: ['keys'],
    does: 'Last person out: stays until 10:00 PM (6:00 PM on Saturdays) or later, has the key lockbox, checks everyone is out (restrooms too) and every door is locked, and turns off the lights and AC.' },
  { id: 'close', label: 'Put tables and barriers away', part: 'close', min: 1, max: 5, training: [],
    does: 'Stays until 10:00 PM (6:00 PM on Saturdays) or later: folds up the tables, returns the nets to the basket and all equipment to the storage room. One closer may also finalize the desk.' }
];

// Two positions the same person may not hold on the same night: the same part (opening or closing), unless alsoWith pairs them.
function clash_(a, b) {
  return !!a && !!b && a.part === b.part && (a.alsoWith || []).indexOf(b.id) < 0;
}
// What each Training column means, for messages.
var SKILLS = { keys: 'key access', open: 'opening', front_desk: 'Front Desk' };

var EMAIL_PATTERN = /^[a-z0-9][a-z0-9._%+'-]{0,63}@(?:[a-z0-9-]+\.)+[a-z]{2,24}$/i;
var NAME_PATTERN = /^[\p{L}][\p{L}\p{M} .,&/()'\u2019-]{0,59}$/u;
var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Private Sheet. Dates are Pacific wall-clock text ("2026-10-19"); *_at and expires_at are milliseconds or ISO times.
var TABS = {
  // One row per pick. status: pending (held, waiting for the YES), confirmed, released (NO), expired (no YES in time) or
  // dropped. finalize is 'yes' on the one closer who also does the desk's Finalize step. drop_at is when a drop was last
  // asked by email; reminded is when the day-before reminder went out.
  Signups: ['signup_id', 'batch_id', 'date', 'position', 'finalize', 'player_id', 'name', 'email', 'status', 'created_at', 'expires_at',
    'confirmed_at', 'updated_at', 'drop_at', 'reminded',
    // seed_key is set on picks made by importSeedSheet, so running it again never adds the same pick twice.
    'seed_key',
    // cancelled_by is 'closure' when the gym closed that night after the sign-up (status 'cancelled'); notified is when the
    // person was told, so the notice goes out once.
    'cancelled_by', 'notified'],
  // One row per submission: the one email (and text) that asks YES or NO about all its picks. emailed and texted hold the
  // status last sent, written only after the send worked, so the sweep retries a failed one. late is 'yes' when a late YES
  // confirmed only the picks still free.
  Batches: ['batch_id', 'email', 'name', 'player_id', 'phone', 'status', 'created_at', 'expires_at', 'emailed', 'texted', 'answered_at', 'answer',
    'late', 'updated_at',
    // 'seed' for a submission made by importSeedSheet from the volunteer's list, so its email says where the picks came from.
    'source',
    // When its confirmation email was last re-sent (resendSeed_), so a second tap on Send never emails the same person again.
    'resent_at'],
  // Everyone who has signed up, by email. texts is 'yes' after they text STAFF from the phone below, '' after STOP. ask_ref
  // is the sign-up last texted, so CONFIRM or RELEASE answers it.
  People: ['email', 'name', 'player_id', 'phone', 'texts', 'texts_at', 'ask_ref', 'ask_at', 'created_at', 'updated_at'],
  // The one email (and mobile) on file for each player: nobody can sign up as someone else, because a sign-up is confirmed
  // only from the email on file. status: approved (at most one per player; a newer approval marks the old row 'replaced'),
  // pending (asked from the page, waiting for the club; batch_id is that sign-up) or declined. source: owner (typed by hand),
  // seedlinks, zeffy, coaching (importSeedSheet), member-list (importMemberEmails), request / approved-request (the page).
  // phone is the only mobile staffing texts ever go to (with the person's STAFF text from it).
  Emails: ['player_id', 'name', 'email', 'phone', 'source', 'status', 'requested_at', 'decided_at', 'batch_id'],
  // Rewritten by each importMemberEmails run: what it added, kept and could not match (full names, private Sheet only).
  MemberEmailReport: ['at', 'kind', 'name', 'email', 'detail'],
  // Who is trained for what, yes or no: keys (key lockbox) and open for Desk organizer, front_desk for Money collector.
  // Filled by importSeedSheet from the volunteer's list, and by the owner by hand. In hybrid mode, someone not on the player
  // list is matched by their email typed in player_id (the app adds such a row, untrained, when they ask for Desk or Money).
  Training: ['player_id', 'name', 'keys', 'open', 'front_desk', 'updated_at'],
  // Fixes for the seed import, filled in by the owner: a name as the seed Sheet (or SeedReport) has it, the desk player it
  // means (display name from the dropdown, or a player_id) and/or the email to use. importSeedSheet adds a blank row for
  // each name it could not resolve.
  SeedLinks: ['sheet_name', 'player_name', 'email'],
  // Rewritten by each importSeedSheet run: counts per reason, and each name to fix with up to 5 candidate players.
  SeedReport: ['at', 'kind', 'name', 'count', 'candidates'],
  // Typed by the owner: one date per row (2026-11-13 or 11/13/2026) and a short public note. Those nights show as closed.
  Closures: ['date', 'note'],
  // One row per message sent, reply read, step or failure. to is a code, never an address or number.
  Log: ['at', 'channel', 'kind', 'ref', 'to', 'detail']
};

// The club site serves its own copy of the page (volunteer-app.html, published from Index.html), which calls these with fetch
// and without cookies: Google's page host can refuse to open ("Sorry, unable to open the file at this time") in a browser
// signed in to several Google accounts, and a request with no cookies never meets that. Only these can be called this way.
function doPost(e) {
  var calls = { staffBoard: staffBoard, findPlayers: findPlayers, playerAccess: playerAccess, signUp: signUp, requestDrop: requestDrop, myNights: myNights, saveMyNights: saveMyNights };
  var result = null;
  try {
    var body = e && e.postData ? String(e.postData.contents || '') : '';
    var request = body.length <= 100000 ? JSON.parse(body || '{}') : {};
    var name = String(request && request.fn || '');
    result = Object.prototype.hasOwnProperty.call(calls, name) ? calls[name].apply(null, Array.isArray(request.args) ? request.args.slice(0, 3) : []) : fail_('Unknown request.');
  } catch (error) {
    logError_('answer a request from the club site', error);
    result = fail_('Something went wrong. Please try again.');
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (e && e.parameter && e.parameter.setup !== undefined) return ownerSetup_(e.parameter);
  var output = HtmlService.createTemplateFromFile('Index').evaluate();
  var initial = initialData_(e && e.parameter ? e.parameter.mine : '');
  if (initial) output.setContent(output.getContent().replace('var INITIAL = null;', 'var INITIAL = ' + scriptJson_(initial) + ';'));
  return output
    .setTitle('CTTC volunteer sign-ups')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// The calendar comes with the page, saving a second trip to Google, and so do the person's own nights when the page was opened
// from the link in their email (mine). On any problem the page fetches them itself.
function initialData_(mine) {
  var code = String(mine || '').trim().toUpperCase();
  var initial = {};
  try {
    var signups = rows_('Signups');
    initial.staffBoard = board_(signups, closures_(), Date.now());
    if (mine) {
      var emails = rows_('Emails');
      var owner = mineOwner_(code, signups, emails);
      initial.mine = owner ? mineView_(owner, signups, emails, Date.now()) : fail_(MINE_GONE);
    }
  } catch (error) {
    logError_('prepare the first screen', error);
  }
  if (mine && /^[0-9A-F]{20}$/.test(code)) initial.mineCode = code;
  return initial.staffBoard || initial.mineCode ? initial : null;
}

// JSON that is safe inside a <script> element, even when a name contains </script>.
function scriptJson_(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

// Run once from the Apps Script editor by the owner. Creates the private Sheet and its tabs, the hourly sweep and the minute
// reply check, and asks Google for the permissions. Does nothing when called from the web page. Set DESK_SHEET_ID first (the
// id in the desk Sheet's address) so the player list can be checked; the result says how many active players it found.
// The owner's setup page, opened from a phone as the club account: /dev?setup&desk=<desk Sheet id>&seed=<volunteer Sheet id>
// sets those script properties if they are not set yet, runs setup(), and offers the seed import (&import=seed) and the
// membership email import (&import=members) as one tap each. Opening it is also how Google asks the owner, once, to allow
// the app's permissions, so the Apps Script editor is never needed. Anyone else gets a plain "not available": the page
// says nothing about the club, and /dev only opens for the project's editors anyway.
function ownerSetup_(params) {
  var page = function (title, lines) {
    // Google shows this page inside a frame: links must open in the whole window, or Google refuses to load inside the frame.
    var html = '<!doctype html><base target="_top"><meta name="viewport" content="width=device-width, initial-scale=1"><body style="font:16px/1.5 Arial,sans-serif;margin:16px;color:#1c1c1c">' +
      '<h1 style="font-size:1.25rem;color:#1f6b3a">' + esc_(title) + '</h1>' + lines.join('') + '</body>';
    return HtmlService.createHtmlOutput(html).setTitle('CTTC volunteer sign-ups: setup').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  };
  var active = String(Session.getActiveUser().getEmail() || '');
  if (!active || active !== Session.getEffectiveUser().getEmail()) return page('Not available', ['<p>This page is for the club\'s account only.</p>']);
  var properties = PropertiesService.getScriptProperties();
  var sheetId = function (value) { return /^[A-Za-z0-9_-]{30,80}$/.test(String(value || '')) ? String(value) : ''; };
  ['desk', 'seed', 'members'].forEach(function (name) {
    var key = { desk: 'DESK_SHEET_ID', seed: 'SEED_SHEET_ID', members: 'MEMBER_LIST_ID' }[name];
    if (sheetId(params[name]) && !properties.getProperty(key)) properties.setProperty(key, sheetId(params[name]));
  });
  var lines = [];
  var base = ScriptApp.getService().getUrl() + '?setup';
  try {
    var result = setup();
    lines.push('<p>&#10003; Set up. Player list: ' + esc_(result.players) + '. Reminders and replies are checked automatically from now on.</p>');
    var button = function (href, label) {
      return '<p><a style="display:inline-block;padding:10px 16px;background:#1f6b3a;color:#fff;border-radius:4px;text-decoration:none" href="' + esc_(href) + '">' + esc_(label) + '</a></p>';
    };
    var toFix = function (report) {
      var names = [].concat(report.unmatched.map(function (name) { return name + ' (no matching player)'; }),
        report.ambiguous.map(function (name) { return name + ' (more than one matching player)'; }),
        report.noEmail.map(function (name) { return name + ' (no email on file)'; }));
      return names.length ? '<p>Not emailed, to fix in the private Sheet\'s SeedLinks tab first: ' + esc_(names.join(', ')) + '.</p>' : '';
    };
    // People already emailed and still waiting for a YES get the current email again when Send is pressed (resendSeed_).
    // (Someone waiting who also gets newly opened nights is listed twice: that is two emails.)
    var resends = function (plan) {
      return waitingSeed_(Date.now()).map(function (each) {
        var labels = {};
        each.picks.forEach(function (pick) { labels[position_(pick.position).label] = true; });
        var dates = each.picks.map(function (pick) { return pick.date; }).sort();
        var to = plan.emailsFor[each.batch.player_id] || each.onFile || cleanEmail_(each.batch.email);
        return { name: firstName_(each.batch.name), email: maskEmail_(to), nights: each.picks.length, positions: Object.keys(labels), first: dates[0], last: dates[dates.length - 1],
          earlier: maskEmail_(cleanEmail_(each.batch.email)), sent: each.batch.emailed === 'pending' };
      });
    };
    var personLine = function (person, note) {
      return '<li><strong>' + esc_(person.name) + '</strong> (' + esc_(person.email) + '): ' + esc_(person.nights) + ' nights as ' + esc_(person.positions.join(' and ')) +
        ', ' + esc_(shortDay_(person.first)) + ' to ' + esc_(shortDay_(person.last)) + (note ? '. <em>' + esc_(note) + '</em>' : '') + '</li>';
    };
    var seedActions = ['preview', 'seed', 'sample', 'links'];
    if (seedImportedAt_() && seedActions.indexOf(params['import']) >= 0) {
      lines.push('<p>' + esc_(seedClosedText_()) + '</p>');
      if (waitingSeed_(Date.now()).length) lines.push(button(base + '&import=resend', 'Re-send the confirmation email to people still waiting for a YES'));
    } else if (params['import'] === 'links') {
      var prepared = importSeed_(true, true);
      var toFill = [].concat(prepared.unmatched, prepared.ambiguous, prepared.noEmail);
      lines.push('<p>&#10003; SeedLinks is ready: ' + (toFill.length ? esc_(toFill.length) + ' ' + (toFill.length === 1 ? 'name needs' : 'names need') + ' a player and/or an email (' +
        esc_(toFill.join(', ')) + '). The player dropdown is up to date.' : 'every name already has a player and an email.') + ' Nothing was held or sent.</p>');
      lines.push('<p><a href="' + esc_(result.privateSheet) + '">Open the private staffing Sheet</a>, fill in the SeedLinks tab, then come back to the preview.</p>');
      lines.push(button(base + '&import=preview', 'Back to the preview'));
    } else if (params['import'] === 'resend') {
      var resent = resendSeed_();
      lines.push('<p>&#10003; Re-sent the confirmation email to ' + esc_(resent) + ' ' + (resent === 1 ? 'person' : 'people') + ' still waiting, with a fresh deadline.</p>');
      lines.push(button(base + '&import=preview', 'Back to the preview'));
    } else if (params['import'] === 'sample') {
      var sample = importSeed_(true).sample;
      if (!sample) {
        lines.push('<p>Nobody would be emailed right now, so there is no test copy to send.</p>');
      } else {
        // The exact email the first person would get, to the club inbox only. Its code belongs to no sign-up, so a YES or NO
        // sent from its buttons is ignored: nothing is held, confirmed or released.
        var test = batchMail_({ batch_id: 'sample-' + id_(), name: sample.name, source: 'seed', status: 'pending', emailed: '', expires_at: String(Date.now() + SEED_HOLD_MS) }, sample.picks, Date.now());
        sendMail_(adminEmail_(), '[TEST] ' + test.subject, test.lines, ['sample', 'seed']);
        lines.push('<p>&#10003; Sent a test copy of ' + esc_(firstName_(sample.name)) + '\'s email to the club inbox, subject starting "[TEST]". Nothing was held or sent to ' +
          esc_(firstName_(sample.name)) + '. Try its Yes and No buttons: the reply goes back to the club inbox and changes nothing.</p>');
      }
      lines.push(button(base + '&import=preview', 'Back to the preview'));
    } else if (params['import'] === 'preview') {
      var plan = importSeed_(true);
      var again = resends(plan);
      var total = plan.preview.length + again.length;
      lines.push('<h2 style="font-size:1.05rem">Preview: nothing has been sent or saved</h2>');
      if (total) {
        lines.push('<p>Sending would email ' + total + ' ' + (total === 1 ? 'person' : 'people') + ', one email each, to confirm their nights with YES:</p><ul>' +
          plan.preview.map(function (person) { return personLine(person, ''); }).join('') +
          again.map(function (person) {
            return personLine(person, 'Re-send: ' + (person.sent ? 'emailed ' + person.earlier + ' earlier' : 'held earlier') + ', no YES yet. Gets the new email with a fresh 72 hours; a YES to the earlier one still counts.');
          }).join('') + '</ul>');
      } else {
        lines.push('<p>Sending now would email nobody.</p>');
      }
      lines.push(toFix(plan));
      if ([].concat(plan.unmatched, plan.ambiguous, plan.noEmail).length) {
        lines.push('<p><a href="' + esc_(base + '&import=links') + '">Prepare SeedLinks for these names</a> (adds a row for each to fill in; holds and sends nothing).</p>');
      }
      if (plan.held.length) {
        lines.push('<p>Nights the import would leave out, and why:</p><ul>' + plan.held.map(function (person) {
          return '<li><strong>' + esc_(person.name) + '</strong>' + (person.nights ? ' (' + esc_(person.nights) + ' nights held)' : ' (nothing held, not emailed)') + ': ' +
            esc_(Object.keys(person.reasons).map(function (reason) { return person.reasons[reason] + ' ' + reason; }).join('; ')) + '</li>';
        }).join('') + '</ul>');
      }
      if (Object.keys(plan.skipped).length) lines.push('<p>All skips: ' + esc_(Object.keys(plan.skipped).map(function (reason) { return plan.skipped[reason] + ' ' + reason; }).join('; ')) + '.</p>');
      lines.push('<p>' + esc_(plan.training) + ' training rows would be recorded (no email for those).</p>');
      if (plan.preview.length) {
        lines.push('<p><a href="' + esc_(base + '&import=sample') + '">Send me a test copy of ' + esc_(plan.preview[0].name) + '\'s email first</a> (to the club inbox; holds nothing).</p>');
      }
      if (total) {
        lines.push(button(base + '&import=seed', total === 1 ? 'Send this email' : 'Send these ' + total + ' emails'));
        lines.push('<p>Sending imports the open/close list once. After that it is not read again: training and emails live in the private staffing Sheet.</p>');
      }
    } else if (params['import'] === 'seed') {
      // Those already waiting before this run get the current email again, at the address on file after the import (SeedLinks).
      var waitingBefore = waitingSeed_(Date.now()).map(function (each) { return each.batch.batch_id; });
      var seeded = importSeedSheet();
      var resentNow = resendSeed_(waitingBefore);
      lines.push('<p>&#10003; Sent ' + esc_(seeded.people + resentNow) + ' ' + (seeded.people + resentNow === 1 ? 'email' : 'emails') + ': ' + esc_(seeded.people) + ' new (' + esc_(seeded.signups) +
        ' nights held) and ' + esc_(resentNow) + ' re-sent to people still waiting for a YES. ' + esc_(seeded.training) + ' training rows recorded. Names to fix: ' +
        esc_([].concat(seeded.unmatched, seeded.ambiguous, seeded.noEmail).length) + ' (see the SeedReport tab in the private Sheet).</p>');
    } else if (params['import'] === 'answers') {
      var fixable = fixable_(Date.now());
      lines.push('<h2 style="font-size:1.05rem">Correct a volunteer\'s answer</h2><p>Sign-ups answered NO, or left to expire, in the last ' + FIX_DAYS +
        ' days. Open one to confirm the nights the volunteer asked for in words the app could not read.</p>');
      lines.push(fixable.length ? '<ul>' + fixable.map(function (each) {
        return '<li><a href="' + esc_(base + '&import=fix&batch=' + each.batch.batch_id) + '">' + esc_(each.batch.name) + '</a>: ' + esc_(each.status === 'released' ? 'answered NO' : 'no answer in time') +
          ', ' + esc_(each.nights.length) + ' nights ahead (' + esc_(shortDay_(each.nights[0].date)) + ' to ' + esc_(shortDay_(each.nights[each.nights.length - 1].date)) + ')</li>';
      }).join('') + '</ul>' : '<p>None right now.</p>');
    } else if (params['import'] === 'fix') {
      var fixing = fixable_(Date.now()).filter(function (each) { return each.batch.batch_id === params.batch; })[0];
      if (!fixing) {
        lines.push('<p>That sign-up cannot be corrected here (it is not one answered NO or expired in the last ' + FIX_DAYS + ' days with nights ahead).</p>');
      } else {
        // A plain form: each ticked night arrives as k_<signup id>.
        lines.push('<h2 style="font-size:1.05rem">' + esc_(fixing.batch.name) + '</h2><p>Tick the nights ' + esc_(firstName_(fixing.batch.name)) +
          ' asked to keep, then confirm. Each is checked again like a new sign-up (someone may have taken it meanwhile). ' + esc_(firstName_(fixing.batch.name)) +
          ' gets the usual confirmation email, listing the nights left out.</p>' +
          '<form method="get" action="' + esc_(ScriptApp.getService().getUrl()) + '"><input type="hidden" name="setup" value=""><input type="hidden" name="import" value="fixsave">' +
          '<input type="hidden" name="batch" value="' + esc_(fixing.batch.batch_id) + '">' + fixing.nights.map(function (entry) {
            return '<p style="margin:6px 0"><label><input type="checkbox" name="k_' + esc_(entry.signup_id) + '" value="1" style="width:20px;height:20px;vertical-align:middle"> ' +
              esc_(shortDay_(entry.date)) + ': ' + esc_(shiftLabel_(entry)) + '</label></p>';
          }).join('') + '<p><button type="submit" style="padding:10px 16px;background:#1f6b3a;color:#fff;border:0;border-radius:4px;font:inherit">Confirm the ticked nights and email ' +
          esc_(firstName_(fixing.batch.name)) + '</button></p></form>');
      }
      lines.push('<p><a href="' + esc_(base + '&import=answers') + '">Back to the list</a></p>');
    } else if (params['import'] === 'fixsave') {
      var keep = Object.keys(params).filter(function (key) { return /^k_[0-9a-f]{1,32}$/.test(key); }).map(function (key) { return key.slice(2); });
      var fixed = keep.length ? clubFix_(String(params.batch || ''), keep) : null;
      if (!keep.length) lines.push('<p>No nights were ticked, so nothing changed.</p>');
      else if (!fixed) lines.push('<p>That sign-up cannot be corrected any more (it was already corrected, or answered meanwhile). Nothing changed.</p>');
      else {
        lines.push('<p>&#10003; Confirmed ' + esc_(fixed.confirmed.length) + ' night' + (fixed.confirmed.length === 1 ? '' : 's') + (fixed.confirmed.length ? ': ' +
          esc_(fixed.confirmed.map(function (entry) { return shortDay_(entry.date); }).join(', ')) : '') + '.' + (fixed.confirmed.length ? ' The volunteer has been emailed.' : '') + '</p>');
        if (fixed.missed.length) {
          lines.push('<p>Not confirmed:</p><ul>' + fixed.missed.map(function (each) { return '<li>' + esc_(shortDay_(each.entry.date)) + ': ' + esc_(each.reason) + '</li>'; }).join('') + '</ul>');
        }
      }
      lines.push('<p><a href="' + esc_(base + '&import=answers') + '">Back to the list</a></p>');
    } else if (params['import'] === 'members') {
      var members = importMemberEmails();
      lines.push('<p>&#10003; Membership emails imported: ' + esc_(JSON.stringify(members)) + '</p>');
    }
    lines.push('<p><a href="' + esc_(result.privateSheet) + '">Open the private staffing Sheet</a> (never share it).</p>');
    if (properties.getProperty('SEED_SHEET_ID') && !params['import']) {
      if (seedImportedAt_()) lines.push('<p>' + esc_(seedClosedText_()) + '</p>');
      else lines.push(button(base + '&import=preview', 'Preview who the open/close list would email') + '<p>The preview sends nothing; you choose to send from there. The list is imported only once, when you send.</p>');
    }
    if (['answers', 'fix', 'fixsave'].indexOf(params['import']) < 0) {
      lines.push('<p><a href="' + esc_(base + '&import=answers') + '">Correct a volunteer\'s answer</a> (someone answered NO or in words the app could not read)</p>');
    }
    if (properties.getProperty('MEMBER_LIST_ID') && params['import'] !== 'members') {
      lines.push('<p><a href="' + esc_(base + '&import=members') + '">Import emails from the membership list</a></p>');
    }
  } catch (error) {
    logError_('run the setup page', error);
    lines.push('<p style="color:#8b1a1a">Setup stopped: ' + esc_(cleanDetail_(error)) + '</p><p>Fix that and open this page again; it is safe to repeat.</p>');
  }
  return page('Volunteer sign-ups setup', lines);
}

function setup() {
  if (Session.getActiveUser().getEmail() !== Session.getEffectiveUser().getEmail()) throw new Error('Only the owner can run setup.');
  var properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty('STAFFING_DB_ID')) {
    properties.setProperty('STAFFING_DB_ID', SpreadsheetApp.create('CTTC Staffing (private - do not share)').getId());
  }
  Object.keys(TABS).forEach(function (name) {
    tab_(name).getRange(1, 1, 1, TABS[name].length).setNumberFormat('@').setValues([TABS[name]]).setFontWeight('bold');
  });
  // Closure dates stay as typed: as text, a date is never turned into a different day by the Sheet's own time zone.
  tab_('Closures').getRange(2, 1, 500, 2).setNumberFormat('@');
  var blank = database_().getSheetByName('Sheet1');
  if (blank && database_().getSheets().length > 1) database_().deleteSheet(blank);
  var triggers = ScriptApp.getProjectTriggers().map(function (trigger) { return trigger.getHandlerFunction(); });
  if (triggers.indexOf('sweep') < 0) ScriptApp.newTrigger('sweep').timeBased().everyHours(1).create();
  if (triggers.indexOf('checkReplies') < 0) ScriptApp.newTrigger('checkReplies').timeBased().everyMinutes(1).create();
  MailApp.getRemainingDailyQuota();
  GmailApp.getInboxUnreadCount();
  var players = '';
  try {
    CacheService.getScriptCache().remove('directory');
    players = directory_().length + ' active players';
  } catch (error) {
    players = 'not readable yet: ' + error.message;
  }
  sweep_();
  var result = { privateSheet: database_().getUrl(), players: players, mode: mode_() };
  console.log('Private Sheet (never share): ' + result.privateSheet);
  console.log('Player list: ' + players + '. Sign-up mode: ' + result.mode + '.');
  return result;
}

// ---------- Sheet access ----------

function database_() { return book_('STAFFING_DB_ID'); }

// Opening a Sheet is the slowest step of a request, so each one is opened once per run.
var openBooks_ = {};
var bookIds_ = {};
function book_(key) {
  var id = bookIds_[key] || (bookIds_[key] = PropertiesService.getScriptProperties().getProperty(key));
  if (!id) throw new Error('Run setup once from the Apps Script editor.');
  if (!openBooks_[id]) openBooks_[id] = SpreadsheetApp.openById(id);
  return openBooks_[id];
}

function tab_(name) {
  var book = database_();
  var sheet = book.getSheetByName(name);
  if (!sheet) {
    var headers = TABS[name];
    sheet = book.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setNumberFormat('@').setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function rows_(name) {
  var headers = TABS[name];
  var values = tab_(name).getDataRange().getValues();
  return values.slice(1).map(function (row, index) {
    var entry = { _row: index + 2 };
    headers.forEach(function (key, column) { entry[key] = row[column] == null ? '' : String(row[column]); });
    return entry;
  }).filter(function (entry) { return entry[headers[0]]; });
}

// Every value is written as plain text, so the Sheet never turns a date, a number or a name into something else.
function save_(name, entry) {
  var headers = TABS[name];
  var sheet = tab_(name);
  var row = entry._row || sheet.getLastRow() + 1;
  var range = sheet.getRange(row, 1, 1, headers.length);
  range.setNumberFormat('@');
  range.setValues([headers.map(function (key) { return entry[key] == null ? '' : String(entry[key]); })]);
  entry._row = row;
}

// Columns added in a later version get their header names on the next sweep, so nobody has to run setup() again.
function ensureHeaders_() {
  var properties = PropertiesService.getScriptProperties();
  var version = Object.keys(TABS).map(function (name) { return name + ':' + TABS[name].join(','); }).join('|');
  if (properties.getProperty('HEADERS') === version) return;
  Object.keys(TABS).forEach(function (name) {
    tab_(name).getRange(1, 1, 1, TABS[name].length).setNumberFormat('@').setValues([TABS[name]]).setFontWeight('bold');
  });
  properties.setProperty('HEADERS', version);
}

// Every closed night: {date: note}. A night is closed when the home page's closures.json says 'full', or the owner typed it
// into the private Closures tab (an extra, owner-only way to close one). A typed date can arrive as a Date (if the cell was
// not plain text) or as text.
function closures_() {
  var found = {};
  var site = siteClosures_();
  Object.keys(site.days).forEach(function (date) { if (site.days[date] === 'full') found[date] = 'Gym closed'; });
  tab_('Closures').getDataRange().getValues().slice(1).forEach(function (row) {
    var date = sheetDate_(row[0]);
    if (date) found[date] = String(row[1] == null ? '' : row[1]).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 80);
  });
  return found;
}

// The home page's closures.json as {days: {date: 'full' | 'partial' | 'holiday'}, notices: [{when, text}]}. Cached for an
// hour; the last good copy is also kept in a script property, so a site outage (or a broken file) never reopens a closed night.
function siteClosures_() {
  var cache = CacheService.getScriptCache();
  var text = cache.get('site-closures');
  var parsed = text ? siteParse_(text) : null;
  if (parsed) return parsed;
  var properties = PropertiesService.getScriptProperties();
  try {
    var response = UrlFetchApp.fetch(property_('CLOSURES_URL', CLOSURES_URL), { muteHttpExceptions: true, followRedirects: true });
    text = response.getResponseCode() === 200 ? String(response.getContentText() || '') : '';
    parsed = siteParse_(text);
  } catch (error) {
    parsed = null;
  }
  if (parsed) {
    var kept = JSON.stringify(parsed);
    cache.put('site-closures', kept, CLOSURES_CACHE_SECONDS);
    if (kept.length < 8000 && properties.getProperty('CLOSURES_LAST_GOOD') !== kept) properties.setProperty('CLOSURES_LAST_GOOD', kept);
    return parsed;
  }
  logError_('read the site closures', new Error('closures.json could not be read; using the last good copy'));
  parsed = siteParse_(properties.getProperty('CLOSURES_LAST_GOOD') || '');
  if (parsed) cache.put('site-closures', JSON.stringify(parsed), 600);
  return parsed || { days: {}, notices: [] };
}

// Only valid dates and the three known kinds are kept; null when the text is not a closures file at all.
function siteParse_(text) {
  var data = null;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return null;
  }
  if (!data || typeof data !== 'object' || !data.days || typeof data.days !== 'object') return null;
  var days = {};
  Object.keys(data.days).forEach(function (date) {
    var kind = String(data.days[date]).toLowerCase();
    if (validDate_(date) && (kind === 'full' || kind === 'partial' || kind === 'holiday')) days[date] = kind;
  });
  var notices = (Array.isArray(data.notices) ? data.notices : []).slice(0, 50).map(function (notice) {
    return { when: String(notice && notice.when || '').slice(0, 120), text: String(notice && notice.text || '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 120) };
  });
  return { days: days, notices: notices };
}

// The short note an open night shows when the club is open with changes: the home page notice that mentions that date
// ("Fri, Dec 4 and Sat, Dec 5", "Dec 7–12"), else a default for its kind. '' for an ordinary night.
function siteNote_(site, date) {
  var kind = site.days[date];
  if (kind !== 'partial' && kind !== 'holiday') return '';
  var month = MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3);
  var day = Number(date.slice(8, 10));
  var notice = site.notices.filter(function (each) {
    if (new RegExp('\\b' + month + '\\.? ' + day + '\\b').test(each.when)) return true;
    var range = each.when.match(new RegExp('\\b' + month + '\\.? (\\d{1,2})\\s*[\u2013-]\\s*(\\d{1,2})\\b'));
    return !!range && day >= Number(range[1]) && day <= Number(range[2]);
  })[0];
  return notice && notice.text ? notice.text : SITE_NOTES[kind];
}

function sheetDate_(value) {
  if (value && typeof value.getTime === 'function') return isNaN(value.getTime()) ? '' : Utilities.formatDate(value, TZ, 'yyyy-MM-dd');
  var text = String(value == null ? '' : value).trim();
  var us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) text = us[3] + '-' + ('0' + us[1]).slice(-2) + '-' + ('0' + us[2]).slice(-2);
  return validDate_(text) ? text : '';
}

// ---------- Small helpers ----------

// field names the form input at fault ('name', 'email', 'phone'), so the page can point at it.
function fail_(message, field) { return field ? { ok: false, message: message, field: field } : { ok: false, message: message }; }

function id_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 16); }

function nowIso_() { return new Date(Date.now()).toISOString(); }

function property_(key, fallback) { return PropertiesService.getScriptProperties().getProperty(key) || fallback; }

function mode_() { return String(property_('SIGNUP_MODE', SIGNUP_MODE)).trim().toLowerCase() === 'hybrid' ? 'hybrid' : 'directory'; }

// Public calls are counted per minute and per kind, so a burst (or a script) cannot run through the club's Google quotas.
function tooBusy_(kind, limit) {
  var cache = CacheService.getScriptCache();
  var key = 'rate:' + kind + ':' + Math.floor(Date.now() / 60000);
  var count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), 120);
  return count > limit;
}

function cleanEmail_(value) {
  var address = String(value || '').trim().toLowerCase();
  return address.length > 254 || address.indexOf('..') >= 0 || !EMAIL_PATTERN.test(address) ? '' : address;
}

function cleanName_(value) {
  var name = String(value || '').replace(/\s+/g, ' ').trim();
  return NAME_PATTERN.test(name) ? name : '';
}

// The 10 digit US number inside whatever was typed; '' when there is none.
function phoneDigits_(value) {
  var digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? digits : '';
}

function phoneLabel_(value) {
  var digits = phoneDigits_(value);
  return digits ? '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6) : '';
}

function esc_(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function position_(id) { return POSITIONS.filter(function (spec) { return spec.id === id; })[0] || null; }

// The same human across sign-ups: the desk's player id, or for someone not on the list (hybrid mode) their email.
function personKey_(entry) {
  if (entry.key) return entry.key;
  return entry.player_id ? 'p:' + entry.player_id : 'e:' + String(entry.email || '').toLowerCase();
}

// ---------- Names ----------

// "Sam" for "Sam Kim", "Kim, Sam" or "Sam (Samuel) Kim".
function firstName_(name) {
  var text = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  var comma = text.match(/^[^,]+,\s*(.+)$/);
  var words = (comma ? comma[1] : text).split(/[\s\/&,()]+/).filter(Boolean);
  // Initials at the start stay together: "J. B. Birch" goes by "J.B.", not "J.".
  var initials = 0;
  while (initials < words.length && /^\p{L}\.?$/u.test(words[initials])) initials += 1;
  if (initials >= 2) return words.slice(0, initials).map(function (word) { return word.charAt(0) + '.'; }).join('');
  return words[0] || '';
}

// "K" for "Sam Kim" or "Kim, Sam"; '' for a one-word name.
function lastInitial_(name) {
  var text = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  var comma = text.match(/^([^,]+),\s*(.+)$/);
  var last = comma ? comma[1] : (text.split(/[\s\/&]+/).filter(Boolean).slice(1).pop() || '');
  return ((last.match(/\p{L}/u) || [''])[0]).toUpperCase();
}

// What the page calls each person on one night: first names, plus a last initial when two different people that night share
// a first name ("Sam K." and "Sam L."). Keyed by signup_id.
function publicNames_(entries) {
  var people = {};
  entries.forEach(function (entry) {
    var first = (firstName_(entry.name) || 'Volunteer').toLowerCase();
    (people[first] = people[first] || {})[personKey_(entry)] = true;
  });
  var labels = {};
  entries.forEach(function (entry) {
    var first = firstName_(entry.name) || 'Volunteer';
    var shared = Object.keys(people[first.toLowerCase()]).length > 1;
    var initial = lastInitial_(entry.name);
    labels[entry.signup_id] = shared && initial ? first + ' ' + initial + '.' : first;
  });
  return labels;
}

// "Mary-Jane O'Neil" -> ['mary', 'jane', "o'neil"], accents dropped, so a search for "jose" finds "José".
function searchWords_(text) {
  return String(text || '').slice(0, 80).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{N}'\u2019]+/u).filter(Boolean);
}

// ---------- Pacific wall-clock time ----------

function pacificNow_() {
  var parts = Utilities.formatDate(new Date(Date.now()), TZ, 'yyyy-MM-dd HH:mm').split(' ');
  return { date: parts[0], time: parts[1] };
}

function toMinutes_(time) { return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)); }

function dateUtc_(date) { return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))); }

function validDate_(date) { return DATE_PATTERN.test(date) && new Date(dateUtc_(date)).toISOString().slice(0, 10) === date; }

function weekday_(date) { return new Date(dateUtc_(date)).getUTCDay(); }

function addDays_(date, days) { return new Date(dateUtc_(date) + days * 86400000).toISOString().slice(0, 10); }

function wallMinutes_(date, time) { return dateUtc_(date) / 60000 + toMinutes_(time); }

function nowMinutes_() { var now = pacificNow_(); return wallMinutes_(now.date, now.time); }

function time12_(time) {
  var hour = Number(time.slice(0, 2));
  return ((hour + 11) % 12 + 1) + ':' + time.slice(3, 5) + ' ' + (hour < 12 ? 'AM' : 'PM');
}

function dayLabel_(date) {
  return DAYS[weekday_(date)] + ', ' + MONTHS[Number(date.slice(5, 7)) - 1] + ' ' + Number(date.slice(8, 10)) + ', ' + date.slice(0, 4);
}

// "Mon, Oct 20".
function shortDay_(date) {
  return DAYS[weekday_(date)].slice(0, 3) + ', ' + MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3) + ' ' + Number(date.slice(8, 10));
}

function momentLabel_(ms) {
  var parts = Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd HH:mm').split(' ');
  return dayLabel_(parts[0]) + ', ' + time12_(parts[1]) + ' Pacific Time';
}

function ymd_(year, month, day) { return year + '-' + ('0' + month).slice(-2) + '-' + ('0' + day).slice(-2); }

// The current month and the next two, Pacific time. first and last bound every date the app offers.
function horizon_() {
  var today = pacificNow_().date;
  var year = Number(today.slice(0, 4));
  var month = Number(today.slice(5, 7)) - 1;
  var months = [];
  for (var index = 0; index < MONTHS_SHOWN; index += 1) {
    var each = month + index;
    months.push({ year: year + Math.floor(each / 12), month: each % 12 + 1 });
  }
  var end = months[months.length - 1];
  var lastDay = new Date(Date.UTC(end.year, end.month, 0)).getUTCDate();
  return { today: today, first: ymd_(months[0].year, months[0].month, 1), last: ymd_(end.year, end.month, lastDay), months: months };
}

// Every club night in the horizon, past ones included (the calendar shows them greyed out).
function nightsIn_(horizon) {
  var dates = [];
  for (var date = horizon.first; date <= horizon.last; date = addDays_(date, 1)) if (NIGHTS[weekday_(date)]) dates.push(date);
  return dates;
}

// One club night, or null for any date that is not a Monday, Wednesday, Friday or Saturday in the horizon. bookable: not closed,
// and opening is at least CUTOFF_MINUTES away.
function nightOf_(date, horizon, closures) {
  date = String(date || '');
  if (!validDate_(date) || !NIGHTS[weekday_(date)] || date < horizon.first || date > horizon.last) return null;
  var hours = NIGHTS[weekday_(date)];
  var closed = Object.prototype.hasOwnProperty.call(closures, date);
  return {
    date: date, start: hours.start, end: hours.end, closed: closed, note: closed ? closures[date] : '', past: date < horizon.today,
    bookable: !closed && wallMinutes_(date, hours.start) - nowMinutes_() >= CUTOFF_MINUTES
  };
}

// ---------- Sign-up rules ----------

// A pending pick whose deadline has passed is expired everywhere at once, even before the hourly sweep writes it.
function signupStatus_(entry, now) { return entry.status === 'pending' && Number(entry.expires_at) <= now ? 'expired' : entry.status; }

function batchStatus_(batch, now) { return batch.status === 'pending' && Number(batch.expires_at) <= now ? 'expired' : batch.status; }

// A pending pick holds its slot like a confirmed one: nobody else can take it until it is released or expires.
function holds_(entry, now) {
  var status = signupStatus_(entry, now);
  return status === 'pending' || status === 'confirmed';
}

// The one place that decides who may take what. person: {playerId, training: {keys, open, front_desk}}. Returns '' when
// allowed, else the reason. Table/barrier setup, putting tables away and both backups are open to anyone on the player list
// (and, in hybrid mode, to anyone). Desk organizer needs key access and opening training, Money collector Front Desk training
// and Lock-up key access, from the Training tab; in hybrid mode that is also how the club approves someone not on the list.
function canTake_(person, positionId) {
  var spec = position_(positionId);
  if (!spec) return 'That position does not exist.';
  if (!person.playerId && mode_() !== 'hybrid') return 'Please find and pick your name from the club player list.';
  var missing = spec.training.filter(function (skill) { return !(person.training && person.training[skill]); });
  if (missing.length) {
    return spec.label + ' needs ' + missing.map(function (skill) { return SKILLS[skill]; }).join(' and ') + ' training. Please ask the club, or pick Table setup or Closing.';
  }
  return '';
}

function trained_(value) { return /^(yes|y|true)$/i.test(String(value == null ? '' : value).trim()); }

// The Training row for a person: by player id, or (someone not on the list, hybrid mode) by the email typed in player_id.
function trainingFor_(rows, person) {
  var row = rows.filter(function (entry) {
    var id = String(entry.player_id).trim();
    return person.playerId ? id === person.playerId : !!person.email && sameAddress_(id, person.email);
  })[0];
  var training = {};
  Object.keys(SKILLS).forEach(function (skill) { training[skill] = !!row && trained_(row[skill]); });
  return training;
}

// Why this pick cannot be taken, or ''. others: every sign-up holding a slot that night plus the earlier picks in the same
// submission. The page checks the same rules, but only this one counts.
function pickProblem_(pick, person, night, others) {
  if (!night) return 'That is not a club night in the sign-up calendar.';
  if (night.closed) return 'The club is closed that night.';
  if (!night.bookable) return 'Sign-ups for that night have closed.';
  var spec = position_(pick.position);
  var rule = canTake_(person, pick.position);
  if (rule) return rule;
  if (others.filter(function (entry) { return entry.position === pick.position; }).length >= spec.max) return spec.label + ' is already taken that night.';
  var mine = others.filter(function (entry) { return personKey_(entry) === person.key; });
  if (mine.some(function (entry) { return clash_(spec, position_(entry.position)); })) {
    return spec.part === 'open' ? 'You already have an opening position that night. Each person takes one opening position per night (backups count; the desk organizer may also help set up).' :
      'You are already closing that night.';
  }
  if (pick.finalize) {
    if (spec.part !== 'close') return 'Only a closer can also finalize the desk.';
    if (others.some(function (entry) { return entry.finalize === 'yes'; })) return 'Someone is already finalizing the desk that night.';
  }
  return '';
}

// Night status from CONFIRMED sign-ups only: 'needs' while any minimum is missing (a desk organizer, a money collector, one
// table setup, two closers), 'full' once every minimum and both backups are confirmed, else 'covered'. Extra table setup and
// closing spots stay open and optional even on a full night.
function statusOf_(entries, now) {
  var count = {};
  POSITIONS.forEach(function (spec) { count[spec.id] = 0; });
  entries.forEach(function (entry) { if (signupStatus_(entry, now) === 'confirmed' && count[entry.position] !== undefined) count[entry.position] += 1; });
  var minimums = POSITIONS.every(function (spec) { return count[spec.id] >= spec.min; });
  if (!minimums) return 'needs';
  return count['desk-backup'] >= 1 && count['money-backup'] >= 1 ? 'full' : 'covered';
}

// What a night still needs, in words, counting confirmed sign-ups only: "a money collector", "2 closers".
function missing_(entries, now) {
  var words = { desk: ['a desk organizer'], money: ['a money collector'], tables: ['someone for table/barrier setup'], lockup: ['someone to lock up'],
    close: ['someone to put tables away', ' people to put tables away'] };
  var list = [];
  POSITIONS.forEach(function (spec) {
    if (!spec.min || !words[spec.id]) return;
    var have = entries.filter(function (entry) { return entry.position === spec.id && signupStatus_(entry, now) === 'confirmed'; }).length;
    var short = spec.min - have;
    if (short > 0) list.push(short === 1 ? words[spec.id][0] : short + words[spec.id][1]);
  });
  return list;
}

// ---------- Public: the calendar ----------

// The three-month calendar: each night's status and its slots, first names only. Confirmed slots carry the sign-up's id so
// "This is me" can ask to drop it; nothing else identifies anyone.
function staffBoard() {
  if (tooBusy_('read', MAX_READS_PER_MINUTE)) return fail_('The calendar is busy right now. Please try again in a minute.');
  return board_(rows_('Signups'), closures_(), Date.now());
}

function board_(signups, closures, now) {
  var horizon = horizon_();
  var site = siteClosures_();
  var holding = signups.filter(function (entry) { return holds_(entry, now) && entry.date >= horizon.first && entry.date <= horizon.last; });
  var nights = nightsIn_(horizon).map(function (date) {
    var night = nightOf_(date, horizon, closures);
    var here = holding.filter(function (entry) { return entry.date === date; });
    var labels = publicNames_(here);
    var slots = {};
    POSITIONS.forEach(function (spec) { slots[spec.id] = []; });
    if (!night.closed && !night.past) {
      here.forEach(function (entry) {
        if (!slots[entry.position]) return;
        var pending = signupStatus_(entry, now) === 'pending';
        var slot = { name: labels[entry.signup_id], pending: pending, finalize: entry.finalize === 'yes' };
        if (!pending) slot.id = entry.signup_id;
        slots[entry.position].push(slot);
      });
    }
    return {
      date: date, day: dayLabel_(date), short: shortDay_(date), time: time12_(night.start) + ' to ' + time12_(night.end), start: night.start, end: night.end,
      status: night.closed ? 'closed' : night.past ? 'past' : statusOf_(here, now), bookable: night.bookable, note: night.closed ? night.note : siteNote_(site, date),
      missing: night.closed || night.past ? [] : missing_(here, now), slots: slots
    };
  });
  return {
    ok: true, mode: mode_(), maxPicks: MAX_PICKS, textNumber: TEXT_NUMBER, today: horizon.today,
    months: horizon.months.map(function (month) { return { year: month.year, month: month.month, title: MONTHS[month.month - 1] + ' ' + month.year }; }),
    positions: POSITIONS.map(function (spec) {
      return { id: spec.id, label: spec.label, part: spec.part, min: spec.min, max: spec.max, does: spec.does, trained: spec.training.length > 0, alsoWith: spec.alsoWith || [] };
    }),
    closures: Object.keys(closures).filter(function (date) { return date >= horizon.first && date <= horizon.last; }).sort(),
    nights: nights
  };
}

// ---------- Public: the player list ----------

// The desk's active players, [{playerId, name}], read from its private Sheet (DESK_SHEET_ID, tab Players) by header name, so
// the desk can add or move columns. Cached for 10 minutes, so typing a name does not open the desk Sheet every time.
function directory_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('directory');
  var list = null;
  if (cached) {
    try {
      list = JSON.parse(cached);
    } catch (error) {
      list = null;
    }
  }
  if (!list) {
    var id = property_('DESK_SHEET_ID', '');
    if (!id) throw new Error('Set the script property DESK_SHEET_ID to the id of the desk Sheet.');
    var sheet = SpreadsheetApp.openById(id).getSheetByName('Players');
    if (!sheet) throw new Error('The desk Sheet has no Players tab.');
    var values = sheet.getDataRange().getValues();
    var head = (values[0] || []).map(function (name) { return String(name).trim().toLowerCase(); });
    var idAt = head.indexOf('player_id');
    var nameAt = head.indexOf('display_name');
    var activeAt = head.indexOf('active');
    if (idAt < 0 || nameAt < 0 || activeAt < 0) throw new Error('The Players tab needs player_id, display_name and active columns.');
    var seen = {};
    list = [];
    values.slice(1).forEach(function (row) {
      var playerId = String(row[idAt] == null ? '' : row[idAt]).trim().slice(0, 64);
      var name = String(row[nameAt] == null ? '' : row[nameAt]).replace(/\s+/g, ' ').trim().slice(0, 80);
      var active = row[activeAt] === true || String(row[activeAt]).trim().toLowerCase() === 'true';
      if (!playerId || !name || !active || seen[playerId]) return;
      seen[playerId] = true;
      list.push([playerId, name]);
    });
    try {
      cache.put('directory', JSON.stringify(list), DIRECTORY_CACHE_SECONDS);
    } catch (error) {
      // Too big for the cache (100 KB): read the Sheet each time instead.
    }
  }
  return list.map(function (row) { return { playerId: row[0], name: row[1] }; });
}

function playerById_(playerId) { return directory_().filter(function (player) { return player.playerId === playerId; })[0] || null; }

// Name search for the sign-up form: at most FIND_LIMIT players whose name has a word starting with each word typed ("sam k"
// finds Sam Kim). Two letters at least, so the whole list is never sent to the page. Names are the ones the desk shows.
function findPlayers(query) {
  var words = searchWords_(query);
  if (words.join('').length < 2) return { ok: true, players: [] };
  if (tooBusy_('find', MAX_FINDS_PER_MINUTE)) return fail_('Too many searches right now. Please wait a moment and try again.');
  var players;
  try {
    players = directory_();
  } catch (error) {
    logError_('read the player list', error);
    return fail_('The player list is not available right now. Please try again later.');
  }
  var found = players.filter(function (player) {
    var names = searchWords_(player.name);
    return words.every(function (word) { return names.some(function (name) { return name.indexOf(word) === 0; }); });
  });
  var rank = function (player) { return searchWords_(player.name)[0].indexOf(words[0]) === 0 ? 0 : 1; };
  found.sort(function (a, b) { return rank(a) - rank(b) || a.name.localeCompare(b.name); });
  return { ok: true, players: found.slice(0, FIND_LIMIT).map(function (player) { return { playerId: player.playerId, name: player.name }; }) };
}

// Which positions the person who just picked their name may take, so the page can grey out the others ("Needs training").
// Says nothing else about them: only position ids, for one active player.
function playerAccess(playerId) {
  if (tooBusy_('find', MAX_FINDS_PER_MINUTE)) return fail_('Too many requests right now. Please wait a moment and try again.');
  var player = null;
  try {
    player = playerById_(String(playerId || '').slice(0, 64));
  } catch (error) {
    logError_('read the player list', error);
    return fail_('The player list is not available right now. Please try again later.');
  }
  if (!player) return fail_('We could not find that name on the club player list.');
  var person = { playerId: player.playerId, training: trainingFor_(rows_('Training'), { playerId: player.playerId }) };
  var onFile = approvedEmail_(rows_('Emails'), player.playerId);
  return {
    ok: true, positions: POSITIONS.filter(function (spec) { return !canTake_(person, spec.id); }).map(function (spec) { return spec.id; }),
    // Masked, so picking someone's name never shows their address: "s•••@gmail.com", or null when the club has none.
    emailOnFile: onFile ? maskEmail_(cleanEmail_(onFile.email)) : null
  };
}

// ---------- Emails on file ----------

// The player's approved email row (the newest, if the owner typed more than one), or null.
function approvedEmail_(emails, playerId) {
  var found = null;
  emails.forEach(function (row) {
    if (playerId && String(row.player_id).trim() === playerId && String(row.status).trim().toLowerCase() === 'approved' && cleanEmail_(row.email)) found = row;
  });
  return found;
}

// "s•••@gmail.com": the first character and the domain only.
function maskEmail_(email) {
  var parts = String(email || '').split('@');
  return parts.length === 2 ? parts[0].charAt(0) + '\u2022\u2022\u2022@' + parts[1] : '';
}

// Where to write to a volunteer about a sign-up: the player's email on file now (it may have changed since), else the
// address the sign-up was confirmed from.
function contactOf_(entry, emails) {
  var onFile = entry.player_id ? approvedEmail_(emails, entry.player_id) : null;
  return onFile ? cleanEmail_(onFile.email) : entry.email;
}

// Call while holding the lock. Puts an email found by an import on file, unless the player already has one from an equal or
// better source (EMAIL_RANK). Returns 'added', 'same' (already on file) or 'kept' (a different email stays on file).
function upsertEmail_(emails, player, email, source, phone) {
  var current = approvedEmail_(emails, player.playerId);
  if (current && sameAddress_(current.email, email)) {
    if (phone && !phoneDigits_(current.phone)) {
      current.phone = phone;
      save_('Emails', current);
    }
    return 'same';
  }
  if (current) {
    var rank = EMAIL_RANK[String(current.source).trim().toLowerCase()] || EMAIL_RANK.owner;
    if (rank > EMAIL_RANK[source] || (rank === EMAIL_RANK[source] && source !== 'seedlinks')) return 'kept';
    current.status = 'replaced';
    current.decided_at = nowIso_();
    save_('Emails', current);
  }
  var row = { player_id: player.playerId, name: player.name, email: email, phone: phone || '', source: source, status: 'approved', requested_at: '', decided_at: nowIso_(), batch_id: '' };
  save_('Emails', row);
  emails.push(row);
  return 'added';
}

// Call while holding the lock. At most one approved email per player: when several are approved (the owner typed a new
// one), the newest stays and the others are marked replaced.
function tidyEmails_(emails) {
  var newest = {};
  emails.forEach(function (row) { if (String(row.status).trim().toLowerCase() === 'approved' && cleanEmail_(row.email)) newest[String(row.player_id).trim()] = row; });
  emails.forEach(function (row) {
    var id = String(row.player_id).trim();
    if (String(row.status).trim().toLowerCase() !== 'approved' || !newest[id] || newest[id] === row || !cleanEmail_(row.email)) return;
    row.status = 'replaced';
    row.decided_at = nowIso_();
    save_('Emails', row);
  });
}

// ---------- Public: signing up ----------

function cleanPicks_(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_PICKS + 1).map(function (pick) {
    pick = pick || {};
    return { date: String(pick.date || '').slice(0, 10), position: String(pick.position || '').slice(0, 20), finalize: pick.finalize === true };
  });
}

// Called by the form with every pick at once. All or nothing: if any pick cannot be taken, nothing is saved and the answer
// lists each one with its reason, so the page can mark them. Nobody can sign up as someone else:
//   - a player with an email on file: the picks are saved as pending (holding their slots) and one email asks for YES, sent
//     ONLY to the email on file. Whatever email or phone the page sends is ignored, and the page only ever sees it masked;
//   - a player with no email on file: the email typed is a REQUEST. Nothing is held; the club is asked once to approve the
//     address (clubAnswer_). On YES the picks still free become pending holds and the person is asked for their own YES;
//   - someone not on the list (hybrid mode only): confirmed from the email they type, as there is no player to impersonate.
// The public form takes no phone: texts only ever go to a mobile on file (Emails.phone).
function signUp(form) {
  form = form || {};
  if (form.website) return { ok: true, message: 'Thanks.' };
  var picks = cleanPicks_(form.picks);
  var typedEmail = cleanEmail_(form.email);
  if (!picks.length) return fail_('Please pick at least one shift.');
  if (picks.length > MAX_PICKS) return fail_('Please send at most ' + MAX_PICKS + ' shifts at a time.');
  var person = null;
  if (form.playerId) {
    var player = null;
    try {
      player = playerById_(String(form.playerId));
    } catch (error) {
      logError_('read the player list', error);
      return fail_('The player list is not available right now. Please try again later.');
    }
    if (!player) return fail_('We could not find that name on the club player list. Please search for it again.', 'name');
    person = { playerId: player.playerId, name: player.name, key: 'p:' + player.playerId };
  } else if (form.unlisted === true && mode_() === 'hybrid') {
    var typed = cleanName_(form.name);
    if (!typed) return fail_('Please enter your first and last name. Use letters; spaces and - \' . are fine.', 'name');
    person = { playerId: '', name: typed, unlisted: true };
  } else {
    return fail_('Please find and pick your name from the club player list.', 'name');
  }
  var batch = null;
  var count = 0;
  var request = false;
  var onFile = null;
  var askApproval = false;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (tooBusy_('write', MAX_WRITES_PER_MINUTE)) return fail_('Too many sign-ups right now. Please try again in a few minutes.');
    var now = Date.now();
    var emails = rows_('Emails');
    onFile = person.playerId ? approvedEmail_(emails, person.playerId) : null;
    var email = onFile ? cleanEmail_(onFile.email) : typedEmail;
    var phone = onFile ? phoneDigits_(onFile.phone) : '';
    request = !!person.playerId && !onFile;
    if (!email) return fail_(request ? 'We don\'t have an email for you yet. Please enter yours.' : 'Please enter a valid email address.', 'email');
    person.email = email;
    if (!person.key) person.key = 'e:' + email;
    var signups = rows_('Signups');
    if (signups.length + picks.length > MAX_SIGNUPS) return fail_('Sign-ups are closed for now. Please contact the club.');
    if (request) {
      var open = emails.filter(function (row) { return String(row.status).trim().toLowerCase() === 'pending'; });
      if (open.some(function (row) { return String(row.player_id).trim() === person.playerId; })) {
        return fail_('The club has not answered your last request yet. We will email you as soon as it does.');
      }
      if (open.some(function (row) { return sameAddress_(row.email, email); })) return fail_('That email address is already waiting for the club to confirm it.', 'email');
      if (open.length >= MAX_OPEN_REQUESTS) return fail_('Please ask the club to add your email.', 'email');
    } else {
      var waiting = rows_('Batches').filter(function (entry) { return batchStatus_(entry, now) === 'pending' && sameAddress_(entry.email, email); });
      if (waiting.length >= MAX_PENDING_PER_EMAIL) {
        return fail_('There are already ' + MAX_PENDING_PER_EMAIL + ' sign-ups waiting for a YES from this email address. Please answer those emails first.', person.unlisted ? 'email' : '');
      }
    }
    var known = rows_('People').filter(function (entry) { return sameAddress_(entry.email, email); })[0];
    var trainings = rows_('Training');
    person.training = trainingFor_(trainings, person);
    var horizon = horizon_();
    var closures = closures_();
    var holding = signups.filter(function (entry) { return holds_(entry, now); });
    var accepted = [];
    var problems = [];
    picks.forEach(function (pick) {
      var others = holding.filter(function (entry) { return entry.date === pick.date; }).concat(accepted.filter(function (entry) { return entry.date === pick.date; }));
      var reason = pickProblem_(pick, person, nightOf_(pick.date, horizon, closures), others);
      if (reason) {
        problems.push({ date: pick.date, position: pick.position, reason: reason });
        if (person.unlisted && position_(pick.position) && position_(pick.position).training.length && /training/.test(reason)) askApproval = true;
      } else {
        accepted.push({ date: pick.date, position: pick.position, finalize: pick.finalize ? 'yes' : '', key: person.key });
      }
    });
    if (askApproval) markAsked_(person, trainings);
    if (problems.length) {
      return { ok: false, problems: problems, message: (problems.length === 1 ? 'One pick cannot be taken' : problems.length + ' picks cannot be taken') +
        ', so nothing was sent. Remove ' + (problems.length === 1 ? 'it' : 'them') + ' (marked below) and send again.' };
    }
    // A request holds nothing; it waits up to CLUB_WAIT_MS for the club.
    var expires = request ? now + CLUB_WAIT_MS : expiryFor_(accepted, now);
    batch = {
      batch_id: id_(), email: email, name: person.name, player_id: person.playerId, phone: phone, status: request ? 'awaiting_club' : 'pending', created_at: nowIso_(),
      expires_at: String(expires), emailed: '', texted: '', updated_at: nowIso_()
    };
    save_('Batches', batch);
    accepted.forEach(function (pick) {
      save_('Signups', {
        signup_id: id_(), batch_id: batch.batch_id, date: pick.date, position: pick.position, finalize: pick.finalize, player_id: person.playerId,
        name: person.name, email: email, status: request ? 'requested' : 'pending', created_at: nowIso_(), expires_at: String(expires), updated_at: nowIso_()
      });
    });
    count = accepted.length;
    if (request) {
      save_('Emails', { player_id: person.playerId, name: person.name, email: email, phone: '', source: 'request', status: 'pending', requested_at: nowIso_(), decided_at: '', batch_id: batch.batch_id });
      logRow_('step', 'step:awaiting_club', batch.batch_id, '-', count + ' picks, an email for the club to approve');
    } else {
      rememberPerson_(person, phone, known);
      logRow_('step', 'step:pending', batch.batch_id, '-', count + ' picks, waiting until ' + momentLabel_(expires));
    }
  } finally {
    lock.releaseLock();
    // Told even when the submission was refused (that is when it happens), after the lock: mail is slow.
    if (askApproval) {
      alertAdmin_('approval', 'Staffing: someone not on the player list asked to run the desk or collect money', [
        'Someone who is not on the desk\'s player list asked for Desk organizer or Money collector. Their row is in the private staffing Sheet, Training tab (their email is in player_id). To allow it, type yes in keys and open (desk) or front_desk (money) for anyone the club has trained.']);
    }
  }
  // The picks are saved. Nothing after this may turn into an error on the page: the person would send again and be told their
  // own picks are taken. A failed email is retried by the hourly sweep.
  try {
    sweep_();
  } catch (error) {
    logError_('finish a saved sign-up', error, batch.batch_id);
  }
  var shifts = count + ' shift' + (count === 1 ? '' : 's');
  if (request) {
    return { ok: true, request: true, count: count, textNumber: TEXT_NUMBER,
      message: 'Thanks. We don\'t have an email for you yet, so the club will confirm ' + batch.email + ' once. Then we\'ll email you to confirm your ' + shifts +
        '. Nothing is held until then, so someone else may take a spot meanwhile.' };
  }
  var to = onFile ? maskEmail_(batch.email) : batch.email;
  return {
    ok: true, count: count, deadline: momentLabel_(Number(batch.expires_at)), textNumber: TEXT_NUMBER, emailOnFile: onFile ? to : null,
    message: 'Almost done: we emailed ' + to + '. Reply YES to that email by ' + momentLabel_(Number(batch.expires_at)) + ' to confirm your ' + shifts + '. ' +
      (count === 1 ? 'It is' : 'They are') + ' held for you until then and show as "waiting to confirm".'
  };
}

// A hold lasts HOLD_MS, but never past CUTOFF_MINUTES before the earliest picked night opens.
function expiryFor_(picks, now) {
  var soonest = Math.min.apply(null, picks.map(function (pick) { return wallMinutes_(pick.date, NIGHTS[weekday_(pick.date)].start); }));
  return now + Math.max(0, Math.min(HOLD_MS, (soonest - nowMinutes_() - CUTOFF_MINUTES) * 60000));
}

// Call while holding the lock. Keeps the latest name, and the mobile number on file (Emails.phone); a new number has to text
// STAFF again, and with no number on file there are no texts.
function rememberPerson_(person, phone, known) {
  var entry = known || { email: person.email, created_at: nowIso_(), texts: '' };
  if ((phone || '') !== phoneDigits_(entry.phone)) {
    entry.phone = phone || '';
    entry.texts = '';
  }
  entry.name = person.name;
  if (person.playerId) entry.player_id = person.playerId;
  entry.updated_at = nowIso_();
  save_('People', entry);
}

// Call while holding the lock. Someone not on the list (hybrid mode) asked for Desk or Money: they get an untrained Training
// row, keyed by their email, for the owner to fill in.
function markAsked_(person, trainings) {
  if (trainings.some(function (entry) { return sameAddress_(String(entry.player_id).trim(), person.email); })) return;
  save_('Training', { player_id: person.email, name: person.name, keys: '', open: '', front_desk: '', updated_at: nowIso_() });
}

// ---------- Seeding from the volunteer's list (owner only) ----------
// The club's existing open/close list is a Sheet kept by a volunteer (script property SEED_SHEET_ID), tab "Open/Close" (or
// the tab named in SEED_SHEET_TAB). parseSeed_ is the only code that knows its layout: a roster block whose header row says
// "Open" and "Front Desk", with one row per weekday holding first names, and a "Training list" block with "Keys Access",
// "Open" and "Front Desk" columns holding Yes, No or N/A. Both are found by those labels, not by row numbers; anything else
// on the tab (the duty checklists) is ignored, and unknown roster columns are only counted.
var SEED_TAB = 'Open/Close';
// The volunteer's roster columns and the position each fills. Barriers and Setup are both table/barrier setup; Close is the
// lock-up keyholder and Takedown is putting tables away. RR Admin is the desk organizer on round robin nights (the same person
// as Open), so it is read but adds nothing.
var SEED_ROSTER = { 'open': 'desk', 'front desk': 'money', 'barriers': 'tables', 'setup': 'tables', 'close': 'lockup', 'takedown': 'close', 'rr admin': '' };
var SEED_TRAINING = { 'keys access': 'keys', 'open': 'open', 'front desk': 'front_desk' };
var SEED_CANDIDATES = 5;

// Run from the Apps Script editor by the owner, after setup(). Does nothing from the web page. Steps:
//   1. Each name in the volunteer's Sheet is linked to ONE active desk player (seedPlayer_): a filled SeedLinks row first,
//      then the exact full name or a desk alias, then a first name only one active player has. Anything else is skipped.
//   2. The training list is written to the Training tab (by player id, so a re-run updates rather than adds).
//   3. Emails found for linked people (seedEmail_) go on file in the Emails tab, unless a better one is there already.
//      Each roster name with an email on file gets the normal PENDING holds on every matching night in the calendar (not
//      closures), one submission per person, checked by the same rules as the page, and one normal email asking YES.
//   4. SeedReport is rewritten with the counts and every name that needs fixing, with candidate players; SeedLinks gets a
//      blank row for each such name (a dropdown of players in player_name). Fill those in and run it again.
// Safe to run again: a hold already made from the seed Sheet (seed_key) is never made or emailed twice, whatever became of it.
// Returns, and logs, counts and the seed Sheet's own names (first name and last initial) only: no emails or desk names.
function importSeedSheet() {
  if (Session.getActiveUser().getEmail() !== Session.getEffectiveUser().getEmail()) throw new Error('Only the owner can import the seed Sheet.');
  if (seedImportedAt_()) throw new Error(seedClosedText_());
  var report = importSeed_(false);
  // The volunteer's list is a one-time import: from now on the club keeps everything in this app's own Sheet.
  PropertiesService.getScriptProperties().setProperty('SEED_IMPORTED_AT', nowIso_());
  return report;
}

// When the volunteer's open/close list was imported (it is read only once), or ''. A maintainer can delete the script
// property SEED_IMPORTED_AT to allow one more import.
function seedImportedAt_() { return property_('SEED_IMPORTED_AT', ''); }

function seedClosedText_() {
  var at = Date.parse(seedImportedAt_());
  return 'The open/close list was imported once' + (at ? ', on ' + momentLabel_(at) : '') + ', and is no longer read. Training and emails are kept in the ' +
    'private staffing Sheet (Training and Emails tabs), and volunteers sign up on the calendar.';
}

// links (with preview): also rewrite SeedReport and add SeedLinks rows for every name to fix, so the owner can fill in emails
// before anything is held or sent.
// preview: work out exactly what importSeedSheet would do and return it, but write nothing to any Sheet and send nothing.
// report.preview lists each person who would be emailed: the seed Sheet's name for them, their email masked, how many
// nights and which positions.
// Seed submissions still waiting for a YES whose last email went out over RESEND_AFTER_MS ago: [{batch, picks (still pending),
// onFile (the email on file now, or '')}].
function waitingSeed_(now) {
  var signups = rows_('Signups');
  var emails = rows_('Emails');
  return rows_('Batches').filter(function (batch) {
    var last = Math.max(Date.parse(batch.created_at) || 0, Date.parse(batch.resent_at) || 0);
    return batch.source === 'seed' && batchStatus_(batch, now) === 'pending' && now - last >= RESEND_AFTER_MS;
  }).map(function (batch) {
    var picks = signups.filter(function (entry) { return entry.batch_id === batch.batch_id && signupStatus_(entry, now) === 'pending'; });
    var onFile = batch.player_id ? approvedEmail_(emails, batch.player_id) : null;
    return { batch: batch, picks: picks, onFile: onFile ? cleanEmail_(onFile.email) : '' };
  }).filter(function (waiting) { return waiting.picks.length; });
}

// Sends everyone still waiting the current confirmation email again, at their email on file now, with a fresh deadline.
// The submission and its code stay the same, so a YES to the old email still counts too. Returns how many were re-sent.
// only: the batch ids to re-send (those already waiting before an import ran), or every waiting one when omitted.
function resendSeed_(only) {
  var now = Date.now();
  var count = 0;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var signups = rows_('Signups');
    waitingSeed_(now).forEach(function (waiting) {
      var batch = waiting.batch;
      if (only && only.indexOf(batch.batch_id) < 0) return;
      var expires = now + SEED_HOLD_MS;
      batch.email = waiting.onFile || batch.email;
      batch.expires_at = String(expires);
      batch.emailed = '';
      batch.texted = '';
      batch.resent_at = nowIso_();
      batch.updated_at = nowIso_();
      save_('Batches', batch);
      signups.forEach(function (entry) {
        if (entry.batch_id !== batch.batch_id || signupStatus_(entry, now) !== 'pending') return;
        entry.email = batch.email;
        entry.expires_at = String(expires);
        entry.updated_at = nowIso_();
        save_('Signups', entry);
      });
      logRow_('step', 'step:resent', batch.batch_id, '-', waiting.picks.length + ' picks, waiting until ' + momentLabel_(expires));
      count += 1;
    });
  } finally {
    lock.releaseLock();
  }
  if (count) sweep_();
  return count;
}

function importSeed_(preview, links) {
  var id = property_('SEED_SHEET_ID', '');
  if (!id) throw new Error('Set the script property SEED_SHEET_ID to the id of the volunteer\'s Sheet.');
  var book = SpreadsheetApp.openById(id);
  var sheet = book.getSheetByName(property_('SEED_SHEET_TAB', SEED_TAB)) || book.getSheets()[0];
  var parsed = parseSeed_(sheet.getDataRange().getValues());
  CacheService.getScriptCache().remove('directory');
  var data = { players: directory_(), links: rows_('SeedLinks'), coaching: [] };
  var desk = SpreadsheetApp.openById(property_('DESK_SHEET_ID', ''));
  data.aliases = tableOf_(desk, 'Aliases').map(function (row) { return { alias: String(row.alias || ''), playerId: String(row.player_id || '').trim() }; });
  data.zeffy = tableOf_(desk, 'ZeffyPayments');
  if (property_('COACHING_DB_ID', '')) {
    try {
      var coaching = SpreadsheetApp.openById(property_('COACHING_DB_ID', ''));
      data.coaching = tableOf_(coaching, 'Coaches').concat(tableOf_(coaching, 'Students'));
    } catch (error) {
      logError_('read the coaching Sheet for emails', error);
    }
  }
  var report = { training: 0, people: 0, signups: 0, skipped: {}, unmatched: [], ambiguous: [], noEmail: [] };
  if (preview) {
    report.preview = [];
    report.emailsFor = {};
    // Each roster person the preview cannot fully hold, and why: {name, nights held, reasons: {reason: nights}}.
    report.held = [];
  }
  // A preview keeps every change in memory: an email found goes on file only in this run's copy of the Emails rows.
  var putOnFile = function (emails, player, email, source, phone) {
    if (!preview) return upsertEmail_(emails, player, email, source, phone);
    // The same rule as upsertEmail_ (EMAIL_RANK; a SeedLinks email replaces one found in Zeffy or coaching), in memory only.
    var current = approvedEmail_(emails, player.playerId);
    if (current && sameAddress_(current.email, email)) return;
    if (current) {
      var rank = EMAIL_RANK[String(current.source).trim().toLowerCase()] || EMAIL_RANK.owner;
      if (rank > EMAIL_RANK[source] || (rank === EMAIL_RANK[source] && source !== 'seedlinks')) return;
      current.status = 'replaced';
    }
    emails.push({ player_id: player.playerId, email: email, phone: phone || '', source: source, status: 'approved' });
  };
  var problems = [];
  var skip = function (reason, count) { if (count !== 0) report.skipped[reason] = (report.skipped[reason] || 0) + (count || 1); };
  var unresolved = function (kind, sheetName, candidates) {
    var label = seedLabel_(sheetName);
    if (report[kind].indexOf(label) >= 0) return;
    report[kind].push(label);
    problems.push({ kind: kind, name: label, candidates: candidates || [] });
  };
  if (parsed.unknownColumns) skip('unknown roster column', parsed.unknownColumns);
  if (parsed.otherDays) skip('roster row for a day the club is closed', parsed.otherDays);
  var linked = {};
  var linkOf = function (name) { return linked[name] || (linked[name] = seedPlayer_(name, data)); };
  var horizon = horizon_();
  var closures = closures_();
  var groups = {};
  parsed.roster.forEach(function (entry) {
    var nights = nightsIn_(horizon).filter(function (date) { return weekday_(date) === entry.weekday && date >= horizon.today; });
    var found = linkOf(entry.name);
    if (!found.player) {
      skip('roster: name ' + found.kind, nights.length);
      unresolved(found.kind, entry.name, found.candidates);
      return;
    }
    var group = groups[found.player.playerId] = groups[found.player.playerId] || { player: found.player, sheetName: entry.name, found: null, picks: [] };
    group.found = group.found || seedEmail_(found.player, entry.name, data);
    nights.forEach(function (date) {
      group.picks.push({ date: date, position: entry.position, finalize: false, seedKey: code_('seed:' + date + ':' + entry.position + ':' + found.player.playerId) });
    });
  });
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var trainings = rows_('Training');
    // What the lookups found goes on file (EMAIL_RANK decides against what is already there); holds then use the email on file.
    var emails = rows_('Emails');
    Object.keys(groups).forEach(function (playerId) {
      var found = groups[playerId].found;
      if (found) putOnFile(emails, groups[playerId].player, found.email, found.source, found.phone);
    });
    parsed.training.forEach(function (row) {
      var found = linkOf(row.name);
      if (!found.player) {
        skip('training: name ' + found.kind);
        unresolved(found.kind, row.name, found.candidates);
        return;
      }
      var entry = trainings.filter(function (each) { return String(each.player_id).trim() === found.player.playerId; })[0];
      if (!entry) trainings.push(entry = { player_id: found.player.playerId });
      var before = JSON.stringify([entry.name, entry.keys, entry.open, entry.front_desk]);
      entry.name = found.player.name;
      // The Training tab is where the club manages training: the volunteer's list only adds people and fills blank cells, so a
      // change made in the tab (Susan marked trained) is never undone by running the import again.
      Object.keys(SKILLS).forEach(function (skill) { if (row[skill] && !String(entry[skill] == null ? '' : entry[skill]).trim()) entry[skill] = row[skill]; });
      if (JSON.stringify([entry.name, entry.keys, entry.open, entry.front_desk]) !== before) {
        entry.updated_at = nowIso_();
        if (!preview) save_('Training', entry);
      }
      report.training += 1;
      var email = seedEmail_(found.player, row.name, data);
      if (email) putOnFile(emails, found.player, email.email, email.source, email.phone);
    });
    var now = Date.now();
    var signups = rows_('Signups');
    var imported = {};
    // A hold that expired without an answer may be offered again; a NO (released), a confirmation or a drop stays final.
    signups.forEach(function (entry) { if (entry.seed_key && signupStatus_(entry, now) !== 'expired') imported[entry.seed_key] = true; });
    var holding = signups.filter(function (entry) { return holds_(entry, now); });
    var people = rows_('People');
    Object.keys(groups).forEach(function (playerId) {
      var group = groups[playerId];
      var reasons = {};
      var skip = function (reason, count) {
        report.skipped[reason] = (report.skipped[reason] || 0) + (count || 1);
        // A closed night is left out on purpose, so it is not listed as a problem.
        if (reason !== 'club closed that night') reasons[reason] = (reasons[reason] || 0) + (count || 1);
      };
      var tell = function (nights) {
        if (preview && Object.keys(reasons).length) report.held.push({ name: seedLabel_(group.sheetName), nights: nights, reasons: reasons });
      };
      var onFile = approvedEmail_(emails, playerId);
      if (!onFile) {
        skip('roster: no email found', group.picks.length);
        tell(0);
        unresolved('noEmail', group.sheetName, [group.player.name]);
        return;
      }
      group.email = cleanEmail_(onFile.email);
      // The address each linked person would be written to after this run (SeedLinks first), for re-sends shown on the preview.
      if (preview) report.emailsFor[playerId] = group.email;
      var person = { playerId: playerId, name: group.player.name, email: group.email, key: 'p:' + playerId };
      person.training = trainingFor_(trainings, person);
      var accepted = [];
      group.picks.sort(function (a, b) { return a.date.localeCompare(b.date); }).forEach(function (pick) {
        if (imported[pick.seedKey]) return skip('already imported');
        if (accepted.length >= MAX_PICKS) return skip('more than ' + MAX_PICKS + ' nights for one person');
        var others = holding.concat(accepted).filter(function (entry) { return entry.date === pick.date; });
        var reason = pickProblem_(pick, person, nightOf_(pick.date, horizon, closures), others);
        if (reason) return skip(seedReason_(reason));
        imported[pick.seedKey] = true;
        accepted.push({ date: pick.date, position: pick.position, finalize: '', key: person.key, seedKey: pick.seedKey });
      });
      tell(accepted.length);
      if (!accepted.length) return;
      report.people += 1;
      report.signups += accepted.length;
      if (preview) {
        var labels = {};
        accepted.forEach(function (pick) { labels[position_(pick.position).label] = true; });
        // The first person's picks, kept so the owner can be sent a test copy of their email (never shown on the page).
        if (!report.sample) report.sample = { name: group.player.name, picks: accepted.map(function (pick) { return { date: pick.date, position: pick.position, finalize: '', status: 'pending' }; }) };
        report.preview.push({ playerId: playerId, name: seedLabel_(group.sheetName), email: maskEmail_(group.email), nights: accepted.length, positions: Object.keys(labels),
          first: accepted[0].date, last: accepted[accepted.length - 1].date });
        return;
      }
      var expires = now + SEED_HOLD_MS;
      var batch = { batch_id: id_(), email: group.email, name: person.name, player_id: playerId, phone: phoneDigits_(onFile.phone), status: 'pending', created_at: nowIso_(),
        expires_at: String(expires), emailed: '', texted: '', updated_at: nowIso_(), source: 'seed' };
      save_('Batches', batch);
      accepted.forEach(function (pick) {
        var entry = {
          signup_id: id_(), batch_id: batch.batch_id, date: pick.date, position: pick.position, finalize: '', player_id: playerId, name: person.name,
          email: group.email, status: 'pending', created_at: nowIso_(), expires_at: String(expires), updated_at: nowIso_(), seed_key: pick.seedKey
        };
        save_('Signups', entry);
        holding.push(entry);
      });
      var known = people.filter(function (entry) { return sameAddress_(entry.email, group.email); })[0];
      rememberPerson_(person, phoneDigits_(onFile.phone), known);
      if (!known) people = rows_('People');
      logRow_('step', 'step:pending', batch.batch_id, '-', accepted.length + ' picks from the seed Sheet');
    });
    if (!preview || links) writeSeedReport_(report, problems, data);
  } finally {
    lock.releaseLock();
  }
  if (preview) return report;
  // Sends each new person their single confirmation email (and retries any that fail, every hour).
  sweep_();
  console.log('Seed import: ' + JSON.stringify(report));
  return report;
}

function seedText_(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase(); }

// 1 for "Monday", "Mon" or "Mondays"; -1 for anything that is not a day name.
function weekdayOf_(value) {
  var text = seedText_(value).replace(/[^a-z]/g, '');
  if (text.length < 3) return -1;
  for (var day = 0; day < DAYS.length; day += 1) {
    var name = DAYS[day].toLowerCase();
    if (text === name.slice(0, 3) || text.indexOf(name) === 0) return day;
  }
  return -1;
}

// "Ron\nSusan", "Ron / Susan", "Ron, Susan", "Ron & Susan" and "Ron and Susan" are two people. N/A and blanks are nobody.
function splitNames_(value) {
  return String(value == null ? '' : value).replace(/\bn\/a\b/gi, ' ').split(/\r?\n|\/|,|&|\+|;|\band\b/i).map(function (name) {
    return name.replace(/\s+/g, ' ').trim();
  }).filter(function (name) { return /\p{L}/u.test(name) && !/^(none|tbd|tba|open|no one|nobody)$/i.test(name); });
}

// {roster: [{weekday, position, name}], training: [{name, keys, open, front_desk}], unknownColumns, otherDays}.
function parseSeed_(values) {
  var result = { roster: [], training: [], unknownColumns: 0, otherDays: 0 };
  var trainingAt = -1;
  var rosterAt = -1;
  values.forEach(function (row, index) {
    var labels = row.map(seedText_);
    if (trainingAt < 0 && labels.indexOf('training list') >= 0) trainingAt = index;
    else if (rosterAt < 0 && labels.indexOf('open') >= 0 && labels.indexOf('front desk') >= 0) rosterAt = index;
  });
  if (rosterAt >= 0) {
    var seen = {};
    var head = values[rosterAt].map(seedText_);
    var dayAt = -1;
    for (var r = rosterAt + 1; r < values.length; r += 1) {
      var row = values[r];
      var found = -1;
      for (var c = 0; c < row.length && found < 0; c += 1) if (weekdayOf_(row[c]) >= 0) found = c;
      if (found < 0) break;
      dayAt = found;
      var weekday = weekdayOf_(row[found]);
      if (!NIGHTS[weekday]) {
        result.otherDays += 1;
        continue;
      }
      head.forEach(function (label, column) {
        var position = SEED_ROSTER[label];
        if (!position) return;
        var names = splitNames_(row[column]);
        // Two names in a one-person position ("Ron / Susan" at the Front Desk) are the primary and the backup, and a third has
        // no slot; in a position for several people ("Ryan/Peggy" for takedown) every name takes a spot.
        if (position_(position + '-backup')) names = names.slice(0, 2);
        names.forEach(function (name, index) {
          var id = index && position_(position + '-backup') ? position + '-backup' : position;
          var key = weekday + ':' + id + ':' + seedKeyOf_(name);
          if (seen[key]) return; // the same person under Barriers and Setup is one table/barrier setup spot
          seen[key] = true;
          result.roster.push({ weekday: weekday, position: id, name: name });
        });
      });
    }
    head.forEach(function (label, column) { if (label && !Object.prototype.hasOwnProperty.call(SEED_ROSTER, label) && column !== dayAt) result.unknownColumns += 1; });
  }
  if (trainingAt >= 0) {
    var labels = values[trainingAt].map(seedText_);
    var nameAt = labels.indexOf('training list');
    for (var t = trainingAt + 1; t < values.length; t += 1) {
      var name = String(values[t][nameAt] == null ? '' : values[t][nameAt]).replace(/\s+/g, ' ').trim();
      if (!name) break;
      var entry = { name: name };
      labels.forEach(function (label, column) { if (SEED_TRAINING[label]) entry[SEED_TRAINING[label]] = trained_(values[t][column]) ? 'yes' : 'no'; });
      result.training.push(entry);
    }
  }
  return result;
}

// A tab of another Sheet as objects keyed by lowercased header; [] when the tab does not exist.
function tableOf_(book, name) {
  var sheet = book.getSheetByName(name);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  var head = (values[0] || []).map(function (label) { return String(label == null ? '' : label).trim().toLowerCase(); });
  return values.slice(1).map(function (row) {
    var entry = {};
    head.forEach(function (label, column) { if (label) entry[label] = row[column]; });
    return entry;
  });
}

// The same name whatever the case, spacing, accents or "Last, First" order.
function seedKeyOf_(name) { return searchWords_(nameKey_(name)).join(' '); }

// How the report shows a seed Sheet name: first name and last initial ("Ron", "Ron S."), never more.
function seedLabel_(name) {
  var first = firstName_(name);
  var initial = lastInitial_(name);
  return first + (initial ? ' ' + initial + '.' : '');
}

// The SeedLinks row the owner filled for a seed Sheet name (as written there, or as the report shows it).
function seedLinkRow_(links, sheetName) {
  var key = seedKeyOf_(sheetName);
  var label = seedKeyOf_(seedLabel_(sheetName));
  return links.filter(function (row) { var each = seedKeyOf_(row.sheet_name); return !!each && (each === key || each === label); })[0] || null;
}

// Up to SEED_CANDIDATES active players a name could mean, by full display name, for the private SeedReport only.
function candidates_(name, players) {
  var stem = (searchWords_(nameKey_(name))[0] || '').slice(0, 3);
  if (!stem) return [];
  return players.filter(function (player) { return searchWords_(player.name).some(function (word) { return word.indexOf(stem) === 0; }); })
    .map(function (player) { return player.name; }).sort().slice(0, SEED_CANDIDATES);
}

// The one active desk player a seed Sheet name means: {player}, or {kind: 'unmatched' | 'ambiguous', candidates}.
function seedPlayer_(sheetName, data) {
  var namesOf = function (list) { return list.map(function (player) { return player.name; }).sort().slice(0, SEED_CANDIDATES); };
  var link = seedLinkRow_(data.links, sheetName);
  if (link && String(link.player_name).trim()) {
    var wanted = String(link.player_name).trim();
    var chosen = data.players.filter(function (player) { return player.playerId === wanted || seedKeyOf_(player.name) === seedKeyOf_(wanted); });
    return chosen.length === 1 ? { player: chosen[0] } : { kind: chosen.length ? 'ambiguous' : 'unmatched', candidates: chosen.length ? namesOf(chosen) : candidates_(wanted, data.players) };
  }
  var key = seedKeyOf_(sheetName);
  var exact = data.players.filter(function (player) { return seedKeyOf_(player.name) === key; });
  if (exact.length === 1) return { player: exact[0] };
  if (exact.length > 1) return { kind: 'ambiguous', candidates: namesOf(exact) };
  var ids = {};
  data.aliases.forEach(function (alias) { if (seedKeyOf_(alias.alias) === key) ids[alias.playerId] = true; });
  var aliased = data.players.filter(function (player) { return ids[player.playerId]; });
  if (aliased.length === 1) return { player: aliased[0] };
  if (aliased.length > 1) return { kind: 'ambiguous', candidates: namesOf(aliased) };
  if (key && key.indexOf(' ') < 0) {
    var firsts = data.players.filter(function (player) { return searchWords_(firstName_(player.name))[0] === key; });
    if (firsts.length === 1) return { player: firsts[0] };
    if (firsts.length > 1) return { kind: 'ambiguous', candidates: namesOf(firsts) };
  }
  return { kind: 'unmatched', candidates: candidates_(sheetName, data.players) };
}

// The desk has no emails. In order: the owner's SeedLinks row, the latest Zeffy payment under the player's name (or an
// alias), the coaching app's Coaches and Students tabs by full name (which may also have a mobile). {email, source, phone}
// or null when none has one.
function seedEmail_(player, sheetName, data) {
  var link = seedLinkRow_(data.links, sheetName);
  if (link && cleanEmail_(link.email)) return { email: cleanEmail_(link.email), source: 'seedlinks', phone: '' };
  var keys = {};
  keys[seedKeyOf_(player.name)] = true;
  data.aliases.forEach(function (alias) { if (alias.playerId === player.playerId) keys[seedKeyOf_(alias.alias)] = true; });
  var paid = data.zeffy.filter(function (row) { return keys[seedKeyOf_(row.payer_name)] && cleanEmail_(row.payer_email); });
  if (paid.length) return { email: cleanEmail_(paid[paid.length - 1].payer_email), source: 'zeffy', phone: '' };
  var known = data.coaching.filter(function (row) { return seedKeyOf_(row.name) === seedKeyOf_(player.name) && cleanEmail_(row.email); });
  if (!known.length) return null;
  var last = known[known.length - 1];
  return { email: cleanEmail_(last.email), source: 'coaching', phone: phoneDigits_(last.phone) };
}

// Call while holding the lock. Rewrites SeedReport, adds a blank SeedLinks row for each name to fix (never a second one), and
// keeps a dropdown of active players on SeedLinks' player_name column (from a hidden helper tab, since the list is long).
function writeSeedReport_(report, problems, data) {
  var sheet = tab_('SeedReport');
  if (sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
  var at = nowIso_();
  var lines = [['summary', 'training rows imported', report.training], ['summary', 'people asked to confirm', report.people], ['summary', 'holds made', report.signups]];
  Object.keys(report.skipped).sort().forEach(function (reason) { lines.push(['skipped', reason, report.skipped[reason]]); });
  lines.forEach(function (line) { save_('SeedReport', { at: at, kind: line[0], name: line[1], count: line[2], candidates: '' }); });
  problems.forEach(function (problem) {
    save_('SeedReport', { at: at, kind: problem.kind === 'noEmail' ? 'no email' : problem.kind, name: problem.name, count: '', candidates: problem.candidates.join(', ') });
    if (!seedLinkRow_(data.links, problem.name)) {
      var row = { sheet_name: problem.name, player_name: '', email: '' };
      save_('SeedLinks', row);
      data.links.push(row);
    }
  });
  var book = database_();
  var helper = book.getSheetByName('SeedPlayers') || book.insertSheet('SeedPlayers');
  var names = data.players.map(function (player) { return [player.name]; }).sort();
  helper.clearContents();
  if (names.length) helper.getRange(1, 1, names.length, 1).setNumberFormat('@').setValues(names);
  helper.hideSheet();
  var rule = SpreadsheetApp.newDataValidation().requireValueInRange(helper.getRange(1, 1, Math.max(names.length, 1), 1), true).setAllowInvalid(true)
    .setHelpText('Pick the desk player this name means (a player_id works too). Then run importSeedSheet again.').build();
  tab_('SeedLinks').getRange(2, 2, 500, 1).setDataValidation(rule);
}

// pickProblem_'s sentence as a short reason for the import counts.
function seedReason_(reason) {
  if (/not a club night/.test(reason)) return 'not a club night in the calendar';
  if (/closed that night/.test(reason)) return 'club closed that night';
  if (/have closed/.test(reason)) return 'too late for that night';
  if (/already taken/.test(reason)) return 'position already full';
  if (/training/.test(reason)) return 'needs training';
  if (/opening position|already closing|finalizing|Only a closer/.test(reason)) return 'conflicts with another pick that night';
  return 'not allowed for this person';
}

// ---------- The membership list's emails (owner only) ----------

// Run from the Apps Script editor by the owner. Does nothing from the web page. Reads the 2026 membership list (script property
// MEMBER_LIST_ID: a Google Sheet, or a Google Doc with a table), links each member to ONE active desk player with the seed's
// rules (exact full name, a desk alias, or a first name only one active player has when the list gives just a first name),
// and puts their email on file (Emails, source member-list). It never replaces an email the owner typed or fixed in
// SeedLinks, or one already on file from another import. A household row with several names and several emails is paired
// only when the counts match one to one. Safe to run again. MemberEmailReport (private) lists what it did and every name it
// could not match, with full names; the return value and the execution log hold counts only.
function importMemberEmails() {
  if (Session.getActiveUser().getEmail() !== Session.getEffectiveUser().getEmail()) throw new Error('Only the owner can import the membership list.');
  var id = property_('MEMBER_LIST_ID', '');
  if (!id) throw new Error('Set the script property MEMBER_LIST_ID to the id of the membership list (a Sheet or a Doc).');
  var tables = memberTables_(id);
  CacheService.getScriptCache().remove('directory');
  var desk = SpreadsheetApp.openById(property_('DESK_SHEET_ID', ''));
  var data = { players: directory_(), links: [],
    aliases: tableOf_(desk, 'Aliases').map(function (row) { return { alias: String(row.alias || ''), playerId: String(row.player_id || '').trim() }; }) };
  var report = { rows: 0, added: 0, alreadyOnFile: 0, kept: 0, skipped: {} };
  var lines = [];
  var skip = function (reason, line) {
    report.skipped[reason] = (report.skipped[reason] || 0) + 1;
    if (line) lines.push(line);
  };
  var found = [];
  tables.forEach(function (table) {
    var headerAt = -1;
    for (var r = 0; r < Math.min(table.length, 10) && headerAt < 0; r += 1) if (memberRow_(table[r].map(seedText_), table[r])) headerAt = r;
    if (headerAt < 0) return;
    var headers = table[headerAt].map(seedText_);
    table.slice(headerAt + 1).forEach(function (cells) {
      if (!cells.some(function (value) { return String(value == null ? '' : value).trim(); })) return;
      report.rows += 1;
      var member = memberRow_(headers, cells);
      var names = member.names.join(', ');
      if (!member.names.length) return skip('no name', ['skipped', '', member.emails.join(', '), 'no name']);
      if (!member.emails.length) return skip('no email', ['no email', names, '', '']);
      if (member.names.length !== member.emails.length) {
        return skip('names and emails could not be paired', ['unpaired', names, member.emails.join(', '), member.names.length + ' names, ' + member.emails.length + ' emails']);
      }
      member.names.forEach(function (name, index) {
        var link = seedPlayer_(name, data);
        if (!link.player) return skip('name ' + link.kind, [link.kind, name, member.emails[index], link.candidates.join(', ')]);
        found.push({ player: link.player, email: member.emails[index] });
      });
    });
  });
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var emails = rows_('Emails');
    found.forEach(function (entry) {
      var result = upsertEmail_(emails, entry.player, entry.email, 'member-list', '');
      if (result === 'added') report.added += 1;
      else if (result === 'same') report.alreadyOnFile += 1;
      else {
        report.kept += 1;
        lines.push(['kept', entry.player.name, entry.email, 'a different email is already on file and was kept']);
      }
    });
    var sheet = tab_('MemberEmailReport');
    if (sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
    var at = nowIso_();
    [['summary', 'rows read', report.rows], ['summary', 'emails added', report.added], ['summary', 'already on file', report.alreadyOnFile], ['summary', 'kept the email on file', report.kept]]
      .concat(Object.keys(report.skipped).sort().map(function (reason) { return ['skipped', reason, report.skipped[reason]]; }))
      .forEach(function (line) { save_('MemberEmailReport', { at: at, kind: line[0], name: line[1], email: '', detail: line[2] }); });
    lines.forEach(function (line) { save_('MemberEmailReport', { at: at, kind: line[0], name: line[1], email: line[2], detail: line[3] }); });
  } finally {
    lock.releaseLock();
  }
  console.log('Member email import: ' + JSON.stringify(report));
  return report;
}

// Every table in the membership list as rows of cell text: each tab of a Sheet, or each table in a Doc. Opening a Doc as a
// Sheet fails, so a Sheet is tried first (no Drive access is needed to tell them apart).
function memberTables_(id) {
  var book = null;
  try {
    book = SpreadsheetApp.openById(id);
  } catch (error) {
    book = null;
  }
  if (book) return book.getSheets().map(function (sheet) { return sheet.getDataRange().getValues(); });
  return DocumentApp.openById(id).getBody().getTables().map(function (table) {
    var rows = [];
    for (var r = 0; r < table.getNumRows(); r += 1) {
      var row = table.getRow(r);
      var cells = [];
      for (var c = 0; c < row.getNumCells(); c += 1) cells.push(row.getCell(c).getText());
      rows.push(cells);
    }
    return rows;
  });
}

// THE ONE PLACE that knows the membership list's columns, found by header name: a full name column (name, member, player)
// or first name and last name columns, and an email column. headers are lowercased. Returns {names, emails} (a household
// row may hold several of each, split on , ; / & "and" or a line break), or null when the headers are not a member table.
function memberRow_(headers, cells) {
  var at = function (test) {
    for (var index = 0; index < headers.length; index += 1) if (test(headers[index])) return index;
    return -1;
  };
  var emailAt = at(function (label) { return /^e-?mails?\b|\be-?mail( address)?$/.test(label); });
  var nameAt = at(function (label) { return /^((full |member |player )?names?|members?|players?)$/.test(label); });
  var firstAt = at(function (label) { return /^first( name)?$|first name/.test(label); });
  var lastAt = at(function (label) { return /^(last|sur|family)( ?name)?$|(last|family) name|surname/.test(label); });
  if (emailAt < 0 || (nameAt < 0 && firstAt < 0)) return null;
  var text = function (index) { return index < 0 ? '' : String(cells[index] == null ? '' : cells[index]); };
  var emails = text(emailAt).split(/[\s,;\/&]+/).map(cleanEmail_).filter(Boolean);
  var names = [];
  if (nameAt >= 0) {
    names = splitNames_(text(nameAt));
  } else {
    var firsts = splitNames_(text(firstAt));
    var lasts = splitNames_(text(lastAt));
    // "Ivo & Jan" + "Bly" are Ivo Bly and Jan Bly; two first and two last names pair in order; anything else is reported.
    if (lasts.length <= 1) names = firsts.map(function (first) { return lasts.length ? first + ' ' + lasts[0] : first; });
    else if (lasts.length === firsts.length) names = firsts.map(function (first, index) { return first + ' ' + lasts[index]; });
    else names = firsts.concat(lasts);
  }
  return { names: names, emails: emails };
}

// ---------- A new email, approved once by the club ----------

// Applies the club's YES or NO (a reply from ADMIN_EMAIL to the approval email) to a request.
function clubAnswer_(batchId, answer) {
  var batch = null;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    batch = rows_('Batches').filter(function (entry) { return entry.batch_id === batchId; })[0];
    if (!batch || batch.status !== 'awaiting_club') return;
    var emails = rows_('Emails');
    var row = emails.filter(function (entry) { return entry.batch_id === batchId; })[0] || null;
    if (answer === 'yes' && row) approveRequest_(batch, row, emails, Date.now());
    else declineRequest_(batch, row);
  } finally {
    lock.releaseLock();
  }
  if (!batch) return;
  logReply_('email', 'club', batchId, answer, batch.status !== 'awaiting_club', batch.status);
  try {
    sweep_();
  } catch (error) {
    logError_('finish the sweep after a club answer', error, batchId);
  }
}

// Call while holding the lock. The owner may also decide in the Emails tab (status approved or declined); an unanswered
// request is declined after CLUB_WAIT_MS. Run by the sweep, and by the minute check while a request is open.
function settleRequests_(now) {
  var waiting = rows_('Batches').filter(function (batch) { return batch.status === 'awaiting_club'; });
  if (!waiting.length) return;
  var emails = rows_('Emails');
  waiting.forEach(function (batch) {
    var row = emails.filter(function (entry) { return entry.batch_id === batch.batch_id; })[0] || null;
    var status = row ? String(row.status).trim().toLowerCase() : 'declined';
    if (status === 'approved') approveRequest_(batch, row, emails, now);
    else if (status === 'declined' || now >= Number(batch.expires_at)) declineRequest_(batch, row);
  });
}

// Call while holding the lock. The address becomes the player's email on file (replacing any other), and the picks still
// free become normal pending holds, so the person is asked for their own YES. Picks taken meanwhile are marked unavailable
// and listed in that email.
function approveRequest_(batch, row, emails, now) {
  emails.forEach(function (other) {
    if (other === row || String(other.player_id).trim() !== batch.player_id || String(other.status).trim().toLowerCase() !== 'approved') return;
    other.status = 'replaced';
    other.decided_at = nowIso_();
    save_('Emails', other);
  });
  row.status = 'approved';
  row.source = 'approved-request';
  row.decided_at = row.decided_at || nowIso_();
  save_('Emails', row);
  // The owner may have corrected the address in the Emails row before approving it.
  batch.email = cleanEmail_(row.email) || batch.email;
  var signups = rows_('Signups');
  var mine = signups.filter(function (entry) { return entry.batch_id === batch.batch_id && entry.status === 'requested'; });
  var holding = signups.filter(function (entry) { return holds_(entry, now); });
  var person = { playerId: batch.player_id, name: batch.name, email: batch.email, key: 'p:' + batch.player_id };
  person.training = trainingFor_(rows_('Training'), person);
  var horizon = horizon_();
  var closures = closures_();
  var accepted = [];
  mine.forEach(function (entry) {
    var others = holding.concat(accepted).filter(function (other) { return other.date === entry.date; });
    if (pickProblem_({ date: entry.date, position: entry.position, finalize: entry.finalize === 'yes' }, person, nightOf_(entry.date, horizon, closures), others)) entry.status = 'unavailable';
    else accepted.push(entry);
  });
  var expires = accepted.length ? expiryFor_(accepted, now) : now;
  mine.forEach(function (entry) {
    if (entry.status === 'requested') {
      entry.status = 'pending';
      entry.expires_at = String(expires);
    }
    entry.email = batch.email;
    entry.updated_at = nowIso_();
    save_('Signups', entry);
  });
  batch.status = accepted.length ? 'pending' : 'unavailable';
  batch.expires_at = String(expires);
  batch.phone = phoneDigits_(row.phone);
  batch.updated_at = nowIso_();
  save_('Batches', batch);
  rememberPerson_(person, phoneDigits_(row.phone), rows_('People').filter(function (entry) { return sameAddress_(entry.email, batch.email); })[0]);
  logRow_('step', 'step:' + batch.status, batch.batch_id, '-', 'email approved by the club, ' + accepted.length + ' of ' + mine.length + ' picks still free');
}

// Call while holding the lock. Nothing was held, so nothing reopens; the person is told once (deliverBatch_).
function declineRequest_(batch, row) {
  if (row) {
    row.status = 'declined';
    row.decided_at = nowIso_();
    save_('Emails', row);
  }
  rows_('Signups').forEach(function (entry) {
    if (entry.batch_id !== batch.batch_id || entry.status !== 'requested') return;
    entry.status = 'declined';
    entry.updated_at = nowIso_();
    save_('Signups', entry);
  });
  batch.status = 'declined';
  batch.updated_at = nowIso_();
  save_('Batches', batch);
  logRow_('step', 'step:declined', batch.batch_id, '-', row && row.decided_at ? 'email not approved' : 'no club answer');
}

// ---------- Public: dropping a confirmed shift ----------

// "This is me: drop this shift". The page never learns whose shift it is: we email the address that confirmed it, and only a
// YES to that email drops it. One email per sign-up every DROP_WAIT_MS at most.
function requestDrop(signupId) {
  var id = String(signupId || '').replace(/[^0-9a-f]/g, '').slice(0, 32);
  var done = { ok: true, message: 'We emailed the person who signed up for this shift. If that is you, reply YES to that email to drop it. Nothing changes until then.' };
  if (!id) return fail_('Please pick a shift.');
  var entry = null;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (tooBusy_('write', MAX_WRITES_PER_MINUTE)) return fail_('Too many requests right now. Please try again in a few minutes.');
    var now = Date.now();
    entry = rows_('Signups').filter(function (each) { return each.signup_id === id; })[0];
    if (!entry || entry.status !== 'confirmed') return fail_('That shift is not confirmed, so there is nothing to drop. Reload the calendar to see the latest.');
    if (entry.date < pacificNow_().date) return fail_('That shift has already passed.');
    if (Number(entry.drop_at) > 0 && now - Number(entry.drop_at) < DROP_WAIT_MS) return done;
    entry.drop_at = String(now);
    entry.updated_at = nowIso_();
    save_('Signups', entry);
    var contact = contactOf_(entry, rows_('Emails'));
  } finally {
    lock.releaseLock();
  }
  try {
    if (!mailAvailable_()) throw new Error('the daily email quota is used up');
    var night = NIGHTS[weekday_(entry.date)];
    sendMail_(contact, 'Drop your CTTC shift? ' + refTag_(dropCode_(entry)), [
      'Hello ' + firstName_(entry.name) + ',',
      'Someone (we hope you) asked on the club website to drop this shift:',
      { rows: [['When', dayLabel_(entry.date) + ', ' + time12_(night.start) + ' to ' + time12_(night.end)], ['Position', shiftLabel_(entry)]] },
      { choices: [['YES', 'Drop it. The spot opens for someone else and the club is told.'], ['NO', 'Keep it. You can also just ignore this email.']] },
      'This question is open for 48 hours. Please reply from this same email address.'
    ], ['drop-question', entry.signup_id]);
  } catch (error) {
    logError_('email a drop question', error, entry.signup_id);
    // Not asked after all, so the next try is not held back by the 10 minute wait.
    lock.waitLock(30000);
    try {
      var again = rows_('Signups').filter(function (each) { return each.signup_id === id; })[0];
      if (again) {
        again.drop_at = '';
        save_('Signups', again);
      }
    } finally {
      lock.releaseLock();
    }
    return fail_('We could not send the email just now. Please try again later.');
  }
  return done;
}

// ---------- Answers: YES, NO, CONFIRM, RELEASE ----------

// Applies a YES or NO to one submission. A YES while pending confirms every pick; a NO releases them. A YES after the hold
// expired (up to LATE_MS later) confirms whichever picks are still free and the confirmation email lists the ones that were
// not. Anything else changes nothing. skip: the dates of a "YES except" (exceptDates_), whose picks are released instead.
function batchAnswer_(batchId, answer, channel, skip) {
  skip = answer === 'yes' && skip ? skip : [];
  var batch = null;
  var person = null;
  var applied = false;
  var before = '';
  var late = null;
  var count = 0;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var now = Date.now();
    batch = rows_('Batches').filter(function (entry) { return entry.batch_id === batchId; })[0];
    if (!batch) return;
    person = rows_('People').filter(function (entry) { return sameAddress_(entry.email, batch.email); })[0] || null;
    if (person && person.ask_ref === batchId) {
      person.ask_ref = '';
      person.ask_at = '';
      save_('People', person);
    }
    var signups = rows_('Signups');
    var mine = signups.filter(function (entry) { return entry.batch_id === batchId; });
    before = batchStatus_(batch, now);
    batch.status = before;
    if (before === 'pending') {
      applied = true;
      mine.forEach(function (entry) {
        if (signupStatus_(entry, now) !== 'pending') return;
        var keep = answer === 'yes' && skip.indexOf(entry.date) < 0;
        entry.status = keep ? 'confirmed' : 'released';
        if (keep) entry.confirmed_at = nowIso_();
        entry.updated_at = nowIso_();
        save_('Signups', entry);
        if (keep || answer !== 'yes') count += 1;
      });
      batch.status = answer === 'yes' && count ? 'confirmed' : 'released';
    } else if (answer === 'yes' && changeOfMind_(batch, now)) {
      late = lateConfirm_(batch, mine.filter(function (entry) { return entry.status === 'released' && skip.indexOf(entry.date) < 0; }), signups, now);
      count = late.confirmed;
      applied = late.confirmed > 0;
      if (applied) {
        batch.status = 'confirmed';
        batch.late = 'yes';
        batch.emailed = '';
        batch.answered_at = nowIso_();
        batch.answer = skip.length ? 'yes except' : 'yes again';
      }
    } else if (before === 'expired' && !batch.answered_at && answer === 'yes' && now - Number(batch.expires_at) < LATE_MS) {
      late = lateConfirm_(batch, mine.filter(function (entry) { return skip.indexOf(entry.date) < 0; }), signups, now);
      count = late.confirmed;
      applied = late.confirmed > 0;
      if (applied) {
        batch.status = 'confirmed';
        batch.late = 'yes';
      }
    }
    if (!batch.answered_at) {
      batch.answered_at = nowIso_();
      batch.answer = skip.length ? 'yes except' : answer;
    }
    batch.updated_at = nowIso_();
    save_('Batches', batch);
    if (applied) logRow_('step', 'step:' + batch.status, batchId, '-', (late ? 'late YES: ' + late.confirmed + ' confirmed, ' + late.missed + ' no longer free' : count + ' picks') +
      (skip.length ? ', ' + skip.length + ' night' + (skip.length === 1 ? '' : 's') + ' left out' : ''));
  } finally {
    lock.releaseLock();
  }
  logReply_(channel, 'batch', batchId, answer, applied, batch.status);
  try {
    if (late && !applied && mailAvailable_()) {
      sendMail_(batch.email, 'Your CTTC staff sign-up had expired', ['Hello ' + firstName_(batch.name) + ',',
        'We got your YES, but it came after the deadline and by then none of those shifts could be held for you any more (someone else took them, the night is too close, or the club is closed).',
        'Please open the calendar at ' + PAGE_URL + ' and pick again. Thank you for helping!'], ['batch-late-none', batchId]);
    }
    if (channel === 'text' && person) {
      sendText_(person, applied ? (answer === 'yes' && count ? 'CTTC: Done: you are confirmed for ' + count + ' shift' + (count === 1 ? '' : 's') +
        (skip.length ? ', and the ' + skip.length + ' night' + (skip.length === 1 ? '' : 's') + ' you listed ' + (skip.length === 1 ? 'is' : 'are') + ' released' : '') + '. Details are in your email.' :
        'CTTC: OK, your picks are released.') : before === 'confirmed' ? 'CTTC: You are already confirmed for those shifts.' :
        'CTTC: That sign-up is no longer waiting for an answer, so nothing changed.', ['batch-answer-reply', batchId]);
    }
  } catch (error) {
    logError_('answer a sign-up reply', error, batchId);
  }
  try {
    sweep_();
  } catch (error) {
    logError_('finish the sweep after an answer', error, batchId);
  }
}

// A sign-up released by a NO in the last LATE_MS: a YES (or YES except) after it confirms whichever nights are still free.
function changeOfMind_(batch, now) {
  return batch.status === 'released' && batch.answer === 'no' && now - (Date.parse(batch.answered_at) || 0) < LATE_MS;
}

// Call while holding the lock. A late YES, or a YES after a NO: each expired (or released) pick of this submission is checked
// again against everything held now, exactly as a new sign-up would be, and confirmed if it still fits.
function lateConfirm_(batch, mine, signups, now) {
  var horizon = horizon_();
  var closures = closures_();
  var person = { playerId: batch.player_id, name: batch.name, email: batch.email, key: personKey_(batch) };
  person.training = trainingFor_(rows_('Training'), person);
  var holding = signups.filter(function (entry) { return entry.batch_id !== batch.batch_id && holds_(entry, now); });
  var accepted = [];
  var result = { confirmed: 0, missed: 0 };
  mine.filter(function (entry) { return signupStatus_(entry, now) === 'expired' || entry.status === 'released'; }).forEach(function (entry) {
    var others = holding.concat(accepted).filter(function (other) { return other.date === entry.date; });
    var reason = pickProblem_({ date: entry.date, position: entry.position, finalize: entry.finalize === 'yes' }, person, nightOf_(entry.date, horizon, closures), others);
    if (reason) {
      result.missed += 1;
      if (entry.status !== 'expired') {
        entry.status = 'expired';
        save_('Signups', entry);
      }
      return;
    }
    entry.status = 'confirmed';
    entry.confirmed_at = nowIso_();
    entry.updated_at = nowIso_();
    save_('Signups', entry);
    accepted.push(entry);
    result.confirmed += 1;
  });
  return result;
}

// ---------- The club corrects an answer ----------
// A volunteer sometimes answers in words the app cannot apply ("Peg is a yes for all those Mondays except Oct 19 and Nov 2",
// sent after a NO). From the owner's setup page the club confirms the nights they asked for: fixable_ lists the sign-ups
// answered NO, or left to expire, in the last FIX_DAYS days that still have nights ahead; clubFix_ applies the club's ticks.

var FIX_DAYS = 7;

function fixable_(now) {
  var today = pacificNow_().date;
  var signups = rows_('Signups');
  return rows_('Batches').filter(function (batch) {
    var status = batchStatus_(batch, now);
    var when = Date.parse(batch.answered_at) || Number(batch.expires_at) || 0;
    return (status === 'released' || status === 'expired') && now - when < FIX_DAYS * 86400000 && signups.some(function (entry) {
      return entry.batch_id === batch.batch_id && entry.date >= today && (entry.status === 'released' || signupStatus_(entry, now) === 'expired');
    });
  }).map(function (batch) {
    return { batch: batch, status: batchStatus_(batch, now), nights: signups.filter(function (entry) {
      return entry.batch_id === batch.batch_id && entry.date >= today && (entry.status === 'released' || signupStatus_(entry, now) === 'expired');
    }).sort(function (a, b) { return a.date.localeCompare(b.date); }) };
  });
}

// Confirms the ticked nights (keep: signup ids) of a sign-up in fixable_, each checked again exactly like a new sign-up; the
// rest of its upcoming nights are left out (released). The volunteer is emailed their confirmation, listing what was left
// out. Returns { confirmed: [entries], missed: [{ entry, reason }] }, or null when the sign-up cannot be corrected.
function clubFix_(batchId, keep) {
  var result = { confirmed: [], missed: [] };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var now = Date.now();
    var found = fixable_(now).filter(function (each) { return each.batch.batch_id === batchId; })[0];
    if (!found) return null;
    var batch = found.batch;
    var signups = rows_('Signups');
    var horizon = horizon_();
    var closures = closures_();
    var person = { playerId: batch.player_id, name: batch.name, email: batch.email, key: personKey_(batch) };
    person.training = trainingFor_(rows_('Training'), person);
    var holding = signups.filter(function (entry) { return entry.batch_id !== batchId && holds_(entry, now); });
    var ids = found.nights.map(function (entry) { return entry.signup_id; });
    signups.filter(function (entry) { return ids.indexOf(entry.signup_id) >= 0; }).forEach(function (entry) {
      var reason = keep.indexOf(entry.signup_id) < 0 ? 'left out' : pickProblem_({ date: entry.date, position: entry.position, finalize: entry.finalize === 'yes' }, person,
        nightOf_(entry.date, horizon, closures), holding.concat(result.confirmed).filter(function (other) { return other.date === entry.date; }));
      entry.status = reason ? 'released' : 'confirmed';
      if (!reason) entry.confirmed_at = nowIso_();
      entry.updated_at = nowIso_();
      save_('Signups', entry);
      if (!reason) result.confirmed.push(entry);
      else if (reason !== 'left out') result.missed.push({ entry: entry, reason: reason });
    });
    if (result.confirmed.length) {
      batch.status = 'confirmed';
      batch.answer = 'club fix';
      batch.late = '';
      batch.emailed = '';
      batch.updated_at = nowIso_();
      save_('Batches', batch);
    }
    logRow_('step', 'step:club-fix', batchId, '-', result.confirmed.length + ' confirmed by the club, ' + result.missed.length + ' no longer free');
  } finally {
    lock.releaseLock();
  }
  try {
    sweep_();
  } catch (error) {
    logError_('finish the sweep after a club fix', error, batchId);
  }
  return result;
}

// Applies a YES or NO to a "drop this shift" email. A YES opens the slot again, tells the person and the club, and if a
// primary desk organizer or money collector dropped, gives that night's confirmed backup a heads-up.
function dropAnswer_(signupId, answer) {
  var entry = null;
  var backup = null;
  var applied = false;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var now = Date.now();
    var signups = rows_('Signups');
    entry = signups.filter(function (each) { return each.signup_id === signupId; })[0];
    if (!entry || entry.status !== 'confirmed' || !(now - Number(entry.drop_at) < DROP_TTL_MS) || entry.date < pacificNow_().date) return;
    applied = true;
    entry.drop_at = '';
    entry.updated_at = nowIso_();
    if (answer === 'yes') {
      entry.status = 'dropped';
      backup = signups.filter(function (each) {
        return each.status === 'confirmed' && each.date === entry.date && each.position === entry.position + '-backup';
      })[0] || null;
    }
    save_('Signups', entry);
    if (answer === 'yes') logRow_('step', 'step:dropped', entry.batch_id, '-', entry.position + ' on ' + entry.date);
    var emails = rows_('Emails');
    var contact = contactOf_(entry, emails);
    var backupContact = backup ? contactOf_(backup, emails) : '';
  } finally {
    lock.releaseLock();
  }
  logReply_('email', 'drop', entry ? entry.batch_id : signupId, answer, applied, entry ? entry.status : '');
  if (!applied) return;
  if (answer === 'yes') return tellDropped_(contact, [{ entry: entry, backup: backup, backupContact: backupContact }]);
  try {
    if (mailAvailable_()) {
      sendMail_(contact, 'Your CTTC shift stays as it is', ['OK, nothing changed: you are still on for ' + shiftLabel_(entry) + ' on ' + dayLabel_(entry.date) + '. Thank you!'], ['drop-kept', entry.signup_id]);
    }
  } catch (error) {
    logError_('confirm a kept shift', error, entry.batch_id);
  }
}

// Call without the lock. After confirmed shifts were dropped (by email or on the My nights page): one email to the person and
// one to the club listing them, and a heads-up to each confirmed backup whose primary dropped. drops: [{ entry, backup,
// backupContact }], all one person's.
function tellDropped_(contact, drops) {
  var first = drops[0].entry;
  var attempt = function (what, send) {
    try {
      if (mailAvailable_()) send();
    } catch (error) {
      logError_(what, error, first.batch_id);
    }
  };
  var many = drops.length > 1;
  var backupNote = function (drop) {
    var spec = position_(drop.entry.position);
    return drop.backup ? 'The backup (' + drop.backup.name + ') has been sent a heads-up.' : spec.backupOf ? '' :
      position_(drop.entry.position + '-backup') ? 'There is no confirmed backup for this position that night.' : '';
  };
  attempt('confirm a dropped shift', function () {
    sendMail_(contact, many ? 'Shifts dropped: ' + drops.length + ' CTTC shifts' : 'Shift dropped: ' + shortDay_(first.date), ['Hello ' + firstName_(first.name) + ',',
      many ? 'Done: you are off these shifts. The spots are open for someone else and the club has been told.' :
        'Done: you are off ' + shiftLabel_(first) + ' on ' + dayLabel_(first.date) + '. The spot is open for someone else and the club has been told.',
      many ? shiftRows_(drops.map(function (drop) { return drop.entry; })) : null,
      'Thanks for letting us know early. You can see your other nights at ' + mineLink_(contact) + ', or pick another night any time at ' + PAGE_URL + '.'], ['drop-done', first.signup_id]);
  });
  attempt('tell the club about a dropped shift', function () {
    sendMail_(adminEmail_(), many ? 'Staffing: ' + first.name + ' dropped ' + drops.length + ' shifts' : 'Staffing: ' + first.name + ' dropped ' + position_(first.position).label + ' on ' + shortDay_(first.date),
      many ? [first.name + ' dropped these shifts. The spots are open on the sign-up calendar again.', { rows: drops.map(function (drop) {
        return [shortDay_(drop.entry.date), shiftLabel_(drop.entry) + (backupNote(drop) ? '. ' + backupNote(drop) : '')];
      }) }] : [first.name + ' dropped ' + shiftLabel_(first) + ' on ' + dayLabel_(first.date) + '. The spot is open on the sign-up calendar again.' +
        (backupNote(drops[0]) ? ' ' + backupNote(drops[0]) : '')], ['drop-club', first.signup_id], CLUB_FOOTER);
  });
  drops.forEach(function (drop) {
    if (!drop.backup) return;
    var entry = drop.entry;
    attempt('give a backup a heads-up', function () {
      sendMail_(drop.backupContact, 'Heads-up: you may be needed as ' + position_(entry.position).label + ' on ' + shortDay_(entry.date), ['Hello ' + firstName_(drop.backup.name) + ',',
        { callout: 'The ' + position_(entry.position).label.toLowerCase() + ' for **' + dayLabel_(entry.date) + '** has dropped out. As the backup, **please plan to step in** unless someone else signs up for it.', tone: 'action' },
        'The calendar at ' + PAGE_URL + ' shows who is on that night. If you cannot make it either, please tell the club.'], ['backup-heads-up', drop.backup.signup_id]);
    });
  });
}

// ---------- Public: a volunteer's own nights ("My nights") ----------
// Every email about someone's shifts links to their own page (PAGE_URL?mine=CODE, opened in the app by the home page). There
// they untick the nights they can't do: one Save confirms the rest of a sign-up still waiting for a YES and drops confirmed
// nights, so someone signed up for every Wednesday can skip one without losing the others. The link is the key, like a reply
// from their address: it is only ever sent to the email on file.

var MINE_GONE = 'We found no upcoming nights for this link. If you expected some, use the link in the newest email we sent you.';

// The secret in someone's link, made with the app's secret from their address: the same in every email (an older email's link
// keeps working while that address is on file), and nobody can make one for another address.
function mineCode_(email) {
  var key = addressKey_(email);
  return code_('m:' + key) + code_('n:' + key);
}

function mineLink_(email) { return PAGE_URL + '?mine=' + mineCode_(email); }

// The address on file whose link this is, among the people with upcoming pending or confirmed nights; '' when none.
function mineOwner_(code, signups, emails) {
  var clean = String(code || '').trim().toUpperCase();
  if (!/^[0-9A-F]{20}$/.test(clean)) return '';
  var today = pacificNow_().date;
  var seen = {};
  for (var index = 0; index < signups.length; index += 1) {
    var entry = signups[index];
    if (entry.date < today || (entry.status !== 'pending' && entry.status !== 'confirmed')) continue;
    var contact = contactOf_(entry, emails);
    var key = addressKey_(contact);
    if (seen[key]) continue;
    seen[key] = true;
    if (mineCode_(contact) === clean) return contact;
  }
  return '';
}

// Someone's upcoming nights, each with its shifts (confirmed or pending), and until when the first pending one is held.
function mineView_(owner, signups, emails, now) {
  var today = pacificNow_().date;
  var nights = [];
  var name = '';
  var until = 0;
  signups.filter(function (entry) {
    var status = signupStatus_(entry, now);
    return entry.date >= today && (status === 'pending' || status === 'confirmed') && sameAddress_(contactOf_(entry, emails), owner);
  }).sort(function (a, b) {
    return (a.date + POSITIONS.indexOf(position_(a.position))).localeCompare(b.date + POSITIONS.indexOf(position_(b.position)));
  }).forEach(function (entry) {
    var night = nights[nights.length - 1];
    if (!night || night.date !== entry.date) nights.push(night = { date: entry.date, label: dayLabel_(entry.date), short: shortDay_(entry.date), shifts: [] });
    night.shifts.push({ id: entry.signup_id, label: shiftLabel_(entry), status: entry.status });
    if (entry.status === 'pending' && (!until || Number(entry.expires_at) < until)) until = Number(entry.expires_at);
    name = name || firstName_(entry.name);
  });
  return { ok: true, name: name, email: maskEmail_(owner), until: until ? momentLabel_(until).replace(' Pacific Time', '') : '', nights: nights };
}

function myNights(code) {
  if (tooBusy_('read', MAX_READS_PER_MINUTE)) return fail_('Too many requests right now. Please try again in a few minutes.');
  var signups = rows_('Signups');
  var emails = rows_('Emails');
  var owner = mineOwner_(code, signups, emails);
  return owner ? mineView_(owner, signups, emails, Date.now()) : fail_(MINE_GONE);
}

function cleanIds_(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 1000).map(function (id) { return String(id || ''); }).filter(function (id) { return /^[0-9a-f]{1,32}$/.test(id); });
}

// Saves the My nights page: keep and release are shift ids. A kept shift waiting for a YES is confirmed and a released one
// released; a released confirmed shift is dropped, and the person, the club and that night's backup are told, as for an
// emailed drop. Only the person's own upcoming pending or confirmed shifts change, so a page left open is safe: anything
// past or changed since is skipped. A sign-up with nothing left waiting is answered, so its email lists what was confirmed
// and what was released.
function saveMyNights(code, choice) {
  var keep = cleanIds_(choice && choice.keep);
  var release = cleanIds_(choice && choice.release);
  if (!keep.length && !release.length) return fail_('Nothing to save.');
  var owner = '';
  var drops = [];
  var done = { confirmed: [], released: [], dropped: [], skipped: 0, answered: 0 };
  var view = null;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (tooBusy_('write', MAX_WRITES_PER_MINUTE)) return fail_('Too many requests right now. Please try again in a few minutes.');
    var now = Date.now();
    var signups = rows_('Signups');
    var emails = rows_('Emails');
    owner = mineOwner_(code, signups, emails);
    if (!owner) return fail_(MINE_GONE);
    var today = pacificNow_().date;
    var touched = {};
    signups.forEach(function (entry) {
      var kept = keep.indexOf(entry.signup_id) >= 0;
      if (!kept && release.indexOf(entry.signup_id) < 0) return;
      var status = signupStatus_(entry, now);
      if (entry.date < today || !sameAddress_(contactOf_(entry, emails), owner) || (status !== 'pending' && status !== 'confirmed')) {
        done.skipped += 1;
        return;
      }
      if (status === 'confirmed') {
        if (kept) return;
        entry.status = 'dropped';
        entry.drop_at = '';
        var backup = signups.filter(function (each) { return each.status === 'confirmed' && each.date === entry.date && each.position === entry.position + '-backup'; })[0] || null;
        drops.push({ entry: entry, backup: backup, backupContact: backup ? contactOf_(backup, emails) : '' });
        done.dropped.push(entry.date);
        logRow_('step', 'step:dropped', entry.batch_id, '-', entry.position + ' on ' + entry.date + ', from My nights');
      } else {
        entry.status = kept ? 'confirmed' : 'released';
        if (kept) entry.confirmed_at = nowIso_();
        done[kept ? 'confirmed' : 'released'].push(entry.date);
        touched[entry.batch_id] = true;
      }
      entry.updated_at = nowIso_();
      save_('Signups', entry);
    });
    rows_('Batches').forEach(function (batch) {
      if (!touched[batch.batch_id] || batchStatus_(batch, now) !== 'pending') return;
      var mine = signups.filter(function (entry) { return entry.batch_id === batch.batch_id; });
      if (mine.some(function (entry) { return signupStatus_(entry, now) === 'pending'; })) return;
      batch.status = mine.some(function (entry) { return entry.status === 'confirmed'; }) ? 'confirmed' : 'released';
      batch.answered_at = nowIso_();
      batch.answer = 'my nights';
      batch.updated_at = nowIso_();
      save_('Batches', batch);
      done.answered += 1;
      logRow_('step', 'step:' + batch.status, batch.batch_id, '-', 'from My nights');
    });
    view = mineView_(owner, signups, emails, now);
  } finally {
    lock.releaseLock();
  }
  if (drops.length) tellDropped_(owner, drops);
  try {
    sweep_();
  } catch (error) {
    logError_('finish the sweep after My nights', error);
  }
  var nights = function (dates) {
    var unique = dates.filter(function (date, index) { return dates.indexOf(date) === index; });
    return unique.length + ' night' + (unique.length === 1 ? '' : 's');
  };
  var parts = [];
  if (done.confirmed.length) parts.push('Confirmed ' + nights(done.confirmed) + '.');
  if (done.released.length) parts.push('Released ' + nights(done.released) + '.');
  if (done.dropped.length) parts.push('Dropped ' + nights(done.dropped) + ': the club' + (drops.some(function (drop) { return drop.backup; }) ? ' and the backup were' : ' was') + ' told.');
  if (done.skipped) parts.push(done.skipped + ' shift' + (done.skipped === 1 ? ' had' : 's had') + ' already changed, so ' + (done.skipped === 1 ? 'it was' : 'they were') + ' left as is.');
  view.message = parts.length ? 'Saved. ' + parts.join(' ') + (done.answered || drops.length ? ' We emailed you the details.' : '') : 'Nothing changed.';
  return view;
}

// ---------- The minute check: email and text replies ----------

// Run every minute by a trigger. Reads YES or NO email answers, CONFIRM or RELEASE texts, and STAFF or STOP texts. A run that
// starts while the last one is still going does nothing, so one reply is never applied twice. Only this function takes the
// user lock, so it never waits on the script lock the rest of the app uses.
function checkReplies() {
  var cache = CacheService.getScriptCache();
  if (cache.get('check-replies')) return;
  var running = LockService.getUserLock();
  if (!running.tryLock(0)) return;
  try {
    cache.put('check-replies', '1', 20);
    var failing = failingSteps_();
    step_(failing, 'read email answers', 'Volunteers\' YES and NO email replies, and the club\'s emailed approvals, are not being read.', checkMail_);
    step_(failing, 'read CONFIRM and RELEASE texts', 'Volunteers\' CONFIRM and RELEASE texts are not being read.', checkTextAnswers_);
    step_(failing, 'read STAFF and STOP texts', 'STAFF and STOP texts are not being read.', checkOptIns_);
    step_(failing, 'apply the club\'s email decisions', 'Approvals and declines entered in the Emails tab are not being applied.', checkDecisions_);
  } finally {
    running.releaseLock();
  }
}

// An open request the owner decided in the Emails tab (or whose 7 days ran out) is applied within a minute, not an hour.
function checkDecisions_() {
  var waiting = rows_('Batches').filter(function (batch) { return batch.status === 'awaiting_club'; });
  if (!waiting.length) return;
  var emails = rows_('Emails');
  var now = Date.now();
  if (waiting.some(function (batch) {
    var row = emails.filter(function (entry) { return entry.batch_id === batch.batch_id; })[0];
    return !row || String(row.status).trim().toLowerCase() !== 'pending' || now >= Number(batch.expires_at);
  })) sweep_();
}

// One failing step never stops the others. A step that fails without a break for ALERT_AFTER_MS is emailed to the club once,
// and the club is emailed again when it works. A step that returns false skipped its work (it is throttled), which says
// nothing either way.
function step_(failing, name, effect, run) {
  var ran;
  try {
    ran = run();
  } catch (error) {
    logError_(name, error);
    try {
      stepFailed_(failing, name, effect, error);
    } catch (failure) {
      logError_('track a failing step', failure);
    }
    return;
  }
  if (ran === false || !failing[name]) return;
  try {
    stepWorked_(failing, name);
  } catch (failure) {
    logError_('track a failing step', failure);
  }
}

// The steps failing since their last success, {name: {since, alerted}}, in a script property so the state outlasts the cache.
function failingSteps_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('FAILING_STEPS') || '{}');
  } catch (error) {
    logError_('read the failing steps', error);
    return {};
  }
}

function saveFailingSteps_(failing) { PropertiesService.getScriptProperties().setProperty('FAILING_STEPS', JSON.stringify(failing)); }

// The state is saved before the email goes, so a save that fails never sends the same alert every minute.
function stepFailed_(failing, name, effect, error) {
  var now = Date.now();
  var state = failing[name];
  if (!state) {
    failing[name] = { since: now };
    return saveFailingSteps_(failing);
  }
  if (state.alerted || now - state.since < ALERT_AFTER_MS) return;
  state.alerted = now;
  saveFailingSteps_(failing);
  var sent = mailClub_('Action needed: the staffing app cannot ' + name, [
    { callout: 'The staffing app has failed to **' + name + '** at every attempt since ' + momentLabel_(state.since) + '. It retries every minute.', tone: 'action' },
    effect,
    'Error: ' + error,
    { heading: 'What to do' },
    { steps: ['Check https://www.google.com/appsstatus/dashboard/ for a Google Sheets or Gmail outage. If Google lists one, no action is needed: the app resumes by itself when Google recovers.',
      'If Google lists no outage, forward this email to ' + MAINTAINER + '.'] },
    'The club gets a follow-up email when this step works again.'], 'step:' + name);
  if (sent) return;
  delete state.alerted;
  saveFailingSteps_(failing);
}

function stepWorked_(failing, name) {
  var state = failing[name];
  delete failing[name];
  saveFailingSteps_(failing);
  if (!state.alerted) return;
  var sent = mailClub_('Resolved: the staffing app can ' + name + ' again', [
    { callout: 'The staffing app can **' + name + '** again as of ' + momentLabel_(Date.now()) + '. No action is needed.', tone: 'good' },
    'It had failed at every attempt from ' + momentLabel_(state.since) + '. This resolves the email "Action needed: the staffing app cannot ' + name + '".'], 'step-resolved:' + name);
  if (sent) return;
  failing[name] = state;
  saveFailingSteps_(failing);
}

// Emails the club about something it should know, at most once every 6 hours per key.
function alertAdmin_(key, subject, lines) {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('alert:' + key)) return;
    if (mailClub_(subject, lines, key)) cache.put('alert:' + key, '1', 21600);
  } catch (error) {
    logError_('alert the club', error);
  }
}

// True once the email is sent.
function mailClub_(subject, lines, key) {
  try {
    if (!mailAvailable_()) return false;
    sendMail_(adminEmail_(), subject, lines, ['club-alert', key], CLUB_FOOTER);
    return true;
  } catch (error) {
    logError_('alert the club', error);
    return false;
  }
}

// Every email that asks a question carries a code in its subject, made with the app's secret from what it asks about. A reply
// counts only if it quotes that code and comes from the address the question went to. The tag differs from the coaching app's
// "[CTTC ref ...]", so neither app ever reads the other's replies.
function code_(text) {
  return Utilities.computeHmacSha256Signature(text, secret_()).slice(0, 5).map(function (value) { return ('0' + (value & 255).toString(16)).slice(-2); }).join('').toUpperCase();
}

function refTag_(code) { return '[CTTC shift ' + code + ']'; }

function batchCode_(batch) { return code_('b:' + batch.batch_id); }

function dropCode_(entry) { return code_('d:' + entry.signup_id + ':' + entry.drop_at); }

function clubCode_(batch) { return code_('c:' + batch.batch_id); }

// own: also our own account's messages, when the club's answer can come from it (ADMIN_EMAIL is the club account).
function mailQuery_(since, days, own) { return 'newer_than:' + days + 'd subject:"CTTC shift" ' + (own ? '' : '-from:me ') + 'after:' + since; }

// Every question still waiting for an emailed answer: {code, email, after, kind, id}.
function emailQuestions_(now) {
  var questions = [];
  rows_('Batches').forEach(function (batch) {
    var status = batchStatus_(batch, now);
    var question = { code: batchCode_(batch), email: batch.email, after: Date.parse(batch.created_at) || 0, kind: 'batch', id: batch.batch_id };
    if (status === 'pending' || (status === 'expired' && !batch.answered_at && now - Number(batch.expires_at) < LATE_MS)) questions.push(question);
    // A change of mind after a NO ("Peg is a yes for all those Mondays except ..."): only replies after the NO count.
    else if (changeOfMind_(batch, now)) questions.push({ code: question.code, email: batch.email, after: Date.parse(batch.answered_at), kind: 'batch', id: batch.batch_id, yesOnly: true });
  });
  rows_('Batches').forEach(function (batch) {
    if (batch.status === 'awaiting_club' && now < Number(batch.expires_at)) {
      questions.push({ code: clubCode_(batch), email: adminEmail_(), after: Date.parse(batch.created_at) || 0, kind: 'club', id: batch.batch_id });
    }
  });
  var emails = null;
  rows_('Signups').forEach(function (entry) {
    if (entry.status === 'confirmed' && Number(entry.drop_at) > 0 && now - Number(entry.drop_at) < DROP_TTL_MS) {
      questions.push({ code: dropCode_(entry), email: contactOf_(entry, emails || (emails = rows_('Emails'))), after: Number(entry.drop_at), kind: 'drop', id: entry.signup_id });
    }
  });
  return questions;
}

function checkMail_() {
  var now = Date.now();
  var questions = emailQuestions_(now);
  if (!questions.length) return;
  var byCode = {};
  questions.forEach(function (question) { byCode[question.code] = question; });
  var self = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var us = [self, adminEmail_()].map(function (address) { return String(address || '').toLowerCase(); });
  var club = questions.some(function (question) { return question.kind === 'club'; });
  // Only threads with a message since the last check (a few minutes back, for mail Gmail is slow to make searchable) and since
  // the oldest open question are opened, to spare the Gmail quota all the club's apps share: from someone else, or from our
  // own account too while the club (when it is this account) has an approval to answer.
  var checked = Number(property_('MAIL_CHECKED_AT', '0')) || 0;
  var since = Math.floor(Math.max(Math.min.apply(null, questions.map(function (question) { return question.after; })), checked - MAIL_OVERLAP_MS) / 1000);
  var answers = {};
  GmailApp.search(mailQuery_(since, club ? 8 : 3, club && sameAddress_(adminEmail_(), self)), 0, 50).forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      var subject = String(message.getSubject() || '');
      var code = (subject.match(/\[CTTC shift ([0-9A-F]{10})\]/) || [])[1];
      var question = code && byCode[code];
      if (!question) return;
      var from = String(message.getFrom() || '');
      var address = ((from.match(/<([^>]+)>/) || [null, from])[1] || '').trim().toLowerCase();
      // Our own question in the thread is not an answer; the club's reply from this account starts "Re:".
      if (sameAddress_(address, self) && !/^re\s*:/i.test(subject)) return;
      var at = message.getDate().getTime();
      if (at <= question.after) return;
      var recent = Date.now() - at < 5 * 3600000;
      if (!sameAddress_(address, question.email)) {
        if (us.indexOf(address) < 0 && recent) wrongSender_(message.getId(), address, String(message.getSubject() || ''));
        return;
      }
      if (autoReply_(message)) return;
      var text = replyText_(message);
      var answer = answerOf_(text);
      var skip = null;
      var except = question.kind === 'batch' ? exceptOf_(text) : null;
      if (except) {
        var picked = except.unclear ? null : exceptDates_(except, nightsOf_(question.id));
        if (!picked || picked.missing) {
          if (recent) unclearExcept_(message.getId(), address, String(message.getSubject() || ''), question.id, picked ? picked.missing : null);
          return;
        }
        answer = 'yes';
        skip = picked.dates;
      } else if (question.kind === 'batch' && answer === 'no' && namesDate_(text)) {
        // "No for Oct 19 and Nov 2" most likely means only those nights: a NO would release them all, so nothing is guessed.
        if (recent) unclearExcept_(message.getId(), address, String(message.getSubject() || ''), question.id, null);
        return;
      }
      if (!answer) {
        if (recent) unreadableReply_(message.getId(), address, String(message.getSubject() || ''));
        return;
      }
      // After a NO, only a YES changes anything (another NO, or "thanks", is not read again every minute).
      if (question.yesOnly && answer !== 'yes') return;
      if (!answers[code] || at < answers[code].at) answers[code] = { question: question, answer: answer, skip: skip, at: at };
    });
  });
  Object.keys(answers).forEach(function (code) {
    var found = answers[code];
    if (found.question.kind === 'batch') batchAnswer_(found.question.id, found.answer, 'email', found.skip);
    else if (found.question.kind === 'club') clubAnswer_(found.question.id, found.answer);
    else dropAnswer_(found.question.id, found.answer);
  });
  PropertiesService.getScriptProperties().setProperty('MAIL_CHECKED_AT', String(now));
}

// The reply as the person sees it. Gmail's plain-text version of an HTML-only email can run lines together ("YESSent from my
// Galaxy"), so when there is HTML its line breaks are used, with the quoted earlier message marked as a quote.
function replyText_(message) {
  var plain = String(message.getPlainBody() || '');
  var html = '';
  try {
    html = typeof message.getBody === 'function' ? String(message.getBody() || '') : '';
  } catch (error) {
    html = '';
  }
  if (!/<(div|p|br|blockquote)\b/i.test(html)) return plain;
  var text = html.replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(blockquote|div[^>]*(gmail_quote|divRplyFwdMsg|appendonsend|yahoo_quoted|moz-cite-prefix))\b[^>]*>/gi, '\n> ')
    .replace(/<br\s*\/?>|<\/(div|p|li|tr|h[1-6]|table)>|<(div|p|li|tr|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, function (match, code) { return String.fromCharCode(Number(code)); }).replace(/&amp;/gi, '&');
  return answerOf_(text) || exceptOf_(text) ? text : plain;
}

// Out-of-office and other automatic replies are never answers.
function autoReply_(message) {
  if (/^(automatic reply|auto(-| )?reply|out of (the )?office|autoreply|away)/i.test(String(message.getSubject() || '').replace(/^(re|fwd?):\s*/i, ''))) return true;
  try {
    var header = String(message.getHeader ? message.getHeader('Auto-Submitted') || '' : '').toLowerCase();
    return !!header && header !== 'no';
  } catch (error) {
    return false;
  }
}

// The same mailbox: case never matters, and for Gmail neither do dots or a +tag in the name.
function sameAddress_(a, b) { return addressKey_(a) === addressKey_(b); }

function addressKey_(address) {
  var parts = String(address || '').trim().toLowerCase().split('@');
  if (parts.length !== 2) return parts.join('@');
  if (parts[1] === 'gmail.com' || parts[1] === 'googlemail.com') return parts[0].split('+')[0].replace(/\./g, '') + '@gmail.com';
  return parts.join('@');
}

// A reply quoting our code from another address does not count (nobody may answer for someone else), but it is never silent:
// the sender is told once to reply from the address the question went to.
function wrongSender_(messageId, address, subject) {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('sender:' + messageId) || !mailAvailable_()) return;
    cache.put('sender:' + messageId, '1', 21600);
    logRow_('email', 'reply:wrong-sender', '-', '-');
    sendMail_(address, 'Your reply did not count: please answer from the right address', ['We got your reply to "' + subject.replace(/^(re|fwd?):\s*/i, '') +
      '", but it came from a different email address than the one we wrote to, so nothing changed.',
      { callout: 'Please **reply from the email address our message was sent to**, saying **YES** or **NO**.', tone: 'action' }], ['wrong-sender', messageId]);
  } catch (error) {
    logError_('tell a sender to use the right address', error);
  }
}

// A reply to one of our questions that is not a clear YES or NO: tell the sender once how to answer.
function unreadableReply_(messageId, address, subject) {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('unread:' + messageId) || !mailAvailable_()) return;
    cache.put('unread:' + messageId, '1', 21600);
    logRow_('email', 'reply:unreadable', '-', '-');
    sendMail_(address, 'We could not read your reply', ['We got your reply to "' + subject.replace(/^(re|fwd?):\s*/i, '') + '", but could not tell whether it was YES or NO.',
      { callout: 'Please **reply to that email again** saying just **YES** or **NO** (not both).', tone: 'action' },
      'To confirm all but some nights, reply **YES except** and the dates, like **YES except Nov 4, Nov 18**, or use the "Yes, except some nights" button in that email.'], ['unreadable-reply', messageId]);
  } catch (error) {
    logError_('tell a sender their reply was unreadable', error);
  }
}

// A "YES except" whose dates we could not read, or that are not among the sign-up's nights: nothing changes, and the sender
// is told once, with their nights and the link that lets them untick them instead.
function unclearExcept_(messageId, address, subject, batchId, missing) {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('unread:' + messageId) || !mailAvailable_()) return;
    cache.put('unread:' + messageId, '1', 21600);
    logRow_('email', 'reply:unclear-except', batchId, '-');
    var nights = nightsOf_(batchId);
    sendMail_(address, 'We could not read the dates in your reply', ['We got your reply to "' + subject.replace(/^(re|fwd?):\s*/i, '') + '", but ' +
      (missing && missing.length ? missing.join(', ') + (missing.length === 1 ? ' is' : ' are') + ' not one of the nights in that email' : 'could not tell which nights to leave out') +
      ', so **nothing changed** yet.',
      { callout: 'The easiest way: **open your nights** and untick the ones you can\'t do: ' + mineLink_(address), tone: 'action' },
      'Or reply to that email again with **YES except** and the dates, like **YES except ' + exampleDates_(nights) + '**. Your nights in it are:',
      { schedule: nights }], ['unclear-except', messageId]);
  } catch (error) {
    logError_('tell a sender their dates were unclear', error);
  }
}

// The sign-up's nights a "YES except" can name: those still pending, expired but not yet answered, or released by a NO.
function nightsOf_(batchId) {
  return rows_('Signups').filter(function (entry) {
    return entry.batch_id === batchId && (entry.status === 'pending' || entry.status === 'expired' || entry.status === 'released');
  }).sort(function (a, b) {
    return a.date.localeCompare(b.date);
  });
}

// "Nov 4, Nov 18": the example a reply can copy, from the person's own nights.
function exampleDates_(entries) {
  var dates = [];
  entries.forEach(function (entry) { if (dates.indexOf(entry.date) < 0) dates.push(entry.date); });
  var pick = dates.length > 2 ? [dates[1], dates[dates.length - 1]] : dates.length ? dates.slice(0, 1) : ['2026-11-04'];
  return pick.map(function (date) { return MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3) + ' ' + Number(date.slice(8, 10)); }).join(', ');
}

// Mail and phone apps add invisible characters and unusual spaces. Drop the first and turn the rest into plain spaces.
function plainText_(text) {
  return String(text || '').replace(/[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF]/g, '')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
}

// What the person wrote themselves in a reply: everything before the quoted earlier message or a signature. Our own emails
// say both "Reply YES" and "Reply NO", so the quoted part must never be read as their answer.
function ownWords_(text) {
  var lines = plainText_(text).split(/\r?\n/).map(function (line) { return line.trim(); });
  var mine = [];
  for (var i = 0; i < lines.length; i += 1) {
    var line = lines[i];
    var next = lines[i + 1] || '';
    // A signature or quote marker inside a line ends their words there too (HTML-only replies can run lines together).
    var glued = line.search(/sent from my |get outlook for |-{2,}\s*(original|forwarded) message|on\b.{4,}\bwrote:|\[CTTC shift |reply (yes|no):|concord table tennis club|_{5,}/i);
    if (glued > 0) {
      mine.push(line.slice(0, glued).trim());
      break;
    }
    if (/^>/.test(line) || /^-{2,}\s*(original message|forwarded message)/i.test(line) || /^_{5,}$/.test(line) ||
      /^(sent from|get outlook for)\b/i.test(line) || /^--\s*$/.test(line) || /\[CTTC shift |^reply (yes|no)\b|concord table tennis club/i.test(line) ||
      (/^(from|sent|to|subject|date):\s/i.test(line) && mine.length) || /^on\b.{4,}\bwrote:?$/i.test(line) || (/^on\b.{4,}/i.test(line) && /\bwrote:?$/i.test(next))) break;
    mine.push(line);
  }
  return mine.join('\n').trim();
}

// 'yes', 'no' or '' for an email reply: the first line of the person's own words must start with yes or no, after a greeting
// or "ok" ("Yes, see you Monday", "ok yes", "no thanks"). A yes or no further in is not an answer, nor is "Yes, but no", nor
// "Yes except Nov 4" (exceptOf_ reads that one, for a sign-up question only).
function answerOf_(text) {
  var line = answerLines_(text)[0] || '';
  var rest = line.replace(/\bno (problem|worries|prob|issues?|rush)\b/g, ' ');
  var yes = /^(y|yes|yeah|yep|yup|yess+)\b/.test(line);
  var no = /^(n|no|nope|nah)\b/.test(line);
  if (yes && /\b(no|nope|nah|not|can't|cannot|cant|except|excluding|besides|minus|without)\b|\b(apart|other) (from|than)\b/.test(rest)) return '';
  if (no && /\b(yes|yeah|yep|yup)\b/.test(rest)) return '';
  return yes ? 'yes' : no ? 'no' : '';
}

// The person's own lines in lower case, from the first that is not empty or a bare greeting ("Hi Sam,"); a leading "ok",
// "hi Sam," or "thanks" is taken off that first one.
function answerLines_(text) {
  var lines = ownWords_(text).split('\n').filter(function (each) {
    return each && !/^(hi|hey|hello|dear|good (morning|afternoon|evening))\b(?!.*\b(y|yes|yeah|yep|yup|n|no|nope|nah)\b)[^.!?]{0,30}[,.!:]*$/i.test(each);
  }).map(function (each) { return each.toLowerCase(); });
  if (lines.length) {
    lines[0] = lines[0]
      .replace(/^((ok|okay|sure|great|thanks|thank you|no problem|no worries|hi|hey|hello|dear|good (morning|afternoon|evening))\b[\s,.!:-]*([a-z]+[\s,.!:-]+)?(?=(y|yes|yeah|yep|yup|n|no|nope|nah)\b))+/, '')
      .replace(/^((ok|okay|sure|great|thanks|thank you|no problem|no worries)\b[\s,.!:-]*)+/, '');
  }
  return lines;
}

// ---------- YES except some nights ----------

// A YES (or a CONFIRM text) that leaves some nights out: "YES except Nov 4 and 18", "Yes to all but not 11/4, 12/2", "Peg is
// a YES for all those Monday nights except (Oct 19 and Nov 2). Please correct the schedule", with the dates in brackets, up
// to the end of that sentence, or on the lines after it. null for anything else. Otherwise { days, unclear }: days are { month, day,
// year } as typed (year 0 when not typed). unclear is true when a word is neither part of a date nor a joining word ("yes
// except when it rains", "yes except Wednesdays") or a month has no day: then nothing is guessed and nothing changes.
function exceptOf_(text) {
  var lines = answerLines_(text);
  // Someone answering for another ("Peg is a yes", "she says yes"), then up to 6 words before the except ("for all those Monday
  // nights"), none of them a no.
  var found = /^(?:(?:[a-z'\u2019]+\s+){1,3}(?:is|are|says?)\s+(?:a\s+)?)?(y|yes|yeah|yep|yup|yess+|confirm)\b[\s,.!:;-]*((?:[a-z'\u2019]+[\s,.!:;-]+){0,6}?)(?:except(?:\s+for)?|but\s+not|apart\s+from|other\s+than|excluding|besides|minus|without)\b(.*)$/.exec(lines[0] || '');
  if (!found || /\b(no|not|nope|can't|cannot|cant|won't|unable)\b/.test(found[2])) return null;
  var region = found[3];
  var bracket = /^\s*[:,-]?\s*\(([^)]*)\)/.exec(region);
  var sentence = /[!?]|(?:^|[^a-z])(?![a-z]{3,4}\.\s)[a-z]*\.(?:\s|$)/.exec(region);
  var cut = bracket ? bracket[1] : sentence && region.slice(0, sentence.index + sentence[0].length).replace(/[.!?\s]+$/, '').trim() ? region.slice(0, sentence.index + sentence[0].length) : '';
  var words = (cut ? [cut] : [region].concat(lines.slice(1))).join(' ').replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .match(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d+|[a-z']+\.?|[^\s\w]/g) || [];
  var days = [];
  var month = 0;
  var waiting = false;
  var unclear = false;
  words.forEach(function (word) {
    var parts = null;
    var name = word.replace(/\.$/, '');
    if (/^20\d\d$/.test(word) && days.length && !days[days.length - 1].year && !waiting) {
      // "November 4, 2026", as our emails write it.
      days[days.length - 1].year = Number(word);
    } else if (/^\d+$/.test(word)) {
      if (month && Number(word) >= 1 && Number(word) <= 31) days.push({ month: month, day: Number(word), year: 0 });
      else unclear = true;
      waiting = false;
    } else if (monthOf_(name)) {
      if (waiting) unclear = true;
      month = monthOf_(name);
      waiting = true;
    } else if ((parts = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(word) || /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(word))) {
      days.push(parts[1].length === 4 ? { month: Number(parts[2]), day: Number(parts[3]), year: Number(parts[1]) } :
        { month: Number(parts[1]), day: Number(parts[2]), year: parts[3] ? Number(parts[3].length === 2 ? '20' + parts[3] : parts[3]) : 0 });
      if (waiting) unclear = true;
      month = 0;
      waiting = false;
    } else if (!/^(mon|monday|wed|wednesday|fri|friday|sat|saturday|and|or|the|of|on|night|nights|date|dates|shift|shifts|please|thanks|thank|you|[,.;:&!()+-])$/.test(name || word)) {
      unclear = true;
    }
  });
  return { days: days, unclear: unclear || waiting || !days.length };
}

// Whether the person's own words name a date ("Oct 19", "November 2nd", "11/2").
function namesDate_(text) {
  return answerLines_(text).some(function (line) {
    return /\b\d{1,2}\/\d{1,2}\b/.test(line) || (line.match(/\b[a-z]{3,9}\.?\s+\d{1,2}(st|nd|rd|th)?\b/g) || []).some(function (found) { return monthOf_(found.split(/[.\s]/)[0]); });
  });
}

// 1 to 12 for "nov", "Nov.", "november" or "sept"; 0 for anything else.
function monthOf_(word) {
  if (word === 'sept') return 9;
  for (var index = 0; index < MONTHS.length; index += 1) if (word.length >= 3 && MONTHS[index].toLowerCase().indexOf(word) === 0) return index + 1;
  return 0;
}

// The nights of a sign-up that the typed days name, as { dates }, or { missing }: the typed days that are not among them.
function exceptDates_(parsed, entries) {
  var dates = [];
  var missing = [];
  parsed.days.forEach(function (typed) {
    var hits = entries.filter(function (entry) {
      return Number(entry.date.slice(5, 7)) === typed.month && Number(entry.date.slice(8, 10)) === typed.day && (!typed.year || Number(entry.date.slice(0, 4)) === typed.year);
    });
    if (!hits.length) missing.push(MONTHS[typed.month - 1] ? MONTHS[typed.month - 1].slice(0, 3) + ' ' + typed.day : typed.month + '/' + typed.day);
    hits.forEach(function (entry) { if (dates.indexOf(entry.date) < 0) dates.push(entry.date); });
  });
  return missing.length ? { missing: missing } : { dates: dates.sort() };
}

// ---------- Texts go through the club's Google Voice number ----------
// Voice forwards each text to the owner's Gmail; replying to that email texts the person back. The coaching app reads the
// same number and treats a bare YES or NO from its own people as an answer, so staffing texts use words it ignores: CONFIRM
// and RELEASE. Texts are only sent to someone who gave a mobile number AND texted STAFF to the club number from it.

function staffWord_(text) {
  var line = plainText_(text).split(/\r?\n/).map(function (each) { return each.trim(); }).filter(Boolean)[0] || '';
  var word = line.replace(/[.!]+$/, '').toUpperCase();
  return word === 'CONFIRM' ? 'yes' : word === 'RELEASE' ? 'no' : '';
}

// "Last, First" and "First Last" are the same person; case and spacing do not matter.
function nameKey_(value) {
  var name = String(value || '').replace(/\s+/g, ' ').trim();
  var comma = name.match(/^([^,]+),\s*(.+)$/);
  return (comma ? comma[2] + ' ' + comma[1] : name).toLowerCase();
}

// One forwarded Voice text, or null for anything else (including mail that merely claims to be one).
function voiceText_(message) {
  var from = String(message.getFrom() || '');
  var address = ((from.match(/<([^>]+)>/) || [null, from])[1] || '').trim().toLowerCase();
  if (!/@txt\.voice\.google\.com$/.test(address)) return null;
  var subject = String(message.getSubject() || '').match(/^New text message from (.+)$/i);
  if (!subject) return null;
  var sender = subject[1].trim();
  var phone = sender.match(/\(?\+?[\d][\d\s().-]{6,}\d\)?$/);
  var lines = String(message.getPlainBody() || '').split(/\r?\n/).map(function (line) { return line.trim(); });
  var body = [];
  for (var i = 0; i < lines.length; i += 1) {
    if (/^(To respond to this text message|YOUR ACCOUNT|HELP CENTER|HELP FORUM|Google LLC)/i.test(lines[i])) break;
    if (!lines[i] || /^<https:\/\/voice\.google\.com[^>]*>$/.test(lines[i])) continue;
    body.push(lines[i]);
  }
  return { name: phone ? sender.slice(0, phone.index).trim() : sender, digits: phone ? phoneDigits_(phone[0]) : '', text: body.join('\n').slice(0, 500),
    at: message.getDate().getTime(), message: message };
}

function fromPerson_(text, person) {
  var digits = phoneDigits_(person.phone);
  return (!!digits && text.digits === digits) || (!text.digits && !!text.name && nameKey_(text.name) === nameKey_(person.name));
}

// Recent forwarded texts from one person ({name, phone}), newest first, from the texts the desk collects.
function voiceTextsFrom_(person, days) {
  return storedTexts_(Date.now() - days * 86400000).map(voiceText_).filter(function (text) { return text && fromPerson_(text, person); })
    .sort(function (a, b) { return b.at - a.at; });
}

// ---------- Texts, collected by the desk ----------
// Gmail allows a free account about 20,000 reads a day, shared by all the club's apps, and searching Voice texts here every
// minute used them up. The desk's one mail reader (apps-script/MailReader.js) records every forwarded text in its Sheet's
// VoiceTexts tab within a minute, and the app reads them there (DESK_SHEET_ID). Each row is shaped like the Gmail message it
// came from, so voiceText_ reads it unchanged; only a reply opens the real message, by id.
var READER_LATE_MS = 10 * 60 * 1000;

// Texts received since the given time (ms). Throws when the desk has stopped collecting them, so the minute check reports it.
function storedTexts_(since) {
  if (!property_('DESK_SHEET_ID', '')) throw new Error('Set the script property DESK_SHEET_ID to the id of the desk Sheet.');
  var desk = book_('DESK_SHEET_ID');
  var reader = desk.getSheetByName('MailReader');
  var readAt = reader && reader.getLastRow() >= 2 ? Number(reader.getRange(2, 1, 1, 1).getValues()[0][0]) || 0 : 0;
  var tab = desk.getSheetByName('VoiceTexts');
  if (!tab || Date.now() - readAt > READER_LATE_MS) {
    throw new Error('the desk has not collected texts since ' + (readAt ? momentLabel_(readAt) : 'it was set up') + ': its mail reader is not running');
  }
  return tab.getDataRange().getValues().slice(1).filter(function (row) { return String(row[0]) && Number(row[1]) >= since; }).map(storedMessage_);
}

// A VoiceTexts row (message_id, received_at, from, subject, text) as the Gmail message it came from.
function storedMessage_(row) {
  var real = null;
  var gmail = function () { return real || (real = GmailApp.getMessageById(String(row[0]))); };
  return {
    getId: function () { return String(row[0]); },
    getDate: function () { return new Date(Number(row[1])); },
    getFrom: function () { return String(row[2]); },
    getSubject: function () { return String(row[3]); },
    getPlainBody: function () { return String(row[4]); },
    getReplyTo: function () { return gmail().getReplyTo(); },
    reply: function (body) { return gmail().reply(body); }
  };
}

// The same, searched in Gmail: only to reply to someone whose last text came before the desk started collecting them.
function gmailTextsFrom_(person, days) {
  var name = String(person.name || '').replace(/["\\()]/g, ' ').replace(/\s+/g, ' ').trim();
  var terms = name ? ['subject:"' + name + '"'] : [];
  var digits = phoneDigits_(person.phone);
  if (digits) terms.push('"' + phoneLabel_(digits) + '"');
  var seen = {};
  var texts = [];
  GmailApp.search('in:anywhere from:txt.voice.google.com newer_than:' + days + 'd (' + terms.join(' OR ') + ')', 0, 20).forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      if (seen[message.getId()]) return;
      seen[message.getId()] = true;
      var text = voiceText_(message);
      if (text && fromPerson_(text, person)) texts.push(text);
    });
  });
  return texts.sort(function (a, b) { return b.at - a.at; });
}

// Replies to the person's latest text to the club number, which Voice turns into a text back to them.
function sendText_(person, body, log) {
  var latest = voiceTextsFrom_(person, THREAD_DAYS)[0] || gmailTextsFrom_(person, THREAD_DAYS)[0];
  if (!latest) throw new Error('this person has not texted the club number yet');
  latest.message.reply(body);
  if (log) logSent_('text', log[0], log[1], phoneDigits_(person.phone) || person.name);
}

// A CONFIRM or RELEASE after we texted someone a sign-up question answers that question (People.ask_ref), and so does
// "CONFIRM except Nov 4". When those dates cannot be matched nothing changes: the person is texted once, and a later text
// can still answer.
function checkTextAnswers_() {
  rows_('People').filter(function (person) { return person.texts === 'yes' && person.ask_ref && Number(person.ask_at) > 0 && phoneDigits_(person.phone); }).forEach(function (person) {
    var asked = Number(person.ask_at);
    var reply = voiceTextsFrom_(person, 2).filter(function (text) { return text.at > asked && (staffWord_(text.text) || textExcept_(text.text)); }).sort(function (a, b) { return a.at - b.at; })[0];
    if (!reply) return;
    var except = textExcept_(reply.text);
    if (!except) return batchAnswer_(person.ask_ref, staffWord_(reply.text), 'text');
    var picked = except.unclear ? null : exceptDates_(except, nightsOf_(person.ask_ref));
    if (picked && !picked.missing) return batchAnswer_(person.ask_ref, 'yes', 'text', picked.dates);
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      person.ask_at = String(reply.at);
      save_('People', person);
    } finally {
      lock.releaseLock();
    }
    try {
      sendText_(person, 'CTTC: We could not match ' + (picked ? picked.missing.join(', ') : 'those dates') + ' to your nights, so nothing changed. Reply CONFIRM, RELEASE, or CONFIRM except ' +
        exampleDates_(nightsOf_(person.ask_ref)) + '. Or untick nights with the link in your email.', ['batch-except-unclear', person.ask_ref]);
    } catch (error) {
      logError_('text about unclear dates', error, person.ask_ref);
    }
  });
}

// "CONFIRM except Nov 4" in a text (a YES never answers a text: the coaching app reads those).
function textExcept_(text) {
  return /^\s*confirm\b/i.test(plainText_(text)) ? exceptOf_(plainText_(text).split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean).join('\n')) : null;
}

// STAFF turns on shift texts for the person whose mobile number matches; STOP turns them off. STOP is recorded silently: the
// coaching app answers STOP for its own students, and one STOP should not get two replies.
function checkOptIns_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('opt-ins')) return false;
  cache.put('opt-ins', '1', 300);
  var onFile = rows_('Emails').filter(function (row) { return String(row.status).trim().toLowerCase() === 'approved' && phoneDigits_(row.phone) && cleanEmail_(row.email); });
  if (!onFile.length && !rows_('People').some(function (person) { return phoneDigits_(person.phone); })) return;
  var texts = [];
  storedTexts_(Date.now() - 2 * 86400000).forEach(function (message) {
    var text = voiceText_(message);
    var word = text ? (text.text.split('\n')[0] || '').trim().replace(/[.!]+$/, '').toUpperCase() : '';
    if (word === 'STAFF' || word === 'STOP') {
      text.word = word;
      texts.push(text);
    }
  });
  texts.sort(function (a, b) { return a.at - b.at; });
  var welcome = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Only a mobile on file counts: someone the club has a number for may opt in before they ever sign up.
    var everyone = rows_('People');
    onFile.forEach(function (row) {
      var person = everyone.filter(function (entry) { return sameAddress_(entry.email, row.email); })[0];
      if (!person) {
        person = { email: cleanEmail_(row.email), name: row.name, player_id: row.player_id, phone: phoneDigits_(row.phone), texts: '', created_at: nowIso_() };
        save_('People', person);
        everyone.push(person);
      } else if (phoneDigits_(person.phone) !== phoneDigits_(row.phone)) {
        person.phone = phoneDigits_(row.phone);
        person.texts = '';
        save_('People', person);
      }
    });
    var people = everyone.filter(function (person) { return phoneDigits_(person.phone); });
    texts.forEach(function (text) {
      var matched = people.filter(function (person) { return fromPerson_(text, person) && text.at > Number(person.texts_at || 0); });
      matched.forEach(function (person) {
        person.texts = text.word === 'STAFF' ? 'yes' : '';
        person.texts_at = String(text.at);
        save_('People', person);
      });
      if (matched.length && text.word === 'STAFF') welcome.push({ message: text.message, to: text.digits || text.name });
    });
  } finally {
    lock.releaseLock();
  }
  welcome.forEach(function (entry) {
    try {
      entry.message.reply('CTTC: You will get texts about your staff shifts. To confirm a sign-up by text, reply CONFIRM (or RELEASE to cancel). Text STOP to stop.');
      logSent_('text', 'staff-texts-on', entry.message.getId(), entry.to);
    } catch (error) {
      logError_('answer a STAFF text', error);
    }
  });
}

// ---------- The hourly sweep ----------

// Run by the hourly trigger, and after every sign-up and answer. Expires holds that ran out, sends any email or text that has
// not gone out yet, sends day-before reminders, and keeps the log short.
function sweep() { sweep_(); }

function sweep_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureHeaders_();
    var now = Date.now();
    tidyEmails_(rows_('Emails'));
    settleRequests_(now);
    var signups = rows_('Signups');
    signups.forEach(function (entry) {
      var status = signupStatus_(entry, now);
      if (status === entry.status) return;
      entry.status = status;
      entry.updated_at = nowIso_();
      save_('Signups', entry);
    });
    var people = rows_('People');
    rows_('Batches').forEach(function (batch) {
      var status = batchStatus_(batch, now);
      if (status !== batch.status) {
        batch.status = status;
        batch.updated_at = nowIso_();
        save_('Batches', batch);
        logRow_('step', 'step:' + status, batch.batch_id, '-');
      }
      if (now - (Date.parse(batch.updated_at || batch.created_at) || 0) > RETRY_MAIL_DAYS * 86400000) return;
      deliverBatch_(batch, signups, now);
      textBatch_(batch, signups, people, now);
    });
    cancelClosed_(signups, rows_('Emails'));
    remind_(signups, rows_('Emails'), now);
    trimLog_();
  } catch (error) {
    logError_('finish the sweep', error);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

// Call while holding the lock. The person is told about each status of a submission once: asked (pending), confirmed,
// released (their NO) or expired. emailed is written only after the mail was accepted, so a failed send is retried.
function deliverBatch_(batch, signups, now) {
  if (batch.emailed === batch.status) return;
  // A submission that expired before its question ever went out has nothing to tell.
  if ((batch.status === 'expired' && batch.emailed !== 'pending') || (batch.status === 'declined' && batch.emailed !== 'awaiting_club')) {
    batch.emailed = batch.status;
    save_('Batches', batch);
    return;
  }
  var mine = signups.filter(function (entry) { return entry.batch_id === batch.batch_id; }).sort(function (a, b) {
    return (a.date + POSITIONS.indexOf(position_(a.position))).localeCompare(b.date + POSITIONS.indexOf(position_(b.position)));
  });
  var message = batchMail_(batch, mine, now);
  if (!mailAvailable_()) return;
  try {
    sendMail_(message.to || batch.email, message.subject, message.lines, ['batch:' + batch.status, batch.batch_id], message.to ? CLUB_FOOTER : null);
  } catch (error) {
    logError_('email a sign-up (' + batch.status + ')', error, batch.batch_id);
    return;
  }
  batch.emailed = batch.status;
  save_('Batches', batch);
}

// Call while holding the lock. A pending submission is also texted to someone who gets our texts: their latest question is
// the one CONFIRM or RELEASE answers.
function textBatch_(batch, signups, people, now) {
  if (batchStatus_(batch, now) !== 'pending' || batch.texted === 'pending') return;
  var person = people.filter(function (entry) { return sameAddress_(entry.email, batch.email); })[0];
  if (!person || person.texts !== 'yes' || !phoneDigits_(person.phone)) return;
  var mine = signups.filter(function (entry) { return entry.batch_id === batch.batch_id && signupStatus_(entry, now) === 'pending'; });
  if (!mine.length) return;
  try {
    sendText_(person, 'CTTC: Reply CONFIRM to lock in your ' + mine.length + ' staff shift' + (mine.length === 1 ? '' : 's') + ' (first: ' + shortDay_(mine[0].date) + ', ' +
      position_(mine[0].position).label + '), or RELEASE to cancel. Please answer by ' + momentLabel_(Number(batch.expires_at)).replace(' Pacific Time', '') + '.', ['batch-question', batch.batch_id]);
  } catch (error) {
    logError_('text a sign-up question', error, batch.batch_id);
    return;
  }
  person.ask_ref = batch.batch_id;
  person.ask_at = String(now);
  save_('People', person);
  batch.texted = 'pending';
  save_('Batches', batch);
}

// Call while holding the lock. A night that became closed (closures.json or the Closures tab) after people signed up: its
// confirmed and pending sign-ups are cancelled (cancelled_by 'closure'). Each confirmed person is told once, per night (notified
// is written after the email was accepted, so a failure is retried and a success never repeated), and the club gets one
// summary per sweep. A pending pick was never confirmed, so it is only released.
function cancelClosed_(signups, emails) {
  var closures = closures_();
  var today = pacificNow_().date;
  signups.forEach(function (entry) {
    if (entry.date < today || !Object.prototype.hasOwnProperty.call(closures, entry.date) || (entry.status !== 'confirmed' && entry.status !== 'pending')) return;
    entry.notified = entry.status === 'confirmed' ? '' : '-';
    entry.status = 'cancelled';
    entry.cancelled_by = 'closure';
    entry.updated_at = nowIso_();
    save_('Signups', entry);
    logRow_('step', 'step:cancelled', entry.batch_id, '-', 'gym closed on ' + entry.date);
  });
  var groups = {};
  signups.forEach(function (entry) {
    if (entry.cancelled_by !== 'closure' || entry.notified || entry.date < today) return;
    var key = contactOf_(entry, emails) + ' ' + entry.date;
    (groups[key] = groups[key] || []).push(entry);
  });
  var told = [];
  Object.keys(groups).forEach(function (key) {
    var entries = groups[key];
    if (!mailAvailable_()) return;
    var positions = entries.map(function (entry) { return position_(entry.position).label; }).join(' and ');
    try {
      sendMail_(key.split(' ')[0], 'Cancelled: your CTTC shift on ' + shortDay_(entries[0].date), ['Hello ' + firstName_(entries[0].name) + ',',
        { callout: 'The gym is closed on **' + dayLabel_(entries[0].date) + '**; your ' + positions + ' shift is cancelled. Thank you!', tone: 'action' },
        'Nothing else is needed from you. You can pick another night any time at ' + PAGE_URL + '.'], ['closure-cancelled', entries[0].batch_id]);
    } catch (error) {
      logError_('tell a volunteer their night closed', error, entries[0].batch_id);
      return;
    }
    entries.forEach(function (entry) {
      entry.notified = nowIso_();
      save_('Signups', entry);
      told.push(entry);
    });
  });
  if (!told.length) return;
  try {
    if (mailAvailable_()) {
      sendMail_(adminEmail_(), 'Staffing: ' + told.length + ' shift' + (told.length === 1 ? '' : 's') + ' cancelled because the gym is closed', [
        'These volunteers were told their shift is cancelled because the gym is closed that night:',
        { rows: told.map(function (entry) { return [shortDay_(entry.date), entry.name + ', ' + position_(entry.position).label]; }) }], ['closure-summary', told[0].batch_id], CLUB_FOOTER);
    }
  } catch (error) {
    logError_('tell the club about cancelled shifts', error);
  }
}

// "Table setup (opening, 7:00 PM)", "Closing (put tables away) (10:00 PM), also finalizing the desk".
function shiftLabel_(entry) {
  var spec = position_(entry.position);
  var night = NIGHTS[weekday_(entry.date)];
  return spec.label + (spec.part === 'open' ? ' (opening, ' + time12_(night.start) + ')' : ' (closing, ' + time12_(night.end) + ')') +
    (entry.finalize === 'yes' ? ', also finalizing the desk' : '');
}

function shiftRows_(entries) { return { rows: entries.map(function (entry) { return [shortDay_(entry.date), shiftLabel_(entry)]; }) }; }

// Calendar letters: a filled square is the position itself, an outlined one its backup.
var CAL_CODES = { desk: 'D', 'desk-backup': 'D', money: 'M', 'money-backup': 'M', tables: 'S', lockup: 'L', close: 'T' };

// Closed nights (data/closures.json and the Closures tab) on the same weekdays, between the first and last of these shifts:
// shown on the email's calendar so a gap is never a surprise.
function closedAround_(entries) {
  if (!entries.length) return [];
  var dates = entries.map(function (entry) { return entry.date; }).sort();
  var weekdays = {};
  entries.forEach(function (entry) { weekdays[weekday_(entry.date)] = true; });
  var closed = {};
  try {
    closed = closures_();
  } catch (error) {
    closed = {};
  }
  return Object.keys(closed).filter(function (date) { return date >= dates[0] && date <= dates[dates.length - 1] && weekdays[weekday_(date)]; }).sort();
}

// A reply the person's mail app fills in: To the club, the same subject (so the reply is read), and YES or NO.
function replyLink_(subject, answer) {
  return 'mailto:' + Session.getEffectiveUser().getEmail() + '?subject=' + encodeURIComponent('Re: ' + subject) + '&body=' + encodeURIComponent(answer);
}

function batchMail_(batch, mine, now) {
  var hello = 'Hello ' + (firstName_(batch.name) || 'there') + ',';
  var deadline = momentLabel_(Number(batch.expires_at));
  var unavailable = mine.filter(function (entry) { return entry.status === 'unavailable'; });
  var approved = batch.emailed === 'awaiting_club';
  if (batch.status === 'awaiting_club') {
    return { to: adminEmail_(), subject: 'Approve an email for staff sign-ups ' + refTag_(clubCode_(batch)), lines: [
      { callout: '**' + batch.name + '** wants to use **' + batch.email + '** for staff sign-ups. Reply **YES** to approve or **NO** to decline.', tone: 'action' },
      'The club has no email on file for ' + batch.name + ', so this address needs the club\'s OK once. On YES it becomes their email on file and we email them to confirm these shifts (they still reply YES themselves). On NO, or no answer within 7 days, nothing is held and they are told to contact the club.',
      { heading: 'The shifts they picked (not held yet)' }, shiftRows_(mine),
      { choices: [['YES', 'Approve this address for ' + batch.name + '.'], ['NO', 'Decline it.']] },
      'A reply from another address does not count. You can also decide in the private staffing Sheet: Emails tab, status approved or declined.'] };
  }
  if (batch.status === 'declined') {
    return { subject: 'We could not confirm your email for CTTC staff sign-ups', lines: ['Hello,',
      'Someone asked to use this email address for volunteer sign-ups at the Concord Table Tennis Club. The club could not confirm it, so no shifts were saved.',
      'If that was you, please contact the club (talk to the desk on a club night) and we will set it up.'] };
  }
  if (batch.status === 'unavailable') {
    return { subject: 'Your email is approved, but those shifts were taken', lines: [hello,
      'The club approved your email address: from now on we use it for your sign-ups. Sorry: by then none of the shifts you picked were still free.', shiftRows_(unavailable),
      'Please pick again at ' + PAGE_URL + '. This time we email you straight away.'] };
  }
  if (batch.status === 'pending') {
    var held = mine.filter(function (entry) { return entry.status !== 'unavailable'; });
    var nights = {};
    held.forEach(function (entry) { nights[entry.date] = true; });
    var many = Object.keys(nights).length;
    var count = many === 1 ? 'this night' : 'all ' + many + ' nights';
    var subject = 'Please confirm your CTTC volunteer ' + (many === 1 ? 'night ' : 'nights ') + refTag_(batchCode_(batch));
    return { subject: subject, lines: [hello,
      batch.source === 'seed' ? 'You\'re on the club\'s open/close list, which has moved to the new volunteer calendar. Please confirm your nights so they show as yours.' : null,
      approved ? 'The club approved your email address: from now on we use it for your sign-ups.' : null,
      { callout: 'Please confirm ' + count + ' by **' + deadline + '**.', tone: 'action' },
      { buttons: [['Yes, confirm ' + count, replyLink_(subject, 'YES'), 'good']].concat(many > 1 ? [['Yes, except some nights', mineLink_(batch.email), 'some']] : [],
        [['No, release ' + (many === 1 ? 'it' : 'them'), replyLink_(subject, 'NO'), 'bad']]) },
      many > 1 ? 'The Yes and No buttons open a reply with YES or NO already filled in: just press send. "Yes, except some nights" opens your nights on the club website: untick the ones you can\'t do and tap Save.' :
        'Each button opens a reply with YES or NO already filled in: just press send.',
      many > 1 ? 'Or reply to this email with **YES**, **NO**, or **YES except** and the dates you can\'t do, like **YES except ' + exampleDates_(held) + '**.' :
        'Or reply to this email with **YES** or **NO**.',
      { heading: 'Your nights' }, { calendar: held, closed: closedAround_(held) }, { schedule: held },
      unavailable.length ? { heading: 'No longer free by the time the club approved your email' } : null, unavailable.length ? shiftRows_(unavailable) : null,
      { heading: 'What each position does' }, { roles: held },
      { heading: 'Good to know' },
      { bullets: ['Until you reply, these nights are held for you and show on the calendar as "waiting to confirm".',
        'No reply by ' + deadline + '? They are released so someone else can take them.',
        'Can\'t make a night later on? Untick it on your nights page: ' + mineLink_(batch.email),
        'Didn\'t sign up? Ignore this email: nothing is confirmed without your YES.'] }] };
  }
  if (batch.status === 'confirmed') {
    var confirmed = mine.filter(function (entry) { return entry.status === 'confirmed' || entry.status === 'dropped'; });
    var missed = batch.late === 'yes' ? mine.filter(function (entry) { return signupStatus_(entry, now) === 'expired'; }) : [];
    var left = mine.filter(function (entry) { return entry.status === 'released'; });
    // Answered with exceptions, or after a NO, or put right by the club: the email says plainly what is on the schedule now.
    var updated = ['yes except', 'yes again', 'club fix', 'my nights'].indexOf(batch.answer) >= 0;
    return { subject: updated ? 'Understood: your CTTC volunteer nights are updated' : 'You are on the CTTC staff schedule', lines: [hello,
      updated ? { callout: 'Understood - we have updated the system with the following confirmed nights:', tone: 'good' } :
        { callout: 'Thank you! **' + confirmed.length + ' night' + (confirmed.length === 1 ? ' is' : 's are') + ' confirmed.** We email you a reminder the day before each one.', tone: 'good' },
      updated ? shiftRows_(confirmed) : null, updated ? 'That is ' + confirmed.length + ' night' + (confirmed.length === 1 ? '' : 's') + '. We email you a reminder the day before each one.' : null,
      { calendar: confirmed, closed: closedAround_(confirmed) }, updated ? null : { schedule: confirmed },
      missed.length ? { heading: 'Not confirmed: these were no longer free' } : null, missed.length ? shiftRows_(missed) : null,
      left.length ? { heading: 'Left out, as you asked' } : null, left.length ? shiftRows_(left) : null,
      { heading: 'Where' }, LOCATION,
      { heading: 'Can\'t make a night after all?' },
      'Untick it on your nights page and tap Save. The rest stay as they are, and the club (and any backup) is told: ' + mineLink_(batch.email)] };
  }
  if (batch.status === 'released') {
    // Tagged, so a change of mind replied to this email ("yes except Oct 19") is read too (changeOfMind_).
    return { subject: 'Your CTTC staff sign-up is cancelled ' + refTag_(batchCode_(batch)), lines: [hello, 'OK, we released these picks as you asked. Nothing is on the schedule for you from this sign-up:',
      shiftRows_(mine.filter(function (entry) { return entry.status !== 'unavailable'; })),
      'Changed your mind? Reply to this email within 3 days with **YES**, or **YES except** and the dates you can\'t do, and we confirm whatever is still free. Or pick other nights any time at ' + PAGE_URL]};
  }
  return { subject: 'Your CTTC staff sign-up expired ' + refTag_(batchCode_(batch)), lines: [hello,
    'We did not get your YES by ' + deadline + ', so these picks were released and others can take them:', shiftRows_(mine),
    'Still want to help? Reply to this email within 3 days with **YES**, or **YES except** and the dates you can\'t do, and we confirm whatever is still free. Or pick again at ' + PAGE_URL] };
}

// Call while holding the lock. One email per person per night, the day before (from REMIND_FROM, Pacific), listing their
// positions. reminded is written after the email was accepted, so a failure is retried by the next sweep.
function remind_(signups, emails, now) {
  var today = pacificNow_();
  if (today.time < REMIND_FROM) return;
  var tomorrow = addDays_(today.date, 1);
  var closures = closures_();
  var groups = {};
  signups.forEach(function (entry) {
    if (entry.status !== 'confirmed' || entry.date !== tomorrow || entry.reminded || Object.prototype.hasOwnProperty.call(closures, entry.date)) return;
    var key = contactOf_(entry, emails) + ' ' + entry.date;
    (groups[key] = groups[key] || []).push(entry);
  });
  Object.keys(groups).forEach(function (key) {
    var entries = groups[key];
    if (!mailAvailable_()) return;
    try {
      sendMail_(key.split(' ')[0], 'Reminder: your CTTC shift tomorrow, ' + shortDay_(tomorrow), ['Hello ' + firstName_(entries[0].name) + ',',
        { callout: 'Thanks for helping run the club **tomorrow, ' + dayLabel_(tomorrow) + '**.', tone: 'good' }, shiftRows_(entries),
        { rows: [['Where', LOCATION, 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(LOCATION)]] },
        'Can\'t make it? Please untick it on your nights page so someone can step in: ' + mineLink_(key.split(' ')[0])], ['reminder', entries[0].batch_id]);
    } catch (error) {
      logError_('send a shift reminder', error, entries[0].batch_id);
      return;
    }
    entries.forEach(function (entry) {
      entry.reminded = nowIso_();
      save_('Signups', entry);
    });
  });
}

// ---------- Email ----------

function adminEmail_() { return property_('ADMIN_EMAIL', Session.getEffectiveUser().getEmail()); }

function mailAvailable_() { return MailApp.getRemainingDailyQuota() > MIN_QUOTA; }

// **text** is bold in HTML and plain in text; links become clickable (a full stop after one is not part of it).
function mailHtml_(text) {
  return esc_(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(https:\/\/[A-Za-z0-9_.\/?=&;%-]*[A-Za-z0-9_\/=%-])/g, '<a href="$1">$1</a>');
}

function mailText_(text) { return String(text).replace(/\*\*/g, ''); }

// A block is a paragraph string, or { heading }, { callout, tone }, { rows: [[label, value, link]] } or { choices: [[reply, meaning]] }.
function blockText_(block) {
  if (typeof block === 'string') return mailText_(block);
  if (block.choices) return block.choices.map(function (choice) { return 'Reply ' + choice[0] + ': ' + mailText_(choice[1]); }).join('\n');
  if (block.heading) return block.heading.toUpperCase();
  if (block.callout) return mailText_(block.callout);
  if (block.rows) return block.rows.map(function (row) { return row[0] + ': ' + mailText_(row[1]); }).join('\n');
  if (block.buttons) return block.buttons.map(function (button) { return button[0] + ': ' + (button[2] === 'some' ? button[1] : 'reply ' + (button[2] === 'good' ? 'YES' : 'NO')); }).join('\n');
  if (block.schedule) return scheduleGroups_(block.schedule).map(function (group) { return group.title + ': ' + group.dates; }).join('\n');
  if (block.roles) return rolesOf_(block.roles).map(function (spec) { return spec.label + ': ' + spec.does; }).join('\n');
  if (block.bullets) return block.bullets.map(function (line) { return '- ' + mailText_(line); }).join('\n');
  if (block.steps) return block.steps.map(function (step, index) { return (index + 1) + '. ' + mailText_(step); }).join('\n');
  if (block.calendar && block.closed.length) return 'Gym closed (not included): ' + block.closed.map(shortDay_).join(', ');
  return '';
}

// "Money collector (Front Desk), Mondays 7:00 PM": "Oct 19, 26 · Nov 2, 9" for each position and weekday.
function scheduleGroups_(entries) {
  var groups = {};
  var order = [];
  entries.slice().sort(function (a, b) { return a.date.localeCompare(b.date); }).forEach(function (entry) {
    var spec = position_(entry.position);
    var night = NIGHTS[weekday_(entry.date)];
    var key = entry.position + ':' + weekday_(entry.date);
    if (!groups[key]) {
      order.push(key);
      groups[key] = { title: spec.label + ', ' + DAYS[weekday_(entry.date)] + 's ' + time12_(spec.part === 'open' ? night.start : night.end), months: [], byMonth: {} };
    }
    var month = MONTHS[Number(entry.date.slice(5, 7)) - 1].slice(0, 3);
    if (!groups[key].byMonth[month]) {
      groups[key].byMonth[month] = [];
      groups[key].months.push(month);
    }
    groups[key].byMonth[month].push(String(Number(entry.date.slice(8, 10))) + (entry.finalize === 'yes' ? ' (finalize)' : ''));
  });
  var rank = function (key) {
    var parts = key.split(':');
    var spot = POSITIONS.map(function (spec) { return spec.id; }).indexOf(parts[0]);
    return spot * 10 + ((Number(parts[1]) + 6) % 7);
  };
  order.sort(function (a, b) { return rank(a) - rank(b); });
  return order.map(function (key) {
    var group = groups[key];
    return { title: group.title, dates: group.months.map(function (month) { return month + ' ' + group.byMonth[month].join(', '); }).join(' \u00b7 ') };
  });
}

function rolesOf_(entries) {
  var seen = {};
  return POSITIONS.filter(function (spec) { return entries.some(function (entry) { return entry.position === spec.id; }) && !seen[spec.id] && (seen[spec.id] = true); });
}

// One small table per month (email clients ignore most layout CSS): club nights filled in with the position letter.
function calendarHtml_(entries, closed) {
  var byDate = {};
  entries.forEach(function (entry) { (byDate[entry.date] = byDate[entry.date] || []).push(entry.position); });
  var shut = {};
  closed.forEach(function (date) { shut[date] = true; });
  var months = {};
  Object.keys(byDate).concat(closed).forEach(function (date) { months[date.slice(0, 7)] = true; });
  var cell = 'width:36px;height:34px;text-align:center;vertical-align:middle;font-size:13px;';
  return '<div style="margin:4px 0 10px;">' + Object.keys(months).sort().map(function (month) {
    var year = Number(month.slice(0, 4));
    var index = Number(month.slice(5, 7)) - 1;
    var first = new Date(Date.UTC(year, index, 1)).getUTCDay();
    var days = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
    var cells = [];
    for (var blank = 0; blank < first; blank += 1) cells.push('<td style="' + cell + '"></td>');
    for (var day = 1; day <= days; day += 1) {
      var date = month + '-' + ('0' + day).slice(-2);
      var mine = byDate[date];
      if (mine) {
        var backup = mine.every(function (id) { return /-backup$/.test(id); });
        var letters = mine.map(function (id) { return CAL_CODES[id]; }).join('');
        cells.push('<td style="' + cell + 'padding:2px;"><div style="border-radius:6px;line-height:1.1;padding:3px 0;' +
          (backup ? 'border:2px solid #1f6b3a;color:#1f6b3a;background:#fff;' : 'background:#1f6b3a;color:#fff;border:2px solid #1f6b3a;') +
          '"><strong>' + day + '</strong><br><span style="font-size:10px;">' + letters + '</span></div></td>');
      } else if (shut[date]) {
        cells.push('<td style="' + cell + 'color:#a3332a;"><span style="text-decoration:line-through;">' + day + '</span><br><span style="font-size:10px;">closed</span></td>');
      } else {
        cells.push('<td style="' + cell + 'color:#aaa;">' + day + '</td>');
      }
    }
    while (cells.length % 7) cells.push('<td style="' + cell + '"></td>');
    var rows = [];
    for (var at = 0; at < cells.length; at += 7) {
      var week = cells.slice(at, at + 7);
      // Weeks before the first marked night of the month are left out, so the calendar starts where the nights do.
      if (!rows.length && !week.some(function (td) { return /background:#1f6b3a|border:2px solid|closed/.test(td); })) continue;
      rows.push('<tr>' + week.join('') + '</tr>');
    }
    return '<table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;border-collapse:collapse;margin:0 18px 14px 0;vertical-align:top;">' +
      '<tr><td colspan="7" style="padding:0 0 4px;font-weight:700;font-size:14px;">' + MONTHS[index] + ' ' + year + '</td></tr><tr>' +
      ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (name) { return '<td style="' + cell + 'height:20px;color:#888;font-size:11px;">' + name + '</td>'; }).join('') +
      '</tr>' + rows.join('') + '</table>';
  }).join('') + '</div>' +
    '<p style="margin:0 0 10px;font-size:12px;color:#666;">' + legend_(entries) + '</p>';
}

function legend_(entries) {
  var used = {};
  entries.forEach(function (entry) { used[entry.position] = true; });
  var parts = [];
  [['D', 'desk', 'Desk organizer'], ['M', 'money', 'Money collector'], ['S', 'tables', 'Table/barrier setup'], ['L', 'lockup', 'Lock-up'], ['T', 'close', 'Put tables away']].forEach(function (item) {
    if (used[item[1]] || used[item[1] + '-backup']) parts.push('<strong>' + item[0] + '</strong> ' + item[2]);
  });
  if (entries.some(function (entry) { return /-backup$/.test(entry.position); })) parts.push('outlined = backup');
  return parts.join(' \u00b7 ');
}

function blockHtml_(block) {
  if (typeof block === 'string') return '<p style="margin:0 0 12px;">' + mailHtml_(block) + '</p>';
  if (block.heading) return '<h3 style="margin:22px 0 8px;padding-bottom:4px;border-bottom:1px solid #ddd;font-size:16px;color:#1f6b3a;">' + esc_(block.heading) + '</h3>';
  if (block.callout) {
    var tone = block.tone === 'good' ? 'background:#e3f1e7;border-left:5px solid #1f6b3a;' : 'background:#fff4d6;border-left:5px solid #c98a00;';
    return '<div style="' + tone + 'padding:10px 14px;margin:0 0 14px;border-radius:4px;font-size:16px;">' + mailHtml_(block.callout) + '</div>';
  }
  if (block.rows) {
    return '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 12px;font-size:15px;">' + block.rows.map(function (row) {
      return '<tr><td style="padding:3px 16px 3px 0;vertical-align:top;font-weight:700;white-space:nowrap;">' + esc_(row[0]) + '</td><td style="padding:3px 0;vertical-align:top;">' +
        (row[2] ? '<a href="' + esc_(row[2]) + '">' + esc_(row[1]) + '</a>' : mailHtml_(row[1])) + '</td></tr>';
    }).join('') + '</table>';
  }
  if (block.calendar) return calendarHtml_(block.calendar, block.closed || []);
  if (block.schedule) {
    return '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 12px;font-size:14px;">' + scheduleGroups_(block.schedule).map(function (group) {
      return '<tr><td style="padding:4px 0;"><strong>' + esc_(group.title) + '</strong><br><span style="color:#444;">' + esc_(group.dates) + '</span></td></tr>';
    }).join('') + '</table>';
  }
  if (block.roles) {
    return rolesOf_(block.roles).map(function (spec) { return '<p style="margin:0 0 8px;"><strong>' + esc_(spec.label) + ':</strong> ' + esc_(spec.does) + '</p>'; }).join('');
  }
  if (block.bullets) {
    return '<ul style="margin:0 0 12px;padding-left:20px;">' + block.bullets.map(function (line) { return '<li style="margin:0 0 4px;">' + mailHtml_(line) + '</li>'; }).join('') + '</ul>';
  }
  if (block.steps) return '<ol style="margin:0 0 12px;padding-left:22px;">' + block.steps.map(function (step) { return '<li style="margin:0 0 6px;">' + mailHtml_(step) + '</li>'; }).join('') + '</ol>';
  if (block.buttons) {
    return '<p style="margin:0 0 8px;">' + block.buttons.map(function (button) {
      return '<a href="' + esc_(button[1]) + '" style="display:inline-block;margin:0 8px 8px 0;padding:12px 18px;border-radius:6px;font-weight:700;font-size:16px;text-decoration:none;color:#fff;background:' +
        (button[2] === 'good' ? '#1f6b3a' : button[2] === 'some' ? '#1f4f8f' : '#a3332a') + ';">' + esc_(button[0]) + '</a>';
    }).join('') + '</p>';
  }
  if (block.choices) {
    return '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 14px;font-size:15px;">' + block.choices.map(function (choice) {
      return '<tr><td style="padding:4px 12px 4px 0;vertical-align:top;white-space:nowrap;"><span style="display:inline-block;min-width:88px;text-align:center;padding:3px 8px;border-radius:4px;font-weight:700;color:#fff;background:' +
        (choice[0] === 'YES' ? '#1f6b3a' : '#a3332a') + ';">Reply ' + esc_(choice[0]) + '</span></td><td style="padding:6px 0;vertical-align:top;">' + mailHtml_(choice[1]) + '</td></tr>';
    }).join('') + '</table>';
  }
  return '';
}

function sendMail_(to, subject, lines, log, footer) {
  var blocks = lines.filter(Boolean);
  footer = footer || 'This message is only about your CTTC volunteer sign-up. It does not add you to any mailing list.';
  var body = blocks.map(blockText_).filter(Boolean).concat(footer).join('\n\n');
  var html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:560px;">' + blocks.map(blockHtml_).join('') +
    '<p style="margin:20px 0 0;font-size:12px;color:#777;">' + esc_(footer) + '</p></div>';
  MailApp.sendEmail({ to: to, subject: subject, body: body, htmlBody: html, name: FROM_NAME });
  if (log) logSent_('email', log[0], log[1], cleanEmail_(to) || to);
}

// ---------- The log ----------
// One row per message sent, reply read, step or failure, in the private Log tab. The recipient appears only as a short code
// made with the app's secret (the same person always gets the same code); no name, address or number is ever written.

function logSent_(channel, kind, ref, to) {
  try {
    var code = code_('to:' + String(to || '').trim().toLowerCase()).slice(0, 6);
    console.log('staffing sent ' + channel + ' ' + kind + ' ref=' + (ref || '-') + ' to=' + code);
    logRow_(channel, kind, ref || '-', code);
  } catch (error) {
    console.error('Could not log a sent message: ' + error);
  }
}

// appendRow adds a whole row in one step, so two writers never overwrite each other's row; the leading ' keeps it plain text.
function logRow_(channel, kind, ref, to, detail) {
  try {
    tab_('Log').appendRow([nowIso_(), channel, kind, ref, to, detail || ''].map(function (value) { return "'" + value; }));
  } catch (error) {
    console.error('Could not write to the Log tab: ' + error);
  }
}

function logReply_(channel, who, ref, answer, applied, status) {
  logRow_(channel, 'reply:' + who + ':' + answer, ref, '-', (applied ? 'applied' : 'not applied') + (status ? ', now ' + status : ''));
}

// The console gets the full error; the Log tab gets what failed with every address, number and long id taken out. The same
// failure is logged at most every 10 minutes.
function logError_(what, error, ref) {
  console.error('Could not ' + what + ': ' + error);
  try {
    var kind = String(what).toLowerCase().replace(/[^a-z0-9_:]+/g, '-');
    var cache = CacheService.getScriptCache();
    var key = 'logged:' + kind + ':' + (ref || '-');
    if (cache.get(key)) return;
    cache.put(key, '1', 600);
    logRow_('error', kind, ref || '-', '-', cleanDetail_(error));
  } catch (failure) {
    console.error('Could not log a failure: ' + failure);
  }
}

function cleanDetail_(error) {
  return String(error).replace(/\S+@\S+/g, '<address>').replace(/\+?\d[\d\s().-]{5,}\d/g, '<number>').replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'").replace(/[A-Za-z0-9_-]{20,}/g, '<id>').slice(0, 120);
}

// Call while holding the lock. Keeps the Log tab to its latest LOG_KEEP rows.
function trimLog_() {
  var sheet = tab_('Log');
  var extra = sheet.getLastRow() - 1 - LOG_KEEP;
  if (extra > 0) sheet.deleteRows(2, extra);
}

// ---------- The app's secret ----------

function secret_() {
  var properties = PropertiesService.getScriptProperties();
  var value = properties.getProperty('TOKEN_SECRET');
  if (!value) {
    value = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    properties.setProperty('TOKEN_SECRET', value);
  }
  return value;
}
