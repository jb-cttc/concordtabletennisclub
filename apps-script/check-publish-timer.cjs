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
    requests.push({ url, options });
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
  triggers.length = 0; requests.length = 0; audits.length = 0;
  nextResponse = { code: 204, body: '' }; onSite = false; sessionStatus = 'finalized'; now = 1_000_000;
};
const plain = value => JSON.parse(JSON.stringify(value));
const HOLD = 15 * 60 * 1000;

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
props.CTTC_GITHUB_TOKEN = 'ghp_secret_value';
state = plain(ctx.getPublishState());
assert.equal(state.tokenSet, true);
assert.ok(!JSON.stringify(state).includes('ghp_secret_value'), 'the token never reaches the page');

// Before the timer ends nothing is sent.
now += HOLD - 1000;
assert.equal(ctx.publishDue().state, 'pending');
assert.equal(requests.length, 0);

// When the timer ends the workflow is started once, with the token and the main branch.
now += 1000;
state = plain(ctx.publishDue());
assert.equal(state.state, 'dispatched');
assert.equal(requests.length, 1);
assert.equal(requests[0].url, 'https://api.github.com/repos/jb-cttc/concordtabletennisclub/actions/workflows/update-data.yml/dispatches');
assert.equal(requests[0].options.method, 'post');
assert.equal(requests[0].options.headers.Authorization, 'Bearer ghp_secret_value');
assert.equal(requests[0].options.payload, JSON.stringify({ ref: 'main' }));
assert.equal(triggers.length, 0, 'the backup trigger is removed once publishing starts');
ctx.publishDue();
ctx.publishNow('s1');
assert.equal(requests.length, 1, 'publishing is never started twice');
assert.ok(audits.some(entry => entry[0] === 'publish_dispatched'));

// The page learns it is live once the club site lists the session.
onSite = 'error';
assert.equal(ctx.getPublishState().state, 'dispatched', 'a failed site check keeps waiting');
onSite = true;
assert.equal(ctx.getPublishState().state, 'published');

// Publish now skips the wait.
reset();
props.CTTC_GITHUB_TOKEN = 'ghp_secret_value';
ctx.schedulePublish_('s1', '2026-10-05');
assert.equal(ctx.publishNow('s1').state, 'dispatched');
assert.equal(requests.length, 1);

// Reopening cancels it, and nothing can publish afterwards.
reset();
props.CTTC_GITHUB_TOKEN = 'ghp_secret_value';
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
props.CTTC_GITHUB_TOKEN = 'ghp_secret_value';
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

// GitHub refusals are explained, and Try again works once fixed.
for (const [code, pattern] of [[401, /rejected the token/], [403, /Actions: Read and write/], [404, /could not find the publishing workflow/], [422, /cannot be started by hand/], [500, /HTTP 500/]]) {
  reset();
  props.CTTC_GITHUB_TOKEN = 'ghp_secret_value';
  ctx.schedulePublish_('s1', '2026-10-05');
  nextResponse = { code, body: '' };
  state = plain(ctx.publishNow('s1'));
  assert.equal(state.state, 'failed');
  assert.match(state.message, pattern);
}
nextResponse = { code: 204, body: '' };
assert.equal(ctx.publishNow('s1').state, 'dispatched', 'Try again starts publishing');

// Owner setup check never starts the workflow.
reset();
assert.equal(ctx.checkPublishSetup().ok, false);
props.CTTC_GITHUB_TOKEN = 'ghp_secret_value';
nextResponse = { code: 200, body: JSON.stringify({ name: 'Update Data and Deploy', state: 'active' }) };
let check = plain(ctx.checkPublishSetup());
assert.equal(check.ok, true);
assert.match(check.message, /Update Data and Deploy/);
assert.equal(requests[0].options.method, undefined, 'the check is a read, not a dispatch');
assert.ok(!requests[0].url.endsWith('/dispatches'));
nextResponse = { code: 404, body: '' };
assert.equal(ctx.checkPublishSetup().ok, false);

// The workflow's fallback schedule must stay later than the hold and keep the 8 AM run.
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'update-data.yml'), 'utf8');
assert.match(workflow, /workflow_dispatch:/, 'the desk starts the workflow through workflow_dispatch');
assert.ok(!/cron: "30 [56] \* \* 2,4"/.test(workflow), 'no 10:30 PM run that could publish inside the hold');
assert.match(workflow, /cron: "45 6 \* \* 2,4"/);
assert.match(workflow, /cron: "0 15 \* \* 2,4"/);

console.log('Publish timer checks passed');
