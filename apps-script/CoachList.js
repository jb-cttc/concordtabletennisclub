// Which coaches the coaching app offers. The club site's coaching page shows only USATT-certified coaches and the owner's
// exceptions; the site's data/coach-certifications.json marks every other coach "hidden" (scripts/check-usatt-coaches.js,
// run by the GitHub data update). The coaching app may not reach the web, but it reads this Sheet, so the desk copies the
// shown names here: the hidden CoachList tab, a 'shown_coach' heading and one name a row. The coaching app's hourly sweep
// switches club coaches on or off to match (coaching-app/Code.js syncClubCoaches_).
var COACH_LIST_URL_ = 'https://concordtabletennisclub.com/data/coach-certifications.json';
var COACH_LIST_TAB_ = 'CoachList';
var COACH_LIST_HEADER_ = 'shown_coach';
// One read of the site an hour at most: 24 web requests a day (docs/google-limits.md).
var COACH_LIST_EVERY_SECONDS_ = 3600;

// Run by the mail job after each read. A quiet run is one cache read. Returns null when not due, else what it did. Never
// throws: if the site or the file cannot be read, the tab keeps the last list it had.
function publishCoachList_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('coach-list-checked')) return null;
  cache.put('coach-list-checked', '1', COACH_LIST_EVERY_SECONDS_);
  try {
    var response = UrlFetchApp.fetch(COACH_LIST_URL_, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return { skipped: 'site returned ' + response.getResponseCode() };
    var names = shownCoachNames_(JSON.parse(response.getContentText()));
    if (!names) return { skipped: 'coach file unreadable' };
    var spreadsheet = SpreadsheetApp.getActive();
    var sheet = spreadsheet.getSheetByName(COACH_LIST_TAB_);
    var values = [[COACH_LIST_HEADER_]].concat(names.map(function (name) { return [name]; }));
    var current = sheet && sheet.getLastRow() >= 1 ? sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().map(function (line) { return String(line[0]); }) : [];
    if (current.join('\n') === values.map(function (line) { return line[0]; }).join('\n')) return { unchanged: names.length };
    if (!sheet) {
      sheet = spreadsheet.insertSheet(COACH_LIST_TAB_);
      sheet.hideSheet();
    }
    sheet.clearContents();
    sheet.getRange(1, 1, values.length, 1).setNumberFormat('@').setValues(values);
    deskLog_('step', 'coach_list_changed', '', '', names.length + ' coaches shown on the coaching page (was ' + Math.max(current.length - 1, 0) + ')');
    return { changed: names.length };
  } catch (error) {
    console.warn('Coach list not updated: ' + error);
    return { skipped: 'error' };
  }
}

// The names the coaching page shows, in page order, or null when the file does not look right (a broken file must never
// switch every coach off).
function shownCoachNames_(data) {
  var coaches = data && data.coaches;
  if (!coaches || typeof coaches !== 'object' || !Object.keys(coaches).length) return null;
  return Object.keys(coaches).filter(function (name) { return String(name).trim() && !(coaches[name] && coaches[name].hidden); });
}
