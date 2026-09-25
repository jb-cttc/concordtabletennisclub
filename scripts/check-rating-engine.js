const assert = require('node:assert/strict');
const ratings = require('../rating-engine');

const cases = [
  [-238, 50], [-237, 45], [-213, 45], [-212, 40], [-188, 40],
  [-187, 35], [-163, 35], [-162, 30], [-138, 30], [-137, 25],
  [-113, 25], [-112, 20], [-88, 20], [-87, 16], [-63, 16],
  [-62, 13], [-38, 13], [-37, 10], [-13, 10], [-12, 8],
  [12, 8], [13, 7], [37, 7], [38, 6], [62, 6], [63, 5],
  [87, 5], [88, 4], [112, 4], [113, 3], [137, 3], [138, 2],
  [187, 2], [188, 1], [237, 1], [238, 0]
];

cases.forEach(function (testCase) {
  const difference = testCase[0];
  const expected = testCase[1];
  assert.equal(ratings.adjustment(1200 + difference, 1200, false), expected);
});

assert.equal(ratings.adjustment(1000, 2000, true), 0);
assert.equal(ratings.adjustment(null, 1200, false), null);
assert.equal(ratings.adjustment(1200, undefined, false), null);
assert.equal(ratings.project(1200, -25), 1175);
assert.equal(ratings.project(0, -8), 0);
assert.equal(ratings.project(null, 8), null);

console.log('Rating engine checks passed:', cases.length + 6);