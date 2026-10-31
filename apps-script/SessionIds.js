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
