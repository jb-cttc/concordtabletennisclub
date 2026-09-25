var RATING_RULE_VERSION = 'cttc-access-v1';

function ratingAdjustment_(winnerRating, loserRating, isForfeit) {
  if (isForfeit) return 0;
  if (!Number.isFinite(winnerRating) || !Number.isFinite(loserRating)) {
    throw new Error('Both players need a numeric session-start rating.');
  }
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

function projectedRating_(startingRating, netAdjustment) {
  return Math.max(0, startingRating + netAdjustment);
}

function testRatingEngine() {
  var boundaries = [
    [-238, 50], [-237, 45], [-213, 45], [-212, 40], [-188, 40], [-187, 35],
    [-163, 35], [-162, 30], [-138, 30], [-137, 25], [-113, 25], [-112, 20],
    [-88, 20], [-87, 16], [-63, 16], [-62, 13], [-38, 13], [-37, 10],
    [-13, 10], [-12, 8], [12, 8], [13, 7], [37, 7], [38, 6], [62, 6],
    [63, 5], [87, 5], [88, 4], [112, 4], [113, 3], [137, 3], [138, 2],
    [187, 2], [188, 1], [237, 1], [238, 0]
  ];
  boundaries.forEach(function (testCase) {
    var actual = ratingAdjustment_(1200 + testCase[0], 1200, false);
    if (actual !== testCase[1]) throw new Error('Rating boundary failed at ' + testCase[0]);
  });
  if (ratingAdjustment_(500, 1500, true) !== 0) throw new Error('Forfeit rule failed.');
  if (projectedRating_(0, -8) !== 0) throw new Error('Zero floor failed.');
  return { passed: boundaries.length + 2, ruleVersion: RATING_RULE_VERSION };
}
