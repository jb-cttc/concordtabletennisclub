'use strict';

// "Add to Home Screen": every page carries the icon tags and the header button (scripts/sync-nav.js), the icons are the sizes
// the tags promise, and navtoggle.js shows the button on phones and tablets only. It asks which icon: CTTC (the website)
// or Text CTTC (text.html, which opens Messages with the join text filled in). Then Android's own install prompt when the
// browser offers one, otherwise the steps, on the page to be saved (iPhones save the page that is open).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, ResourceLoader } = require('jsdom');

const root = path.join(__dirname, '..');
const pngSize = file => { const data = fs.readFileSync(path.join(root, file)); return [data.readUInt32BE(16), data.readUInt32BE(20)]; };

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/site.webmanifest'), 'utf8'));
assert.equal(manifest.start_url, '/?from=home-screen', 'the saved icon opens the home page, marked so the page knows it was added');
assert.equal(manifest.id, '/');
assert.deepEqual(manifest.related_applications, [{ platform: 'webapp', url: 'https://concordtabletennisclub.com/assets/site.webmanifest' }], 'Android can tell the page the icon is installed');
assert.equal(manifest.short_name, 'CTTC');
manifest.icons.forEach(icon => {
  const size = Number(icon.sizes.split('x')[0]);
  assert.deepEqual(pngSize('assets/' + icon.src), [size, size], icon.src);
});
assert.deepEqual(pngSize('assets/icons/apple-touch-icon.png'), [180, 180]);

const pages = fs.readdirSync(root).filter(name => name.endsWith('.html') && !['desk.html', 'cash.html', 'text.html'].includes(name));
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
function page(userAgent, address = 'https://concordtabletennisclub.com/', storage) {
  const dom = new JSDOM('<!doctype html><body>' + header + '</body>', { url: address, runScripts: 'outside-only', resources: new ResourceLoader({ userAgent }) });
  if (storage) for (let i = 0; i < storage.length; i += 1) dom.window.localStorage.setItem(storage.key(i), storage.getItem(storage.key(i)));
  dom.window.eval(script);
  return { window: dom.window, document: dom.window.document, button: dom.window.document.querySelector('.home-screen') };
}

// A computer: no button.
assert.equal(page(DESKTOP).button.hidden, true, 'phones and tablets only');

const options = sheet => [...sheet.querySelectorAll('.home-screen-option')];
const labels = box => [...box.querySelectorAll('.home-screen-actions button')].map(button => button.textContent);
const sheetOf = tab => tab.document.querySelector('.home-screen-sheet');

// iPhone on the home page: the button asks which icon, the website or Text CTTC, each with its picture.
let phone = page(IPHONE);
assert.equal(phone.button.hidden, false);
phone.button.click();
let sheet = sheetOf(phone);
assert.equal(sheet.getAttribute('role'), 'dialog');
assert.match(sheet.textContent, /^Add to your Home Screen/);
assert.deepEqual(options(sheet).map(option => option.querySelector('b').textContent), ['CTTC', 'Text CTTC']);
assert.deepEqual(options(sheet).map(option => option.querySelector('img').getAttribute('src')), ['assets/icons/apple-touch-icon.png', 'assets/icons/text-apple-touch-icon.png']);
assert.equal(options(sheet)[1].getAttribute('href'), 'text.html?home-screen', 'Text CTTC is added from its own page, the page it opens');
assert.equal(sheet.querySelector('.home-screen-on'), null, 'nothing is on the Home Screen yet');
sheet.querySelector('.home-screen-box > button.plain').click();
assert.equal(sheetOf(phone), null, 'Not now closes');

// The website's icon: the steps, on the home page.
phone.button.click();
options(sheetOf(phone))[0].click();
sheet = sheetOf(phone);
assert.match(sheet.textContent, /Add CTTC to your Home Screen[\s\S]*Tap Share[\s\S]*Add to Home Screen[\s\S]*Tap Add/);
assert.equal(sheet.querySelector('img').getAttribute('src'), 'assets/icons/apple-touch-icon.png');
assert.equal(sheet.querySelector('.home-screen-arrow'), null, 'no arrow: the page can\'t see where the browser\'s toolbar is');
assert.deepEqual(labels(sheet), ['Not now', 'I added it']);
sheet.querySelectorAll('.home-screen-actions button')[0].click();
assert.equal(sheetOf(phone), null, 'Not now closes');
phone.button.click();
options(sheetOf(phone))[0].click();
[...sheetOf(phone).querySelectorAll('button')].find(button => button.textContent === 'I added it').click();
assert.equal(sheetOf(phone), null);
assert.equal(phone.window.localStorage.getItem('cttc-home-screen'), 'added');
// Added: on any page, the chooser says so beside that icon only.
phone = page(IPHONE, 'https://concordtabletennisclub.com/about.html', phone.window.localStorage);
phone.button.click();
sheet = sheetOf(phone);
assert.deepEqual(options(sheet).map(option => !!option.querySelector('.home-screen-on')), [true, false]);
assert.match(options(sheet)[0].textContent, /On your Home Screen/);

// Opening the site from the icon (in the same browser) marks it added, and the marker leaves the address.
phone = page(IPHONE, 'https://concordtabletennisclub.com/?from=home-screen');
assert.equal(phone.window.location.search, '');
phone.button.click();
assert.deepEqual(options(sheetOf(phone)).map(option => !!option.querySelector('.home-screen-on')), [true, false]);
// The steps open by themselves when an iPhone was sent to the home page to save it.
phone = page(IPHONE, 'https://concordtabletennisclub.com/?home-screen');
assert.match(sheetOf(phone).textContent, /^Add CTTC to your Home Screen/);
assert.equal(phone.window.location.search, '', 'the saved address is the plain home page');

// Android with the browser's install prompt: the website's icon in the chooser shows it, and no steps.
const android = page(ANDROID);
let prompted = 0;
const event = new android.window.Event('beforeinstallprompt', { cancelable: true });
event.prompt = () => { prompted += 1; };
event.userChoice = Promise.resolve({ outcome: 'accepted' });
android.window.dispatchEvent(event);
assert.equal(event.defaultPrevented, true, 'the browser\'s own mini bar waits for the button');
android.button.click();
options(sheetOf(android))[0].click();
assert.equal(prompted, 1);
assert.equal(sheetOf(android), null);
android.window.dispatchEvent(new android.window.Event('appinstalled'));
android.button.click();
assert.ok(options(sheetOf(android))[0].querySelector('.home-screen-on'), 'Android says when it is installed');

// Android without one (Firefox, or already installed): the steps.
const firefox = page(ANDROID.replace('Chrome/130.0', 'Firefox/130.0'));
firefox.button.click();
options(sheetOf(firefox))[0].click();
assert.match(sheetOf(firefox).textContent, /Add to Home screen or Install app/);

// ---- Text CTTC: its own page, icon and name, so it sits beside the CTTC icon ----
const textHtml = fs.readFileSync(path.join(root, 'text.html'), 'utf8');
const textManifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/text.webmanifest'), 'utf8'));
assert.equal(textManifest.id, '/text.html', 'its own id, so it is a second icon, not the CTTC one again');
assert.equal(textManifest.start_url, '/text.html?from=home-screen');
assert.ok(textManifest.start_url.startsWith(textManifest.scope));
assert.equal(textManifest.short_name, 'Text CTTC', 'short enough not to be cut off under the icon');
textManifest.icons.forEach(icon => {
  const size = Number(icon.sizes.split('x')[0]);
  assert.deepEqual(pngSize('assets/' + icon.src), [size, size], icon.src);
});
assert.deepEqual(pngSize('assets/icons/text-apple-touch-icon.png'), [180, 180]);
assert.match(textHtml, /<link rel="apple-touch-icon" href="assets\/icons\/text-apple-touch-icon\.png">/);
assert.match(textHtml, /<link rel="manifest" href="assets\/text\.webmanifest">/);
assert.match(textHtml, /<meta name="apple-mobile-web-app-title" content="Text CTTC">/);
const SEND = 'sms:+19252383505?&body=' + encodeURIComponent('I\'ll join CTTC\'s RR today');
const teaserLink = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).window.document.querySelector('.tonight-text-box a').getAttribute('href');
assert.equal(teaserLink, SEND, 'the same text as the Text us link beside the Tonight button');

const pageScript = /<script>\n([\s\S]*?)<\/script>/.exec(textHtml)[1];
function textPage(userAgent, address, { storage, standalone = false } = {}) {
  const dom = new JSDOM(textHtml.replace(/<script[\s\S]*?<\/script>/g, ''), { url: address, runScripts: 'outside-only', resources: new ResourceLoader({ userAgent }) });
  const window = dom.window;
  if (storage) for (let i = 0; i < storage.length; i += 1) window.localStorage.setItem(storage.key(i), storage.getItem(storage.key(i)));
  window.matchMedia = query => ({ matches: standalone && /display-mode: standalone/.test(query) });
  const opened = [];
  window.document.addEventListener('click', clicked => {
    const link = clicked.target.closest && clicked.target.closest('a');
    if (link) { opened.push(link.getAttribute('href')); clicked.preventDefault(); }
  });
  window.eval(pageScript);
  window.eval(script);
  return { window, document: window.document, opened };
}
const TEXT = 'https://concordtabletennisclub.com/text.html';
let text = textPage(IPHONE, TEXT);
assert.deepEqual(text.opened, [], 'opened in the browser, nothing happens until the button is tapped');
assert.equal(sheetOf(text), null);
assert.equal(text.document.querySelector('#text-cttc-send').getAttribute('href'), SEND);
// From the icon: straight to Messages with the text filled in (the big button stays for a phone that wants a tap).
assert.deepEqual(textPage(IPHONE, TEXT + '?from=home-screen').opened, [SEND], 'from the icon, opening in the browser');
assert.deepEqual(textPage(IPHONE, TEXT, { standalone: true }).opened, [SEND], 'from the icon, opening as its own app');
assert.deepEqual(textPage(DESKTOP, TEXT + '?from=home-screen').opened, [SEND], 'a Mac does the same');

// Chosen from the header button: the steps, for this icon, and its own "added".
text = textPage(IPHONE, TEXT + '?home-screen');
assert.deepEqual(text.opened, [], 'adding it does not open Messages');
sheet = sheetOf(text);
assert.match(sheet.textContent, /^Add Text CTTC to your Home Screen[\s\S]*opens Messages[\s\S]*Tap Share[\s\S]*Add to Home Screen[\s\S]*Text CTTC icon is on your Home Screen/);
assert.equal(sheet.querySelector('img').getAttribute('src'), 'assets/icons/text-apple-touch-icon.png');
assert.equal(text.window.location.search, '?from=home-screen', 'an iPhone saves the address that is open: it says the icon opened it');
[...sheet.querySelectorAll('button')].find(button => button.textContent === 'I added it').click();
assert.equal(text.window.localStorage.getItem('cttc-home-screen-text'), 'added');
assert.equal(text.window.localStorage.getItem('cttc-home-screen'), null, 'the CTTC icon is a different one');
phone = page(IPHONE, 'https://concordtabletennisclub.com/', text.window.localStorage);
phone.button.click();
assert.deepEqual(options(sheetOf(phone)).map(option => !!option.querySelector('.home-screen-on')), [false, true]);
// Android: the steps, then one tap on the browser's own prompt once it offers one.
text = textPage(ANDROID, TEXT + '?home-screen');
assert.match(sheetOf(text).textContent, /Add to Home screen or Install app/);
let textPrompted = 0;
const install = new text.window.Event('beforeinstallprompt', { cancelable: true });
install.prompt = () => { textPrompted += 1; };
install.userChoice = Promise.resolve({ outcome: 'accepted' });
text.window.dispatchEvent(install);
const add = [...sheetOf(text).querySelectorAll('button')].find(button => button.textContent === 'Add Text CTTC');
assert.ok(add, 'the prompt arrives: one button adds it');
add.click();
assert.equal(textPrompted, 1);
assert.equal(textPage(DESKTOP, TEXT + '?home-screen').document.querySelector('.home-screen-sheet'), null, 'a computer has no Home Screen');

console.log('Home Screen checks passed');
