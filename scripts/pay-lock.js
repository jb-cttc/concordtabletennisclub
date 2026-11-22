'use strict';

// Seals the Venmo and Zelle details into pay.js (LOCKED) so only the desk QR code's link opens them; see pay.js.
//
//   npm run build:pay-lock -- --accounts <file.json> [--key <the desk key>]
//
// <file.json> holds { "venmo", "venmoLast4", "zelle", "zelleName" }. Keep it outside the repository, and never commit
// it or the key. With --key, the printed code keeps working (use it when only the details change); without it, a new
// key is made and the desk needs a newly printed code (the old one stops working). Prints the link to put in the code:
// https://concordtabletennisclub.com/pay.html#k=<key>.

const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

const PAGE = 'https://concordtabletennisclub.com/pay.html';
const FIELDS = ['venmo', 'venmoLast4', 'zelle', 'zelleName'];
const b64 = bytes => Buffer.from(bytes).toString('base64url');

// The details as LOCKED holds them: base64url of the 12-byte IV, then the AES-GCM ciphertext and tag.
async function seal(accounts, key) {
  const plain = {};
  FIELDS.forEach(field => { plain[field] = String(accounts[field] || ''); });
  const aes = await webcrypto.subtle.importKey('raw', Buffer.from(key, 'base64url'), 'AES-GCM', false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const sealed = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(plain)));
  return b64(Buffer.concat([Buffer.from(iv), Buffer.from(sealed)]));
}

// A new 128-bit key: 22 base64url characters.
function newKey() {
  return b64(webcrypto.getRandomValues(new Uint8Array(16)));
}

function setLocked(script, locked) {
  const line = /^  var LOCKED = "[A-Za-z0-9_-]*";$/m;
  if (!line.test(script)) throw new Error('pay.js has no LOCKED line');
  return script.replace(line, '  var LOCKED = "' + locked + '";');
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const file = option('--accounts');
  if (!file) throw new Error('usage: npm run build:pay-lock -- --accounts <file.json> [--key <the desk key>]');
  const root = path.join(__dirname, '..');
  if (path.resolve(file).startsWith(root + path.sep)) throw new Error('keep the accounts file outside the repository');
  const key = option('--key') || newKey();
  if (!/^[A-Za-z0-9_-]{22}$/.test(key)) throw new Error('the key is 22 characters of A-Z, a-z, 0-9, - and _');
  const accounts = JSON.parse(fs.readFileSync(file, 'utf8'));
  const target = path.join(root, 'pay.js');
  fs.writeFileSync(target, setLocked(fs.readFileSync(target, 'utf8'), await seal(accounts, key)));
  console.log('pay.js sealed' + (option('--key') ? ' with the same key: the printed code still works.' : ' with a new key: print a new desk code.'));
  console.log('Desk link (keep it off GitHub): ' + PAGE + '#k=' + key);
}

module.exports = { seal, newKey, setLocked };
if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1); });
