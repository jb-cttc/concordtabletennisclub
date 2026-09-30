const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'PublishTimer.js'), 'utf8');

let now = 1_000_000;
class MockDate extends Date { static now() { return now; } }
const props = {};
const triggers = [];
const requests = [];
const audits = [];
let nextResponse = { code: 204, body: '' };
let runs = [];
let onSite = false;
let sessionStatus = 'finalized';

const ctx = {
  Date: MockDate,
  PropertiesService: { getScriptProperties: () => ({
    getProperty: key => (key in props ? props[key] : null),
    setProperty: (key, value) => { props[key] = String(value); },
    deleteProperty: key => { delete props[key]; }
  }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ScriptApp: {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: trigger => { triggers.splice(triggers.indexOf(trigger), 1); },
    newTrigger: handler => ({ timeBased: () => ({ after: ms => ({ create: () => { triggers.push({ getHandlerFunction: () => handler, after: ms }); } }) }) })
  },
  UrlFetchApp: { fetch: (url, options) => {
    requests.push({ url, options: options || {} });
    if (url.includes('/runs?')) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ workflow_runs: runs }) };
    return { getResponseCode: () => nextResponse.code, getContentText: () => nextResponse.body };
  } },
  appendAudit_: (action, type, id, details) => { audits.push([action, id, details]); },
  findRow_: (sheet, key, value) => (value === 's1' ? { session_id: 's1', status: sessionStatus } : null),
  sessionOnSite_: () => { if (onSite === 'error') throw new Error('offline'); return onSite; }
};
vm.createContext(ctx);
vm.runInContext(source, ctx);
const reset = () => {
  Object.keys(props).forEach(key => delete props[key]);
  triggers.length = 0; requests.length = 0; audits.length = 0; runs = [];
  nextResponse = { code: 204, body: '' }; onSite = false; sessionStatus = 'finalized'; now = 1_000_000;
};
const plain = value => JSON.parse(JSON.stringify(value));
const dispatches = () => requests.filter(request => request.url.endsWith('/dispatches'));
const HOLD = 15 * 60 * 1000;
const TOKEN = 'ghp_secret_value';
const run = (createdMs, status, conclusion) => ({ created_at: new Date(createdMs).toISOString(), status, conclusion });

// Nothing scheduled.
assert.equal(ctx.getPublishState().state, 'none');

// Finalizing starts a 15-minute hold and a backup trigger.
ctx.schedulePublish_('s1', '2026-10-05');
let state = plain(ctx.getPublishState());
assert.deepEqual([state.state, state.sessionId, state.sessionDate, state.dueAt, state.holdMinutes], ['pending', 's1', '2026-10-05', now + HOLD, 15]);
assert.equal(triggers.length, 1);
assert.equal(triggers[0].getHandlerFunction(), 'publishDue');
assert.ok(triggers[0].after >= HOLD, 'the backup trigger fires after the hold');
assert.deepEqual(audits.map(entry => entry[0]), ['publish_scheduled']);

// The token is reported as present or absent, never shown.
assert.equal(state.tokenSet, false);
props.CTTC_GITHUB_TOKEN = TOKEN;
state = plain(ctx.getPublishState());
assert.equal(state.tokenSet, true);
assert.ok(!JSON.stringify(state).includes(TOKEN), 'the token never reaches the page');

// Before the timer ends nothing is sent.
now += HOLD - 1000;
assert.equal(ctx.publishDue().state, 'pending');
assert.equal(requests.length, 0);

// When the timer ends the workflow is started once, publish only, with the token and the main branch.
now += 1000;
state = plain(ctx.publishDue());
assert.equal(state.state, 'dispatched');
assert.equal(dispatches().length, 1);
const publishRequest = dispatches()[0];
assert.equal(publishRequest.url, 'https://api.github.com/repos/jb-cttc/concordtabletennisclub/actions/workflows/update-data.yml/dispatches');
assert.equal(publishRequest.options.method, 'post');
assert.equal(publishRequest.options.headers.Authorization, 'Bearer ' + TOKEN);
assert.equal(publishRequest.options.payload, JSON.stringify({ ref: 'main' }), 'publishing never asks for the email');
assert.equal(triggers.length, 1, 'a short backup trigger keeps checking the started publish');
assert.ok(triggers[0].after < HOLD);
ctx.publishNow('s1');
assert.equal(dispatches().length, 1, 'publishing is never started twice');
assert.ok(audits.some(entry => entry[0] === 'publish_dispatched'));

// Until the club site lists the session nothing more happens; a failed site check keeps waiting.
onSite = 'error';
assert.equal(ctx.getPublishState().state, 'dispatched');
onSite = false;
assert.equal(ctx.getPublishState().state, 'dispatched');

// Once the site lists it, a second 15-minute hold starts before the email.
onSite = true;
state = plain(ctx.getPublishState());
assert.equal(state.state, 'email_pending');
assert.equal(state.emailDueAt, now + HOLD);
assert.ok(audits.some(entry => entry[0] === 'publish_confirmed'));
assert.ok(triggers.length === 1 && triggers[0].after >= HOLD, 'the backup trigger now waits for the email time');
now += HOLD - 1000;
assert.equal(ctx.publishDue().state, 'email_pending');
assert.equal(dispatches().length, 1, 'no email before its hold ends');

// When the second timer ends, the workflow is started with send_email=true, once.
now += 1000;
state = plain(ctx.publishDue());
assert.equal(state.state, 'email_dispatched');
assert.equal(dispatches().length, 2);
assert.equal(dispatches()[1].options.payload, JSON.stringify({ ref: 'main', inputs: { send_email: 'true' } }));
ctx.sendEmailNow('s1');
ctx.publishDue();
assert.equal(dispatches().length, 2, 'the email is never started twice');
assert.ok(audits.some(entry => entry[0] === 'email_dispatched'));

// The page learns the outcome from the workflow run that started after the email was requested.
const startedAt = now;
runs = [run(startedAt - 3600000, 'completed', 'success')];
assert.equal(ctx.getPublishState().state, 'email_dispatched', 'an older run does not count');
runs = [run(startedAt + 1000, 'in_progress', null), run(startedAt - 3600000, 'completed', 'success')];
assert.equal(ctx.getPublishState().state, 'email_dispatched', 'still running');
runs = [run(startedAt + 1000, 'completed', 'success')];
assert.equal(ctx.getPublishState().state, 'emailed');
assert.equal(triggers.length, 0, 'nothing left to check once it is done');

// A failed email run is reported and can be retried.
reset();
props.CTTC_GITHUB_TOKEN = TOKEN;
ctx.schedulePublish_('s1', '2026-10-05');
ctx.publishNow('s1');
onSite = true;
ctx.getPublishState();
assert.equal(ctx.sendEmailNow('s1').state, 'email_dispatched');
runs = [run(now + 1000, 'completed', 'failure')];
state = plain(ctx.getPublishState());
assert.equal(state.state, 'email_failed');
assert.match(state.message, /did not finish successfully/);
runs = [];
assert.equal(ctx.sendEmailNow('s1').state, 'email_dispatched', 'Try again sends it again');
assert.equal(dispatches().length, 3);

// "Publish now" and "Send now" skip the waits.
reset();
props.CTTC_GITHUB_TOKEN = TOKEN;
ctx.schedulePublish_('s1', '2026-10-05');
assert.equal(ctx.publishNow('s1').state, 'dispatched');
assert.equal(ctx.sendEmailNow('s1').state, 'dispatched', 'the email cannot be sent before the site is published');
assert.equal(dispatches().length, 1);
onSite = true;
assert.equal(ctx.getPublishState().state, 'email_pending');
assert.equal(ctx.sendEmailNow('s1').state, 'email_dispatched');
assert.equal(dispatches().length, 2);

// Reopening cancels everything, and nothing can publish afterwards.
reset();
props.CTTC_GITHUB_TOKEN = TOKEN;
ctx.schedulePublish_('s1', '2026-10-05');
ctx.cancelPublish_('other');
assert.equal(ctx.getPublishState().state, 'pending', 'another session does not cancel it');
ctx.cancelPublish_('s1');
assert.equal(ctx.getPublishState().state, 'none');
assert.equal(triggers.length, 0);
assert.throws(() => ctx.publishNow('s1'), /Nothing is waiting to be published/);
now += 2 * HOLD;
ctx.publishDue();
assert.equal(requests.length, 0);

// A session that is no longer finalized is never published.
reset();
props.CTTC_GITHUB_TOKEN = TOKEN;
ctx.schedulePublish_('s1', '2026-10-05');
sessionStatus = 'active';
assert.throws(() => ctx.publishNow('s1'), /Only a finalized session/);
assert.equal(ctx.getPublishState().state, 'none');
assert.equal(requests.length, 0);

// No token: the desk says so and leaves it to the scheduled run.
reset();
ctx.schedulePublish_('s1', '2026-10-05');
now += HOLD;
state = plain(ctx.publishDue());
assert.equal(state.state, 'failed');
assert.match(state.message, /not connected/);
assert.match(state.message, /next scheduled run/);
assert.equal(requests.length, 0);

// GitHub refusals are explained (publish and email), and Try again works once fixed.
for (const [code, pattern] of [[401, /rejected the token/], [403, /Actions: Read and write/], [404, /could not find the publishing workflow/], [422, /cannot be started by hand/], [500, /HTTP 500/]]) {
  reset();
  props.CTTC_GITHUB_TOKEN = TOKEN;
  ctx.schedulePublish_('s1', '2026-10-05');
  nextResponse = { code, body: '' };
  state = plain(ctx.publishNow('s1'));
  assert.equal(state.state, 'failed');
  assert.match(state.message, pattern);
  nextResponse = { code: 204, body: '' };
  ctx.publishNow('s1');
  onSite = true;
  ctx.getPublishState();
  nextResponse = { code, body: '' };
  state = plain(ctx.sendEmailNow('s1'));
  assert.equal(state.state, 'email_failed');
  assert.match(state.message, pattern);
  assert.match(state.message, /scheduled run will send it/);
}
nextResponse = { code: 204, body: '' };
assert.equal(ctx.sendEmailNow('s1').state, 'email_dispatched');

// Owner setup check never starts the workflow.
reset();
assert.equal(ctx.checkPublishSetup().ok, false);
props.CTTC_GITHUB_TOKEN = TOKEN;
nextResponse = { code: 200, body: JSON.stringify({ name: 'Update Data and Deploy', state: 'active' }) };
const check = plain(ctx.checkPublishSetup());
assert.equal(check.ok, true);
assert.match(check.message, /Update Data and Deploy/);
assert.equal(requests[0].options.method, undefined, 'the check is a read, not a dispatch');
assert.ok(!requests[0].url.endsWith('/dispatches'));
nextResponse = { code: 404, body: '' };
assert.equal(ctx.checkPublishSetup().ok, false);

// The workflow: the desk can start it, only an explicit send_email (or the fallback schedule) emails, and the
// scheduled fallback stays later than the hold.
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'update-data.yml'), 'utf8');
assert.match(workflow, /workflow_dispatch:/, 'the desk starts the workflow through workflow_dispatch');
assert.match(workflow, /send_email:\n\s+description:[^\n]*\n\s+type: boolean\n\s+default: false/, 'emailing is off unless requested');
const emailGate = "if: github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && github.event.inputs.send_email == 'true')";
assert.equal(workflow.split(emailGate).length - 1, 2, 'both the email step and the sent-marker step use the gate');
assert.ok(!/github\.event_name == 'push'/.test(workflow), 'a push never emails');
assert.ok(!/cron: "30 [56] \* \* 2,4"/.test(workflow), 'no 10:30 PM run that could publish inside the hold');
assert.match(workflow, /cron: "45 6 \* \* 2,4"/);
assert.match(workflow, /cron: "0 15 \* \* 2,4"/);

console.log('Publish timer checks passed');
