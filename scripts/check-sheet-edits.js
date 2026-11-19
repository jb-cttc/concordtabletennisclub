// The club's Google Sheets are databases: nobody types into them (AGENTS.md, "Never edit the Sheets by hand"). This check
// fails when a doc, skill, PR template, storyboard step, site page, or an app's message or code comment tells someone to type
// into, fill, add, delete or fix Sheet rows, cells or tabs, or to type a formula into one. A sentence that forbids it
// ("never", "not", "no control yet") passes. Where data needs changing, docs/data-changes.md names the control, or lists the
// form still to build.
//
// It first checks itself against sentences that once sat in this repository's docs and messages (each must be caught), and
// against safe sentences that look alike (none may be caught). Run: npm run check:sheet-edits
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// One sentence (or code comment, or message) tells someone to edit a Sheet.
const SHEET = String.raw`(?:sheet|tab|spreadsheet)(?!'s|\w)`;
const PATTERNS = [
  // "type the new address ... in the Emails tab", "set status in the private staffing Sheet", "add it to the Closures tab".
  // A word after a/an/the/each ("each change is a row") is a noun, not an instruction.
  { why: 'an edit in a Sheet or tab', re: new RegExp(String.raw`(?<!\b(?:a|an|the|each|every|this|that|its|their|one|any|no)\s)\b(?:type|enter|fill in|fill|paste|put|add|edit|change|set|correct|fix|insert|tick|untick|decide)\b[^.;:]{0,80}?\b(?:in|into|on|to)\s+the\s+(?:[\w\`'’*-]+\s+){0,4}?` + SHEET, 'i') },
  // "delete a row from the Subscribers tab"
  { why: 'deleting from a Sheet or tab', re: new RegExp(String.raw`(?<!\b(?:a|an|the|each|every|this|that|its|their|one|any|no)\s)\b(?:delete|remove|clear)\b[^.;:]{0,80}?\b(?:from|in|on)\s+the\s+(?:[\w\`'’*-]+\s+){0,4}?` + SHEET, 'i') },
  // "type the new address as a new `approved` row"
  { why: 'typing a new row', re: /\b(?:type|enter|put|add|paste)\b[^.;]{0,60}?\bas an? (?:new )?`?\w+`? row\b/i },
  // "Add an `Aliases` row", "or add an Aliases row", "can still delete a row", "fill the matching SeedLinks rows"
  { why: 'adding, filling or deleting rows by hand', re: /(?:^|,\s*|\b(?:you|owner|club|maintainer|organizer|please|then|or|and|can|still|should|must|just|simply|first|yourself)\s+)(?:add|delete|remove|insert|type|fill(?: in)?)\s+(?:(?:a|an|the|that|this|their|its|matching|new|blank|one|each|any|missing)\s+){0,3}`?[A-Za-z_]+`?\s+rows?\b/i },
  // "=EPOCHTODATE(M2/1000)": a formula typed into a cell
  { why: 'a formula typed into a cell', re: /(?:^|[\s`(])=\s*[A-Z][A-Z0-9.]{2,}\(/ },
  // "Set by hand by the club", "The owner types name, email…", "the owner adds each mobile number in the Sheet"
  { why: 'an owner or club edit by hand', re: /\b(?:set by hand|by hand in the (?:[\w`'’*-]+\s+){0,3}(?:sheet|tab)|typed by the owner|(?:the )?owner (?:types|typed|adds|sets|edits|fills|enters|deletes)|type (?:it|them) (?:in|into))\b/i }
];
// A sentence that forbids or rules out the edit is fine.
const ALLOWED = /\b(?:never|not|no one|nobody|don't|do not|must not|cannot|can't|isn't|is not|no longer|instead of|rather than|forbid|forbids|forbidden|no control|no desk control|until one|stopped editing|tells? (?:someone|anyone|anybody|people) to)\b/i;
// Setting up a Google project (Script Properties, GitHub secrets, sharing) is an owner step, not a Sheet edit.
const SETUP = /\b(?:script propert(?:y|ies)|secret|service account|environment variable|shared with)\b/i;

function findings(text) {
  return text.replace(/\s+/g, ' ').split(/(?<=[.!?;])\s+|\s+\|\s+|\s+-\s+(?=[A-Z*])/)
    .filter(sentence => !ALLOWED.test(sentence) && !SETUP.test(sentence))
    .flatMap(sentence => PATTERNS.filter(pattern => pattern.re.test(sentence)).map(pattern => ({ sentence: sentence.trim(), why: pattern.why })));
}

// ---- Self-check ----
const CAUGHT = [
  'A maintainer can still delete a row in the private `Subscribers` tab.',
  'Their Voice contact name does not match one desk player. Add an `Aliases` row in the desk Sheet, or fix the contact name in Google Voice.',
  'Save their name as the contact in Google Voice (or add an `Aliases` row) so their next text links.',
  'In the Sheet, `=EPOCHTODATE(M2/1000)` gives the time in UTC.',
  'Set by hand by the club after a coach asked to cancel.',
  'Then type any missing ones into the **Emails** tab yourself.',
  'Their `Emails` row: type the new address as a new `approved` row (`source` owner); the old one becomes `replaced`.',
  'Answer the message, or set `status` to `approved` in the Emails tab.',
  'Use Prepare SeedLinks, fill the matching `SeedLinks` rows, and check the preview again.',
  'Check closures.json on the live site or add it to the Closures tab.',
  'A reply from another address does not count. You can also decide in the private staffing Sheet: Emails tab, status approved or declined.',
  'The owner adds each mobile number in the Sheet.',
  'Coaches are a list the owner types into the private Coaches tab (name, email, mobile).',
  'Open the private staffing Sheet, fill in the SeedLinks tab, then come back to the preview.',
  'The owner may also decide in the Emails tab (status approved or declined).',
  'Remove the address from the Subscribers tab.'
];
const SAFE = [
  'Never tell anyone to type into, fix, add or delete rows or cells in one.',
  'Fixable on the desk, never by editing the Sheet.',
  'In **Project Settings > Script properties**, set `DESK_SHEET_ID` to the id in the desk Sheet\'s address.',
  'Every failed finalize adds a `finalize_failed` row to the `AuditLog` sheet with the message.',
  'The app adds a blank `SeedLinks` row for each such name, with a dropdown of active players.',
  'Add that name under **Other names** in the player\'s pencil window on the desk.',
  'There is no control yet to add or change an email on file; the `Emails` tab is never typed into.',
  'Tick **Junior** and choose the **Member account** in the pencil window.',
  'The desk copies the shown names to the hidden CoachList tab of its Sheet every hour.',
  'Entered on the desk, the scores are saved to the Sheet in the background.',
  'A row with no player is a payment waiting for the organizer after an undo.',
  'Each change is a row in the private `AdminChanges` tab (when, what, the person, before and after).',
  'Set the script property DESK_SHEET_ID to the id of the desk Sheet.',
  'How the hints look on a real phone (checked by hand in the local preview).',
  'Its fix-up loop filled `SeedLinks` rows in the Sheet by hand, which the club no longer does.'
];
const missed = CAUGHT.filter(sentence => !findings(sentence).length);
const wrong = SAFE.filter(sentence => findings(sentence).length);
if (missed.length || wrong.length) {
  console.error('check-sheet-edits is wrong about its own examples:');
  missed.forEach(sentence => console.error('  not caught: ' + sentence));
  wrong.forEach(sentence => console.error('  wrongly caught: ' + sentence + ' (' + findings(sentence).map(found => found.why).join(', ') + ')'));
  process.exit(1);
}

// ---- What is read ----
function walk(dir, keep) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!/^(node_modules|\.git|_site|repro)$/.test(entry.name)) out.push(...walk(rel, keep)); }
    else if (keep(rel)) out.push(rel);
  }
  return out;
}
const markdown = ['README.md', 'AGENTS.md'].concat(walk('docs', file => /\.md$/.test(file)), walk('.github', file => /\.md$/.test(file)));
const storyboard = walk('docs/storyboard', file => /^docs\/storyboard\/night-.*\.js$/.test(file));
const sitePages = fs.readdirSync(ROOT).filter(file => /\.html$/.test(file) && file !== 'storyboard.html');
const APPS = ['apps-script', 'coaching-app', 'staffing-app', 'turnout-app', 'subscribe-app'];
const appCode = APPS.flatMap(dir => walk(dir, file => /\.(js|html)$/.test(file) && !/\/check-[^/]*$/.test(file)));

// Markdown: prose only, not code blocks. Storyboard: its strings. Site pages: visible text. App code: comments and strings.
const strings = text => (text.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || []).map(quoted => quoted.slice(1, -1).replace(/\\'/g, '\''));
const comments = text => (text.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) || []).map(comment => comment.replace(/^\/\/|^\/\*|\*\/$/g, ''));
// A comment's lines run together, so a sentence that wraps is read whole.
const commentBlocks = text => text.split(/\n(?!\s*\/\/)/).map(block => (block.match(/\/\/[^\n]*/g) || []).map(line => line.replace(/^\/\/\s?/, '')).join(' ')).filter(Boolean);
const visible = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');

const problems = [];
const check = (file, pieces) => pieces.forEach(piece => findings(piece).forEach(found => problems.push({ file, ...found })));
markdown.forEach(file => check(file, fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/```[\s\S]*?```/g, ' ').split(/\n\s*\n/)));
storyboard.forEach(file => check(file, strings(fs.readFileSync(path.join(ROOT, file), 'utf8'))));
sitePages.forEach(file => check(file, [visible(fs.readFileSync(path.join(ROOT, file), 'utf8'))]));
appCode.forEach(file => {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  check(file, commentBlocks(text).concat(comments(text).filter(comment => !comment.startsWith('/') && /\n/.test(comment)), strings(text).filter(value => / /.test(value))));
});

if (problems.length) {
  console.error('These tell someone to edit a club Sheet by hand (AGENTS.md, "Never edit the Sheets by hand"). Point to the control that');
  console.error('makes the change, or, where none exists, say so and list the form to build under Missing controls in docs/data-changes.md:\n');
  problems.forEach(problem => console.error('  ' + problem.file + ' (' + problem.why + '): ' + problem.sentence.slice(0, 240)));
  process.exit(1);
}
console.log('Sheet edit check passed: ' + (markdown.length + storyboard.length + sitePages.length + appCode.length) + ' files, none tells anyone to edit a Sheet by hand');
