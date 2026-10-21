// Automatic answers to round robin texts (GitHub PR #75). On a round robin day, until sign-up closes, a minute trigger reads
// the day's forwarded Voice texts (VoiceSuggestions.js) and answers each person once:
//   - a contact name that is exactly one desk player (or an alias of one): VOICE_LINKED_REPLY with their directory name;
//   - anyone else (a number with no contact name, a name that is no one or several people): VOICE_UNLINKED_REPLY.
// Only texts that plainly say the person is coming are answered (VOICE_JOINING_); questions, "can't make it", commands
// for the coaching and volunteer apps, and anyone with a coaching lesson that day are left for a person. The organizer still adds people to the round robin from
// Voice signups as before; a reply already in the thread stops the desk's own "Confirmed." from being sent twice.
//
// Off until the owner runs enableVoiceAutoReply(): a trigger runs whatever code was pushed last, including a /dev preview,
// so it must never start texting members by itself. disableVoiceAutoReply() turns it off again.
var VOICE_AUTO_REPLY_KEY = 'CTTC_VOICE_AUTO_REPLY';
var VOICE_AUTO_REPLIED_KEY = 'CTTC_VOICE_AUTO_REPLIED';
var VOICE_AUTO_REPLY_HANDLER = 'answerVoiceSignups';
var VOICE_LINKED_REPLY = 'Received - you\'re on the list, {name}! See you tonight.';
var VOICE_UNLINKED_REPLY = 'We\'re glad to have you! This number isn\'t linked to anyone in our club directory yet. Reply with your name and we\'ll add you.';
// Monday and Wednesday, from 6 AM until sign-up closes at 7:15 PM, Pacific. A text before 6 AM is answered at 6.
var VOICE_REPLY_DAYS = [1, 3];
var VOICE_REPLY_FROM = 6 * 60;
var VOICE_REPLY_UNTIL = 19 * 60 + 15;
var VOICE_REPLIES_PER_RUN = 20;
var VOICE_CLOSURES_URL = 'https://concordtabletennisclub.com/data/closures.json';
var VOICE_JOINING_ = /\b(join|joining|come|coming|play|playing|rr|round robin|i'?m in|count me in|in tonight|sign me up|add me|save (me )?a spot|hold (me )?a spot|running late|on my way|omw|be there|see you)\b/i;
var VOICE_NOT_COMING_ = /\b(can'?t|cannot|can not|won'?t|not (coming|going|gonna|able|make|making|playing)|unable|skip(ping)?|cancel(l?ed|ling)?|out tonight)\b/i;
var VOICE_COMMAND_ = /^\s*(coach|student|stop|staff|confirm|release|yes|no)\b/i;

// The minute trigger. Returns what it did, for the editor and the tests.
function answerVoiceSignups() {
  return guardDesk_('voice_auto_reply', function () { return answerVoiceSignups_(new Date()); });
}

function answerVoiceSignups_(now) {
  var properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(VOICE_AUTO_REPLY_KEY) !== 'on') return { skipped: 'off' };
  var zone = Session.getScriptTimeZone();
  var date = Utilities.formatDate(now, zone, 'yyyy-MM-dd');
  var minutes = Number(Utilities.formatDate(now, zone, 'H')) * 60 + Number(Utilities.formatDate(now, zone, 'm'));
  var weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  if (VOICE_REPLY_DAYS.indexOf(weekday) < 0 || minutes < VOICE_REPLY_FROM || minutes >= VOICE_REPLY_UNTIL) return { skipped: 'not now' };
  if (voiceClubClosed_(date)) return { skipped: 'closed' };
  // The document lock, like sendVoiceConfirmation: score saves wait on the script lock and must not wait on Gmail.
  var lock = LockService.getDocumentLock() || LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { skipped: 'busy' };
  try {
    var done = voiceAnswered_(properties, date);
    var senders = voiceSenders_(date);
    var exact = voiceExactMatcher_();
    var coaching = {};
    try {
      coachingLessons_(date).forEach(function (person) {
        coaching[voiceNameKey_(person.name)] = true;
        if (coachingPhoneKey_(person.phone)) coaching[coachingPhoneKey_(person.phone)] = true;
      });
    } catch (error) {
      console.warn('Coaching lessons unavailable: ' + error);
    }
    var sent = [];
    Object.keys(senders).forEach(function (key) {
      if (sent.length >= VOICE_REPLIES_PER_RUN || done.keys.indexOf(key) >= 0) return;
      if ((senders[key].known && coaching[senders[key].senderKey]) || coaching[senders[key].phoneKey]) return;
      var messages = senders[key].messages.filter(function (entry) { return !VOICE_COMMAND_.test(entry.text); });
      var latest = messages[messages.length - 1];
      if (!latest || !voiceJoining_(latest.text)) return;
      var replyTo = String(latest.message.getReplyTo() || latest.message.getFrom() || '');
      if (!/@txt\.voice\.google\.com\b/i.test(replyTo)) return;
      var latestAt = latest.message.getDate().getTime();
      var replied = latest.message.getThread().getMessages().some(function (message) {
        return message.getDate().getTime() > latestAt && !/@txt\.voice\.google\.com\b/i.test(String(message.getFrom() || ''));
      });
      // Recorded before sending: a send that fails part way is never repeated, and a person is never texted twice.
      done.keys.push(key);
      properties.setProperty(VOICE_AUTO_REPLIED_KEY, JSON.stringify(done));
      if (replied) return;
      var player = senders[key].known ? exact(senders[key].senderKey) : null;
      latest.message.reply(player ? VOICE_LINKED_REPLY.replace('{name}', player.name) : VOICE_UNLINKED_REPLY);
      appendAudit_('voice_auto_reply', 'player', player ? player.playerId : '', { sessionDate: date, linked: !!player });
      sent.push(player ? 'linked' : 'unlinked');
    });
    return { sent: sent };
  } finally {
    lock.releaseLock();
  }
}

// A text that says the person is coming, and is not a question or a "can't make it".
function voiceJoining_(text) {
  return VOICE_JOINING_.test(text) && !VOICE_NOT_COMING_.test(text) && text.indexOf('?') < 0;
}

// Senders already answered today, as {date, keys}. A new day starts an empty list.
function voiceAnswered_(properties, date) {
  var done = null;
  try { done = JSON.parse(properties.getProperty(VOICE_AUTO_REPLIED_KEY) || 'null'); } catch (error) { done = null; }
  return done && done.date === date && Array.isArray(done.keys) ? done : { date: date, keys: [] };
}

// The one active player a Voice contact name means: their exact directory name or an alias of theirs. A name that is
// several players, or only part of a name, is no one here (the organizer can still pick from the suggestions).
function voiceExactMatcher_() {
  var players = listPlayers();
  var byKey = {};
  players.forEach(function (player) {
    var key = voiceNameKey_(player.name);
    (byKey[key] = byKey[key] || []).push(player);
  });
  var aliases = playerAliases_();
  Object.keys(aliases).forEach(function (alias) {
    var key = voiceNameKey_(alias);
    var player = players.filter(function (candidate) { return candidate.playerId === aliases[alias]; })[0];
    if (player && !byKey[key]) byKey[key] = [player];
  });
  return function (senderKey) {
    var matches = byKey[senderKey] || [];
    return matches.length === 1 ? matches[0] : null;
  };
}

// True when the club site lists date as a full closure. If the site cannot be read, the night is assumed open.
function voiceClubClosed_(date) {
  var cache = CacheService.getScriptCache();
  var days = null;
  try { days = JSON.parse(cache.get('voice-closures') || 'null'); } catch (error) { days = null; }
  if (!days) {
    try {
      var response = UrlFetchApp.fetch(VOICE_CLOSURES_URL, { muteHttpExceptions: true });
      days = response.getResponseCode() === 200 ? (JSON.parse(response.getContentText()).days || {}) : {};
      cache.put('voice-closures', JSON.stringify(days), 3600);
    } catch (error) {
      days = {};
    }
  }
  return days[date] === 'full';
}

// Owner only, from the editor or the desk: turns automatic answers on, with the minute trigger.
function enableVoiceAutoReply() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === VOICE_AUTO_REPLY_HANDLER) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger(VOICE_AUTO_REPLY_HANDLER).timeBased().everyMinutes(1).create();
  PropertiesService.getScriptProperties().setProperty(VOICE_AUTO_REPLY_KEY, 'on');
  appendAudit_('voice_auto_reply_enabled', 'database', VOICE_AUTO_REPLY_HANDLER, { everyMinutes: 1 });
  return voiceAutoReplyStatus();
}

function disableVoiceAutoReply() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === VOICE_AUTO_REPLY_HANDLER) ScriptApp.deleteTrigger(trigger);
  });
  PropertiesService.getScriptProperties().setProperty(VOICE_AUTO_REPLY_KEY, 'off');
  appendAudit_('voice_auto_reply_disabled', 'database', VOICE_AUTO_REPLY_HANDLER, {});
  return voiceAutoReplyStatus();
}

function voiceAutoReplyStatus() {
  return {
    on: PropertiesService.getScriptProperties().getProperty(VOICE_AUTO_REPLY_KEY) === 'on',
    triggers: ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getHandlerFunction() === VOICE_AUTO_REPLY_HANDLER; }).length
  };
}
