// Publishing to the club site, then emailing the results. Two holds of 15 minutes each:
//   1. After a session is finalized: a window to reopen and fix it, then the desk asks GitHub to run the
//      "Update Data and Deploy" workflow (publishes the site). "Publish now" skips the wait.
//   2. After the club site lists the session: a window before the results email goes to the distribution
//      list (the workflow is run again with send_email=true). "Send now" skips the wait.
// The GitHub token lives only in the script property CTTC_GITHUB_TOKEN and is never sent to the page.
var PUBLISH_HOLD_MS = 15 * 60 * 1000;
var EMAIL_HOLD_MS = 15 * 60 * 1000;
var PUBLISH_CHECK_MS = 3 * 60 * 1000;
var PUBLISH_PENDING_KEY = 'CTTC_PENDING_PUBLISH';
var PUBLISH_TOKEN_KEY = 'CTTC_GITHUB_TOKEN';
var PUBLISH_REPO = 'jb-cttc/concordtabletennisclub';
var PUBLISH_WORKFLOW = 'update-data.yml';
var PUBLISH_TIMER_HANDLER = 'publishDue';

function githubToken_() {
  return PropertiesService.getScriptProperties().getProperty(PUBLISH_TOKEN_KEY) || '';
}

function pendingPublish_() {
  var raw = PropertiesService.getScriptProperties().getProperty(PUBLISH_PENDING_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (error) { return null; }
}

function savePending_(pending) {
  PropertiesService.getScriptProperties().setProperty(PUBLISH_PENDING_KEY, JSON.stringify(pending));
}

function deletePublishTriggers_() {
  try {
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === PUBLISH_TIMER_HANDLER) ScriptApp.deleteTrigger(trigger);
    });
  } catch (error) { /* triggers are a backup only */ }
}

// Backup for a closed desk tab: the open tab normally does all of this itself, second by second.
function armBackup_(delayMs) {
  deletePublishTriggers_();
  try {
    ScriptApp.newTrigger(PUBLISH_TIMER_HANDLER).timeBased().after(Math.max(60000, delayMs)).create();
  } catch (error) { /* the workflow's own fallback schedule still covers it */ }
}

function clearPublish_() {
  PropertiesService.getScriptProperties().deleteProperty(PUBLISH_PENDING_KEY);
  deletePublishTriggers_();
}

// Called right after a session is finalized.
function schedulePublish_(sessionId, sessionDate) {
  var pending = { sessionId: String(sessionId), sessionDate: String(sessionDate), dueAt: Date.now() + PUBLISH_HOLD_MS, state: 'pending', message: '' };
  savePending_(pending);
  armBackup_(PUBLISH_HOLD_MS + 60000);
  appendAudit_('publish_scheduled', 'session', pending.sessionId, { dueAt: pending.dueAt });
}

// Called when a session is reopened: nothing should publish a session that is being corrected.
function cancelPublish_(sessionId) {
  var pending = pendingPublish_();
  if (pending && pending.sessionId === String(sessionId)) {
    clearPublish_();
    appendAudit_('publish_cancelled', 'session', String(sessionId), {});
  }
}

function publishStatePayload_(pending) {
  var base = { now: Date.now(), tokenSet: !!githubToken_(), holdMinutes: PUBLISH_HOLD_MS / 60000 };
  if (!pending) return Object.assign({ state: 'none' }, base);
  return Object.assign({
    state: pending.state,
    sessionId: pending.sessionId,
    sessionDate: pending.sessionDate,
    dueAt: pending.dueAt,
    emailDueAt: pending.emailDueAt || null,
    message: pending.message || ''
  }, base);
}

function githubHeaders_(token) {
  return { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

function githubErrorMessage_(code) {
  if (code === 401) return 'GitHub rejected the token (expired or wrong).';
  if (code === 403) return 'The GitHub token does not have permission to run workflows (needs Actions: Read and write).';
  if (code === 404) return 'GitHub could not find the publishing workflow (does the token have access to ' + PUBLISH_REPO + '?).';
  if (code === 422) return 'The publishing workflow cannot be started by hand.';
  return 'GitHub returned HTTP ' + code + '.';
}

function workflowUrl_() {
  return 'https://api.github.com/repos/' + PUBLISH_REPO + '/actions/workflows/' + PUBLISH_WORKFLOW;
}

// Starts the workflow. The email step only runs when send_email is 'true' (or on the fallback schedule).
function dispatchWorkflow_(sendEmail) {
  var token = githubToken_();
  if (!token) throw new Error('Publishing is not connected yet (no GitHub token).');
  var payload = sendEmail ? { ref: 'main', inputs: { send_email: 'true' } } : { ref: 'main' };
  var response = UrlFetchApp.fetch(workflowUrl_() + '/dispatches', {
    method: 'post',
    contentType: 'application/json',
    headers: githubHeaders_(token),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 204) throw new Error(githubErrorMessage_(response.getResponseCode()));
}

function requirePending_(sessionId) {
  sessionId = String(sessionId);
  var pending = pendingPublish_();
  if (!pending || pending.sessionId !== sessionId) throw new Error('Nothing is waiting to be published for this session.');
  var session = findRow_('Sessions', 'session_id', sessionId);
  if (!session || String(session.status) !== 'finalized') {
    clearPublish_();
    throw new Error('Only a finalized session can be published.');
  }
  return pending;
}

// Starts publishing now (the "Publish now" button, or the timer running out). Safe to call twice.
function publishNow(sessionId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var pending = requirePending_(sessionId);
    if (pending.state !== 'pending' && pending.state !== 'failed') return publishStatePayload_(pending);
    try {
      dispatchWorkflow_(false);
      pending.state = 'dispatched';
      pending.message = '';
      pending.dispatchedAt = Date.now();
      appendAudit_('publish_dispatched', 'session', pending.sessionId, {});
      armBackup_(PUBLISH_CHECK_MS);
    } catch (error) {
      pending.state = 'failed';
      pending.message = error.message + ' It will be published by the next scheduled run.';
      appendAudit_('publish_failed', 'session', pending.sessionId, { message: error.message });
      deletePublishTriggers_();
    }
    savePending_(pending);
    return publishStatePayload_(pending);
  } finally {
    lock.releaseLock();
  }
}

// Sends the results email now (the "Send now" button, or the second timer running out). Safe to call twice.
function sendEmailNow(sessionId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var pending = requirePending_(sessionId);
    if (pending.state !== 'email_pending' && pending.state !== 'email_failed') return publishStatePayload_(pending);
    try {
      dispatchWorkflow_(true);
      pending.state = 'email_dispatched';
      pending.message = '';
      pending.emailDispatchedAt = Date.now();
      appendAudit_('email_dispatched', 'session', pending.sessionId, {});
      armBackup_(PUBLISH_CHECK_MS);
    } catch (error) {
      pending.state = 'email_failed';
      pending.message = error.message + ' The scheduled run will send it.';
      appendAudit_('email_failed', 'session', pending.sessionId, { message: error.message });
      deletePublishTriggers_();
    }
    savePending_(pending);
    return publishStatePayload_(pending);
  } finally {
    lock.releaseLock();
  }
}

// Did the workflow runs started after `sinceMs` finish, and how?
function workflowRunOutcome_(sinceMs) {
  var token = githubToken_();
  if (!token) return 'unknown';
  var response = UrlFetchApp.fetch(workflowUrl_() + '/runs?event=workflow_dispatch&per_page=10', { headers: githubHeaders_(token), muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return 'unknown';
  var runs = (JSON.parse(response.getContentText()).workflow_runs || []).filter(function (run) { return Date.parse(run.created_at) >= sinceMs - 5000; });
  if (!runs.length) return 'waiting';
  if (runs.some(function (run) { return run.status !== 'completed'; })) return 'waiting';
  return runs.every(function (run) { return run.conclusion === 'success'; }) ? 'success' : 'failure';
}

// Moves a started publish or email forward when its result can be seen. Called by the page and the backup trigger.
function advancePublish_(pending) {
  if (pending.state === 'dispatched') {
    try {
      if (sessionOnSite_(pending.sessionDate)) {
        pending.state = 'email_pending';
        pending.emailDueAt = Date.now() + EMAIL_HOLD_MS;
        savePending_(pending);
        armBackup_(EMAIL_HOLD_MS + 60000);
        appendAudit_('publish_confirmed', 'session', pending.sessionId, { emailDueAt: pending.emailDueAt });
      }
    } catch (error) { /* keep waiting; the next check tries again */ }
  } else if (pending.state === 'email_dispatched') {
    var outcome;
    try { outcome = workflowRunOutcome_(pending.emailDispatchedAt); } catch (error) { outcome = 'unknown'; }
    if (outcome === 'success') {
      pending.state = 'emailed';
      savePending_(pending);
      deletePublishTriggers_();
    } else if (outcome === 'failure') {
      pending.state = 'email_failed';
      pending.message = 'The email step did not finish successfully. Check the GitHub Actions run, or use Try again.';
      savePending_(pending);
      deletePublishTriggers_();
    }
  }
  return pending;
}

function getPublishState() {
  var pending = pendingPublish_();
  if (pending) pending = advancePublish_(pending);
  return publishStatePayload_(pending);
}

// Called by the desk page when a timer runs out and by the backup trigger: starts whatever is due, then
// re-arms the trigger while a started publish or email is still being checked.
function publishDue() {
  var pending = pendingPublish_();
  if (!pending) return getPublishState();
  var now = Date.now();
  if (pending.state === 'pending' && now >= pending.dueAt) return publishNow(pending.sessionId);
  if (pending.state === 'email_pending' && now >= pending.emailDueAt) return sendEmailNow(pending.sessionId);
  var state = getPublishState();
  var after = pendingPublish_();
  if (after && (after.state === 'dispatched' || after.state === 'email_dispatched')) armBackup_(PUBLISH_CHECK_MS);
  if (after && after.state === 'email_pending' && now < after.emailDueAt) armBackup_(after.emailDueAt - now + 60000);
  return state;
}

// Owner check from the script editor: confirms the token can see the workflow without starting it.
function checkPublishSetup() {
  var token = githubToken_();
  if (!token) return { ok: false, message: 'No GitHub token is set (script property ' + PUBLISH_TOKEN_KEY + ').' };
  var response = UrlFetchApp.fetch(workflowUrl_(), { headers: githubHeaders_(token), muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return { ok: false, message: githubErrorMessage_(response.getResponseCode()) };
  var workflow = JSON.parse(response.getContentText());
  return { ok: workflow.state === 'active', message: 'Connected to "' + workflow.name + '" (' + workflow.state + '). Running it also needs the Actions: Read and write permission.' };
}
