(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CTTCStandings = api;
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function sortByGroupResult(players) {
    return players.slice().sort(function (left, right) {
      var leftPlayed = left.wins !== null && left.losses !== null ? left.wins + left.losses : 0;
      var rightPlayed = right.wins !== null && right.losses !== null ? right.wins + right.losses : 0;
      if (leftPlayed && rightPlayed) {
        var recordDifference = right.wins * leftPlayed - left.wins * rightPlayed;
        if (recordDifference) return recordDifference;
        if (Number.isFinite(left.ratingBefore) && Number.isFinite(right.ratingBefore)) {
          return left.ratingBefore - right.ratingBefore || left.name.localeCompare(right.name);
        }
      } else if (leftPlayed || rightPlayed) {
        return leftPlayed ? -1 : 1;
      }
      if (left.ratingAfter === null && right.ratingAfter === null) return 0;
      if (left.ratingAfter === null) return 1;
      if (right.ratingAfter === null) return -1;
      return right.ratingAfter - left.ratingAfter;
    });
  }

  return { sortByGroupResult: sortByGroupResult };
}));