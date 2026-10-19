// Run: node scripts/staffing-preview.js   then open http://localhost:3300/ (the home page, press "Volunteer signups")
// or http://localhost:3300/app (the app on its own, for screenshots).
// Dev only. Serves the real staffing-app/Index.html with the real staffing-app/Code.js running against an in-memory Sheet, a
// made-up player directory and a fake mailbox, so the whole flow can be clicked through without Google. Nothing here talks
// to Google, sends email, or touches a real Sheet. Emails and texts the app "sends" appear at /mail, where a click stands in
// for a YES or NO reply (or a CONFIRM, RELEASE, STAFF or STOP text). Every person here is synthetic (example.com).

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'staffing-app');
const PORT = Number(process.env.PORT || 3300);
const LOCAL = 'http://localhost:' + PORT;

const grids = {};
const outbox = [];
// The home page's closures come from the repository's data/closures.json, as the site serves it.
const properties = { DESK_SHEET_ID: 'preview-desk', CLOSURES_URL: LOCAL + '/data/closures.json' };
// Stand-in for Google Voice: each message is a text forwarded to Gmail; replying to it is a text sent back.
const inbox = [];
const texts = [];
// Stand-in for email replies to the app's questions (subjects carrying [CTTC shift ...]).
const answers = [];
let messageCount = 0;
let cache = {};
let activeEmail = '';

const makeSheet = name => {
  const grid = grids[name] = grids[name] || [];
  return {
    getLastRow: () => grid.length,
    getDataRange: () => ({ getValues: () => grid.map(line => line.slice()) }),
    getRange: (row, column) => {
      const handle = {
        setValues: values => { values.forEach((line, r) => line.forEach((value, c) => { (grid[row - 1 + r] = grid[row - 1 + r] || [])[column - 1 + c] = value; })); return handle; },
        setNumberFormat: () => handle,
        setFontWeight: () => handle,
        setDataValidation: () => handle
      };
      return handle;
    },
    deleteRows: (row, count) => { grid.splice(row - 1, count); },
    appendRow: values => { grid.push(values.map(value => String(value).replace(/^'/, ''))); },
    clearContents: () => { grid.length = 0; },
    hideSheet: () => {},
    setFrozenRows: () => {}
  };
};
const books = {};
const makeBook = id => {
  const sheets = {};
  return (books[id] = {
    getSheetByName: name => sheets[name] || null,
    insertSheet: name => (sheets[name] = makeSheet(name)),
    getSheets: () => Object.values(sheets),
    deleteSheet: () => {},
    getUrl: () => LOCAL + '/mail'
  });
};
const pacific = ms => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day + ' ' + parts.hour + ':' + parts.minute;
};

// The desk's Players tab: made-up members. Most are trained for the desk and the Front Desk; a few are not, so the page's
// "Needs training" shows up for them (Cal, Pia, Quinn).
const PLAYERS = ['Ada Park', 'Ben Ortiz', 'Cal Diaz', 'Dee Nguyen', 'Eve Stone', 'Fay Moss', 'Gus Hale', 'Hal Reed', 'Ivy Wong', 'Jo Banks', 'Kai Ford',
  'Lu Chen', 'Max Gold', 'Ned Fox', 'Ola Berg', 'Pia Lund', 'Quinn Ash', 'Rae Holt', 'Sam Kim', 'Sam Lee', 'Tess Vale', 'Uma Rios', 'Vic Hart', 'Wes Lowe'];
const UNTRAINED = ['Cal Diaz', 'Pia Lund', 'Quinn Ash'];
// No email on file for these two: picking them shows the email field, and the club is asked to approve it (YES at /mail).
const NO_EMAIL = ['Pia Lund', 'Wes Lowe'];
makeBook('preview-desk').insertSheet('Players');
grids.Players.push(['player_id', 'display_name', 'current_rating', 'active', 'created_at', 'updated_at']);
PLAYERS.forEach((name, index) => grids.Players.push(['demo' + String(index + 1).padStart(2, '0'), name, String(1200 + index * 25), true, '', '']));
grids.Players.push(['demo99', 'Former Member', '1000', false, '', '']);
const idOf = name => grids.Players.find(line => line[1] === name)[0];
const emailOf = name => name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com';

function inbound(subjectName, body) {
  const id = 'preview-' + messageCount++;
  const at = Date.now() + 1000;
  const from = '"' + subjectName + ' (SMS)" <19255550100.19255550199.preview@txt.voice.google.com>';
  inbox.push({
    getId: () => id, getFrom: () => from, getReplyTo: () => from, getSubject: () => 'New text message from ' + subjectName,
    getPlainBody: () => '<https://voice.google.com>\n' + body + '\nTo respond to this text message, reply to this email or visit Google Voice.',
    getDate: () => new Date(at),
    reply: text => { texts.unshift({ at: new Date(), to: subjectName, body: text }); }
  });
}

// The app logs one line per message sent; here the mailbox page shows them instead.
const quiet = { log: line => { if (!/^staffing sent /.test(line)) console.log(line); }, error: console.error };
const context = {
  Date, Math, Number, String, JSON, Object, Array, console: quiet,
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) },
  SpreadsheetApp: {
    create: () => Object.assign({ getId: () => 'preview-private' }, makeBook('preview-private')),
    openById: id => books[id],
    newDataValidation: () => {
      const builder = { requireValueInRange: () => builder, setAllowInvalid: () => builder, setHelpText: () => builder, build: () => ({}) };
      return builder;
    }
  },
  Session: { getActiveUser: () => ({ getEmail: () => activeEmail }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create: () => {} }), everyMinutes: () => ({ create: () => {} }) }) }) },
  LockService: {
    getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }),
    getUserLock: () => ({ tryLock: () => true, releaseLock: () => {} })
  },
  CacheService: { getScriptCache: () => ({ get: key => cache[key] || null, put: (key, value) => { cache[key] = value; }, remove: key => { delete cache[key]; } }) },
  MailApp: { getRemainingDailyQuota: () => 100, sendEmail: message => { outbox.unshift(Object.assign({ at: new Date(), id: 'mail-' + messageCount++ }, message)); } },
  GmailApp: {
    getInboxUnreadCount: () => 0,
    search: query => {
      const list = /CTTC shift/.test(query) ? answers : inbox;
      return list.length ? [{ getMessages: () => list.slice() }] : [];
    }
  },
  UrlFetchApp: {
    // Only the closures file is fetched; it is read straight from the repository.
    fetch: url => {
      const ok = url === LOCAL + '/data/closures.json';
      const text = ok ? fs.readFileSync(path.join(ROOT, 'data', 'closures.json'), 'utf8') : '';
      return { getResponseCode: () => (ok ? 200 : 404), getContentText: () => text };
    }
  },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256', key).update(value).digest()),
    formatDate: (date, zone, format) => (format === 'yyyy-MM-dd' ? pacific(date.getTime()).slice(0, 10) : pacific(date.getTime()))
  },
  HtmlService: {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createTemplateFromFile: name => ({ evaluate: () => {
      let content = fs.readFileSync(path.join(APP, name + '.html'), 'utf8');
      const output = { getContent: () => content, setContent: value => { content = value; return output; }, setTitle: () => output, addMetaTag: () => output, setXFrameOptionsMode: () => output };
      return output;
    } })
  }
};
vm.createContext(context);
const source = fs.readFileSync(path.join(APP, 'Code.js'), 'utf8');
vm.runInContext(source, context);
// Only what the page itself calls is served: setup, the seed import and the triggers are the owner's and Google's.
const exposed = new Set([...source.matchAll(/^function ([A-Za-z0-9]+)\(/gm)].map(match => match[1])
  .filter(name => !name.endsWith('_') && !['doGet', 'setup', 'importSeedSheet', 'sweep', 'checkReplies'].includes(name)));
const call = (name, ...args) => { Object.keys(cache).filter(key => key.startsWith('rate:')).forEach(key => { delete cache[key]; }); return JSON.parse(JSON.stringify(context[name](...args) ?? null)); };
const checkReplies = () => { delete cache['check-replies']; delete cache['opt-ins']; context.checkReplies(); };

// An email reply from whoever the message went to; only the first line (YES or NO) matters to the app.
function answerEmail(message, word) {
  const at = new Date(Date.now() + 1000);
  const id = 'answer-' + messageCount++;
  answers.push({ getId: () => id, getFrom: () => message.to, getSubject: () => 'Re: ' + message.subject, getDate: () => at, getPlainBody: () => word + '\n\n> ' + message.subject });
  checkReplies();
}

// ---- Demo data: the owner's setup, a training list, a closure, and sign-ups showing every status ----
activeEmail = 'owner@example.com';
context.setup();
activeEmail = '';
PLAYERS.forEach(name => {
  const trained = UNTRAINED.includes(name) ? 'no' : 'yes';
  grids.Training.push([idOf(name), name, trained, trained, trained, '']);
  // Emails on file, as the owner (or importMemberEmails) would put them; Max also has a mobile on file for texts.
  if (!NO_EMAIL.includes(name)) grids.Emails.push([idOf(name), name, emailOf(name), name === 'Max Gold' ? '(925) 555-0199' : '', 'owner', 'approved', '', '', '']);
});
const open = call('staffBoard').nights.filter(night => night.bookable);
function sign(name, date, position, confirm = true, extra = {}) {
  const result = call('signUp', Object.assign({ playerId: idOf(name), email: emailOf(name), picks: [{ date, position, finalize: !!extra.finalize }] }, extra));
  if (!result.ok) { console.error('Demo sign-up refused (' + name + ', ' + date + ', ' + position + '): ' + result.message + ' ' + JSON.stringify(result.problems || '')); return; }
  if (!confirm) return;
  const message = outbox.find(entry => entry.to === emailOf(name) && /\[CTTC shift [0-9A-F]{10}\]$/.test(entry.subject));
  answerEmail(message, 'YES');
}
if (open.length >= 6) {
  const [full, covered, waiting, closed, partial] = open;
  // Fully staffed: every minimum and both backups. Two Sams that night show as "Sam K." and "Sam L.".
  [['Ada Park', 'desk'], ['Fay Moss', 'desk-backup'], ['Ben Ortiz', 'money'], ['Gus Hale', 'money-backup'], ['Cal Diaz', 'tables'], ['Sam Kim', 'tables'],
    ['Dee Nguyen', 'close'], ['Sam Lee', 'close']].forEach(([name, position]) => sign(name, full.date, position, true, { finalize: name === 'Sam Lee' }));
  // Covered: the minimum crew, backups still open.
  [['Hal Reed', 'desk'], ['Ivy Wong', 'money'], ['Jo Banks', 'tables'], ['Kai Ford', 'close'], ['Lu Chen', 'close']].forEach(([name, position]) => sign(name, covered.date, position));
  // Needs people, with a pick still waiting for its YES.
  sign('Max Gold', waiting.date, 'desk');
  sign('Ned Fox', waiting.date, 'money', false);
  sign('Ola Berg', waiting.date, 'close');
  // A closure the owner typed into the Closures tab.
  grids.Closures.push([closed.date, 'Gym closed for a school event']);
  // Needs people: only table setup so far.
  sign('Rae Holt', partial.date, 'tables');
  sign('Tess Vale', partial.date, 'tables');
  // A player with no email on file asked to use one: the club's approval email is waiting at /mail.
  call('signUp', { playerId: idOf('Wes Lowe'), email: 'wes.lowe@example.com', picks: [{ date: partial.date, position: 'close' }] });
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
  // The real doGet: the page with the calendar injected, plus the viewport tag doGet adds.
  return context.doGet().getContent().replace('<script>', SHIM + '\n<script>')
    .replace(/<head>/i, '<head><meta name="viewport" content="width=device-width, initial-scale=1">');
}

function mailPage() {
  const items = outbox.map(message => {
    const body = escapeHtml(message.body).replace(/https:\/\/concordtabletennisclub\.com\//g, '<a href="/">' + LOCAL + '/</a>');
    const reply = /\[CTTC shift [0-9A-F]{10}\]$/.test(message.subject) ?
      '<p><strong>Reply by email:</strong> <a href="/reply?id=' + message.id + '&body=YES">YES</a> &middot; <a href="/reply?id=' + message.id + '&body=NO">NO</a></p>' : '';
    return '<article><h2>' + escapeHtml(message.subject) + '</h2><p>To: ' + escapeHtml(message.to) + ' &middot; ' + message.at.toLocaleTimeString() + '</p>' + reply + '<pre>' + body + '</pre></article>';
  }).join('');
  const messages = texts.map(text => '<article><h2>Text message (Google Voice)</h2><p>To: ' + escapeHtml(text.to) + ' &middot; ' + text.at.toLocaleTimeString() + '</p><pre>' + escapeHtml(text.body) + '</pre></article>').join('');
  const phones = (grids.People || []).slice(1).filter(line => line[3]);
  const link = (digits, body) => '<a href="/text?digits=' + digits + '&body=' + body + '">' + body + '</a>';
  const simulate = phones.map(line => '<p>' + escapeHtml(line[1]) + ' texts: ' + ['STAFF', 'CONFIRM', 'RELEASE', 'STOP'].map(word => link(line[3], word)).join(' &middot; ') + '</p>').join('');
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Preview mailbox</title><style>body{font:15px/1.5 Arial,sans-serif;max-width:760px;margin:20px auto;padding:0 14px}article{border:1px solid #ccc;border-radius:6px;padding:4px 14px;margin:14px 0}pre{white-space:pre-wrap;font:inherit}h2{font-size:1.05rem;margin:10px 0 0}p{color:#666;margin:2px 0}</style>' +
    '<h1>Preview mailbox</h1><p>Every email and text the staffing app "sends" appears here, newest first. Click YES or NO under an email (the club answers the "Approve an email" ones), or a texted word below, to answer it. Reload to refresh. <a href="/app">Back to the app</a></p>' +
    simulate + messages + (items || '<p>No email yet.</p>');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp' };

const server = http.createServer((request, response) => {
  const url = new URL(request.url, LOCAL);
  const send = (code, type, body) => { response.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(body); };
  const back = location => { response.writeHead(302, { Location: location }); response.end(); };
  if (request.method === 'POST' && url.pathname.startsWith('/rpc/')) {
    const name = url.pathname.slice(5);
    if (!exposed.has(name)) return send(404, 'application/json', '{"ok":false}');
    let raw = '';
    request.on('data', chunk => { raw += chunk; if (raw.length > 50000) request.destroy(); });
    request.on('end', () => {
      try { send(200, 'application/json', JSON.stringify(call(name, ...JSON.parse(raw || '[]')))); } catch (error) { send(500, 'application/json', JSON.stringify({ ok: false, message: String(error.message) })); }
    });
    return;
  }
  if (url.pathname === '/') return back('/index.html');
  if (url.pathname === '/app') return send(200, 'text/html; charset=utf-8', appPage());
  if (url.pathname === '/mail') return send(200, 'text/html; charset=utf-8', mailPage());
  if (url.pathname === '/reply') {
    const message = outbox.find(entry => entry.id === url.searchParams.get('id'));
    if (message) answerEmail(message, url.searchParams.get('body') === 'NO' ? 'NO' : 'YES');
    return back('/mail');
  }
  if (url.pathname === '/text') {
    const digits = String(url.searchParams.get('digits') || '').replace(/\D/g, '').slice(0, 10);
    const word = String(url.searchParams.get('body') || '').replace(/[^A-Z]/g, '').slice(0, 10);
    if (digits.length === 10 && word) {
      inbound('(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6), word);
      checkReplies();
    }
    return back('/mail');
  }
  const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  const relative = path.relative(ROOT, file);
  const allowed = !relative.startsWith('..') && !/(^|[\\/])(node_modules|\.git|apps-script|coaching-app|staffing-app|subscribe-app|scripts|local)([\\/]|$)/.test(relative) && TYPES[path.extname(file)];
  if (!allowed || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'text/plain', 'Not found');
  let body = fs.readFileSync(file);
  // The home page frames the app; here it frames the local copy, and accepts its messages from this origin instead of Google's.
  if (relative === 'index.html') {
    body = body.toString('utf8').replace(/var APP_URL = "PENDING_DEPLOYMENT";|var APP_URL = 'PENDING_DEPLOYMENT';/, 'var APP_URL = "' + LOCAL + '/app";')
      .replace('if (!/^https:\\/\\/[a-z0-9-]+\\.googleusercontent\\.com$/.test(event.origin)) return;', 'if (event.origin !== "' + LOCAL + '") return;');
  }
  send(200, TYPES[path.extname(file)], body);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Staffing preview: ' + LOCAL + '/ (press Volunteer signups) or ' + LOCAL + '/app   (emails: ' + LOCAL + '/mail)');
});
