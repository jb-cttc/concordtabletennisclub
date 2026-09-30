// Run: npm run sync:desk
// The desk (Apps Script) cannot require files from the repository root, so apps-script/Standings.html
// carries a copy of standings.js and the desk ranks groups with the same code as the public site.
// apps-script/check-organizer.cjs fails when the copy is stale.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function deskCopy() {
  return '<script>\n' + fs.readFileSync(path.join(ROOT, 'standings.js'), 'utf8') + '</script>\n';
}

if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'apps-script', 'Standings.html'), deskCopy());
  console.log('apps-script/Standings.html updated from standings.js');
}

module.exports = { deskCopy };
