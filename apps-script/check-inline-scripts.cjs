const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A syntax slip in one inline script silently disables only that feature in the browser, so parse every block.
let blocks = 0;
for (const file of ['Index.html', 'Organizer.html', 'Print.html', 'Standings.html']) {
  const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    blocks += 1;
    try {
      new Function(match[1]);
    } catch (error) {
      assert.fail(file + ' has an inline script with a syntax error: ' + error.message + '\n' + match[1].slice(0, 80));
    }
  }
}
assert.ok(blocks >= 10, 'expected to find the desk inline scripts');
console.log('Inline script syntax checks passed: ' + blocks + ' blocks');
