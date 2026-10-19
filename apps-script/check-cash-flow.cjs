// The daily cash flow page (issue #50): the real server files on the whole-desk simulator (scripts/lib/desk-sim.js),
// the ?view=cash route, and the real Cash.html page in jsdom. Synthetic players and payments only.
// The club and its Sheet are on Pacific time; the simulator turns yyyy-mm-dd cells into dates in this process's zone.
process.env.TZ = 'America/Los_Angeles';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const sim = require('../scripts/lib/desk-sim');

const world = sim.createWorld({ seed: 50, players: 16 });
const server = world.server;
const ctx = server.context;
const run = (name, ...args) => server.run(name, ...args);
const id = name => world.players.find(player => player.display_name === name + ' Example').player_id;
const plain = value => JSON.parse(JSON.stringify(value));
// google.script.run cannot carry a Date (the page would receive null).
function noDates(value, trail) {
  assert.notEqual(Object.prototype.toString.call(value), '[object Date]', 'a Date at ' + trail);
  if (value && typeof value === 'object') Object.keys(value).forEach(key => noDates(value[key], trail + '.' + key));
}
const cashFlow = (from, to) => { const result = run('getCashFlow', from, to); noDates(result, 'getCashFlow'); return plain(result); };

// ---------------------------------------------------------------------------------------------------------------
// A small club: members, visitors, a junior, two Zeffy pass holders (one from Zeffy's emails, one entered by hand) and
// a player whose other directory name is linked to a pass holder.
const MON = '2026-10-12';
const TUE = '2026-10-13';
const WED = '2026-10-14';
const FRI = '2026-10-16';
const OLD = '2026-09-28';
run('nameLinkRows_');
ctx.appendObjects_('NameLinks', [
  { kind: 'junior', name: 'Cy Example', linked_name: '' },
  { kind: 'same_person', name: 'Hal Example', linked_name: 'Dee Example' }
]);
['Ava', 'Dee', 'Fay'].forEach(name => run('setMemberStatus', id(name), 'member'));
run('ensurePrivatePaymentTables_');
ctx.appendObjects_('ZeffyPayments', [{ message_id: 'sim-1', paid_on: '2026-10-01', kind: 'purchase', payer_name: 'Dee Example', payer_email: 'dee@example.test', participant_name: 'Dee Example', created_at: '2026-10-01' }]);
run('setZeffyPass', id('Eli'), true);
run('ensureOpenPlayTable_');
const roster = (date, names) => ctx.appendObjects_('SessionPlayers', names.map((name, index) => ({ session_id: 'session-' + date, player_id: id(name), group_number: 1 + (index > 3), starting_rating: 1500, promotion_from_group: '' })));
const pay = (date, name, method) => run('setSessionPayment', date, id(name), method);

// Monday round robin. Ava also turned up on the Open Play list; Ivy paid but is on neither list.
roster(MON, ['Ava', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay']);
run('setOpenPlayParticipant', MON, id('Gus'), true);
ctx.appendObjects_('OpenPlay', [{ session_date: MON, player_id: id('Ava'), updated_at: new Date() }]);
pay(MON, 'Ava', 'cash'); pay(MON, 'Ben', 'venmo'); pay(MON, 'Cy', 'zelle'); pay(MON, 'Gus', 'credit'); pay(MON, 'Ivy', 'cash');
// Wednesday only has a payment that was cleared again: nobody played.
pay(WED, 'Kai', 'cash'); pay(WED, 'Kai', '');
// Friday is Open Play only. Hal is covered through his link to Dee; Lu's Zeffy was chosen on the desk by hand;
// Nia paid and was archived later.
['Ben', 'Jo', 'Hal', 'Lu'].forEach(name => run('setOpenPlayParticipant', FRI, id(name), true));
pay(FRI, 'Ben', 'cash'); pay(FRI, 'Lu', 'zeffy'); pay(FRI, 'Nia', 'cash');
const nia = ctx.rows_('Players').find(row => row.player_id === id('Nia'));
ctx.updateRow_('Players', nia.__row, { active: false });
// Before Dee's Zeffy purchase she paid cash like anyone else.
roster(OLD, ['Dee']);
pay(OLD, 'Dee', 'cash');

// ---------------------------------------------------------------------------------------------------------------
// The breakdown.
const snapshot = () => JSON.stringify(server.spreadsheet.getSheets().map(sheet => [sheet.getName(), sheet.cells]));
const before = snapshot();
const gmail = ctx.GmailApp.search;
ctx.GmailApp.search = () => { throw new Error('the cash flow page must never read Gmail'); };
let flow = cashFlow(OLD, FRI);
ctx.GmailApp.search = gmail;
assert.equal(snapshot(), before, 'reading the cash flow writes nothing to the Sheet');
assert.deepEqual(flow.days.map(day => day.date), [FRI, MON, OLD], 'days with players, newest first; Tuesday and the cleared Wednesday are left out');
assert.deepEqual(flow.fees, { junior: 5, member: 10, visitor: 15 });

const day = date => flow.days.find(item => item.date === date);
const who = (date, name) => day(date).playerList.find(player => player.name === name + ' Example');
const mon = day(MON);
assert.equal(mon.weekday, 'Mon');
assert.deepEqual(plain(who(MON, 'Ava')), { name: 'Ava Example', status: 'member', kind: 'rr', method: 'cash', owed: 10, collected: 10 }, 'member $10');
assert.deepEqual(plain(who(MON, 'Ben')), { name: 'Ben Example', status: 'visitor', kind: 'rr', method: 'venmo', owed: 15, collected: 15 }, 'visitor $15');
assert.deepEqual(plain(who(MON, 'Cy')), { name: 'Cy Example', status: 'junior', kind: 'rr', method: 'zelle', owed: 5, collected: 5 }, 'junior $5');
assert.deepEqual([who(MON, 'Dee').method, who(MON, 'Dee').owed], ['zeffy', 0], 'a Zeffy pass from the emails owes nothing');
assert.deepEqual([who(MON, 'Eli').method, who(MON, 'Eli').owed], ['zeffy', 0], 'a pass entered by hand owes nothing');
assert.deepEqual([who(MON, 'Fay').method, who(MON, 'Fay').owed, who(MON, 'Fay').collected], ['', 10, 0], 'unpaid still owes the fee');
assert.deepEqual([who(MON, 'Gus').kind, who(MON, 'Gus').method, who(MON, 'Gus').owed], ['open', 'credit', 15]);
assert.deepEqual([who(MON, 'Ivy').kind, who(MON, 'Ivy').method, who(MON, 'Ivy').owed], ['other', 'cash', 15], 'paid but on neither list is kept');
assert.equal(mon.playerList.filter(player => player.name === 'Ava Example').length, 1, 'on the roster and the Open Play list counts once');
assert.deepEqual(mon.playerList.map(player => player.kind), ['rr', 'rr', 'rr', 'rr', 'rr', 'rr', 'open', 'other'], 'round robin first, then Open Play, then the rest');
assert.equal(mon.players, 8);
assert.deepEqual(plain(mon.methods), { cash: { count: 2, amount: 25 }, venmo: { count: 1, amount: 15 }, zelle: { count: 1, amount: 5 }, credit: { count: 1, amount: 15 } });
assert.deepEqual(plain(mon.zeffy), { count: 2 }, 'Zeffy holders are counted');
assert.deepEqual(plain(mon.unpaid), { count: 1, amount: 10 }, 'and never counted as unpaid');
assert.deepEqual(plain(mon.kinds), { rr: { players: 6, expected: 30, outstanding: 10 }, open: { players: 1, expected: 15, outstanding: 0 }, other: { players: 1, expected: 15, outstanding: 0 } });
assert.deepEqual([mon.expected, mon.outstanding, mon.due], [60, 10, 70], 'expected is what the methods collected');
assert.deepEqual(plain(mon.cash), { expected: 25, counted: null, difference: null, note: '', updatedAt: '' });

const fri = day(FRI);
assert.equal(fri.weekday, 'Fri');
assert.equal(fri.kinds.rr.players, 0, 'Friday has no round robin');
assert.deepEqual([who(FRI, 'Hal').status, who(FRI, 'Hal').method, who(FRI, 'Hal').owed], ['member', 'zeffy', 0], 'a linked name shares the pass');
assert.deepEqual([who(FRI, 'Lu').method, who(FRI, 'Lu').owed], ['zeffy', 0], 'Zeffy chosen on the desk owes nothing');
assert.deepEqual([who(FRI, 'Jo').method, who(FRI, 'Jo').owed], ['', 15]);
assert.deepEqual([who(FRI, 'Nia').kind, who(FRI, 'Nia').status, who(FRI, 'Nia').owed], ['other', 'visitor', 15], 'an archived player who paid counts as a visitor');
assert.deepEqual(plain(fri.methods.cash), { count: 2, amount: 30 });
assert.deepEqual([fri.players, fri.zeffy.count, fri.unpaid.count, fri.unpaid.amount, fri.expected, fri.outstanding], [5, 2, 1, 15, 30, 15]);
assert.deepEqual([who(OLD, 'Dee').method, who(OLD, 'Dee').owed, day(OLD).expected], ['cash', 10, 10], 'before her Zeffy purchase Dee paid the member fee');

const totals = flow.totals;
assert.deepEqual([totals.days, totals.players, totals.expected, totals.outstanding, totals.due], [3, 14, 100, 25, 125]);
assert.deepEqual(plain(totals.methods), { cash: { count: 5, amount: 65 }, venmo: { count: 1, amount: 15 }, zelle: { count: 1, amount: 5 }, credit: { count: 1, amount: 15 } });
assert.deepEqual([totals.zeffy.count, totals.unpaid.count, totals.unpaid.amount], [4, 2, 25]);
assert.deepEqual(plain(totals.kinds), { rr: { players: 7, expected: 40, outstanding: 10 }, open: { players: 5, expected: 30, outstanding: 15 }, other: { players: 2, expected: 30, outstanding: 0 } });
assert.deepEqual(plain(totals.cash), { expected: 65, counted: 0, difference: 0, countedDays: 0 });
assert.deepEqual(cashFlow(TUE, WED).days, [], 'a range with no activity has no days');

// The Zeffy coverage read once for the range gives the desk's own answer on every date.
const coverage = ctx.cashZeffyCoverage_(ctx.rows_('Players'), ctx.listPlayers(), ctx.nameLinkRows_());
for (const date of ['2026-09-28', '2026-09-30', '2026-10-01', MON, FRI, '2026-11-01', '2026-11-02', '2026-12-31']) {
  const desk = Array.from(ctx.getZeffyCoveredPlayerIds(ctx.getZeffyPlayers(null, date, true))).sort();
  assert.deepEqual(Object.keys(coverage(date)).sort(), desk, 'Zeffy coverage on ' + date);
}

// Each tab is read the same number of times whatever the length of the range, and the payment tabs once.
const rows = ctx.rows_;
function reads(from, to) {
  const counts = {};
  ctx.rows_ = name => { counts[name] = (counts[name] || 0) + 1; return rows(name); };
  try { run('getCashFlow', from, to); } finally { ctx.rows_ = rows; }
  return counts;
}
const short = reads(MON, MON);
const long = reads('2026-07-15', '2026-10-15');
assert.deepEqual(long, short, 'reads do not grow with the range');
['SessionPlayers', 'OpenPlay', 'SessionPayments', 'ZeffyPasses', 'ZeffyPayments'].forEach(name => assert.equal(long[name], 1, name + ' is read once'));

// Range checks.
for (const [from, to, pattern] of [
  ['2026-10-1', FRI, /YYYY-MM-DD/], [MON, 'yesterday', /YYYY-MM-DD/], ['2026-02-30', '2026-03-01', /not a real date/],
  [FRI, MON, /on or before/], ['2026-07-01', '2026-10-02', /at most 93 days/], ['', '', /YYYY-MM-DD/]
]) assert.throws(() => run('getCashFlow', from, to), pattern, from + ' to ' + to);
assert.equal(run('getCashFlow', '2026-07-01', '2026-10-01').days.length, 1, '93 days is allowed');

// ---------------------------------------------------------------------------------------------------------------
// Cash counts.
const counts = () => plain(ctx.rows_('CashCounts').map(row => [ctx.displayDate_(row.session_date), row.counted, row.note]));
const audits = () => plain(server.audit.filter(entry => entry.action === 'cash_count_updated'));
assert.throws(() => run('saveCashCount', '2026-10-1', '5', ''), /YYYY-MM-DD/);
assert.throws(() => run('saveCashCount', '2026-02-30', '5', ''), /not a real date/);
for (const bad of ['-5', '12.345', 'abc', '1e3', '5.', '.5', '12 34', '100000.01', Infinity, NaN, -1]) {
  assert.throws(() => run('saveCashCount', MON, bad, ''), /Counted cash must be an amount/, 'rejects ' + bad);
}
assert.equal(audits().length, 0, 'nothing is recorded for a rejected count');
let saved = plain(run('saveCashCount', MON, '20', '=SUM(A1) box was short'));
assert.deepEqual([saved.date, saved.counted, saved.note], [MON, 20, 'SUM(A1) box was short'], 'a formula-looking note is made plain');
assert.match(saved.updatedAt, /^\d{4}-\d\d-\d\dT/);
assert.deepEqual(counts(), [[MON, 20, 'SUM(A1) box was short']]);
assert.deepEqual(audits().map(entry => [entry.id, entry.details]), [['session-' + MON, { counted: '20.00', hasNote: true }]]);
assert.doesNotMatch(JSON.stringify(audits()), /Example|player-sim/, 'no names in the audit');
const deskLog = server.spreadsheet.getSheetByName('CTTC Desk Logs').getDataRange().getValues();
const logged = deskLog[deskLog.length - 1];
assert.deepEqual([logged[2], logged[3]], ['cash_count_updated', MON]);
assert.doesNotMatch(String(logged[5]), /20/, 'the amount stays out of the public desk log');
const auditRow = server.spreadsheet.getSheetByName('AuditLog').getDataRange().getValues().pop();
assert.deepEqual([auditRow[3], auditRow[4], auditRow[5]], ['cash_count_updated', 'session', 'session-' + MON]);

saved = plain(run('saveCashCount', MON, 24.5, ' +@-=note  with\nnew line '));
assert.deepEqual([saved.counted, saved.note], [24.5, 'note with new line']);
assert.deepEqual(counts(), [[MON, 24.5, 'note with new line']], 'one row per date');
assert.equal(run('saveCashCount', MON, '$1,025.50', 'x'.repeat(300)).counted, 1025.5);
assert.equal(ctx.rows_('CashCounts')[0].note.length, 200, 'notes are kept short');
run('saveCashCount', MON, '', 'counted tomorrow');
assert.deepEqual(counts(), [[MON, '', 'counted tomorrow']], 'blank clears the count and keeps the note');
assert.equal(cashFlow(MON, MON).days[0].cash.counted, null);
assert.deepEqual(plain(run('saveCashCount', MON, null, '   ')), { date: MON, counted: null, note: '', updatedAt: '' });
assert.deepEqual(counts(), [], 'blank count and note remove the row');
assert.deepEqual(audits().slice(-1)[0].details, { counted: 'cleared', hasNote: false });

// The difference: over, short and even, and a count on a day nobody played is still shown so it can be fixed.
run('saveCashCount', MON, '20', 'two fives missing');
run('saveCashCount', FRI, '32.25', '');
run('saveCashCount', TUE, '0', '');
flow = cashFlow(OLD, FRI);
assert.deepEqual(flow.days.map(item => item.date), [FRI, TUE, MON, OLD]);
assert.deepEqual(plain(day(MON).cash), { expected: 25, counted: 20, difference: -5, note: 'two fives missing', updatedAt: day(MON).cash.updatedAt });
assert.deepEqual([day(FRI).cash.expected, day(FRI).cash.counted, day(FRI).cash.difference], [30, 32.25, 2.25]);
assert.deepEqual([day(TUE).players, day(TUE).cash.counted, day(TUE).cash.difference], [0, 0, 0]);
assert.deepEqual(plain(flow.totals.cash), { expected: 65, counted: 52.25, difference: -2.75, countedDays: 3 });
assert.equal(flow.totals.days, 4);

// ---------------------------------------------------------------------------------------------------------------
// ?view=cash opens the Cash template; everything else opens the desk, as before.
(() => {
  const opened = [];
  const failures = [];
  const route = {
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/EXAMPLE/dev' }) },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createTemplateFromFile: name => {
        if (name === 'Cash' && route.brokenCash) throw new Error('template missing');
        opened.push(name);
        return { evaluate() { const values = Object.assign({ name }, this); return { values, setTitle(title) { this.title = title; return this; }, addMetaTag() { return this; }, setXFrameOptionsMode(mode) { this.framing = mode; return this; } }; } };
      }
    }
  };
  vm.createContext(route);
  ['Code.js', 'DeskLog.js', 'CashFlow.js'].forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), route));
  route.safeAudit_ = (action, type, entity) => failures.push(action + ' ' + entity);
  const cash = route.doGet({ parameter: { view: 'cash' } });
  assert.equal(cash.values.name, 'Cash');
  assert.deepEqual([cash.values.deskMode, cash.values.deskUrl, cash.framing, cash.title], ['dev', 'https://script.google.com/macros/s/EXAMPLE/dev', 'ALLOWALL', 'DEV - CTTC Daily cash flow']);
  route.ScriptApp.getService = () => ({ getUrl: () => 'https://script.google.com/macros/s/EXAMPLE/exec' });
  assert.equal(route.doGet({ parameter: { view: 'cash', date: MON } }).title, 'CTTC Daily cash flow');
  for (const event of [undefined, {}, { parameter: {} }, { parameter: { view: 'Cash' } }, { parameter: { view: 'desk' } }, { parameter: { view: 'cash ' } }, { parameter: { date: MON } }]) {
    const page = route.doGet(event);
    assert.equal(page.values.name, 'Index', 'the desk for ' + JSON.stringify(event));
    assert.equal(page.title, 'LIVE - CTTC Desk');
  }
  assert.equal(route.doGet({ parameter: { date: MON } }).values.initialDate, MON);
  route.brokenCash = true;
  assert.throws(() => route.doGet({ parameter: { view: 'cash' } }), /template missing/);
  assert.deepEqual(failures, ['page_load_failed page_load'], 'a cash page that fails to load is logged like the desk');
})();

// ---------------------------------------------------------------------------------------------------------------
// The page itself.
const pageSource = fs.readFileSync(path.join(__dirname, 'Cash.html'), 'utf8');
for (const match of pageSource.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(match[1]);
assert.doesNotMatch(pageSource, /innerHTML|insertAdjacentHTML|document\.write/, 'names from the Sheet are only ever written as text');
assert.doesNotMatch(pageSource, /<\?!=/, 'every template value is escaped');
assert.match(pageSource, /<div class="brand">Daily cash flow<small>/, 'the page title');
assert.match(pageSource, /<span id="mode-pill" class="mode-pill" data-mode="<\?= deskMode \?>"><\/span>/);
assert.match(pageSource, /<a id="desk-link" href="<\?= deskUrl \?>">/, 'a link back to the desk');
assert.match(pageSource, /no status history/, 'the footnote says status is today\'s');

// The same framing guard as the desk: only direct visits, the club site, and localhost may show it.
const guard = pageSource.match(/<body>\s*<script>([\s\S]*?)<\/script>/)[1];
assert.equal(guard, fs.readFileSync(path.join(__dirname, 'Index.html'), 'utf8').match(/<body>\s*<script>([\s\S]*?)<\/script>/)[1], 'identical to the desk guard');

const DESK_URL = 'https://script.google.com/macros/s/EXAMPLE/exec';
function openPage(ancestorOrigins) {
  const calls = [];
  const html = pageSource.replace('<?= deskMode ?>', 'live').replace('<?= deskUrl ?>', DESK_URL).replace('<base target="_top">', '')
    .split('window.location.ancestorOrigins').join('window.testAncestorOrigins');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://n-abc123-0lu-script.googleusercontent.com/userCodeAppPanel',
    beforeParse(window) {
      // The page decides "today" from the browser; pin it to Friday afternoon at the club.
      const RealDate = window.Date;
      const now = new RealDate(2026, 9, 16, 15, 30).getTime();
      class FixedDate extends RealDate { constructor(...args) { if (args.length) super(...args); else super(now); } static now() { return now; } }
      window.Date = FixedDate;
      window.testAncestorOrigins = ancestorOrigins;
      const build = (ok, bad) => new Proxy({}, {
        get: (_, name) => {
          if (name === 'withSuccessHandler') return fn => build(fn, bad);
          if (name === 'withFailureHandler') return fn => build(ok, fn);
          return (...args) => {
            calls.push([name].concat(args));
            setTimeout(() => {
              let result;
              try { result = plain(run(name, ...plain(args))); } catch (error) { bad({ message: error.message }); return; }
              ok(result);
            }, 5);
          };
        }
      });
      window.google = { script: { run: build(null, null) } };
      window.URL.createObjectURL = blob => { window.downloaded = blob; return 'blob:cash'; };
      window.URL.revokeObjectURL = () => {};
      window.HTMLAnchorElement.prototype.click = function () { window.downloadName = this.download; };
    }
  });
  return { dom, window: dom.window, document: dom.window.document, calls };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
// Visible text with a space between elements, as a reader would see it.
const text = node => {
  const parts = [];
  (function walk(current) {
    current.childNodes.forEach(child => {
      if (child.nodeType === 3) parts.push(child.textContent);
      else if (child.nodeType === 1 && child.tagName !== 'SCRIPT' && child.tagName !== 'STYLE') { parts.push(' '); walk(child); parts.push(' '); }
    });
  })(node);
  return parts.join('').replace(/\s+/g, ' ').trim();
};

(async () => {
  const cover = ancestors => { const page = openPage(ancestors); const covered = Array.from(page.document.body.children).some(node => node.tagName === 'DIV' && /only be opened directly/.test(node.textContent)); page.window.close(); return covered; };
  const sandbox = 'https://n-abc123-0lu-script.googleusercontent.com';
  assert.equal(cover([sandbox, 'https://script.google.com']), false, 'opened directly');
  assert.equal(cover([sandbox, 'https://script.google.com', 'https://concordtabletennisclub.com']), false, 'framed by the club site');
  assert.equal(cover([sandbox, 'https://script.google.com', 'https://evil.example']), true, 'framed by anyone else');

  // Inside the club site, the desk link goes to the site's desk page; opened directly, to the desk itself.
  let page = openPage([sandbox, 'https://script.google.com', 'https://concordtabletennisclub.com']);
  assert.equal(page.document.getElementById('desk-link').getAttribute('href'), 'https://concordtabletennisclub.com/desk.html');
  page.window.close();
  page = openPage([sandbox, 'https://script.google.com']);
  const { document, window, calls } = page;
  assert.equal(document.getElementById('desk-link').getAttribute('href'), DESK_URL);
  assert.equal(document.getElementById('mode-pill').textContent, '/exec');

  // It loads the last 7 days at once, showing that it is loading.
  assert.match(document.getElementById('status').className, /busy/);
  assert.match(text(document.getElementById('status')), /Loading/);
  assert.deepEqual(calls[0], ['getCashFlow', '2026-10-10', FRI]);
  await settle();
  assert.match(text(document.getElementById('status')), /Showing 3 club days from Oct 10, 2026 to Oct 16, 2026/);
  assert.equal(document.querySelector('[data-preset=last7]').getAttribute('aria-pressed'), 'true');
  const cards = Array.from(document.querySelectorAll('.day'));
  assert.deepEqual(cards.map(card => card.getAttribute('data-date')), [FRI, TUE, MON]);
  const monday = cards[2];
  assert.match(text(monday.querySelector('h3')), /^Mon, Oct 12, 2026$/);
  assert.match(text(monday), /8 players · \$60\.00 collected · 1 unpaid \(\$10\.00\)/);
  assert.match(text(monday), /Cash 2 \$25\.00 Venmo 1 \$15\.00 Zelle 1 \$5\.00 Credit 1 \$15\.00 Zeffy pass 2 \$0\.00 Unpaid \(still owed\) 1 \$10\.00 Collected 5 \$60\.00/);
  assert.match(text(monday), /Round robin 6 \$30\.00 \$10\.00 Open Play 1 \$15\.00 \$0\.00 Paid, not on the sheet 1 \$15\.00 \$0\.00 Day total 8 \$60\.00 \$10\.00/);
  assert.equal(text(monday.querySelector('.diff')), 'Short by $5.00', 'the difference is said in words, not only by color');
  assert.match(monday.querySelector('.diff').className, /short/);
  assert.equal(text(cards[0].querySelector('.diff')), 'Over by $2.25');
  assert.equal(text(cards[1].querySelector('.diff')), 'Matches the expected cash');
  const fayRow = Array.from(monday.querySelectorAll('details tbody tr')).find(row => /Fay Example/.test(row.textContent));
  assert.equal(text(fayRow), 'Fay Example Member Round robin Unpaid $10.00', 'status and method are written out');
  assert.equal(text(monday.querySelector('details summary')), 'Players (8)');
  const tiles = text(document.getElementById('tiles'));
  assert.match(tiles, /Total collected \$90\.00 3 days, 13 players/);
  assert.match(tiles, /Cash \$55\.00 4 payments/);
  assert.match(tiles, /Zeffy pass 4 covered, owe \$0/);
  assert.match(tiles, /Unpaid \$25\.00 2 players still owe/);
  assert.match(tiles, /Cash over \/ short Short by \$2\.75 3 of 3 days counted/);

  // The CSV: one row per day, oldest first, then the totals.
  document.getElementById('csv').click();
  assert.ok(window.downloaded, 'a file was offered');
  assert.equal(window.downloadName, 'cttc-cash-flow-2026-10-10-to-2026-10-16.csv');
  assert.equal(window.downloaded.type, 'text/csv;charset=utf-8');
  const csv = window.cttcCashCsv().trim().split('\r\n');
  assert.equal(csv[0], 'date,weekday,players,rr_players,open_play_players,paid_not_listed,cash_payments,cash_dollars,venmo_payments,venmo_dollars,zelle_payments,zelle_dollars,credit_payments,credit_dollars,zeffy_players,unpaid_players,unpaid_dollars,rr_collected,open_play_collected,total_collected,outstanding,cash_counted,cash_difference,note');
  assert.deepEqual(csv.slice(1).map(line => line.split(',')[0]), [MON, TUE, FRI, 'total']);
  assert.equal(csv[1], '2026-10-12,Mon,8,6,1,1,2,25.00,1,15.00,1,5.00,1,15.00,2,1,10.00,30.00,15.00,60.00,10.00,20.00,-5.00,two fives missing');
  assert.equal(csv[4], 'total,,13,6,5,2,4,55.00,1,15.00,1,5.00,1,15.00,4,2,25.00,30.00,30.00,90.00,25.00,52.25,-2.75,');
  assert.doesNotMatch(csv.join('\n'), /Example/, 'no names in the export');

  // Saving a count from the page.
  const inputs = monday.querySelectorAll('.count-fields input');
  inputs[0].value = '25';
  inputs[1].value = '@found the fives';
  monday.querySelector('.count-fields button').click();
  assert.match(text(monday.querySelector('.save-note')), /Saving/);
  await settle();
  assert.equal(text(monday.querySelector('.diff')), 'Matches the expected cash');
  assert.equal(inputs[1].value, 'found the fives');
  assert.deepEqual(counts().find(row => row[0] === MON), [MON, 25, 'found the fives']);
  assert.match(text(document.getElementById('tiles')), /Cash over \/ short Over by \$2\.25/);
  inputs[0].value = 'twenty';
  monday.querySelector('.count-fields button').click();
  assert.match(text(monday.querySelector('.save-note')), /Enter an amount/);
  await settle();
  assert.deepEqual(counts().find(row => row[0] === MON), [MON, 25, 'found the fives'], 'a bad amount is not sent');

  // Quick ranges, an empty range, and errors are all shown.
  const preset = name => { document.querySelector('[data-preset=' + name + ']').click(); return calls[calls.length - 1].slice(1); };
  assert.deepEqual(preset('today'), [FRI, FRI]);
  assert.deepEqual(preset('week'), [MON, FRI], 'the week starts on Monday');
  assert.deepEqual(preset('month'), ['2026-10-01', FRI]);
  assert.deepEqual(preset('lastMonth'), ['2026-09-01', '2026-09-30']);
  await settle();
  assert.equal(document.querySelectorAll('.day').length, 1, 'only the last answer is shown');
  document.getElementById('from').value = '2026-08-01';
  document.getElementById('to').value = '2026-08-31';
  document.getElementById('show').click();
  await settle();
  assert.match(text(document.getElementById('status')), /No players or payments were recorded/);
  assert.match(text(document.getElementById('days')), /No players or payments in this range/);
  document.getElementById('from').value = '2026-01-01';
  document.getElementById('show').click();
  await settle();
  assert.match(document.getElementById('status').className, /error/);
  assert.match(text(document.getElementById('status')), /Could not load the cash flow: Choose at most 93 days/);
  document.getElementById('from').value = '2026-09-02';
  document.getElementById('show').click();
  assert.match(text(document.getElementById('status')), /on or before/, 'a reversed range is caught before asking Google');
  window.close();
  console.log('Daily cash flow checks passed');
})().catch(error => { console.error(error); process.exit(1); });
