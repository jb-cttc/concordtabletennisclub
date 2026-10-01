'use strict';

// Builds the same signed link token the public sign-up app (subscribe-app/Code.js) verifies:
// base64url(JSON {e: address, p: 'unsubscribe', x: expiry ms}) + '.' + base64url(HMAC-SHA256(payload, secret)).
// The secret is the sign-up project's TOKEN_SECRET script property, kept as a GitHub Actions secret.
const crypto = require('crypto');

const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function makeUnsubscribeToken(address, secret, now) {
  if (!secret) throw new Error('A signing secret is required.');
  const expires = (now == null ? Date.now() : now) + TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ e: String(address).toLowerCase(), p: 'unsubscribe', x: expires })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + signature;
}

module.exports = { makeUnsubscribeToken, TOKEN_TTL_MS };
