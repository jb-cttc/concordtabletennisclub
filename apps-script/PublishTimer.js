// Publishing to the club site. A finalized session is held for 15 minutes (a window to reopen and fix it),
// then the desk asks GitHub to run the "Update Data and Deploy" workflow. "Publish now" skips the wait.
// The GitHub token lives only in the script property CTTC_GITHUB_TOKEN and is never sent to the page.
var PUBLISH_HOLD_MS = 15 * 60 * 1000;
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

function clearPublish_() {
  PropertiesService.getScriptProperties().deleteProperty(PUBLISH_PENDING_KEY);
  deletePublishTriggers_();
}

// Called right after a session is finalized.
function schedulePublish_(sessionId, sessionDate) {
  var pending = { sessionId: String(sessionId), sessionDate: String(sessionDate), dueAt: Date.now() + PUBLISH_HOLD_MS, state: 'pending', message: '' };
  savePending_(pending);
  deletePublishTriggers_();
  try {
    // Backup for a closed desk tab; the open tab normally starts publishing the moment the timer ends.
    ScriptApp.newTrigger(PUBLISH_TIMER_HANDLER).timeBased().after(PUBLISH_HOLD_MS + 60000).create();
  } catch (error) { /* the open desk tab and the workflow's own fallback schedule still cover it */ }
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
  return Object.assign({ state: pending.state, sessionId: pending.sessionId, sessionDate: pending.sessionDate, dueAt: pending.dueAt, message: pending.message || '' }, base);
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

function dispatchPublish_() {
  var token = githubToken_();
  if (!token) throw new Error('Publishing is not connected yet (no GitHub token).');
  var response = UrlFetchApp.fetch('https://api.github.com/repos/' + PUBLISH_REPO + '/actions/workflows/' + PUBLISH_WORKFLOW + '/dispatches', {
    method: 'post',
    contentType: 'application/json',
    headers: githubHeaders_(token),
    payload: JSON.stringify({ ref: 'main' }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 204) throw new Error(githubErrorMessage_(response.getResponseCode()));
}

// Starts publishing now (the "Publish now" button, or the timer running out). Safe to call twice.
function publishNow(sessionId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    sessionId = String(sessionId);
    var pending = pendingPublish_();
    if (!pending || pending.sessionId !== sessionId) throw new Error('Nothing is waiting to be published for this session.');
    var session = findRow_('Sessions', 'session_id', sessionId);
    if (!session || String(session.status) !== 'finalized') {
      clearPublish_();
      throw new Error('Only a finalized session can be published.');
    }
    if (pending.state === 'dispatched' || pending.state === 'published') return publishStatePayload_(pending);
    try {
      dispatchPublish_();
      pending.state = 'dispatched';
      pending.message = '';
      pending.dispatchedAt = Date.now();
      appendAudit_('publish_dispatched', 'session', sessionId, {});
    } catch (error) {
      pending.state = 'failed';
      pending.message = error.message + ' It will be published by the next scheduled run.';
      appendAudit_('publish_failed', 'session', sessionId, { message: error.message });
    }
    savePending_(pending);
    deletePublishTriggers_();
    return publishStatePayload_(pending);
  } finally {
    lock.releaseLock();
  }
}

// Called by the desk page and the backup trigger.
function publishDue() {
  var pending = pendingPublish_();
  if (pending && pending.state === 'pending' && Date.now() >= pending.dueAt) return publishNow(pending.sessionId);
  return getPublishState();
}

function getPublishState() {
  var pending = pendingPublish_();
  if (pending && pending.state === 'dispatched') {
    try {
      if (sessionOnSite_(pending.sessionDate)) {
        pending.state = 'published';
        savePending_(pending);
      }
    } catch (error) { /* keep waiting; the next check tries again */ }
  }
  return publishStatePayload_(pending);
}

// Owner check from the script editor: confirms the token can see the workflow without starting it.
function checkPublishSetup() {
  var token = githubToken_();
  if (!token) return { ok: false, message: 'No GitHub token is set (script property ' + PUBLISH_TOKEN_KEY + ').' };
  var response = UrlFetchApp.fetch('https://api.github.com/repos/' + PUBLISH_REPO + '/actions/workflows/' + PUBLISH_WORKFLOW, { headers: githubHeaders_(token), muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return { ok: false, message: githubErrorMessage_(response.getResponseCode()) };
  var workflow = JSON.parse(response.getContentText());
  return { ok: workflow.state === 'active', message: 'Connected to "' + workflow.name + '" (' + workflow.state + '). Running it also needs the Actions: Read and write permission.' };
}
