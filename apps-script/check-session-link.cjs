const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
  ScriptApp: { getService: function () { return { getUrl: function () { return context.deployedUrl; } }; } },
  HtmlService: {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createTemplateFromFile: function (name) {
      assert.equal(name, 'Index');
      return {
        evaluate: function () {
          const template = this;
          return {
            initialDate: this.initialDate,
            deskMode: this.deskMode,
            setTitle: function () { return this; },
            addMetaTag: function () { return this; },
            setXFrameOptionsMode: function (mode) { this.framing = mode; return this; }
          };
        }
      };
    }
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/Code.js', 'utf8'), context);
assert.equal(context.doGet({ parameter: { date: '2026-09-23' } }).initialDate, '2026-09-23');
assert.equal(context.doGet({ parameter: { date: '2026-09-23\"' } }).initialDate, '');
assert.equal(context.doGet().initialDate, '');
context.deployedUrl = 'https://script.google.com/macros/s/EXAMPLE/dev';
assert.equal(context.doGet().deskMode, 'dev');
context.deployedUrl = 'https://script.google.com/macros/s/EXAMPLE/exec';
assert.equal(context.doGet().deskMode, 'live');
context.deployedUrl = 'https://script.google.com/a/macros/example.org/s/EXAMPLE/userweb';
assert.equal(context.doGet().deskMode, 'unknown', 'an unrecognised address is never guessed');
context.deployedUrl = undefined;
assert.equal(context.doGet().deskMode, 'unknown');
assert.equal(context.doGet().framing, 'ALLOWALL', 'embedding needs framing allowed; the page itself limits who may embed');
context.ScriptApp.getService = function () { throw new Error('not permitted'); };
assert.equal(context.doGet().deskMode, 'unknown', 'a failed lookup never takes the desk down');
console.log('Owner session link checks passed');