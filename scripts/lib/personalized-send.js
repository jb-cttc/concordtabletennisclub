'use strict';

// Sends one message per subscriber so each Unsubscribe link carries a signed token for that address.
// The workflow log is public, so nothing here ever prints an address or a provider message.
const { makeUnsubscribeToken } = require('./unsubscribe-token');

const LINK_MARK = '{{UNSUBSCRIBE_LINK}}';

function fill(text, link) {
  return text.split(LINK_MARK).join(link);
}

// `template` was built with its unsubscribe link set to LINK_MARK. Without a secret every message gets the
// plain unsubscribe page, where the person types their address instead.
async function sendPersonalized(transport, options) {
  const addresses = Array.from(new Set(options.subscribers.map(function (a) { return String(a).trim().toLowerCase(); }).filter(Boolean)));
  const failures = {};
  let sent = 0;
  let failed = 0;
  for (const address of addresses) {
    const link = options.secret
      ? options.unsubscribeUrl + '?t=' + makeUnsubscribeToken(address, options.secret, options.now)
      : options.unsubscribeUrl;
    try {
      await transport.sendMail({
        from: options.from,
        to: address,
        subject: options.subject,
        headers: { 'List-Unsubscribe': '<' + link + '>' },
        text: fill(options.template.text, link),
        html: fill(options.template.html, link)
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      const code = String(error && (error.responseCode || error.code) || 'error');
      failures[code] = (failures[code] || 0) + 1;
    }
  }
  return { sent: sent, failed: failed, failures: failures };
}

module.exports = { sendPersonalized, LINK_MARK };
