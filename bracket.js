// The Equalizer's double-elimination bracket, shared by the site and (through npm run sync:desk, once the desk build
// starts) the desk. Only the draw (who sits in which seed) and the results are ever saved; everything here is worked
// out from them, so two devices that each enter different results merge match by match, as round robins do.
//
// Main Draw ("W"): standard bracket positions for the next power of two, byes on the seeds past the field.
// Survivor Trail ("L"): a first loss drops a player here; a second ends their day. Drop-ins are crossed over (reversed,
// then halves swapped, alternately) so nobody meets the player they just lost to.
// Final ("F"): Main Draw winner against Survivor Trail winner; with a replay, a Trail winner who wins it forces one more.
(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CTTCBracket = api;
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var BYE = "BYE";
  var MIN_FIELD = 4;
  var MAX_FIELD = 24;
  var DEFAULTS = { bestOf: 3, finalsBestOf: 5, replay: true, replayBestOf: 3 };

  // Bracket positions so seed 1 and 2 can only meet in the final: [1, 4, 2, 3] for 4.
  function seedOrder(size) {
    var order = [1];
    while (order.length < size) {
      var next = [];
      var total = order.length * 2 + 1;
      order.forEach(function (seed) { next.push(seed, total - seed); });
      order = next;
    }
    return order;
  }

  // The random draw: a shuffle of the entrants (rng returns 0 <= x < 1, so a saved seed replays the same draw).
  function draw(ids, rng) {
    var random = rng || Math.random;
    var list = ids.map(String);
    for (var i = list.length - 1; i > 0; i -= 1) {
      var j = Math.floor(random() * (i + 1));
      var swap = list[i];
      list[i] = list[j];
      list[j] = swap;
    }
    return list;
  }

  // entrants: player ids in seed order (seed 1 first), usually from draw().
  function build(entrants, options) {
    var settings = Object.assign({}, DEFAULTS, options || {});
    var field = entrants.map(String);
    if (field.length < MIN_FIELD) throw new Error("The Equalizer needs at least " + MIN_FIELD + " players.");
    if (new Set(field).size !== field.length) throw new Error("A player is entered twice.");
    var size = 1;
    var rounds = 0;
    while (size < field.length) { size *= 2; rounds += 1; }
    var matches = [];
    function add(bracket, round, index, sources) {
      var match = { id: (bracket === "F" ? (round === 1 ? "GF" : "GF2") : bracket + round + "-" + (index + 1)), bracket: bracket, round: round, index: index, sources: sources };
      matches.push(match);
      return match;
    }
    var order = seedOrder(size);
    var main = [];
    for (var r = 1; r <= rounds; r += 1) {
      var count = size / Math.pow(2, r);
      main[r] = [];
      for (var i = 0; i < count; i += 1) {
        main[r].push(add("W", r, i, r === 1
          ? [{ seed: order[2 * i] }, { seed: order[2 * i + 1] }]
          : [{ winner: main[r - 1][2 * i].id }, { winner: main[r - 1][2 * i + 1].id }]));
      }
    }
    var trail = [];
    var trailRound = 1;
    trail[1] = [];
    for (var a = 0; a < size / 4; a += 1) {
      trail[1].push(add("L", 1, a, [{ loser: main[1][2 * a].id }, { loser: main[1][2 * a + 1].id }]));
    }
    for (var w = 2; w <= rounds; w += 1) {
      var dropRound = trailRound + 1;
      var drops = main[w].length;
      trail[dropRound] = [];
      for (var d = 0; d < drops; d += 1) {
        var crossed = drops === 1 ? d : (w % 2 === 0 ? drops - 1 - d : (d + drops / 2) % drops);
        trail[dropRound].push(add("L", dropRound, d, [{ winner: trail[trailRound][d].id }, { loser: main[w][crossed].id }]));
      }
      trailRound = dropRound;
      if (w < rounds) {
        trailRound += 1;
        trail[trailRound] = [];
        for (var c = 0; c < drops / 2; c += 1) {
          trail[trailRound].push(add("L", trailRound, c, [{ winner: trail[dropRound][2 * c].id }, { winner: trail[dropRound][2 * c + 1].id }]));
        }
      }
    }
    var mainFinal = main[rounds][0];
    var trailFinal = trail[trailRound][0];
    add("F", 1, 0, [{ winner: mainFinal.id }, { winner: trailFinal.id }]);
    if (settings.replay) add("F", 2, 0, [{ winner: mainFinal.id }, { winner: trailFinal.id }]);
    matches.forEach(function (match) {
      match.bestOf = match.id === "GF2" ? settings.replayBestOf
        : (match.id === mainFinal.id || match.id === trailFinal.id || match.id === "GF") ? settings.finalsBestOf : settings.bestOf;
    });
    var byId = {};
    matches.forEach(function (match) { byId[match.id] = match; });
    // How early each match can be played: one more than the latest match feeding it. A bye costs nothing.
    function wave(match) {
      if (match.wave !== undefined) return match.wave;
      match.wave = 1 + Math.max.apply(null, match.sources.map(function (source) {
        return source.seed ? 0 : wave(byId[source.winner || source.loser]);
      }));
      return match.wave;
    }
    matches.forEach(wave);
    return {
      entrants: field,
      size: size,
      rounds: rounds,
      trailRounds: trailRound,
      mainFinal: mainFinal.id,
      trailFinal: trailFinal.id,
      settings: settings,
      matches: matches
    };
  }

  // results: { matchId: { winnerId, games: [first, second], forfeitedBy } }. Returns every match with its players,
  // status (bye, waiting, ready, done, skipped), winner and loser, plus places, the champion and whether it is over.
  function resolve(structure, results) {
    var given = results || {};
    var byId = {};
    var out = {};
    structure.matches.forEach(function (match) { byId[match.id] = match; });
    function occupant(source) {
      if (source.seed) return structure.entrants[source.seed - 1] || BYE;
      var from = state(byId[source.winner || source.loser]);
      return source.winner ? from.winnerId : from.loserId;
    }
    function state(match) {
      if (out[match.id]) return out[match.id];
      var players = match.sources.map(occupant);
      var entry = { id: match.id, bracket: match.bracket, round: match.round, index: match.index, bestOf: match.bestOf, wave: match.wave, players: players, status: "waiting", winnerId: null, loserId: null, result: null };
      out[match.id] = entry;
      if (match.id === "GF2") {
        var first = state(byId.GF);
        if (first.status === "done" && first.winnerId === first.players[0]) {
          entry.status = "skipped";
          return entry;
        }
        if (first.status !== "done") return entry;
      }
      if (players[0] === BYE || players[1] === BYE) {
        entry.status = "bye";
        entry.winnerId = players[0] === BYE ? players[1] : players[0];
        entry.loserId = BYE;
        return entry;
      }
      if (!players[0] || !players[1]) return entry;
      var result = given[match.id];
      if (!result || !result.winnerId) { entry.status = "ready"; return entry; }
      var winner = String(result.winnerId);
      if (winner !== players[0] && winner !== players[1]) { entry.status = "ready"; return entry; }
      entry.status = "done";
      entry.result = result;
      entry.winnerId = winner;
      entry.loserId = winner === players[0] ? players[1] : players[0];
      return entry;
    }
    var list = structure.matches.map(state);

    // Places are fixed by the draw: everyone knocked out in one Survivor Trail round shares a place, after everyone
    // knocked out later. The champion and runner-up come from the Final.
    var realByRound = {};
    list.forEach(function (entry) {
      if (entry.bracket === "L" && entry.status !== "bye") realByRound[entry.round] = (realByRound[entry.round] || 0) + 1;
    });
    var places = {};
    var later = 2;
    for (var round = structure.trailRounds; round >= 1; round -= 1) {
      var shared = realByRound[round] || 0;
      list.forEach(function (entry) {
        if (entry.bracket === "L" && entry.round === round && entry.status === "done") {
          places[entry.loserId] = { place: later + 1, to: later + shared, round: round };
        }
      });
      later += shared;
    }
    var gf = out.GF;
    var gf2 = out.GF2;
    var deciding = gf2 && gf2.status === "done" ? gf2 : gf && gf.status === "done" && (!gf2 || gf2.status === "skipped") ? gf : null;
    var champion = deciding ? deciding.winnerId : null;
    if (deciding) {
      places[deciding.winnerId] = { place: 1, to: 1 };
      places[deciding.loserId] = { place: 2, to: 2 };
    }
    // Lives: 2 until a first loss, 1 on the Survivor Trail, 0 when out.
    var losses = {};
    structure.entrants.forEach(function (id) { losses[id] = 0; });
    list.forEach(function (entry) {
      if (entry.status === "done" && entry.loserId !== BYE) losses[entry.loserId] += 1;
    });
    var lives = {};
    structure.entrants.forEach(function (id) { lives[id] = places[id] && places[id].place > 1 ? 0 : Math.max(0, 2 - losses[id]); });
    return {
      matches: list,
      byId: out,
      places: places,
      lives: lives,
      champion: champion,
      finished: !!champion
    };
  }

  // Ready matches in the order to call them to tables: earliest wave first, Main Draw before the Trail.
  function callOrder(resolved, busy) {
    var playing = busy || {};
    return resolved.matches.filter(function (entry) {
      return entry.status === "ready" && !playing[entry.id] &&
        !Object.keys(playing).some(function (id) { return playing[id].some(function (player) { return entry.players.indexOf(player) >= 0; }); });
    }).sort(function (left, right) {
      return left.wave - right.wave || (left.bracket === right.bracket ? 0 : left.bracket === "W" ? -1 : 1) || left.index - right.index;
    });
  }

  // A rough finish time, in minutes from the start: every match takes its average, tables are filled in call order,
  // and the higher seed always wins (the length of the day hardly depends on who wins, except for a replay).
  function estimate(structure, options) {
    var settings = Object.assign({ tables: 12, minutes: { 3: 15, 5: 22 }, replayPlayed: false }, options || {});
    var results = {};
    var clock = 0;
    var running = {};
    var free = settings.tables;
    var played = 0;
    for (var guard = 0; guard < 500; guard += 1) {
      var resolved = resolve(structure, results);
      if (resolved.finished) break;
      var busy = {};
      Object.keys(running).forEach(function (id) { busy[id] = running[id].players; });
      callOrder(resolved, busy).forEach(function (entry) {
        if (free <= 0) return;
        if (Object.keys(running).some(function (id) { return running[id].players.some(function (p) { return entry.players.indexOf(p) >= 0; }); })) return;
        running[entry.id] = { players: entry.players, ends: clock + (settings.minutes[entry.bestOf] || 15) };
        free -= 1;
      });
      var ids = Object.keys(running);
      if (!ids.length) break;
      var next = ids.reduce(function (best, id) { return running[id].ends < running[best].ends ? id : best; }, ids[0]);
      clock = running[next].ends;
      var match = resolved.byId[next];
      var winner = next === "GF" && settings.replayPlayed ? match.players[1] : match.players[0];
      results[next] = { winnerId: winner };
      delete running[next];
      free += 1;
      played += 1;
    }
    return { minutes: clock, matches: played };
  }

  return {
    BYE: BYE,
    MIN_FIELD: MIN_FIELD,
    MAX_FIELD: MAX_FIELD,
    seedOrder: seedOrder,
    draw: draw,
    build: build,
    resolve: resolve,
    callOrder: callOrder,
    estimate: estimate
  };
}));
