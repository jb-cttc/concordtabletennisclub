// Concept only, not part of the desk: see docs/player-board-mockup.html. Uses the shared rules files from the site root.
// Player Board concept: what a second, desk-driven window on the gym TV could show. Made-up players on the club's
// real rules (equalizer.js, handicap.js, bracket.js, round-robin.js, standings.js). Nothing here is saved anywhere.
(function () {
  "use strict";

  var E = window.CTTCEqualizer;
  var RR = window.CTTCRoundRobin;
  var ST = window.CTTCStandings;

  function seeded(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rand = seeded(20261031);
  function pick(list) { return list[Math.floor(rand() * list.length)]; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // ---- Made-up players (the Equalizer mockup's 24, plus 16 more on the same spread) ----
  var PEOPLE = [
    ["Avery Lin", 2100], ["Bea Torres", 1785], ["Cal Okafor", 1690], ["Dana Wu", 1550], ["Eli Novak", 1440], ["Faye Moreno", 1380],
    ["Gus Patel", 1280], ["Hana Sato", 1195], ["Ivo Rossi", 1145], ["Jo Mensah", 1125], ["Kai Larsen", 1085], ["Lena Brandt", 965],
    ["Milo Reyes", 815], ["Nia Osei", 745], ["Omar Haddad", 670], ["Pia Lund", 625], ["Quinn Achebe", 590], ["Rui Costa", 560],
    ["Sana Iqbal", 515], ["Theo Marsh", 495], ["Uma Varga", 400], ["Vik Rao", 365], ["Wren Doyle", 330], ["Yuki Mori", 255],
    ["Jules Ferrer", 1880], ["Finn Walsh", 1625], ["Ari Klein", 1500], ["Otto Lang", 1475], ["Cleo Ndiaye", 1330], ["Kofi Asante", 1260],
    ["Dev Shah", 1205], ["Hugo Bell", 1060], ["Zoe Park", 1010], ["Max Weber", 970], ["Bo Lindqvist", 905], ["Noor Aziz", 860],
    ["Esme Grant", 780], ["Iris Tan", 690], ["Luz Medina", 540], ["Gia Romano", 440],
    ["Alexandra Kowalczyk", 1240], ["Ben Adler", 1720], ["Chloe Martin", 1110], ["Diego Alvarez", 1400], ["Erin Cho", 880],
    ["Felix Braun", 640], ["Grace Liu", 1580], ["Ian Brooks", 470], ["Kenji Ito", 760], ["Mara Quinn", 350]
  ];
  var P = {};
  var ALL = PEOPLE.map(function (row, i) {
    var id = "p" + i;
    P[id] = { id: id, name: row[0], rating: row[1], paid: rand() < 0.68, first: false, promo: null };
    return id;
  });
  function idOf(name) { return ALL.filter(function (id) { return P[id].name === name; })[0]; }
  P[idOf("Gia Romano")].first = true; P[idOf("Gia Romano")].paid = false;
  P[idOf("Luz Medina")].first = true; P[idOf("Luz Medina")].paid = false;
  // Group winners last week: guaranteed one group above the group they won (the desk's promotion rule).
  P[idOf("Lena Brandt")].promo = { group: 4, date: "Oct 24" };
  P[idOf("Rui Costa")].promo = { group: 6, date: "Oct 24" };
  function short(id) { var parts = P[id].name.split(" "); return parts[0] + " " + parts[1].charAt(0) + "."; }
  function byRating(a, b) { return P[b].rating - P[a].rating || P[a].name.localeCompare(P[b].name); }
  function byName(a, b) { return P[a].name.localeCompare(P[b].name); }

  // ---- Board settings ----
  var S = { concept: "carousel", event: "rr", stage: "signin", look: "desk", size: "6", secs: 14, pay: true, rating: true };

  // ---- Round robin desk state ----
  var RR_LATE = ["Zoe Park", "Hugo Bell", "Iris Tan", "Max Weber", "Noor Aziz", "Otto Lang", "Esme Grant", "Kofi Asante", "Erin Cho"].map(idOf);
  var rr = { roster: ALL.filter(function (id) { return RR_LATE.indexOf(id) < 0; }), late: RR_LATE.slice(), pins: {}, groups: [], printed: null, matches: [], results: {} };

  function groupOf(groups, id) { for (var i = 0; i < groups.length; i += 1) if (groups[i].indexOf(id) >= 0) return i; return -1; }
  // By rating in groups of 6 (or 5), then promotions, then the desk's manual moves.
  function organize() {
    var ids = rr.roster.slice().sort(byRating);
    var groups = [];
    var at = 0;
    RR.sizeGroups(ids.length, Number(S.size)).forEach(function (size) { groups.push(ids.slice(at, at + size)); at += size; });
    ids.forEach(function (id) {
      if (!P[id].promo || rr.pins[id] != null) return;
      var target = Math.max(0, P[id].promo.group - 2);
      var now = groupOf(groups, id);
      if (now <= target) return;
      groups[now].splice(groups[now].indexOf(id), 1);
      var down = groups[target].slice().reverse().filter(function (x) { return !P[x].promo && rr.pins[x] == null; })[0];
      if (down) { groups[target].splice(groups[target].indexOf(down), 1); groups[now].push(down); }
      groups[target].push(id);
    });
    Object.keys(rr.pins).forEach(function (id) {
      var now = groupOf(groups, id);
      if (now < 0) return;
      var target = Math.max(0, Math.min(rr.pins[id], groups.length - 1));
      if (target === now) return;
      groups[now].splice(groups[now].indexOf(id), 1);
      groups[target].push(id);
    });
    groups.forEach(function (g) { g.sort(byRating); });
    rr.groups = groups.filter(function (g) { return g.length; });
  }
  organize();

  function printRR() {
    rr.printed = rr.groups.map(function (g) { return g.slice(); });
    rr.matches = [];
    rr.results = {};
    rr.printed.forEach(function (ids, gi) {
      RR.roundRobinRounds(ids).forEach(function (pairs, round) {
        pairs.forEach(function (pair, k) { rr.matches.push({ id: "R" + (gi + 1) + "-" + (round + 1) + "-" + k, g: gi, round: round + 1, a: pair[0], b: pair[1] }); });
      });
    });
    // Two rounds already played, so the first look isn't empty.
    rr.matches.forEach(function (m) { if (m.round <= 2) rr.results[m.id] = rrScore(m); });
  }
  function rrScore(m) {
    var pA = 1 / (1 + Math.pow(10, (P[m.b].rating - P[m.a].rating) / 400));
    var aWins = rand() < pA;
    var lose = Math.floor(rand() * 3);
    return aWins ? { a: 3, b: lose } : { a: lose, b: 3 };
  }
  function rrTable(gi) {
    var ids = rr.printed[gi];
    var rows = {};
    ids.forEach(function (id) { rows[id] = { name: id, ratingBefore: P[id].rating, matches: [] }; });
    var played = 0;
    var total = 0;
    var round = null;
    rr.matches.forEach(function (m) {
      if (m.g !== gi) return;
      total += 1;
      var r = rr.results[m.id];
      if (!r) { if (round == null || m.round < round) round = m.round; return; }
      played += 1;
      rows[m.a].matches.push({ opponent: m.b, gamesWon: r.a, gamesLost: r.b, forfeitedBy: "" });
      rows[m.b].matches.push({ opponent: m.a, gamesWon: r.b, gamesLost: r.a, forfeitedBy: "" });
    });
    var order = ST.sortByGroupResult(ids.map(function (id) { return rows[id]; })).map(function (row) { return row.name; });
    var tally = {};
    ids.forEach(function (id) {
      var t = { wins: 0, losses: 0, gw: 0, gl: 0 };
      rows[id].matches.forEach(function (m) { t.gw += m.gamesWon; t.gl += m.gamesLost; if (m.gamesWon > m.gamesLost) t.wins += 1; else t.losses += 1; });
      tally[id] = t;
    });
    var rounds = ids.length % 2 ? ids.length : ids.length - 1;
    return { order: order, tally: tally, played: played, total: total, complete: played === total, round: round, rounds: rounds };
  }

  // ---- Equalizer desk state ----
  var EQ_START = ["Avery Lin", "Bea Torres", "Dana Wu", "Eli Novak", "Gus Patel", "Hana Sato", "Jo Mensah", "Kai Larsen", "Lena Brandt", "Milo Reyes", "Nia Osei", "Pia Lund", "Rui Costa", "Theo Marsh", "Wren Doyle", "Yuki Mori"].map(idOf);
  var EQ_LATE = ["Cal Okafor", "Sana Iqbal", "Ivo Rossi", "Uma Varga", "Finn Walsh", "Iris Tan", "Zoe Park", "Gia Romano"].map(idOf);
  var eq = { roster: EQ_START.slice(), late: EQ_LATE.slice(), event: null, results: {}, done: [] };

  function printEQ() {
    eq.event = E.create({ format: S.event, play: "singles", bestOf: 3, players: eq.roster.map(function (id) { return { id: id, rating: P[id].rating }; }) }, seeded(eq.roster.length * 7 + (S.event === "double" ? 1 : 0)));
    eq.results = {};
    eq.done = [];
    var target = S.event === "double" ? Math.round(eq.roster.length * 0.75) : Math.round(eq.event.groups.reduce(function (n, g) { return n + g.matches.length; }, 0) * 0.5);
    for (var i = 0; i < target; i += 1) eqPlay(true);
  }
  function eqResolved() { return E.resolve(eq.event, eq.results); }
  function eqHead(a, b) { return E.headStart(eq.event, a, b); }
  // Plays the next match in the desk's call order. Returns what happened, or null when nothing is ready.
  function eqPlay(quiet) {
    var before = eqResolved();
    var next = E.callOrder(before)[0];
    if (!next) return null;
    var a = next.players[0];
    var b = next.players[1];
    var hs = eqHead(a, b);
    var lower = hs.lowerId;
    var higher = lower === a ? b : a;
    var winner = lower && rand() < 0.43 ? lower : (lower ? higher : (rand() < 0.5 ? a : b));
    var games = [0, 0];
    games[next.players.indexOf(winner)] = 2;
    games[1 - next.players.indexOf(winner)] = rand() < 0.45 ? 1 : 0;
    eq.results[next.id] = { winnerId: winner, games: games };
    eq.done.push(next.id);
    if (quiet) return null;
    var loser = winner === a ? b : a;
    var after = eqResolved();
    var upset = winner === lower && hs.headStart >= 3;
    var score = Math.max(games[0], games[1]) + "–" + Math.min(games[0], games[1]);
    var news = (upset ? "<span class=\"upset\">Upset</span> <b>" + esc(P[winner].name) + "</b> (+" + hs.headStart + ")" : "<b>" + esc(P[winner].name) + "</b>") + " beat <b>" + esc(P[loser].name) + "</b> " + score;
    var panel = next.stage === "G" ? "g" + next.group : S.event === "groups" ? "finals" : next.stage === "W" ? "main" : next.stage === "L" ? "trail" : "field";
    if (next.stage === "G") {
      var table = after.tables[next.group - 1];
      if (table.complete) {
        mark("w:" + next.group);
        news = "Group " + next.group + " decided: <b>" + esc(P[table.winnerId].name) + "</b> goes to the Finals";
        if (after.tables.every(function (t) { return t.complete; })) news = "All groups decided: <b>the Finals are set</b>";
        panel = "finals";
      }
    }
    if (after.champion) news = "<b>" + esc(P[after.champion].name) + "</b> wins the Equalizer";
    return { id: next.id, news: news, panel: panel };
  }

  // ---- What just changed: rows and matches glow orange for a few seconds ----
  var fresh = {};
  var FRESH_MS = 7000;
  function mark(key, why) { fresh[key] = { t: Date.now(), why: why || "" }; }
  function glow(key) {
    var f = fresh[key];
    if (!f) return { cls: "", attr: "" };
    var age = Date.now() - f.t;
    if (age > FRESH_MS) { delete fresh[key]; return { cls: "", attr: "" }; }
    return { cls: " fresh", attr: " style=\"animation-delay:-" + age + "ms\"" + (f.why ? " data-why=\"" + esc(f.why) + "\"" : "") };
  }
  function popped(id) {
    var f = fresh["pay:" + id];
    if (!f) return "";
    var age = Date.now() - f.t;
    if (age > 900) return "";
    return " flash-pay\" style=\"animation-delay:-" + age + "ms";
  }

  // ---- Ticker: sign-ins, moves and results (never payments) ----
  var log = [
    { t: Date.now() - 95000, html: "<b>Dana Wu</b> signed in" },
    { t: Date.now() - 260000, html: "<b>Lena Brandt</b> moved up · won Group 4 last week" }
  ];
  function say(html) { log.unshift({ t: Date.now(), html: html }); log = log.slice(0, 6); }
  function ago(t) {
    var s = Math.round((Date.now() - t) / 1000);
    return s < 45 ? "Just now" : s < 90 ? "1 min ago" : Math.round(s / 60) + " min ago";
  }

  // ---- Pieces ----
  function payBox(id) { return "<span class=\"pay" + (P[id].paid ? " paid" : "") + popped(id) + "\" title=\"" + (P[id].paid ? "Payment recorded" : "Payment not recorded yet") + "\">✓</span>"; }
  // Above the group their rating alone gives them: a group winner from last time (trophy) or a move up at the desk (arrow).
  function ratingGroup(id, groups) {
    var ids = [].concat.apply([], groups).sort(byRating);
    var at = 0;
    var sizes = groups.map(function (g) { return g.length; }).sort(function (a, b) { return b - a; });
    for (var i = 0; i < sizes.length; i += 1) { if (ids.indexOf(id) < at + sizes[i]) return i; at += sizes[i]; }
    return sizes.length - 1;
  }
  function pushedUp(id) {
    if (S.event !== "rr") return null;
    var groups = S.stage === "printed" ? rr.printed : rr.groups;
    var now = groupOf(groups, id);
    if (now < 0 || now >= ratingGroup(id, groups)) return null;
    return P[id].promo && rr.pins[id] == null ? "won" : "moved";
  }
  var TROPHY = "<svg class=\"trophy-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V17h3v2H8v-2h3v-2.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3V3Zm10 4v3a2 2 0 0 0 1-1.7V7h-1ZM6 7v1.3A2 2 0 0 0 7 10V7H6Zm2 13h8v1H8v-1Z\"/></svg>";
  function pushTag(id) {
    var why = pushedUp(id);
    if (why === "won") return "<span class=\"chip promo\" title=\"Group winners move up at least one group\">Won Group " + P[id].promo.group + " last time</span>";
    if (why === "moved") return "<span class=\"chip moved\">Moved up</span>";
    return "";
  }
  function pushMark(id) {
    var why = pushedUp(id);
    return why === "won" ? " <span class=\"push won\" title=\"Won Group " + P[id].promo.group + " last time\">" + TROPHY + "</span>" : why === "moved" ? " <span class=\"push moved\" title=\"Moved up at the desk\">▲</span>" : "";
  }
  function playerRow(id, seat) {
    var p = P[id];
    var g = glow("p:" + id);
    var tags = pushTag(id) + (p.first ? "<span class=\"chip first\">1st visit · welcome!</span>" : "");
    return "<li class=\"row" + g.cls + "\"" + g.attr + "><span class=\"seat\">" + seat + "</span><span class=\"who\"><span class=\"name\">" + esc(p.name) + pushMark(id) + "</span><span class=\"tags\">" + tags + "</span></span><span class=\"rating\">" + p.rating + "</span>" + payBox(id) + "</li>";
  }
  function panel(key, head, body) { return { key: key, html: "<section class=\"panel\" data-panel=\"" + key + "\"><header class=\"p-head\">" + head + "</header><div class=\"p-body\">" + body + "</div></section>" }; }

  // Round robin, signing in: each group by rating.
  function rrSignin() {
    return rr.groups.map(function (ids, gi) {
      var head = "<h2>Group " + (gi + 1) + "</h2><span class=\"sub\">" + P[ids[0]].rating + "–" + P[ids[ids.length - 1]].rating + "</span><span class=\"right\"><b>" + ids.length + "</b> players</span>";
      return panel("g" + (gi + 1), head, "<ol class=\"rows\">" + ids.map(function (id, i) { return playerRow(id, i + 1); }).join("") + "</ol>");
    });
  }
  // Round robin, after printing: the sheet's grid (big) or a standings table (wall).
  function rrPrinted(small) {
    return rr.printed.map(function (ids, gi) {
      var t = rrTable(gi);
      var status = t.complete ? "<b>Final</b>" : "Round <b>" + t.round + "</b> of " + t.rounds;
      var head = "<h2>Group " + (gi + 1) + "</h2><span class=\"sub\">" + t.played + " of " + t.total + " played</span><span class=\"right\">" + status + "</span>";
      var place = {};
      t.order.forEach(function (id, i) { place[id] = i + 1; });
      if (small) {
        var rows = t.order.map(function (id, i) {
          var x = t.tally[id];
          var lead = t.complete && i === 0;
          return "<tr" + (lead ? " class=\"lead\"" : "") + "><td class=\"pos\">" + (t.played ? i + 1 : "–") + "</td><td class=\"nm\">" + (lead ? "🏆 " : "") + esc(P[id].name) + "</td><td>" + x.wins + "–" + x.losses + "</td><td>" + x.gw + "–" + x.gl + "</td></tr>";
        }).join("");
        return panel("g" + (gi + 1), head, "<table class=\"st\" style=\"--st-h:" + Math.min(52, Math.floor(280 / ids.length)) + "px\"><colgroup><col style=\"width:44px\"><col><col style=\"width:80px\"><col style=\"width:90px\"></colgroup><thead><tr><th></th><th>Player</th><th>W–L</th><th>Games</th></tr></thead><tbody>" + rows + "</tbody></table>");
      }
      var cellW = ids.length > 6 ? 54 : 62;
      var cols = "<colgroup><col style=\"width:44px\"><col>" + ids.map(function () { return "<col style=\"width:" + cellW + "px\">"; }).join("") + "<col style=\"width:68px\"><col style=\"width:52px\"></colgroup>";
      var headRow = "<tr><th>#</th><th class=\"n\">Player</th>" + ids.map(function (_, i) { return "<th>" + (i + 1) + "</th>"; }).join("") + "<th>W–L</th><th>Pos</th></tr>";
      var body = ids.map(function (id, i) {
        var x = t.tally[id];
        var lead = t.complete && place[id] === 1;
        var cells = ids.map(function (other, j) {
          if (i === j) return "<td class=\"self\"></td>";
          var m = rr.matches.filter(function (mm) { return mm.g === gi && ((mm.a === id && mm.b === other) || (mm.a === other && mm.b === id)); })[0];
          var r = m && rr.results[m.id];
          if (!r) return "<td></td>";
          var mine = m.a === id ? r.a : r.b;
          var theirs = m.a === id ? r.b : r.a;
          var g = glow("m:" + m.id);
          return "<td class=\"cell " + (mine > theirs ? "w" : "l") + g.cls + "\"" + g.attr + ">" + mine + "–" + theirs + "</td>";
        }).join("");
        return "<tr" + (lead ? " class=\"lead\"" : "") + "><td class=\"pos\">" + (i + 1) + "</td><td class=\"nm\">" + (lead ? "<span class=\"trophy\">🏆</span> " : "") + esc(P[id].name) + pushMark(id) + "<small class=\"rating\">" + P[id].rating + "</small></td>" + cells + "<td class=\"wl\">" + x.wins + "–" + x.losses + "</td><td class=\"pos\">" + (t.played ? place[id] : "–") + "</td></tr>";
      }).join("");
      var foot = t.complete ? "Group decided" : "Same grid as the printed sheet · fills in as the desk enters scores";
      return panel("g" + (gi + 1), head, "<table class=\"xt\" style=\"--xt-h:" + Math.min(96, Math.floor(560 / ids.length)) + "px\">" + cols + "<thead>" + headRow + "</thead><tbody>" + body + "</tbody></table><p class=\"p-foot\">" + foot + "</p>");
    });
  }

  // Equalizer, signing in: the field A–Z (the random draw comes when the sheets print), plus how tonight works.
  function eqSignin(small) {
    var ids = eq.roster.slice().sort(byName);
    var per = small ? 8 : 7;
    var out = [eqInfo()];
    for (var i = 0; i < ids.length; i += per) {
      var chunk = ids.slice(i, i + per);
      var from = P[chunk[0]].name.charAt(0);
      var to = P[chunk[chunk.length - 1]].name.charAt(0);
      var head = "<h2>The field</h2><span class=\"sub\">" + (from === to ? from : from + "–" + to) + "</span><span class=\"right\"><b>" + eq.roster.length + "</b> of 24 places</span>";
      out.push(panel("f" + (i / per), head, "<ol class=\"rows\">" + chunk.map(function (id, k) { return playerRow(id, i + k + 1); }).join("") + "</ol>"));
    }
    return out;
  }
  function eqInfo() {
    var groups = S.event === "groups";
    var head = "<h2>Tonight</h2><span class=\"sub\">The Equalizer</span><span class=\"right\">Singles · best of 3</span>";
    var body = "<div class=\"info\"><p class=\"big\">" + (groups ? "RR → Finals" : "Double Elimination") + "</p>" +
      "<p>" + (groups ? "Random groups of 4. Each group winner goes on to a single-elimination Finals." : "Lose once and you drop to the Survivor Trail. Lose twice and you're out.") + "</p>" +
      "<p class=\"rule\">" + "<span class=\"hs\">+1</span>" + "<span>a head start in every game for each 40 rating points between you, up to 8</span></p>" +
      "<p class=\"rule\">" + "<span class=\"hs pts\">±8</span>" + "<span>rating points on every match: win and gain 8, lose and give 8</span></p>" +
      "<p>The draw happens when the sheets print. Check your name is on the list.</p></div>";
    return panel("info", head, body);
  }

  function hsTile(n) { return n > 0 ? "<span class=\"hs\" title=\"Head start: starts every game at " + n + "–0\">+" + n + "</span>" : ""; }
  function mline(m, label) {
    var a = m.players[0];
    var b = m.players[1];
    var done = m.status === "done";
    var hs = a && b ? eqHead(a, b) : null;
    var g = glow("m:" + m.id);
    function side(id, cls) {
      if (!id) return "<span class=\"sd " + cls + "\"><span>—</span></span>";
      var state = done ? (m.winnerId === id ? " won" : " lost") : "";
      var tile = hs && hs.lowerId === id ? hsTile(hs.headStart) : "";
      var name = "<span>" + esc(P[id].name) + "</span>";
      return "<span class=\"sd " + cls + state + "\">" + (cls === "b" ? tile + name : name + tile) + "</span>";
    }
    var games = done && m.result.games ? m.result.games[0] + "–" + m.result.games[1] : "";
    return "<li class=\"mline" + g.cls + "\"" + g.attr + "><span class=\"rd\">" + label + "</span>" + side(a, "a") + "<span class=\"vs\">vs</span>" + side(b, "b") + "<span class=\"gm" + (done ? "" : " wait") + "\">" + (games || "–") + "</span></li>";
  }
  // Where an empty Finals slot is filled from: a group winner, a bye for the best group winner, or the match before.
  function slotLabel(m, i) {
    if (S.event !== "groups") return "to come";
    var source = (eq.event.bracket.matches.filter(function (x) { return x.id === m.id; })[0] || { sources: [] }).sources[i] || {};
    if (source.seed) return "Group winner";
    var from = source.winner && eqResolved().byId[source.winner];
    return from && from.status === "bye" ? "Best group winner (bye)" : "Winner";
  }
  // A bye keeps its place in the bracket, so every match sits beside the one it feeds, as on the printed sheet.
  function byeBox(m, opts) {
    var who = m.winnerId && m.winnerId !== "BYE" ? esc(opts && opts.full ? P[m.winnerId].name : short(m.winnerId)) : S.event === "groups" ? "Best group winner" : "";
    return "<div class=\"bk-box bye\"><div class=\"bk-ln\"><span>" + who + "</span><span></span><span class=\"g\">bye</span></div></div>";
  }
  function bracketBox(m, fs, opts) {
    var g = glow("m:" + m.id);
    var hs = m.players[0] && m.players[1] ? eqHead(m.players[0], m.players[1]) : null;
    var nameOf = opts && opts.full ? function (id) { return P[id].name; } : short;
    var lines = m.players.map(function (id, i) {
      if (!id || id === "BYE") return "<div class=\"bk-ln tbd\"><span>" + slotLabel(m, i) + "</span><span></span><span></span></div>";
      var state = m.status === "done" ? (m.winnerId === id ? " won" : " lost") : "";
      var games = m.status === "done" && m.result.games ? m.result.games[i] : "";
      return "<div class=\"bk-ln" + state + "\"><span>" + esc(nameOf(id)) + "</span><span>" + (hs && hs.lowerId === id && m.status !== "done" ? hsTile(hs.headStart) : "") + "</span><span class=\"g\">" + games + "</span></div>";
    }).join("");
    return "<div class=\"bk-box" + (m.status === "ready" ? " ready" : "") + g.cls + "\"" + g.attr + ">" + lines + "</div>";
  }
  function bracket(matches, names, small, opts) {
    var rounds = {};
    matches.forEach(function (m) { if (m.status !== "skipped") (rounds[m.round] = rounds[m.round] || []).push(m); });
    var keys = Object.keys(rounds).map(Number).sort(function (a, b) { return a - b; });
    var tallest = Math.max.apply(null, keys.map(function (k) { return rounds[k].length; }).concat([1]));
    var fs = Math.max(16, Math.min(opts && opts.max ? opts.max : small ? 24 : 34, Math.floor((opts && opts.room ? opts.room : small ? 250 : 600) / (tallest * 2.7))));
    return "<div class=\"bk\" style=\"--bk-fs:" + fs + "px\">" + keys.map(function (k, i) {
      return "<div class=\"bk-col\"><h3>" + names(k, i, keys.length) + "</h3><div class=\"bk-slots\">" + rounds[k].map(function (m) { return m.status === "bye" ? byeBox(m, opts) : bracketBox(m, fs, opts); }).join("") + "</div></div>";
    }).join("") + "</div>";
  }
  function finalsNames(k, i, n) { var left = n - i; return left === 1 ? "Final" : left === 2 ? "Semifinals" : left === 3 ? "Quarterfinals" : "Round " + k; }

  // Equalizer RR -> Finals, after printing: each group's table and matches, then the Finals.
  function eqGroups(small) {
    var view = eqResolved();
    var out = eq.event.groups.map(function (group, gi) {
      var t = view.tables[gi];
      var matches = view.matches.filter(function (m) { return m.stage === "G" && m.group === group.number; });
      var next = matches.filter(function (m) { return m.status !== "done"; })[0];
      var head = "<h2>Group " + group.number + "</h2><span class=\"sub\">" + t.played + " of " + t.total + " played</span><span class=\"right\">" + (t.complete ? "<b>Decided</b>" : "Round <b>" + next.round + "</b> of " + matches[matches.length - 1].round) + "</span>";
      var rows = t.rows.map(function (r, i) {
        var lead = t.complete && i === 0;
        return "<tr" + (lead ? " class=\"lead\"" : "") + "><td class=\"pos\">" + (t.played ? i + 1 : "–") + "</td><td class=\"nm\">" + esc(P[r.id].name) + (lead ? " → Finals" : "") + "</td><td class=\"col-rating\">" + P[r.id].rating + "</td><td>" + r.wins + "–" + r.losses + "</td><td>" + r.gamesWon + "–" + r.gamesLost + "</td></tr>";
      }).join("");
      var table = "<table class=\"st\" style=\"--st-h:" + (small ? 34 : 56) + "px\"><colgroup><col style=\"width:44px\"><col><col class=\"col-rating\" style=\"width:" + (small ? 70 : 96) + "px\"><col style=\"width:" + (small ? 60 : 80) + "px\"><col style=\"width:" + (small ? 64 : 90) + "px\"></colgroup><thead><tr><th></th><th>Player</th><th class=\"col-rating\">Rating</th><th>W–L</th><th>Games</th></tr></thead><tbody>" + rows + "</tbody></table>";
      var list = small ? "" : "<ol class=\"mlist\">" + matches.map(function (m) { return mline(m, "R" + m.round); }).join("") + "</ol>";
      var foot = small ? "" : "<p class=\"p-foot to-finals\">" + (t.complete ? "<b>" + esc(P[t.winnerId].name) + "</b> goes to the Finals" : "<b>Winner → Finals</b> · single elimination, on its own sheet") + "</p>";
      return panel("g" + group.number, head, table + list + foot);
    });
    var finals = view.matches.filter(function (m) { return m.stage === "W"; });
    var decided = view.tables.filter(function (t) { return t.complete; }).length;
    var fhead = "<h2>Road to the Finals</h2><span class=\"sub\">single elimination</span><span class=\"right\"><b>" + decided + "</b> of " + view.tables.length + " decided</span>";
    var road = "<ol class=\"road\">" + view.tables.map(function (t) {
      var row = t.complete ? t.rows[0] : null;
      var g = glow("w:" + t.number);
      return "<li class=\"" + (t.complete ? "in" : "") + g.cls + "\"" + g.attr + "><span class=\"gnum\">" + t.number + "</span><span class=\"nm\">" + (t.complete ? esc(P[t.winnerId].name) : "Still playing") + "</span><span class=\"rec\">" + (t.complete ? row.wins + "–" + row.losses : t.played + " of " + t.total) + "</span></li>";
    }).join("") + "</ol>";
    var byes = eq.event.bracket.byes;
    var rounds = Math.log(eq.event.bracket.size) / Math.LN2;
    var path = ["Final", "Semifinals", "Quarterfinals"].slice(0, rounds).reverse().join(" → ");
    var how = "<div class=\"how\"><h3>How the Finals work</h3><ul>" +
      "<li><b>Single elimination:</b> lose once and you're out</li>" +
      "<li><b>" + view.tables.length + " group winners</b> · " + path + "</li>" +
      (byes ? "<li><b>" + (byes === 1 ? "1 bye" : byes + " byes") + "</b> to the group winners with the best share of games won</li>" : "") +
      "<li><b>Starts when every group is decided</b>, on its own printed sheet</li></ul></div>";
    out.push(panel("finals", fhead, "<div class=\"road-wrap" + (small ? " small" : "") + "\">" + road + how + "</div>"));
    return out;
  }

  // Equalizer Double Elimination, after printing: up next, the two brackets and who's still in it.
  function eqDouble(small) {
    var view = eqResolved();
    var ready = E.callOrder(view).slice(0, small ? 4 : 6);
    var recent = eq.done.slice(-(small ? 3 : 4)).reverse().map(function (id) { return view.byId[id]; });
    var label = function (m) { return m.stage === "W" ? "M" + m.round : m.stage === "L" ? "T" + m.round : "F"; };
    var nhead = "<h2>Matches</h2><span class=\"sub\">M = Main Draw · T = Survivor Trail</span><span class=\"right\"><b>" + ready.length + "</b> ready</span>";
    var nbody = "<ol class=\"mlist\">" + ready.map(function (m) { return mline(m, label(m)); }).join("") + recent.map(function (m) { return mline(m, label(m)); }).join("") + "</ol>";
    var main = view.matches.filter(function (m) { return m.stage === "W"; });
    var trail = view.matches.filter(function (m) { return m.stage === "L"; });
    var last = function (list) { return Math.max.apply(null, list.map(function (m) { return m.round; })); };
    var mainLast = last(main);
    var trailLast = last(trail);
    var groups = { main: [], trail: [], out: [] };
    eq.event.sides.forEach(function (s) {
      var st = view.status[s.id];
      (st === "trail" ? groups.trail : st === "out" ? groups.out : groups.main).push(s.id);
    });
    Object.keys(groups).forEach(function (k) { groups[k].sort(byRating); });
    var finalMatch = view.matches.filter(function (m) { return m.stage === "F" && m.status !== "skipped"; });
    var fstate = view.champion ? "Champion <b>" + esc(P[view.champion].name) + "</b>" : finalMatch.length && finalMatch[0].players[0] && finalMatch[0].players[1] ? "Final: <b>" + esc(short(finalMatch[0].players[0])) + "</b> v <b>" + esc(short(finalMatch[0].players[1])) + "</b>" : "Final to come";
    var col = function (title, ids, cls) { return "<div class=\"" + cls + "\"><h3>" + title + " · " + ids.length + "</h3><ul>" + ids.map(function (id) { return "<li>" + esc(P[id].name) + "</li>"; }).join("") + "</ul></div>"; };
    return [
      panel("next", nhead, nbody),
      panel("main", "<h2>Main Draw</h2><span class=\"sub\">everyone starts here</span>", bracket(main, function (k) { return k === mainLast ? "Main final" : "Round " + k; }, small)),
      panel("trail", "<h2>Survivor Trail</h2><span class=\"sub\">one loss so far</span>", bracket(trail, function (k) { return k === trailLast ? "Trail final" : "Trail " + k; }, small)),
      panel("field", "<h2>Still in it</h2><span class=\"right\">" + fstate + "</span>", "<div class=\"status-cols\">" + col("Unbeaten", groups.main, "main") + col("Survivor Trail", groups.trail, "trail") + col("Out", groups.out, "out") + "</div>")
    ];
  }

  function finalsMode() {
    return S.event === "groups" && S.stage === "printed" && !!eq.event && eqResolved().tables.every(function (t) { return t.complete; });
  }
  function finalsScreen() {
    var view = eqResolved();
    var finals = view.matches.filter(function (m) { return m.stage === "W"; });
    var champ = view.champion;
    var byeWinners = finals.filter(function (m) { return m.status === "bye"; }).map(function (m) { return m.winnerId; });
    var left = view.matches.filter(function (m) { return m.stage === "W" && m.status !== "done" && m.status !== "bye"; }).length;
    var head = "<h2>Finals</h2><span class=\"sub\">single elimination · best of " + eq.event.settings.finalsBestOf + " · lose and you're out</span><span class=\"right\">" + (champ ? "Champion <b>" + esc(P[champ].name) + "</b>" : "<b>" + left + "</b> match" + (left === 1 ? "" : "es") + " to go") + "</span>";
    var big = panel("finals", head, bracket(finals, finalsNames, false, { full: true, room: 640, max: 40 })).html;
    var rows = view.tables.map(function (t) {
      var r = t.rows[0];
      return "<li class=\"in\"><span class=\"gnum\">" + t.number + "</span><span class=\"nm\">" + esc(P[t.winnerId].name) + "</span><span class=\"rec\">" + r.wins + "–" + r.losses + " · " + r.gamesWon + "–" + r.gamesLost + "</span>" + (byeWinners.indexOf(t.winnerId) >= 0 ? "<span class=\"chip bye\">Bye</span>" : "<span></span>") + "</li>";
    }).join("");
    var side = panel("from", "<h2>From the groups</h2><span class=\"right\">group winners</span>", "<ol class=\"road from\">" + rows + "</ol>" +
      (champ ? "<div class=\"champ\"><span>Equalizer champion</span><strong>" + esc(P[champ].name) + "</strong></div>" : "<p class=\"p-foot\">Byes go to the group winners with the best share of games won. Everyone else's afternoon is done: thanks for playing!</p>")).html;
    return "<div class=\"finals-screen\">" + big + side + "</div>";
  }

  function panels(small) {
    if (S.event === "rr") return S.stage === "signin" ? rrSignin() : rrPrinted(small);
    if (S.stage === "signin") return eqSignin(small);
    return S.event === "groups" ? eqGroups(small) : eqDouble(small);
  }

  // The A–Z list beside the spotlight.
  function indexEntries() {
    if (S.event === "rr") {
      var groups = S.stage === "signin" ? rr.groups : rr.printed;
      return rr.roster.filter(function (id) { return groupOf(groups, id) >= 0; }).sort(byName).map(function (id) {
        var gi = groupOf(groups, id);
        var where = "";
        if (S.stage === "printed") { var t = rrTable(gi).tally[id]; where = t.wins + "–" + t.losses; }
        return { id: id, where: where, group: gi + 1, hot: !!pushedUp(id) };
      });
    }
    if (S.stage === "signin") return eq.roster.slice().sort(byName).map(function (id) { return { id: id, where: S.rating ? String(P[id].rating) : "" }; });
    var view = eqResolved();
    var results = E.playerResults(eq.event, view);
    return eq.roster.slice().sort(byName).map(function (id) {
      var st = view.status[id];
      var r = results[id];
      var wl = r.wins + "–" + r.losses;
      var where;
      if (S.event === "groups") {
        var g = eq.event.groups.filter(function (gr) { return gr.sides.indexOf(id) >= 0; })[0];
        where = st === "champion" ? "Champion" : st === "finals" ? "Finals · " + wl : st === "out" && view.places[id] && view.places[id].round ? "Finals out · " + wl : "Group " + g.number + " · " + wl;
      } else where = st === "champion" ? "Champion" : st === "main" ? "Unbeaten · " + wl : st === "trail" ? "Trail · " + wl : "Out · " + wl;
      return { id: id, where: where, hot: st === "champion" || st === "finals" };
    });
  }
  // Up to 32 names fit in two readable columns; a bigger night shows half the alphabet at a time, turning with the slides.
  var INDEX_PAGE = 26;
  function indexCols(n) { return n <= 18 ? 1 : 2; }
  function indexHTML() {
    var all = indexEntries();
    var pages = all.length > 32 ? Math.ceil(all.length / INDEX_PAGE) : 1;
    var page = pages > 1 ? spot.i % pages : 0;
    var per = Math.ceil(all.length / pages);
    var list = all.slice(page * per, page * per + per);
    var cols = indexCols(list.length);
    var rows = Math.max(8, Math.ceil(list.length / cols));
    var fs = Math.max(20, Math.min(S.stage === "printed" ? 29 : 34, Math.floor((800 - 96) / rows * 0.62)));
    var title = S.event === "rr" ? "Find your group" : S.stage === "signin" ? "Signed in" : "Find your name";
    var note = S.event === "rr" && pages === 1 ? "<span class=\"gnum\">3</span> = Group 3" : "";
    return "<aside class=\"index\"><header class=\"p-head\"><h2>" + title + "</h2><span class=\"sub\">" + (pages > 1 ? "<b class=\"letters\">" + P[list[0].id].name.charAt(0) + "–" + P[list[list.length - 1].id].name.charAt(0) + "</b> " : "") + note + "</span><span class=\"right\"><b>" + all.length + "</b> players" + (pages > 1 ? " · " + (page + 1) + "/" + pages : "") + "</span></header><ul class=\"idx\" style=\"--idx-cols:" + cols + ";--idx-rows:" + rows + ";--idx-fs:" + fs + "px\">" + list.map(function (e) {
      var g = glow("p:" + e.id);
      return "<li class=\"" + g.cls.trim() + "\"" + g.attr.replace(/ data-why="[^"]*"/, "") + "><span class=\"nm\">" + esc(P[e.id].name) + "</span><span class=\"where" + (e.hot ? " hot" : "") + "\">" + (e.group ? "<span class=\"gnum\" title=\"Group " + e.group + "\">" + e.group + "</span>" : "") + esc(e.where) + "</span>" + payBox(e.id) + "</li>";
    }).join("") + "</ul></aside>";
  }

  // ---- The board frame ----
  var board = document.getElementById("board");
  var lastCount = null;
  function topHTML() {
    var title = S.event === "rr" ? "Round Robin" : "The Equalizer";
    var sub = "Concord Table Tennis Club · Saturday, Oct 31";
    var stage;
    var live = S.stage === "printed";
    if (S.event === "rr") stage = live ? "Sheets printed · live scores" : "Signing in · groups can still change";
    else if (!live) stage = "Signing in · the draw comes when sheets print";
    else {
      var view = eqResolved();
      stage = view.champion ? "Finished · " + esc(P[view.champion].name) + " wins" : S.event === "groups" && view.tables.every(function (t) { return t.complete; }) ? "Finals · single elimination" : S.event === "groups" ? "Group stage · winners go to the Finals" : "Draw set · live scores";
    }
    var count;
    var label;
    if (live) {
      var done = 0;
      var total = 0;
      if (S.event === "rr") { total = rr.matches.length; done = Object.keys(rr.results).length; }
      else { var v = eqResolved(); v.matches.forEach(function (m) { if (m.status === "bye" || m.status === "skipped") return; total += 1; if (m.status === "done") done += 1; }); }
      count = done;
      label = "of " + total + "<br>matches played";
    } else {
      count = S.event === "rr" ? rr.roster.length : eq.roster.length;
      label = "players<br>signed in";
    }
    var flipping = lastCount !== null && lastCount !== count ? " flipping" : "";
    lastCount = count;
    return "<div class=\"b-brand\"><span class=\"b-mark\" aria-hidden=\"true\"></span><div class=\"b-title\"><strong>" + title + "</strong><span>" + sub + "</span></div></div>" +
      "<div class=\"b-stage" + (live ? " live" : "") + "\"><span class=\"dot\"></span>" + stage + "</div>" +
      "<div class=\"b-count\">" + "<span class=\"num" + flipping + "\">" + count + "</span>" + "<span>" + label + "</span><span class=\"b-clock\" id=\"b-clock\">" + clock() + "</span></div>";
  }
  function clock() { var d = new Date(); var h = d.getHours() % 12 || 12; return h + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function footHTML() {
    var items = log.slice(0, 3).map(function (e) { return "<span class=\"item\"><span class=\"when\">" + ago(e.t) + "</span><span>" + e.html + "</span></span>"; }).join("");
    var legend = "<div class=\"legend\"><span class=\"pay-key\"><span class=\"pay paid\">✓</span>payment recorded</span><span class=\"pay-key\"><span class=\"pay\">✓</span>not yet: see the desk</span>" + (S.event === "rr" ? "<span><span class=\"push won\">" + TROPHY + "</span>won their group last time</span><span><span class=\"push moved\">▲</span>moved up</span>" : "") + "</div>";
    return "<div class=\"ticker\">" + (items || "<span class=\"idle\">Watching the desk…</span>") + "</div>" + legend;
  }

  var parts = null;
  function buildFrame() {
    board.innerHTML = "<header class=\"b-top\"></header><div class=\"b-body\"></div><footer class=\"b-foot\"></footer>";
    parts = { top: board.querySelector(".b-top"), body: board.querySelector(".b-body"), foot: board.querySelector(".b-foot") };
  }

  // ---- Layout A: carousel, two panels at a time ----
  var car = { start: 0, timer: null, sliding: false, pending: false, want: null };
  function carouselBuild() {
    parts.body.innerHTML = "<div class=\"carousel\"><div class=\"viewport\"><div class=\"track\"></div><div class=\"timer\"><i></i></div></div><div class=\"pips\"></div></div>";
    car.start = 0;
    car.sliding = false;
    carouselFill();
    carouselSchedule();
  }
  function carouselFill() {
    if (car.sliding) { car.pending = true; return; }
    var track = parts.body.querySelector(".track");
    var list = panels(false);
    var n = list.length;
    car.start = ((car.start % n) + n) % n;
    var show = n <= 2 ? list : [list[car.start], list[(car.start + 1) % n], list[(car.start + 2) % n]];
    track.classList.remove("sliding");
    track.style.transform = "none";
    track.innerHTML = show.map(function (p) { return p.html; }).join("");
    var on = n <= 2 ? [0, 1] : [car.start, (car.start + 1) % n];
    var groupPanels = list.filter(function (p) { return /^g\d/.test(p.key); }).length;
    var showing = on.map(function (i) { return list[i]; }).filter(function (p) { return /^g\d/.test(p.key); }).map(function (p) { return p.key.slice(1); });
    var where = groupPanels > 2 && showing.length ? "<span class=\"pip-label\">Group" + (showing.length > 1 ? "s " + showing.join(" & ") : " " + showing[0]) + " of " + groupPanels + "</span>" : "";
    parts.body.querySelector(".pips").innerHTML = where + list.map(function (p, i) { return "<span class=\"pip" + (on.indexOf(i) >= 0 ? " on" : "") + "\" title=\"" + p.key + "\"></span>"; }).join("");
  }
  function carouselSchedule() {
    clearTimeout(car.timer);
    var bar = parts.body.querySelector(".timer i");
    if (!bar) return;
    var n = panels(false).length;
    parts.body.querySelector(".timer").hidden = n <= 2;
    if (n <= 2) return;
    bar.style.transition = "none";
    bar.style.transform = "scaleX(1)";
    void bar.offsetWidth;
    bar.style.transition = "transform " + S.secs + "s linear";
    bar.style.transform = "scaleX(0)";
    car.timer = setTimeout(carouselAdvance, S.secs * 1000);
  }
  function carouselAdvance() {
    var track = parts.body.querySelector(".track");
    if (!track || panels(false).length <= 2) return;
    clearTimeout(car.timer);
    car.sliding = true;
    track.classList.add("sliding");
    track.style.transform = "translateX(calc(-50% - 20px))";
    setTimeout(function () {
      if (S.concept !== "carousel" || !parts.body.querySelector(".track")) return;
      car.sliding = false;
      car.start += 1;
      car.pending = false;
      carouselFill();
      if (car.want != null) { var k = car.want; car.want = null; carouselShow(k); return; }
      carouselSchedule();
    }, 1150);
  }
  // Bring a changed panel in from the right, unless it is already on screen.
  function carouselShow(key) {
    var list = panels(false);
    var n = list.length;
    var k = list.map(function (p) { return p.key; }).indexOf(key);
    if (k < 0 || n <= 2) return;
    if (k === car.start % n || k === (car.start + 1) % n) return;
    if (car.sliding) { car.want = key; return; }
    car.start = k - 2;
    carouselFill();
    requestAnimationFrame(function () { requestAnimationFrame(carouselAdvance); });
  }

  // ---- Layout B: wall, every panel at once ----
  function wallFill() {
    var list = panels(true);
    var n = list.length;
    var cols = n <= 2 ? n : n <= 4 ? 2 : Math.ceil(n / 2);
    if (n === 4 && S.stage === "printed") cols = 2;
    var rows = Math.ceil(n / cols);
    parts.body.innerHTML = "<div class=\"wall" + (cols >= 4 ? " many" : "") + "\" style=\"grid-template-columns:repeat(" + cols + ",minmax(0,1fr));grid-template-rows:repeat(" + rows + ",minmax(0,1fr))\">" + list.map(function (p) { return p.html; }).join("") + "</div>";
  }

  // ---- Layout C: spotlight + A–Z names ----
  var spot = { i: 0, timer: null };
  function spotBuild() {
    parts.body.innerHTML = "<div class=\"spot\"><div class=\"spot-main\"><div class=\"spot-stage\"></div><div class=\"pips\"></div><div class=\"timer\"><i></i></div></div><div class=\"spot-index\"></div></div>";
    spot.i = 0;
    spotFill(false);
    spotSchedule();
  }
  function spotFill(animate) {
    var list = panels(false);
    spot.i = ((spot.i % list.length) + list.length) % list.length;
    var stage = parts.body.querySelector(".spot-stage");
    var current = list[spot.i].html.replace("class=\"panel\"", "class=\"panel" + (animate ? " enter" : "") + "\"");
    if (animate && stage.firstElementChild) {
      var old = stage.lastElementChild;
      old.classList.remove("enter");
      old.classList.add("leave");
      stage.insertAdjacentHTML("beforeend", current);
      setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 700);
    } else stage.innerHTML = current;
    parts.body.querySelector(".pips").innerHTML = list.map(function (p, i) { return "<span class=\"pip" + (i === spot.i ? " on" : "") + "\"></span>"; }).join("");
    var index = parts.body.querySelector(".spot-index");
    index.outerHTML = "<div class=\"spot-index\" style=\"display:grid;min-height:0\">" + indexHTML() + "</div>";
  }
  function spotSchedule() {
    clearTimeout(spot.timer);
    var bar = parts.body.querySelector(".spot-main .timer i");
    if (!bar) return;
    bar.style.transition = "none";
    bar.style.transform = "scaleX(1)";
    void bar.offsetWidth;
    bar.style.transition = "transform " + S.secs + "s linear";
    bar.style.transform = "scaleX(0)";
    spot.timer = setTimeout(function () { if (finalsMode() || !parts.body.querySelector(".spot-stage")) return; spot.i += 1; spotFill(true); spotSchedule(); }, S.secs * 1000);
  }
  function spotShow(key) {
    var keys = panels(false).map(function (p) { return p.key; });
    var k = keys.indexOf(key);
    if (k < 0 || k === spot.i) return;
    spot.i = k;
    spotFill(true);
    spotSchedule();
  }

  // ---- Render ----
  function render(focus) {
    board.dataset.look = S.look;
    board.classList.toggle("no-pay", !S.pay);
    board.classList.toggle("no-rating", !S.rating);
    parts.top.innerHTML = topHTML();
    parts.foot.innerHTML = footHTML();
    if (finalsMode()) {
      clearTimeout(car.timer);
      clearTimeout(spot.timer);
      car.sliding = false;
      parts.body.innerHTML = finalsScreen();
    } else if (!parts.body.querySelector(".carousel, .wall, .spot")) layoutBuild();
    else if (S.concept === "carousel") { carouselFill(); if (focus) carouselShow(focus); }
    else if (S.concept === "wall") wallFill();
    else { var stage = parts.body.querySelector(".spot-stage"); if (focus && panels(false).some(function (p) { return p.key === focus; })) spotShow(focus); else if (stage) spotFill(false); }
    syncControls();
  }
  function rebuild() {
    clearTimeout(car.timer);
    clearTimeout(spot.timer);
    car.sliding = false;
    car.want = null;
    parts.body.innerHTML = "";
    if (!finalsMode()) layoutBuild();
    render();
  }
  function layoutBuild() {
    if (S.concept === "carousel") carouselBuild();
    else if (S.concept === "wall") wallFill();
    else spotBuild();
  }

  // ---- Desk actions ----
  var note = document.getElementById("desk-note");
  function roster() { return S.event === "rr" ? rr.roster : eq.roster; }
  function canSignin() { return S.stage === "signin" && (S.event === "rr" ? rr.late.length > 0 : eq.late.length > 0 && eq.roster.length < 24); }
  function canMove() { return S.event === "rr" && S.stage === "signin"; }
  function canPay() { return roster().some(function (id) { return !P[id].paid; }); }
  function canFinishGroups() { return S.event === "groups" && S.stage === "printed" && !!eq.event && !finalsMode(); }
  function canResult() {
    if (S.stage !== "printed") return false;
    if (S.event === "rr") return rr.matches.some(function (m) { return !rr.results[m.id]; });
    return E.callOrder(eqResolved()).length > 0;
  }
  var actions = {
    signin: function () {
      var id;
      if (S.event === "rr") {
        id = rr.late.shift();
        rr.roster.push(id);
        organize();
        var gi = groupOf(rr.groups, id);
        mark("p:" + id);
        say("<b>" + esc(P[id].name) + "</b> signed in · Group " + (gi + 1));
        note.textContent = P[id].name + " signed in. The board shows them in Group " + (gi + 1) + " right away.";
        return "g" + (gi + 1);
      }
      id = eq.late.shift();
      eq.roster.push(id);
      mark("p:" + id);
      say("<b>" + esc(P[id].name) + "</b> signed in · " + eq.roster.length + " players");
      note.textContent = P[id].name + " signed in to the Equalizer.";
      var at = eq.roster.slice().sort(byName).indexOf(id);
      return "f" + Math.floor(at / (S.concept === "wall" ? 8 : 7));
    },
    move: function () {
      var candidates = rr.roster.filter(function (id) { return !P[id].promo; });
      var id = pick(candidates);
      var now = groupOf(rr.groups, id);
      var dir = now === 0 ? 1 : now === rr.groups.length - 1 ? -1 : (rand() < 0.5 ? -1 : 1);
      rr.pins[id] = now + dir;
      organize();
      var gi = groupOf(rr.groups, id);
      mark("p:" + id);
      say("<b>" + esc(P[id].name) + "</b> moved " + (dir < 0 ? "up" : "down") + " to Group " + (gi + 1));
      note.textContent = "Moved " + P[id].name + " to Group " + (gi + 1) + " (the desk's ↑ ↓ buttons).";
      return "g" + (gi + 1);
    },
    pay: function () {
      var id = pick(roster().filter(function (x) { return !P[x].paid; }));
      P[id].paid = true;
      mark("pay:" + id);
      note.textContent = "Recorded a payment for " + P[id].name + ". The board shows a green check, never how they paid, and the ticker doesn't announce it.";
      return null;
    },
    groups: function () {
      while (!finalsMode()) eqPlay(true);
      eqResolved().tables.forEach(function (t) { mark("w:" + t.number); });
      say("All groups decided: <b>the Finals are set</b>");
      note.textContent = "Played out the group stage. The board switches to the Finals screen on its own.";
      return null;
    },
    result: function () {
      if (S.event === "rr") {
        var open = rr.matches.filter(function (m) { return !rr.results[m.id]; });
        var round = Math.min.apply(null, open.map(function (m) { return m.round; }));
        var m = pick(open.filter(function (x) { return x.round === round; }));
        var r = rrScore(m);
        rr.results[m.id] = r;
        mark("m:" + m.id);
        var w = r.a > r.b ? m.a : m.b;
        var l = w === m.a ? m.b : m.a;
        var t = rrTable(m.g);
        say(t.complete ? "Group " + (m.g + 1) + " decided: <b>" + esc(P[t.order[0]].name) + "</b> wins the group" : "Group " + (m.g + 1) + ": <b>" + esc(P[w].name) + "</b> beat <b>" + esc(P[l].name) + "</b> " + Math.max(r.a, r.b) + "–" + Math.min(r.a, r.b));
        note.textContent = "Entered " + P[w].name + " over " + P[l].name + " with the desk's balls.";
        return "g" + (m.g + 1);
      }
      var got = eqPlay(false);
      if (!got) return null;
      mark("m:" + got.id);
      say(got.news);
      note.textContent = "Entered a result. Head starts on the board come from the club's real Equalizer rules.";
      return got.panel;
    }
  };
  function run(name) {
    var focus = actions[name]();
    render(focus);
  }

  // ---- Controls ----
  function syncControls() {
    document.querySelectorAll(".seg[data-set]").forEach(function (seg) {
      var key = seg.getAttribute("data-set");
      seg.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-value") === S[key])); });
    });
    document.getElementById("size-control").hidden = S.event !== "rr";
    document.getElementById("do-signin").disabled = !canSignin();
    document.getElementById("do-signin").title = S.stage === "printed" ? "Sign-in closes when the sheets print in this concept" : "";
    document.getElementById("do-move").disabled = !canMove();
    document.getElementById("do-move").title = S.event !== "rr" ? "The Equalizer draw is random: no moves" : "";
    document.getElementById("do-pay").disabled = !canPay();
    document.getElementById("do-result").disabled = !canResult();
    document.getElementById("do-groups").hidden = S.event !== "groups";
    document.getElementById("do-groups").disabled = !canFinishGroups();
    document.getElementById("do-result").title = S.stage === "signin" ? "Switch Stage to Sheets printed" : "";
  }
  function setStage(stage) {
    S.stage = stage;
    if (stage === "printed") { if (S.event === "rr") printRR(); else printEQ(); }
  }
  document.querySelectorAll(".seg[data-set]").forEach(function (seg) {
    seg.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-value]");
      if (!button) return;
      var key = seg.getAttribute("data-set");
      var value = button.getAttribute("data-value");
      if (S[key] === value) return;
      S[key] = value;
      if (key === "size") { rr.pins = {}; organize(); }
      if (key === "event" || key === "stage" || (key === "size" && S.stage === "printed")) setStage(S.stage);
      lastCount = null;
      if (key === "look") render(); else rebuild();
    });
  });
  var secs = document.getElementById("secs");
  secs.addEventListener("input", function () {
    S.secs = Number(secs.value);
    document.getElementById("secs-out").textContent = S.secs + "s";
    if (S.concept === "carousel" && !car.sliding) carouselSchedule();
    if (S.concept === "spot") spotSchedule();
  });
  document.getElementById("show-pay").addEventListener("change", function (e) { S.pay = e.target.checked; render(); });
  document.getElementById("show-rating").addEventListener("change", function (e) { S.rating = e.target.checked; render(); });
  document.getElementById("do-signin").addEventListener("click", function () { if (canSignin()) run("signin"); });
  document.getElementById("do-move").addEventListener("click", function () { if (canMove()) run("move"); });
  document.getElementById("do-pay").addEventListener("click", function () { if (canPay()) run("pay"); });
  document.getElementById("do-result").addEventListener("click", function () { if (canResult()) run("result"); });
  document.getElementById("do-groups").addEventListener("click", function () { if (canFinishGroups()) run("groups"); });
  var auto = null;
  var autoButton = document.getElementById("do-auto");
  autoButton.addEventListener("click", function () {
    if (auto) { clearInterval(auto); auto = null; autoButton.setAttribute("aria-pressed", "false"); autoButton.textContent = "Auto-play the desk"; return; }
    autoButton.setAttribute("aria-pressed", "true");
    autoButton.textContent = "Stop auto-play";
    var step = function () {
      var options = [];
      if (canSignin()) options.push("signin", "signin");
      if (canMove()) options.push("move");
      if (canPay()) options.push("pay");
      if (canResult()) options.push("result", "result", "result");
      if (!options.length) { autoButton.click(); note.textContent = "Nothing left for the desk to do. Switch stage or event to keep going."; return; }
      run(pick(options));
    };
    step();
    auto = setInterval(step, 4500);
  });

  // ---- The TV: scale the 1920 x 1080 board to the screen; full screen on request ----
  var screen = document.getElementById("tv-screen");
  function fit() {
    var scale = Math.min(screen.clientWidth / 1920, screen.clientHeight / 1080);
    board.style.transform = "scale(" + scale + ")";
    board.style.left = Math.max(0, (screen.clientWidth - 1920 * scale) / 2) + "px";
    board.style.top = Math.max(0, (screen.clientHeight - 1080 * scale) / 2) + "px";
  }
  if (window.ResizeObserver) new ResizeObserver(fit).observe(screen);
  window.addEventListener("resize", fit);
  var lock = null;
  document.getElementById("fullscreen").addEventListener("click", function () {
    var frame = document.getElementById("tv-frame");
    if (!frame.requestFullscreen) { note.textContent = "Full screen isn't available in this view."; return; }
    frame.requestFullscreen().then(function () {
      if (navigator.wakeLock) navigator.wakeLock.request("screen").then(function (l) { lock = l; }).catch(function () {});
    }).catch(function () { note.textContent = "Full screen isn't available in this view."; });
  });
  document.addEventListener("fullscreenchange", function () { fit(); if (!document.fullscreenElement && lock) { lock.release().catch(function () {}); lock = null; } });

  // Ticker times and the clock stay current; glows fade on their own.
  setInterval(function () {
    var c = document.getElementById("b-clock");
    if (c) c.textContent = clock();
    if (parts) parts.foot.innerHTML = footHTML();
  }, 20000);

  buildFrame();
  rebuild();
  fit();
}());
