// Run: npm run build:storyboard        (writes storyboard.html and docs/storyboard/night.json)
//      npm run check:storyboard        (in npm test: both files match their source, every cited file exists)
//
// The Round Robin Night Storyboard: a night at the club step by step, from volunteers and texts through the desk and
// the projector to results, with a technical layer under each step. Its content is docs/storyboard/night-club.js and
// night-desk.js, its page docs/storyboard/template.html. The site page is storyboard.html (linked from About); the
// same content as plain JSON, for agents, is docs/storyboard/night.json. See docs/storyboard/README.md.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'docs', 'storyboard');
const PAGE = path.join(ROOT, 'storyboard.html');
const JSON_FILE = path.join(DIR, 'night.json');
const ORDER = ['staff', 'text', 'coach', 'open', 'signin', 'print', 'board', 'finish', 'save', 'ops'];
const SHORT = { open: 'Opening', signin: 'Sign-ins', print: 'Printing', board: 'Projector', finish: 'Scores & results', save: 'Staying saved', ops: 'Behind the night' };

function content() {
  const load = name => { const file = path.join(DIR, name); delete require.cache[file]; return require(file); };
  const desk = load('night-desk.js');
  const club = load('night-club.js');
  const all = club.phases.concat(desk.phases);
  const phases = ORDER.map(id => {
    const phase = all.find(p => p.phase === id);
    if (!phase) throw new Error('Storyboard: no part named ' + id);
    return Object.assign({ short: SHORT[id] }, phase);
  });
  if (all.length !== ORDER.length) throw new Error('Storyboard: a part is missing from ORDER in scripts/build-storyboard.js');
  const meta = Object.assign({}, desk.meta, {
    intro: 'A night at the club, from the volunteers who sign up days ahead to open and close, the players who text in and the coaches who book tables, through the round robin desk and the projector, to results on the site: what each person does, what the screen shows, what can go wrong, and the code underneath.'
  });
  return { meta, map: club.map, phases };
}

// The template is written for a page host that adds the document around it; the site page carries its own.
function page(data) {
  const template = fs.readFileSync(path.join(DIR, 'template.html'), 'utf8');
  const split = template.indexOf('</style>') + '</style>'.length;
  const head = template.slice(0, split);
  const body = template.slice(split).replace('/*DATA*/', () => JSON.stringify(data).replace(/</g, '\\u003c'));
  return '<!DOCTYPE html>\n<!-- Built by scripts/build-storyboard.js from docs/storyboard/: edit those, then npm run build:storyboard. -->\n' +
    '<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    '<meta name="description" content="How a night at the Concord Table Tennis Club works, step by step, and the code behind it.">\n' +
    '<link rel="icon" href="assets/logo.png" type="image/png">\n' +
    '<style>body { margin: 0; } [hidden] { display: none !important; } img { max-width: 100%; }</style>\n' +
    head + '\n</head>\n<body>\n' + body + '\n</body>\n</html>\n';
}

// Every repository file the storyboard cites must exist (lines are pinned to meta.commit, so they need not move).
function citedFiles(data) {
  const text = JSON.stringify(data);
  const files = new Set();
  text.replace(/((?:apps-script|scripts|docs|data|staffing-app|coaching-app|turnout-app|subscribe-app|\.github)\/[\w./-]+\.(?:html|json|cjs|js|md|yml))(?![\w])|\b((?:index|about|tonight|text|firstvisit|coaching|desk)\.html|turnout\.js|README\.md|AGENTS\.md|package\.json)\b/g, (all, a, b) => { files.add(a || b); return all; });
  return [...files].filter(file => !/YYYY/.test(file) && !fs.existsSync(path.join(ROOT, file)));
}

const data = content();
const html = page(data);
const json = JSON.stringify(data, null, 1) + '\n';
const missing = citedFiles(data);
const steps = data.phases.reduce((n, p) => n + p.steps.length, 0);
const findings = data.phases.reduce((n, p) => n + p.findings.length, 0);

if (process.argv.includes('--check')) {
  const problems = [];
  if (missing.length) problems.push('cited files that do not exist: ' + missing.join(', '));
  if (!fs.existsSync(PAGE) || fs.readFileSync(PAGE, 'utf8') !== html) problems.push('storyboard.html is out of date: run npm run build:storyboard');
  if (!fs.existsSync(JSON_FILE) || fs.readFileSync(JSON_FILE, 'utf8') !== json) problems.push('docs/storyboard/night.json is out of date: run npm run build:storyboard');
  data.phases.forEach(p => p.steps.forEach(s => {
    if (!s.id || !s.title || !s.summary || !s.tech) problems.push('step ' + (s.id || '?') + ' is missing id, title, summary or tech');
  }));
  if (problems.length) { console.error('Storyboard check failed:\n- ' + problems.join('\n- ')); process.exit(1); }
  console.log('Storyboard checks passed: ' + data.phases.length + ' parts, ' + steps + ' steps, ' + findings + ' findings, every cited file exists');
} else {
  if (missing.length) console.warn('Warning: cited files that do not exist: ' + missing.join(', '));
  fs.writeFileSync(PAGE, html);
  fs.writeFileSync(JSON_FILE, json);
  console.log('Built storyboard.html (' + Math.round(html.length / 1024) + ' KB) and docs/storyboard/night.json: ' + data.phases.length + ' parts, ' + steps + ' steps, ' + findings + ' findings');
}
