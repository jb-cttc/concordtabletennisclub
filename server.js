const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DESK_CONFIG_FILE = path.join(ROOT, 'local', 'desk.config.json');
const DESK_FRAME_FILE = path.join(ROOT, 'scripts', 'desk-frame.html');
const DESK_URL = { dev: /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/dev$/, live: /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/ };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

// The /dev and /exec addresses stay out of the public repo: read them from the environment or a git-ignored file.
function deskConfig() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(DESK_CONFIG_FILE, 'utf8')); } catch (error) { saved = {}; }
  const wanted = { dev: process.env.CTTC_DESK_DEV_URL || saved.dev, live: process.env.CTTC_DESK_EXEC_URL || saved.live };
  const config = {};
  Object.keys(DESK_URL).forEach(function (mode) {
    if (typeof wanted[mode] === 'string' && DESK_URL[mode].test(wanted[mode])) config[mode] = wanted[mode];
  });
  return config;
}

// The desk page holds private links, so it is served only to this computer, on a loopback host name.
function isLocalRequest(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  const address = String((req.socket && req.socket.remoteAddress) || '');
  return (host === 'localhost' || host === '127.0.0.1') && /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(address);
}

function serveDesk(req, res) {
  if (!isLocalRequest(req)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('The desk page is only available on this computer.');
    return;
  }
  fs.readFile(DESK_FRAME_FILE, 'utf8', function (err, template) {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
      return;
    }
    const nonce = crypto.randomBytes(16).toString('base64');
    const json = JSON.stringify(deskConfig()).replace(/</g, '\\u003c');
    const page = template.split('__NONCE__').join(nonce).split('__DESK_CONFIG__').join(json);
    res.writeHead(200, {
      'Content-Type': TYPES['.html'],
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; frame-src https://script.google.com; script-src 'nonce-" + nonce + "'; style-src 'nonce-" + nonce + "'"
    });
    res.end(page);
  });
}

function handler(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/desk') {
    serveDesk(req, res);
    return;
  }

  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch (error) { decoded = null; }
  // Private local settings and dotfiles are never served as static files.
  if (decoded === null || /(^|\/)\./.test(decoded) || /^\/local(\/|$)/i.test(decoded)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const filePath = path.join(ROOT, urlPath);

  // Prevent directory traversal outside ROOT
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = TYPES[ext] || 'text/plain; charset=utf-8';

  fs.readFile(filePath, function (err, data) {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found: ' + urlPath);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer(handler);

if (require.main === module) {
  server.listen(PORT, function () {
    console.log('CTTC dev server running at http://localhost:' + PORT);
    console.log('Desk page (dev/exec switch): http://localhost:' + PORT + '/desk');
  });
}

module.exports = { server, deskConfig, isLocalRequest };
