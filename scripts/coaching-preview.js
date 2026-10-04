// Run: npm run preview:coaching   then open http://localhost:3200/coaching.html
// Dev only. Serves the real coaching page and the real coaching-app/Index.html, with the real coaching-app/Code.js
// running against an in-memory Sheet and a fake mailbox, so the whole flow can be clicked through without Google.
// Nothing here talks to Google, sends email, or touches a real Sheet. Emails and texts the app "sends" appear at /mail, where
// a click stands in for a YES or NO reply.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'coaching-app');
const PORT = Number(process.env.PORT || 3200);
const LOCAL = 'http://localhost:' + PORT;

const grids = {};
const outbox = [];
const properties = {};
// Stand-in for Google Voice: each message is a text forwarded to Gmail; replying to it is a text sent back to the coach.
const inbox = [];
const texts = [];
// Stand-in for email replies to the app's questions (subjects carrying [CTTC ref ...]).
const answers = [];
let messageCount = 0;
function inbound(name, body, at, digits) {
  const from = '"' + name + ' (SMS)" <19255550100.1' + (digits || '9255550142') + '.preview@txt.voice.google.com>';
  const id = 'preview-' + messageCount++;
  inbox.push({
    getId: () => id, getFrom: () => from, getReplyTo: () => from, getSubject: () => 'New text message from ' + name,
    getPlainBody: () => '<https://voice.google.com>\n' + body + '\nTo respond to this text message, reply to this email or visit Google Voice.',
    getDate: () => new Date(at || Date.now()),
    reply: text => { texts.unshift({ at: new Date(), to: name, body: text }); }
  });
}
let cache = {};
let activeEmail = '';
const makeSheet = name => {
  const grid = grids[name] = [];
  return {
    getLastRow: () => grid.length,
    getDataRange: () => ({ getValues: () => grid.map(line => line.slice()) }),
    getRange: (row, column, rows, columns) => {
      const handle = {
        setValues: values => { values.forEach((line, r) => line.forEach((value, c) => { (grid[row - 1 + r] = grid[row - 1 + r] || [])[column - 1 + c] = value; })); return handle; },
        setNumberFormat: () => handle,
        setFontWeight: () => handle
      };
      return handle;
    },
    deleteRow: row => { grid.splice(row - 1, 1); },
    clearContents: () => { grid.length = 0; },
    setFrozenRows: () => {}
  };
};
const books = {};
const makeBook = (id, url) => {
  const sheets = {};
  return (books[id] = {
    getSheetByName: name => sheets[name] || null,
    insertSheet: name => (sheets[name] = makeSheet(name)),
    getSheets: () => Object.keys(sheets),
    deleteSheet: () => {},
    getUrl: () => url
  });
};
const pacific = ms => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day + ' ' + parts.hour + ':' + parts.minute;
};
const base64 = bytes => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const context = {
  Date, Math, Number, String, JSON, Object, console,
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) },
  SpreadsheetApp: {
    create: name => {
      const id = /public/.test(name) ? 'preview-public' : 'preview-private';
      const book = makeBook(id, LOCAL + (id === 'preview-public' ? '/schedule' : '/mail'));
      return { getId: () => id, getUrl: () => book.getUrl() };
    },
    openById: id => books[id]
  },
  Session: { getActiveUser: () => ({ getEmail: () => activeEmail }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create: () => {} }), everyMinutes: () => ({ create: () => {} }) }) }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  CacheService: { getScriptCache: () => ({ get: key => cache[key] || null, put: (key, value) => { cache[key] = value; }, remove: key => { delete cache[key]; } }) },
  MailApp: { getRemainingDailyQuota: () => 100, sendEmail: message => { outbox.unshift(Object.assign({ at: new Date(), id: 'mail-' + messageCount++ }, message)); } },
  GmailApp: {
    getInboxUnreadCount: () => 0,
    search: query => {
      const list = /CTTC ref/.test(query) ? answers : inbox;
      return list.length ? [{ getMessages: () => list.slice() }] : [];
    }
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    base64Encode: text => Buffer.from(text, 'utf8').toString('base64'),
    getUuid: () => crypto.randomUUID(),
    computeDigest: (algorithm, value) => Array.from(crypto.createHash(algorithm).update(value).digest()),
    computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256', key).update(value).digest()),
    base64EncodeWebSafe: input => base64(typeof input === 'string' ? Buffer.from(input, 'utf8') : input),
    base64DecodeWebSafe: text => Array.from(Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
    formatDate: (date) => pacific(date.getTime())
  },
  HtmlService: {}
};
vm.createContext(context);
const source = fs.readFileSync(path.join(APP, 'Code.js'), 'utf8');
vm.runInContext(source, context);
const exposed = new Set([...source.matchAll(/^function ([A-Za-z0-9]+)\(/gm)].map(match => match[1]).filter(name => !name.endsWith('_') && !['doGet', 'setup'].includes(name)));
const call = (name, ...args) => JSON.parse(JSON.stringify(context[name](...args) ?? null));

// Demo data: two coaches with slots and one waiting request, all synthetic.
activeEmail = 'owner@example.com';
context.setup();
activeEmail = '';
// The owner keeps the coach list in the private Coaches tab (name as saved in Google Voice, email, mobile). Each coach texts
// COACH once; then a list of times sent from the page is published by their YES.
function yes(name, digits) {
  inbound(name, 'YES', Date.now() + 1000, digits);
  cache = {};
  call('checkTexts');
  // Dropped so this setup YES, stamped a second ahead, cannot answer the next question too.
  inbox.pop();
}
// An email reply from whoever the message went to; only the first line (YES or NO) matters to the app.
function answerEmail(message, word) {
  const at = new Date(Date.now() + 1000);
  const id = 'answer-' + messageCount++;
  answers.push({ getId: () => id, getFrom: () => message.to, getSubject: () => 'Re: ' + message.subject, getDate: () => at, getPlainBody: () => word + '\n\n> ' + message.subject });
  cache = {};
  call('checkTexts');
}
function answerLatest(to, pattern, word) {
  const message = outbox.find(entry => entry.to === to && pattern.test(entry.subject));
  if (message) answerEmail(message, word);
}
function demoCoach(name, email, plan, phone) {
  grids.Coaches.push([name, email, phone, '', '', '', '', '', '', '', '']);
  call('coachList');
  const id = grids.Coaches[grids.Coaches.length - 1][4];
  const digits = phone.replace(/\D/g, '');
  inbound(name, 'COACH', Date.now() - 60000, digits);
  const days = call('coachBoard', id).days.filter(day => day.date > new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10));
  const slots = [];
  days.slice(0, 4).forEach(day => (plan[new Date(day.date + 'T00:00:00Z').getUTCDay()] || []).forEach(([start, minutes]) => slots.push({ date: day.date, start, minutes, table: 1 })));
  cache = {};
  call('coachPropose', id, slots);
  yes(name, digits);
}
// Made-up coaches and bookings, only with DEMO=1. Without it the preview shows what setup() gives the real app: the five club coaches.
if (process.env.DEMO === '1') {
demoCoach('Olaf Demo', 'olaf.demo@example.com', { 5: [['19:00', 60], ['20:00', 30], ['20:30', 30], ['21:00', 60]], 6: [['15:00', 60], ['16:00', 30], ['16:30', 30], ['17:00', 60]] }, '925-555-0142');
demoCoach('Mia Demo', 'mia.demo@example.com', { 5: [['19:00', 60], ['20:00', 30], ['20:30', 30]], 6: [['15:30', 30], ['16:00', 60]] }, '925-555-0143');
// A third coach at Friday 7 PM fills both tables, so only that time shows Table 3.
demoCoach('Kai Demo', 'kai.demo@example.com', { 5: [['19:00', 60]] }, '925-555-0144');
const first = call('openSlots').slots[0];
const second = call('openSlots').slots.find(slot => slot.coach !== first.coach);
call('requestSlot', { key: first.key, name: 'Sample Student', email: 'sample.student@example.com', phone: '(925) 555-0177', note: 'Beginner, right handed' });
answerLatest('sample.student@example.com', /^Confirm your coaching request/, 'YES');
call('requestSlot', { key: second.key, name: 'Another Student', email: 'another.student@example.com' });
answerLatest('another.student@example.com', /^Confirm your coaching request/, 'YES');
// The second coach answers YES, so the board shows both a "Requested" and a "Booked" row.
{
  const coach = grids.Coaches.find(line => line[5] === second.coach);
  yes(coach[0], coach[2].replace(/\D/g, ''));
}
}

const SHIM = `<script>
  (function () {
    function runner(ok, bad) {
      return new Proxy({}, { get: function (target, name) {
        if (name === 'withSuccessHandler') return function (handler) { return runner(handler, bad); };
        if (name === 'withFailureHandler') return function (handler) { return runner(ok, handler); };
        return function () {
          fetch('/rpc/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Array.prototype.slice.call(arguments)) })
            .then(function (response) { return response.json(); }).then(ok, bad);
        };
      } });
    }
    window.google = { script: { run: runner(function () {}, function () {}) } };
  })();
</script>`;

const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function appPage() {
  return fs.readFileSync(path.join(APP, 'Index.html'), 'utf8').replace('<script>', SHIM + '\n<script>');
}

function mailPage() {
  const items = outbox.map(message => {
    const body = escapeHtml(message.body).replace(/https:\/\/concordtabletennisclub\.com\/coaching\.html/g, '<a href="/coaching.html">' + LOCAL + '/coaching.html</a>');
    const reply = /\[CTTC ref [0-9A-F]{10}\]$/.test(message.subject) ?
      '<p><strong>Reply by email:</strong> <a href="/reply?id=' + message.id + '&body=YES">YES</a> &middot; <a href="/reply?id=' + message.id + '&body=NO">NO</a></p>' : '';
    return '<article><h2>' + escapeHtml(message.subject) + '</h2><p>To: ' + escapeHtml(message.to) + ' &middot; ' + message.at.toLocaleTimeString() + '</p>' + reply + '<pre>' + body + '</pre></article>';
  }).join('');
  const messages = texts.map(text => '<article><h2>Text message (Google Voice)</h2><p>To: ' + escapeHtml(text.to) + ' &middot; ' + text.at.toLocaleTimeString() + '</p><pre>' + escapeHtml(text.body) + '</pre></article>').join('');
  const coaches = (grids.Coaches || []).slice(1).filter(line => line[2]).map(line => escapeHtml(line[0]));
  const students = (grids.Students || []).slice(1).filter(line => line[4]).map(line => escapeHtml(line[3]));
  const link = (name, body) => '<a href="/text?name=' + encodeURIComponent(name) + '&body=' + body + '">' + body + '</a>';
  const simulate = coaches.map(name => '<p>' + name + ' texts: ' + link(name, 'COACH') + ' &middot; ' + link(name, 'YES') + ' &middot; ' + link(name, 'NO') + '</p>').join('') +
    students.map(name => '<p>' + name + ' texts: ' + link(name, 'STUDENT') + ' &middot; ' + link(name, 'STOP') + '</p>').join('');
  return '<!doctype html><meta charset="utf-8"><title>Preview mailbox</title><style>body{font:15px/1.5 Arial,sans-serif;max-width:760px;margin:20px auto;padding:0 14px}article{border:1px solid #ccc;border-radius:6px;padding:4px 14px;margin:14px 0}pre{white-space:pre-wrap;font:inherit}h2{font-size:1.05rem;margin:10px 0 0}p{color:#666;margin:2px 0}</style>' +
    '<h1>Preview mailbox</h1><p>Every email and text the coaching app "sends" appears here, newest first. Click YES or NO under an email, or a texted word below, to answer it. Reload to refresh.</p>' + simulate + messages + (items || '<p>No email yet.</p>');
}

function schedulePage() {
  const rows = (grids.Schedule || []).map((line, index) => '<tr>' + line.map(cell => '<' + (index ? 'td' : 'th') + '>' + escapeHtml(cell) + '</' + (index ? 'td' : 'th') + '>').join('') + '</tr>').join('');
  return '<!doctype html><meta charset="utf-8"><title>Public schedule sheet (preview)</title><style>body{font:14px Arial,sans-serif;margin:20px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#eee}</style>' +
    '<h1>Public schedule sheet</h1><p>This stands in for the open Google Sheet. Anyone can edit the real one, but it is only a read-out that the app rewrites from its private records.</p><table>' + rows + '</table>';
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp' };

const server = http.createServer((request, response) => {
  const url = new URL(request.url, LOCAL);
  const send = (code, type, body) => { response.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(body); };
  if (request.method === 'POST' && url.pathname.startsWith('/rpc/')) {
    const name = url.pathname.slice(5);
    if (!exposed.has(name)) return send(404, 'application/json', '{"ok":false}');
    let raw = '';
    request.on('data', chunk => { raw += chunk; if (raw.length > 20000) request.destroy(); });
    request.on('end', () => {
      try { send(200, 'application/json', JSON.stringify(call(name, ...JSON.parse(raw || '[]')))); } catch (error) { send(500, 'application/json', JSON.stringify({ ok: false, message: String(error.message) })); }
    });
    return;
  }
  if (url.pathname === '/') { response.writeHead(302, { Location: '/coaching.html' }); return response.end(); }
  if (url.pathname === '/app') return send(200, 'text/html; charset=utf-8', appPage());
  if (url.pathname === '/mail') return send(200, 'text/html; charset=utf-8', mailPage());
  if (url.pathname === '/reply') {
    const message = outbox.find(entry => entry.id === url.searchParams.get('id'));
    const word = url.searchParams.get('body') === 'NO' ? 'NO' : 'YES';
    if (message) answerEmail(message, word);
    response.writeHead(302, { Location: '/mail' });
    return response.end();
  }
  if (url.pathname === '/text') {
    const name = String(url.searchParams.get('name') || '').slice(0, 60);
    const coach = (grids.Coaches || []).find(line => line[0] === name);
    const student = (grids.Students || []).slice(1).find(line => line[3] === name && line[4]);
    if (coach || student) {
      inbound(name, String(url.searchParams.get('body') || '').slice(0, 20), Date.now(), String(coach ? coach[2] : student[4]).replace(/\D/g, ''));
      cache = {};
      call('checkTexts');
    }
    response.writeHead(302, { Location: '/mail' });
    return response.end();
  }
  if (url.pathname === '/schedule') return send(200, 'text/html; charset=utf-8', schedulePage());
  const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  const relative = path.relative(ROOT, file);
  const allowed = !relative.startsWith('..') && !/(^|[\\/])(node_modules|\.git|apps-script|coaching-app|subscribe-app|scripts|local)([\\/]|$)/.test(relative) && TYPES[path.extname(file)];
  if (!allowed || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'text/plain', 'Not found');
  let body = fs.readFileSync(file);
  if (relative === 'coaching.html') body = body.toString('utf8').replace(/var APP_URL = '[^']*';/, "var APP_URL = '" + LOCAL + "/app';");
  send(200, TYPES[path.extname(file)], body);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Coaching preview: ' + LOCAL + '/coaching.html   (emails: ' + LOCAL + '/mail)');
});
