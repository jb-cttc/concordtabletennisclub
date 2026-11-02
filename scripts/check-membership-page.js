'use strict';

// The Membership page's Cash flow button opens the framed desk page that only the club's Google account can see.
// (Volunteer signups live on the home page: scripts/check-volunteer-signups.js.)

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'membership.html'), 'utf8');

const cash = /<a id="cash-launch"[^>]*>/.exec(html);
assert.ok(cash, 'the Cash flow button is on the page');
assert.match(cash[0], /href="cash\.html"/, 'Cash flow opens the framed page, never the raw Google address');
assert.doesNotMatch(html, /script\.google\.com/, 'the desk address lives in cash.html only');
assert.match(html, /href="index\.html">Home<\/a> page to see which nights need help/, 'volunteers are pointed to the home page');

const offer = /<section class="notice offer"[\s\S]*?<\/section>/.exec(html);
const at = (text) => { const i = html.indexOf(text); assert.ok(i >= 0, `the page has ${text}`); return i; };
assert.ok(offer, 'the board\'s 2027 offer is on the page');
assert.match(offer[0], /<h2 id="offer-heading">Special Offer: 2027 Membership<\/h2>/);
assert.equal((offer[0].match(/<li>/g) || []).length, 2, 'two bullets: the rest of 2026 free, and the t-shirt');
assert.match(offer[0], /rest of 2026 free/);
assert.ok(at(offer[0]) < at('<h2>How to join</h2>') && at('<h2>How to join</h2>') < at('<h2>2027 Pricing</h2>'), 'offer, then how to join, then pricing');

// Until the year turns, the 2026 October rate shows struck through with the offer, and hides itself from January 1.
const was = /<tr class="price-was" data-until="2027-01-01">[\s\S]*?<\/tr>/.exec(html);
assert.ok(was, 'the struck 2026 row is in the pricing table');
assert.match(was[0], /<s>October 2026<\/s>[\s\S]*<s>\$15<\/s>[\s\S]*Free with a 2027 membership/);
assert.match(html, /<p class="price-note" data-until="2027-01-01">[^\n]*rest of 2026 is free/, 'the note explains the deal');
assert.match(html, /querySelectorAll\('\[data-until\]'\)/, 'the page hides data-until items after their date');

const FORM = 'assets/forms/2027-cttc-membership-form.pdf';
const links = html.match(/<a href="[^"]*\.pdf"[^>]*>[^<]*<\/a>/g) || [];
assert.ok(links.length >= 2 && links.every((a) => a.includes(`href="${FORM}"`) && a.includes('2027 membership form')), 'every form link downloads the 2027 form');
assert.ok(offer[0].includes(`href="${FORM}"`), 'the offer links the 2027 form');
assert.doesNotMatch(html, /2026 (membership form|pricing)|cttc-memberships/i, 'nothing offers the 2026 form or pricing');
const pdf = fs.readFileSync(path.join(root, FORM));
assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', 'the 2027 form is a PDF in the repository');

console.log('Membership page checks passed');
