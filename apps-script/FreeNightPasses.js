// The volunteer app cannot work out Zeffy passes (they come from the club's Zeffy emails, which the desk reads), so the
// desk copies who holds one on each special night still ahead to the hidden FreeNightPasses tab (date, player_id), which
// the volunteer app reads to pass them over too. Run by the mail job once an hour (a quiet run is one cache read) and at
// once when a pass is changed on the desk (force). Writes only when the list changed. Never throws.
var FREE_PASS_TAB_ = 'FreeNightPasses';
var FREE_PASS_EVERY_SECONDS_ = 3600;

function publishFreeNightPasses_(force) {
  var cache = CacheService.getScriptCache();
  if (!force && cache.get('free-passes-checked')) return null;
  cache.put('free-passes-checked', '1', FREE_PASS_EVERY_SECONDS_);
  try {
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var last = SPECIAL_NIGHTS.reduce(function (end, special) { return special.to > end ? special.to : end; }, '');
    var values = [['date', 'player_id']];
    if (last >= today) {
      var passesOn = zeffyPassFinder_();
      for (var date = today; date <= last; date = zeffyDaysLater_(date, 1)) {
        if (!specialNight_(date)) continue;
        Object.keys(passesOn(date)).sort().forEach(function (playerId) { values.push([date, playerId]); });
      }
    }
    var spreadsheet = SpreadsheetApp.getActive();
    var sheet = spreadsheet.getSheetByName(FREE_PASS_TAB_);
    var current = sheet && sheet.getLastRow() >= 1 ? sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues().map(function (line) { return String(line[0]) + ' ' + String(line[1]); }) : [];
    if (current.join('\n') === values.map(function (line) { return line[0] + ' ' + line[1]; }).join('\n')) return { unchanged: values.length - 1 };
    if (!sheet) {
      sheet = spreadsheet.insertSheet(FREE_PASS_TAB_);
      sheet.hideSheet();
    }
    sheet.clearContents();
    sheet.getRange(1, 1, values.length, 2).setNumberFormat('@').setValues(values);
    deskLog_('step', 'free_night_passes_changed', '', '', (values.length - 1) + ' Zeffy pass nights passed over for free volunteer spots');
    return { changed: values.length - 1 };
  } catch (error) {
    console.warn('Free night passes not updated: ' + error);
    return { skipped: 'error' };
  }
}
