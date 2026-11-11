'use strict';

// The test planner (scripts/test-plan.js) finds the checks that read a file, the names other apps share, and the
// storyboard steps a file is cited by. If it stops finding them, a change would be under-tested without anyone noticing.
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');
const plan = require('./test-plan');

const ROOT = path.join(__dirname, '..');

// The suite as npm test runs it, arguments included (the storyboard check is a build with --check).
const suite = plan.suite();
assert.ok(suite.some(check => check.file === 'scripts/build-storyboard.js' && check.args.join(' ') === '--check'), 'the storyboard check keeps --check');
assert.ok(suite.filter(check => /^apps-script\/check-/.test(check.file)).length >= 40, 'every desk check is found');

// What a check reads: named files, pages named without .html, local requires, and the whole desk through the simulator.
const night = plan.readsOf('apps-script/check-night.cjs');
assert.ok(night.all.has('apps-script/MailReader.js') && !night.direct.has('apps-script/MailReader.js'), 'the simulator loads every desk file');
assert.ok(night.all.has('apps-script/PlayerBoard.html'), 'and the pages the desk includes');
assert.ok(plan.readsOf('apps-script/check-cash-flow.cjs').all.has('apps-script/Cash.html'));
const leaderboard = plan.readsOf('scripts/check-leaderboard.js').all;
assert.ok(leaderboard.has('leaderboard.html') && leaderboard.has('style.css'));
assert.ok(!leaderboard.has('apps-script/Index.html'), 'a site page check does not reach into the desk');
assert.ok(plan.readsOf('coaching-app/check-coaching.cjs').all.has('coaching-app/Index.html'), 'an app check covers its folder');

// Names other apps share, found in changed lines.
const names = plan.sharedNames('x.js', [
  "  var tab = desk.getSheetByName('VoiceTexts');",
  "  Requests: ['request_id', 'slot_key',",
  "  properties.getProperty('DESK_SHEET_ID');",
  "  fetch('data/players.json')",
  "  body: JSON.stringify({ fn: 'wake' })",
  "  el('button', { text: 'Done' })"
]);
assert.deepEqual([...names], [['VoiceTexts', 'Sheet tab'], ['Requests', 'Sheet columns'], ['DESK_SHEET_ID', 'script property'], ['data/players.json', 'site data file'], ['wake', 'call between apps']]);
const sources = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(name => /\.(c?js|html)$/.test(name) && !/^(node_modules|data)\//.test(name));
const voice = plan.usersOf('VoiceTexts', 'Sheet tab', sources, 'coaching-app');
assert.ok(voice.includes('apps-script/MailReader.js') && voice.includes('staffing-app/Code.js'), 'the desk writes the tab other apps read');
assert.ok(!voice.includes('storyboard.html') && !voice.some(file => file.startsWith('coaching-app/')), 'prose and the app itself are not "other apps"');
assert.ok(plan.usersOf('Requests', 'Sheet columns', sources, 'coaching-app').includes('apps-script/Coaching.js'), 'the desk reads the coaching Requests tab');

// The storyboard: who cites a file, and which checks it lists for those steps.
const story = plan.storyboard();
assert.ok(story.cites['coaching-app/Index.html'].some(cite => cite.id === 'coach-2-book'));
assert.ok(story.tests['apps-script/Coaching.js'].has('apps-script/check-open-play.cjs'), 'a desk check reached only through the simulator is still found');

console.log('Test planner checks passed');
