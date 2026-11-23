'use strict';

// The club site's launchers for the desk's own club-only pages (volunteer-admin.html, coach-admin.html): each frames the desk's
// released address with ?view=..., shows an opening line, then a sign-in card unless the desk says it opened. Shared by
// scripts/check-volunteer-admin-page.js and scripts/check-coach-admin-page.js.
const assert = require('node:assert/strict');
const vm = require('node:vm');

function checkAdminLauncher(html, desk, view) {
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-src https:\/\/script\.google\.com(;|$)/, 'only Google can be framed');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/, 'a private page stays out of search results');
  assert.doesNotMatch(html, /<script[^>]*\ssrc=|<link[^>]*rel="stylesheet"|<img\s/i, 'nothing is loaded from elsewhere');
  assert.doesNotMatch(html, /<iframe[^>]*\ssrc=/, 'the frame address is set by the script, from one place');

  // Runs the launcher's script with a stand-in page: the frame address, the opening line, the sign-in card after the wait, and
  // the desk's "opened" word (only from Google's sandbox) taking both away.
  function runLauncher(script) {
    const els = {};
    const el = id => els[id] = els[id] || { id, hidden: true, src: '', href: '', addEventListener() {} };
    let onMessage = null;
    let pending = null;
    vm.runInNewContext(script, { URL, URLSearchParams, document: { getElementById: el },
      window: { addEventListener: (name, fn) => { if (name === 'message') onMessage = fn; } },
      setTimeout: fn => { pending = fn; return 1; }, clearTimeout: () => { pending = null; } });
    return { els, wait: () => pending && pending(), message: (origin, data) => onMessage({ origin, data }) };
  }
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const launched = runLauncher(script);
  const frame = launched.els.admin;
  const direct = launched.els.direct;
  const base = /new URL\('([^']+)'\)/.exec(script)[1];
  assert.match(base, /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/, 'only a released /exec address, never /dev');
  assert.equal(base, /new URL\('([^']+)'\)/.exec(desk)[1], 'the same deployment as the desk, so the same owner-only access');
  assert.equal(frame.src, base + '?view=' + view);
  assert.equal(direct.href, frame.src);
  {
    const opening = runLauncher(script);
    assert.equal(opening.els.loading.hidden, false, 'says it is opening instead of a blank frame');
    assert.equal(opening.els.signin.hidden, true);
    opening.wait();
    assert.equal(opening.els.signin.hidden, false, 'the sign-in card when the page has not said it opened');
    assert.equal(opening.els.loading.hidden, true);
    opening.message('https://evil.example', { cttcDesk: 'ready' });
    assert.equal(opening.els.signin.hidden, false, 'only Google\'s sandbox can say it opened');
    opening.message('https://n-abc123-0lu-script.googleusercontent.com', { cttcDesk: 'ready' });
    assert.equal(opening.els.signin.hidden, true, 'the page opened: the card goes');
    assert.equal(opening.els.loading.hidden, true);
    assert.match(html, /\.loading \{[^}]*pointer-events: none;/, 'the opening line never blocks the page');
    assert.match(html, /<a id="direct" class="go" target="_top">/, 'the sign-in button opens the page itself, where Google can sign in');
  }
}

module.exports = { checkAdminLauncher };
