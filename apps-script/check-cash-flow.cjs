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
// What the page receives: google.script.run leaves out object fields whose value is null.
const wire = value => JSON.parse(JSON.stringify(value, (key, item) => item === null && key !== '' ? undefined : item));
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
// Members since before the desk kept a record of membership changes (no AuditLog row), as most of the club is.
run('ensureMemberStatusTable_');
ctx.appendObjects_('MemberStatus', ['Ava', 'Dee', 'Fay'].map(name => ({ player_id: id(name), status: 'member', updated_at: new Date() })));
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
assert.deepEqual(flow.fees, { junior: 5, member: 10, visitor: 15, intro: 10 });

const day = date => flow.days.find(item => item.date === date);
const who = (date, name) => day(date).playerList.find(player => player.name === name + ' Example');
const mon = day(MON);
assert.equal(mon.weekday, 'Mon');
assert.deepEqual(plain(who(MON, 'Ava')), { name: 'Ava Example', status: 'member', firstVisit: false, kind: 'rr', method: 'cash', owed: 10, collected: 10 }, 'member $10');
assert.deepEqual(plain(who(MON, 'Ben')), { name: 'Ben Example', status: 'visitor', firstVisit: false, kind: 'rr', method: 'venmo', owed: 15, collected: 15 }, 'visitor $15');
assert.deepEqual(plain(who(MON, 'Cy')), { name: 'Cy Example', status: 'junior', firstVisit: false, kind: 'rr', method: 'zelle', owed: 5, collected: 5 }, 'junior $5');
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

// A Saturday with a round robin and an Equalizer: both rosters are the day's players, and someone in both counts once.
const SAT = '2026-10-24';
roster(SAT, ['Ava', 'Ben']);
ctx.appendObjects_('SessionPlayers', ['Ben', 'Cy'].map(name => ({ session_id: 'session-' + SAT + '-equalizer', player_id: id(name), group_number: 1, starting_rating: 1500, promotion_from_group: '' })));
pay(SAT, 'Cy', 'cash');
const sat = cashFlow(SAT, SAT).days[0];
assert.deepEqual(sat.playerList.map(player => [player.name, player.kind]), [['Ava Example', 'rr'], ['Ben Example', 'rr'], ['Cy Example', 'rr']], 'the Equalizer roster counts with the day\'s players');
assert.equal(who(MON, 'Ava').method, 'cash', 'other days are unchanged');

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
assert.equal(long.CashCounts, undefined, 'a tab not made yet is not read (or made)');
assert.equal(long.CashTargets, undefined);

// Range checks.
for (const [from, to, pattern] of [
  ['2026-10-1', FRI, /YYYY-MM-DD/], [MON, 'yesterday', /YYYY-MM-DD/], ['2026-02-30', '2026-03-01', /not a real date/],
  [FRI, MON, /on or before/], ['2025-09-01', '2026-10-06', /at most 400 days/], ['', '', /YYYY-MM-DD/]
]) assert.throws(() => run('getCashFlow', from, to), pattern, from + ' to ' + to);
assert.equal(run('getCashFlow', '2025-09-01', '2026-10-05').days.length, 1, '400 days is allowed');

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
// Targets, grouping and insights, on a second club whose "today" is Wednesday 2026-12-09.
(() => {
  const club = sim.createWorld({ seed: 52, players: 12, date: '2026-12-09' });
  const cx = club.server.context;
  const go = (name, ...args) => club.server.run(name, ...args);
  const pid = name => club.players.find(player => player.display_name === name + ' Example').player_id;
  go('ensureMemberStatusTable_');
  cx.appendObjects_('MemberStatus', [{ player_id: pid('Ava'), status: 'member', updated_at: new Date() }]);
  go('ensurePrivatePaymentTables_');
  go('ensureOpenPlayTable_');
  go('setZeffyPass', pid('Fay'), true);
  // Mondays and Wednesdays are round robins, Fridays and Saturdays Open Play. '' is unpaid, 'pass' a Zeffy holder.
  const night = (date, entries) => {
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    entries.forEach(([name, method]) => {
      if (weekday === 1 || weekday === 3) cx.appendObjects_('SessionPlayers', [{ session_id: 'session-' + date, player_id: pid(name), group_number: 1, starting_rating: 1500, promotion_from_group: '' }]);
      else go('setOpenPlayParticipant', date, pid(name), true);
      if (method && method !== 'pass') go('setSessionPayment', date, pid(name), method);
    });
  };
  night('2025-03-03', [['Gus', 'cash']]);
  night('2026-09-14', [['Ivy', 'cash']]);
  night('2026-10-21', [['Ava', 'cash'], ['Ben', 'cash'], ['Cy', 'cash']]);
  night('2026-10-28', [['Ava', 'cash'], ['Ben', 'venmo']]);
  night('2026-11-02', [['Ava', 'cash'], ['Ben', 'cash'], ['Cy', 'cash']]);
  night('2026-11-06', [['Ben', 'venmo'], ['Dee', 'zelle']]);
  night('2026-11-16', [['Ava', 'venmo'], ['Ben', 'venmo'], ['Cy', ''], ['Dee', 'venmo']]);
  night('2026-11-21', [['Eli', 'credit']]);
  night('2026-11-23', [['Ava', 'cash'], ['Ben', 'cash'], ['Cy', ''], ['Fay', 'pass']]);
  night('2026-12-02', [['Ava', 'venmo'], ['Ben', 'cash'], ['Cy', 'cash'], ['Dee', 'cash'], ['Gus', 'cash']]);
  night('2026-12-05', [['Hal', 'cash']]);
  night('2026-12-07', [['Ava', 'cash'], ['Ben', 'cash']]);
  night('2026-12-09', [['Ava', 'cash']]);
  const FROM = '2026-10-28';
  const TO = '2026-12-09';
  const flowOf = (from, to) => { const result = go('getCashFlow', from, to); noDates(result, 'getCashFlow'); return plain(result); };

  // Targets: club-wide, validated, audited with the amount as text.
  const targetAudits = () => plain(club.server.audit.filter(entry => entry.action === 'cash_target_updated'));
  assert.deepEqual(plain(go('getCashTargets')), { day: null, week: null, month: null }, 'no targets until one is saved');
  assert.equal(club.server.spreadsheet.getSheetByName('CashTargets'), null, 'reading targets never makes the tab');
  assert.throws(() => go('saveCashTarget', 'year', '5'), /day, week or month/);
  assert.throws(() => go('saveCashTarget', '', '5'), /day, week or month/);
  for (const bad of ['-1', '12.345', 'lots', '1000000.01', '1e3', -5]) assert.throws(() => go('saveCashTarget', 'week', bad), /The target must be an amount/, 'rejects ' + bad);
  assert.equal(targetAudits().length, 0);
  assert.deepEqual(plain(go('saveCashTarget', 'week', '1000000')), { day: null, week: 1000000, month: null }, 'up to a million');
  assert.deepEqual(plain(go('saveCashTarget', 'week', '50')), { day: null, week: 50, month: null }, 'one row per period');
  assert.deepEqual(plain(go('saveCashTarget', 'month', '$200.00')), { day: null, week: 50, month: 200 });
  go('saveCashTarget', 'day', '30');
  assert.deepEqual(plain(go('saveCashTarget', 'day', '')), { day: null, week: 50, month: 200 }, 'blank clears');
  assert.deepEqual(plain(cx.rows_('CashTargets').map(row => [row.period, row.amount])), [['week', 50], ['month', 200]]);
  assert.deepEqual(targetAudits().map(entry => [entry.id, entry.details]), [
    ['cash-target-week', { period: 'week', amount: '1000000.00' }], ['cash-target-week', { period: 'week', amount: '50.00' }],
    ['cash-target-month', { period: 'month', amount: '200.00' }], ['cash-target-day', { period: 'day', amount: '30.00' }], ['cash-target-day', { period: 'day', amount: 'cleared' }]
  ]);
  const clubLog = club.server.spreadsheet.getSheetByName('CTTC Desk Logs').getDataRange().getValues().filter(row => row[2] === 'cash_target_updated');
  assert.equal(clubLog.length, 5);
  assert.ok(clubLog.every(row => !/\d{2}/.test(String(row[5]))), 'target amounts stay out of the public desk log');

  const flow = flowOf(FROM, TO);
  assert.equal(flow.today, '2026-12-09');
  assert.deepEqual(flow.targets, { day: null, week: 50, month: 200 }, 'targets come with the cash flow, so the page needs one call');

  // Weeks run Monday to Sunday. Only finished weeks wholly inside the range count.
  const week = flow.groups.week;
  assert.equal(week.target, 50);
  assert.deepEqual(week.periods.map(p => [p.start, p.end, p.collected, p.nights, p.state, p.counted]), [
    ['2026-10-26', '2026-11-01', 25, 1, 'partial', false],
    ['2026-11-02', '2026-11-08', 70, 2, 'met', true],
    ['2026-11-09', '2026-11-15', 0, 0, 'empty', false],
    ['2026-11-16', '2026-11-22', 55, 2, 'met', true],
    ['2026-11-23', '2026-11-29', 25, 1, 'missed', true],
    ['2026-11-30', '2026-12-06', 85, 2, 'met', true],
    ['2026-12-07', '2026-12-13', 35, 2, 'in_progress', false]
  ]);
  assert.equal(week.periods[1].label, 'Week of Nov 2, 2026');
  assert.deepEqual([week.periods[1].difference, week.periods[4].difference], [20, -25]);
  assert.deepEqual(week.stats, {
    counted: 4, collected: 235, targetTotal: 200, overUnder: 35, met: 3, missed: 1, metPercent: 75, average: 58.75,
    best: { key: '2026-11-30', label: 'Week of Nov 30, 2026', collected: 85 }, worst: { key: '2026-11-23', label: 'Week of Nov 23, 2026', collected: 25 }, partial: 2, empty: 1
  });

  // Months: October is cut by the range start, December is in progress, November counts.
  const month = flow.groups.month;
  assert.deepEqual(month.periods.map(p => [p.key, p.start, p.end, p.label, p.collected, p.state]), [
    ['2026-10', '2026-10-01', '2026-10-31', 'October 2026', 25, 'partial'],
    ['2026-11', '2026-11-01', '2026-11-30', 'November 2026', 150, 'missed'],
    ['2026-12', '2026-12-01', '2026-12-31', 'December 2026', 120, 'in_progress']
  ]);
  assert.deepEqual([month.stats.counted, month.stats.met, month.stats.missed, month.stats.overUnder, month.stats.metPercent, month.stats.worst], [1, 0, 1, -50, 0, null], 'one counted month has no separate worst');

  // Days: each club night with players is a bar; tonight counts once it is over. No day target: neutral.
  const daily = flow.groups.day;
  assert.equal(daily.target, null);
  assert.deepEqual(daily.periods.map(p => p.start), ['2026-10-28', '2026-11-02', '2026-11-06', '2026-11-16', '2026-11-21', '2026-11-23', '2026-12-02', '2026-12-05', '2026-12-07', '2026-12-09']);
  assert.equal(daily.periods[1].label, 'Mon Nov 2, 2026');
  assert.deepEqual(daily.periods.map(p => p.state), ['none', 'none', 'none', 'none', 'none', 'none', 'none', 'none', 'none', 'in_progress']);
  assert.deepEqual(daily.stats, {
    counted: 9, collected: 285, targetTotal: null, overUnder: null, met: null, missed: null, metPercent: null, average: 31.67,
    best: { key: '2026-12-02', label: 'Wed Dec 2, 2026', collected: 70 }, worst: { key: '2026-12-05', label: 'Sat Dec 5, 2026', collected: 15 }, partial: 1, empty: 0
  });
  go('saveCashTarget', 'day', '30');
  const withDay = flowOf(FROM, TO).groups.day;
  assert.deepEqual(withDay.periods.map(p => p.state), ['missed', 'met', 'met', 'met', 'missed', 'missed', 'met', 'missed', 'missed', 'in_progress'], 'meeting the target exactly counts as met');
  assert.deepEqual([withDay.stats.met, withDay.stats.missed, withDay.stats.metPercent, withDay.stats.targetTotal, withDay.stats.overUnder], [4, 5, 44.4, 270, 15]);
  go('saveCashTarget', 'day', '');

  // Full weeks only: a Monday-to-Sunday range has no partial weeks.
  const full = flowOf('2026-11-02', '2026-11-29').groups.week;
  assert.deepEqual(full.periods.map(p => p.state), ['met', 'empty', 'met', 'missed']);
  assert.equal(full.stats.partial, 0);
  // Year ends: a week starting in December, and months across the new year.
  assert.equal(cx.cashMonday_('2026-01-01'), '2025-12-29', 'Thursday January 1 belongs to the week of Monday December 29');
  assert.equal(cx.cashMonday_('2026-01-04'), '2025-12-29');
  assert.equal(cx.cashMonday_('2026-01-05'), '2026-01-05');
  assert.deepEqual(plain(cx.cashGroup_('week', [], '2025-12-29', '2026-01-04', 100, '2026-06-01').periods.map(p => [p.start, p.end, p.state])), [['2025-12-29', '2026-01-04', 'empty']]);
  assert.deepEqual(plain(cx.cashGroup_('month', [], '2025-12-15', '2026-03-01', null, '2026-06-01').periods.map(p => [p.key, p.end, p.partial])),
    [['2025-12', '2025-12-31', true], ['2026-01', '2026-01-31', false], ['2026-02', '2026-02-28', false], ['2026-03', '2026-03-31', true]]);

  // Insights.
  const info = flow.insights;
  assert.deepEqual([info.attendance, info.nights, info.averagePlayersPerNight, info.averagePerPlayer], [25, 10, 2.5, 11.8]);
  assert.deepEqual(info.methods, [
    { method: 'cash', count: 14, amount: 185, countShare: 56, amountShare: 62.7 },
    { method: 'venmo', count: 6, amount: 80, countShare: 24, amountShare: 27.1 },
    { method: 'zelle', count: 1, amount: 15, countShare: 4, amountShare: 5.1 },
    { method: 'credit', count: 1, amount: 15, countShare: 4, amountShare: 5.1 },
    { method: 'zeffy', count: 1, amount: 0, countShare: 4, amountShare: null },
    { method: 'unpaid', count: 2, amount: 30, countShare: 8, amountShare: null }
  ]);
  assert.deepEqual([info.topByCount, info.topByDollars], ['cash', 'cash']);
  assert.deepEqual(info.topPlayers.map(p => [p.name.split(' ')[0], p.nights, p.paid]), [['Ben', 7, 105], ['Ava', 7, 70], ['Cy', 4, 30], ['Dee', 3, 45], ['Eli', 1, 15], ['Gus', 1, 15], ['Hal', 1, 15], ['Fay', 1, 0]], 'nights, then dollars paid, then name');
  assert.deepEqual(info.weekdays, [
    { weekday: 'Mon', nights: 4, averagePlayers: 3.3, averageCollected: 32.5 },
    { weekday: 'Wed', nights: 3, averagePlayers: 2.7, averageCollected: 35 },
    { weekday: 'Fri', nights: 1, averagePlayers: 2, averageCollected: 30 },
    { weekday: 'Sat', nights: 2, averagePlayers: 1, averageCollected: 15 }
  ]);
  assert.equal(info.busiestWeekday, 'Mon');
  assert.deepEqual([info.statusMix, info.zeffyShare], [{ junior: 0, member: 7, visitor: 18 }, 4]);
  assert.deepEqual(info.unpaid, { count: 2, amount: 30, repeat: [{ name: 'Cy Example', nights: 2, owed: 30 }] });
  assert.deepEqual(info.trend, {
    previousFrom: '2026-09-15', previousTo: '2026-10-27', collected: 295, previousCollected: 40, collectedChange: 637.5,
    attendance: 25, previousAttendance: 3, attendanceChange: 733.3, nights: 10, previousNights: 1
  }, 'against the 43 days before; the night on September 14 is outside both windows');
  assert.deepEqual(info.newFaces, [
    { name: 'Dee Example', firstDate: '2026-11-06' }, { name: 'Eli Example', firstDate: '2026-11-21' },
    { name: 'Fay Example', firstDate: '2026-11-23' }, { name: 'Hal Example', firstDate: '2026-12-05' }
  ], 'Gus played back in 2025, so he is not new');
  assert.ok(flow.days.every(day => day.playerList.every(player => !('playerId' in player))), 'player ids stay on the server');

  // Method winners: a tie goes to the method listed first (cash, venmo, zelle, credit, zeffy).
  const fake = (weekday, list) => ({ date: '2026-11-02', weekday, players: list.length, expected: list.reduce((sum, p) => sum + p.collected, 0), playerList: list });
  const paid = (playerId, method, amount) => ({ playerId, name: playerId, status: 'visitor', kind: 'rr', method, owed: amount, collected: method === 'zeffy' || !method ? 0 : amount });
  let tie = plain(cx.cashInsights_([fake('Mon', [paid('a', 'venmo', 15), paid('b', 'cash', 15)])], [], {}, {}, FROM, TO, '', ''));
  assert.deepEqual([tie.topByCount, tie.topByDollars], ['cash', 'cash']);
  tie = plain(cx.cashInsights_([fake('Mon', [paid('a', 'credit', 15), paid('b', 'zelle', 15), paid('c', 'zeffy', 0)])], [], {}, {}, FROM, TO, '', ''));
  assert.deepEqual([tie.topByCount, tie.topByDollars], ['zelle', 'zelle'], 'a three-way tie of zelle, credit and zeffy goes to zelle');
  assert.deepEqual(plain(cx.cashInsights_([], [], {}, {}, FROM, TO, '', '')).trend.collectedChange, null, 'no earlier nights: no percentage');

  // Still one read per tab, now including the targets and the previous window.
  const clubRows = cx.rows_;
  const counts = {};
  cx.rows_ = name => { counts[name] = (counts[name] || 0) + 1; return clubRows(name); };
  try { go('getCashFlow', '2025-11-05', TO); } finally { cx.rows_ = clubRows; }
  ['SessionPlayers', 'OpenPlay', 'SessionPayments', 'ZeffyPasses', 'ZeffyPayments', 'CashTargets'].forEach(name => assert.equal(counts[name], 1, name + ' is read once over 400 days'));
  assert.ok(Object.keys(counts).every(name => counts[name] <= 2), 'no tab is read more than twice: ' + JSON.stringify(counts));
})();

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
assert.match(pageSource, /status that night/, 'the footnote says status is the one that night');
assert.match(pageSource, /\$10 on a player\'s first visit/, 'and gives the first-visit fee');

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
            window.setTimeout(() => {
              let result;
              try { result = wire(run(name, ...plain(args))); } catch (error) { bad({ message: error.message }); return; }
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

  // It loads the last 8 weeks at once, grouped by week, showing that it is loading.
  assert.match(document.getElementById('status').className, /busy/);
  assert.match(text(document.getElementById('status')), /Loading/);
  assert.deepEqual(calls[0], ['getCashFlow', '2026-08-24', FRI], 'eight Monday-to-Sunday weeks, this one included');
  await settle();
  assert.equal(document.querySelector('[data-preset=last8w]').getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('[data-group=week]').getAttribute('aria-pressed'), 'true');
  assert.equal(text(document.getElementById('chart-title')), 'Collected by week');
  const chart = () => document.getElementById('chart');
  assert.equal(chart().querySelectorAll('.hit').length, 8, 'one bar slot per week');
  assert.equal(chart().querySelectorAll('.bar-mark').length, 2, 'weeks with no club nights are gaps');
  assert.equal(chart().querySelectorAll('.gap-mark').length, 6);
  assert.equal(chart().querySelectorAll('.target-line').length, 0);
  assert.equal(document.getElementById('chart-prompt').hidden, false, 'no target yet: the chart still draws, with a prompt');
  assert.match(text(document.getElementById('chart-prompt')), /No weekly target yet/);
  assert.match(text(document.getElementById('legend')), /^Collected/);
  assert.match(chart().querySelector('[data-key="2026-09-28"]').getAttribute('aria-label'), /^\$10\.00, Week of Sep 28, 2026, Collected/);
  assert.match(text(document.getElementById('chart-stats')), /Target total No target/);
  assert.match(text(document.getElementById('period-table')), /Week of Oct 12, 2026 2 \$90\.00 — — … In progress, not counted/);
  // Hover or focus shows the period's details.
  chart().querySelector('[data-key="2026-09-28"]').dispatchEvent(new window.FocusEvent('focus'));
  assert.match(text(chart().querySelector('.tooltip')), /^\$10\.00 Week of Sep 28, 2026/);
  // A weekly target, saved for everyone from beside the chart.
  document.getElementById('target').value = '50';
  document.querySelector('#target-form button').click();
  await settle();
  await settle();
  assert.deepEqual(plain(run('getCashTargets')), { day: null, week: 50, month: null });
  assert.equal(chart().querySelectorAll('.target-line').length, 1);
  assert.equal(document.getElementById('chart-prompt').hidden, true);
  assert.deepEqual(Array.from(chart().querySelectorAll('.bar-mark')).map(bar => bar.getAttribute('data-state')), ['missed', 'in_progress']);
  assert.equal(chart().querySelector('.bar-mark[data-state=missed]').getAttribute('fill'), 'url(#missed-hatch)', 'below target is hatched as well as red');
  assert.deepEqual(Array.from(chart().querySelectorAll('.bar-symbol')).map(node => node.textContent), ['\u2717', '\u2026'], 'and marked with a symbol');
  assert.match(text(document.getElementById('legend')), /✓ Met target ✗ Below target Target \$50\.00 … In progress or partial, not counted/);
  assert.match(text(document.getElementById('chart-stats')), /Target total \$50\.00 \$50\.00 × 1 counted week Over \/ under ▼ Under by \$40\.00 counted weeks only Weeks meeting target 0 of 1 0%/);
  document.querySelector('[data-group=month]').click();
  assert.equal(text(document.getElementById('chart-title')), 'Collected by month');
  assert.equal(text(document.getElementById('target-label')), 'Monthly target');
  assert.equal(chart().querySelectorAll('.hit').length, 3, 'August, September and October');
  assert.match(text(document.getElementById('chart-prompt')), /No monthly target yet/);
  assert.equal(calls.filter(call => call[0] === 'getCashFlow').length, 2, 'switching the grouping needs no new call');
  document.querySelector('[data-group=week]').click();
  document.getElementById('target').value = '';
  document.querySelector('#target-form button').click();
  await settle();
  await settle();
  assert.deepEqual(plain(run('getCashTargets')), { day: null, week: null, month: null }, 'a blank target clears it');
  assert.match(text(document.getElementById('insight-grid')), /Payment mix Most common: Cash by players, Cash by dollars\./);
  assert.match(text(document.getElementById('insight-grid')), /Most active players # Name Status Nights Paid 1 Ben Example Visitor 2 \$30\.00/);
  document.querySelector('[data-preset=last7]').click();
  assert.deepEqual(calls[calls.length - 1], ['getCashFlow', '2026-10-10', FRI]);
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
  // Clearing the count: the night reads as not counted, even though Google leaves the empty fields out.
  inputs[0].value = '';
  inputs[1].value = '';
  monday.querySelector('.count-fields button').click();
  await settle();
  assert.equal(counts().find(row => row[0] === MON), undefined);
  assert.equal(text(monday.querySelector('.diff')), 'Not counted yet');
  assert.equal(inputs[0].value, '');
  assert.match(text(document.getElementById('tiles')), /Cash over \/ short Over by \$2\.25 2 of 3 days counted/);
  document.getElementById('show').click();
  await settle();
  assert.equal(text(document.querySelector('.day[data-date="' + MON + '"] .diff')), 'Not counted yet', 'and after a reload');
  assert.match(text(document.getElementById('tiles')), /2 of 3 days counted/);

  // Quick ranges, an empty range, and errors are all shown.
  const preset = name => { document.querySelector('[data-preset=' + name + ']').click(); return calls[calls.length - 1].slice(1); };
  assert.deepEqual(preset('today'), [FRI, FRI]);
  assert.deepEqual(preset('week'), [MON, FRI], 'the week starts on Monday');
  assert.deepEqual(preset('month'), ['2026-10-01', FRI]);
  assert.deepEqual(preset('last3m'), ['2026-08-01', FRI]);
  assert.deepEqual(preset('year'), ['2026-01-01', FRI]);
  assert.deepEqual(preset('lastMonth'), ['2026-09-01', '2026-09-30']);
  await settle();
  assert.equal(document.querySelectorAll('.day').length, 1, 'only the last answer is shown');
  document.getElementById('from').value = '2026-08-01';
  document.getElementById('to').value = '2026-08-31';
  document.getElementById('show').click();
  await settle();
  assert.match(text(document.getElementById('status')), /No players or payments were recorded/);
  assert.match(text(document.getElementById('days')), /No players or payments in this range/);
  document.getElementById('from').value = '2025-01-01';
  document.getElementById('show').click();
  await settle();
  assert.match(document.getElementById('status').className, /error/);
  assert.match(text(document.getElementById('status')), /Could not load the cash flow: Choose at most 400 days/);
  document.getElementById('from').value = '2026-09-02';
  document.getElementById('show').click();
  assert.match(text(document.getElementById('status')), /on or before/, 'a reversed range is caught before asking Google');
  window.close();
  console.log('Daily cash flow checks passed');
})().catch(error => { console.error(error); process.exit(1); });
