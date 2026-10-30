'use strict';

// "Add to Home Screen": every page carries the icon tags and the header button (scripts/sync-nav.js), the icons are the sizes
// the tags promise, and navtoggle.js shows the button on phones and tablets only: Android's own install prompt when the
// browser offers one, otherwise the steps, with iPhones sent to the home page first so the saved icon opens it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, ResourceLoader } = require('jsdom');

const root = path.join(__dirname, '..');
const pngSize = file => { const data = fs.readFileSync(path.join(root, file)); return [data.readUInt32BE(16), data.readUInt32BE(20)]; };

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/site.webmanifest'), 'utf8'));
assert.equal(manifest.start_url, '/', 'the saved icon opens the home page');
assert.equal(manifest.short_name, 'CTTC');
manifest.icons.forEach(icon => {
  const size = Number(icon.sizes.split('x')[0]);
  assert.deepEqual(pngSize('assets/' + icon.src), [size, size], icon.src);
});
assert.deepEqual(pngSize('assets/icons/apple-touch-icon.png'), [180, 180]);

const pages = fs.readdirSync(root).filter(name => name.endsWith('.html') && name !== 'desk.html' && name !== 'cash.html');
pages.forEach(name => {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  assert.match(html, /<link rel="apple-touch-icon" href="assets\/icons\/apple-touch-icon\.png">/, name);
  assert.match(html, /<link rel="manifest" href="assets\/site\.webmanifest">/, name);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="CTTC">/, name);
  assert.match(html, /<button class="home-screen" type="button" aria-label="Add CTTC to your Home Screen" title="Add to Home Screen" hidden>/, name);
});

const script = fs.readFileSync(path.join(root, 'navtoggle.js'), 'utf8');
const header = /<header>[\s\S]*?<\/header>/.exec(fs.readFileSync(path.join(root, 'index.html'), 'utf8'))[0];
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
function page(userAgent, address = 'https://concordtabletennisclub.com/') {
  const dom = new JSDOM('<!doctype html><body>' + header + '</body>', { url: address, runScripts: 'outside-only', resources: new ResourceLoader({ userAgent }) });
  dom.window.eval(script);
  return { window: dom.window, document: dom.window.document, button: dom.window.document.querySelector('.home-screen') };
}

// A computer: no button.
assert.equal(page(DESKTOP).button.hidden, true, 'phones and tablets only');

// iPhone on the home page: the steps, closed with Close.
let phone = page(IPHONE);
assert.equal(phone.button.hidden, false);
phone.button.click();
const sheet = phone.document.querySelector('.home-screen-sheet');
assert.equal(sheet.getAttribute('role'), 'dialog');
assert.match(sheet.textContent, /Add CTTC to your Home Screen[\s\S]*Tap Share[\s\S]*Add to Home Screen[\s\S]*Tap Add/);
sheet.querySelector('button').click();
assert.equal(phone.document.querySelector('.home-screen-sheet'), null);

// iPhone on another page: the button goes to the home page, which opens with the steps and drops the marker from the address.
assert.match(script, /if \(ios && !home\) \{ window\.location\.href = '\.\/\?home-screen'; return; \}/, 'an iPhone elsewhere goes to the home page first');
assert.equal(page(IPHONE, 'https://concordtabletennisclub.com/about.html?home-screen').document.querySelector('.home-screen-sheet'), null, 'only the home page opens the steps');
phone = page(IPHONE, 'https://concordtabletennisclub.com/?home-screen');
assert.ok(phone.document.querySelector('.home-screen-sheet'), 'the home page opens with the steps');
assert.equal(phone.window.location.search, '', 'the saved address is the plain home page');

// Android with the browser's install prompt: one tap shows it, and no steps.
const android = page(ANDROID);
let prompted = 0;
const event = new android.window.Event('beforeinstallprompt', { cancelable: true });
event.prompt = () => { prompted += 1; };
event.userChoice = Promise.resolve({ outcome: 'accepted' });
android.window.dispatchEvent(event);
assert.equal(event.defaultPrevented, true, 'the browser\'s own mini bar waits for the button');
android.button.click();
assert.equal(prompted, 1);
assert.equal(android.document.querySelector('.home-screen-sheet'), null);

// Android without one (Firefox, or already installed): the steps.
const firefox = page(ANDROID.replace('Chrome/130.0', 'Firefox/130.0'));
firefox.button.click();
assert.match(firefox.document.querySelector('.home-screen-sheet').textContent, /Add to Home screen or Install app/);

console.log('Home Screen checks passed');
