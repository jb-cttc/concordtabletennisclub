const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const page = read('Index.html');

// The framing guard: only direct visits, the club site, and localhost (for testing) may show the app.
const guard = page.match(/<body>\s*<script>([\s\S]*?)<\/script>/)[1];
const sandbox = 'https://n-abc123-0lu-script.googleusercontent.com';
function runGuard(ancestorOrigins) {
  const appended = [];
  const window = { location: ancestorOrigins === undefined ? {} : { ancestorOrigins } };
  const document = { createElement: () => ({ style: {} }), body: { appendChild: node => appended.push(node) } };
  vm.runInNewContext(guard, { window, document, Array });
  return appended[0];
}
const framedBy = top => runGuard([sandbox, 'https://script.google.com', top]);
assert.equal(runGuard([sandbox, 'https://script.google.com']), undefined, 'opened directly');
assert.equal(framedBy('https://concordtabletennisclub.com'), undefined, 'framed by the club site');
assert.equal(framedBy('http://localhost:3000'), undefined, 'framed by a local test page');
assert.equal(framedBy('http://127.0.0.1:8080'), undefined);
for (const top of [
  'https://evil.example', 'http://concordtabletennisclub.com', 'https://www.concordtabletennisclub.com',
  'https://concordtabletennisclub.com.evil.example', 'https://evil.example/concordtabletennisclub.com',
  'https://xconcordtabletennisclub.com', 'http://localhost', 'http://localhost.evil.example:3000',
  'https://localhost:3000', 'http://evil.example:3000', 'https://latkecrszy.github.io'
]) {
  const cover = framedBy(top);
  assert.ok(cover, 'covered when framed by ' + top);
  assert.match(cover.textContent, /only be opened directly or from the club website/);
}
assert.ok(runGuard([sandbox, 'https://script.google.com', 'https://concordtabletennisclub.com', 'https://evil.example']), 'a foreign page anywhere in the chain covers it');
assert.ok(runGuard([sandbox, 'https://script.google.com', 'https://evil.example', 'https://concordtabletennisclub.com']), 'the club site cannot vouch for a page above it');
assert.ok(runGuard(['https://evil.example', 'https://script.google.com']), 'an unexpected sandbox origin covers it');
assert.ok(runGuard(['https://script.google.com']), 'an unexpected chain covers it');
assert.equal(runGuard(undefined), undefined, 'browsers that cannot report ancestors are not locked out');

// The version pill is a plain label.
const pillScript = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(source => source.includes("getElementById('mode-pill')"));
function runPill(mode) {
  const body = {};
  const pill = { textContent: '', title: '', getAttribute: () => mode };
  const document = { body: { setAttribute: (name, value) => { body[name] = value; } }, getElementById: () => pill };
  vm.runInNewContext(pillScript, { document });
  return { pill, body };
}
let pill = runPill('dev');
assert.deepEqual([pill.pill.textContent, pill.pill.title, pill.body['data-mode']], ['/dev', 'Running /dev.', 'dev']);
pill = runPill('live');
assert.deepEqual([pill.pill.textContent, pill.pill.title, pill.body['data-mode']], ['/exec', 'Running /exec.', 'live']);
pill = runPill('unknown');
assert.equal(pill.pill.textContent, 'unknown');
assert.match(page, /<span id="mode-pill" class="mode-pill" data-mode="<\?= deskMode \?>"><\/span>/, 'a label, not a control');
assert.doesNotMatch(page, /cttc-switch|window\.top\./, 'the desk never talks to or navigates the page around it');
assert.match(page, /body\[data-mode=dev\] \.top\{box-shadow:inset 0 6px 0 #e8c06a\}/, 'only the dev desk gets the amber strip');
assert.doesNotMatch(page, /body\[data-mode=live\]/);

// Framing must be allowed for the club site to embed the desk; the guard above is what limits who may.
assert.match(read('Code.js'), /\.setXFrameOptionsMode\(HtmlService\.XFrameOptionsMode\.ALLOWALL\)/);
assert.match(page, /ALLOWALL framing lets any site embed this signed-in app/);
assert.doesNotMatch(read('Code.js'), /PropertiesService.*CTTC_DESK_URL|deskLinks_/, 'no deployment addresses are stored anywhere');

console.log('Framing guard and version pill checks passed');
