'use strict';

// The public website as it is deployed: _site, built by running the deploy's own "Prepare site artifact" commands
// (.github/workflows/update-data.yml) into a temporary folder. Checks that read the site from here see exactly what goes
// live, so a page that needs a file the deploy leaves out fails its check the way it fails on a phone (pay.js was once
// left out, and the live pay page showed no options).
//
//   const site = require('./lib/site-build');
//   site.read('pay.html')   // a deployed file's text; throws if the deploy does not publish it
//   site.has('pay.js')      // whether the deploy publishes it
//   site.dir()              // the built folder, built once per run and removed on exit

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const WORKFLOW = '.github/workflows/update-data.yml';
const STEP = 'Prepare site artifact';

// The step's shell lines, as written in the workflow (comments and blank lines left out).
function commands() {
  const lines = fs.readFileSync(path.join(ROOT, WORKFLOW), 'utf8').split('\n');
  const step = lines.findIndex(line => line.trim() === '- name: ' + STEP);
  if (step < 0) throw new Error(WORKFLOW + ' has no "' + STEP + '" step');
  const run = lines.findIndex((line, i) => i > step && /^\s*run: \|\s*$/.test(line));
  if (run < 0) throw new Error('the "' + STEP + '" step has no run block');
  const indent = /^\s*/.exec(lines[run])[0].length;
  const body = [];
  for (let i = run + 1; i < lines.length; i++) {
    if (lines[i].trim() && /^\s*/.exec(lines[i])[0].length <= indent) break;
    body.push(lines[i].trim());
  }
  return body.filter(line => line && !line.startsWith('#'));
}

// The repository files the deploy copies (for scripts/test-plan.js: the site check reads all of them), worked out from
// the same commands without building anything.
function sources() {
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const files = new Set([WORKFLOW]);
  commands().filter(line => /^cp\s/.test(line)).forEach(line => {
    const words = line.split(/\s+/).slice(1).filter(word => !word.startsWith('-'));
    words.slice(0, -1).forEach(source => {
      const pattern = new RegExp('^' + source.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '(/.*)?$');
      tracked.filter(file => pattern.test(file)).forEach(file => files.add(file));
    });
  });
  return [...files];
}

let built = null;
function dir() {
  if (built) return built;
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'cttc-site-'));
  const site = path.join(parent, '_site');
  // The same commands, from the repository root, with _site pointing at the temporary folder.
  const script = commands().map(line => line.replace(/(^|[\s/])_site(?=[\s/]|$)/g, (match, before) => before + JSON.stringify(site))).join('\n');
  execFileSync('bash', ['-euo', 'pipefail', '-c', script], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  process.on('exit', () => fs.rmSync(parent, { recursive: true, force: true }));
  built = site;
  return built;
}

function has(file) {
  return fs.existsSync(path.join(dir(), file));
}

function read(file, encoding = 'utf8') {
  if (!has(file)) throw new Error(file + ' is not published: the site deploy (' + WORKFLOW + ', "' + STEP + '") does not copy it');
  return fs.readFileSync(path.join(dir(), file), encoding);
}

module.exports = { dir, has, read, commands, sources, WORKFLOW };
