// The Equalizer's head-start rules, shared by the site and (through npm run sync:desk, once the desk build starts) the
// desk, like standings.js. Plan and decisions: https://github.com/jb-cttc/concordtabletennisclub/issues (Equalizer).
//
// - Head start: every full 40 points of rating gap gives the lower-rated player 1 point at the start of each game,
//   at most 8 (so the lower-rated player always needs at least 3 points to win a game to 11).
// - Memory: each pair keeps a reduction. A win by the lower-rated player takes 1 point off their next head start
//   against that player; a win by the higher-rated player gives 1 back, never more than the base head start.
//   It is never stored: it is replayed from the pair's finalized Equalizer matches, so a reopened session corrects it.
//   An owner reset (all pairs, or one pair) makes earlier matches no longer count.
// - Rating exchange: as if both players had the same rating, using the club's own rating engine (8 points), and a
//   forfeit moves nothing, exactly like round robins.
(function (root, factory) {
  "use strict";

  var ratings = typeof module === "object" && module.exports ? require("./rating-engine") : root && root.CTTCRatings;
  var api = factory(ratings);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CTTCHandicap = api;
}(typeof window !== "undefined" ? window : globalThis, function (ratings) {
  "use strict";

  var RULE_VERSION = "cttc-equalizer-v1";
  var POINTS_PER_STEP = 40;
  var MAX_HEAD_START = 8;

  function baseHeadStart(ratingA, ratingB) {
    if (!Number.isFinite(ratingA) || !Number.isFinite(ratingB)) return null;
    return Math.min(MAX_HEAD_START, Math.floor(Math.abs(ratingA - ratingB) / POINTS_PER_STEP));
  }

  function pairKey(idA, idB) {
    return [String(idA), String(idB)].sort().join("::");
  }

  // The lower-rated of two players, or null when their ratings are equal.
  function lowerOf(idA, ratingA, idB, ratingB) {
    if (ratingA === ratingB) return null;
    return ratingA < ratingB ? String(idA) : String(idB);
  }

  // history: earlier Equalizer matches, oldest first: { at, playerOneId, playerTwoId, winnerId, forfeit,
  // ratings: { id: rating at that event's start } }. resets: [{ at, pair }] where pair is a pairKey or "all".
  // Returns the pair's state for a match now, with ratings { id: rating } at this event's start.
  function pairState(idA, idB, nowRatings, history, resets) {
    idA = String(idA);
    idB = String(idB);
    var key = pairKey(idA, idB);
    var resetAt = (resets || []).reduce(function (latest, reset) {
      return (reset.pair === "all" || reset.pair === key) && String(reset.at) > latest ? String(reset.at) : latest;
    }, "");
    var reduction = 0;
    var memoryLower = null;
    var counted = 0;
    (history || []).forEach(function (match) {
      if (pairKey(match.playerOneId, match.playerTwoId) !== key) return;
      if (match.forfeit || !match.winnerId) return;
      if (resetAt && String(match.at) <= resetAt) return;
      var rA = Number(match.ratings[idA]);
      var rB = Number(match.ratings[idB]);
      var lower = lowerOf(idA, rA, idB, rB);
      if (lower !== memoryLower) reduction = 0;
      memoryLower = lower;
      counted += 1;
      if (lower === null) return;
      var base = baseHeadStart(rA, rB);
      reduction = String(match.winnerId) === lower ? Math.min(reduction + 1, base) : Math.max(reduction - 1, 0);
    });
    var ratingA = Number(nowRatings[idA]);
    var ratingB = Number(nowRatings[idB]);
    var lowerNow = lowerOf(idA, ratingA, idB, ratingB);
    if (lowerNow !== memoryLower) reduction = 0;
    var baseNow = baseHeadStart(ratingA, ratingB);
    reduction = Math.min(reduction, baseNow);
    return {
      lowerId: lowerNow,
      base: baseNow,
      reduction: reduction,
      headStart: baseNow - reduction,
      matchesCounted: counted
    };
  }

  // Points each way for a finished match: the club's own rating table at equal ratings, so it follows any change to it.
  function exchange(isForfeit) {
    return ratings.adjustment(1500, 1500, !!isForfeit);
  }

  return {
    RULE_VERSION: RULE_VERSION,
    POINTS_PER_STEP: POINTS_PER_STEP,
    MAX_HEAD_START: MAX_HEAD_START,
    baseHeadStart: baseHeadStart,
    pairKey: pairKey,
    pairState: pairState,
    exchange: exchange
  };
}));
