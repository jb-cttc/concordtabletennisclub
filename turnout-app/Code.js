// Public turnout app: how many people to expect at the next round robin, by rating, for the site's Tonight page
// (tonight.html). Like coaching-app/ and staffing-app/ this is its own Apps Script project: a public web app exposes every
// function in its project, so the desk's code must never live here, and every function without a trailing _ is callable
// by anyone on the internet.
//
// It runs as the club owner and reads three things: the desk's private Sheet (script property DESK_SHEET_ID: Players,
// Aliases, Sessions, SessionPlayers) for who has signed in at the desk tonight; the club's forwarded Google Voice texts
// from today for who has texted; and the site's published session-roster.json for who usually comes (turnout.js, copied
// here as Turnout.js). What it answers is counts per rating zone and nothing else: never a name, a number or a text,
// because the page is public and tells anyone who will be at the gym tonight. Steps and setup: docs/turnout-flow.md.
var TZ = 'America/Los_Angeles';
var SITE = 'https://concordtabletennisclub.com';
// One answer serves every visitor for this long, so a busy page reads the Sheet and Gmail about once a minute.
var ANSWER_SECONDS = 60;
var ROSTER_SECONDS = 3600;
var MAX_THREADS = 100;
// Texts that are commands for the coaching or staffing apps, or answers to their questions, not round robin signups.
var COMMAND = /^\s*(coach|student|stop|staff|confirm|release|yes|no)\b/i;
// A latest text like "can't make it tonight" takes the sender back off the floor.
var NOT_COMING = /\b(can'?t|cannot|can not|won'?t|not (coming|going|gonna|able|make|making|playing)|unable|skip(ping)?|cancel(l?ed|ling)?|out tonight)\b/i;
// A question ("Is RR on tonight?", "What time does it start?") is not a signup unless the person also says they are
// coming ("Is there RR tonight? I'll come").
var SAYS_COMING = /\b(i'?ll|i will|i'?m|i am|count me|add me|sign me|save me|hold me|on my way|omw|running late)\b/i;
var VOICE_FOOTER = /^(To respond to this text message|YOUR ACCOUNT|HELP CENTER|HELP FORUM|Google LLC)/i;
// CTTC Turnout Logs: a tab in the desk Sheet, with the desk log's columns (apps-script/DeskLog.js), read the same way from
// GitHub (Actions > "Desk log", log: turnout), whose run logs are public. One row per text the app counted or left out,
// per change in the counts, per setup and per failure. A texter appears only as a code (S + 6 hex characters, the same
// code for the same sender), never a name, number or message; error text is cleaned the way the desk log cleans it.
// The app writes nowhere else.
var LOG_TAB = 'CTTC Turnout Logs';
var LOG_HEADERS = ['at', 'level', 'what', 'session', 'ref', 'detail'];
var LOG_KEEP = 2000;
// The page asks every minute; the same line is written once, and a failure at most once in this many seconds.
var LOG_REPEAT_SECONDS = 6 * 3600;
var LOG_FAILURE_SECONDS = 600;

function doGet() {
  return ContentService.createTextOutput(JSON.stringify(turnout())).setMimeType(ContentService.MimeType.JSON);
}

// The answer for the page: {ok, date, phase, today, updatedAt, brackets: [{label, min, max, here, texted, likely,
// expected}], unrated: {here, texted}}. See CTTCTurnout.tally for what each count means.
function turnout() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('turnout');
  if (cached) {
    try { return JSON.parse(cached); } catch (error) { /* computed again below */ }
  }
  var answer;
  try {
    answer = answer_(new Date());
  } catch (error) {
    console.error('Turnout: ' + (error && error.stack || error));
    var message = clean_(error && error.message || error);
    logOnce_('failed:' + message, LOG_FAILURE_SECONDS, 'error', 'turnout_failed', '', '', message);
    return { ok: false, error: 'Live turnout is not available right now.' };
  }
  try { cache.put('turnout', JSON.stringify(answer), ANSWER_SECONDS); } catch (error) { /* answered without the cache */ }
  return answer;
}

// Run once from the Apps Script editor by the owner, after setting DESK_SHEET_ID: Google asks for the permissions, and the
// result says what the app could read. Does nothing for anyone else.
function setup() {
  var result = setup_();
  // The editor's Run button shows only what is logged, not what a function returns.
  console.log(result);
  return result;
}

function setup_() {
  if (!Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail() !== Session.getEffectiveUser().getEmail()) {
    return 'Run setup from the Apps Script editor while signed in as the owner.';
  }
  var desk = desk_();
  var players = desk.getSheetByName('Players');
  var roster = siteJson_('/data/session-roster.json');
  GmailApp.search('in:anywhere from:txt.voice.google.com newer_than:1d', 0, 1);
  CacheService.getScriptCache().remove('turnout');
  log_('step', 'turnout_setup', '', '', 'players=' + Math.max(0, players.getLastRow() - 1) + ' nights=' + Object.keys(roster).length);
  return 'Ready: ' + Math.max(0, players.getLastRow() - 1) + ' players in the desk Sheet, ' + Object.keys(roster).length + ' published nights.';
}

function answer_(now) {
  var T = CTTCTurnout;
  var clock = {
    date: Utilities.formatDate(now, TZ, 'yyyy-MM-dd'),
    minutes: Number(Utilities.formatDate(now, TZ, 'H')) * 60 + Number(Utilities.formatDate(now, TZ, 'm'))
  };
  var night = T.sessionNight(clock, siteJson_('/data/closures.json'));
  if (!night) return { ok: true, date: null, updatedAt: now.getTime() };
  var desk = desk_();
  var players = table_(desk, 'Players');
  var byId = {};
  var byKey = {};
  players.forEach(function (player) {
    var id = String(player.player_id || '');
    if (!id) return;
    byId[id] = player;
    var key = T.nameKey(player.display_name);
    if (key) (byKey[key] = byKey[key] || []).push(id);
  });
  table_(desk, 'Aliases').forEach(function (alias) {
    var key = T.nameKey(alias.alias);
    var id = String(alias.player_id || '');
    if (key && byId[id] && !byKey[key]) byKey[key] = [id];
  });
  var only = function (key) { return byKey[key] && byKey[key].length === 1 ? byKey[key][0] : null; };
  var ratingOf = function (id) { return byId[id] && byId[id].current_rating !== '' ? Number(byId[id].current_rating) : null; };
  var people = [];
  var total = null;

  if (night.phase !== 'underway') {
    var roster = siteJson_('/data/session-roster.json');
    total = T.expectedTotal(roster, night.date);
    people = T.forecastPeople(roster, night.date, function (name) {
      var id = only(T.nameKey(name));
      return id ? ratingOf(id) : null;
    }, function (name) {
      return only(T.nameKey(name)) || 'name:' + T.nameKey(name);
    });
  }

  var session = table_(desk, 'Sessions').filter(function (row) { return day_(row.session_date) === night.date; })[0];
  if (session) {
    table_(desk, 'SessionPlayers').forEach(function (row) {
      if (String(row.session_id) !== String(session.session_id)) return;
      var id = String(row.player_id);
      var rating = row.starting_rating !== '' && row.starting_rating !== null ? Number(row.starting_rating) : ratingOf(id);
      people.push({ key: id, rating: rating, status: 'here' });
    });
  }

  if (night.date === clock.date) {
    voiceSenders_(night.date).forEach(function (sender) {
      var ref = 'S' + code_(sender.key);
      if (sender.skip) {
        logOnce_(night.date + ':' + ref + ':skip:' + sender.skip, LOG_REPEAT_SECONDS, 'step', 'text_skipped', night.date, ref, sender.skip);
        return;
      }
      var id = sender.known ? only(sender.key) : null;
      var rating = id ? ratingOf(id) : null;
      var zone = T.bracketIndex(rating);
      logOnce_(night.date + ':' + ref + ':counted', LOG_REPEAT_SECONDS, 'step', 'text_counted', night.date, ref,
        zone >= 0 ? 'zone=' + T.BRACKETS[zone].label : !sender.known ? 'front desk: no contact name' : 'front desk: contact name is not exactly one player');
      people.push({ key: id || 'voice:' + sender.key, rating: rating, status: 'texted' });
    });
  }

  var counts = T.tally(people, total === null ? undefined : total);
  var sum = { here: counts.unrated.here, texted: counts.unrated.texted, likely: 0, expected: counts.unrated.here + counts.unrated.texted };
  counts.brackets.forEach(function (bracket) {
    sum.here += bracket.here;
    sum.texted += bracket.texted;
    sum.likely += bracket.likely;
    sum.expected += bracket.expected;
  });
  var summary = 'phase=' + night.phase + ' playing=' + (sum.here + sum.texted) + ' here=' + sum.here + ' texted=' + sum.texted + ' likely=' + sum.likely + ' expected=' + sum.expected;
  logOnce_(night.date + ':counts:' + summary, LOG_REPEAT_SECONDS, 'step', 'turnout_counts', night.date, '', summary);
  return {
    ok: true,
    date: night.date,
    phase: night.phase,
    today: night.date === clock.date,
    updatedAt: now.getTime(),
    brackets: counts.brackets,
    unrated: counts.unrated
  };
}

function desk_() {
  var id = PropertiesService.getScriptProperties().getProperty('DESK_SHEET_ID');
  if (!id) throw new Error('Set the script property DESK_SHEET_ID to the id of the desk Sheet.');
  return SpreadsheetApp.openById(id);
}

// A desk tab as objects keyed by header name, so the desk can add or move columns. A missing tab reads as empty.
function table_(book, name) {
  var sheet = book.getSheetByName(name);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  var head = (values[0] || []).map(function (cell) { return String(cell).trim(); });
  return values.slice(1).map(function (row) {
    var object = {};
    head.forEach(function (header, column) { object[header] = row[column]; });
    return object;
  });
}

function day_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return Utilities.formatDate(value, TZ, 'yyyy-MM-dd');
  return String(value || '').slice(0, 10);
}

// A JSON file the site publishes. session-roster.json is too big for the cache (100 KB a key), so it is kept in parts.
function siteJson_(path) {
  var cache = CacheService.getScriptCache();
  var key = 'site:' + path;
  var parts = cache.get(key);
  if (parts) {
    var chunks = cache.getAll(Array.apply(null, Array(Number(parts))).map(function (_, i) { return key + ':' + i; }));
    var text = '';
    for (var i = 0; i < Number(parts); i++) {
      if (chunks[key + ':' + i] === undefined) { text = null; break; }
      text += chunks[key + ':' + i];
    }
    if (text) return JSON.parse(text);
  }
  var response = UrlFetchApp.fetch(SITE + path, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('The site answered ' + response.getResponseCode() + ' for ' + path);
  var body = response.getContentText();
  var value = JSON.parse(body);
  try {
    var store = {};
    var count = Math.ceil(body.length / 90000);
    for (var part = 0; part < count; part++) store[key + ':' + part] = body.slice(part * 90000, (part + 1) * 90000);
    cache.putAll(store, ROSTER_SECONDS);
    cache.put(key, String(count), ROSTER_SECONDS);
  } catch (error) { /* read again next time */ }
  return value;
}

// Everyone who texted the club's Google Voice number on date (Pacific): [{key, known, skip}]. key is the contact name's
// nameKey, or the number's digits when Voice has no contact name for it. skip says why a sender is not counted: only
// commands for the other apps, a latest text that says they are not coming, or one that only asks a question.
function voiceSenders_(date) {
  var day = new Date(date + 'T12:00:00Z');
  var after = Utilities.formatDate(new Date(day.getTime() - 86400000), 'UTC', 'yyyy/MM/dd');
  var before = Utilities.formatDate(new Date(day.getTime() + 172800000), 'UTC', 'yyyy/MM/dd');
  var threads = GmailApp.search('in:anywhere from:txt.voice.google.com after:' + after + ' before:' + before, 0, MAX_THREADS);
  var seen = {};
  var latest = {};
  var commands = {};
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      if (seen[message.getId()]) return;
      seen[message.getId()] = true;
      if (Utilities.formatDate(message.getDate(), TZ, 'yyyy-MM-dd') !== date) return;
      var text = voiceText_(message);
      if (!text) return;
      if (COMMAND.test(text.text)) {
        commands[text.key] = text.known;
        return;
      }
      if (!latest[text.key] || latest[text.key].at < text.at) latest[text.key] = text;
    });
  });
  var senders = Object.keys(latest).map(function (key) {
    var text = latest[key].text;
    var skip = NOT_COMING.test(text) ? 'latest text says not coming' : text.indexOf('?') >= 0 && !SAYS_COMING.test(text) ? 'latest text only asks a question' : '';
    return { key: key, known: latest[key].known, skip: skip };
  });
  Object.keys(commands).forEach(function (key) {
    if (!latest[key]) senders.push({ key: key, known: commands[key], skip: 'only commands for the coaching or volunteer apps' });
  });
  return senders;
}

// A forwarded Voice text as {key, known, text, at}, or null for anything else (the same reading as the desk's
// VoiceSuggestions.js).
function voiceText_(message) {
  var from = String(message.getFrom() || '');
  var address = ((from.match(/<([^>]+)>/) || [null, from])[1] || '').trim().toLowerCase();
  if (!/@txt\.voice\.google\.com$/.test(address)) return null;
  var subject = String(message.getSubject() || '').match(/^New (?:group )?text message from (.+)$/i);
  if (!subject) return null;
  var sender = subject[1].trim();
  var phone = sender.match(/\(?\+?[\d][\d\s().-]{6,}\d\)?$/);
  var name = phone ? sender.slice(0, phone.index).trim() : sender;
  var digits = phone ? phone[0].replace(/\D/g, '') : '';
  var lines = String(message.getPlainBody() || '').split(/\r?\n/).map(function (line) { return line.trim(); });
  var body = [];
  for (var i = 0; i < lines.length; i++) {
    if (VOICE_FOOTER.test(lines[i])) break;
    if (!lines[i] || /^<https:\/\/voice\.google\.com[^>]*>$/.test(lines[i])) continue;
    body.push(lines[i]);
  }
  if (!body.length || (!name && !digits)) return null;
  var comma = name.match(/^([^,]+),\s*(.+)$/);
  return {
    key: name ? CTTCTurnout.nameKey(comma ? comma[2] + ' ' + comma[1] : name) : 'phone ' + digits.slice(-10),
    known: !!name,
    text: body.join('\n'),
    at: message.getDate().getTime()
  };
}

// ---- CTTC Turnout Logs ----

function log_(level, what, session, ref, detail) {
  try {
    var book = desk_();
    var sheet = book.getSheetByName(LOG_TAB);
    if (!sheet) {
      sheet = book.insertSheet(LOG_TAB);
      sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    // appendRow adds the whole row in one step, so two writers never share a row; the leading ' keeps each value as text.
    sheet.appendRow([new Date().toISOString(), level, what, session || '', ref || '', String(detail || '').slice(0, 300)]
      .map(function (value) { return "'" + value; }));
    var extra = sheet.getLastRow() - 1 - LOG_KEEP;
    if (extra >= 100) sheet.deleteRows(2, extra);
  } catch (error) {
    console.error('Could not write to the turnout log: ' + error);
  }
}

// Writes the line unless the same key was written in the last seconds.
function logOnce_(key, seconds, level, what, session, ref, detail) {
  var cache = CacheService.getScriptCache();
  var mark = 'log:' + code_(key);
  try {
    if (cache.get(mark)) return;
    cache.put(mark, '1', seconds);
  } catch (error) { /* without the cache a line may be written twice; harmless */ }
  log_(level, what, session, ref, detail);
}

// A short code for a sender or a key: the same input always gets the same code, and it cannot be turned back into it.
function code_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'cttc-turnout:' + value).slice(0, 3)
    .map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('').toUpperCase();
}

// Error text with nothing personal left in it (as the desk log's cleanDeskText_).
function clean_(text) {
  return String(text).replace(/\S+@\S+/g, '<address>').replace(/\bplayer-[A-Za-z0-9_-]+/g, '<player>').replace(/\+?\d[\d\s().-]{5,}\d/g, '<number>').replace(/"[^"]*"/g, '"…"')
    .replace(/“[^”]*”/g, '"…"').replace(/[A-Za-z0-9_-]{20,}/g, '<id>').slice(0, 200);
}
