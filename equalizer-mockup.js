// The Equalizer mockup: a simulated Saturday on the real rules (handicap.js, bracket.js, rating-engine.js).
// Everything specific to the mockup (made-up players, the simulated rallies and clock) lives in this file only.
(function () {
  "use strict";

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
  var RATINGS = {};
  PEOPLE.forEach(function (person) { BY_ID[person.id] = person; RATINGS[person.id] = person.rating; });

  var MODES = [
    { id: "real", label: "Realistic" },
    { id: "favorites", label: "Favorites hold" },
    { id: "upsets", label: "Upset day" }
  ];
  var config = { size: 16, mode: "real", seed: 11 };
  var forced = {};
  var structure = null;
  var prior = [];
  var timeline = [];
  var step = 0;
  var tab = "live";
  var autoTimer = null;
  var lastLives = {};

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
  function matchRng(id, salt) { return rng(hash(config.seed + ":" + config.mode + ":" + id + ":" + salt)); }

  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function name(id) { return BY_ID[id] ? BY_ID[id].name : id; }
  function first(id) { return name(id).split(" ")[0]; }
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
  function balls(count, filled, cls) {
    var out = "";
    for (var i = 0; i < count; i += 1) out += '<span class="ball' + (i < filled ? " " + (cls || "on") : "") + '"></span>';
    return '<span class="balls">' + out + "</span>";
  }
  function flip(text) {
    return '<span class="scoreboard">' + String(text).split("").map(function (c) { return c === ":" ? '<span class="eq-colon">:</span>' : '<span class="flip">' + esc(c) + "</span>"; }).join("") + "</span>";
  }
  function roundName(bracket, round) {
    if (bracket === "F") return round === 1 ? "Final" : "Final replay";
    if (bracket === "L") return round === structure.trailRounds ? "Survivor Trail final" : "Survivor Trail · round " + round;
    var fromEnd = structure.rounds - round;
    return fromEnd === 0 ? "Main Draw final" : fromEnd === 1 ? "Main Draw semifinals" : fromEnd === 2 ? "Main Draw quarterfinals" : "Main Draw · round " + round;
  }

  // ---- Memory carried in from earlier (made-up) Saturdays ----
  function makePrior(field) {
    var random = rng(hash("prior:" + config.seed));
    var list = [];
    for (var i = 0; i < 10; i += 1) {
      var a = field[Math.floor(random() * field.length)];
      var b = field[Math.floor(random() * field.length)];
      if (a === b || H.baseHeadStart(RATINGS[a], RATINGS[b]) < 1) continue;
      var lower = RATINGS[a] < RATINGS[b] ? a : b;
      var higher = lower === a ? b : a;
      var times = 1 + Math.floor(random() * 2);
      for (var t = 0; t < times; t += 1) {
        list.push({ at: t ? "2026-10-17" : "2026-10-03", playerOneId: a, playerTwoId: b, winnerId: random() < 0.6 ? lower : higher, forfeit: false, ratings: RATINGS });
      }
    }
    return list.sort(function (x, y) { return x.at < y.at ? -1 : x.at > y.at ? 1 : 0; });
  }

  function headStart(a, b, history) { return H.pairState(a, b, RATINGS, prior.concat(history || [])); }

  // ---- One simulated match, rally by rally, with the head start on the board at 0-0 ----
  function play(entry, hs) {
    var a = entry.players[0];
    var b = entry.players[1];
    var gap = Math.abs(RATINGS[a] - RATINGS[b]);
    var higher = RATINGS[a] >= RATINGS[b] ? a : b;
    // Chance the higher-rated player wins a rally: about 2 in 3 at 200 apart, 9 in 10 at 700 apart (a guess to tune).
    var shift = config.mode === "favorites" ? 0.04 : config.mode === "upsets" ? -0.04 : 0;
    var p = Math.max(0.35, Math.min(0.97, 1 / (1 + Math.pow(10, -gap / 700)) + (gap ? shift : 0)));
    var random = matchRng(entry.id, "play");
    var need = (entry.bestOf + 1) / 2;
    var games = {};
    games[a] = 0;
    games[b] = 0;
    while (games[a] < need && games[b] < need) {
      var high = 0;
      var low = hs.headStart;
      while (!((high >= 11 || low >= 11) && Math.abs(high - low) >= 2)) {
        if (random() < p) high += 1; else low += 1;
      }
      var lowerId = higher === a ? b : a;
      games[high > low ? higher : lowerId] += 1;
    }
    var winnerId = games[a] > games[b] ? a : b;
    return { winnerId: winnerId, games: [games[a], games[b]] };
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
      var view = B.resolve(structure, results);
      if (view.finished) break;
      var busy = {};
      running.forEach(function (r) { busy[r.id] = r.players; });
      B.callOrder(view, busy).forEach(function (entry) {
        if (!free.length) return;
        if (running.some(function (r) { return r.players.some(function (p) { return entry.players.indexOf(p) >= 0; }); })) return;
        var hs = headStart(entry.players[0], entry.players[1], history);
        var outcome = forced[entry.id] || play(entry, hs);
        var random = matchRng(entry.id, "time");
        var gamesPlayed = outcome.games[0] + outcome.games[1];
        var minutes = Math.round(gamesPlayed * (4 + random() * 2) + 2 + random() * 2);
        running.push({ id: entry.id, bracket: entry.bracket, round: entry.round, bestOf: entry.bestOf, players: entry.players.slice(), table: free.shift(), calledAfter: events.length, start: now, end: now + minutes, winnerId: outcome.winnerId, games: outcome.games, hs: hs, byHand: !!forced[entry.id] });
      });
      if (!running.length) break;
      running.sort(function (x, y) { return x.end - y.end || x.table - y.table; });
      var done = running.shift();
      now = done.end;
      results[done.id] = { winnerId: done.winnerId, games: done.games };
      events.push(done);
      free.push(done.table);
      free.sort(function (x, y) { return x - y; });
      history.push({ at: "event-" + (1000 + events.length), playerOneId: done.players[0], playerTwoId: done.players[1], winnerId: done.winnerId, forfeit: false, ratings: RATINGS });
    }
    return events;
  }

  function regenerate() {
    var random = rng(hash("field:" + config.seed));
    var pool = B.draw(PEOPLE.map(function (p) { return p.id; }), random);
    var field = pool.slice(0, config.size);
    prior = makePrior(field);
    structure = B.build(B.draw(field, random), { bestOf: 3, finalsBestOf: config.size > 16 ? 3 : 5, replay: true, replayBestOf: 3 });
    timeline = simulate();
  }

  // ---- The afternoon at one point: results in, matches on tables, everyone's lives ----
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
    var history = done.map(function (e, i) { return { at: "event-" + (1001 + i), playerOneId: e.players[0], playerTwoId: e.players[1], winnerId: e.winnerId, forfeit: false, ratings: RATINGS }; });
    return { k: k, time: time, done: done, doneById: doneById, playing: playing, playingById: playingById, view: B.resolve(structure, results), history: history };
  }

  function hsFor(st, entry) {
    if (st.doneById[entry.id]) return st.doneById[entry.id].hs;
    if (st.playingById[entry.id]) return st.playingById[entry.id].hs;
    if (entry.status === "ready") return headStart(entry.players[0], entry.players[1], st.history);
    return null;
  }

  // ---- Stats and the one-line story ----
  function counts(st) {
    var unbeaten = 0;
    var trail = 0;
    var out = 0;
    structure.entrants.forEach(function (id) {
      var lives = st.view.lives[id];
      if (lives === 2) unbeaten += 1; else if (lives === 1) trail += 1; else out += 1;
    });
    return { unbeaten: unbeaten, trail: trail, out: out };
  }

  function renderStats(st) {
    var c = counts(st);
    var total = 2 * structure.entrants.length - 2 + (st.view.byId.GF2 && (st.view.byId.GF2.status === "done" || st.view.byId.GF2.status === "ready" || st.playingById.GF2) ? 1 : 0);
    var planned = B.estimate(structure).minutes;
    var assumed = 0;
    var actual = 0;
    st.done.forEach(function (e) { assumed += e.bestOf === 5 ? 22 : 15; actual += e.end - e.start; });
    var onPace = st.done.length ? planned * actual / assumed : planned;
    var finish = st.view.finished ? "Finished " + clock(st.time) : "Planned " + clock(planned) + (st.done.length ? " · on pace for " + clock(onPace) : "");
    document.getElementById("eq-stats").innerHTML =
      '<div class="tonight-stat">' + flip(clock(st.time)) + "<span>" + (st.view.finished ? "Final result" : "Clock") + "</span></div>" +
      '<div class="tonight-stat"><strong>' + st.done.length + " / " + total + "</strong><span>matches played</span></div>" +
      '<div class="tonight-stat"><strong>' + (c.unbeaten + c.trail) + "</strong><span>" + balls(2, 2) + " " + c.unbeaten + " unbeaten &middot; " + balls(2, 1) + " " + c.trail + " on the Trail</span></div>" +
      '<div class="tonight-stat"><strong>' + st.playing.length + "</strong><span>tables in use &middot; " + (TABLES - st.playing.length) + " free for open play</span></div>" +
      '<p style="flex-basis:100%;font-size:0.8rem;color:var(--muted)">' + finish + " (6:00 close)</p>";
    var line;
    if (st.view.finished) {
      var champ = st.view.champion;
      var trailWins = st.done.filter(function (e) { return e.winnerId === champ && e.bracket === "L"; }).length;
      line = "🏆 " + esc(name(champ)) + " wins the Equalizer" + (trailWins ? " after " + trailWins + (trailWins === 1 ? " win" : " wins") + " on the Survivor Trail." : ", unbeaten all afternoon.");
    } else if (!st.k) {
      var byes = structure.size - structure.entrants.length;
      line = "The draw is in: " + structure.entrants.length + " players" + (byes ? ", " + byes + " byes" : "") + ", " + st.playing.length + " matches called to tables.";
    } else {
      var final = st.view.byId.GF;
      if (final.status === "ready" || st.playingById.GF) line = "The Final: " + esc(name(final.players[0])) + " (unbeaten) against " + esc(name(final.players[1])) + " from the Survivor Trail.";
      else if (st.playingById.GF2 || st.view.byId.GF2.status === "ready") line = "Replay! " + esc(name(st.view.byId.GF2.players[1])) + " won the Final, so both have one loss: one more match, best of 3, decides it.";
      else line = c.unbeaten + " still unbeaten, " + c.trail + " surviving on the Trail, " + c.out + " done for the day.";
    }
    document.getElementById("eq-headline").innerHTML = line;
  }

  // ---- Live: tables, up next, and the story so far ----
  function hsLine(hs) {
    if (!hs || !hs.lowerId || !hs.headStart) return "Even match: no head start";
    return esc(first(hs.lowerId)) + " starts every game at " + hs.headStart + "–0" + (hs.reduction ? " (" + hs.base + " less " + hs.reduction + " from earlier wins)" : "");
  }
  function scoreFlip(hs, players) {
    var a = hs && hs.lowerId === players[0] ? hs.headStart : 0;
    var b = hs && hs.lowerId === players[1] ? hs.headStart : 0;
    return flip(String(a) + String(b));
  }
  function story(e, st) {
    var winner = e.winnerId;
    var loser = e.players[0] === winner ? e.players[1] : e.players[0];
    var w = e.games[e.players.indexOf(winner)];
    var l = e.games[e.players.indexOf(loser)];
    var hs = e.hs;
    var text;
    if (hs.lowerId === winner && hs.base >= 1) text = '<span class="eq-tag">UPSET</span> ' + esc(name(winner)) + " (" + RATINGS[winner] + ") beat " + esc(name(loser)) + " (" + RATINGS[loser] + ") " + w + "–" + l + (hs.headStart ? " with " + article(hs.headStart) + " " + hs.headStart + "-point head start." : ", with no head start left.");
    else if (hs.lowerId === loser && hs.headStart) text = esc(name(winner)) + " overcame " + article(hs.headStart) + " " + hs.headStart + "-point head start to beat " + esc(name(loser)) + " " + w + "–" + l + ".";
    else text = esc(name(winner)) + " beat " + esc(name(loser)) + " " + w + "–" + l + ".";
    if (e.id === "GF2" || (e.id === "GF" && winner === e.players[0])) text += " <strong>" + esc(first(winner)) + " wins the Equalizer!</strong>";
    else if (e.id === "GF") text += " " + esc(first(winner)) + " forces a replay.";
    else if (e.bracket === "W") text += " " + esc(first(loser)) + " drops to the Survivor Trail.";
    else {
      var place = st.view.places[loser];
      text += " " + esc(first(loser)) + " is out" + (place ? " (" + placeText(place) + ")" : "") + ".";
    }
    return text;
  }

  function renderLive(st) {
    var tiles = st.playing.slice().sort(function (x, y) { return x.table - y.table; }).map(function (e) {
      return '<div class="eq-tile" data-open="' + e.id + '" role="button" tabindex="0" aria-label="Enter the result for table ' + e.table + '">' +
        '<div class="eq-tile-head"><span><span class="live-dot"></span>Table ' + e.table + "</span><span>" + roundName(e.bracket, e.round) + "</span></div>" +
        '<div class="eq-tile-body"><span class="eq-name">' + esc(name(e.players[0])) + '<span class="eq-rating">' + RATINGS[e.players[0]] + "</span></span>" + scoreFlip(e.hs, e.players) +
        '<span class="eq-name">' + esc(name(e.players[1])) + '<span class="eq-rating">' + RATINGS[e.players[1]] + "</span></span></div>" +
        '<div class="eq-tile-foot">' + hsLine(e.hs) + " &middot; best of " + e.bestOf + " &middot; " + Math.max(1, Math.round(st.time - e.start)) + " min</div></div>";
    }).join("");
    var waiting = st.view.matches.filter(function (m) { return m.status === "ready" && !st.playingById[m.id]; });
    var next = waiting.map(function (m) {
      var hs = hsFor(st, m);
      var busy = st.playing.filter(function (e) { return e.players.some(function (p) { return m.players.indexOf(p) >= 0; }); })[0];
      var why = busy ? "waiting for table " + busy.table + " to finish" : "waiting for a free table";
      return '<li data-open="' + m.id + '" style="cursor:pointer"><span class="eq-when">' + roundName(m.bracket, m.round) + "</span>" + esc(name(m.players[0])) + " vs " + esc(name(m.players[1])) + " &middot; " + hsLine(hs) + ' <span style="color:var(--muted)">(' + why + ")</span></li>";
    }).join("");
    var feed = st.done.slice(-8).reverse().map(function (e) {
      return '<li><span class="eq-when">' + clock(e.end) + "</span>" + story(e, st) + (e.byHand ? ' <span class="eq-rating">(entered by hand)</span>' : "") + "</li>";
    }).join("");
    document.getElementById("tab-live").innerHTML =
      "<h2>On the tables</h2>" + (tiles ? '<div class="eq-tables">' + tiles + "</div>" : "<p>No matches on the tables.</p>") +
      (next ? "<h2>Up next</h2><ul class=\"eq-list\">" + next + "</ul>" : "") +
      "<h2>How it's going</h2>" + (feed ? '<ul class="eq-list">' + feed + "</ul>" : "<p>No results yet.</p>");
  }

  // ---- Bracket: the classic tree, Main Draw over the Survivor Trail, then the Final ----
  var SOURCE_BY_ID = {};
  function sourceText(source) {
    if (source.seed) return "Bye";
    var from = source.winner || source.loser;
    var m = SOURCE_BY_ID[from];
    var label = m.bracket === "W" ? "Main Draw R" + m.round : m.bracket === "L" ? "Trail R" + m.round : "Final";
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
      if (!id) return '<div class="eq-row"><span class="eq-pending">' + sourceText(match.sources[side]) + "</span></div>";
      if (id === B.BYE) return '<div class="eq-row"><span class="eq-pending">bye</span></div>';
      var cls = done ? (done.winnerId === id ? " won" : " lost") : "";
      var chip = hs && hs.lowerId === id && hs.headStart ? '<span class="eq-chip" title="Starts every game at ' + hs.headStart + '">+' + hs.headStart + "</span>" : "";
      var games = done ? balls(need, done.games[side]) : entry.status === "bye" ? "" : balls(need, 0);
      return '<div class="eq-row' + cls + '"><span class="eq-name">' + esc(name(id)) + '<span class="eq-rating">' + RATINGS[id] + "</span></span>" + chip + games + "</div>";
    }).join("");
    var upset = done && hs && hs.lowerId === done.winnerId && hs.base >= 1 ? ' <span class="eq-tag">UPSET</span>' : "";
    var meta = live ? '<span><span class="live-dot" style="display:inline-block;background:#1f6b3a"></span> Table ' + live.table + "</span>" : done ? "<span>" + clock(done.end) + upset + "</span>" : entry.status === "bye" ? "<span>bye</span>" : "<span>best of " + entry.bestOf + "</span>";
    var openable = live || entry.status === "ready";
    return '<div class="eq-match ' + status + '" data-match="' + entry.id + '"' + (openable ? ' data-open="' + entry.id + '" role="button" tabindex="0"' : "") + '><div class="eq-match-head"><span>' + entry.id + "</span>" + meta + "</div>" + rows + "</div>";
  }
  function columns(entries, bracket, st) {
    var byRound = {};
    entries.forEach(function (m) { (byRound[m.round] = byRound[m.round] || []).push(m); });
    return Object.keys(byRound).map(Number).sort(function (a, b) { return a - b; }).map(function (round) {
      var list = byRound[round].sort(function (a, b) { return a.index - b.index; });
      // Trail rounds that are all byes (a field just past a power of two) are left out.
      if (bracket === "L" && list.every(function (m) { return m.status === "bye"; })) return "";
      return '<div class="eq-col"><h3>' + roundName(bracket, round) + "</h3>" + list.map(function (m) { return card(m, st); }).join("") + "</div>";
    }).join("");
  }
  function renderBracket(st) {
    SOURCE_BY_ID = {};
    structure.matches.forEach(function (m) { SOURCE_BY_ID[m.id] = m; });
    var main = st.view.matches.filter(function (m) { return m.bracket === "W"; });
    var trail = st.view.matches.filter(function (m) { return m.bracket === "L"; });
    var finals = st.view.matches.filter(function (m) { return m.bracket === "F" && m.status !== "skipped"; });
    document.getElementById("tab-bracket").innerHTML =
      "<h2>Main Draw</h2><p style=\"font-size:0.85rem;color:var(--muted)\">" + balls(2, 2) + " Two lives. Win and move right; a first loss drops you to the Survivor Trail.</p>" +
      '<div class="eq-bracket" data-connect="W">' + columns(main, "W", st) + "</div>" +
      "<h2>Survivor Trail</h2><p style=\"font-size:0.85rem;color:var(--muted)\">" + balls(2, 1) + " One life left. Losers from the Main Draw drop in each round; a second loss ends the day.</p>" +
      '<div class="eq-bracket" data-connect="L">' + columns(trail, "L", st) + "</div>" +
      "<h2>Final</h2><p style=\"font-size:0.85rem;color:var(--muted)\">The Main Draw winner against the Survivor Trail winner. If the Trail winner wins, both have one loss and a replay (best of 3) decides it.</p>" +
      '<div class="eq-bracket" data-connect="F">' + '<div class="eq-col">' + finals.map(function (m) { return "<h3>" + roundName("F", m.round) + "</h3>" + card(m, st); }).join("") + "</div></div>";
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

  // ---- The Field: everyone at a glance, by lives left ----
  function renderField(st) {
    var groups = { 2: [], 1: [], 0: [] };
    structure.entrants.forEach(function (id) { groups[st.view.lives[id]].push(id); });
    function row(id) {
      var live = st.playing.filter(function (e) { return e.players.indexOf(id) >= 0; })[0];
      var place = st.view.places[id];
      var fresh = lastLives[id] !== undefined && lastLives[id] !== st.view.lives[id] ? " fresh" : "";
      var champ = st.view.champion === id;
      return '<li class="' + fresh + '">' + balls(2, st.view.lives[id], "on") + '<span class="eq-name">' + (champ ? "🏆 " : "") + esc(name(id)) + '<span class="eq-rating">' + RATINGS[id] + "</span></span>" +
        (live ? '<span class="eq-place"><span class="live-dot" style="display:inline-block;background:#1f6b3a"></span> T' + live.table + "</span>" : place ? '<span class="eq-place">' + placeText(place) + "</span>" : "") + "</li>";
    }
    groups[2].sort(function (a, b) { return RATINGS[b] - RATINGS[a]; });
    groups[1].sort(function (a, b) { return RATINGS[b] - RATINGS[a]; });
    groups[0].sort(function (a, b) { return (st.view.places[a] || { place: 99 }).place - (st.view.places[b] || { place: 99 }).place; });
    if (st.view.champion) {
      groups[0] = [st.view.champion].concat(groups[0].filter(function (id) { return id !== st.view.champion; }));
      groups[2] = groups[2].filter(function (id) { return id !== st.view.champion; });
      groups[1] = groups[1].filter(function (id) { return id !== st.view.champion; });
    }
    document.getElementById("tab-field").innerHTML =
      "<h2>The Field</h2><p style=\"font-size:0.85rem;color:var(--muted)\">Every player, by lives left. Watch names move right as the afternoon goes on.</p>" +
      '<div class="eq-field"><div><h3>' + balls(2, 2) + " Unbeaten (" + groups[2].length + ")</h3><ul>" + groups[2].map(row).join("") + "</ul></div>" +
      "<div><h3>" + balls(2, 1) + " Survivor Trail (" + groups[1].length + ")</h3><ul>" + groups[1].map(row).join("") + "</ul></div>" +
      "<div><h3>" + balls(2, 0) + (st.view.finished ? " Final places" : " Done for the day") + " (" + groups[0].length + ")</h3><ul>" + groups[0].map(row).join("") + "</ul></div></div>";
    lastLives = Object.assign({}, st.view.lives);
  }

  // ---- Results: the champion, the podium, the awards, and everyone's afternoon ----
  function renderResults(st) {
    var record = {};
    structure.entrants.forEach(function (id) { record[id] = { w: 0, l: 0, trailWins: 0 }; });
    st.done.forEach(function (e) {
      var loser = e.players[0] === e.winnerId ? e.players[1] : e.players[0];
      record[e.winnerId].w += 1;
      record[loser].l += 1;
      if (e.bracket === "L") record[e.winnerId].trailWins += 1;
    });
    var points = H.exchange(false);
    var html = "";
    if (st.view.finished) {
      var champ = st.view.champion;
      var path = st.done.filter(function (e) { return e.players.indexOf(champ) >= 0; });
      html += '<div class="eq-champion"><span class="ball on">🏆</span><div><span class="tonight-eyebrow">Equalizer champion &middot; ' + clock(st.time) + "</span><strong>" + esc(name(champ)) + "</strong>" +
        RATINGS[champ] + " &rarr; " + (RATINGS[champ] + points * (record[champ].w - record[champ].l)) + " &middot; " + record[champ].w + "–" + record[champ].l +
        (record[champ].trailWins ? " &middot; " + record[champ].trailWins + (record[champ].trailWins === 1 ? " win" : " wins") + " on the Survivor Trail" : " &middot; unbeaten") + "</div></div>";
      var podium = [1, 2, 3].map(function (place) {
        var id = Object.keys(st.view.places).filter(function (p) { return st.view.places[p].place === place; })[0];
        return '<div class="tonight-stat"><strong>' + ordinal(place) + "</strong><span>" + esc(name(id)) + " (" + RATINGS[id] + ")</span></div>";
      }).join("");
      html += '<div class="eq-podium">' + podium + "</div>";
      var upsets = st.done.filter(function (e) { return e.hs.lowerId === e.winnerId && e.hs.base >= 1; });
      var biggest = upsets.sort(function (a, b) { return Math.abs(RATINGS[b.players[0]] - RATINGS[b.players[1]]) - Math.abs(RATINGS[a.players[0]] - RATINGS[a.players[1]]); })[0];
      var defenses = st.done.filter(function (e) { return e.hs.lowerId && e.hs.lowerId !== e.winnerId && e.hs.headStart; });
      var toughest = defenses.sort(function (a, b) { return b.hs.headStart - a.hs.headStart || Math.abs(RATINGS[b.players[0]] - RATINGS[b.players[1]]) - Math.abs(RATINGS[a.players[0]] - RATINGS[a.players[1]]); })[0];
      var trailer = structure.entrants.slice().sort(function (a, b) { return record[b].trailWins - record[a].trailWins; })[0];
      function loserOf(e) { return e.players[0] === e.winnerId ? e.players[1] : e.players[0]; }
      html += "<h2>Awards</h2><div class=\"eq-awards\">" +
        (biggest ? '<div class="eq-step"><span class="eq-tag">UPSET</span><strong>Biggest upset</strong>' + esc(name(biggest.winnerId)) + " (" + RATINGS[biggest.winnerId] + ") beat " + esc(name(loserOf(biggest))) + " (" + RATINGS[loserOf(biggest)] + "), " + Math.abs(RATINGS[biggest.winnerId] - RATINGS[loserOf(biggest)]) + " points apart.</div>" : "") +
        (toughest ? '<div class="eq-step">' + flip(String(toughest.hs.headStart) + "0") + "<strong>Toughest defense</strong>" + esc(name(toughest.winnerId)) + " gave " + esc(first(loserOf(toughest))) + " " + toughest.hs.headStart + " points a game and still won.</div>" : "") +
        (record[trailer].trailWins ? '<div class="eq-step">' + balls(2, 1) + "<strong>Longest trail</strong>" + esc(name(trailer)) + " won " + record[trailer].trailWins + " matches on the Survivor Trail.</div>" : "") +
        "</div>";
      html += "<h2>" + esc(first(champ)) + "'s path</h2><ul class=\"eq-list\">" + path.map(function (e) {
        var other = e.players[0] === champ ? e.players[1] : e.players[0];
        var side = e.players.indexOf(champ);
        return '<li><span class="eq-when">' + roundName(e.bracket, e.round) + "</span>" + (e.winnerId === champ ? '<span class="match-win">W</span>' : '<span class="match-loss">L</span>') + " " + e.games[side] + "–" + e.games[1 - side] + " vs " + esc(name(other)) + " (" + RATINGS[other] + ") &middot; " + hsLine(e.hs) + "</li>";
      }).join("") + "</ul>";
    } else {
      html += "<p class=\"notice\" style=\"margin-bottom:16px\">Results so far. The champion, podium and awards appear when the Final is done; places below fill in as players are knocked out.</p>";
    }
    var order = structure.entrants.slice().sort(function (a, b) {
      var pa = st.view.places[a];
      var pb = st.view.places[b];
      if (pa && pb) return pa.place - pb.place || RATINGS[b] - RATINGS[a];
      if (pa || pb) return pa ? 1 : -1;
      return st.view.lives[b] - st.view.lives[a] || RATINGS[b] - RATINGS[a];
    });
    html += "<h2>" + (st.view.finished ? "Everyone's afternoon" : "Standings so far") + "</h2>" +
      '<table class="session-group-table" style="width:100%"><thead><tr><th>Player</th><th>Place</th><th>Equalizer W-L</th><th>Rating</th></tr></thead><tbody>' +
      order.map(function (id) {
        var change = points * (record[id].w - record[id].l);
        var place = st.view.places[id];
        return '<tr' + (st.view.champion === id ? ' class="group-winner-row"' : "") + "><td>" + balls(2, st.view.lives[id]) + " " + esc(name(id)) + "</td><td>" + (place ? placeText(place) : st.view.lives[id] === 2 ? "unbeaten" : "on the Trail") + "</td><td>" + record[id].w + "-" + record[id].l + "</td><td>" + (RATINGS[id] + change) + (change ? ' <span class="' + (change > 0 ? "match-win" : "match-loss") + '">(' + (change > 0 ? "+" : "") + change + ")</span>" : "") + "</td></tr>";
      }).join("") + "</tbody></table>" +
      "<p style=\"font-size:0.8rem;color:var(--muted)\">Equalizer wins and losses are kept apart from round robin club and year records. Ratings change by " + points + " a match either way, from the same rating table round robins use at equal ratings.</p>";
    document.getElementById("tab-results").innerHTML = html;
  }

  // ---- Head starts: the table, a calculator, and how the memory moves ----
  var demo = { history: [], resets: [] };
  function renderHeadStarts(st) {
    var steps = [];
    for (var n = 0; n <= 8; n += 1) steps.push("<td>" + (n === 8 ? "320+" : (n * 40) + "–" + (n * 40 + 39)) + "</td>");
    var starts = [];
    for (var s = 0; s <= 8; s += 1) starts.push("<td><strong>" + s + "</strong></td>");
    var memoryPairs = {};
    prior.forEach(function (m) { memoryPairs[H.pairKey(m.playerOneId, m.playerTwoId)] = [m.playerOneId, m.playerTwoId]; });
    var memory = Object.keys(memoryPairs).map(function (key) {
      var pair = memoryPairs[key];
      var now = headStart(pair[0], pair[1], st.history);
      var played = prior.concat(st.history).filter(function (m) { return H.pairKey(m.playerOneId, m.playerTwoId) === key; });
      return "<li>" + esc(name(pair[0])) + " &amp; " + esc(name(pair[1])) + ": " + played.map(function (m) { return esc(first(m.winnerId)) + (m.at.indexOf("event") === 0 ? " (today)" : " (" + m.at.slice(5) + ")"); }).join(", ") + " &rarr; " + (now.headStart ? esc(first(now.lowerId)) + " starts at " + now.headStart + " (base " + now.base + ")" : "no head start") + "</li>";
    }).join("");
    document.getElementById("tab-head-starts").innerHTML =
      "<h2>Head starts</h2><p>Every full 40 rating points between two players gives the lower-rated player 1 point at the start of <em>every</em> game, up to 8. A 39-point gap is no head start; 40 is one. With 8, the lower-rated player still needs 3 points to win a game, and games are still to 11, win by 2.</p>" +
      '<div style="overflow-x:auto"><table class="session-group-table"><tbody><tr><th>Rating gap</th>' + steps.join("") + "</tr><tr><th>Starts every game at</th>" + starts.join("") + "</tr></tbody></table></div>" +
      '<h3>Find a head start</h3><div class="eq-calc"><label>Your rating <input type="number" id="eq-r1" value="1590" min="0" max="4000"></label><label>Opponent <input type="number" id="eq-r2" value="1800" min="0" max="4000"></label><span id="eq-calc-out"></span></div>' +
      "<h3>The memory</h3><p>When the same two players meet again, the head start remembers. A win by the lower-rated player takes a point off their next head start against that player; a win by the higher-rated player gives one back, never more than the rating gap allows. It carries over from one Saturday to the next until the club resets it.</p>" +
      '<div class="eq-calc"><span>1590 vs 1800 (base 5):</span><button class="small-button" type="button" data-demo="lower">Lower-rated wins</button><button class="small-button" type="button" data-demo="higher">Higher-rated wins</button><button class="small-button" type="button" data-demo="reset">Owner reset</button><div class="eq-memory" id="eq-demo" style="flex-basis:100%"></div></div>' +
      (memory ? "<h3>Memory in this simulated field</h3><ul class=\"eq-list\">" + memory + "</ul>" : "");
    calc();
    renderDemo();
  }
  function calc() {
    var r1 = Number(document.getElementById("eq-r1").value);
    var r2 = Number(document.getElementById("eq-r2").value);
    var base = H.baseHeadStart(r1, r2);
    var out = document.getElementById("eq-calc-out");
    if (base === null) { out.textContent = ""; return; }
    var you = r1 < r2 ? base : 0;
    var them = r2 < r1 ? base : 0;
    out.innerHTML = flip(String(you) + String(them)) + " " + (base ? (you ? "You start" : "They start") + " every game at " + base + "–0 (" + Math.abs(r1 - r2) + " points apart)." : "No head start: less than 40 points apart.");
  }
  function renderDemo() {
    var ratings = { hi: 1800, lo: 1590 };
    var line = ['<span>Start: ' + H.pairState("hi", "lo", ratings, [], []).headStart + "</span>"];
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
    var hs = hsFor(st, entry);
    scoring = { id: id, players: entry.players, need: (entry.bestOf + 1) / 2, games: [null, null] };
    document.getElementById("eq-score-title").textContent = entry.id + " · " + roundName(entry.bracket, entry.round);
    document.getElementById("eq-score-note").textContent = hsLine(hs).replace(/&ndash;/g, "–") + " · best of " + entry.bestOf + ". Games won:";
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
      return '<div class="eq-score-row"><span class="eq-name">' + esc(name(id)) + '<span class="eq-rating">' + RATINGS[id] + '</span></span><span class="balls">' + buttons + "</span></div>";
    }).join("");
  }
  function closeScore() {
    var dialog = document.getElementById("eq-score");
    if (dialog.close) dialog.close(); else dialog.removeAttribute("open");
  }
  function saveScore(event) {
    event.preventDefault();
    var g = scoring.games;
    var valid = g[0] !== null && g[1] !== null && ((g[0] === scoring.need && g[1] < scoring.need) || (g[1] === scoring.need && g[0] < scoring.need));
    if (!valid) {
      document.getElementById("eq-score-error").textContent = "One player needs " + scoring.need + " games and the other fewer.";
      return;
    }
    forced[scoring.id] = { winnerId: scoring.players[g[0] > g[1] ? 0 : 1], games: g.slice() };
    timeline = simulate();
    var index = timeline.map(function (e) { return e.id; }).indexOf(scoring.id);
    step = index + 1;
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
      button.addEventListener("click", function () { onPick(option.id); });
      box.appendChild(button);
    });
  }
  function renderControls() {
    chips("eq-size", [8, 12, 16, 20, 24].map(function (n) { return { id: n, label: String(n) }; }), config.size, function (n) { config.size = n; forced = {}; regenerate(); step = 0; render(); });
    chips("eq-mode", MODES, config.mode, function (mode) { config.mode = mode; forced = {}; regenerate(); step = 0; render(); });
    var slider = document.getElementById("eq-slider");
    slider.max = timeline.length;
    slider.value = step;
    document.getElementById("eq-step-count").textContent = "result " + step + " of " + timeline.length;
    document.getElementById("eq-auto").innerHTML = autoTimer ? "&#10074;&#10074; Pause" : "&#9654; Auto-play";
  }
  function showTab(name) {
    tab = ["live", "bracket", "field", "results", "head-starts"].indexOf(name) >= 0 ? name : "live";
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
  document.getElementById("eq-redraw").addEventListener("click", function () { stopAuto(); config.seed += 1; forced = {}; regenerate(); go(0); });
  document.getElementById("eq-auto").addEventListener("click", function () {
    if (autoTimer) { stopAuto(); renderControls(); return; }
    if (step >= timeline.length) step = 0;
    autoTimer = setInterval(function () {
      if (step >= timeline.length) { stopAuto(); renderControls(); return; }
      go(step + 1);
    }, 900);
    renderControls();
  });
  document.getElementById("eq-slider").addEventListener("input", function (event) { stopAuto(); go(Number(event.target.value)); });
  document.getElementById("eq-tabs").addEventListener("click", function (event) {
    var button = event.target.closest(".leaderboard-tab");
    if (!button) return;
    showTab(button.dataset.tab);
    try { history.replaceState(null, "", "#" + tab); } catch (error) { location.hash = tab; }
  });
  window.addEventListener("hashchange", function () { showTab(location.hash.slice(1)); });
  document.querySelector("main").addEventListener("click", function (event) {
    var demoButton = event.target.closest("[data-demo]");
    if (demoButton) {
      var kind = demoButton.dataset.demo;
      if (kind === "reset") demo.resets.push({ at: "m" + (100 + demo.history.length), pair: "all", count: demo.history.length });
      else demo.history.push({ at: "m" + (101 + demo.history.length), playerOneId: "hi", playerTwoId: "lo", winnerId: kind === "lower" ? "lo" : "hi", forfeit: false, ratings: { hi: 1800, lo: 1590 } });
      renderDemo();
      return;
    }
    var open = event.target.closest("[data-open]");
    if (open) { stopAuto(); openScore(open.dataset.open); }
  });
  document.querySelector("main").addEventListener("keydown", function (event) {
    var open = event.target.closest && event.target.closest("[data-open]");
    if (open && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openScore(open.dataset.open); }
  });
  document.querySelector("main").addEventListener("input", function (event) {
    if (event.target.id === "eq-r1" || event.target.id === "eq-r2") calc();
  });
  document.getElementById("eq-score-rows").addEventListener("click", function (event) {
    var ball = event.target.closest("button.ball");
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
