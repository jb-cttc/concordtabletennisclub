// The meeting itself, as plain data, and every change that can be made to it. One copy of these rules serves both sides:
// the server applies each change under the script lock (Code.js, saveChanges), and the pages apply the same change at
// once, so a click shows before Google has answered. The pages get this exact function's source (doGet passes
// MeetingModel_.toString() into the page), so it must stay self-contained: no other function, no Google service, no
// clock or random of its own (the caller passes now and makes the ids).
//
// A meeting: { id, version, title, date (YYYY-MM-DD), createdAt, updatedAt, startedAt, current, currentSince,
//   attendees: [{ id, name, role, present }],   present: checked in today (others are expected, from the last meeting)
//   display: { layout, scale, people, follow },   what the projector board shows (set on the controller)
//   items: [{ id, title, details, notes, status: 'open' | 'done' | 'tabled', added, carried }],
//   actions: [{ id, text, owner, due, itemId, done, carried }] }
// details are the item's sub-points, one per line (shown under it on the board); notes are the discussion notes and
// decisions, for the minutes only. added marks an item added once the meeting was under way; carried one brought
// forward from the meeting before. current is the item being discussed now.
function MeetingModel_() {
  var LIMITS = { title: 140, details: 1500, notes: 4000, action: 300, owner: 80, name: 80, role: 60, items: 60, actions: 120, attendees: 60, point: 300, points: 40, by: 40, activity: 25 };
  var STATUSES = { open: 1, done: 1, tabled: 1 };
  var ID = /^[a-z0-9]{4,24}$/;
  // The board: full agenda, focus (titles only, discussed items folded up), spotlight (the item being discussed, big),
  // or recap (the follow-ups by owner); text size; the attendee panel open, folded to a tab, or hidden; follow-ups shown.
  var LAYOUTS = { full: 1, focus: 1, spotlight: 1, recap: 1 };
  var PEOPLE = { open: 1, tab: 1, hidden: 1 };
  var SCALE_MIN = 0.7;
  var SCALE_MAX = 1.6;
  function defaultDisplay() { return { layout: 'full', scale: 1, people: 'tab', follow: true }; }

  function text(value, max) {
    return String(value === undefined || value === null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
  }
  function line(value, max) { return text(value, max).replace(/\s*\n\s*/g, ' '); }
  function day(value) { var v = String(value || ''); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; }
  function find(list, id) { for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return i; return -1; }
  function okId(id) { return typeof id === 'string' && ID.test(id); }

  function blank(fields, now) {
    fields = fields || {};
    return {
      id: okId(fields.id) ? fields.id : '',
      version: 0,
      title: line(fields.title, LIMITS.title) || 'CTTC Executive Committee Meeting',
      date: day(fields.date),
      createdAt: now || 0,
      updatedAt: now || 0,
      startedAt: 0,
      current: '',
      currentSince: 0,
      attendees: [],
      display: defaultDisplay(),
      items: [],
      actions: []
    };
  }

  function item(raw, meeting, now) {
    return {
      id: raw.id,
      title: line(raw.title, LIMITS.title),
      details: text(raw.details, LIMITS.details),
      notes: text(raw.notes, LIMITS.notes),
      status: STATUSES[raw.status] ? raw.status : 'open',
      added: raw.added === undefined ? !!(meeting && meeting.startedAt) : !!raw.added,
      carried: !!raw.carried,
      points: [],
      by: line(raw.by, LIMITS.by)
    };
  }
  function action(raw) {
    return {
      id: raw.id,
      text: line(raw.text, LIMITS.action),
      owner: line(raw.owner, LIMITS.owner),
      due: day(raw.due),
      itemId: okId(raw.itemId) ? raw.itemId : '',
      done: !!raw.done,
      carried: raw.carried ? line(raw.carried, 20) : '',
      by: line(raw.by, LIMITS.by)
    };
  }

  // The meeting is under way from the first item discussed or checked off; items added after that are marked Added.
  function start(meeting, now) { if (!meeting.startedAt) meeting.startedAt = now || 1; }
  function nextOpen(meeting, afterId) {
    var at = find(meeting.items, afterId);
    for (var i = at + 1; i < meeting.items.length; i += 1) if (meeting.items[i].status === 'open') return meeting.items[i].id;
    for (var j = 0; j < at; j += 1) if (meeting.items[j].status === 'open') return meeting.items[j].id;
    return '';
  }
  function setCurrent(meeting, id, now) {
    if (meeting.current === id) return;
    meeting.current = id;
    meeting.currentSince = id ? now : 0;
  }

  // Applies one change in place. A change to an item or follow-up that is no longer there (another screen removed it)
  // does nothing; a change that is not understood throws, so the page hears about it.
  // Who did what, for the other controllers' markers: the last few changes made with a name (change.by).
  function describe(meeting, change) {
    var at;
    switch (change.type) {
      case 'addItems': var first = (change.items || [])[0]; return first ? { what: 'added', kind: 'item', id: first.id, title: first.title } : null;
      case 'editItem': at = find(meeting.items, change.id); return at < 0 ? null : { what: change.notes !== undefined && change.title === undefined ? 'took notes on' : 'edited', kind: 'item', id: change.id, title: meeting.items[at].title };
      case 'status': at = find(meeting.items, change.id); return at < 0 ? null : { what: change.status === 'done' ? 'checked off' : change.status === 'tabled' ? 'moved to next meeting' : 'reopened', kind: 'item', id: change.id, title: meeting.items[at].title };
      case 'moveItem': at = find(meeting.items, change.id); return at < 0 ? null : { what: 'moved', kind: 'item', id: change.id, title: meeting.items[at].title };
      case 'removeItem': at = find(meeting.items, change.id); return at < 0 ? null : { what: 'removed', kind: 'item', id: change.id, title: meeting.items[at].title };
      case 'addAction': return change.action ? { what: 'added a follow-up', kind: 'action', id: change.action.id, title: change.action.text } : null;
      case 'editAction': at = find(meeting.actions, change.id); return at < 0 ? null : { what: change.done === true ? 'completed' : 'edited', kind: 'action', id: change.id, title: meeting.actions[at].text };
      case 'removeAction': at = find(meeting.actions, change.id); return at < 0 ? null : { what: 'removed a follow-up', kind: 'action', id: change.id, title: meeting.actions[at].text };
      case 'addPoint': return change.point ? { what: 'added a point', kind: 'point', id: change.point.id, title: change.point.text, itemId: change.itemId } : null;
      case 'removePoint': return { what: 'removed a point', kind: 'point', id: change.id, title: '', itemId: change.itemId };
      case 'topic': at = find(meeting.items, change.id); return at < 0 ? { what: 'ended the deep dive', kind: 'topic', id: '', title: '' } : { what: 'started a deep dive on', kind: 'topic', id: change.id, title: meeting.items[at].title };
      default: return null;
    }
  }

  function apply(meeting, change, now) {
    if (!change || typeof change !== 'object') throw new Error('Not a change.');
    var by = line(change.by, LIMITS.by);
    var said = by ? describe(meeting, change) : null;
    applyOne(meeting, change, now, by);
    if (said) {
      said.at = now;
      // A running number, so a screen can tell what it has not seen yet even when two changes share a millisecond.
      meeting.activityCount = (meeting.activityCount || 0) + 1;
      said.n = meeting.activityCount;
      said.by = by;
      said.title = line(said.title, 80);
      meeting.activity = (meeting.activity || []).concat([said]).slice(-LIMITS.activity);
    }
    return meeting;
  }

  function applyOne(meeting, change, now, by) {
    var i;
    switch (change.type) {
      case 'meeting':
        if (change.title !== undefined) meeting.title = line(change.title, LIMITS.title) || meeting.title;
        if (change.date !== undefined && day(change.date)) meeting.date = day(change.date);
        return meeting;
      case 'addItems':
        (Array.isArray(change.items) ? change.items : []).forEach(function (raw, n) {
          if (!raw || !okId(raw.id) || find(meeting.items, raw.id) >= 0) return;
          if (meeting.items.length >= LIMITS.items) throw new Error('An agenda holds at most ' + LIMITS.items + ' items.');
          var made = item(raw, meeting, now);
          if (!made.title) return;
          if (!made.by) made.by = by || '';
          var at = typeof change.at === 'number' && change.at >= 0 && change.at <= meeting.items.length ? change.at + n : meeting.items.length;
          meeting.items.splice(at, 0, made);
        });
        return meeting;
      case 'editItem':
        i = find(meeting.items, change.id);
        if (i < 0) return meeting;
        if (change.title !== undefined && line(change.title, LIMITS.title)) meeting.items[i].title = line(change.title, LIMITS.title);
        if (change.details !== undefined) meeting.items[i].details = text(change.details, LIMITS.details);
        if (change.notes !== undefined) meeting.items[i].notes = text(change.notes, LIMITS.notes);
        return meeting;
      case 'status':
        i = find(meeting.items, change.id);
        if (i < 0 || !STATUSES[change.status]) return meeting;
        meeting.items[i].status = change.status;
        if (change.status === 'done') start(meeting, now);
        if (change.status !== 'open' && meeting.topic === change.id) meeting.topic = '';
        // Checking off (or tabling) the item being discussed moves Now to the next open item.
        if (change.status !== 'open' && meeting.current === change.id) setCurrent(meeting, nextOpen(meeting, change.id), now);
        return meeting;
      case 'current':
        if (!change.id) { setCurrent(meeting, '', now); return meeting; }
        i = find(meeting.items, change.id);
        if (i < 0) return meeting;
        if (meeting.items[i].status !== 'open') meeting.items[i].status = 'open';
        start(meeting, now);
        setCurrent(meeting, change.id, now);
        return meeting;
      case 'moveItem':
        i = find(meeting.items, change.id);
        if (i < 0 || typeof change.to !== 'number') return meeting;
        var moved = meeting.items.splice(i, 1)[0];
        meeting.items.splice(Math.max(0, Math.min(meeting.items.length, Math.round(change.to))), 0, moved);
        return meeting;
      case 'removeItem':
        i = find(meeting.items, change.id);
        if (i < 0) return meeting;
        meeting.items.splice(i, 1);
        if (meeting.current === change.id) setCurrent(meeting, '', now);
        if (meeting.topic === change.id) meeting.topic = '';
        meeting.actions.forEach(function (a) { if (a.itemId === change.id) a.itemId = ''; });
        return meeting;
      case 'addAction':
        if (!change.action || !okId(change.action.id) || find(meeting.actions, change.action.id) >= 0) return meeting;
        if (meeting.actions.length >= LIMITS.actions) throw new Error('A meeting holds at most ' + LIMITS.actions + ' follow-ups.');
        var made = action(change.action);
        if (!made.text) return meeting;
        if (!made.by) made.by = by || '';
        if (made.itemId && find(meeting.items, made.itemId) < 0) made.itemId = '';
        meeting.actions.push(made);
        return meeting;
      case 'editAction':
        i = find(meeting.actions, change.id);
        if (i < 0) return meeting;
        var a = meeting.actions[i];
        if (change.text !== undefined && line(change.text, LIMITS.action)) a.text = line(change.text, LIMITS.action);
        if (change.owner !== undefined) a.owner = line(change.owner, LIMITS.owner);
        if (change.due !== undefined) a.due = day(change.due);
        if (change.itemId !== undefined) a.itemId = okId(change.itemId) && find(meeting.items, change.itemId) >= 0 ? change.itemId : '';
        if (change.done !== undefined) a.done = !!change.done;
        return meeting;
      case 'removeAction':
        i = find(meeting.actions, change.id);
        if (i >= 0) meeting.actions.splice(i, 1);
        return meeting;
      case 'attendees':
        var seen = {};
        meeting.attendees = (Array.isArray(change.list) ? change.list : []).map(function (raw) {
          return raw && okId(raw.id) ? { id: raw.id, name: line(raw.name, LIMITS.name), role: line(raw.role, LIMITS.role), present: raw.present === undefined ? true : !!raw.present } : null;
        }).filter(function (person) {
          if (!person || !person.name || seen[person.id]) return false;
          seen[person.id] = true;
          return true;
        }).slice(0, LIMITS.attendees);
        return meeting;
      case 'checkIn':
        // Checks a person in (or out). The same name twice is one person: checking in again updates them.
        var person = change.person || {};
        var name = line(person.name, LIMITS.name);
        i = find(meeting.attendees, person.id);
        if (i < 0 && name) {
          for (var k = 0; k < meeting.attendees.length; k += 1) if (meeting.attendees[k].name.toLowerCase() === name.toLowerCase()) i = k;
        }
        var present = change.present === undefined ? true : !!change.present;
        if (i >= 0) {
          meeting.attendees[i].present = present;
          if (person.role !== undefined) meeting.attendees[i].role = line(person.role, LIMITS.role);
          return meeting;
        }
        if (!name || !okId(person.id)) return meeting;
        if (meeting.attendees.length >= LIMITS.attendees) throw new Error('A meeting holds at most ' + LIMITS.attendees + ' attendees.');
        meeting.attendees.push({ id: person.id, name: name, role: line(person.role, LIMITS.role), present: present });
        return meeting;
      case 'removeAttendee':
        i = find(meeting.attendees, change.id);
        if (i >= 0) meeting.attendees.splice(i, 1);
        return meeting;
      case 'topic':
        // A deep dive: the meeting pivots to one item. The board fills with it and the points the controllers add.
        if (!change.id) { meeting.topic = ''; return meeting; }
        i = find(meeting.items, change.id);
        if (i < 0) return meeting;
        if (meeting.items[i].status !== 'open') meeting.items[i].status = 'open';
        start(meeting, now);
        setCurrent(meeting, change.id, now);
        meeting.topic = change.id;
        return meeting;
      case 'addPoint':
        i = find(meeting.items, change.itemId);
        if (i < 0 || !change.point || !okId(change.point.id)) return meeting;
        var points = meeting.items[i].points || (meeting.items[i].points = []);
        if (find(points, change.point.id) >= 0) return meeting;
        if (points.length >= LIMITS.points) throw new Error('A topic holds at most ' + LIMITS.points + ' points.');
        var said = line(change.point.text, LIMITS.point);
        if (said) points.push({ id: change.point.id, text: said, by: by || '', at: now });
        return meeting;
      case 'removePoint':
        i = find(meeting.items, change.itemId);
        if (i < 0) return meeting;
        var list = meeting.items[i].points || [];
        var at = find(list, change.id);
        if (at >= 0) list.splice(at, 1);
        return meeting;
      case 'display':
        var d = meeting.display || (meeting.display = defaultDisplay());
        if (LAYOUTS[change.layout]) d.layout = change.layout;
        if (typeof change.scale === 'number' && isFinite(change.scale)) d.scale = Math.round(Math.max(SCALE_MIN, Math.min(SCALE_MAX, change.scale)) * 100) / 100;
        if (PEOPLE[change.people]) d.people = change.people;
        if (change.follow !== undefined) d.follow = !!change.follow;
        return meeting;
      default:
        throw new Error('Unknown change: ' + String(change.type).slice(0, 30));
    }
  }

  // Pasted agenda text, as items to review before adding: [{ title, details }]. A line that starts with a bullet or
  // number, or is not indented, starts an item; an indented line, or one under a sub-bullet (○ ◦ ▪ – or "o "), is a
  // sub-point of the item above it. "Agenda:" and blank lines are skipped.
  function parseAgenda(raw) {
    var items = [];
    String(raw || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (rawLine) {
      if (!rawLine.trim()) return;
      var indent = /^[ \t ]*/.exec(rawLine)[0].replace(/\t/g, '    ').length;
      var body = rawLine.trim();
      var sub = /^([○◦▪▫–\-]|o)\s+/.test(body);
      var top = /^([•●*■]|\d{1,2}[.)]|[a-z][.)])\s+/i.test(body);
      body = body.replace(/^([•●*■○◦▪▫–\-]|o|\d{1,2}[.)]|[a-z][.)])\s+/i, '').trim();
      if (!body || /^agenda\s*:?$/i.test(body)) return;
      if (items.length && (sub || (indent >= 2 && !top))) {
        var last = items[items.length - 1];
        last.details = (last.details ? last.details + '\n' : '') + line(body, LIMITS.title);
      } else {
        items.push({ title: line(body.replace(/:$/, ''), LIMITS.title), details: '' });
      }
    });
    return items.slice(0, LIMITS.items);
  }

  // "Name (Role)" per line, or separated by commas, into attendees (ids made by the caller's makeId).
  function parseAttendees(raw, makeId) {
    var people = [];
    String(raw || '').split(/\n|,(?![^(]*\))/).forEach(function (part) {
      var match = /^\s*(?:[•●*\-]\s*)?(?:guests?\s*:\s*)?([^()]+?)\s*(?:\(([^)]*)\))?\s*$/i.exec(part);
      if (!match || !match[1].trim()) return;
      var guest = /^\s*(?:[•●*\-]\s*)?guests?\s*:/i.test(part);
      people.push({ id: makeId(), name: line(match[1], LIMITS.name), role: line(match[2] || (guest ? 'Guest' : ''), LIMITS.role) });
    });
    return people.slice(0, LIMITS.attendees);
  }

  // What a new meeting brings forward from the one before: its follow-ups not yet done, and items marked Next meeting.
  function carryOver(previous, makeId) {
    if (!previous) return { items: [], actions: [], attendees: [] };
    var from = previous.date || '';
    return {
      items: previous.items.filter(function (it) { return it.status === 'tabled'; }).map(function (it) {
        return { id: makeId(), title: it.title, details: it.details, notes: '', status: 'open', added: false, carried: true };
      }),
      actions: previous.actions.filter(function (a) { return !a.done; }).map(function (a) {
        return { id: makeId(), text: a.text, owner: a.owner, due: a.due, itemId: '', done: false, carried: a.carried || from || 'earlier' };
      }),
      // Expected, not yet checked in.
      attendees: previous.attendees.filter(function (p) { return p.present !== false && !/guest/i.test(p.role); }).map(function (p) {
        return { id: makeId(), name: p.name, role: p.role, present: false };
      })
    };
  }

  function counts(meeting) {
    var c = { items: meeting.items.length, done: 0, tabled: 0, open: 0, actions: meeting.actions.length, actionsDone: 0, present: 0 };
    meeting.items.forEach(function (it) { c[it.status] += 1; });
    (meeting.attendees || []).forEach(function (p) { if (p.present !== false) c.present += 1; });
    meeting.actions.forEach(function (a) { if (a.done) c.actionsDone += 1; });
    return c;
  }

  function longDate(value) {
    if (!day(value)) return '';
    var parts = value.split('-');
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var weekday = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))).getUTCDay();
    return days[weekday] + ', ' + months[Number(parts[1]) - 1] + ' ' + Number(parts[2]) + ', ' + parts[0];
  }

  // Plain-text minutes, ready to paste into a document or an email.
  function minutes(meeting) {
    var out = [meeting.title, 'Date: ' + (longDate(meeting.date) || meeting.date || '')];
    var here = meeting.attendees.filter(function (p) { return p.present !== false; });
    if (here.length) {
      out.push('', 'Attendees (' + here.length + '):');
      here.forEach(function (p) { out.push('  - ' + p.name + (p.role ? ' (' + p.role + ')' : '')); });
    }
    out.push('', 'Agenda:');
    meeting.items.forEach(function (it, n) {
      var mark = it.status === 'done' ? '[x]' : it.status === 'tabled' ? '[>]' : '[ ]';
      out.push((n + 1) + '. ' + mark + ' ' + it.title + (it.status === 'tabled' ? ' (next meeting)' : '') + (it.added ? ' (added)' : ''));
      if (it.details) it.details.split('\n').forEach(function (d) { out.push('     - ' + d); });
      (it.points || []).forEach(function (pt) { out.push('     * ' + pt.text + (pt.by ? ' (' + pt.by + ')' : '')); });
      if (it.notes) {
        out.push('     Notes:');
        it.notes.split('\n').forEach(function (d) { out.push('       ' + d); });
      }
    });
    out.push('', 'Follow-ups:');
    if (!meeting.actions.length) out.push('  (none)');
    meeting.actions.forEach(function (a) {
      var about = '';
      var at = find(meeting.items, a.itemId);
      if (at >= 0) about = ' [item ' + (at + 1) + ']';
      out.push('  ' + (a.done ? '[x] ' : '[ ] ') + (a.owner || 'Unassigned') + ': ' + a.text + (a.due ? ' (due ' + a.due + ')' : '') + about + (a.carried ? ' (from ' + a.carried + ')' : ''));
    });
    out.push('', '[x] discussed or done   [>] moved to the next meeting');
    return out.join('\n');
  }

  return { LIMITS: LIMITS, SCALE_MIN: SCALE_MIN, SCALE_MAX: SCALE_MAX, display: function (m) { var d = defaultDisplay(); var own = (m && m.display) || {}; Object.keys(d).forEach(function (k) { if (own[k] !== undefined) d[k] = own[k]; }); return d; }, blank: blank, apply: apply, parseAgenda: parseAgenda, parseAttendees: parseAttendees, carryOver: carryOver, counts: counts, longDate: longDate, minutes: minutes, okId: okId };
}
