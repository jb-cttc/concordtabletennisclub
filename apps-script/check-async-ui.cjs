const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(__dirname + '/Index.html', 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)][0][1];
const handlers = {};
const activity = { textContent: '' };
const classes = new Set();
const button = {
  classList: {
    add: function (name) { classes.add(name); },
    remove: function (name) { classes.delete(name); }
  }
};
const calls = [];
const context = {
  document: {
    addEventListener: function (name, handler) { handlers[name] = handler; },
    getElementById: function () { return activity; }
  },
  google: {
    script: {
      run: {
        withSuccessHandler: function (resolve) {
          return { withFailureHandler: function (reject) {
            return { getAppState: function () { calls.push({ resolve, reject }); } };
          } };
        }
      }
    }
  },
  setTimeout: function () {},
  WeakMap,
  Promise
};
context.window = context;
vm.runInNewContext(script, context);

async function check() {
  handlers.click({ target: { closest: function () { return button; } } });
  const first = context.cttcRequest('getAppState');
  const second = context.cttcRequest('getAppState');
  assert.equal(activity.textContent, 'Working...');
  assert.equal(classes.has('request-pending'), true);
  calls[0].resolve('loaded');
  assert.equal(await first, 'loaded');
  assert.equal(classes.has('request-pending'), true);
  calls[1].reject(new Error('Failed'));
  await assert.rejects(second, /Failed/);
  assert.equal(activity.textContent, '');
  assert.equal(classes.has('request-pending'), false);
  console.log('Async button feedback checks passed');
}

check().catch(function (error) { console.error(error); process.exitCode = 1; });