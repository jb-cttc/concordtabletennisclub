// Automatic answers to round robin texts (GitHub PR #75). On a round robin day, until sign-up closes, a minute trigger reads
// the day's forwarded Voice texts (VoiceSuggestions.js) and answers each person once:
//   - a contact name that is exactly one desk player (or an alias of one): VOICE_LINKED_REPLY with their directory name;
//   - anyone else (a number with no contact name, a name that is no one or several people): VOICE_UNLINKED_REPLY.
// Linked and "says they are coming" are the same checks as the ✓ in Voice signups (voiceValidation_ in VoiceSuggestions.js).
// Questions, "can't make it", commands for the coaching and volunteer apps, and anyone with a coaching lesson that day are
// left for a person. The organizer still adds people to the round robin from Voice signups; a reply already in the thread
// stops the desk's own "Confirmed." from being sent twice.
//
// Off until the owner runs enableVoiceAutoReply(): a trigger runs whatever code was pushed last, including a /dev preview,
// so it must never start texting members by itself. disableVoiceAutoReply() turns it off again.
var VOICE_AUTO_REPLY_KEY = 'CTTC_VOICE_AUTO_REPLY';
var VOICE_AUTO_REPLIED_KEY = 'CTTC_VOICE_AUTO_REPLIED';
var VOICE_AUTO_REPLY_HANDLER = 'answerVoiceSignups';
var VOICE_LINKED_REPLY = 'Received - you\'re on the list, {name}! See you {when}.';
var VOICE_UNLINKED_REPLY = 'We\'re glad to have you! This number isn\'t linked to anyone in our club directory yet. Reply with your name and we\'ll add you.';
// Round robin days (0 is Sunday), from 6 AM until sign-up closes, Pacific: 7:15 PM on Monday and Wednesday nights, 3:15 PM
// for the Saturday afternoon pilot (from October 31, 2026), whose linked answer says "today". The same days and times as
// the Tonight page (NIGHTS in turnout.js). A text before 6 AM is answered at 6.
var VOICE_REPLY_DAYS = {
  1: { until: 19 * 60 + 15, when: 'tonight' },
  3: { until: 19 * 60 + 15, when: 'tonight' },
  6: { until: 15 * 60 + 15, when: 'today', from: '2026-10-31' }
};
var VOICE_REPLY_FROM = 6 * 60;
var VOICE_REPLIES_PER_RUN = 20;
var VOICE_CLOSURES_URL = 'https://concordtabletennisclub.com/data/closures.json';

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
  var day = VOICE_REPLY_DAYS[new Date(date + 'T12:00:00Z').getUTCDay()];
  if (!day || (day.from && date < day.from) || minutes < VOICE_REPLY_FROM || minutes >= day.until) return { skipped: 'not now' };
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
      var check = voiceValidation_(senders[key], exact);
      var latest = check.latest;
      if (!latest || !check.saysComing) return;
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
      var player = check.player;
      latest.message.reply(player ? VOICE_LINKED_REPLY.replace('{name}', player.name).replace('{when}', day.when) : VOICE_UNLINKED_REPLY);
      appendAudit_('voice_auto_reply', 'player', player ? player.playerId : '', { sessionDate: date, linked: !!player });
      sent.push(player ? 'linked' : 'unlinked');
    });
    return { sent: sent };
  } finally {
    lock.releaseLock();
  }
}

// Senders already answered today, as {date, keys}. A new day starts an empty list.
function voiceAnswered_(properties, date) {
  var done = null;
  try { done = JSON.parse(properties.getProperty(VOICE_AUTO_REPLIED_KEY) || 'null'); } catch (error) { done = null; }
  return done && done.date === date && Array.isArray(done.keys) ? done : { date: date, keys: [] };
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
