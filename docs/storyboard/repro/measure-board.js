// Run: PORT=3100 node scripts/desk-preview.js &   then   node docs/storyboard/repro/measure-board.js 54:6
// Measures the Player board's layout at projector sizes on the offline desk preview (made-up back end): for each layout
// and screen size, how many names are cut off (truncated), clipped, or under the strip or footer. The argument is
// players:groupSize[:date[:print<late adds>|moveup]], or nothing for the preview's seeded night.
// Set STORYBOARD_SHOTS=<directory outside the repository> to also save screenshots.
'use strict';
const { chromium } = require('playwright');
const OUT = process.env.STORYBOARD_SHOTS || '';
const BASE = 'http://localhost:3100/';
const SIZES = [[1024, 768], [1280, 720], [1366, 768], [1920, 1080], [1400, 1050], [800, 600]];
const LAYOUTS = ['wall', 'carousel', 'spot'];

async function measure(pop) {
  return pop.evaluate(() => {
    const R = el => el.getBoundingClientRect();
    const board = document.getElementById('board');
    const br = R(board);
    const scale = br.width / 1920;
    const foot = R(document.querySelector('.b-foot'));
    const bc = document.querySelector('.bc');
    const bcR = bc && !bc.classList.contains('hidden') ? R(bc) : null;
    const notice = document.getElementById('board-notice');
    const nR = notice && !notice.hidden ? R(notice) : null;
    const over = (a, b) => b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const out = { scale: +scale.toFixed(3), board: [Math.round(br.left), Math.round(br.top), Math.round(br.width), Math.round(br.height)], panels: [], strip: bcR ? [Math.round(bcR.left), Math.round(bcR.top), Math.round(bcR.width), Math.round(bcR.height)] : null };
    const viewport = document.querySelector('.viewport');
    const vR = viewport ? R(viewport) : null;
    document.querySelectorAll('.b-body .panel, .b-body .index').forEach(p => {
      const pr = R(p);
      if (vR && p.closest('.viewport') && (pr.left >= vR.right - 1 || pr.right <= vR.left + 1)) return; // off-screen carousel panel
      if (p.closest('.wall-fx')) return;
      const body = p.querySelector('.p-body, .idx') || p;
      const bR = R(body);
      const rows = [...p.querySelectorAll('.row, tbody tr, .idx li, .mline')];
      let clipped = 0, partial = 0, contentOverflow = 0, truncated = 0, underStrip = 0, underNotice = 0, underFoot = 0, minFont = 1e9, minRowH = 1e9;
      rows.forEach(r => {
        const rr = R(r);
        if (rr.top >= pr.bottom - 1) clipped += 1; else if (rr.bottom > pr.bottom + 0.5) partial += 1;
        minRowH = Math.min(minRowH, rr.height / scale);
        // content taller than its row (the tag chip under the name spilling into the next row)
        const who = r.querySelector('.who');
        if (who && R(who).height > rr.height + 1) contentOverflow += 1;
        const nm = r.querySelector('.name, td.nm, .nm');
        if (nm) {
          if (nm.scrollWidth > nm.clientWidth + 1) truncated += 1;
          minFont = Math.min(minFont, parseFloat(getComputedStyle(nm).fontSize) * scale);
        }
        if (over(rr, bcR)) underStrip += 1;
        if (over(rr, nR)) underNotice += 1;
        if (rr.bottom > foot.top + 0.5 && rr.top < foot.bottom) underFoot += 1;
      });
      out.panels.push({ key: p.getAttribute('data-panel') || 'index', h: Math.round(pr.height / scale), w: Math.round(pr.width / scale), rows: rows.length, clipped, partial, contentOverflow, truncated, underStrip, underNotice, underFoot, minRowH: Math.round(minRowH), minNamePx: +minFont.toFixed(1) });
    });
    out.wallClass = (document.querySelector('.wall-grid') || {}).className || '';
    return out;
  });
}

async function openBoard(page, date, ww, wh) {
  await page.goto(BASE + '?date=' + date);
  await page.waitForFunction(() => window.cttcDesk && window.cttcDesk.boardData && window.cttcDesk.boardData().date, null, { timeout: 20000 });
  await page.waitForTimeout(2500);
  const [pop] = await Promise.all([page.waitForEvent('popup'), page.click('#player-board')]);
  await pop.waitForTimeout(500);
  const chooser = await pop.$('#choose-desk');
  if (chooser && await chooser.isVisible()) await chooser.click();
  return pop;
}

async function sweep(pop, label, results, shots) {
  for (const layout of LAYOUTS) {
    await pop.click('.bc [data-set="concept"] button[data-value="' + layout + '"]');
    for (const [w, h] of SIZES) {
      await pop.setViewportSize({ width: w, height: h });
      await pop.waitForTimeout(1300);
      const m = await measure(pop);
      results.push({ label, layout, size: w + 'x' + h, ...m });
      if (OUT && shots && shots.includes(layout + w)) await pop.screenshot({ path: OUT + '/' + label + '-' + layout + '-' + w + 'x' + h + '.png' });
    }
  }
}

(async () => {
  const which = process.argv[2] || 'seeded';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('desk: ' + e.message));
  const results = [];
  if (which === 'seeded') {
    const pop = await openBoard(page, '2026-09-28');
    pop.on('pageerror', e => errors.push('board: ' + e.message));
    await sweep(pop, 'seeded6', results, ['wall1366', 'wall1024', 'carousel1366', 'spot1366']);
  } else {
    // A fresh night: sign in N players (by rating order from the directory) with a chosen group size.
    const [n, size, date, extra] = which.split(':');
    const pop = await openBoard(page, date || '2026-11-16');
    pop.on('pageerror', e => errors.push('board: ' + e.message));
    if (size) await page.click('#group-size [data-group-size="' + size + '"]');
    const ids = await page.evaluate(count => {
      const list = [];
      for (let i = 1; list.length < count && i < 2000; i += 1) list.push('p' + i);
      return list;
    }, Number(n));
    for (const id of ids) await page.evaluate(i => window.cttcDesk.add(i), id);
    await page.waitForTimeout(2500);
    if (extra && extra.startsWith('print')) {
      // Print mark without the print dialog, then late adds to grow groups past their size.
      await page.evaluate(() => window.cttcPlayerBoard.printed());
      const late = Number(extra.slice(5)) || 0;
      for (let i = 0; i < late; i += 1) await page.evaluate(id => window.cttcDesk.add(id), 'p' + (Number(n) + 1 + i));
      await page.waitForTimeout(2500);
    }
    if (extra === 'moveup') {
      // Move the top player of each group from group 2 on up a group: Moved up chips (tag line under the name).
      const groups = await page.evaluate(() => window.cttcDesk.boardData().groups.map(g => g.playerIds.slice()));
      for (let gi = 1; gi < groups.length; gi += 1) {
        for (const id of groups[gi].slice(0, 2)) await page.click('#groups [data-move="' + id + '"][data-dir="-1"]').catch(() => {});
      }
      await page.waitForTimeout(2500);
    }
    const sizes = await page.evaluate(() => window.cttcDesk.boardData().groups.map(g => g.playerIds.length));
    results.push({ groupSizes: sizes });
    await sweep(pop, 'n' + n + 's' + (size || '') + (extra || ''), results, ['wall1366', 'wall1024', 'wall1920', 'carousel1366', 'spot1366']);
  }
  console.log(JSON.stringify({ results, errors }, null, 0));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
