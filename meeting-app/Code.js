// CTTC Meeting: the executive committee's agenda tracker. Its own Apps Script project, like coaching-app/ and
// staffing-app/, so none of the desk's code or data is reachable from it. The web app runs as, and opens only for, the
// club's Google account (appsscript.json: access MYSELF), the same as the desk.
//
// Two pages: the controller (no view: the agenda, follow-ups, attendees and minutes, for the person running the
// meeting) and the board (?view=board: a clean projector view that follows the controller). The site's meeting.html
// frames both, so Google's banner stays hidden; the Membership page's locked Executive Committee Meeting button opens it.
//
// Storage: script properties only (no Sheet, no Drive, no email, no web calls, so the app needs no permission prompt).
// Each meeting is one JSON value, split into 8,000-character pieces (a property holds about 9 KB; all of them together
// 500 KB). The meeting on screen is MEETING_CURRENT; MEETING_INDEX lists every meeting kept. Every change goes through
// saveChanges under the script lock, so two screens editing at once never lose each other's changes.
//
// Follow mode (the board, and a second controller): the board asks followTick every few seconds. That is one script
// cache read (a stamp: meeting id and version); only when the stamp moved does it get the meeting, from the cache, or
// from the properties if the cache lost it. Costs and limits: docs/google-limits.md (Executive committee meeting app).
var TZ = 'America/Los_Angeles';
var SITE = 'https://concordtabletennisclub.com';
var CURRENT_KEY = 'MEETING_CURRENT';
var INDEX_KEY = 'MEETING_INDEX';
var CHUNK = 8000;
// One meeting may use at most this much of the 500 KB the properties hold, so dozens of meetings fit.
var MEETING_MAX = 60000;
var KEEP_MAX = 400000;
var CACHE_SECONDS = 21600;
var STAMP_KEY = 'meeting:stamp';
var STATE_KEY = 'meeting:state';
// Model.js loads after this file, so the model is made on first use.
var MODEL = null;
function model_() { return MODEL || (MODEL = MeetingModel_()); }

function doGet(e) {
  var board = !!(e && e.parameter && e.parameter.view === 'board');
  var template = fill_(HtmlService.createTemplateFromFile(board ? 'Board' : 'Control'));
  return template.evaluate()
    .setTitle(board ? 'CTTC Meeting Board' : (template.mode === 'dev' ? 'DEV - ' : '') + 'CTTC Executive Committee Meeting')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// A piece of a page (Theme, Guard, Sync), filled in like the page itself: Sync carries the model and this address.
function include_(name) {
  return fill_(HtmlService.createTemplateFromFile(name)).evaluate().getContent();
}

// What every page and piece may print: the model's source, /dev or /exec, and this app's own address.
function fill_(template) {
  template.model = MeetingModel_.toString();
  template.mode = appMode_();
  template.appUrl = appUrl_();
  return template;
}

function appMode_() {
  var url = '';
  try { url = String(ScriptApp.getService().getUrl() || ''); } catch (error) { url = ''; }
  return /\/dev$/.test(url) ? 'dev' : /\/exec$/.test(url) ? 'live' : 'unknown';
}
function appUrl_() {
  try { return String(ScriptApp.getService().getUrl() || ''); } catch (error) { return ''; }
}

// ---- Pages call these ----

// Everything the controller needs when it opens: the meeting on screen (or null before the first one), and the list.
function getState() {
  return { meeting: current_(), meetings: index_(), appUrl: appUrl_(), today: today_() };
}

// The board's (and a second controller's) beat: { stamp } when nothing moved since known, else { stamp, meeting }.
function followTick(known) {
  var cache = scriptCache_();
  var stamp = null;
  try { stamp = cache ? cache.get(STAMP_KEY) : null; } catch (error) { cache = null; }
  if (stamp && stamp === known) return { stamp: stamp };
  var meeting = null;
  if (stamp && cache) {
    try { meeting = JSON.parse(cache.get(STATE_KEY) || 'null'); } catch (error) { meeting = null; }
    if (meeting && stampOf_(meeting) !== stamp) meeting = null;
  }
  if (!meeting) {
    meeting = current_();
    publish_(meeting);
  }
  stamp = stampOf_(meeting);
  return stamp === known ? { stamp: stamp } : { stamp: stamp, meeting: meeting };
}

// Applies the page's changes, in order, to the meeting on screen, and returns it saved. meetingId is the meeting the
// page made them on: if another screen has since opened a different meeting, nothing is applied and the page gets the
// meeting now on screen instead ({ moved: true }).
function saveChanges(meetingId, changes) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 100) throw new Error('Nothing to save.');
  return locked_(function () {
    var meeting = current_();
    if (!meeting || meeting.id !== meetingId) return { moved: true, meeting: meeting };
    var now = Date.now();
    changes.forEach(function (change) { model_().apply(meeting, change, now); });
    meeting.version += 1;
    meeting.updatedAt = now;
    store_(meeting);
    return { meeting: meeting };
  });
}

// A new meeting becomes the one on screen. carry brings forward the last meeting's open follow-ups, its items marked
// Next meeting, and its attendees as expected, to check in (guests left out). agenda is the reviewed list from the page ([{ title, details }]).
function startMeeting(fields) {
  fields = fields || {};
  return locked_(function () {
    var previous = current_();
    var now = Date.now();
    var meeting = model_().blank({ id: newId_('m'), title: fields.title, date: fields.date || today_() }, now);
    // The projector settings stay as they were (text size, layout, attendee panel).
    if (previous && previous.display) meeting.display = model_().display(previous);
    var carried = fields.carry ? model_().carryOver(previous, function () { return newId_(''); }) : { items: [], actions: [], attendees: [] };
    var planned = (Array.isArray(fields.agenda) ? fields.agenda : []).map(function (raw) {
      return { id: newId_(''), title: raw && raw.title, details: raw && raw.details, added: false };
    });
    model_().apply(meeting, { type: 'addItems', items: planned.concat(carried.items) }, now);
    carried.actions.forEach(function (a) { model_().apply(meeting, { type: 'addAction', action: a }, now); });
    model_().apply(meeting, { type: 'attendees', list: carried.attendees }, now);
    meeting.version = 1;
    store_(meeting);
    return getState();
  });
}

// Puts an earlier meeting back on screen (to look back, or finish it).
function openMeeting(id) {
  return locked_(function () {
    var meeting = load_(id);
    if (!meeting) throw new Error('That meeting is no longer kept.');
    meeting.version += 1;
    store_(meeting);
    return getState();
  });
}

// Removes a meeting that is not on screen.
function deleteMeeting(id) {
  return locked_(function () {
    var current = props_().getProperty(CURRENT_KEY);
    if (id === current) throw new Error('This meeting is on screen. Open or start another one first.');
    if (!load_(id)) return getState();
    removeStored_(id);
    saveIndex_(index_().filter(function (entry) { return entry.id !== id; }));
    return getState();
  });
}

// ---- Storage ----

function props_() { return PropertiesService.getScriptProperties(); }
function scriptCache_() { try { return CacheService.getScriptCache(); } catch (error) { return null; } }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function stampOf_(meeting) { return meeting ? meeting.id + ':' + meeting.version : 'none'; }

function newId_(prefix) {
  var alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  var out = prefix ? prefix + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd') : '';
  for (var i = 0; i < 8; i += 1) out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return out;
}

function locked_(work) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Another screen is saving. Try again in a moment.');
  try { return work(); } finally { lock.releaseLock(); }
}

function current_() {
  var id = props_().getProperty(CURRENT_KEY);
  return id ? load_(id) : null;
}

function load_(id) {
  if (!model_().okId(id)) return null;
  var store = props_();
  var head = store.getProperty('MEETING_' + id);
  if (!head) return null;
  try {
    var pieces = JSON.parse(head).pieces;
    var json = '';
    for (var i = 0; i < pieces; i += 1) json += store.getProperty('MEETING_' + id + '_' + i) || '';
    return JSON.parse(json);
  } catch (error) {
    console.error('Meeting ' + id + ' could not be read: ' + error);
    return null;
  }
}

// Saves the meeting, makes it the one on screen, updates the list and tells following screens.
function store_(meeting) {
  var json = JSON.stringify(meeting);
  if (json.length > MEETING_MAX) throw new Error('This meeting is full: shorten some notes, or start a new meeting.');
  var store = props_();
  var before = JSON.parse(store.getProperty('MEETING_' + meeting.id) || '{"pieces":0}').pieces;
  var entries = index_().filter(function (entry) { return entry.id !== meeting.id; });
  var used = entries.reduce(function (sum, entry) { return sum + (entry.size || 0); }, 0);
  if (used + json.length > KEEP_MAX) throw new Error('The meeting store is full: delete an old meeting under Meetings first.');
  var values = {};
  var pieces = Math.ceil(json.length / CHUNK);
  for (var i = 0; i < pieces; i += 1) values['MEETING_' + meeting.id + '_' + i] = json.slice(i * CHUNK, (i + 1) * CHUNK);
  values['MEETING_' + meeting.id] = JSON.stringify({ pieces: pieces });
  values[CURRENT_KEY] = meeting.id;
  var c = model_().counts(meeting);
  entries.push({ id: meeting.id, title: meeting.title, date: meeting.date, items: c.items, done: c.done, actions: c.actions, updatedAt: meeting.updatedAt, size: json.length });
  entries.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.updatedAt - a.updatedAt; });
  values[INDEX_KEY] = JSON.stringify(entries);
  store.setProperties(values);
  for (var j = pieces; j < before; j += 1) store.deleteProperty('MEETING_' + meeting.id + '_' + j);
  publish_(meeting);
}

function removeStored_(id) {
  var store = props_();
  var pieces = JSON.parse(store.getProperty('MEETING_' + id) || '{"pieces":0}').pieces;
  for (var i = 0; i < pieces; i += 1) store.deleteProperty('MEETING_' + id + '_' + i);
  store.deleteProperty('MEETING_' + id);
}

function index_() {
  try { return JSON.parse(props_().getProperty(INDEX_KEY) || '[]'); } catch (error) { return []; }
}
function saveIndex_(entries) { props_().setProperty(INDEX_KEY, JSON.stringify(entries)); }

// The stamp and the meeting in the script cache, for following screens. A failed write only means the next
// followTick reads the properties instead.
function publish_(meeting) {
  var cache = scriptCache_();
  if (!cache) return;
  try {
    var values = {};
    values[STAMP_KEY] = stampOf_(meeting);
    values[STATE_KEY] = JSON.stringify(meeting);
    cache.putAll(values, CACHE_SECONDS);
  } catch (error) { /* followers read the properties */ }
}
