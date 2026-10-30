// Checks that docs/claude-code-starter-seed.md and .html carry the same content: the same headings in the same
// order and the same web addresses. Also checks that the HTML loads nothing from the web, so it opens from a text message.
// Run: npm run check:starter-seed

'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const DOCS = path.join(__dirname, '..', 'docs');
const md = fs.readFileSync(path.join(DOCS, 'claude-code-starter-seed.md'), 'utf8');
const html = fs.readFileSync(path.join(DOCS, 'claude-code-starter-seed.html'), 'utf8');
const $ = cheerio.load(html);

const failures = [];

function mdHeadings(text) {
  const out = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) { inFence = !inFence; continue; }
    const m = !inFence && line.match(/^(#{1,3}) (.+)$/);
    if (m) out.push(m[1].length + ' ' + m[2].replace(/[`*_]/g, '').trim());
  }
  return out;
}

const mdList = mdHeadings(md);
const htmlList = $('h1, h2, h3').map((_, el) => el.tagName.slice(1) + ' ' + $(el).text().replace(/\s+/g, ' ').trim()).get();
const length = Math.max(mdList.length, htmlList.length);
for (let i = 0; i < length; i++) {
  if (mdList[i] !== htmlList[i]) {
    failures.push(`Heading ${i + 1} differs: Markdown "${mdList[i] || '(none)'}", HTML "${htmlList[i] || '(none)'}"`);
    break;
  }
}

function urls(text) {
  return new Set((text.match(/https?:\/\/[^\s`)>"]+/g) || []).map((u) => u.replace(/[.,;:]+$/, '')));
}
const mdUrls = urls(md);
const htmlUrls = urls($('main').text());
for (const u of mdUrls) if (!htmlUrls.has(u)) failures.push(`Address in the Markdown but not the HTML: ${u}`);
for (const u of htmlUrls) if (!mdUrls.has(u)) failures.push(`Address in the HTML but not the Markdown: ${u}`);

$('script[src], link[rel="stylesheet"], img[src^="http"], iframe').each((_, el) => {
  failures.push(`The HTML loads an outside resource: <${el.tagName} ${$(el).attr('src') || $(el).attr('href') || ''}>`);
});

if (failures.length) {
  console.error('Starter seed checks failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log(`Starter seed checks passed (${mdList.length} headings, ${mdUrls.size} addresses match)`);
