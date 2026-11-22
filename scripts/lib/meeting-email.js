'use strict';

// The executive committee's DRAFT NOTES email, from a meeting (the meeting app's record) and a summary written for it
// (scripts/meeting-draft-email.js). Two parts, kept clearly apart: a short note to the person it is for (the secretary),
// then the draft itself, ready for them to edit and send on. HTML with inline styles only (what email programs keep),
// and the same content as plain text.
//
// summary: {
//   to: { name, email },                 the secretary
//   from: 'John Birch',                  who it is prepared for, named in the note
//   note: [paragraphs],                  the note to the secretary (the tracker link is added after it)
//   trackerUrl,                          the follow-up tracker
//   intro,                               the draft's opening line
//   decisions: [text],                   decisions and agreements, in order
//   agenda: [{ discussion: [text], note }],   per meeting item, in the meeting's order: what was said, and a note
//                                        such as "No decision recorded."
//   followUps: [{ owner, text, topic, due }],   the follow-ups, cleaned up; grouped by owner here
//   openQuestions: [text],               for the next meeting
//   closing,
//   names: { 'As checked in': 'Name to show' }   optional: how someone checked in under a short name is shown
// }
// Every value is text: it is escaped here, so nothing in a meeting can add markup to the email.

const GREEN = '#145a3c';
const ORANGE = '#f58220';
const INK = '#17211b';
const MUTED = '#5d6a62';

const esc = value => String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const longDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value || '';
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

function attendees(meeting, names) {
  const here = (meeting.attendees || []).filter(p => p.present !== false).map(p => Object.assign({}, p, { name: (names || {})[p.name] || p.name }));
  const officers = here.filter(p => p.role && !/^(board|guest)$/i.test(p.role));
  const guests = here.filter(p => /^guest$/i.test(p.role));
  const board = here.filter(p => officers.indexOf(p) < 0 && guests.indexOf(p) < 0);
  return { officers, board, guests, count: here.length };
}

// Follow-ups by owner: owners with the most first, then A to Z; no owner last.
function byOwner(followUps) {
  const groups = new Map();
  followUps.forEach(f => {
    const key = (f.owner || '').trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  });
  return [...groups.entries()].sort((a, b) => (!a[0]) - (!b[0]) || b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

function subject(meeting) {
  return '[DRAFT NOTES] ' + (meeting.title || 'CTTC Executive Committee Meeting') + ' – ' + longDate(meeting.date);
}

function html(meeting, summary) {
  const people = attendees(meeting, summary.names);
  const items = meeting.items || [];
  const agenda = summary.agenda || [];
  const groups = byOwner(summary.followUps || []);
  const h2 = text => `<h2 style="margin:28px 0 10px;font:700 18px/1.3 Arial,Helvetica,sans-serif;color:${GREEN};border-bottom:2px solid ${GREEN};padding-bottom:6px">${esc(text)}</h2>`;
  const li = text => `<li style="margin:0 0 6px">${esc(text)}</li>`;
  const names = list => list.map(p => esc(p.name) + (p.role && !/^(board|guest)$/i.test(p.role) ? ' (' + esc(p.role) + ')' : '')).join(', ');

  const note = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px dashed #c99934;background:#fffaf0;border-radius:8px">
    <tr><td style="padding:16px 20px;font:15px/1.55 Arial,Helvetica,sans-serif;color:${INK}">
      <div style="font:700 12px Arial,Helvetica,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8a6a12;margin-bottom:8px">Note for ${esc(summary.to.name.split(' ')[0])} – not part of the draft</div>
      ${(summary.note || []).map(p => `<p style="margin:0 0 10px">${esc(p)}</p>`).join('')}
      <p style="margin:0 0 10px"><strong>Follow-up tracker:</strong> <a href="${esc(summary.trackerUrl)}" style="color:${GREEN};font-weight:700">${esc(summary.trackerUrl.replace(/^https?:\/\//, ''))}</a> (click <strong>Tracker</strong> at the top; it opens with the club's Google account). Every follow-up below is in it, with its owner, status and progress updates.</p>
    </td></tr>
  </table>
  <p style="margin:22px 0;text-align:center;font:700 12px Arial,Helvetica,sans-serif;letter-spacing:.18em;color:${MUTED}">✂ — — — DRAFT NOTES BEGIN BELOW — — — ✂</p>`;

  const header = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${GREEN};border-radius:8px 8px 0 0;border-bottom:4px solid ${ORANGE}">
    <tr><td style="padding:18px 22px;color:#fff;font-family:Arial,Helvetica,sans-serif">
      <div style="display:inline-block;background:${ORANGE};color:#2b1300;font:800 11px Arial,sans-serif;letter-spacing:.12em;padding:3px 9px;border-radius:999px;margin-bottom:8px">DRAFT</div>
      <div style="font:700 22px/1.25 Arial,Helvetica,sans-serif">${esc(meeting.title || 'CTTC Executive Committee Meeting')}</div>
      <div style="font:15px Arial,Helvetica,sans-serif;color:#d8eadf;margin-top:4px">${esc(longDate(meeting.date))}</div>
    </td></tr>
  </table>`;

  const attendeeBlock = `
  ${h2('Attendees (' + people.count + ')')}
  <table role="presentation" cellpadding="0" cellspacing="0" style="font:15px/1.5 Arial,Helvetica,sans-serif;color:${INK}">
    ${people.officers.length ? `<tr><td style="padding:2px 14px 2px 0;color:${MUTED};vertical-align:top;white-space:nowrap">Officers</td><td style="padding:2px 0">${names(people.officers)}</td></tr>` : ''}
    ${people.board.length ? `<tr><td style="padding:2px 14px 2px 0;color:${MUTED};vertical-align:top;white-space:nowrap">Board</td><td style="padding:2px 0">${names(people.board)}</td></tr>` : ''}
    ${people.guests.length ? `<tr><td style="padding:2px 14px 2px 0;color:${MUTED};vertical-align:top;white-space:nowrap">Guests</td><td style="padding:2px 0">${names(people.guests)}</td></tr>` : ''}
  </table>`;

  const decisions = (summary.decisions || []).length ? `
  ${h2('Decisions and agreements')}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f8f4;border-left:4px solid ${GREEN};border-radius:4px">
    <tr><td style="padding:12px 16px"><ul style="margin:0;padding-left:20px;font:15px/1.5 Arial,Helvetica,sans-serif;color:${INK}">${summary.decisions.map(li).join('')}</ul></td></tr>
  </table>` : '';

  const followUps = groups.length ? `
  ${h2('Follow-ups (' + (summary.followUps || []).length + ')')}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font:14px/1.45 Arial,Helvetica,sans-serif;color:${INK}">
    <tr style="background:${GREEN};color:#fff"><th align="left" style="padding:8px 10px;width:19%">Owner</th><th align="left" style="padding:8px 10px">Action</th><th align="left" style="padding:8px 10px;width:20%">Agenda topic</th><th align="left" style="padding:8px 10px;width:9%">Due</th></tr>
    ${groups.map(([owner, list], g) => list.map((f, i) => `<tr style="background:${g % 2 ? '#ffffff' : '#f7f9f6'};border-top:${i ? '1px solid #e3e8e4' : '2px solid #c9d2cb'}">
      ${i ? '' : `<td rowspan="${list.length}" style="padding:9px 10px;vertical-align:top;font-weight:700">${owner ? esc(owner) : '<span style="color:#a43831">Owner needed</span>'}</td>`}
      <td style="padding:9px 10px;vertical-align:top"><span style="color:${ORANGE};font-size:16px">●</span>&nbsp;${esc(f.text)}</td>
      <td style="padding:9px 10px;vertical-align:top;color:${MUTED}">${esc(f.topic || '')}</td>
      <td style="padding:9px 10px;vertical-align:top;color:${MUTED};white-space:nowrap">${esc(f.due || 'TBD')}</td></tr>`).join('')).join('')}
  </table>` : '';

  const agendaBlock = `
  ${h2('Agenda and discussion')}
  ${items.map((it, n) => {
    const s = agenda[n] || {};
    const sub = (it.details || '').split('\n').map(x => x.trim()).filter(Boolean);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border:1px solid #e3e8e4;border-radius:6px">
      <tr><td style="padding:12px 16px;font:15px/1.5 Arial,Helvetica,sans-serif;color:${INK}">
        <div style="font-weight:700;font-size:16px"><span style="color:${MUTED}">${n + 1}.</span> ${esc(it.title)}${it.added ? ' <span style="font:700 11px Arial,sans-serif;background:#e7f0ff;color:#1f4f8f;padding:1px 6px;border-radius:999px;vertical-align:middle">ADDED</span>' : ''}${it.status === 'tabled' ? ' <span style="font:700 11px Arial,sans-serif;background:#fff2cc;color:#7a5a00;padding:1px 6px;border-radius:999px;vertical-align:middle">NEXT MEETING</span>' : ''}</div>
        ${sub.length ? `<div style="margin:6px 0 0;color:${MUTED};font-size:14px">On the agenda: ${sub.map(x => esc(x.replace(/^[–-]\s*/, ''))).join(' · ')}</div>` : ''}
        ${(s.discussion || []).length ? `<ul style="margin:8px 0 0;padding-left:20px">${s.discussion.map(li).join('')}</ul>` : ''}
        ${s.note ? `<div style="margin-top:6px;color:${MUTED};font-style:italic;font-size:14px">${esc(s.note)}</div>` : ''}
      </td></tr></table>`;
  }).join('')}`;

  const open = (summary.openQuestions || []).length ? `
  ${h2('Open questions for the next meeting')}
  <ul style="margin:0;padding-left:20px;font:15px/1.5 Arial,Helvetica,sans-serif;color:${INK}">${summary.openQuestions.map(li).join('')}</ul>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject(meeting))}</title></head>
<body style="margin:0;padding:0;background:#eef2ed">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2ed"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border-radius:10px"><tr><td style="padding:22px 24px 28px">
  ${note}
  ${header}
  <div style="padding:6px 2px 0">
    ${summary.intro ? `<p style="font:15px/1.55 Arial,Helvetica,sans-serif;color:${INK};margin:18px 0 0">${esc(summary.intro)}</p>` : ''}
    ${attendeeBlock}
    ${decisions}
    ${followUps}
    ${agendaBlock}
    ${open}
    ${summary.closing ? `<p style="font:15px/1.55 Arial,Helvetica,sans-serif;color:${INK};margin:24px 0 0">${esc(summary.closing)}</p>` : ''}
  </div>
</td></tr></table>
</td></tr></table>
</body></html>`;
}

function text(meeting, summary) {
  const people = attendees(meeting, summary.names);
  const out = [];
  const rule = '-'.repeat(60);
  out.push('NOTE FOR ' + summary.to.name.split(' ')[0].toUpperCase() + ' (not part of the draft)', '');
  (summary.note || []).forEach(p => out.push(p, ''));
  out.push('Follow-up tracker: ' + summary.trackerUrl + ' (click Tracker at the top; it opens with the club\'s Google account).', '', rule, 'DRAFT NOTES BEGIN BELOW', rule, '');
  out.push('DRAFT: ' + (meeting.title || 'CTTC Executive Committee Meeting'), longDate(meeting.date), '');
  if (summary.intro) out.push(summary.intro, '');
  out.push('ATTENDEES (' + people.count + ')');
  const list = l => l.map(p => p.name + (p.role && !/^(board|guest)$/i.test(p.role) ? ' (' + p.role + ')' : '')).join(', ');
  if (people.officers.length) out.push('  Officers: ' + list(people.officers));
  if (people.board.length) out.push('  Board: ' + list(people.board));
  if (people.guests.length) out.push('  Guests: ' + list(people.guests));
  if ((summary.decisions || []).length) { out.push('', 'DECISIONS AND AGREEMENTS'); summary.decisions.forEach(d => out.push('  - ' + d)); }
  const groups = byOwner(summary.followUps || []);
  if (groups.length) {
    out.push('', 'FOLLOW-UPS (' + summary.followUps.length + ')');
    groups.forEach(([owner, l]) => { out.push('  ' + (owner || 'Owner needed')); l.forEach(f => out.push('    - ' + f.text + (f.topic ? ' [' + f.topic + ']' : '') + ' (due ' + (f.due || 'TBD') + ')')); });
  }
  out.push('', 'AGENDA AND DISCUSSION');
  (meeting.items || []).forEach((it, n) => {
    const s = (summary.agenda || [])[n] || {};
    out.push('', (n + 1) + '. ' + it.title + (it.added ? ' (added)' : ''));
    const sub = (it.details || '').split('\n').map(x => x.trim()).filter(Boolean);
    if (sub.length) out.push('   On the agenda: ' + sub.map(x => x.replace(/^[–-]\s*/, '')).join(' / '));
    (s.discussion || []).forEach(d => out.push('   - ' + d));
    if (s.note) out.push('   ' + s.note);
  });
  if ((summary.openQuestions || []).length) { out.push('', 'OPEN QUESTIONS FOR THE NEXT MEETING'); summary.openQuestions.forEach(q => out.push('  - ' + q)); }
  if (summary.closing) out.push('', summary.closing);
  return out.join('\n');
}

module.exports = { subject, html, text, byOwner, attendees };
