var VOICE_CONFIRMATION_ = 'Confirmed.';
var VOICE_FOOTER_ = /^(To respond to this text message|YOUR ACCOUNT|HELP CENTER|HELP FORUM|Google LLC)/i;

function voiceNameKey_(value) {
  var name = normalizeName_(value);
  var comma = name.match(/^([^,]+),\s*(.+)$/);
  return (comma ? comma[2] + ' ' + comma[1] : name).toLowerCase().replace(/[()\[\]"\u201c\u201d]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Texts that are commands for the coaching app, not round robin signups.
var COACHING_COMMAND_ = /^(coach|student|stop)\b/i;

// ---- Validation: the ✓ in Voice signups, and who the desk answers automatically (VoiceAutoReply.js) ----
// A sender is validated when their latest text says they are coming and their Voice contact name is exactly one player.
var VOICE_JOINING_ = /\b(join|joining|come|coming|play|playing|rr|round robin|i'?m in|count me in|in tonight|sign me up|add me|save (me )?a spot|hold (me )?a spot|running late|on my way|omw|be there|see you)\b/i;
var VOICE_NOT_COMING_ = /\b(can'?t|cannot|can not|won'?t|not (coming|going|gonna|able|make|making|playing)|unable|skip(ping)?|cancel(l?ed|ling)?|out tonight)\b/i;
// Commands and answers for the coaching and volunteer apps.
var VOICE_COMMAND_ = /^\s*(coach|student|stop|staff|confirm|release|yes|no)\b/i;

// A text that says the person is coming, and is not a question or a "can't make it".
function voiceJoining_(text) {
  return VOICE_JOINING_.test(text) && !VOICE_NOT_COMING_.test(text) && text.indexOf('?') < 0;
}

// The one active player a Voice contact name means: their exact directory name or an alias of theirs. A name that is
// several players, or only part of a name, is no one here (the organizer can still pick from the suggestions).
function voiceExactMatcher_(players) {
  players = players || listPlayers();
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

// What the desk makes of one sender ({known, senderKey, messages: [{text}]}): their latest text that is not a command for
// another app, the one player their contact name is (or null), whether that text says they are coming, and, when they are
// not validated, why, for the organizer.
function voiceValidation_(sender, exact) {
  var messages = sender.messages.filter(function (entry) { return !VOICE_COMMAND_.test(entry.text); });
  var latest = messages[messages.length - 1] || null;
  var player = sender.known ? exact(sender.senderKey) : null;
  var saysComing = !!latest && voiceJoining_(latest.text);
  var reasons = [];
  if (!saysComing) reasons.push(!latest ? 'No signup text' : VOICE_NOT_COMING_.test(latest.text) ? 'Latest text says they can\'t make it' : 'Latest text doesn\'t say they\'re coming');
  if (!player) reasons.push(!sender.known ? 'No saved contact name for this number' : 'Contact name isn\'t exactly one player');
  return { latest: latest, player: player, saysComing: saysComing, validated: saysComing && !!player, check: reasons.join('. ') };
}

function voiceForwardedText_(message) {
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
  for (var i = 0; i < lines.length; i += 1) {
    if (VOICE_FOOTER_.test(lines[i])) break;
    if (!lines[i] || /^<https:\/\/voice\.google\.com[^>]*>$/.test(lines[i])) continue;
    body.push(lines[i]);
  }
  if (!body.length) return null;
  return {
    senderName: name || (digits ? 'Unknown number ending ' + digits.slice(-4) : 'Unknown sender'),
    senderKey: name ? voiceNameKey_(name) : 'phone:' + digits,
    phoneKey: coachingPhoneKey_(digits),
    known: !!name,
    text: body.join('\n').slice(0, 500),
    receivedAt: message.getDate().getTime()
  };
}

function voiceCandidates_(sender, players, byName, links) {
  if (!sender.known) return [];
  var ids = (byName[sender.senderKey] || []).slice();
  if (!ids.length) {
    var tokens = sender.senderKey.split(' ');
    ids = players.filter(function (player) {
      var parts = voiceNameKey_(player.name).split(' ');
      return tokens.every(function (token) { return parts.some(function (part) { return part.indexOf(token) === 0; }); });
    }).slice(0, 6).map(function (player) { return player.playerId; });
  }
  links.forEach(function (link) {
    var left = ids.indexOf(link.left.playerId);
    var right = ids.indexOf(link.right.playerId);
    if (right >= 0 && left < 0) ids.splice(right, 0, link.left.playerId);
    else if (left >= 0 && right < 0) ids.splice(left + 1, 0, link.right.playerId);
  });
  return ids;
}

// Forwarded Voice texts received on sessionDate, grouped by sender and sorted oldest to newest.
function voiceSenders_(sessionDate) {
  var day = new Date(sessionDate + 'T12:00:00Z');
  var after = new Date(day.getTime() - 86400000).toISOString().slice(0, 10).replace(/-/g, '/');
  var before = new Date(day.getTime() + 172800000).toISOString().slice(0, 10).replace(/-/g, '/');
  var threads = GmailApp.search('in:anywhere from:txt.voice.google.com after:' + after + ' before:' + before, 0, 101);
  if (threads.length > 100) throw new Error('Too many forwarded texts to check safely');
  var senders = {};
  var seen = {};
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      if (seen[message.getId()]) return;
      seen[message.getId()] = true;
      if (Utilities.formatDate(message.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd') !== sessionDate) return;
      var text = voiceForwardedText_(message);
      if (!text) return;
      var sender = senders[text.senderKey] || (senders[text.senderKey] = { senderName: text.senderName, senderKey: text.senderKey, phoneKey: text.phoneKey, known: text.known, messages: [] });
      sender.messages.push({ text: text.text, receivedAt: text.receivedAt, message: message });
    });
  });
  Object.keys(senders).forEach(function (key) {
    senders[key].messages.sort(function (left, right) { return left.receivedAt - right.receivedAt; });
  });
  return senders;
}

function voiceMatcher_(players) {
  players = players || listPlayers();
  var byName = {};
  players.forEach(function (player) {
    var key = voiceNameKey_(player.name);
    (byName[key] || (byName[key] = [])).push(player.playerId);
  });
  var links = confirmedNameLinks_(players).resolved;
  var aliases = playerAliases_();
  Object.keys(aliases).forEach(function (alias) {
    var key = voiceNameKey_(alias);
    if (!byName[key] && players.some(function (player) { return player.playerId === aliases[alias]; })) byName[key] = [aliases[alias]];
  });
  return function (sender) { return voiceCandidates_(sender, players, byName, links); };
}

// Leaves out coaching-app commands and anyone with a confirmed lesson that day: they come for coaching, not the round robin.
function listVoiceSuggestions(sessionDate) {
  validateSessionDate_(sessionDate);
  var players = listPlayers();
  var match = voiceMatcher_(players);
  var exact = voiceExactMatcher_(players);
  var coaching = {};
  try {
    coachingLessons_(sessionDate).forEach(function (person) {
      coaching[voiceNameKey_(person.name)] = true;
      if (coachingPhoneKey_(person.phone)) coaching[coachingPhoneKey_(person.phone)] = true;
    });
  } catch (error) {
    console.warn('Coaching lessons unavailable: ' + error);
  }
  var senders = voiceSenders_(sessionDate);
  return Object.keys(senders).map(function (key) {
    var sender = senders[key];
    if ((sender.known && coaching[sender.senderKey]) || coaching[sender.phoneKey]) return null;
    var messages = sender.messages.filter(function (entry) { return !COACHING_COMMAND_.test(entry.text); });
    if (!messages.length) return null;
    var check = voiceValidation_(sender, exact);
    return {
      senderName: sender.senderName,
      senderKey: sender.known ? sender.senderKey : '',
      playerIds: match(sender),
      linkedPlayerId: check.player ? check.player.playerId : '',
      validated: check.validated,
      check: check.check,
      messages: messages.slice(-10).map(function (entry) { return { text: entry.text, receivedAt: entry.receivedAt }; })
    };
  }).filter(Boolean).sort(function (left, right) {
    return right.messages[right.messages.length - 1].receivedAt - left.messages[left.messages.length - 1].receivedAt;
  });
}

// Replies "Confirmed." to the sender's latest text from that date; Voice turns the email reply into an SMS.
// Gmail is slow and this touches no desk table, so it takes the document lock (one reply at a time) rather than the
// script lock that score saves wait on.
function sendVoiceConfirmation(sessionDate, senderKey, playerId) {
  validateSessionDate_(sessionDate);
  senderKey = String(senderKey || '');
  if (!senderKey || senderKey.indexOf('phone:') === 0) throw new Error('This sender has no saved contact name to reply to.');
  var lock = LockService.getDocumentLock() || LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sender = voiceSenders_(sessionDate)[senderKey];
    if (!sender) throw new Error('No text from this person was found for this date.');
    var latest = sender.messages[sender.messages.length - 1].message;
    var replyTo = String(latest.getReplyTo() || latest.getFrom() || '');
    if (!/@txt\.voice\.google\.com\b/i.test(replyTo)) throw new Error('The text did not come with a Google Voice reply address.');
    var latestAt = latest.getDate().getTime();
    var replied = latest.getThread().getMessages().some(function (message) {
      return message.getDate().getTime() > latestAt && !/@txt\.voice\.google\.com\b/i.test(String(message.getFrom() || ''));
    });
    if (replied) return { sent: false, reason: 'Already replied to the latest text.' };
    latest.reply(VOICE_CONFIRMATION_);
    appendAudit_('voice_confirmation_sent', 'player', String(playerId || ''), { sessionDate: sessionDate });
    return { sent: true, reason: '' };
  } finally {
    lock.releaseLock();
  }
}
