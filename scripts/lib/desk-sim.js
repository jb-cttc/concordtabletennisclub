// A whole-desk simulator for tests: the real apps-script server files run against an in-memory Google Sheet, and the
// real Index.html page runs in jsdom tabs, all on one virtual clock. The network between each tab and Google can be
// slowed, cut, or made to lose replies, and the server's script lock is modelled, so a test can play out a club
// night (slow Google, a dropped connection, a reload in the middle of a save, a second tab) in milliseconds.
//
// Nothing here talks to Google. Test data is synthetic.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const DESK = path.join(__dirname, '..', '..', 'apps-script');
const SERVER_FILES = fs.readdirSync(DESK).filter(name => /^[A-Z].*\.js$/.test(name)).sort();

// ---------------------------------------------------------------------------------------------------------------
// Virtual clock. Every timer in every tab and on the server goes through one queue, so time only moves when a test
// says so, and the order of events is reproducible.
function createClock(start) {
  let now = start;
  let seq = 0;
  const queue = [];
  function at(time, fn, owner) {
    const event = { time: Math.max(time, now), seq: ++seq, fn, owner, cancelled: false };
    let low = 0;
    let high = queue.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      const other = queue[mid];
      if (other.time < event.time || (other.time === event.time && other.seq < event.seq)) low = mid + 1;
      else high = mid;
    }
    queue.splice(low, 0, event);
    return event;
  }
  const settle = () => new Promise(resolve => setImmediate(resolve));
  async function runUntil(time) {
    await settle();
    while (queue.length && queue[0].time <= time) {
      const event = queue.shift();
      if (event.cancelled || (event.owner && event.owner.closed)) continue;
      now = event.time;
      try { event.fn(); } catch (error) { if (event.owner && event.owner.onError) event.owner.onError(error); else throw error; }
      await settle();
      await settle();
    }
    now = Math.max(now, time);
    await settle();
  }
  return {
    now: () => now,
    at,
    after: (ms, fn, owner) => at(now + ms, fn, owner),
    run: ms => runUntil(now + ms),
    runUntil
  };
}

function fakeDateClass(RealDate, clock) {
  class FakeDate extends RealDate {
    constructor(...args) {
      if (!args.length) super(clock.now());
      else super(...args);
    }
    static now() { return clock.now(); }
  }
  return FakeDate;
}

// A seeded random source, so a failing night can be replayed exactly.
function random(seed) {
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
  next.between = (low, high) => low + next() * (high - low);
  next.chance = p => next() < p;
  next.pick = list => list[Math.floor(next() * list.length)];
  return next;
}

// ---------------------------------------------------------------------------------------------------------------
// In-memory spreadsheet with the Google behaviors the desk relies on: blank cells are '', getLastRow ignores blank
// rows, numbers and yyyy-mm-dd text written to a cell come back as numbers and dates.
function createSpreadsheet(DateClass) {
  const sheets = [];
  function coerce(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
      // Like Sheets, a leading ' keeps the rest as plain text and is not stored.
      if (value[0] === "'") return value.slice(1);
      if (/^-?\d+(\.\d+)?$/.test(value.trim()) && value.trim() !== '') return Number(value);
      // Like Sheets, a typed date is midnight in the spreadsheet's time zone (Pacific), whatever zone runs the checks.
      const date = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (date) return new DateClass(pacificMidnight(Number(date[1]), Number(date[2]), Number(date[3])));
      return value;
    }
    if (value instanceof Date) return new DateClass(value.getTime());
    return value;
  }
  function copy(value) { return value instanceof Date ? new DateClass(value.getTime()) : value; }
  function makeSheet(name) {
    const cells = [];
    let maxColumns = 26;
    const sheet = {
      cells,
      getName: () => name,
      setName: next => { name = next; return sheet; },
      getLastRow: () => {
        for (let row = cells.length; row >= 1; row -= 1) if ((cells[row - 1] || []).some(value => value !== '' && value !== undefined)) return row;
        return 0;
      },
      getLastColumn: () => {
        let last = 0;
        cells.forEach(row => (row || []).forEach((value, index) => { if (value !== '' && value !== undefined) last = Math.max(last, index + 1); }));
        return last;
      },
      getMaxColumns: () => maxColumns,
      getMaxRows: () => Math.max(1000, cells.length),
      insertRowsAfter: () => sheet,
      insertColumnsAfter: (after, count) => { maxColumns += count; },
      getDataRange: () => range(1, 1, Math.max(1, sheet.getLastRow()), Math.max(1, sheet.getLastColumn())),
      getRange: (row, column, rows, columns) => {
        if (typeof row === 'string') {
          const parts = row.split(':').map(ref => ref.match(/^([A-Z]+)(\d+)$/)).map(m => [Number(m[2]), m[1].split('').reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0)]);
          const end = parts[1] || parts[0];
          return range(parts[0][0], parts[0][1], end[0] - parts[0][0] + 1, end[1] - parts[0][1] + 1);
        }
        return range(row, column, rows || 1, columns || 1);
      },
      appendRow: values => { const at = sheet.getLastRow() + 1; range(at, 1, 1, values.length).setValues([values]); return sheet; },
      deleteRow: row => { cells.splice(row - 1, 1); return sheet; },
      deleteRows: (row, count) => { cells.splice(row - 1, count); return sheet; },
      setFrozenRows: () => sheet,
      autoResizeColumns: () => sheet,
      setColumnWidth: () => sheet,
      getColumnWidth: () => 120
    };
    function range(row, column, rows, columns) {
      if (row < 1 || column < 1 || rows < 1 || columns < 1) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      const read = display => {
        const out = [];
        for (let r = 0; r < rows; r += 1) {
          const line = [];
          for (let c = 0; c < columns; c += 1) {
            const value = (cells[row - 1 + r] || [])[column - 1 + c];
            const plain = value === undefined ? '' : copy(value);
            line.push(display ? (plain instanceof Date ? plain.toISOString().slice(0, 10) : String(plain)) : plain);
          }
          out.push(line);
        }
        return out;
      };
      const self = {
        getValues: () => read(false),
        getDisplayValues: () => read(true),
        getValue: () => read(false)[0][0],
        setValues: values => {
          if (values.length !== rows || values.some(line => line.length !== columns)) throw new Error('The number of rows or columns in the data does not match the range.');
          values.forEach((line, r) => {
            const target = cells[row - 1 + r] || (cells[row - 1 + r] = []);
            line.forEach((value, c) => { target[column - 1 + c] = coerce(value); });
          });
          return self;
        },
        setValue: value => self.setValues([[value]]),
        setNumberFormat: () => self,
        setBackground: () => self, setFontColor: () => self, setFontWeight: () => self, setWrap: () => self
      };
      return self;
    }
    return sheet;
  }
  const spreadsheet = {
    getId: () => 'sim-spreadsheet',
    getSheets: () => sheets.slice(),
    getSheetByName: name => sheets.find(sheet => sheet.getName() === name) || null,
    insertSheet: name => { const sheet = makeSheet(name); sheets.push(sheet); return sheet; }
  };
  return spreadsheet;
}

// ---------------------------------------------------------------------------------------------------------------
// The Google side: the real server code, a script lock that queues callers, and a cost per call.
function createServer(clock, options) {
  const DateClass = fakeDateClass(Date, clock);
  const spreadsheet = createSpreadsheet(DateClass);
  const properties = {};
  const audit = [];
  const calls = [];
  // The lock is busy from lockBusyFrom until lockFreeAt: a call that does slow work (Gmail) before taking the lock
  // holds it only for the part after.
  let lockBusyFrom = 0;
  let lockFreeAt = 0;
  let lockHeld = false;
  let current = null;
  const cost = options.cost || (() => 200);
  const gmail = { searchMs: 0, threads: [] };
  const cache = new Map();

  class LockWait extends Error {}
  const lock = {
    waitLock(ms) {
      if (lockHeld) return;
      if (lockFreeAt > clock.now() && lockBusyFrom <= clock.now()) {
        if (clock.now() - current.arrived >= ms) throw new Error('Lock timeout: another process was holding the lock for too long.');
        current.waitUntil = Math.min(lockFreeAt, current.arrived + ms);
        throw new LockWait('waiting for the script lock');
      }
      lockHeld = true;
      current.locked = true;
      current.lockedAfter = current.extraMs;
    },
    tryLock(ms) {
      if (lockHeld) return true;
      if (lockFreeAt > clock.now() && lockBusyFrom <= clock.now()) {
        if (clock.now() - current.arrived >= ms) return false;
        current.waitUntil = Math.min(lockFreeAt, current.arrived + ms);
        throw new LockWait('waiting for the script lock');
      }
      lockHeld = true;
      current.locked = true;
      current.lockedAfter = current.extraMs;
      return true;
    },
    hasLock: () => lockHeld,
    releaseLock() { lockHeld = false; }
  };

  const context = {
    console: { log() {}, warn() {}, error() {} },
    Date: DateClass,
    SpreadsheetApp: {
      getActive: () => spreadsheet,
      openById: () => { throw new Error('No coaching sheet in the simulator'); },
      flush: () => {},
      getUi: () => { throw new Error('No UI in the simulator'); }
    },
    CacheService: { getScriptCache: () => ({ get: key => (cache.has(key) ? cache.get(key) : null), put: (key, value) => { cache.set(key, value); }, remove: key => { cache.delete(key); } }) },
    LockService: { getScriptLock: () => lock, getDocumentLock: () => ({ waitLock() {}, tryLock: () => true, hasLock: () => true, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => propertyStore(properties),
      getDocumentProperties: () => propertyStore(properties)
    },
    Session: { getScriptTimeZone: () => 'America/Los_Angeles', getActiveUser: () => ({ getEmail: () => 'desk@example.test' }) },
    Utilities: {
      getUuid: () => { const r = options.random; return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(r() * 16).toString(16)); },
      formatDate: (date, zone, pattern) => formatDate(date, zone, pattern),
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (algorithm, value) => Array.from(require('node:crypto').createHash(algorithm).update(String(value)).digest()).map(byte => (byte > 127 ? byte - 256 : byte))
    },
    UrlFetchApp: { fetch: url => options.fetch(url) },
    GmailApp: {
      search: () => {
        if (current) current.extraMs += gmail.searchMs;
        return gmail.threads;
      },
      getMessagesForThreads: threads => threads.map(thread => thread.getMessages()),
      getMessageById: id => gmail.threads.flatMap(thread => thread.getMessages()).find(message => message.getId() === id) || null
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: () => ({ timeBased: () => ({ after: () => ({ create() {} }), everyHours: () => ({ create() {} }), everyMinutes: () => ({ create() {} }) }) }),
      deleteTrigger() {},
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/sim/dev' })
    },
    HtmlService: {}
  };
  vm.createContext(context);
  SERVER_FILES.forEach(name => vm.runInContext(fs.readFileSync(path.join(DESK, name), 'utf8'), context, { filename: name }));
  // Every appended AuditLog row is also kept here, so tests can read what the desk reported.
  const append = context.appendAudit_;
  context.appendAudit_ = function (action, type, id, details) {
    audit.push({ at: clock.now(), action, id, details: details || {} });
    return append.apply(this, arguments);
  };

  // Runs one google.script.run call when it reaches Google. Calls that wait for the lock are re-run when it frees
  // up; the server code only writes after taking the lock, so a re-run repeats nothing.
  function execute(name, args, arrived, deliver) {
    const fn = context[name];
    const record = { name, arrived, started: null, finished: null, ok: null, error: null };
    // Server code measures its own lock wait (lockMs) from Date.now(); re-runs start where the call arrived.
    calls.push(record);
    function attempt() {
      current = { arrived, locked: false, extraMs: 0 };
      lockHeld = false;
      let result;
      let error = null;
      try {
        if (typeof fn !== 'function' || /_$/.test(name)) throw new Error('Script function not found: ' + name);
        result = fn.apply(null, JSON.parse(JSON.stringify(args)));
      } catch (thrown) {
        // The server code may wrap the wait in its own try/catch, so the wait is noted on the call, not the error.
        if (current.waitUntil) {
          clock.at(current.waitUntil, attempt);
          return;
        }
        error = thrown;
      }
      const took = cost(name, args, record) + current.extraMs;
      if (current.locked) {
        lockBusyFrom = clock.now() + (current.lockedAfter || 0);
        lockFreeAt = clock.now() + took;
      }
      lockHeld = false;
      record.started = clock.now();
      record.finished = clock.now() + took;
      record.ok = !error;
      record.error = error ? error.message : null;
      if (!error) assertSerializable(name, result);
      clock.at(record.finished, () => deliver(error, result === undefined ? null : JSON.parse(JSON.stringify(result))));
    }
    attempt();
  }

  const server = {
    context, spreadsheet, properties, audit, calls, gmail,
    execute,
    // Runs a server function directly (setup and checks), outside the network and the lock model.
    run: (name, ...args) => {
      current = { arrived: clock.now(), locked: false, extraMs: 0 };
      lockHeld = false;
      try { return context[name].apply(null, args); } finally { lockHeld = false; }
    },
    rows: name => context.rows_(name),
    problems: () => audit.filter(entry => entry.action === 'desk_problem')
  };
  return server;
}

function propertyStore(properties) {
  return {
    getProperty: key => (Object.prototype.hasOwnProperty.call(properties, key) ? properties[key] : null),
    setProperty: (key, value) => { properties[key] = String(value); },
    deleteProperty: key => { delete properties[key]; }
  };
}

// The instant of midnight on a calendar day in Pacific time (standard or daylight, as on that day).
function pacificMidnight(year, month, day) {
  const utc = Date.UTC(year, month - 1, day);
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(utc)).forEach(part => { parts[part.type] = part.value; });
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
  return utc + (utc - shown);
}

function formatDate(date, zone, pattern) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(date.getTime())).forEach(part => { parts[part.type] = part.value; });
  return pattern.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day).replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
}

// google.script.run cannot return Date objects (the page receives null); catch that before it reaches a desk.
function assertSerializable(name, value, trail) {
  if (value instanceof Date || (value && value.constructor && value.constructor.name === 'FakeDate')) throw new Error(name + ' returned a Date at ' + (trail || 'top level') + '; google.script.run would deliver null');
  if (value && typeof value === 'object') Object.keys(value).forEach(key => assertSerializable(name, value[key], (trail || '') + '.' + key));
}

// ---------------------------------------------------------------------------------------------------------------
// A device: its own browser storage (shared by its tabs) and its own connection to Google.
function createDevice(world, name) {
  const store = new Map();
  const tabs = [];
  const net = {
    online: true,
    // Milliseconds each way, and the chance a reply never arrives (the page hears nothing) or fails (an error).
    up: () => world.random.between(80, 400),
    down: () => world.random.between(80, 400),
    loseReply: 0,
    failReply: 0,
    // When set, calls never reach Google but the browser still believes it is online (captive Wi-Fi).
    blackhole: false
  };
  const device = {
    name, store, tabs, net,
    open: (options) => openTab(world, device, options || {}),
    goOffline() {
      net.online = false;
      tabs.forEach(tab => !tab.closed && tab.window.dispatchEvent(new tab.window.Event('offline')));
    },
    goOnline() {
      net.online = true;
      tabs.forEach(tab => !tab.closed && tab.window.dispatchEvent(new tab.window.Event('online')));
    },
    storageKeys: prefix => Array.from(store.keys()).filter(key => !prefix || key.indexOf(prefix) === 0)
  };
  return device;
}

function storageFor(device, tab) {
  return {
    get length() { return device.store.size; },
    key: index => Array.from(device.store.keys())[index] || null,
    getItem: key => (device.store.has(String(key)) ? device.store.get(String(key)) : null),
    setItem: (key, value) => {
      key = String(key);
      const old = device.store.has(key) ? device.store.get(key) : null;
      device.store.set(key, String(value));
      notify(key, old, String(value));
    },
    removeItem: key => {
      key = String(key);
      if (!device.store.has(key)) return;
      const old = device.store.get(key);
      device.store.delete(key);
      notify(key, old, null);
    },
    clear: () => device.store.clear()
  };
  // Other tabs of the same device hear about the change, as browsers do.
  function notify(key, oldValue, newValue) {
    device.tabs.forEach(other => {
      if (other === tab || other.closed) return;
      tab.world.clock.after(0, () => {
        const event = new other.window.StorageEvent('storage', { key, oldValue, newValue });
        other.window.dispatchEvent(event);
      }, other);
    });
  }
}

function pageHtml(date) {
  const read = name => fs.readFileSync(path.join(DESK, name + '.html'), 'utf8');
  return read('Index')
    .replace(/<\?!= include\('(\w+)'\) \?>/g, (match, name) => read(name))
    .replace(/<\?= deskMode \?>/g, 'dev')
    .replace(/<\?= initialDate \?>/g, date || '');
}

function openTab(world, device, options) {
  const clock = world.clock;
  const tab = { world, device, closed: false, errors: [], statuses: [], confirms: [], alerts: [] };
  tab.confirmAnswer = options.confirm || (() => true);
  const dom = new JSDOM(pageHtml(options.date || world.date), {
    url: 'https://n-sim-script.googleusercontent.com/userCodeAppPanel',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      tab.window = window;
      installBrowser(window, tab);
    }
  });
  tab.dom = dom;
  device.tabs.push(tab);
  tab.onError = error => tab.errors.push(error);
  tab.close = () => {
    tab.closed = true;
    dom.window.close();
  };
  Object.assign(tab, tabHelpers(tab));
  return tab;
}

function installBrowser(window, tab) {
  const clock = tab.world.clock;
  const device = tab.device;
  const timers = new Map();
  let timerId = 0;
  window.setTimeout = (fn, ms) => {
    const id = ++timerId;
    timers.set(id, clock.after(Math.max(0, Number(ms) || 0), () => { timers.delete(id); fn(); }, tab));
    return id;
  };
  window.clearTimeout = id => { const event = timers.get(id); if (event) event.cancelled = true; timers.delete(id); };
  window.setInterval = (fn, ms) => {
    const id = ++timerId;
    const every = Math.max(1, Number(ms) || 0);
    const tick = () => { timers.set(id, clock.after(every, tick, tab)); fn(); };
    timers.set(id, clock.after(every, tick, tab));
    return id;
  };
  window.clearInterval = window.clearTimeout;
  window.requestAnimationFrame = fn => window.setTimeout(() => fn(clock.now()), 16);
  window.cancelAnimationFrame = window.clearTimeout;
  window.Date = fakeDateClass(window.Date, clock);
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.CSS = { escape: value => String(value).replace(/["\\]/g, '\\$&') };
  window.Element.prototype.scrollIntoView = function () {};
  window.confirm = message => { tab.confirms.push(message); return tab.confirmAnswer(message); };
  window.alert = message => { tab.alerts.push(message); };
  window.print = () => {};
  Object.defineProperty(window, 'localStorage', { value: storageFor(device, tab), configurable: true });
  Object.defineProperty(window.navigator, 'onLine', { get: () => device.net.online, configurable: true });
  window.fetch = url => new window.Promise((resolve, reject) => {
    clock.after(150, () => {
      const body = tab.world.site(String(url));
      if (body === undefined) reject(new window.TypeError('Failed to fetch'));
      else resolve({ ok: true, status: 200, json: () => window.Promise.resolve(window.JSON.parse(JSON.stringify(body))) });
    }, tab);
  });
  window.google = { script: { run: runner(window, tab, null, null) } };
}

// google.script.run: each call travels to Google, runs there (waiting for the lock if needed), and the reply travels
// back. The device's connection decides what can go wrong on the way.
function runner(window, tab, success, failure) {
  return new Proxy({}, {
    get(target, name) {
      if (name === 'withSuccessHandler') return fn => runner(window, tab, fn, failure);
      if (name === 'withFailureHandler') return fn => runner(window, tab, success, fn);
      if (name === 'withUserObject') return () => runner(window, tab, success, failure);
      return (...args) => send(window, tab, String(name), args, success, failure);
    }
  });
}

function send(window, tab, name, args, success, failure) {
  const world = tab.world;
  const clock = world.clock;
  const net = tab.device.net;
  const log = { tab, name, sentAt: clock.now(), outcome: 'pending' };
  world.traffic.push(log);
  const fail = message => {
    log.outcome = 'failed';
    if (failure && !tab.closed) failure(new window.Error(message));
  };
  if (!net.online) {
    clock.after(50, () => fail('NetworkError: Connection failure due to HTTP 0'), tab);
    return;
  }
  if (net.blackhole) { log.outcome = 'lost-up'; return; }
  const payload = JSON.parse(JSON.stringify(args));
  clock.after(net.up(), () => {
    world.server.execute(name, payload, clock.now(), (error, result) => {
      clock.after(net.down(), () => {
        if (tab.closed) { log.outcome = 'closed'; return; }
        if (!net.online || net.blackhole || world.random.chance(net.loseReply)) { log.outcome = 'lost-down'; return; }
        if (world.random.chance(net.failReply)) return fail('NetworkError: Connection failure due to HTTP 500');
        if (error) return fail(error.message);
        log.outcome = 'ok';
        if (success) success(result === null ? null : window.JSON.parse(JSON.stringify(result)));
      }, tab);
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// What a volunteer does, done through the page's own controls.
function tabHelpers(tab) {
  const doc = () => tab.window.document;
  const $ = selector => doc().querySelector(selector);
  // A person cannot click through a cover (the "open in another tab" notice); such clicks are counted, not made.
  const covered = element => {
    const cover = doc().querySelector('.tab-cover');
    return !!cover && !cover.hidden && !cover.contains(element);
  };
  const click = element => {
    if (!element) throw new Error('Nothing to click');
    if (covered(element)) { tab.blockedClicks = (tab.blockedClicks || 0) + 1; return false; }
    element.dispatchEvent(new tab.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    return true;
  };
  return {
    $,
    status: () => ($('#status') || {}).textContent || '',
    notice: () => { const el = $('#draft-recovery'); return el && !el.hidden ? $('#draft-message').textContent : ''; },
    syncNote: () => { const el = $('#sync-note'); return el && !el.hidden ? el.textContent : ''; },
    desk: () => tab.window.cttcDesk.print(),
    roster: () => [].concat.apply([], tab.window.cttcDesk.print().groups.map(group => group.playerIds)),
    click,
    addPlayer(playerId) {
      const search = $('#search');
      const player = tab.world.players.find(p => p.player_id === playerId);
      search.value = player.display_name;
      search.dispatchEvent(new tab.window.Event('input', { bubbles: true }));
      const button = doc().querySelector('[data-add="' + playerId + '"]');
      if (!button || button.disabled || button.hidden) return false;
      click(button);
      return true;
    },
    removePlayer: playerId => click(doc().querySelector('[data-drop="' + playerId + '"]')),
    movePlayer: (playerId, direction) => click(doc().querySelector('[data-move="' + playerId + '"][data-dir="' + direction + '"]')),
    matchCount: () => tab.window.cttcDesk.print().matches.length,
    // Sets games won for one side of the match at this index, as tapping a ball does.
    setGames(index, side, games) {
      const match = tab.window.cttcDesk.print().matches[index];
      const key = side === 'one' ? 'playerOneGames' : 'playerTwoGames';
      if (match[key] === games) return;
      click(doc().querySelector('[data-score="' + index + '"][data-side="' + side + '"][data-games="' + games + '"]'));
    },
    scoreMatch(index, winnerSide, loserGames) {
      this.setGames(index, winnerSide, 3);
      this.setGames(index, winnerSide === 'one' ? 'two' : 'one', loserGames);
    },
    pay: (playerId, method) => (covered(doc().body) ? false : tab.window.cttcPayments.choose(playerId, method)),
    covered: () => covered(doc().body),
    takeOver: () => click(doc().querySelector('.tab-cover button')),
    finalize: () => click($('#finalize')),
    loadDate(date) {
      $('#date').value = date;
      $('#date').dispatchEvent(new tab.window.Event('change', { bubbles: true }));
    },
    visible() {
      Object.defineProperty(tab.window.document, 'hidden', { value: false, configurable: true });
      tab.window.document.dispatchEvent(new tab.window.Event('visibilitychange'));
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A world: one Google, any number of devices, a synthetic directory, and the club site's public JSON.
function createWorld(options) {
  options = options || {};
  const startAt = Date.parse((options.date || '2026-10-14') + 'T18:45:00-07:00');
  const clock = createClock(startAt);
  const rand = random(options.seed || 1);
  const world = { clock, random: rand, date: options.date || '2026-10-14', traffic: [], devices: [] };
  world.site = options.site || (url => {
    if (/sessions\.json/.test(url)) return [];
    if (/players\.json/.test(url)) return { latestSessionDate: '2026-09-28', players: [] };
    return undefined;
  });
  world.server = createServer(clock, {
    random: rand,
    cost: options.cost,
    fetch: url => {
      const body = world.site(String(url).split('?')[0]);
      return { getResponseCode: () => (body === undefined ? 404 : 200), getContentText: () => JSON.stringify(body) };
    }
  });
  seed(world, options.players || 30);
  world.device = name => { const device = createDevice(world, name || 'device-' + (world.devices.length + 1)); world.devices.push(device); return device; };
  return world;
}

const FIRST = ['Ava', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lu', 'Max', 'Nia', 'Oz', 'Pia', 'Quin', 'Rae', 'Sol', 'Tia', 'Uma', 'Vic', 'Wes', 'Xan', 'Yu', 'Zed'];
function seed(world, count) {
  const spreadsheet = world.server.spreadsheet;
  Object.keys(world.server.context.TABLES).forEach(name => {
    spreadsheet.insertSheet(name).getRange(1, 1, 1, world.server.context.TABLES[name].length).setValues([world.server.context.TABLES[name]]);
  });
  const players = [];
  for (let i = 0; i < count; i += 1) {
    players.push({
      player_id: 'player-sim-' + String(i + 1).padStart(3, '0'),
      display_name: FIRST[i % FIRST.length] + ' Example' + (i >= FIRST.length ? ' ' + Math.floor(i / FIRST.length + 1) : ''),
      current_rating: 2100 - i * 47,
      active: true,
      created_at: '2026-01-01',
      updated_at: '2026-01-01'
    });
  }
  world.server.context.appendObjects_('Players', players);
  world.players = players;
  // The desk has been the rating authority since an earlier finalized session.
  world.server.context.appendObjects_('Sessions', [{ session_id: 'session-2026-10-12', session_date: '2026-10-12', status: 'finalized', revision: 9, created_at: '2026-10-12', updated_at: '2026-10-12', finalized_at: '2026-10-12' }]);
}

// What Google holds for a session, in the same shape the page keeps.
function googleSession(world, date) {
  return world.server.run('getSessionByDate', date);
}

// One text per match and per group, so two copies compare equal whatever order they list things in.
function contentKey(groups, matches) {
  const pair = m => {
    const swap = String(m.playerOneId) > String(m.playerTwoId);
    const one = swap ? m.playerTwoGames : m.playerOneGames;
    const two = swap ? m.playerOneGames : m.playerTwoGames;
    return [swap ? m.playerTwoId : m.playerOneId, swap ? m.playerOneId : m.playerTwoId, one == null ? '' : one, two == null ? '' : two, m.forfeitedBy || '', m.wonBy || ''].join('|');
  };
  return JSON.stringify({
    groups: groups.map(ids => ids.slice().sort().join(',')).sort(),
    matches: matches.map(pair).sort()
  });
}

function pageKey(tab) {
  const desk = tab.desk();
  return contentKey(desk.groups.map(group => group.playerIds), desk.matches);
}

function googleKey(world, date) {
  const session = googleSession(world, date || world.date);
  if (!session) return contentKey([], []);
  return contentKey(session.groups.map(group => group.players.map(entry => entry.playerId)), session.matches);
}

module.exports = { createWorld, contentKey, pageKey, googleKey, googleSession, random };
