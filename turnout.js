// Who to expect at the next round robin, by rating: shared by the site's Tonight page (tonight.html) and the public turnout
// app (turnout-app/, which keeps an identical copy as Turnout.js because Apps Script cannot load files from the site).
// Pure functions only: callers bring the Pacific clock, the published roster history and the people they know about.
(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CTTCTurnout = api;
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  // The floor's rating zones. The bottom of each range is in it and the top is not: 800 plays in 800-999.
  var BRACKETS = [
    { min: 0, max: 600, label: "Under 600" },
    { min: 600, max: 800, label: "600–799" },
    { min: 800, max: 1000, label: "800–999" },
    { min: 1000, max: 1200, label: "1000–1199" },
    { min: 1200, max: 1400, label: "1200–1399" },
    { min: 1400, max: 1600, label: "1400–1599" },
    { min: 1600, max: null, label: "1600+" }
  ];

  // Round robin nights (Monday, Wednesday) and their clock, Pacific: sign-up closes at 7:15 PM, the gym at 10 PM.
  var RR_DAYS = [1, 3];
  var SIGNUP_CLOSES = 19 * 60 + 15;
  var NIGHT_ENDS = 22 * 60;

  // A player is "likely" when likelihood() reaches this. The score is calibrated on the club's own history: of the
  // players it gave 0.9 or more, about 9 in 10 came (npm run turnout:backtest prints the current figures).
  var LIKELY_AT = 0.9;
  // likelihood() looks at this many recent nights of the same weekday and of the other round robin weekday. Each night
  // back counts DECAY times the one after it, and the other weekday counts OTHER_WEEKDAY as much as the same one.
  var LOOKBACK = 8;
  var DECAY = 0.9;
  var OTHER_WEEKDAY = 0.5;

  function bracketIndex(rating) {
    if (rating === null || rating === undefined || rating === "") return -1;
    var value = Number(rating);
    if (!isFinite(value)) return -1;
    for (var i = BRACKETS.length - 1; i > 0; i--) {
      if (value >= BRACKETS[i].min) return i;
    }
    return 0;
  }

  // How names are compared between the published roster, the desk and Google Voice contacts.
  function nameKey(name) {
    return String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, " ").trim();
  }

  function weekday(date) {
    return new Date(date + "T12:00:00Z").getUTCDay();
  }

  function addDays(date, days) {
    return new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
  }

  // The night the page is about, from the Pacific clock ({date: "2026-10-21", minutes: 1140}) and the site's
  // closures.json. Today while a round robin night is still open, otherwise the next one the gym is open for.
  // phase: "ahead" (a later day), "signup" (today, before sign-up closes), "underway" (today, sign-up closed).
  function sessionNight(clock, closures) {
    var days = (closures && closures.days) || {};
    for (var offset = 0; offset < 28; offset++) {
      var date = addDays(clock.date, offset);
      if (RR_DAYS.indexOf(weekday(date)) < 0 || days[date] === "full") continue;
      if (offset === 0 && clock.minutes >= NIGHT_ENDS) continue;
      var phase = offset > 0 ? "ahead" : clock.minutes < SIGNUP_CLOSES ? "signup" : "underway";
      return { date: date, phase: phase };
    }
    return null;
  }

  // Chance each recent player comes on date, from the published roster ({date: [names]}) before it. A smoothed,
  // recency-weighted share of the last LOOKBACK same-weekday nights plus, at OTHER_WEEKDAY weight, the other weekday's.
  function likelihood(roster, date) {
    var day = weekday(date);
    var other = day === 1 ? 3 : 1;
    var earlier = Object.keys(roster || {}).filter(function (d) { return d < date; }).sort().reverse();
    var same = earlier.filter(function (d) { return weekday(d) === day; }).slice(0, LOOKBACK);
    var others = earlier.filter(function (d) { return weekday(d) === other; }).slice(0, LOOKBACK);
    var nights = same.map(function (d, i) { return { date: d, weight: Math.pow(DECAY, i) }; })
      .concat(others.map(function (d, i) { return { date: d, weight: OTHER_WEEKDAY * Math.pow(DECAY, i) }; }));
    var total = nights.reduce(function (sum, night) { return sum + night.weight; }, 0);
    var came = {};
    nights.forEach(function (night) {
      var seen = {};
      (roster[night.date] || []).forEach(function (name) {
        if (seen[name]) return;
        seen[name] = true;
        came[name] = (came[name] || 0) + night.weight;
      });
    });
    var chance = {};
    Object.keys(came).forEach(function (name) {
      chance[name] = (came[name] + 1) / (total + 2);
    });
    return chance;
  }

  function likelyNames(roster, date) {
    var chance = likelihood(roster, date);
    return Object.keys(chance).filter(function (name) { return chance[name] >= LIKELY_AT; }).sort();
  }

  // people: [{key, rating, status, chance}]. status is "here" (signed in at the desk), "texted" (Google Voice today),
  // "likely" (chance of LIKELY_AT or more) or "maybe" (any other recent player, who only adds their chance to expected).
  // A person is counted once, at their firmest status. Returns counts only, per bracket, plus the people with no rating.
  // expected is the forecast: everyone playing tonight, plus each other player's chance, rounded.
  function tally(people) {
    var rank = { here: 4, texted: 3, likely: 2, maybe: 1 };
    var best = {};
    (people || []).forEach(function (person) {
      if (!person || !rank[person.status] || !person.key) return;
      var held = best[person.key];
      if (!held || rank[person.status] > rank[held.status]) best[person.key] = person;
    });
    var brackets = BRACKETS.map(function (bracket) {
      return { label: bracket.label, min: bracket.min, max: bracket.max, here: 0, texted: 0, likely: 0, expected: 0 };
    });
    var unrated = { here: 0, texted: 0 };
    Object.keys(best).forEach(function (key) {
      var person = best[key];
      var at = bracketIndex(person.rating);
      var sure = person.status === "here" || person.status === "texted";
      if (at < 0) {
        if (sure) unrated[person.status] += 1;
        return;
      }
      if (person.status !== "maybe") brackets[at][person.status] += 1;
      brackets[at].expected += sure ? 1 : Math.max(0, Math.min(1, Number(person.chance) || 0));
    });
    brackets.forEach(function (bracket) {
      bracket.expected = Math.max(bracket.here + bracket.texted + bracket.likely, Math.round(bracket.expected));
    });
    return { brackets: brackets, unrated: unrated };
  }

  // The recent players as tally() people, before anyone is known to be coming. ratingOf(name) gives a rating or null and
  // keyOf(name) the person's key (the same key the caller uses for those signed in or texting).
  function forecastPeople(roster, date, ratingOf, keyOf) {
    var chance = likelihood(roster, date);
    return Object.keys(chance).map(function (name) {
      return { key: keyOf ? keyOf(name) : nameKey(name), rating: ratingOf(name), status: chance[name] >= LIKELY_AT ? "likely" : "maybe", chance: chance[name] };
    });
  }

  return {
    BRACKETS: BRACKETS,
    LIKELY_AT: LIKELY_AT,
    SIGNUP_CLOSES: SIGNUP_CLOSES,
    NIGHT_ENDS: NIGHT_ENDS,
    bracketIndex: bracketIndex,
    nameKey: nameKey,
    weekday: weekday,
    addDays: addDays,
    sessionNight: sessionNight,
    likelihood: likelihood,
    likelyNames: likelyNames,
    forecastPeople: forecastPeople,
    tally: tally
  };
}));
