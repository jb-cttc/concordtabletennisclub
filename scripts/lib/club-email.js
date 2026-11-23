'use strict';

// A short club message sent from the club account through the meeting mailer (meeting-mailer/, sendClubMessage), such
// as a coaching update for a coach. scripts/club-email.js builds it from <dir>/message.json, written by hand:
//
// message: {
//   to: [{ name, email }],          1 to 20 people (the club account is copied on every send, on top)
//   subject: 'Coaching update',     shown after "[CTTC] "
//   body: 'Hi Raymond, ...',        plain text: paragraphs split by a blank line; a paragraph whose lines all start with
//                                   "- " is a list, "1. " a numbered list; **bold**; web addresses become links
//   from: 'John Birch'              who asked for it, named in the footer
// }
// Every value is text: it is escaped here, so nothing in a message can add markup. HTML with inline styles only (what
// email programs keep), and the same content as plain text. The footer says the club account sent it, written by an
// AI assistant at the named person's request, and that a reply reaches the club.

const GREEN = '#145a3c';
const INK = '#17211b';
const MUTED = '#5d6a62';

const esc = value => String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const URL = /\bhttps:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g;

// **bold** and links, on text already escaped.
function inline(text) {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(URL, url => '<a href="' + url + '" style="color:' + GREEN + '">' + url + '</a>');
}

function blocks(body) {
  return String(body || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(block => block.trim()).filter(Boolean).map(block => {
    const lines = block.split('\n').map(line => line.trim());
    if (lines.every(line => /^- /.test(line))) return { list: 'ul', items: lines.map(line => line.slice(2)) };
    if (lines.every(line => /^\d+\. /.test(line))) return { list: 'ol', items: lines.map(line => line.replace(/^\d+\. /, '')) };
    return { lines };
  });
}

function check(message) {
  const to = Array.isArray(message.to) ? message.to : [];
  if (!to.length || to.length > 20 || !to.every(person => person && person.name && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email || ''))) {
    throw new Error('message.json needs to: [{ name, email }], 1 to 20 people.');
  }
  if (!String(message.subject || '').trim() || /[\r\n]/.test(message.subject) || /^\[/.test(message.subject)) throw new Error('message.json needs subject: one line, without [CTTC] (it is added).');
  if (!String(message.body || '').trim()) throw new Error('message.json needs body.');
  if (!String(message.from || '').trim()) throw new Error('message.json needs from: who asked for it.');
  return message;
}

function subject(message) { return '[CTTC] ' + String(check(message).subject).trim(); }

function footer(message) {
  return 'Sent from the Concord Table Tennis Club account by Claude, an AI assistant, at ' + String(message.from).trim() +
    '’s request. Reply to this email to reach the club.';
}

function html(message) {
  check(message);
  const p = 'margin:0 0 14px;font:15px/1.5 Arial,Helvetica,sans-serif;color:' + INK;
  const parts = blocks(message.body).map(block => block.list ?
    '<' + block.list + ' style="margin:0 0 14px;padding-left:22px;font:15px/1.5 Arial,Helvetica,sans-serif;color:' + INK + '">' +
      block.items.map(item => '<li style="margin:0 0 6px">' + inline(item) + '</li>').join('') + '</' + block.list + '>' :
    '<p style="' + p + '">' + block.lines.map(inline).join('<br>') + '</p>');
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f4f6f4">' +
    '<div style="max-width:600px;margin:0 auto;padding:20px 16px">' +
    '<div style="border-top:4px solid ' + GREEN + ';background:#fff;padding:20px 22px;border-radius:4px">' +
    '<p style="margin:0 0 16px;font:700 13px Arial,Helvetica,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:' + GREEN + '">Concord Table Tennis Club</p>' +
    parts.join('') +
    '<p style="margin:18px 0 0;padding-top:12px;border-top:1px solid #dfe5e1;font:12px/1.5 Arial,Helvetica,sans-serif;color:' + MUTED + '">' + esc(footer(message)) + '</p>' +
    '</div></div></body></html>';
}

function text(message) {
  check(message);
  const parts = blocks(message.body).map(block => block.list ?
    block.items.map((item, index) => (block.list === 'ol' ? (index + 1) + '. ' : '- ') + item.replace(/\*\*([^*]+)\*\*/g, '$1')).join('\n') :
    block.lines.map(line => line.replace(/\*\*([^*]+)\*\*/g, '$1')).join('\n'));
  return parts.join('\n\n') + '\n\n--\n' + footer(message) + '\n';
}

module.exports = { subject, html, text, check, blocks };
