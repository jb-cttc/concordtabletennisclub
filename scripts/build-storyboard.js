// Run: npm run build:storyboard        (writes storyboard.html and docs/storyboard/night.json)
//      npm run build:storyboard -- --advance   (first moves every file:line reference to HEAD's code, then builds)
//      npm run check:storyboard        (in npm test: both files match their source, every cited file exists)
//
// The storyboard (on the site, the Club Night Guide): a night at the club step by step, from volunteers and texts through the desk and
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
const SHORT = { open: 'Opening', signin: 'Sign-in', print: 'Printing', board: 'Projector', finish: 'Results', save: 'Reliability', ops: 'Operations' };

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
    intro: 'A night at the club, from the volunteers who sign up days ahead to open and close, the players who text in and the coaches who book tables, through the round robin desk and the projector, to results on the site: what each person does, what the screen shows, what can go wrong, and how the tools behind it work.'
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
    '<meta name="description" content="How a club night at the Concord Table Tennis Club runs, step by step, and the tools behind it.">\n' +
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

// --advance [commit]: moves every file:line reference in the content from meta.commit to the commit (HEAD by default),
// following git's diff, and sets meta.commit to it. References to lines that changed are moved to where the change is
// and listed: re-read those in the code and fix the step by hand.
function advance(target) {
  const { execFileSync } = require('child_process');
  const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = ['night-desk.js', 'night-club.js'].map(name => path.join(DIR, name));
  const from = /commit: '([0-9a-f]{40})'/.exec(fs.readFileSync(files[0], 'utf8'))[1];
  const to = git(['rev-parse', target || 'HEAD']).trim();
  const maps = {};
  const review = [];
  // For one file: old line -> { line, changed } from the -U0 hunks between the two commits.
  const mapper = file => {
    if (maps[file]) return maps[file];
    const exists = git(['ls-tree', '--name-only', to, '--', file]).trim();
    const hunks = exists ? git(['diff', '-U0', from, to, '--', file]).split('\n').filter(l => l.startsWith('@@')).map(l => {
      const m = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
      return { a: +m[1], b: m[2] === undefined ? 1 : +m[2], c: +m[3], d: m[4] === undefined ? 1 : +m[4] };
    }) : [];
    maps[file] = line => {
      if (!exists) return { line, changed: 'file no longer exists' };
      let shift = 0;
      for (const h of hunks) {
        const start = h.b === 0 ? h.a + 1 : h.a;
        if (line < start) break;
        if (h.b > 0 && line < h.a + h.b) return { line: Math.max(1, h.c), changed: 'line changed' };
        shift = (h.c + h.d) - (h.a + h.b);
      }
      return { line: line + shift, changed: '' };
    };
    return maps[file];
  };
  let moved = 0;
  files.forEach(source => {
    let text = fs.readFileSync(source, 'utf8');
    const consts = {};
    text.replace(/\b([A-Z][A-Z0-9]{0,4}) = '([\w./-]+\.(?:html|json|cjs|js|md|yml))'/g, (all, name, file) => { consts[name] = file; return all; });
    const move = (file, line, end) => {
      const map = mapper(file);
      const a = map(+line);
      const b = end ? map(+end) : null;
      if (a.changed || (b && b.changed)) review.push(file + ':' + line + (end ? '-' + end : '') + ' -> ' + a.line + ' (' + (a.changed || b.changed) + ')');
      if (a.line !== +line || (b && b.line !== +end)) moved += 1;
      return a.line + (b ? '-' + b.line : '');
    };
    // E(I, 1103, ...) and E('apps-script/Code.js', 146, ...)
    text = text.replace(/\bE\((?:([A-Z][A-Z0-9]{0,4})|'([\w./-]+)'), (\d+)\b/g, (all, name, literal, line) => {
      const file = name ? consts[name] : literal;
      return file ? all.replace(new RegExp(line + '$'), move(file, line)) : all;
    });
    // I + ':958'
    text = text.replace(/\b([A-Z][A-Z0-9]{0,4}) \+ ':(\d+)(?:-(\d+))?'/g, (all, name, line, end) => consts[name] ? name + " + ':" + move(consts[name], line, end) + "'" : all);
    // 'apps-script/Index.html:568' anywhere in a string
    text = text.replace(/([\w./-]+\.(?:html|json|cjs|js|md|yml)):(\d+)(?:-(\d+))?/g, (all, file, line, end) => fs.existsSync(path.join(ROOT, file)) || consts[file] ? file + ':' + move(file, line, end) : all);
    text = text.replace(/commit: '[0-9a-f]{40}'/, "commit: '" + to + "'");
    fs.writeFileSync(source, text);
  });
  console.log('Moved ' + moved + ' references from ' + from.slice(0, 7) + ' to ' + to.slice(0, 7) + '.');
  if (review.length) console.log('Re-read these (their lines changed), then fix the step by hand:\n  ' + review.join('\n  '));
}

if (process.argv.includes('--advance')) {
  const at = process.argv.indexOf('--advance');
  const target = process.argv[at + 1] && !process.argv[at + 1].startsWith('--') ? process.argv[at + 1] : '';
  advance(target);
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
  // Each entry point names a function or constant: it must be on the cited line at meta.commit (skipped where git
  // cannot show that commit, as in a shallow clone).
  const { execFileSync } = require('child_process');
  const shown = {};
  const at = (file) => {
    if (!(file in shown)) {
      try { shown[file] = execFileSync('git', ['show', data.meta.commit + ':' + file], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).split('\n'); } catch (error) { shown[file] = null; }
    }
    return shown[file];
  };
  data.phases.forEach(p => p.steps.forEach(s => (s.tech.entry || []).forEach(e => {
    if (!e.line || !/^[A-Za-z_$][\w$]*$/.test(e.symbol || '')) return;
    const lines = at(e.file);
    if (lines && !(lines[e.line - 1] || '').includes(e.symbol)) problems.push(s.id + ': ' + e.symbol + ' is not on ' + e.file + ':' + e.line + ' at ' + data.meta.commit.slice(0, 7) + ' (npm run build:storyboard -- --advance, then fix by hand)');
  })));
  if (problems.length) { console.error('Storyboard check failed:\n- ' + problems.join('\n- ')); process.exit(1); }
  console.log('Storyboard checks passed: ' + data.phases.length + ' parts, ' + steps + ' steps, ' + findings + ' findings, every cited file exists');
} else {
  if (missing.length) console.warn('Warning: cited files that do not exist: ' + missing.join(', '));
  fs.writeFileSync(PAGE, html);
  fs.writeFileSync(JSON_FILE, json);
  console.log('Built storyboard.html (' + Math.round(html.length / 1024) + ' KB) and docs/storyboard/night.json: ' + data.phases.length + ' parts, ' + steps + ' steps, ' + findings + ' findings');
}
