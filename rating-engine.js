(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CTTCRatings = api;
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function adjustment(winnerRating, loserRating, isForfeit) {
    if (isForfeit) return 0;
    if (!Number.isFinite(winnerRating) || !Number.isFinite(loserRating)) return null;

    var difference = winnerRating - loserRating;
    if (difference <= -238) return 50;
    if (difference <= -213) return 45;
    if (difference <= -188) return 40;
    if (difference <= -163) return 35;
    if (difference <= -138) return 30;
    if (difference <= -113) return 25;
    if (difference <= -88) return 20;
    if (difference <= -63) return 16;
    if (difference <= -38) return 13;
    if (difference <= -13) return 10;
    if (difference <= 12) return 8;
    if (difference <= 37) return 7;
    if (difference <= 62) return 6;
    if (difference <= 87) return 5;
    if (difference <= 112) return 4;
    if (difference <= 137) return 3;
    if (difference <= 187) return 2;
    if (difference <= 237) return 1;
    return 0;
  }

  function project(startingRating, netAdjustment) {
    if (!Number.isFinite(startingRating) || !Number.isFinite(netAdjustment)) return null;
    return Math.max(0, startingRating + netAdjustment);
  }

  return {
    adjustment: adjustment,
    project: project
  };
}));