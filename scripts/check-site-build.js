'use strict';

// The website as deployed (_site, scripts/lib/site-build.js) is complete: every file a published page asks for is
// published too. That covers its scripts, styles, images, icons and links to other pages, the files its scripts fetch
// from data/ and assets/, the icons its Home Screen manifests name, and the images style.css uses. A file the deploy
// leaves out fails here, naming the page that needs it (pay.js was once left out, and the live pay page showed no
// options).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const site = require('./lib/site-build');

const root = site.dir();
const published = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? published(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const pages = published('').filter(file => file.endsWith('.html'));
assert.ok(pages.includes('index.html') && pages.includes('pay.html'), 'the deploy publishes the site pages');

const missing = [];
// A local address (no scheme, not just #), relative to the file that names it, without its ?query or #part.
function need(from, address) {
  if (!address || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(address) || /[{}+$]/.test(address)) return;
  const clean = decodeURI(address.split(/[?#]/)[0]);
  if (!clean) return;
  let file = path.normalize(path.join(clean.startsWith('/') ? '' : path.dirname(from), clean));
  if (clean.endsWith('/')) file = path.join(file, 'index.html');
  if (!site.has(file)) missing.push(from + ' needs ' + file);
}

pages.forEach(page => {
  const html = site.read(page);
  // Scripts, styles, images, icons, manifests and links (src, href, poster; every srcset candidate).
  for (const match of html.matchAll(/\s(?:src|href|poster)="([^"]*)"/g)) need(page, match[1]);
  for (const match of html.matchAll(/\ssrcset="([^"]*)"/g)) match[1].split(',').forEach(part => need(page, part.trim().split(/\s+/)[0]));
});

// What scripts fetch, in a page or a published script: a data/ or assets/ file named whole (not built from parts).
published('').filter(file => /\.(html|js)$/.test(file)).forEach(file => {
  for (const match of site.read(file).matchAll(/["'`]((?:data|assets)\/[\w./-]+\.\w+)["'`]/g)) need('', match[1]);
});

// Home Screen manifests name their icons relative to themselves.
published('assets').filter(file => file.endsWith('.webmanifest')).forEach(file => {
  (JSON.parse(site.read(file)).icons || []).forEach(icon => need(file, icon.src));
});

// Images the stylesheet uses.
for (const match of site.read('style.css').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) need('style.css', match[1]);

assert.deepEqual([...new Set(missing)], [], 'every file the published site asks for is published (' + site.WORKFLOW + ')');

console.log('Site build: ' + pages.length + ' pages; everything they ask for is published.');
