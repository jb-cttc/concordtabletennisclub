// The Clover page's "Cards linked to players" (Clover.html), run in jsdom: Unlink opens a review of what changes, and
// Confirm sends exactly the card and the matches left ticked. Before CLOVER_ENABLED it cannot be confirmed. All names,
// cards and amounts are made up.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(__dirname + '/Clover.html', 'utf8');
const marker = 'var READ_TIMEOUT_MS';
const at = html.indexOf(marker);
assert.ok(at > 0, 'missing the page script');
const code = html.slice(html.lastIndexOf('<script>', at) + 8, html.indexOf('</script>', at));
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const plain = value => JSON.parse(JSON.stringify(value));

const links = enabled => ({
  enabled,
  names: { p1: 'Avery Park', p4: 'Drew Lane' },
  links: [
    { playerId: 'p1', keys: ['card:VISA|411111|1111'], card: 'VISA ••1111', parts: [], source: 'hand', linkedAt: '2026-11-02', matches: [] },
    { playerId: 'p4', keys: ['card:VISA|411111|7777', 'customer:C7'], card: 'VISA ••7777', parts: ['Clover customer'], source: 'hand', linkedAt: '2026-11-09', matches: [
      { date: '2026-11-09', paymentId: 'P1', clock: '7:20 PM', amount: 20, players: ['p4', 'p1'], how: 'hand' },
      { date: '2026-11-16', paymentId: 'P3', clock: '7:02 PM', amount: 20, players: ['p1', 'p4'], how: 'pays-for' }
    ] }
  ]
});

function boot(data) {
  const dom = new JSDOM(html, { url: 'https://example.test/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const window = dom.window;
  const calls = [];
  const answers = { getCloverLinks: () => data, getCloverReport: () => ({ connected: false, problem: 'Add CLOVER_API_TOKEN.', enabled: data.enabled }), unlinkCloverCard: () => ({ enabled: true, names: { p1: 'Avery Park' }, links: data.links.slice(0, 1) }) };
  const runner = () => {
    let ok = () => {};
    const api = {
      withSuccessHandler(fn) { ok = fn; return api; },
      withFailureHandler() { return api; }
    };
    Object.keys(answers).forEach(name => { api[name] = (...args) => { calls.push({ name, args }); setTimeout(() => ok(answers[name](...args)), 0); }; });
    return api;
  };
  window.google = { script: { get run() { return runner(); } } };
  window.eval(code);
  return { window, document: window.document, calls };
}

(async () => {
  const page = boot(links(true));
  await tick();
  const { document } = page;
  assert.equal(document.getElementById('links').hidden, false, 'shown from the Sheet, before the Clover report');
  const rows = [...document.querySelectorAll('#links-list tbody tr')];
  assert.deepEqual(rows.map(row => row.querySelector('td').textContent), ['Avery Park', 'Drew Lane']);
  assert.equal(rows[1].querySelector('td.card').textContent, 'VISA ••7777 and its Clover customer');

  // Find a player narrows the list.
  const find = document.getElementById('links-find');
  find.value = 'drew';
  find.dispatchEvent(new page.window.Event('input'));
  assert.equal(document.querySelectorAll('#links-list tbody tr').length, 1);

  // Unlink opens the review: nothing is sent until Confirm.
  document.querySelector('[data-unlink="card:VISA|411111|7777 customer:C7"]').click();
  const review = document.querySelector('.review');
  assert.match(review.textContent, /Unlink VISA ••7777 and its Clover customer from Drew Lane\?/);
  assert.match(review.textContent, /will not mark Drew Lane Credit/);
  const ticks = [...review.querySelectorAll('input[type=checkbox]')];
  assert.deepEqual(ticks.map(box => box.checked), [true, true], 'each match to undo starts ticked');
  assert.match(ticks[0].parentNode.textContent, /^Mon, Nov 16, 7:02 PM, \$20: Avery Park \+ Drew Lane \(pays-for link\)$/, 'newest first, with everyone on it');
  assert.ok(!page.calls.some(call => call.name === 'unlinkCloverCard'));

  // Untick one, confirm: the page sends the card and only the ticked match.
  ticks[1].checked = false;
  [...review.querySelectorAll('button')].find(button => button.textContent === 'Confirm and unlink').click();
  const sent = page.calls.filter(call => call.name === 'unlinkCloverCard');
  assert.equal(sent.length, 1);
  assert.deepEqual(plain(sent[0].args), ['p4', ['card:VISA|411111|7777', 'customer:C7'], [{ date: '2026-11-16', paymentId: 'P3' }]]);
  await tick();
  assert.match(document.getElementById('links-note').textContent, /^Unlinked VISA ••7777 and its Clover customer from Drew Lane\. 1 match undone: open that night on the desk/);
  assert.equal(document.querySelector('.review'), null, 'the review closes');

  // Before CLOVER_ENABLED: the review shows, but cannot be confirmed.
  const dry = boot(links(false));
  await tick();
  dry.document.querySelector('[data-unlink="card:VISA|411111|1111"]').click();
  const confirm = [...dry.document.querySelectorAll('.review button')].find(button => button.textContent === 'Confirm and unlink');
  assert.equal(confirm.disabled, true);
  assert.match(dry.document.querySelector('.review').textContent, /No matches were recorded through it/);
  assert.match(dry.document.querySelector('.review').textContent, /Unlinking turns on with CLOVER_ENABLED/);

  console.log('Clover linked cards page checks passed');
})().catch(error => { console.error(error); process.exit(1); });
