// Scheduled-job run time (docs/google-limits.md). Google allows a free account 90 minutes a day of trigger run time,
// shared by every club app's timers (the desk here, and the coaching and staffing apps). A run that wakes up only to find
// nothing to do still counts, so every timer is measured: each app adds each timer run's time to its total for the day
// and copies that total to this Sheet's JobRuntime tab at most every RUNTIME_REPORT_MS_. The desk adds up every app's row:
// past RUNTIME_WARN_SECONDS_ the desk log warns (once a day), and past RUNTIME_SLOW_SECONDS_ every app runs its timers a
// third as often for the rest of the day. Each new day logs the day before, per app.
//
// Measured from when the code starts, so Google's own start-up time is not included: the real total is somewhat higher.
// Page calls (google.script.run) do not count toward the limit and are not measured; a timer passes an event with a
// triggerUid, a page call does not.
var RUNTIME_TAB = 'JobRuntime';
var RUNTIME_HEADERS = ['app', 'day', 'runs', 'seconds', 'updated_at'];
var RUNTIME_KEY_ = 'CTTC_JOB_RUNTIME';
var RUNTIME_REPORT_MS_ = 30 * 60000;
var RUNTIME_WARN_SECONDS_ = 45 * 60;
var RUNTIME_SLOW_SECONDS_ = 60 * 60;
var RUNTIME_KEEP_DAYS_ = 14;

// Runs a timer's work and adds its time to the day's total. Page calls run the work unmeasured.
function timedJob_(event, work) {
  if (!(event && event.triggerUid)) return work();
  var started = Date.now();
  try {
    return work();
  } finally {
    addJobRuntime_(Date.now() - started);
  }
}

// True once every app's timers together passed RUNTIME_SLOW_SECONDS_ today: timers then run a third as often.
function jobsSlowed_() {
  var total = jobRuntimeToday_();
  return !!total.slow;
}

function jobRuntimeToday_() {
  var day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var total = null;
  try { total = JSON.parse(PropertiesService.getScriptProperties().getProperty(RUNTIME_KEY_) || 'null'); } catch (error) { total = null; }
  return total && total.day === day ? total : { day: day, runs: 0, ms: 0, reportedAt: 0, slow: false, warned: false, previous: total };
}

function addJobRuntime_(ms) {
  try {
    var total = jobRuntimeToday_();
    var previous = total.previous;
    delete total.previous;
    total.runs += 1;
    total.ms += ms;
    if (Date.now() - total.reportedAt >= RUNTIME_REPORT_MS_ || previous) {
      total.reportedAt = Date.now();
      reportJobRuntime_(total, previous);
    }
    PropertiesService.getScriptProperties().setProperty(RUNTIME_KEY_, JSON.stringify(total));
  } catch (error) {
    console.warn('Run time not recorded: ' + error);
  }
}

// Writes the desk's row, reads every app's rows for the day, and warns or slows down when the shared total is high.
// previous: yesterday's total, once, when a new day starts.
function reportJobRuntime_(total, previous) {
  var sheet = runtimeSheet_();
  if (previous && previous.day) writeRuntimeRow_(sheet, 'desk', previous);
  writeRuntimeRow_(sheet, 'desk', total);
  var rows = runtimeRows_(sheet);
  var seconds = rows.filter(function (row) { return row.day === total.day; }).reduce(function (sum, row) { return sum + row.seconds; }, 0);
  total.slow = seconds >= RUNTIME_SLOW_SECONDS_;
  if (seconds >= RUNTIME_WARN_SECONDS_ && !total.warned) {
    total.warned = true;
    deskLog_('warn', 'trigger_time_high', total.day, '', 'seconds=' + Math.round(seconds) + ' of 5400' + (total.slow ? ' timers slowed for the rest of the day' : ''));
  }
  if (previous && previous.day) {
    var day = rows.filter(function (row) { return row.day === previous.day; });
    deskLog_('step', 'job_runtime_day', previous.day, '', day.map(function (row) { return row.app + '=' + Math.round(row.seconds) + 's/' + row.runs; }).join(' ') +
      ' total=' + Math.round(day.reduce(function (sum, row) { return sum + row.seconds; }, 0)) + 's');
    var cutoff = Utilities.formatDate(new Date(Date.now() - RUNTIME_KEEP_DAYS_ * 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    for (var index = rows.length - 1; index >= 0; index -= 1) if (rows[index].day < cutoff) sheet.deleteRow(rows[index].row);
  }
}

function runtimeSheet_() {
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getSheetByName(RUNTIME_TAB);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(RUNTIME_TAB);
    sheet.getRange(1, 1, 1, RUNTIME_HEADERS.length).setValues([RUNTIME_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function runtimeRows_(sheet) {
  return sheet.getDataRange().getValues().slice(1).map(function (row, index) {
    return { row: index + 2, app: String(row[0]), day: String(row[1]), runs: Number(row[2]) || 0, seconds: Number(row[3]) || 0 };
  }).filter(function (row) { return row.app; });
}

// One row per app and day, rewritten in place; the leading ' keeps the date as text.
function writeRuntimeRow_(sheet, app, total) {
  var values = [app, "'" + total.day, total.runs, Math.round(total.ms / 100) / 10, new Date().toISOString()];
  var existing = runtimeRows_(sheet).filter(function (row) { return row.app === app && row.day === total.day; })[0];
  if (existing) sheet.getRange(existing.row, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);
}
