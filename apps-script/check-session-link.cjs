const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
  HtmlService: {
    createTemplateFromFile: function (name) {
      assert.equal(name, 'Index');
      return {
        evaluate: function () {
          return {
            initialDate: this.initialDate,
            setTitle: function () { return this; },
            addMetaTag: function () { return this; }
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
console.log('Owner session link checks passed');