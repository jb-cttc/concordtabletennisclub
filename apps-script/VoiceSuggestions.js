var VOICE_CONFIRMATION_ = 'Confirmed.';
var VOICE_FOOTER_ = /^(To respond to this text message|YOUR ACCOUNT|HELP CENTER|HELP FORUM|Google LLC)/i;

function voiceNameKey_(value) {
  var name = normalizeName_(value);
  var comma = name.match(/^([^,]+),\s*(.+)$/);
  return (comma ? comma[2] + ' ' + comma[1] : name).toLowerCase();
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
      var sender = senders[text.senderKey] || (senders[text.senderKey] = { senderName: text.senderName, senderKey: text.senderKey, known: text.known, messages: [] });
      sender.messages.push({ text: text.text, receivedAt: text.receivedAt, message: message });
    });
  });
  Object.keys(senders).forEach(function (key) {
    senders[key].messages.sort(function (left, right) { return left.receivedAt - right.receivedAt; });
  });
  return senders;
}

function listVoiceSuggestions(sessionDate) {
  validateSessionDate_(sessionDate);
  var players = listPlayers();
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
  var senders = voiceSenders_(sessionDate);
  return Object.keys(senders).map(function (key) {
    var sender = senders[key];
    return {
      senderName: sender.senderName,
      senderKey: sender.known ? sender.senderKey : '',
      playerIds: voiceCandidates_(sender, players, byName, links),
      messages: sender.messages.slice(-10).map(function (entry) { return { text: entry.text, receivedAt: entry.receivedAt }; })
    };
  }).sort(function (left, right) {
    return right.messages[right.messages.length - 1].receivedAt - left.messages[left.messages.length - 1].receivedAt;
  });
}

// Replies "Confirmed." to the sender's latest text from that date; Voice turns the email reply into an SMS.
function sendVoiceConfirmation(sessionDate, senderKey, playerId) {
  validateSessionDate_(sessionDate);
  senderKey = String(senderKey || '');
  if (!senderKey || senderKey.indexOf('phone:') === 0) throw new Error('This sender has no saved contact name to reply to.');
  var lock = LockService.getScriptLock();
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
