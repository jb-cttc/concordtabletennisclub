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
assert.ok(offer && html.indexOf(offer[0]) < html.indexOf('2026 Pricing'), 'the board\'s 2027 offer sits above the pricing');
assert.match(offer[0], /<h2 id="offer-heading">Special Offer: 2027 Membership<\/h2>/);
assert.equal((offer[0].match(/<li>/g) || []).length, 2, 'two bullets: member rates for the rest of 2026, and the t-shirt');
const FORM = 'assets/forms/2027-cttc-membership-form.pdf';
assert.ok(offer[0].includes(`href="${FORM}"`), 'the offer links the 2027 form');
assert.match(offer[0], /front desk during club hours/, 'the form is also at the front desk');
assert.ok(html.includes(`<a href="${FORM}" target="_blank" rel="noopener">Download the 2027 membership form</a>`), 'How to join downloads the 2027 form');
assert.doesNotMatch(html, /2026 membership form/i, 'the 2026 form is no longer offered');
const pdf = fs.readFileSync(path.join(root, FORM));
assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', 'the 2027 form is a PDF in the repository');

console.log('Membership page checks passed');
