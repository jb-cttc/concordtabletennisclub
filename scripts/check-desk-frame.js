'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');

const DEV = 'https://script.google.com/macros/s/DEV-id_1/dev';
const LIVE = 'https://script.google.com/macros/s/LIVE-id_2/exec';
process.env.CTTC_DESK_DEV_URL = DEV;
process.env.CTTC_DESK_EXEC_URL = LIVE;
const { server, deskConfig, isLocalRequest } = require('../server');

function get(port, requestPath, headers) {
  return new Promise(function (resolve, reject) {
    const request = http.request({ host: '127.0.0.1', port, path: requestPath, method: 'GET', headers: { Host: 'localhost:' + port, ...headers } }, function (response) {
      let body = '';
      response.on('data', function (chunk) { body += chunk; });
      response.on('end', function () { resolve({ status: response.statusCode, headers: response.headers, body }); });
    });
    request.on('error', reject);
    request.end();
  });
}

async function main() {
  // Configuration comes from the environment or the ignored file, and only genuine deployment addresses are accepted.
  assert.deepEqual({ ...deskConfig() }, { dev: DEV, live: LIVE });
  process.env.CTTC_DESK_DEV_URL = 'https://evil.example/macros/s/x/dev';
  process.env.CTTC_DESK_EXEC_URL = 'https://script.google.com/macros/s/LIVE-id_2/dev';
  const rejected = deskConfig();
  assert.notEqual(rejected.dev, 'https://evil.example/macros/s/x/dev');
  assert.notEqual(rejected.live, 'https://script.google.com/macros/s/LIVE-id_2/dev', 'an /exec slot will not take a /dev address');
  process.env.CTTC_DESK_DEV_URL = DEV;
  process.env.CTTC_DESK_EXEC_URL = LIVE;

  assert.equal(isLocalRequest({ headers: { host: 'localhost:3000' }, socket: { remoteAddress: '127.0.0.1' } }), true);
  assert.equal(isLocalRequest({ headers: { host: '127.0.0.1:3000' }, socket: { remoteAddress: '::1' } }), true);
  assert.equal(isLocalRequest({ headers: { host: 'localhost:3000' }, socket: { remoteAddress: '192.168.1.20' } }), false, 'another computer on the network');
  assert.equal(isLocalRequest({ headers: { host: 'evil.example' }, socket: { remoteAddress: '127.0.0.1' } }), false, 'a rebinding host name');
  assert.equal(isLocalRequest({ headers: {}, socket: {} }), false);

  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  try {
    const desk = await get(port, '/desk?mode=dev');
    assert.equal(desk.status, 200);
    assert.equal(desk.headers['x-frame-options'], 'DENY');
    assert.equal(desk.headers['cache-control'], 'no-store');
    const nonce = /script-src 'nonce-([^']+)'/.exec(desk.headers['content-security-policy'])[1];
    assert.match(desk.headers['content-security-policy'], /default-src 'none'; frame-src https:\/\/script\.google\.com;/);
    assert.equal(desk.body.split('nonce="' + nonce + '"').length - 1, 2, 'both inline blocks carry the request nonce');
    assert(!desk.body.includes('__NONCE__') && !desk.body.includes('__DESK_CONFIG__'));
    assert(desk.body.includes(DEV) && desk.body.includes(LIVE));
    const second = await get(port, '/desk');
    assert.notEqual(/script-src 'nonce-([^']+)'/.exec(second.headers['content-security-policy'])[1], nonce, 'a new nonce every request');

    assert.equal((await get(port, '/desk', { Host: 'evil.example' })).status, 403, 'the desk page is not served to other host names');
    assert.equal((await get(port, '/local/desk.config.json')).status, 403, 'the private settings are not a static file');
    assert.equal((await get(port, '/LOCAL/desk.config.json')).status, 403);
    assert.equal((await get(port, '/%6Cocal/desk.config.json')).status, 403, 'encoded paths are checked after decoding');
    assert.equal((await get(port, '/.gitignore')).status, 403);
    assert.equal((await get(port, '/.git/config')).status, 403);
    assert.equal((await get(port, '/%2e%2e/package.json')).status, 403);
    assert.equal((await get(port, '/%zz')).status, 403, 'a malformed path is refused, not crashed on');
    assert.equal((await get(port, '/index.html')).status, 200, 'the site itself is still served');
    assert.equal((await get(port, '/')).status, 200);
    assert.equal((await get(port, '/nothing-here.html')).status, 404);
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }

  // The page script: opens the chosen deployment and obeys only the desk's own switch requests.
  const template = fs.readFileSync(path.join(__dirname, 'desk-frame.html'), 'utf8');
  function run(config, search, stored) {
    const script = /<script nonce="__NONCE__">([\s\S]*?)<\/script>/.exec(template)[1].replace('__DESK_CONFIG__', JSON.stringify(config));
    const listeners = {};
    const frame = { hidden: true, src: '' };
    const notice = { hidden: true, innerHTML: '' };
    const saved = stored === undefined ? {} : { 'cttc-desk-mode': stored };
    const document = { title: '', getElementById: id => id === 'desk' ? frame : notice };
    const location = { search };
    const history = { url: null, replaceState: (_a, _b, url) => { history.url = url; } };
    const window = { addEventListener: (name, handler) => { listeners[name] = handler; } };
    vm.runInNewContext(script, { window, document, location, history, URL, URLSearchParams, localStorage: { getItem: key => saved[key] || null, setItem: (key, value) => { saved[key] = value; } } });
    return { frame, notice, document, history, saved, message: (origin, data) => listeners.message({ origin, data }) };
  }
  const sandbox = 'https://n-abc123-0lu-script.googleusercontent.com';
  let page = run({ dev: DEV, live: LIVE }, '?mode=dev');
  assert.equal(page.frame.src, DEV);
  assert.equal(page.document.title, 'CTTC Desk (/dev)');
  assert.equal(page.saved['cttc-desk-mode'], 'dev');
  assert.equal(page.history.url, '?mode=dev');
  page = run({ dev: DEV, live: LIVE }, '?date=2026-09-28', 'dev');
  assert.equal(page.frame.src, DEV + '?date=2026-09-28', 'the last choice is remembered and the date passed on');
  page = run({ dev: DEV, live: LIVE }, '');
  assert.equal(page.frame.src, LIVE, 'the live desk is the default');
  page = run({ dev: DEV, live: LIVE }, '?mode=whatever&date=not-a-date');
  assert.equal(page.frame.src, LIVE, 'an unknown mode falls back to live and a bad date is ignored');
  page.message(sandbox, { type: 'cttc-switch', to: 'dev', date: '2026-09-29' });
  assert.equal(page.frame.src, DEV + '?date=2026-09-29', 'the desk can ask for the other deployment');
  assert.equal(page.document.title, 'CTTC Desk (/dev)');
  page.message('https://evil.example', { type: 'cttc-switch', to: 'live', date: '' });
  page.message('https://script.google.com', { type: 'cttc-switch', to: 'live', date: '' });
  page.message(sandbox + '.evil.example', { type: 'cttc-switch', to: 'live', date: '' });
  assert.equal(page.frame.src, DEV + '?date=2026-09-29', 'requests from any other origin are ignored');
  page.message(sandbox, { type: 'cttc-switch', to: 'https://evil.example' });
  page.message(sandbox, { type: 'other', to: 'live' });
  page.message(sandbox, null);
  page.message(sandbox, 'cttc-switch');
  assert.equal(page.frame.src, DEV + '?date=2026-09-29', 'malformed requests are ignored');
  page.message(sandbox, { type: 'cttc-switch', to: 'live', date: '"><script>' });
  assert.equal(page.frame.src, LIVE, 'a bad date is dropped rather than passed on');
  page = run({}, '');
  assert.equal(page.notice.hidden, false, 'without configuration the page explains what to set up');
  assert.equal(page.frame.hidden, true);
  assert.match(page.notice.innerHTML, /local\/desk\.config\.json/);

  console.log('Local desk page checks passed');
}

main().catch(function (error) { console.error(error); process.exitCode = 1; });
