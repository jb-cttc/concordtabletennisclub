// Session ids: a round robin is session-YYYY-MM-DD; an Equalizer on the same date is session-YYYY-MM-DD-equalizer, so
// both can run on one day. Money and attendance (SessionPayments, OpenPlay, FirstVisits) stay keyed by the day,
// session-YYYY-MM-DD, whichever event a player plays. Anything that finds a night's players uses sessionDateOf_.
var EQUALIZER_SUFFIX = '-equalizer';
function sessionDateOf_(sessionId) {
  var match = /^session-(\d{4}-\d{2}-\d{2})(?:-equalizer)?$/.exec(String(sessionId));
  return match ? match[1] : '';
}
function isEqualizerSessionId_(sessionId) {
  return /^session-\d{4}-\d{2}-\d{2}-equalizer$/.test(String(sessionId));
}
function equalizerSessionId_(sessionDate) {
  return 'session-' + sessionDate + EQUALIZER_SUFFIX;
}

// Follow mode (a second computer showing the Player board, PlayerBoard.html): a tiny change stamp per night and area
// in the script cache, set by the saves the desk already makes. A following desk asks getDeskStamps every 10 seconds,
// a cache read with no Sheet, Gmail or settings reads, and reads the night itself only for the area that changed:
// s (groups, scores, the print mark, names), p (payments, Zeffy passes, first visits), e (the Equalizer). The cache
// keeps a stamp up to 6 hours; one lost or unreadable makes the follower read that area once.
var DESK_STAMP_AREAS_ = ['s', 'p', 'e'];
function deskStampKey_(sessionDate, area) { return 'desk-stamp:' + sessionDate + ':' + area; }
function touchDesk_(area, sessionDate) {
  try {
    var day = sessionDate || Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
    CacheService.getScriptCache().put(deskStampKey_(day, area), String(Date.now()), 21600);
  } catch (error) { /* a following desk falls back to reading the night once a minute */ }
}
// After a desk action on a session id: the round robin's or the Equalizer's area (a switch between them, both).
function touchDeskSession_(sessionId, both) {
  var day = sessionDateOf_(sessionId);
  if (!day) return;
  if (both || !isEqualizerSessionId_(sessionId)) touchDesk_('s', day);
  if (both || isEqualizerSessionId_(sessionId)) touchDesk_('e', day);
}
// A following desk's usage, every 30 minutes and when it stops, as a desk log step (not a problem).
function logFollowMode(sessionDate, stats) {
  validateSessionDate_(sessionDate);
  stats = stats || {};
  var clean = {};
  ['minutes', 'checks', 'reads', 'stamplessReads'].forEach(function (key) { clean[key] = Math.max(0, Math.round(Number(stats[key]) || 0)); });
  clean.status = /^(on|stopped|finalized|timed out)$/.test(String(stats.status)) ? String(stats.status) : 'on';
  appendAudit_('follow_mode', 'session', 'session-' + sessionDate, clean);
  return true;
}
// null when the cache cannot be read: the follower then reads the night once a minute instead.
function getDeskStamps(sessionDate) {
  validateSessionDate_(sessionDate);
  var keys = DESK_STAMP_AREAS_.map(function (area) { return deskStampKey_(sessionDate, area); });
  var found;
  try { found = CacheService.getScriptCache().getAll(keys) || {}; } catch (error) { return null; }
  var out = {};
  DESK_STAMP_AREAS_.forEach(function (area, i) { out[area] = found[keys[i]] || ''; });
  return out;
}
