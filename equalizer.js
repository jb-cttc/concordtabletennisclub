// An Equalizer event, shared by the site and (through npm run sync:desk, once the desk build starts) the desk.
// It puts the shared pieces together rather than adding rules of its own:
// - handicap.js: head starts, memory, the rating exchange;
// - bracket.js: the Double Elimination bracket, or the single-elimination Finals;
// - round-robin.js: the desk's group sizes and match order, for the RR -> Finals group stage;
// - standings.js: the club's round robin group ranking (match points, head-to-head, games ratio, then rating).
//
// Formats: "double" (Double Elimination) or "groups" (round robin groups of 4, or 3 when the numbers need it; each
// group winner goes into a single-elimination Finals, the best group winners getting any byes). Play: "singles", or
// "doubles", where the players are paired at random and a team's rating is the average of its players' ratings,
// rounded to a whole point (as handicap doubles leagues do). Each player on a team gains or gives the full 8.
// An odd number in doubles is the organizer's call: someone sits out, someone fills in before the draw (an even
// number again), or one team has three players who rotate game by game (see teamOfThreeOrder).
// Only the draw (teams, groups, bracket order) and the results are saved; everything else is worked out here.
(function (root, factory) {
  "use strict";

  var node = typeof module === "object" && module.exports;
  var api = factory(
    node ? require("./handicap") : root.CTTCHandicap,
    node ? require("./bracket") : root.CTTCBracket,
    node ? require("./round-robin") : root.CTTCRoundRobin,
    node ? require("./standings") : root.CTTCStandings
  );
  if (node) module.exports = api;
  if (root) root.CTTCEqualizer = api;
}(typeof window !== "undefined" ? window : globalThis, function (H, B, RR, S) {
  "use strict";

  var GROUP_SIZE = 4;
  var MAX_PLAYERS = 24;
  var DEFAULTS = { bestOf: 3, finalsBestOf: 5, replay: true, replayBestOf: 3, groupBestOf: 3 };

  // The fewest players each format can run with: Double Elimination needs 4 sides, RR -> Finals 6 (two groups).
  function minimumPlayers(format, play) {
    var sides = format === "groups" ? 6 : B.MIN_FIELD;
    return play === "doubles" ? sides * 2 : sides;
  }

  function teamId(members) { return members.slice().sort().join("+"); }

  // A team's rating: the average of its players' ratings, rounded to a whole point.
  function teamRating(members, ratings) {
    return Math.round(members.reduce(function (sum, id) { return sum + ratings[id]; }, 0) / members.length);
  }

  // Who plays each game for a team of three: the team picks the first pair, then the player who sat out comes in for
  // the one who has been on longest (A B, then B C, then C A, ...), so nobody sits out twice in a row. The club's own
  // rule: table tennis rules assume a doubles pair is fixed for the whole match.
  function teamOfThreeOrder(firstPair, members, games) {
    var resting = members.filter(function (id) { return firstPair.indexOf(id) < 0; })[0];
    var on = firstPair.slice();
    var order = [];
    for (var game = 0; game < games; game += 1) {
      order.push(on.slice());
      var leaving = on.shift();
      on.push(resting);
      resting = leaving;
    }
    return order;
  }

  // players: [{ id, rating }]; rng: the saved draw's random numbers. Returns the event: its sides (players, or teams
  // of two), the groups and the bracket.
  function create(setup, rng) {
    var format = setup.format === "groups" ? "groups" : "double";
    var play = setup.play === "doubles" ? "doubles" : "singles";
    // RR -> Finals is short enough to play best of 5 throughout, like a round robin; Double Elimination needs best of 3
    // until the finals to finish by 6:00.
    var settings = Object.assign({}, DEFAULTS, format === "groups" ? { groupBestOf: 5, bestOf: 5, finalsBestOf: 5 } : {}, setup.options || {});
    var players = setup.players.map(function (p) { return { id: String(p.id), rating: Number(p.rating) }; });
    if (players.length > MAX_PLAYERS) throw new Error("The Equalizer takes at most " + MAX_PLAYERS + " players.");
    if (players.length < minimumPlayers(format, play)) throw new Error("This format needs at least " + minimumPlayers(format, play) + " players.");
    var ratings = {};
    players.forEach(function (p) { ratings[p.id] = p.rating; });

    // Doubles: a random pairing. With an odd number the organizer has chosen (setup.oddPlayer): "sit-out" leaves out
    // setup.sitOutId (a volunteer) or else the last player drawn; "team-of-three" puts the last player drawn into a
    // team drawn at random.
    var order = B.draw(players.map(function (p) { return p.id; }), rng);
    var sitOut = [];
    var sides = [];
    if (play === "doubles") {
      var extra = null;
      if (order.length % 2) {
        var odd = setup.oddPlayer === "team-of-three" ? "team-of-three" : "sit-out";
        if (odd === "sit-out" && setup.sitOutId && order.indexOf(String(setup.sitOutId)) >= 0) {
          order.splice(order.indexOf(String(setup.sitOutId)), 1);
          sitOut.push(String(setup.sitOutId));
        } else if (odd === "sit-out") sitOut.push(order.pop());
        else extra = order.pop();
      }
      var teams = [];
      for (var i = 0; i < order.length; i += 2) teams.push([order[i], order[i + 1]]);
      if (extra) teams[Math.floor(rng() * teams.length)].push(extra);
      teams.forEach(function (members) {
        sides.push({ id: teamId(members), members: members, rating: teamRating(members, ratings) });
      });
    } else {
      sides = order.map(function (id) { return { id: id, members: [id], rating: ratings[id] }; });
    }
    var sideRatings = {};
    var sideById = {};
    sides.forEach(function (side) { sideRatings[side.id] = side.rating; sideById[side.id] = side; });

    var groups = [];
    var bracket;
    if (format === "groups") {
      var drawn = B.draw(sides.map(function (s) { return s.id; }), rng);
      var at = 0;
      RR.sizeGroups(drawn.length, GROUP_SIZE).forEach(function (size, index) {
        var members = drawn.slice(at, at + size);
        at += size;
        var number = index + 1;
        var matches = [];
        RR.roundRobinRounds(members).forEach(function (pairs, round) {
          pairs.forEach(function (pair) {
            matches.push({ id: "G" + number + "-" + (matches.length + 1), group: number, round: round + 1, players: pair, bestOf: settings.groupBestOf });
          });
        });
        groups.push({ number: number, sides: members, matches: matches });
      });
      // The Finals: one slot per group winner. Any byes go to the best group winners (finalsRank); the rest are placed
      // at random, drawn now so the draw is saved with the event. The Finals start once every group is decided.
      var slots = groups.map(function (g, n) { return "finals-" + (n + 1); });
      bracket = B.build(slots, { elimination: "single", bestOf: settings.bestOf, finalsBestOf: settings.finalsBestOf });
      var byes = bracket.size - groups.length;
      var rest = [];
      for (var seed = byes + 1; seed <= groups.length; seed += 1) rest.push(seed);
      bracket.finalsDraw = B.draw(rest.map(String), rng).map(Number);
      bracket.byes = byes;
    } else {
      bracket = B.build(sides.map(function (s) { return s.id; }), settings);
    }
    return { format: format, play: play, settings: settings, ratings: ratings, sides: sides, sideById: sideById, sideRatings: sideRatings, sitOut: sitOut, groups: groups, bracket: bracket };
  }

  // Group winners, best first, for Finals byes: the best share of games won in their group (fair to groups of 3 and
  // 4), then fewer games lost, then the lower rating, as the club's round robin tie-break does.
  function finalsRank(event, tables) {
    return tables.map(function (t) {
      var row = t.rows.filter(function (r) { return r.id === t.winnerId; })[0];
      var played = row.gamesWon + row.gamesLost;
      return { id: t.winnerId, ratio: played ? row.gamesWon / played : 0, lost: row.gamesLost, rating: event.sideRatings[t.winnerId] };
    }).sort(function (a, b) {
      return b.ratio - a.ratio || a.lost - b.lost || a.rating - b.rating || (a.id < b.id ? -1 : 1);
    }).map(function (entry) { return entry.id; });
  }

  // A group's table from its results, ranked by the club's round robin rules (standings.js).
  function groupTable(event, group, results) {
    var rows = {};
    group.sides.forEach(function (id) { rows[id] = { name: id, ratingBefore: event.sideRatings[id], matches: [] }; });
    var played = 0;
    group.matches.forEach(function (match) {
      var result = results[match.id];
      if (!result || !result.winnerId) return;
      played += 1;
      var games = result.games || [match.players[0] === result.winnerId ? 1 : 0, match.players[1] === result.winnerId ? 1 : 0];
      var forfeitedBy = result.forfeitedBy || "";
      rows[match.players[0]].matches.push({ opponent: match.players[1], gamesWon: forfeitedBy ? 0 : games[0], gamesLost: forfeitedBy ? 0 : games[1], forfeitedBy: forfeitedBy });
      rows[match.players[1]].matches.push({ opponent: match.players[0], gamesWon: forfeitedBy ? 0 : games[1], gamesLost: forfeitedBy ? 0 : games[0], forfeitedBy: forfeitedBy });
    });
    var complete = played === group.matches.length;
    var ranked = group.sides.map(function (id) { return rows[id]; });
    var order = S.sortByGroupResult(ranked).map(function (row) { return row.name; });
    // The club's tie-break note, naming sides by id (a page puts names in).
    var described = complete ? S.describeWinner(ranked) : null;
    var tally = order.map(function (id) {
      var t = { id: id, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0 };
      rows[id].matches.forEach(function (m) {
        t.gamesWon += m.gamesWon;
        t.gamesLost += m.gamesLost;
        var won = m.forfeitedBy ? m.forfeitedBy !== id : m.gamesWon > m.gamesLost;
        if (won) t.wins += 1; else t.losses += 1;
      });
      return t;
    });
    return { number: group.number, complete: complete, played: played, total: group.matches.length, order: order, rows: tally, winnerId: complete ? order[0] : null, note: described ? described.text : "" };
  }

  // results: { matchId: { winnerId, games, forfeitedBy } } for group and bracket matches alike.
  function resolve(event, results) {
    var given = results || {};
    var tables = event.groups.map(function (group) { return groupTable(event, group, given); });
    var groupMatches = [];
    event.groups.forEach(function (group) {
      group.matches.forEach(function (match) {
        var result = given[match.id];
        var done = result && result.winnerId && match.players.indexOf(String(result.winnerId)) >= 0;
        groupMatches.push({ id: match.id, stage: "G", bracket: "G", group: match.group, round: match.round, index: 0, wave: match.round, bestOf: match.bestOf, players: match.players.slice(), status: done ? "done" : "ready", winnerId: done ? String(result.winnerId) : null, loserId: done ? (match.players[0] === String(result.winnerId) ? match.players[1] : match.players[0]) : null, result: done ? result : null });
      });
    });
    var structure = event.bracket;
    if (event.format === "groups") {
      var entrants = event.bracket.entrants.map(function () { return null; });
      if (tables.every(function (t) { return t.complete; })) {
        var ranked = finalsRank(event, tables);
        var byes = event.bracket.byes;
        for (var b = 0; b < byes; b += 1) entrants[b] = ranked[b];
        event.bracket.finalsDraw.forEach(function (seed, n) { entrants[seed - 1] = ranked[byes + n]; });
      }
      structure = Object.assign({}, event.bracket, { entrants: entrants });
    }
    var view = B.resolve(structure, given);
    var groupWaves = event.groups.length ? Math.max.apply(null, event.groups.map(function (g) { return g.matches[g.matches.length - 1].round; })) : 0;
    var bracketMatches = view.matches.map(function (m) { return Object.assign({}, m, { stage: m.bracket, wave: m.wave + groupWaves }); });
    var matches = groupMatches.concat(bracketMatches);
    var byId = {};
    matches.forEach(function (m) { byId[m.id] = m; });

    // Places: the bracket's, then (RR -> Finals) everyone else by where they finished in their group.
    var places = Object.assign({}, view.places);
    var status = {};
    if (event.format === "groups") {
      var knockoutSize = event.groups.length;
      for (var position = 2; position <= GROUP_SIZE; position += 1) {
        var withPosition = event.groups.filter(function (g) { return g.sides.length >= position; }).length;
        var from = knockoutSize + 1;
        for (var p = 2; p < position; p += 1) from += event.groups.filter(function (g) { return g.sides.length >= p; }).length;
        tables.forEach(function (t) {
          if (t.complete && t.order[position - 1]) places[t.order[position - 1]] = { place: from, to: from + withPosition - 1, group: t.number, position: position };
        });
      }
    }
    event.sides.forEach(function (side) {
      var id = side.id;
      if (view.champion === id) status[id] = "champion";
      else if (places[id]) status[id] = "out";
      else if (event.format === "groups") {
        var table = tables.filter(function (t) { return t.order.indexOf(id) >= 0; })[0];
        status[id] = table && table.complete ? "finals" : "groups";
      } else status[id] = view.lives[id] === 1 ? "trail" : "main";
    });
    return { matches: matches, byId: byId, tables: tables, places: places, status: status, champion: view.champion, finished: view.finished };
  }

  // Matches ready to call to a table, in order: the group stage round by round, then the bracket's earliest wave,
  // Main Draw before the Survivor Trail. Sides already on a table (busy: { matchId: [sideIds] }) are left out.
  function callOrder(resolved, busy) {
    var playing = busy || {};
    var taken = {};
    Object.keys(playing).forEach(function (id) { playing[id].forEach(function (side) { taken[side] = true; }); });
    var rank = { G: 0, W: 1, L: 2, F: 3 };
    return resolved.matches.filter(function (m) {
      return m.status === "ready" && !playing[m.id] && !taken[m.players[0]] && !taken[m.players[1]];
    }).sort(function (a, b) {
      return a.wave - b.wave || rank[a.bracket] - rank[b.bracket] || (a.group || 0) - (b.group || 0) || a.index - b.index;
    });
  }

  // The head start for a match between two sides (players, or teams by their average rating).
  function headStart(event, sideA, sideB, history, resets) {
    return H.pairState(sideA, sideB, event.sideRatings, history || [], resets || []);
  }

  // Each player's afternoon: wins, losses and rating change. In doubles both partners share each result.
  function playerResults(event, resolved) {
    var points = H.exchange(false);
    var out = {};
    event.sides.forEach(function (side) {
      side.members.forEach(function (id) { out[id] = { id: id, sideId: side.id, wins: 0, losses: 0, change: 0, place: resolved.places[side.id] || null }; });
    });
    resolved.matches.forEach(function (m) {
      if (m.status !== "done") return;
      var forfeit = !!(m.result && m.result.forfeitedBy);
      var exchange = forfeit ? H.exchange(true) : points;
      event.sideById[m.winnerId].members.forEach(function (id) { out[id].wins += 1; out[id].change += exchange; });
      event.sideById[m.loserId].members.forEach(function (id) { out[id].losses += 1; out[id].change -= exchange; });
    });
    Object.keys(out).forEach(function (id) {
      var after = Math.max(0, event.ratings[id] + out[id].change);
      out[id].change = after - event.ratings[id];
      out[id].after = after;
    });
    return out;
  }

  // A rough finish time in minutes from the start: tables filled in call order, every match its average length, the
  // first-listed side always winning (the length of the day hardly depends on who wins, except for a replay).
  function estimate(event, options) {
    var settings = Object.assign({ tables: 12, minutes: { 3: 15, 5: 22 }, replayPlayed: false }, options || {});
    var results = {};
    var running = {};
    var clock = 0;
    var played = 0;
    for (var guard = 0; guard < 600; guard += 1) {
      var view = resolve(event, results);
      if (view.finished) break;
      var busy = {};
      Object.keys(running).forEach(function (id) { busy[id] = running[id].players; });
      callOrder(view, busy).forEach(function (m) {
        if (Object.keys(running).length >= settings.tables) return;
        var inUse = {};
        Object.keys(running).forEach(function (id) { running[id].players.forEach(function (s) { inUse[s] = true; }); });
        if (inUse[m.players[0]] || inUse[m.players[1]]) return;
        running[m.id] = { players: m.players, ends: clock + (settings.minutes[m.bestOf] || 15) };
      });
      var ids = Object.keys(running);
      if (!ids.length) break;
      var next = ids.reduce(function (best, id) { return running[id].ends < running[best].ends ? id : best; }, ids[0]);
      clock = running[next].ends;
      var match = view.byId[next];
      results[next] = { winnerId: next === "GF" && settings.replayPlayed ? match.players[1] : match.players[0], games: [1, 0] };
      delete running[next];
      played += 1;
    }
    return { minutes: clock, matches: played };
  }

  return {
    GROUP_SIZE: GROUP_SIZE,
    MAX_PLAYERS: MAX_PLAYERS,
    minimumPlayers: minimumPlayers,
    teamId: teamId,
    teamRating: teamRating,
    teamOfThreeOrder: teamOfThreeOrder,
    finalsRank: finalsRank,
    create: create,
    resolve: resolve,
    callOrder: callOrder,
    headStart: headStart,
    playerResults: playerResults,
    estimate: estimate
  };
}));
