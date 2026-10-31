// The Equalizer mockup: a simulated Saturday on the real rules (equalizer.js, which puts together handicap.js,
// bracket.js, round-robin.js, standings.js and rating-engine.js). Everything specific to the mockup (made-up players,
// the simulated rallies and clock) lives in this file only.
(function () {
  "use strict";

  var E = window.CTTCEqualizer;
  var H = window.CTTCHandicap;
  var B = window.CTTCBracket;
  var TABLES = 12;
  var START_MINUTES = 15 * 60 + 30; // 3:30 PM

  // Made-up players. Their ratings follow the spread of recent round robin players (24 evenly spaced points from
  // data/players.json, about 255 to 2100), so the simulation shows how often a random draw meets the 8-point cap.
  var PEOPLE = [
    ["Avery Lin", 2100], ["Bea Torres", 1785], ["Cal Okafor", 1690], ["Dana Wu", 1550], ["Eli Novak", 1440], ["Faye Moreno", 1380],
    ["Gus Patel", 1280], ["Hana Sato", 1195], ["Ivo Rossi", 1145], ["Jo Mensah", 1125], ["Kai Larsen", 1085], ["Lena Brandt", 965],
    ["Milo Reyes", 815], ["Nia Osei", 745], ["Omar Haddad", 670], ["Pia Lund", 625], ["Quinn Achebe", 590], ["Rui Costa", 560],
    ["Sana Iqbal", 515], ["Theo Marsh", 495], ["Uma Varga", 400], ["Vik Rao", 365], ["Wren Doyle", 330], ["Yuki Mori", 255]
  ].map(function (row, index) { return { id: "p" + index, name: row[0], rating: row[1] }; });
  var BY_ID = {};
  PEOPLE.forEach(function (person) { BY_ID[person.id] = person; });

  var FORMATS = [{ id: "double", label: "Double Elimination" }, { id: "groups", label: "RR → Finals" }];
  var PLAYS = [{ id: "singles", label: "Singles" }, { id: "doubles", label: "Doubles" }];
  var MODES = [{ id: "real", label: "Realistic" }, { id: "favorites", label: "Favorites hold" }, { id: "upsets", label: "Upset day" }];
  var config = { format: "double", play: "singles", size: 16, mode: "real", seed: 11 };
  var forced = {};
  var event = null;
  var prior = [];
  var timeline = [];
  var step = 0;
  var tab = "live";
  var autoTimer = null;
  var lastStatus = {};
  var SOURCE_BY_ID = {};

  // ---- Randomness: one stream per match, so entering one result by hand does not reshuffle the others ----
  function rng(seed) {
    var value = seed >>> 0;
    return function () {
      value = (value + 0x6D2B79F5) >>> 0;
      var t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function matchRng(id, salt) { return rng(hash([config.seed, config.mode, config.format, config.play, config.size, id, salt].join(":"))); }

  // ---- Words and small pieces ----
  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  var doubles = function () { return event.play === "doubles"; };
  function members(sideId) { return event.sideById[sideId] ? event.sideById[sideId].members : [sideId]; }
  function name(sideId) { return members(sideId).map(function (id) { return BY_ID[id].name; }).join(" & "); }
  function short(sideId) { return members(sideId).map(function (id) { return BY_ID[id].name.split(" ")[0]; }).join(" & "); }
  function rating(sideId) { return event.sideRatings[sideId]; }
  function ratingText(sideId) { return doubles() ? rating(sideId) + " average" : String(rating(sideId)); }
  function starts(sideId) { return short(sideId) + (doubles() ? " start" : " starts"); }
  function clock(minutes) {
    var total = Math.round(START_MINUTES + minutes);
    var h = Math.floor(total / 60) % 12 || 12;
    var m = total % 60;
    return h + ":" + (m < 10 ? "0" : "") + m;
  }
  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"];
    var v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function placeText(place) { return place ? ordinal(place.place) + (place.to > place.place ? "–" + ordinal(place.to) : "") : ""; }
  function article(n) { return n === 8 || n === 11 || n === 18 ? "an" : "a"; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function balls(count, filled) {
    var out = "";
    for (var i = 0; i < count; i += 1) out += '<span class="ball' + (i < filled ? " on" : "") + '"></span>';
    return '<span class="balls">' + out + "</span>";
  }
  function flip(text) {
    return '<span class="scoreboard">' + String(text).split("").map(function (c) { return c === ":" ? '<span class="eq-colon">:</span>' : '<span class="flip">' + esc(c) + "</span>"; }).join("") + "</span>";
  }
  function hint(text) { return '<p style="font-size:0.85rem;color:var(--muted)">' + text + "</p>"; }
  function roundName(m) {
    if (m.bracket === "G") return "Group " + m.group + " · round " + m.round;
    if (m.bracket === "F") return m.round === 1 ? "Final" : "Final replay";
    if (m.bracket === "L") return m.round === event.bracket.trailRounds ? "Survivor Trail final" : "Survivor Trail · round " + m.round;
    var fromEnd = event.bracket.rounds - m.round;
    if (event.format === "groups") return fromEnd === 0 ? "Final" : fromEnd === 1 ? "Semifinals" : fromEnd === 2 ? "Quarterfinals" : "Finals · round " + m.round;
    return fromEnd === 0 ? "Main Draw final" : fromEnd === 1 ? "Main Draw semifinals" : fromEnd === 2 ? "Main Draw quarterfinals" : "Main Draw · round " + m.round;
  }
  function loserOf(e) { return e.players[0] === e.winnerId ? e.players[1] : e.players[0]; }
  function gap(e) { return Math.abs(rating(e.players[0]) - rating(e.players[1])); }

  // ---- Memory carried in from earlier (made-up) Saturdays: singles only, since doubles teams are new each draw ----
  function makePrior() {
    if (doubles()) return [];
    var random = rng(hash("prior:" + config.seed));
    var field = event.sides.map(function (s) { return s.id; });
    var list = [];
    for (var i = 0; i < 10; i += 1) {
      var a = field[Math.floor(random() * field.length)];
      var b = field[Math.floor(random() * field.length)];
      if (a === b || H.baseHeadStart(rating(a), rating(b)) < 1) continue;
      var lower = rating(a) < rating(b) ? a : b;
      var higher = lower === a ? b : a;
      for (var t = 0; t < 1 + Math.floor(random() * 2); t += 1) {
        list.push({ at: t ? "2026-10-17" : "2026-10-03", playerOneId: a, playerTwoId: b, winnerId: random() < 0.6 ? lower : higher, forfeit: false, ratings: event.sideRatings });
      }
    }
    return list.sort(function (x, y) { return x.at < y.at ? -1 : x.at > y.at ? 1 : 0; });
  }
  function headStart(a, b, history) { return E.headStart(event, a, b, prior.concat(history || [])); }

  // ---- One simulated match, rally by rally, with the head start on the board at 0-0 ----
  function play(entry, hs) {
    var a = entry.players[0];
    var b = entry.players[1];
    // How much better the stronger side is: a doubles team plays about at its average rating.
    var strength = Math.abs(rating(a) - rating(b)) / (doubles() ? 2 : 1);
    var higher = rating(a) >= rating(b) ? a : b;
    var lowerId = higher === a ? b : a;
    var shift = config.mode === "favorites" ? 0.04 : config.mode === "upsets" ? -0.04 : 0;
    // Chance the stronger side wins a rally: about 2 in 3 at 200 apart, 9 in 10 at 700 apart (a guess to tune).
    var p = Math.max(0.35, Math.min(0.97, 1 / (1 + Math.pow(10, -strength / 700)) + (strength ? shift : 0)));
    var random = matchRng(entry.id, "play");
    var need = (entry.bestOf + 1) / 2;
    var games = {};
    games[a] = 0;
    games[b] = 0;
    while (games[a] < need && games[b] < need) {
      var high = 0;
      var low = hs.lowerId ? hs.headStart : 0;
      while (!((high >= 11 || low >= 11) && Math.abs(high - low) >= 2)) {
        if (random() < p) high += 1; else low += 1;
      }
      games[high > low ? higher : lowerId] += 1;
    }
    return { winnerId: games[a] > games[b] ? a : b, games: [games[a], games[b]] };
  }

  // ---- The afternoon: tables filled in call order, each match as long as its games ----
  function simulate() {
    var results = {};
    var running = [];
    var events = [];
    var history = [];
    var free = [];
    for (var t = 1; t <= TABLES; t += 1) free.push(t);
    var now = 0;
    for (var guard = 0; guard < 400; guard += 1) {
      var view = E.resolve(event, results);
      if (view.finished) break;
      var busy = {};
      running.forEach(function (r) { busy[r.id] = r.players; });
      E.callOrder(view, busy).forEach(function (entry) {
        if (!free.length) return;
        if (running.some(function (r) { return r.players.some(function (p) { return entry.players.indexOf(p) >= 0; }); })) return;
        var hs = headStart(entry.players[0], entry.players[1], history);
        var outcome = forced[entry.id] || play(entry, hs);
        var random = matchRng(entry.id, "time");
        var minutes = Math.round((outcome.games[0] + outcome.games[1]) * (4 + random() * 2) + 2 + random() * 2);
        running.push({ id: entry.id, bracket: entry.bracket, group: entry.group, round: entry.round, bestOf: entry.bestOf, players: entry.players.slice(), table: free.shift(), calledAfter: events.length, start: now, end: now + minutes, winnerId: outcome.winnerId, games: outcome.games, hs: hs, byHand: !!forced[entry.id] });
      });
      if (!running.length) break;
      running.sort(function (x, y) { return x.end - y.end || x.table - y.table; });
      var done = running.shift();
      now = done.end;
      results[done.id] = { winnerId: done.winnerId, games: done.games };
      events.push(done);
      free.push(done.table);
      free.sort(function (x, y) { return x - y; });
      history.push(historyEntry(done, events.length));
    }
    return events;
  }
  function historyEntry(e, n) {
    return { at: "event-" + (1000 + n), playerOneId: e.players[0], playerTwoId: e.players[1], winnerId: e.winnerId, forfeit: false, ratings: event.sideRatings };
  }

  function regenerate() {
    var minimum = E.minimumPlayers(config.format, config.play);
    if (config.size < minimum) config.size = Math.ceil(minimum / 4) * 4;
    var random = rng(hash("field:" + config.seed));
    var pool = B.draw(PEOPLE.map(function (p) { return p.id; }), random);
    var field = pool.slice(0, config.size).map(function (id) { return { id: id, rating: BY_ID[id].rating }; });
    // Double Elimination past 16 sides plays its finals best of 3 too, to finish by 6:00.
    var sides = config.play === "doubles" ? Math.floor(config.size / 2) : config.size;
    var options = config.format === "double" && sides > 16 ? { finalsBestOf: 3 } : {};
    event = E.create({ format: config.format, play: config.play, players: field, options: options }, random);
    prior = makePrior();
    SOURCE_BY_ID = {};
    event.bracket.matches.forEach(function (m) { SOURCE_BY_ID[m.id] = m; });
    timeline = simulate();
  }

  // ---- The afternoon at one point: results in, matches on tables ----
  function stateAt(k) {
    var done = timeline.slice(0, k);
    var results = {};
    done.forEach(function (e) { results[e.id] = { winnerId: e.winnerId, games: e.games }; });
    var time = k ? done[k - 1].end : 0;
    // On a table: called once the results before it were in, and not finished yet (two can finish in the same minute).
    var playing = timeline.slice(k).filter(function (e) { return e.calledAfter <= k; });
    var playingById = {};
    playing.forEach(function (e) { playingById[e.id] = e; });
    var doneById = {};
    done.forEach(function (e) { doneById[e.id] = e; });
    return { k: k, time: time, done: done, doneById: doneById, playing: playing, playingById: playingById, view: E.resolve(event, results), history: done.map(function (e, i) { return historyEntry(e, i + 1); }) };
  }
  function hsFor(st, entry) {
    if (st.doneById[entry.id]) return st.doneById[entry.id].hs;
    if (st.playingById[entry.id]) return st.playingById[entry.id].hs;
    if (entry.status === "ready") return headStart(entry.players[0], entry.players[1], st.history);
    return null;
  }
  function counts(st) {
    var c = { main: 0, trail: 0, groups: 0, finals: 0, out: 0, champion: 0 };
    event.sides.forEach(function (s) { c[st.view.status[s.id]] += 1; });
    return c;
  }
  function totalMatches(st) {
    if (event.format === "groups") return event.groups.reduce(function (sum, g) { return sum + g.matches.length; }, 0) + event.groups.length - 1;
    var replay = st.view.byId.GF2 && (st.view.byId.GF2.status === "done" || st.view.byId.GF2.status === "ready");
    return 2 * event.sides.length - 2 + (replay ? 1 : 0);
  }

  // ---- Stats and the one-line story ----
  function renderStats(st) {
    var c = counts(st);
    var planned = E.estimate(event).minutes;
    var assumed = 0;
    var actual = 0;
    st.done.forEach(function (e) { assumed += e.bestOf === 5 ? 22 : 15; actual += e.end - e.start; });
    var onPace = st.done.length ? planned * actual / assumed : planned;
    var finish = st.view.finished ? "Finished " + clock(st.time) : "Planned " + clock(planned) + (st.done.length ? " · on pace for " + clock(onPace) : "");
    var alive = event.format === "groups"
      ? "<strong>" + (c.groups + c.finals) + "</strong><span>" + c.groups + " in the group stage &middot; " + balls(1, 1) + " " + c.finals + " in the Finals</span>"
      : "<strong>" + (c.main + c.trail) + "</strong><span>" + balls(2, 2) + " " + c.main + " unbeaten &middot; " + balls(2, 1) + " " + c.trail + " on the Trail</span>";
    document.getElementById("eq-stats").innerHTML =
      '<div class="tonight-stat">' + flip(clock(st.time)) + "<span>" + (st.view.finished ? "Final result" : "Clock") + "</span></div>" +
      '<div class="tonight-stat"><strong>' + st.done.length + " / " + totalMatches(st) + "</strong><span>matches played</span></div>" +
      '<div class="tonight-stat">' + alive + "</div>" +
      '<div class="tonight-stat"><strong>' + st.playing.length + "</strong><span>tables in use &middot; " + (TABLES - st.playing.length) + " free for open play</span></div>" +
      '<p style="flex-basis:100%;font-size:0.8rem;color:var(--muted)">' + finish + " (6:00 close)</p>";
    document.getElementById("eq-headline").innerHTML = headline(st, c);
  }
  function headline(st, c) {
    var who = doubles() ? "team" : "player";
    if (st.view.finished) {
      var champ = st.view.champion;
      var trailWins = st.done.filter(function (e) { return e.winnerId === champ && e.bracket === "L"; }).length;
      var how = event.format === "groups" ? ", from Group " + groupOf(champ) + " through the Finals." : trailWins ? " after " + plural(trailWins, "win", "wins") + " on the Survivor Trail." : ", unbeaten all afternoon.";
      return "🏆 " + esc(name(champ)) + (doubles() ? " win" : " wins") + " the Equalizer" + how;
    }
    if (!st.k) {
      var text = "The draw is in: " + plural(config.size, "player", "players") + (doubles() ? " paired at random into " + event.sides.length + " teams" : "");
      if (event.format === "groups") return text + ", " + event.groups.length + " groups of " + event.groups.map(function (g) { return g.sides.length; }).join(", ") + ". Each group winner goes through to the Finals" + (event.bracket.byes ? "; the best " + event.bracket.byes + " get byes." : ".");
      var byes = event.bracket.size - event.sides.length;
      return text + (byes ? ", " + plural(byes, "bye", "byes") : "") + ", " + st.playing.length + " matches called to tables.";
    }
    if (event.format === "groups") {
      var decided = st.view.tables.filter(function (t) { return t.complete; }).length;
      if (decided < event.groups.length) return "Group stage: " + decided + " of " + event.groups.length + " groups decided, " + c.finals + " " + who + (c.finals === 1 ? "" : "s") + " through to the Finals.";
      return "The Finals: " + c.finals + " " + who + (c.finals === 1 ? "" : "s") + " left of " + event.groups.length + " group winners.";
    }
    var final = st.view.byId.GF;
    if (st.playingById.GF2 || st.view.byId.GF2 && st.view.byId.GF2.status === "ready") return "Replay! " + esc(name(st.view.byId.GF2.players[1])) + " won the Final, so both have one loss: one more match, best of 3, decides it.";
    if (final.status === "ready" || st.playingById.GF) return "The Final: " + esc(name(final.players[0])) + " (unbeaten) against " + esc(name(final.players[1])) + " from the Survivor Trail.";
    return c.main + " still unbeaten, " + c.trail + " surviving on the Trail, " + c.out + " done for the day.";
  }
  function groupOf(sideId) {
    var g = event.groups.filter(function (group) { return group.sides.indexOf(sideId) >= 0; })[0];
    return g ? g.number : null;
  }

  // ---- Live: tables, up next, and the story so far ----
  function hsLine(hs) {
    if (!hs || !hs.lowerId || !hs.headStart) return "Even match: no head start";
    return esc(starts(hs.lowerId)) + " every game at " + hs.headStart + "–0" + (hs.reduction ? " (" + hs.base + " less " + hs.reduction + " from earlier wins)" : "");
  }
  function scoreFlip(hs, players) {
    var a = hs && hs.lowerId === players[0] ? hs.headStart : 0;
    var b = hs && hs.lowerId === players[1] ? hs.headStart : 0;
    return flip(String(a) + String(b));
  }
  function story(e, st) {
    var winner = e.winnerId;
    var loser = loserOf(e);
    var w = e.games[e.players.indexOf(winner)];
    var l = e.games[e.players.indexOf(loser)];
    var hs = e.hs;
    var beat = " beat ";
    var text;
    if (hs.lowerId === winner && hs.base >= 1) text = '<span class="eq-tag">UPSET</span> ' + esc(name(winner)) + " (" + ratingText(winner) + ")" + beat + esc(name(loser)) + " (" + ratingText(loser) + ") " + w + "–" + l + (hs.headStart ? " with " + article(hs.headStart) + " " + hs.headStart + "-point head start." : ", with no head start left.");
    else if (hs.lowerId === loser && hs.headStart) text = esc(name(winner)) + " overcame " + article(hs.headStart) + " " + hs.headStart + "-point head start to beat " + esc(name(loser)) + " " + w + "–" + l + ".";
    else text = esc(name(winner)) + beat + esc(name(loser)) + " " + w + "–" + l + ".";
    if (e.bracket === "G") {
      var table = st.view.tables[e.group - 1];
      var justDecided = table.complete && st.done[st.done.length - 1] && st.done.filter(function (d) { return d.group === e.group; }).slice(-1)[0] === e;
      text = text.replace(/\.$/, " in Group " + e.group + ".");
      if (justDecided) text += " <strong>" + esc(short(table.winnerId)) + (doubles() ? " win" : " wins") + " Group " + e.group + "</strong> and " + (doubles() ? "go" : "goes") + " through to the Finals.";
      return text;
    }
    var finalId = event.format === "groups" ? event.bracket.mainFinal : null;
    if (e.id === "GF2" || e.id === finalId || (e.id === "GF" && winner === e.players[0])) text += " <strong>" + esc(short(winner)) + (doubles() ? " win" : " wins") + " the Equalizer!</strong>";
    else if (e.id === "GF") text += " " + esc(short(winner)) + (doubles() ? " force" : " forces") + " a replay.";
    else if (e.bracket === "W" && event.format === "double") text += " " + esc(short(loser)) + (doubles() ? " drop" : " drops") + " to the Survivor Trail.";
    else {
      var place = st.view.places[loser];
      text += " " + esc(short(loser)) + (doubles() ? " are" : " is") + " out" + (place ? " (" + placeText(place) + ")" : "") + ".";
    }
    return text;
  }
  function sideLine(sideId) {
    return '<span class="eq-name">' + esc(doubles() ? short(sideId) : name(sideId)) + '<span class="eq-rating">' + rating(sideId) + "</span></span>";
  }
  function renderLive(st) {
    var tiles = st.playing.slice().sort(function (x, y) { return x.table - y.table; }).map(function (e) {
      return '<div class="eq-tile" data-open="' + e.id + '" role="button" tabindex="0" aria-label="Enter the result for table ' + e.table + '">' +
        '<div class="eq-tile-head"><span><span class="live-dot"></span>Table ' + e.table + "</span><span>" + roundName(e) + "</span></div>" +
        '<div class="eq-tile-body">' + sideLine(e.players[0]) + scoreFlip(e.hs, e.players) + sideLine(e.players[1]) + "</div>" +
        '<div class="eq-tile-foot">' + hsLine(e.hs) + " &middot; best of " + e.bestOf + " &middot; " + Math.max(1, Math.round(st.time - e.start)) + " min</div></div>";
    }).join("");
    var waiting = st.view.matches.filter(function (m) { return m.status === "ready" && !st.playingById[m.id]; });
    var next = waiting.slice(0, 10).map(function (m) {
      var busy = st.playing.filter(function (e) { return e.players.some(function (p) { return m.players.indexOf(p) >= 0; }); })[0];
      var why = busy ? "waiting for table " + busy.table + " to finish" : "waiting for a free table";
      return '<li data-open="' + m.id + '" style="cursor:pointer"><span class="eq-when">' + roundName(m) + "</span>" + esc(name(m.players[0])) + " vs " + esc(name(m.players[1])) + " &middot; " + hsLine(hsFor(st, m)) + ' <span style="color:var(--muted)">(' + why + ")</span></li>";
    }).join("");
    var feed = st.done.slice(-8).reverse().map(function (e) {
      return '<li><span class="eq-when">' + clock(e.end) + "</span>" + story(e, st) + (e.byHand ? ' <span class="eq-rating">(entered by hand)</span>' : "") + "</li>";
    }).join("");
    document.getElementById("tab-live").innerHTML =
      "<h2>On the tables</h2>" + (tiles ? '<div class="eq-tables">' + tiles + "</div>" : "<p>No matches on the tables.</p>") +
      (next ? "<h2>Up next</h2><ul class=\"eq-list\">" + next + "</ul>" : "") +
      "<h2>How it's going</h2>" + (feed ? '<ul class="eq-list">' + feed + "</ul>" : "<p>No results yet.</p>");
  }

  // ---- Bracket: groups and their tables (RR -> Finals), then the classic tree ----
  function sourceText(source) {
    if (source.seed) {
      if (source.seed > event.bracket.entrants.length) return "Bye";
      if (event.format !== "groups") return "";
      return source.seed <= event.bracket.byes ? (source.seed === 1 ? "Best group winner" : ordinal(source.seed) + "-best group winner") : "A group winner (drawn)";
    }
    var from = source.winner || source.loser;
    var m = SOURCE_BY_ID[from];
    var label = m.bracket === "L" ? "Trail R" + m.round : m.bracket === "F" ? "Final" : event.format === "groups" ? roundName(m) : "Main Draw R" + m.round;
    return (source.winner ? "Winner, " : "Drops in: loser, ") + label;
  }
  function card(entry, st) {
    var match = SOURCE_BY_ID[entry.id];
    var live = st.playingById[entry.id];
    var done = st.doneById[entry.id];
    var status = live ? "playing" : entry.status;
    var hs = hsFor(st, entry);
    var need = (entry.bestOf + 1) / 2;
    var rows = entry.players.map(function (id, side) {
      if (!id) return '<div class="eq-row"><span class="eq-pending">' + (match ? sourceText(match.sources[side]) : "") + "</span></div>";
      if (id === B.BYE) return '<div class="eq-row"><span class="eq-pending">bye</span></div>';
      var cls = done ? (done.winnerId === id ? " won" : " lost") : "";
      var chip = hs && hs.lowerId === id && hs.headStart ? '<span class="eq-chip" title="Starts every game at ' + hs.headStart + '">+' + hs.headStart + "</span>" : "";
      var games = done ? balls(need, done.games[side]) : entry.status === "bye" ? "" : balls(need, 0);
      return '<div class="eq-row' + cls + '"><span class="eq-name" title="' + esc(name(id)) + '">' + esc(doubles() ? short(id) : name(id)) + '<span class="eq-rating">' + rating(id) + "</span></span>" + chip + games + "</div>";
    }).join("");
    var upset = done && hs && hs.lowerId === done.winnerId && hs.base >= 1 ? ' <span class="eq-tag">UPSET</span>' : "";
    var meta = live ? '<span><span class="live-dot" style="display:inline-block;background:#1f6b3a"></span> Table ' + live.table + "</span>" : done ? "<span>" + clock(done.end) + upset + "</span>" : entry.status === "bye" ? "<span>bye</span>" : "<span>best of " + entry.bestOf + "</span>";
    var openable = live || entry.status === "ready";
    return '<div class="eq-match ' + status + '" data-match="' + entry.id + '"' + (openable ? ' data-open="' + entry.id + '" role="button" tabindex="0"' : "") + '><div class="eq-match-head"><span>' + entry.id + "</span>" + meta + "</div>" + rows + "</div>";
  }
  function columns(entries, st, hideByeColumns) {
    var byRound = {};
    entries.forEach(function (m) { (byRound[m.round] = byRound[m.round] || []).push(m); });
    return Object.keys(byRound).map(Number).sort(function (a, b) { return a - b; }).map(function (round) {
      var list = byRound[round].sort(function (a, b) { return a.index - b.index; });
      // Trail rounds that are all byes (a field just past a power of two) are left out.
      if (hideByeColumns && list.every(function (m) { return m.status === "bye"; })) return "";
      return '<div class="eq-col"><h3>' + roundName(list[0]) + "</h3>" + list.map(function (m) { return card(m, st); }).join("") + "</div>";
    }).join("");
  }
  function groupBlock(table, st) {
    var group = event.groups[table.number - 1];
    var rows = table.order.map(function (id) {
      var row = table.rows.filter(function (r) { return r.id === id; })[0];
      var leader = table.complete && table.winnerId === id;
      return "<tr" + (leader ? ' class="group-winner-row"' : "") + "><td>" + (leader ? '<span class="group-winner-trophy">🏆</span> ' : "") + esc(doubles() ? short(id) : name(id)) + '<span class="eq-rating">' + rating(id) + "</span></td><td>" + row.wins + "-" + row.losses + "</td><td>" + row.gamesWon + "-" + row.gamesLost + "</td></tr>";
    }).join("");
    var note = table.note ? '<p class="group-tiebreak-note" style="font-size:0.75rem;color:var(--muted)">' + esc(namesIn(table.note)) + "</p>" : "";
    var matches = st.view.matches.filter(function (m) { return m.bracket === "G" && m.group === table.number; });
    return '<div class="eq-group"><h3>Group ' + table.number + ' <span class="eq-rating">' + table.played + " / " + table.total + "</span></h3>" +
      '<table class="session-group-table" style="width:100%"><thead><tr><th>' + (doubles() ? "Team" : "Player") + "</th><th>W-L</th><th>Games</th></tr></thead><tbody>" + rows + "</tbody></table>" + note +
      '<div class="eq-group-matches">' + matches.map(function (m) { return card(m, st); }).join("") + "</div></div>";
  }
  // The club's tie-break note names sides by id; put names in.
  function namesIn(text) {
    return event.sides.reduce(function (out, side) { return out.split(side.id).join(short(side.id)); }, text);
  }
  function renderBracket(st) {
    var html;
    if (event.format === "groups") {
      var knockout = st.view.matches.filter(function (m) { return m.bracket === "W"; });
      html = "<h2>Groups</h2>" + hint("Round robin groups of " + E.GROUP_SIZE + " (3 when the numbers need it), ranked by the club's round robin rules. Each group winner goes through to the Finals.") +
        '<div class="eq-groups">' + st.view.tables.map(function (t) { return groupBlock(t, st); }).join("") + "</div>" +
        "<h2>Finals</h2>" + hint(balls(1, 1) + " Single elimination for the " + event.groups.length + " group winners, once every group is decided." + (event.bracket.byes ? " The best " + plural(event.bracket.byes, "group winner gets a bye", "group winners get byes") + " (best share of games won in their group, then fewer games lost, then the lower rating); the rest are placed at random." : " Places are drawn at random.") + " Lose once and you're out.") +
        '<div class="eq-bracket" data-connect="W">' + columns(knockout, st, false) + "</div>";
    } else {
      var main = st.view.matches.filter(function (m) { return m.bracket === "W"; });
      var trail = st.view.matches.filter(function (m) { return m.bracket === "L"; });
      var finals = st.view.matches.filter(function (m) { return m.bracket === "F" && m.status !== "skipped"; });
      html = "<h2>Main Draw</h2>" + hint(balls(2, 2) + " Two lives. Win and move right; a first loss drops you to the Survivor Trail.") +
        '<div class="eq-bracket" data-connect="W">' + columns(main, st, false) + "</div>" +
        "<h2>Survivor Trail</h2>" + hint(balls(2, 1) + " One life left. Losers from the Main Draw drop in each round; a second loss ends the day.") +
        '<div class="eq-bracket" data-connect="L">' + columns(trail, st, true) + "</div>" +
        "<h2>Final</h2>" + hint("The Main Draw winner against the Survivor Trail winner. If the Trail winner wins, both have one loss and a replay (best of 3) decides it.") +
        '<div class="eq-bracket" data-connect="F"><div class="eq-col">' + finals.map(function (m) { return "<h3>" + roundName(m) + "</h3>" + card(m, st); }).join("") + "</div></div>";
    }
    document.getElementById("tab-bracket").innerHTML = html;
    connect();
  }
  function connect() {
    document.querySelectorAll("[data-connect]").forEach(function (box) {
      var old = box.querySelector("svg");
      if (old) old.remove();
      var frame = box.getBoundingClientRect();
      var paths = "";
      box.querySelectorAll(".eq-match").forEach(function (target) {
        var match = SOURCE_BY_ID[target.dataset.match];
        if (!match) return;
        match.sources.forEach(function (source, side) {
          if (!source.winner) return;
          var from = box.querySelector('[data-match="' + source.winner + '"]');
          if (!from) return;
          var a = from.getBoundingClientRect();
          var b = target.getBoundingClientRect();
          var rows = target.querySelectorAll(".eq-row");
          var row = rows[side] ? rows[side].getBoundingClientRect() : b;
          var x1 = a.right - frame.left + box.scrollLeft;
          var y1 = a.top + a.height / 2 - frame.top;
          var x2 = b.left - frame.left + box.scrollLeft;
          var y2 = row.top + row.height / 2 - frame.top;
          var mid = x1 + (x2 - x1) / 2;
          var won = from.classList.contains("done");
          paths += '<path d="M' + x1 + " " + y1 + "H" + mid + "V" + y2 + "H" + x2 + '" fill="none" stroke="' + (won ? "#8B1A1A" : "#ddd8d0") + '" stroke-width="' + (won ? 2 : 1.5) + '"/>';
        });
      });
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", box.scrollWidth);
      svg.setAttribute("height", box.scrollHeight);
      svg.setAttribute("aria-hidden", "true");
      svg.innerHTML = paths;
      box.insertBefore(svg, box.firstChild);
    });
  }

  // ---- The Field: every player or team at a glance, by how they stand ----
  function renderField(st) {
    var columnsFor = event.format === "groups"
      ? [{ key: "groups", title: "Group stage", balls: [1, 1] }, { key: "finals", title: "In the Finals", balls: [1, 1] }, { key: "out", title: "Done for the day", balls: [1, 0] }]
      : [{ key: "main", title: "Unbeaten", balls: [2, 2] }, { key: "trail", title: "Survivor Trail", balls: [2, 1] }, { key: "out", title: "Done for the day", balls: [2, 0] }];
    var lists = { groups: [], finals: [], main: [], trail: [], out: [] };
    event.sides.forEach(function (side) {
      var s = st.view.status[side.id];
      lists[s === "champion" ? "out" : s].push(side.id);
    });
    lists.out.sort(function (a, b) { return (st.view.places[a] || { place: 0 }).place - (st.view.places[b] || { place: 0 }).place; });
    ["groups", "finals", "main", "trail"].forEach(function (k) { lists[k].sort(function (a, b) { return rating(b) - rating(a); }); });
    function row(id) {
      var live = st.playing.filter(function (e) { return e.players.indexOf(id) >= 0; })[0];
      var place = st.view.places[id];
      var s = st.view.status[id];
      var fresh = lastStatus[id] !== undefined && lastStatus[id] !== s ? " fresh" : "";
      var lives = event.format === "groups" ? balls(1, s === "out" ? 0 : 1) : balls(2, s === "main" ? 2 : s === "trail" || s === "champion" ? 1 : 0);
      var where = live ? '<span class="eq-place"><span class="live-dot" style="display:inline-block;background:#1f6b3a"></span> T' + live.table + "</span>"
        : s === "champion" ? '<span class="eq-place">1st</span>' : place ? '<span class="eq-place">' + placeText(place) + "</span>"
        : event.format === "groups" && s === "groups" ? '<span class="eq-place">Group ' + groupOf(id) + "</span>" : "";
      return '<li class="' + fresh + '">' + lives + '<span class="eq-name" title="' + esc(name(id)) + '">' + (s === "champion" ? "🏆 " : "") + esc(name(id)) + '<span class="eq-rating">' + rating(id) + "</span></span>" + where + "</li>";
    }
    document.getElementById("tab-field").innerHTML =
      "<h2>The Field</h2>" + hint("Every " + (doubles() ? "team" : "player") + ", by how they stand. Watch names move right as the afternoon goes on.") +
      '<div class="eq-field">' + columnsFor.map(function (col) {
        return "<div><h3>" + balls(col.balls[0], col.balls[1]) + " " + (col.key === "out" && st.view.finished ? "Final places" : col.title) + " (" + lists[col.key].length + ")</h3><ul>" + lists[col.key].map(row).join("") + "</ul></div>";
      }).join("") + "</div>";
    lastStatus = Object.assign({}, st.view.status);
  }

  // ---- Results: the champion, the podium, the awards, and everyone's afternoon ----
  function renderResults(st) {
    var players = E.playerResults(event, st.view);
    var html = "";
    if (st.view.finished) {
      var champ = st.view.champion;
      var path = st.done.filter(function (e) { return e.players.indexOf(champ) >= 0; });
      var wins = path.filter(function (e) { return e.winnerId === champ; }).length;
      var trailWins = path.filter(function (e) { return e.winnerId === champ && e.bracket === "L"; }).length;
      var ratingsLine = members(champ).map(function (id) { return (doubles() ? esc(BY_ID[id].name.split(" ")[0]) + " " : "") + BY_ID[id].rating + " &rarr; " + players[id].after; }).join(" &middot; ");
      html += '<div class="eq-champion"><span class="ball on">🏆</span><div><span class="tonight-eyebrow">Equalizer champion' + (doubles() ? "s" : "") + " &middot; " + clock(st.time) + "</span><strong>" + esc(name(champ)) + "</strong>" +
        ratingsLine + " &middot; " + wins + "–" + (path.length - wins) +
        (event.format === "groups" ? " &middot; won Group " + groupOf(champ) : trailWins ? " &middot; " + plural(trailWins, "win", "wins") + " on the Survivor Trail" : " &middot; unbeaten") + "</div></div>";
      var podium = [1, 2, 3].map(function (place) {
        var ids = Object.keys(st.view.places).filter(function (p) { return st.view.places[p].place === place; });
        if (!ids.length) return "";
        return '<div class="tonight-stat"><strong>' + ordinal(place) + (st.view.places[ids[0]].to > place ? "=" : "") + "</strong><span>" + ids.map(function (id) { return esc(name(id)) + " (" + ratingText(id) + ")"; }).join("<br>") + "</span></div>";
      }).join("");
      html += '<div class="eq-podium">' + podium + "</div>";
      var upsets = st.done.filter(function (e) { return e.hs.lowerId === e.winnerId && e.hs.base >= 1; }).sort(function (a, b) { return gap(b) - gap(a); });
      var defenses = st.done.filter(function (e) { return e.hs.lowerId && e.hs.lowerId !== e.winnerId && e.hs.headStart; }).sort(function (a, b) { return b.hs.headStart - a.hs.headStart || gap(b) - gap(a); });
      var trailCounts = {};
      st.done.forEach(function (e) { if (e.bracket === "L") trailCounts[e.winnerId] = (trailCounts[e.winnerId] || 0) + 1; });
      var trailer = Object.keys(trailCounts).sort(function (a, b) { return trailCounts[b] - trailCounts[a]; })[0];
      html += "<h2>Awards</h2><div class=\"eq-awards\">" +
        (upsets[0] ? '<div class="eq-step"><span class="eq-tag">UPSET</span><strong>Biggest upset</strong>' + esc(name(upsets[0].winnerId)) + " (" + ratingText(upsets[0].winnerId) + ") beat " + esc(name(loserOf(upsets[0]))) + " (" + ratingText(loserOf(upsets[0])) + "), " + gap(upsets[0]) + " points apart.</div>" : "") +
        (defenses[0] ? '<div class="eq-step">' + flip(String(defenses[0].hs.headStart) + "0") + "<strong>Toughest defense</strong>" + esc(name(defenses[0].winnerId)) + " gave " + esc(short(loserOf(defenses[0]))) + " " + defenses[0].hs.headStart + " points a game and still won.</div>" : "") +
        (trailer ? '<div class="eq-step">' + balls(2, 1) + "<strong>Longest trail</strong>" + esc(name(trailer)) + " won " + plural(trailCounts[trailer], "match", "matches") + " on the Survivor Trail.</div>" : "") +
        "</div>";
      html += "<h2>" + esc(short(champ)) + "'s path</h2><ul class=\"eq-list\">" + path.map(function (e) {
        var other = e.players[0] === champ ? e.players[1] : e.players[0];
        var side = e.players.indexOf(champ);
        return '<li><span class="eq-when">' + roundName(e) + "</span>" + (e.winnerId === champ ? '<span class="match-win">W</span>' : '<span class="match-loss">L</span>') + " " + e.games[side] + "–" + e.games[1 - side] + " vs " + esc(name(other)) + " (" + ratingText(other) + ") &middot; " + hsLine(e.hs) + "</li>";
      }).join("") + "</ul>";
    } else {
      html += '<p class="notice" style="margin-bottom:16px">Results so far. The champion, podium and awards appear when the Final is done; places fill in as ' + (doubles() ? "teams" : "players") + " go out.</p>";
    }
    var standing = function (id) {
      var s = st.view.status[players[id].sideId];
      return s === "champion" ? "1st" : players[id].place ? placeText(players[id].place) : s === "main" ? "unbeaten" : s === "trail" ? "on the Trail" : s === "finals" ? "in the Finals" : "Group " + groupOf(players[id].sideId);
    };
    var order = Object.keys(players).sort(function (a, b) {
      var pa = players[a].place || (st.view.champion === players[a].sideId ? { place: 1 } : null);
      var pb = players[b].place || (st.view.champion === players[b].sideId ? { place: 1 } : null);
      if (pa && pb) return pa.place - pb.place || BY_ID[b].rating - BY_ID[a].rating;
      if (pa || pb) return pa ? 1 : -1;
      return BY_ID[b].rating - BY_ID[a].rating;
    });
    html += "<h2>" + (st.view.finished ? "Everyone's afternoon" : "Standings so far") + "</h2>" +
      '<div style="overflow-x:auto"><table class="session-group-table" style="width:100%"><thead><tr><th>Player</th>' + (doubles() ? "<th>Partner</th>" : "") + "<th>Place</th><th>Equalizer W-L</th><th>Rating</th></tr></thead><tbody>" +
      order.map(function (id) {
        var p = players[id];
        var partner = members(p.sideId).filter(function (m) { return m !== id; })[0];
        return "<tr" + (st.view.champion === p.sideId ? ' class="group-winner-row"' : "") + "><td>" + esc(BY_ID[id].name) + "</td>" + (doubles() ? "<td>" + esc(BY_ID[partner].name) + "</td>" : "") + "<td>" + standing(id) + "</td><td>" + p.wins + "-" + p.losses + "</td><td>" + p.after + (p.change ? ' <span class="' + (p.change > 0 ? "match-win" : "match-loss") + '">(' + (p.change > 0 ? "+" : "") + p.change + ")</span>" : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      (event.sitOut.length ? hint(esc(event.sitOut.map(function (id) { return BY_ID[id].name; }).join(", ")) + " sat out (odd number for doubles).") : "") +
      hint("Equalizer wins and losses are kept apart from round robin club and year records. Ratings change by " + H.exchange(false) + " a match either way" + (doubles() ? ", for both partners," : "") + " from the same rating table round robins use at equal ratings.");
    document.getElementById("tab-results").innerHTML = html;
  }

  // ---- Head starts: the table, a calculator, and how the memory moves ----
  var demo = { history: [], resets: [] };
  var calcMode = "singles";
  function renderHeadStarts(st) {
    var steps = [];
    var startsRow = [];
    for (var n = 0; n <= 8; n += 1) {
      steps.push("<td>" + (n === 8 ? "320+" : (n * 40) + "–" + (n * 40 + 39)) + "</td>");
      startsRow.push("<td><strong>" + n + "</strong></td>");
    }
    var memoryPairs = {};
    prior.forEach(function (m) { memoryPairs[H.pairKey(m.playerOneId, m.playerTwoId)] = [m.playerOneId, m.playerTwoId]; });
    var memory = Object.keys(memoryPairs).map(function (key) {
      var pair = memoryPairs[key];
      var now = headStart(pair[0], pair[1], st.history);
      var played = prior.concat(st.history).filter(function (m) { return H.pairKey(m.playerOneId, m.playerTwoId) === key; });
      return "<li>" + esc(name(pair[0])) + " &amp; " + esc(name(pair[1])) + ": " + played.map(function (m) { return esc(short(m.winnerId)) + (m.at.indexOf("event") === 0 ? " (today)" : " (" + m.at.slice(5) + ")"); }).join(", ") + " &rarr; " + (now.headStart ? esc(starts(now.lowerId)) + " at " + now.headStart + " (base " + now.base + ")" : "no head start") + "</li>";
    }).join("");
    var calcInputs = calcMode === "doubles"
      ? '<label>Your team <input type="number" id="eq-r1" value="1590" min="0" max="4000"> &amp; <input type="number" id="eq-r1b" value="600" min="0" max="4000"></label><label>Opponents <input type="number" id="eq-r2" value="1800" min="0" max="4000"> &amp; <input type="number" id="eq-r2b" value="1000" min="0" max="4000"></label>'
      : '<label>Your rating <input type="number" id="eq-r1" value="1590" min="0" max="4000"></label><label>Opponent <input type="number" id="eq-r2" value="1800" min="0" max="4000"></label>';
    document.getElementById("tab-head-starts").innerHTML =
      "<h2>Head starts</h2><p>Every full 40 rating points between two players gives the lower-rated player 1 point at the start of <em>every</em> game, up to 8. A 39-point gap is no head start; 40 is one. With 8, the lower-rated player still needs 3 points to win a game, and games are still to 11, win by 2.</p>" +
      "<p>In <strong>doubles</strong>, partners are drawn at random and a team's rating is the average of its players' ratings, rounded to a whole point; the same table applies to the gap between the two averages. Both partners gain or give the full 8. With an odd number, the organizer chooses: someone sits out, someone fills in, or one team of three rotates game by game (whoever sat out comes in for whoever has been on longest).</p>" +
      '<div style="overflow-x:auto"><table class="session-group-table"><tbody><tr><th>Rating gap</th>' + steps.join("") + "</tr><tr><th>Starts every game at</th>" + startsRow.join("") + "</tr></tbody></table></div>" +
      '<h3>Find a head start</h3><div class="eq-sim-row" id="eq-calc-mode"></div><div class="eq-calc">' + calcInputs + '<span id="eq-calc-out"></span></div>' +
      "<h3>The memory</h3><p>When the same two players (or the same two teams) meet again, the head start remembers. A win by the lower-rated side takes a point off its next head start against that side; a win by the higher-rated side gives one back, never more than the rating gap allows. It carries over from one Saturday to the next until the club resets it. Doubles partners are drawn fresh each time, so in doubles it mostly matters for a rematch the same afternoon.</p>" +
      '<div class="eq-calc"><span>1590 vs 1800 (base 5):</span><button class="small-button" type="button" data-demo="lower">Lower-rated wins</button><button class="small-button" type="button" data-demo="higher">Higher-rated wins</button><button class="small-button" type="button" data-demo="reset">Owner reset</button><div class="eq-memory" id="eq-demo" style="flex-basis:100%"></div></div>' +
      (memory ? "<h3>Memory in this simulated field</h3><ul class=\"eq-list\">" + memory + "</ul>" : "");
    chips("eq-calc-mode", PLAYS, calcMode, function (mode) { calcMode = mode; renderHeadStarts(stateAt(step)); });
    calc();
    renderDemo();
  }
  function value(id) { var el = document.getElementById(id); return el ? Number(el.value) : 0; }
  function calc() {
    var r1 = calcMode === "doubles" ? Math.round((value("eq-r1") + value("eq-r1b")) / 2) : value("eq-r1");
    var r2 = calcMode === "doubles" ? Math.round((value("eq-r2") + value("eq-r2b")) / 2) : value("eq-r2");
    var base = H.baseHeadStart(r1, r2);
    var out = document.getElementById("eq-calc-out");
    if (base === null) { out.textContent = ""; return; }
    var you = r1 < r2 ? base : 0;
    var them = r2 < r1 ? base : 0;
    var totals = calcMode === "doubles" ? " (" + r1 + " vs " + r2 + " average, " : " (";
    out.innerHTML = flip(String(you) + String(them)) + " " + (base ? (you ? "You start" : "They start") + " every game at " + base + "–0" + totals + Math.abs(r1 - r2) + " points apart)." : "No head start: less than 40 points apart.");
  }
  function renderDemo() {
    var ratings = { hi: 1800, lo: 1590 };
    var line = ["<span>Start: " + H.pairState("hi", "lo", ratings, [], []).headStart + "</span>"];
    demo.history.forEach(function (m, i) {
      var after = H.pairState("hi", "lo", ratings, demo.history.slice(0, i + 1), demo.resets).headStart;
      line.push("<span>" + (m.winnerId === "lo" ? "Lower wins" : "Higher wins") + " &rarr; " + after + "</span>");
    });
    if (demo.resets.length) line.push("<span>Reset after match " + demo.resets[demo.resets.length - 1].count + "</span>");
    document.getElementById("eq-demo").innerHTML = line.join("");
  }

  // ---- Entering a result by hand, with the desk's balls ----
  var scoring = null;
  function openScore(id) {
    var st = stateAt(step);
    var entry = st.view.byId[id];
    if (!entry || !(entry.status === "ready" || st.playingById[id])) return;
    scoring = { id: id, players: entry.players, need: (entry.bestOf + 1) / 2, games: [null, null] };
    document.getElementById("eq-score-title").textContent = entry.id + " · " + roundName(entry);
    document.getElementById("eq-score-note").textContent = hsLine(hsFor(st, entry)) + " · best of " + entry.bestOf + ". Games won:";
    document.getElementById("eq-score-error").textContent = "";
    drawScore();
    var dialog = document.getElementById("eq-score");
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
  }
  function drawScore() {
    document.getElementById("eq-score-rows").innerHTML = scoring.players.map(function (id, side) {
      var buttons = "";
      for (var n = 0; n <= scoring.need; n += 1) {
        var on = scoring.games[side] !== null && (n === 0 ? scoring.games[side] === 0 : scoring.games[side] >= n);
        buttons += '<button type="button" class="ball' + (n === 0 ? " zero" : "") + (on ? " on" : "") + '" data-side="' + side + '" data-games="' + n + '" aria-pressed="' + on + '" aria-label="' + esc(name(id)) + " won " + n + '">' + n + "</button>";
      }
      return '<div class="eq-score-row">' + sideLine(id) + '<span class="balls">' + buttons + "</span></div>";
    }).join("");
  }
  function closeScore() {
    var dialog = document.getElementById("eq-score");
    if (dialog.close) dialog.close(); else dialog.removeAttribute("open");
  }
  function saveScore(e) {
    e.preventDefault();
    var g = scoring.games;
    var valid = g[0] !== null && g[1] !== null && ((g[0] === scoring.need && g[1] < scoring.need) || (g[1] === scoring.need && g[0] < scoring.need));
    if (!valid) {
      document.getElementById("eq-score-error").textContent = "One side needs " + scoring.need + " games and the other fewer.";
      return;
    }
    forced[scoring.id] = { winnerId: scoring.players[g[0] > g[1] ? 0 : 1], games: g.slice() };
    timeline = simulate();
    step = timeline.map(function (x) { return x.id; }).indexOf(scoring.id) + 1;
    closeScore();
    render();
  }

  // ---- Controls and tabs ----
  function chips(containerId, options, current, onPick) {
    var box = document.getElementById(containerId);
    box.querySelectorAll("button").forEach(function (b) { b.remove(); });
    options.forEach(function (option) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "archive-filter-btn" + (option.id === current ? " active" : "");
      button.textContent = option.label;
      if (option.disabled) { button.disabled = true; button.title = option.title; button.style.opacity = "0.45"; }
      button.addEventListener("click", function () { onPick(option.id); });
      box.appendChild(button);
    });
  }
  function restart() { stopAuto(); forced = {}; lastStatus = {}; regenerate(); step = 0; render(); }
  function renderControls() {
    chips("eq-format", FORMATS, config.format, function (f) { config.format = f; restart(); });
    chips("eq-play", PLAYS, config.play, function (p) { config.play = p; restart(); });
    var minimum = E.minimumPlayers(config.format, config.play);
    chips("eq-size", [8, 12, 16, 20, 24].map(function (n) { return { id: n, label: String(n), disabled: n < minimum, title: "This format needs at least " + minimum + " players" }; }), config.size, function (n) { config.size = n; restart(); });
    chips("eq-mode", MODES, config.mode, function (mode) { config.mode = mode; restart(); });
    var slider = document.getElementById("eq-slider");
    slider.max = timeline.length;
    slider.value = step;
    document.getElementById("eq-step-count").textContent = "result " + step + " of " + timeline.length;
    document.getElementById("eq-auto").innerHTML = autoTimer ? "&#10074;&#10074; Pause" : "&#9654; Auto-play";
  }
  function showTab(next) {
    tab = ["live", "bracket", "field", "results", "head-starts"].indexOf(next) >= 0 ? next : "live";
    document.querySelectorAll("#eq-tabs .leaderboard-tab").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === tab);
      b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false");
    });
    document.querySelectorAll("[data-panel]").forEach(function (panel) { panel.hidden = panel.dataset.panel !== tab; });
    if (tab === "bracket") connect();
  }
  function render() {
    var st = stateAt(step);
    renderControls();
    renderStats(st);
    renderLive(st);
    renderBracket(st);
    renderField(st);
    renderResults(st);
    renderHeadStarts(st);
    showTab(tab);
  }
  function go(k) {
    step = Math.max(0, Math.min(timeline.length, k));
    render();
  }
  function stopAuto() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
  }

  document.getElementById("eq-first").addEventListener("click", function () { stopAuto(); go(0); });
  document.getElementById("eq-back").addEventListener("click", function () { stopAuto(); go(step - 1); });
  document.getElementById("eq-next").addEventListener("click", function () { stopAuto(); go(step + 1); });
  document.getElementById("eq-end").addEventListener("click", function () { stopAuto(); go(timeline.length); });
  document.getElementById("eq-redraw").addEventListener("click", function () { config.seed += 1; restart(); });
  document.getElementById("eq-auto").addEventListener("click", function () {
    if (autoTimer) { stopAuto(); renderControls(); return; }
    if (step >= timeline.length) step = 0;
    autoTimer = setInterval(function () {
      if (step >= timeline.length) { stopAuto(); renderControls(); return; }
      go(step + 1);
    }, 900);
    renderControls();
  });
  document.getElementById("eq-slider").addEventListener("input", function (e) { stopAuto(); go(Number(e.target.value)); });
  document.getElementById("eq-tabs").addEventListener("click", function (e) {
    var button = e.target.closest(".leaderboard-tab");
    if (!button) return;
    showTab(button.dataset.tab);
    try { history.replaceState(null, "", "#" + tab); } catch (error) { location.hash = tab; }
  });
  window.addEventListener("hashchange", function () { showTab(location.hash.slice(1)); });
  document.querySelector("main").addEventListener("click", function (e) {
    var demoButton = e.target.closest("[data-demo]");
    if (demoButton) {
      var kind = demoButton.dataset.demo;
      if (kind === "reset") demo.resets.push({ at: "m" + (100 + demo.history.length), pair: "all", count: demo.history.length });
      else demo.history.push({ at: "m" + (101 + demo.history.length), playerOneId: "hi", playerTwoId: "lo", winnerId: kind === "lower" ? "lo" : "hi", forfeit: false, ratings: { hi: 1800, lo: 1590 } });
      renderDemo();
      return;
    }
    var open = e.target.closest("[data-open]");
    if (open) { stopAuto(); openScore(open.dataset.open); }
  });
  document.querySelector("main").addEventListener("keydown", function (e) {
    var open = e.target.closest && e.target.closest("[data-open]");
    if (open && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openScore(open.dataset.open); }
  });
  document.querySelector("main").addEventListener("input", function (e) {
    if (/^eq-r[12]b?$/.test(e.target.id)) calc();
  });
  document.getElementById("eq-score-rows").addEventListener("click", function (e) {
    var ball = e.target.closest("button.ball");
    if (!ball) return;
    var side = Number(ball.dataset.side);
    scoring.games[side] = Number(ball.dataset.games);
    // Like the desk: choosing the winner's games fills in the loser's as 0 until changed.
    if (scoring.games[side] === scoring.need && scoring.games[1 - side] === null) scoring.games[1 - side] = 0;
    drawScore();
  });
  document.getElementById("eq-score-cancel").addEventListener("click", closeScore);
  document.getElementById("eq-score-form").addEventListener("submit", saveScore);
  window.addEventListener("resize", function () { if (tab === "bracket") connect(); });

  regenerate();
  tab = location.hash.slice(1) || "live";
  render();
}());
