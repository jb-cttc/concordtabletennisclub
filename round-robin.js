// Round robin group sizes and match order, shared by the site and the Equalizer's group stage. These are the desk's
// own rules from apps-script/Organizer.html (sizeGroups, roundRobinPairs); scripts/check-equalizer.js checks they give
// the same answers. When the Equalizer reaches the desk, Organizer.html takes this file (npm run sync:desk) instead of
// keeping its own copy, so there is one copy.
(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CTTCRoundRobin = api;
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  // Groups of the preferred size or one smaller, as few groups as possible: 13 players in groups of 4 are 4, 3, 3, 3.
  function sizeGroups(count, preferred) {
    if (!count) return [];
    var min = Math.ceil(count / preferred);
    var max = Math.floor(count / (preferred - 1));
    var groupCount = min <= max ? min : Math.max(1, min);
    var base = Math.floor(count / groupCount);
    var larger = count % groupCount;
    var sizes = [];
    for (var i = 0; i < groupCount; i += 1) sizes.push(base + (i < larger ? 1 : 0));
    return sizes;
  }

  // The circle method, round by round: in a group of 4, two matches a round and nobody waits; a group of 3 has one
  // player resting each round.
  function roundRobinRounds(ids) {
    var rotation = ids.slice();
    var rounds = [];
    if (rotation.length % 2) rotation.push(null);
    for (var round = 0; round < rotation.length - 1; round += 1) {
      var pairs = [];
      for (var i = 0; i < rotation.length / 2; i += 1) {
        var a = rotation[i];
        var b = rotation[rotation.length - 1 - i];
        if (a && b) pairs.push(ids.indexOf(a) < ids.indexOf(b) ? [a, b] : [b, a]);
      }
      rounds.push(pairs);
      rotation = [rotation[0], rotation[rotation.length - 1]].concat(rotation.slice(1, -1));
    }
    return rounds;
  }

  function roundRobinPairs(ids) {
    return [].concat.apply([], roundRobinRounds(ids));
  }

  return {
    sizeGroups: sizeGroups,
    roundRobinRounds: roundRobinRounds,
    roundRobinPairs: roundRobinPairs
  };
}));
