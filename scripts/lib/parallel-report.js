'use strict';

const { CODES } = require('./parallel-compare');

const LABELS = {
  same: '1 · Same results, no issues',
  expected: '2 · Different rankings or records, all expected',
  review: '3 · Unexpected differences: review',
  pending: 'Waiting for the other side'
};

function esc(value) {
  return String(value).replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

function findingRows(findings) {
  if (!findings.length) return '';
  return '<table><thead><tr><th>Level</th><th>Code</th><th>Group</th><th>Detail</th></tr></thead><tbody>' +
    findings.map(function (item) {
      return '<tr class="' + item.level + '"><td>' + item.level + '</td><td title="' + esc(CODES[item.code].text) + '">' + esc(item.code) +
        '</td><td>' + esc(item.group) + '</td><td>' + esc(item.detail) + '</td></tr>';
    }).join('') + '</tbody></table>';
}

function renderHtml(results, counts, meta) {
  const sessions = results.slice().reverse().map(function (result) {
    return '<details class="' + result.status + '"' + (result.status === 'review' ? ' open' : '') + '><summary><strong>' + esc(result.date) +
      '</strong> <span class="badge ' + result.status + '">' + esc(LABELS[result.status]) + '</span>' +
      (result.note ? ' <em>' + esc(result.note) + '</em>' : '') + '</summary>' + findingRows(result.findings) + '</details>';
  }).join('\n');
  const legend = Object.keys(CODES).map(function (code) {
    return '<tr class="' + CODES[code].level + '"><td>' + esc(code) + '</td><td>' + CODES[code].level + '</td><td>' + esc(CODES[code].title) +
      '</td><td>' + esc(CODES[code].text) + '</td></tr>';
  }).join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><title>Parallel operations comparison</title>' +
    '<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;max-width:1100px}table{border-collapse:collapse;margin:8px 0 16px;width:100%}' +
    'th,td{border:1px solid #ddd;padding:4px 8px;text-align:left;vertical-align:top}tr.expected td{background:#fff9e5}tr.unexpected td{background:#fde8e8}' +
    'details{margin:8px 0}summary{cursor:pointer}.badge{padding:2px 8px;border-radius:10px;font-size:12px}' +
    '.same{color:#14532d}.badge.same{background:#dcfce7}.badge.expected{background:#fef3c7}.badge.review{background:#fee2e2}.badge.pending{background:#e5e7eb}</style>' +
    '<h1>Parallel operations: Access vs desk</h1><p>Admin only. Generated ' + esc(meta.generatedAt) + (meta.since ? ' for sessions from ' + esc(meta.since) : '') +
    '. Same: ' + counts.same + ' · Expected: ' + counts.expected + ' · Review: <strong>' + counts.review + '</strong> · Waiting: ' + counts.pending + '</p>' +
    sessions + '<h2>What each code means</h2><table><thead><tr><th>Code</th><th>Level</th><th>Title</th><th>Meaning</th></tr></thead><tbody>' + legend + '</tbody></table></html>\n';
}

module.exports = { LABELS, renderHtml };
