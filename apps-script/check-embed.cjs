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
  const listeners = {};
  const messages = [];
  const navigation = {};
  const pill = { textContent: '', disabled: null, title: '', getAttribute: name => attributes[name], addEventListener: (name, handler) => { listeners[name] = handler; } };
  const window = { cttcEmbed: embed, cttcDesk: { needsPrintSave: () => unsaved === true }, top: { postMessage: (message, origin) => messages.push([message, origin]), location: navigation } };
  const document = { getElementById: id => id === 'mode-pill' ? pill : { value: '2026-09-28' } };
  vm.runInNewContext(pillScript, { window, document, confirm: () => false });
  return { pill, click: () => listeners.click(), messages, navigation };
}
const ownEmbed = { embedded: false, topOrigin: null };
const other = 'https://script.google.com/macros/s/OTHER-id_1/exec';
let pill = runPill({ 'data-mode': 'dev', 'data-other': other }, ownEmbed);
assert.deepEqual([pill.pill.textContent, pill.pill.disabled], ['/dev', false]);
pill.click();
assert.equal(pill.navigation.href, other + '?authuser=0&date=2026-09-28', 'opened directly, it switches in the same tab and keeps the date');
pill = runPill({ 'data-mode': 'live', 'data-other': '' }, ownEmbed);
assert.deepEqual([pill.pill.textContent, pill.pill.disabled], ['/exec', true]);
assert.match(pill.pill.title, /Open \/dev once to enable switching/);
pill = runPill({ 'data-mode': 'dev', 'data-other': 'https://evil.example/exec' }, ownEmbed);
assert.equal(pill.pill.disabled, true, 'a stored address that is not a script deployment is never followed');
pill = runPill({ 'data-mode': 'live', 'data-other': '' }, { embedded: true, topOrigin: 'http://localhost:3000' });
assert.equal(pill.pill.disabled, false, 'inside the local desk page the page does the switching');
pill.click();
assert.deepEqual(JSON.parse(JSON.stringify(pill.messages)), [[{ type: 'cttc-switch', to: 'dev', date: '2026-09-28' }, 'http://localhost:3000']], 'the request goes only to the framing page');
pill = runPill({ 'data-mode': 'unknown', 'data-other': '' }, { embedded: true, topOrigin: 'http://localhost:3000' });
assert.deepEqual([pill.pill.textContent, pill.pill.disabled], ['unknown', true]);
pill = runPill({ 'data-mode': 'dev', 'data-other': other }, ownEmbed, true);
pill.click();
assert.equal(pill.navigation.href, undefined, 'unsaved changes are not thrown away without asking');

// Each deployment remembers its own address; the other one is only offered when it is a genuine deployment address.
const props = {};
const server = { PropertiesService: { getScriptProperties: () => ({ getProperty: key => props[key] === undefined ? null : props[key], setProperty: (key, value) => { props[key] = value; } }) } };
vm.createContext(server);
vm.runInContext(read('Code.js'), server);
const dev = 'https://script.google.com/macros/s/DEV-id_1/dev';
const live = 'https://script.google.com/macros/s/LIVE-id_2/exec';
assert.equal(server.deskLinks_('dev', dev), '', 'nothing to offer until the other one has been opened');
assert.equal(props.CTTC_DESK_URL_dev, dev);
assert.equal(server.deskLinks_('live', live), dev, 'the other deployment is offered once known');
assert.equal(server.deskLinks_('dev', dev), live);
props.CTTC_DESK_URL_live = 'https://evil.example/exec';
assert.equal(server.deskLinks_('dev', dev), '', 'a tampered stored value is dropped');
assert.equal(server.deskLinks_('unknown', dev), '');
assert.equal(server.deskLinks_('dev', 'https://evil.example/dev'), '', 'only script deployment addresses are stored');
assert.notEqual(props.CTTC_DESK_URL_dev, 'https://evil.example/dev');

// Framing must be allowed for the local page to embed the desk; the guard above is what limits who may.
assert.match(read('Code.js'), /\.setXFrameOptionsMode\(HtmlService\.XFrameOptionsMode\.ALLOWALL\)/);
assert.match(page, /ALLOWALL framing lets any site embed this signed-in app/);

console.log('Framing guard, mode pill, and deployment link checks passed');
