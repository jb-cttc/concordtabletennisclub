(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CTTCStandings = api;
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function sortByGroupResult(players) {
    // Step 1: Calculate USATT Match Points for all players
    var playersWithPoints = players.map(function (player) {
      var matchPoints = 0;
      if (player.wins !== null && player.losses !== null) {
        matchPoints = (player.wins * 2) + (player.losses * 1);
      }
      return {
        player: player,
        matchPoints: matchPoints
      };
    });

    // Step 2: Sort by Match Points descending, then resolve ties within each group
    var sorted = playersWithPoints.slice().sort(function (a, b) {
      if (b.matchPoints !== a.matchPoints) {
        return b.matchPoints - a.matchPoints;
      }
      // Same match points - need to resolve tie
      return 0; // Placeholder, will be handled below
    });

   // Step 3: Identify and resolve tie groups
    var result = [];
    var i = 0;
    while (i < sorted.length) {
      var j = i + 1;
      var currentPoints = sorted[i].matchPoints;
      
      // Find all players with the same match points
      while (j < sorted.length && sorted[j].matchPoints === currentPoints) {
        j++;
      }

      var tieGroup = sorted.slice(i, j).map(function (item) {
        return item.player;
      });

      if (tieGroup.length === 1) {
        // No tie, add directly
        result.push(tieGroup[0]);
      } else if (tieGroup.length === 2) {
        // Logic 2: Two-player tie
        var resolved = resolveTwoPlayerTie(tieGroup[0], tieGroup[1]);
        result.push(resolved[0]);
        result.push(resolved[1]);
      } else {
        // Logic 3: Multi-player tie (3+)
        var resolvedMulti = resolveMultiPlayerTie(tieGroup);
        result = result.concat(resolvedMulti);
      }

      i = j;
    }

    return result;
  }

  function resolveTwoPlayerTie(player1, player2) {
    // Find head-to-head match
    var h2hMatch1 = findMatch(player1.matches, player2.name);
    var h2hMatch2 = findMatch(player2.matches, player1.name);

    if (h2hMatch1 && h2hMatch2) {
      var player1GamesWon = h2hMatch1.gamesWon || 0;
      var player2GamesWon = h2hMatch2.gamesWon || 0;

      // Check if match was played (not 0-0 double forfeit)
      if (player1GamesWon > 0 || player2GamesWon > 0) {
        // Match was played - winner ranks higher
        if (player1GamesWon > player2GamesWon) {
          return [player1, player2];
        } else {
          return [player2, player1];
        }
      }
    }
    // Double forfeit or no match data - rank by lower rating
    var rating1 = Number.isFinite(player1.ratingBefore) ? player1.ratingBefore : Infinity;
    var rating2 = Number.isFinite(player2.ratingBefore) ? player2.ratingBefore : Infinity;

    if (rating1 < rating2) {
      return [player1, player2];
    } else if (rating2 < rating1) {
      return [player2, player1];
    } else {
      // Same rating, use alphabetical
      if (player1.name.localeCompare(player2.name) < 0) {
        return [player1, player2];
      } else {
        return [player2, player1];
      }
    }
  }

  function resolveMultiPlayerTie(tiedPlayers) {
    // Logic 3: Multi-way tie resolution using USATT Game Ratio
    
    // Calculate game ratio only among tied players
    var playersWithRatio = tiedPlayers.map(function (player) {
      var gamesWon = 0;
      var gamesLost = 0;

      // Only count games against other tied players
      (player.matches || []).forEach(function (match) {
        var opponentIsInTie = tiedPlayers.some(function (tiedPlayer) {
          return tiedPlayer.name === match.opponent;
        });

        if (opponentIsInTie) {
          gamesWon += match.gamesWon || 0;
          gamesLost += match.gamesLost || 0;
        }
      });

      var ratio = gamesLost === 0 ? (gamesWon > 0 ? Infinity : 0) : gamesWon / gamesLost;

      return {
        player: player,
        gamesWon: gamesWon,
        gamesLost: gamesLost,
        ratio: ratio
      };
    });

    // Sort by ratio descending, then by lower rating
    playersWithRatio.sort(function (a, b) {
      if (b.ratio !== a.ratio) {
        // Higher ratio ranks higher
        // Handle Infinity: Infinity > any finite number
        if (a.ratio === Infinity && b.ratio === Infinity) return 0;
        if (a.ratio === Infinity) return -1;
        if (b.ratio === Infinity) return 1;
        return b.ratio - a.ratio;
      }

      // Same ratio - rank by lower initial rating
      var ratingA = Number.isFinite(a.player.ratingBefore) ? a.player.ratingBefore : Infinity;
      var ratingB = Number.isFinite(b.player.ratingBefore) ? b.player.ratingBefore : Infinity;

      if (ratingA !== ratingB) {
        return ratingA - ratingB;
      }

      // Same rating - alphabetical
      return a.player.name.localeCompare(b.player.name);
    });

    return playersWithRatio.map(function (item) {
      return item.player;
    });
  }

  function findMatch(matches, opponentName) {
    if (!matches || !Array.isArray(matches)) {
      return null;
    }

    for (var i = 0; i < matches.length; i++) {
      if (matches[i].opponent === opponentName) {
        return matches[i];
      }
    }

    return null;
  }

  return { sortByGroupResult: sortByGroupResult };
}));

    




  
//#  function sortByGroupResult(players) {
//#    return players.slice().sort(function (left, right) {
//#      var leftPlayed = left.wins !== null && left.losses !== null ? left.wins + left.losses : 0;
//#      var rightPlayed = right.wins !== null && right.losses !== null ? right.wins + right.losses : 0;
//#      if (leftPlayed && rightPlayed) {
//#        var recordDifference = right.wins * leftPlayed - left.wins * rightPlayed;
//#        if (recordDifference) return recordDifference;
//#        if (Number.isFinite(left.ratingBefore) && Number.isFinite(right.ratingBefore)) {
//#          return left.ratingBefore - right.ratingBefore || left.name.localeCompare(right.name);
//#        }
//#      } else if (leftPlayed || rightPlayed) {
//#        return leftPlayed ? -1 : 1;
//#      }
//#      if (left.ratingAfter === null && right.ratingAfter === null) return 0;
//#      if (left.ratingAfter === null) return 1;
//#      if (right.ratingAfter === null) return -1;
//#      return right.ratingAfter - left.ratingAfter;
//#    });
//#  }

//#  return { sortByGroupResult: sortByGroupResult };
//#}));
