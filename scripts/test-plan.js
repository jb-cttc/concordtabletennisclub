'use strict';

// Run: npm run test:plan            what to check for the work on this branch, and why
//      npm run test:changed         the same, then runs those checks
//      options: --base REF (default origin/main), --full (plan the whole suite), --json
//
// Sizes the checks to the change, the way a developer keeps a running list of what they touched (AGENTS.md, "Size the
// checks to the change"). Nothing here is a hand-kept list of which test covers which file:
//   - Each check in `npm test` is read for the files it loads (string paths, local requires, and the desk simulator's
//     whole-desk load), so a changed file selects exactly the checks that read it.
//   - The changed lines are read for things other apps share: Sheet tabs, script properties, site data files, the
//     calls one app makes to another. When another app's code names the same thing, its checks join the plan.
//   - The storyboard (docs/storyboard/night.json) says which club-night steps cite the changed files, and how the apps
//     connect, so it is clear whether a step needs re-reading or the storyboard is not affected.
// Levels: none (nothing reads the change), focused (the checks that read it), cross-app (plus the other apps that share
// what changed), full (a change everything depends on: run npm test). GitHub runs the full suite on every PR anyway.

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf('--' + name); return index >= 0 && args[index + 1] ? args[index + 1] : fallback; };
const RUN = args.includes('--run');
const FULL = args.includes('--full');
const JSON_OUT = args.includes('--json');
const BASE = option('base', 'origin/main');
const TIMES = path.join(ROOT, '.git', 'cttc-check-times.json');

const git = list => execFileSync('git', list, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const rel = file => path.relative(ROOT, file).split(path.sep).join('/');
const exists = file => { try { return fs.statSync(path.join(ROOT, file)).isFile(); } catch (error) { return false; } };
const read = file => { try { return fs.readFileSync(path.join(ROOT, file), 'utf8'); } catch (error) { return ''; } };

// ----- The suite: every check file `npm test` runs, by its npm script -----
const pkg = JSON.parse(read('package.json'));
function suite() {
  const checks = [];
  (pkg.scripts.test.match(/check:[a-z0-9-]+/g) || []).forEach(name => {
    const command = pkg.scripts[name] || '';
    const glob = /for f in ([\w./-]+)\*;/.exec(command);
    if (glob) {
      const dir = path.dirname(glob[1]);
      const prefix = path.basename(glob[1]);
      fs.readdirSync(path.join(ROOT, dir)).filter(file => file.startsWith(prefix)).sort().forEach(file => checks.push({ file: dir + '/' + file, script: name, args: [] }));
    }
    (command.match(/node [\w./-]+\.c?js( --?[\w-]+)*/g) || []).forEach(part => {
      const words = part.split(' ').slice(1);
      checks.push({ file: words[0], script: name, args: words.slice(1) });
    });
  });
  return checks;
}

// ----- What each check reads -----
// The desk simulator loads the desk itself, not by name: every server file, and the page with what it includes.
function deskPage() {
  const files = ['apps-script/Index.html'];
  (read('apps-script/Index.html').match(/include\('(\w+)'\)/g) || []).forEach(match => files.push('apps-script/' + /'(\w+)'/.exec(match)[1] + '.html'));
  return files;
}
const DYNAMIC = {
  'scripts/lib/desk-sim.js': () => fs.readdirSync(path.join(ROOT, 'apps-script')).filter(name => /^[A-Z].*\.js$/.test(name)).map(name => 'apps-script/' + name).concat(deskPage())
};
const APP_DIRS = ['coaching-app', 'staffing-app', 'subscribe-app', 'turnout-app'];

// Files a source file names in its strings (resolved next to it, at the repo root, or one level up), and its local requires.
function namedFiles(file) {
  const text = read(file);
  const dir = path.dirname(path.join(ROOT, file));
  const found = new Set();
  const literal = /(['"`])([^'"`\n]{2,140}?)\1/g;
  let match;
  while ((match = literal.exec(text))) {
    const value = match[2].replace(/^\.\//, '');
    // A page named without its extension (the desk's checks read('Cash')).
    if (/^[A-Z][A-Za-z]+$/.test(value) && exists(rel(path.join(dir, value + '.html')))) { found.add(rel(path.join(dir, value + '.html'))); continue; }
    if (!/\.(c?js|html|css|json|md|ya?ml)$/.test(value) && !/^\.\.?\//.test(match[2])) continue;
    [path.join(dir, value), path.join(ROOT, value), path.join(dir, '..', value)].some(candidate => {
      const name = rel(candidate);
      if (!name.startsWith('..') && exists(name) && name !== file) { found.add(name); return true; }
      return false;
    });
  }
  const required = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  while ((match = required.exec(text))) {
    const base = rel(path.join(dir, match[1]));
    const name = [base, base + '.js', base + '.cjs', base + '/index.js'].find(exists);
    if (name) found.add(name);
  }
  return found;
}

// For one check: every file it reads, directly (named in the check) or through what it requires.
function readsOf(check) {
  const direct = namedFiles(check);
  const all = new Set([check]);
  const queue = [check];
  while (queue.length) {
    const file = queue.shift();
    const named = file === check ? direct : namedFiles(file);
    named.forEach(name => { if (!all.has(name)) { all.add(name); if (/\.c?js$/.test(name) && !/^data\//.test(name)) queue.push(name); } });
    if (DYNAMIC[file]) DYNAMIC[file]().forEach(name => all.add(name));
  }
  // One check per app folder: it covers that folder (pages are often read by a computed name).
  const dir = check.split('/')[0];
  if (APP_DIRS.includes(dir)) git(['ls-files', dir]).split('\n').filter(Boolean).forEach(name => all.add(name));
  return { direct, all };
}

// ----- The change -----
function changedFiles() {
  let base;
  try { base = git(['merge-base', BASE, 'HEAD']).trim(); } catch (error) { throw new Error('Cannot compare with ' + BASE + ' (git fetch origin main, or pass --base).'); }
  const names = new Set();
  [['diff', '--name-only', base], ['ls-files', '--others', '--exclude-standard']].forEach(list => git(list).split('\n').filter(Boolean).forEach(name => names.add(name)));
  return { base, files: [...names].sort() };
}
// The line ranges a change covers, on both sides of the diff (a storyboard reference may predate or follow the change).
function changedRanges(base, file) {
  let diff = '';
  try { diff = git(['diff', '--unified=0', base, '--', file]); } catch (error) { diff = ''; }
  const ranges = [];
  (diff.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm) || []).forEach(header => {
    const [, a, b, c, d] = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
    ranges.push([Number(a), Number(a) + Math.max(0, Number(b === undefined ? 1 : b) - 1)], [Number(c), Number(c) + Math.max(0, Number(d === undefined ? 1 : d) - 1)]);
  });
  return diff || git(['ls-files', file]).trim() ? ranges : [[1, Infinity]];
}
function changedLines(base, file, signed) {
  if (!exists(file)) return [];
  let diff = '';
  try { diff = git(['diff', '--unified=0', base, '--', file]); } catch (error) { diff = ''; }
  if (!diff && !git(['ls-files', file]).trim()) return read(file).split('\n'); // new, untracked
  return diff.split('\n').filter(line => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line)).map(line => (signed ? line : line.slice(1)));
}

// ----- What other apps share -----
// Names that cross between apps: a Sheet tab, a script property, a site data file, a call one app makes to another, and
// a Sheet's column list (a tab's name followed by its headings).
const SHARED = [
  [/getSheetByName\(\s*['"]([^'"]+)['"]/g, 'Sheet tab'],
  [/\b(?:tab_|rows_|save_|sheet_|readTab_|tabRows_)\(\s*['"]([A-Z][\w ]+)['"]/g, 'Sheet tab'],
  [/^\s*([A-Z]\w+): \[\s*'[a-z_]+',/gm, 'Sheet columns'],
  [/(?:get|set|delete)Property\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g, 'script property'],
  [/\bbook_\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g, 'script property'],
  [/['"](data\/[\w./-]+\.json)['"]/g, 'site data file'],
  [/\bfn:\s*['"](\w+)['"]/g, 'call between apps']
];
const areaOf = file => {
  const top = file.split('/')[0];
  if (['apps-script', ...APP_DIRS].includes(top)) return top;
  if (top === 'docs' || /\.md$/.test(file)) return 'docs';
  return 'site';
};
// Pages that only describe the apps (the storyboard quotes tab names in prose).
const PROSE = /^(storyboard\.html|scripts\/build-storyboard\.js)$/;
const AREA_LABEL = { 'apps-script': 'the desk', 'coaching-app': 'Coaching app', 'staffing-app': 'Volunteer app', 'subscribe-app': 'Subscribe app', 'turnout-app': 'Tonight page app', site: 'Club site', docs: 'docs' };
const MAP_NODE = { 'apps-script': 'The desk', 'coaching-app': 'Coaching app', 'staffing-app': 'Volunteer app', 'turnout-app': 'Tonight page', site: 'Club site' };

function sharedNames(file, lines) {
  const text = lines.join('\n');
  const names = new Map();
  SHARED.forEach(([pattern, kind]) => {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) if (!names.has(match[1])) names.set(match[1], kind);
  });
  return names;
}
// Code in other apps that names the same thing, quoted (or as a column list's tab key).
function usersOf(name, kind, sourceFiles, ownArea) {
  const quoted = new RegExp('[\'"]' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\'"]' + (kind === 'Sheet columns' ? '|^\\s*' + name + ': \\[' : ''), 'm');
  return sourceFiles.filter(file => areaOf(file) !== ownArea && areaOf(file) !== 'docs' && !/(^|\/)check-/.test(file) && !PROSE.test(file) && quoted.test(read(file)));
}

// ----- The storyboard -----
function storyboard() {
  let night;
  try { night = JSON.parse(read('docs/storyboard/night.json')); } catch (error) { return { cites: {}, tests: {}, links: [] }; }
  // file -> [{ id, title, line, reach }]: an entry point covers its function (about 80 lines from where it starts), a
  // piece of evidence the lines around it. A step's tests are not listed: a changed test does not change what it says.
  const cites = {};
  const tests = {}; // file -> the checks the storyboard lists for the steps that cite it
  const add = (file, line, reach, step) => {
    if (!file) return;
    (cites[file] = cites[file] || []).push({ id: step.id, title: step.title, line: Number(line) || 0, reach });
    (step.tech.tests || []).forEach(test => (tests[file] = tests[file] || new Set()).add(test.file));
  };
  night.phases.forEach(phase => phase.steps.forEach(step => {
    (step.tech.entry || []).forEach(entry => add(entry.file, entry.line, [5, 80], step));
    (step.exceptions || []).forEach(exception => { const [file, line] = String(exception.evidence || '').split(':'); add(file, line, [20, 20], step); });
  }));
  return { cites, tests, links: night.map.links || [] };
}

// ----- The plan -----
function plan() {
  const checks = suite();
  const reads = new Map(checks.map(check => [check.file, readsOf(check.file)]));
  const { base, files } = changedFiles();
  const sources = git(['ls-files']).split('\n').filter(name => /\.(c?js|html)$/.test(name) && !/^(node_modules|data)\//.test(name));
  const story = storyboard();
  const selected = new Map(); // check file -> reasons
  const choose = (check, reason) => { if (!selected.has(check)) selected.set(check, new Set()); selected.get(check).add(reason); };
  const touched = [];
  const crossings = [];
  const steps = new Map();
  let full = FULL ? 'asked for with --full' : '';
  const storyboardFiles = /^(docs\/storyboard\/|storyboard\.html$|scripts\/build-storyboard\.js$)/;
  const storyCheck = (checks.find(check => check.script === 'check:storyboard') || {}).file;

  files.forEach(file => {
    const entry = { file, area: areaOf(file), checks: [] };
    const lines = changedLines(base, file);
    // Only comments or blank lines changed in code: nothing it does can have changed.
    if (/\.(c?js|html|css)$/.test(file) && exists(file) && git(['ls-files', file]).trim() && lines.every(line => /^\s*(\/\/.*|\/?\*.*|<!--.*-->|)\s*$/.test(line))) {
      entry.comments = true;
      touched.push(entry);
      return;
    }
    if (/^(package-lock\.json|\.nvmrc|\.node-version)$/.test(file) || /^\.github\/workflows\/test\.yml$/.test(file)) full = full || file + ' changed: everything runs on it';
    if (file === 'package.json') {
      // Scripts only: run the checks named on the changed lines; anything else (dependencies) affects every check.
      const outside = lines.filter(line => line.trim() && !/^\s*"(check|test|build|preview|desk|sheet|publish|preflight|compare|turnout|start)[\w:-]*":/.test(line) && !/^\s*[{}],?$/.test(line));
      if (outside.length) full = full || 'package.json changed outside its scripts';
      // A check whose own script line changed, or one newly added to the `test` chain (not every check the chain names).
      const signed = changedLines(base, file, true);
      const named = sign => new Set(signed.filter(line => line[0] === sign && /"test":/.test(line)).flatMap(line => line.match(/check:[a-z0-9-]+/g) || []));
      const before = named('-');
      const names = new Set([...named('+')].filter(name => !before.has(name)));
      signed.filter(line => !/"test":/.test(line)).forEach(line => { const own = /^\s*[+-]\s*"(check:[a-z0-9-]+)":/.exec(line); if (own) names.add(own[1]); });
      names.forEach(name => checks.filter(check => check.script === name).forEach(check => { choose(check.file, 'its npm script changed'); entry.checks.push(check.file); }));
    }
    if (file !== 'package.json') checks.forEach(check => {
      if (check.file === file) { choose(check.file, 'the check itself changed'); entry.checks.push(check.file); return; }
      if (reads.get(check.file).all.has(file)) { choose(check.file, 'reads ' + file); entry.checks.push(check.file); }
    });
    if (storyboardFiles.test(file) && storyCheck) { choose(storyCheck, 'the storyboard changed'); entry.checks.push(storyCheck); }
    const cited = story.cites[file];
    if (cited) {
      const ranges = changedRanges(base, file);
      const near = cited.filter(cite => !cite.line || ranges.some(([from, to]) => to >= cite.line - cite.reach[0] && from <= cite.line + cite.reach[1]));
      near.forEach(cite => { if (!steps.has(cite.id)) steps.set(cite.id, { title: cite.title, files: new Set() }); steps.get(cite.id).files.add(file); });
      const elsewhere = new Set(cited.map(cite => cite.id).filter(id => !near.some(cite => cite.id === id)));
      if (elsewhere.size) entry.elsewhere = elsewhere.size;
      if (storyCheck) choose(storyCheck, 'a storyboard step cites ' + file);
    }
    if (/\.(c?js|html)$/.test(file) && !/(^|\/)check-/.test(file)) {
      sharedNames(file, lines).forEach((kind, name) => {
        const users = usersOf(name, kind, sources, entry.area);
        if (!users.length) return;
        crossings.push({ name, kind, from: file, users });
        // The other app's checks that read that code by name, and the ones the storyboard lists for it (some reach it
        // only through the desk simulator).
        users.forEach(user => checks.forEach(check => {
          const listed = story.tests[user] && story.tests[user].has(check.file);
          if (reads.get(check.file).direct.has(user) || listed) choose(check.file, kind + ' ' + name + ' is also used by ' + user);
        }));
      });
    }
    touched.push(entry);
  });

  const all = checks.map(check => check.file);
  if (!full && selected.size > all.length * 0.6) full = selected.size + ' of ' + all.length + ' checks read the change';
  const level = full ? 'full' : crossings.length ? 'cross-app' : selected.size ? 'focused' : 'none';
  const run = full ? all : all.filter(file => selected.has(file));
  const areas = [...new Set(touched.map(entry => entry.area))];
  const links = level === 'cross-app' ? story.links.filter(link => areas.some(area => MAP_NODE[area] && (String(link[0]).includes(MAP_NODE[area]) || String(link[1]).includes(MAP_NODE[area])))) : [];
  return { base, level, full, touched, crossings, steps, selected, run, links, total: all.length };
}

function times() { try { return JSON.parse(fs.readFileSync(TIMES, 'utf8')); } catch (error) { return {}; } }
function seconds(list) {
  const known = times();
  const measured = list.filter(file => known[file] !== undefined);
  return measured.length === list.length ? Math.round(list.reduce((sum, file) => sum + known[file], 0)) : null;
}

function report(result) {
  const out = [];
  const estimate = seconds(result.run);
  const whole = seconds(suite().map(check => check.file));
  out.push('## Test plan (against ' + BASE + ')');
  out.push('');
  const sizes = { none: 'nothing to run', focused: 'focused', 'cross-app': 'cross-app', full: 'full suite' };
  out.push('**Level: ' + sizes[result.level] + '**' + (result.full ? ' (' + result.full + ')' : '') + ' — ' + result.run.length + ' of ' + result.total + ' checks' +
    (estimate !== null ? ', about ' + estimate + ' s' : '') + (whole !== null && result.level !== 'full' ? ' (the whole suite is about ' + whole + ' s)' : ''));
  out.push('');
  out.push('**Touched**');
  const byArea = {};
  result.touched.forEach(entry => (byArea[entry.area] = byArea[entry.area] || []).push(entry));
  Object.keys(byArea).forEach(area => {
    out.push('- ' + AREA_LABEL[area] + ':');
    byArea[area].forEach(entry => {
      const code = /\.(c?js|html|css)$/.test(entry.file) && !/(^|\/)check-/.test(entry.file);
      if (entry.comments) { out.push('  - `' + entry.file + '`: comments only, nothing to run'); return; }
      out.push('  - `' + entry.file + '`' + (entry.elsewhere ? ' (' + entry.elsewhere + ' more storyboard step' + (entry.elsewhere > 1 ? 's cite' : ' cites') + ' other parts of it)' : '') + (entry.checks.length ? ': read by ' + [...new Set(entry.checks)].map(file => '`' + path.basename(file) + '`').join(', ') : code ? ': no check reads it (try it by hand if it matters)' : ''));
    });
  });
  out.push('');
  out.push('**Crosses into other apps**');
  if (!result.crossings.length) out.push('- Nothing shared with another app changed (no Sheet tab, script property, site data file or call between apps).');
  result.crossings.forEach(crossing => out.push('- ' + crossing.kind + ' `' + crossing.name + '` (changed in `' + crossing.from + '`) is also used by ' + crossing.users.map(file => '`' + file + '`').join(', ')));
  result.links.forEach(link => out.push('  - Storyboard map: ' + link[0] + ' → ' + link[1] + ': ' + link[2] + ' (if it breaks: ' + link[4] + ')'));
  out.push('');
  out.push('**Storyboard**');
  if (!result.steps.size) out.push('- Not affected: no step cites the changed files.');
  result.steps.forEach((step, id) => out.push('- `' + id + '` ' + step.title + ' (cites ' + [...step.files].map(file => '`' + file + '`').join(', ') + '): re-read it; update it only if what it says is no longer true.'));
  out.push('');
  if (result.level !== 'full' && result.run.length) {
    out.push('**Checks**');
    result.run.forEach(file => out.push('- `' + file + '`: ' + [...result.selected.get(file)].slice(0, 2).join('; ') + (result.selected.get(file).size > 2 ? '; …' : '')));
    out.push('');
  }
  out.push(result.level === 'full' ? 'Run `npm test`.' : result.run.length ? 'Run them: `npm run test:changed`. GitHub runs the whole suite on the PR.' : 'No check reads these files. GitHub runs the whole suite on the PR.');
  return out.join('\n');
}

function runChecks(list) {
  const argsOf = new Map(suite().map(check => [check.file, check.args]));
  const known = times();
  let failed = 0;
  list.forEach(file => {
    const started = Date.now();
    const result = spawnSync(process.execPath, [file].concat(argsOf.get(file) || []), { cwd: ROOT, encoding: 'utf8' });
    const took = (Date.now() - started) / 1000;
    known[file] = Math.round(took * 10) / 10;
    const ok = result.status === 0;
    if (!ok) failed += 1;
    console.log((ok ? 'pass ' : 'FAIL ') + took.toFixed(1).padStart(6) + ' s  ' + file);
    if (!ok) console.log((result.stdout + result.stderr).trim().split('\n').slice(-25).join('\n'));
  });
  try { fs.writeFileSync(TIMES, JSON.stringify(known, null, 1)); } catch (error) { /* timings are only an estimate */ }
  return failed;
}

module.exports = { suite, readsOf, sharedNames, usersOf, areaOf, storyboard };
if (require.main !== module) return;

const result = plan();
if (JSON_OUT) {
  console.log(JSON.stringify({ level: result.level, full: result.full, run: result.run, steps: [...result.steps.keys()], crossings: result.crossings, touched: result.touched }, null, 1));
} else {
  console.log(report(result));
}
if (RUN) {
  if (result.level === 'full') {
    console.log('\nRunning the whole suite (npm test)...');
    process.exit(spawnSync('npm', ['test'], { cwd: ROOT, stdio: 'inherit' }).status || 0);
  }
  console.log('');
  const failed = runChecks(result.run);
  console.log(failed ? '\n' + failed + ' check(s) failed.' : '\nAll ' + result.run.length + ' planned checks passed.');
  process.exit(failed ? 1 : 0);
}
