const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const page = read('Index.html');

// The framing guard: only direct visits and the local desk page may show the app.
const guard = page.match(/<body>\s*<script>([\s\S]*?)<\/script>/)[1];
const sandbox = 'https://n-abc123-0lu-script.googleusercontent.com';
function runGuard(ancestorOrigins) {
  const appended = [];
  const window = { location: ancestorOrigins === undefined ? {} : { ancestorOrigins } };
  const document = { createElement: () => ({ style: {} }), body: { appendChild: node => appended.push(node) } };
  vm.runInNewContext(guard, { window, document, Array });
  return { cover: appended[0], embed: window.cttcEmbed };
}
let result = runGuard([sandbox, 'https://script.google.com']);
assert.equal(result.cover, undefined, 'opened directly');
assert.deepEqual(JSON.parse(JSON.stringify(result.embed)), { embedded: false, topOrigin: null });
result = runGuard([sandbox, 'https://script.google.com', 'http://localhost:3000']);
assert.equal(result.cover, undefined, 'framed by the local desk page');
assert.deepEqual(JSON.parse(JSON.stringify(result.embed)), { embedded: true, topOrigin: 'http://localhost:3000' });
assert.equal(runGuard([sandbox, 'https://script.google.com', 'http://127.0.0.1:8080']).embed.embedded, true);
for (const top of ['https://evil.example', 'http://localhost', 'http://localhost.evil.example:3000', 'https://localhost:3000', 'http://evil.example:3000', 'https://concordtabletennisclub.com']) {
  result = runGuard([sandbox, 'https://script.google.com', top]);
  assert.ok(result.cover, 'covered when framed by ' + top);
  assert.equal(result.embed.embedded, false);
  assert.match(result.cover.textContent, /only be opened directly or from the local desk page/);
}
assert.ok(runGuard([sandbox, 'https://script.google.com', 'http://localhost:3000', 'https://evil.example']).cover, 'a foreign page anywhere in the chain covers it');
assert.ok(runGuard(['https://evil.example', 'https://script.google.com']).cover, 'an unexpected sandbox origin covers it');
assert.ok(runGuard(['https://script.google.com']).cover, 'an unexpected chain covers it');
assert.equal(runGuard(undefined).cover, undefined, 'browsers that cannot report ancestors are not locked out');

// The mode pill.
const pillScript = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(source => source.includes("getElementById('mode-pill')"));
function runPill(attributes, embed, unsaved) {
  const body = {};
  const listeners = {};
  const messages = [];
  const navigation = {};
  const pill = { textContent: '', disabled: null, title: '', getAttribute: name => attributes[name], addEventListener: (name, handler) => { listeners[name] = handler; } };
  const window = { cttcEmbed: embed, cttcDesk: { needsPrintSave: () => unsaved === true }, top: { postMessage: (message, origin) => messages.push([message, origin]), location: navigation } };
  const document = { body: { setAttribute: (name, value) => { body[name] = value; } }, getElementById: id => id === 'mode-pill' ? pill : { value: '2026-09-28' } };
  vm.runInNewContext(pillScript, { window, document, confirm: () => false });
  return { pill, body, click: () => listeners.click(), messages, navigation };
}
const ownEmbed = { embedded: false, topOrigin: null };
const framed = { embedded: true, topOrigin: 'http://localhost:3000' };
let pill = runPill({ 'data-mode': 'dev' }, ownEmbed);
assert.deepEqual([pill.pill.textContent, pill.pill.disabled], ['/dev', true], 'opened directly, the pill is a label');
assert.equal(pill.body['data-mode'], 'dev', 'the page records which version it is');
assert.equal(pill.pill.title, 'Running /dev.');
pill = runPill({ 'data-mode': 'live' }, ownEmbed);
assert.deepEqual([pill.pill.textContent, pill.pill.disabled], ['/exec', true]);
assert.equal(pill.body['data-mode'], 'live');
pill = runPill({ 'data-mode': 'live' }, framed);
assert.equal(pill.pill.disabled, false, 'inside the local desk page the page does the switching');
assert.equal(pill.pill.title, 'Running /exec. Click to switch to /dev.');
pill.click();
assert.deepEqual(JSON.parse(JSON.stringify(pill.messages)), [[{ type: 'cttc-switch', to: 'dev', date: '2026-09-28' }, 'http://localhost:3000']], 'the request goes only to the framing page');
assert.equal(pill.navigation.href, undefined, 'the desk never navigates the page around it');
pill = runPill({ 'data-mode': 'unknown' }, framed);
assert.deepEqual([pill.pill.textContent, pill.pill.disabled], ['unknown', true]);
pill = runPill({ 'data-mode': 'dev' }, framed, true);
pill.click();
assert.deepEqual(pill.messages, [], 'unsaved changes are not thrown away without asking');
assert.doesNotMatch(read('Code.js'), /PropertiesService.*CTTC_DESK_URL|deskLinks_/, 'no deployment addresses are stored anywhere');
assert.doesNotMatch(page, /data-other|top\.location\.href/);

// Framing must be allowed for the local page to embed the desk; the guard above is what limits who may.
assert.match(read('Code.js'), /\.setXFrameOptionsMode\(HtmlService\.XFrameOptionsMode\.ALLOWALL\)/);
assert.match(page, /ALLOWALL framing lets any site embed this signed-in app/);

assert.match(page, /body\[data-mode=dev\] \.top\{box-shadow:inset 0 6px 0 #e8c06a\}/, 'only the dev desk gets the amber strip');
assert.doesNotMatch(page, /body\[data-mode=live\]/);

console.log('Framing guard and mode pill checks passed');
