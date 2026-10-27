// Clover card payments (issue #87). The club's Clover POS takes only nightly desk fees, round robin or Open Play ($5
// Junior, $10 Member, $15 Visitor), so each card payment there is one night's fee for someone (or two). The desk reads those payments with a
// read-only Clover API token and works out who each one is for, so the organizer only handles the exceptions.
//
// The token and merchant ID are Script Properties (CLOVER_API_TOKEN, CLOVER_MERCHANT_ID), never in code: the repo is
// public. Until CLOVER_ENABLED is 'true' nothing here writes: the Clover page (?view=clover) only shows what the desk
// would match, checked against the payments recorded by hand.
//
// A payment is matched only when the evidence points to exactly one player, in this order:
//   1. a card, Clover customer, phone or email already linked to one player (CloverLinks; a key that has paid for two
//      different players stops matching);
//   2. the name on the card, or on the Clover customer, is exactly one player's name or saved alias;
//   3. the same last name and a first name or initial that fits exactly one active player ("J SMITH", "Rob"/"Robert").
// The amount then has to be that player's fee, or the fees of a payer and the players a NameLinks 'pays_for' row says
// they pay for. Anything else (a wrong amount, a Zeffy pass holder, a second payment, a method already chosen by hand)
// waits for the organizer with the likely payer shown.
var CLOVER_API_ = 'https://api.clover.com';
var CLOVER_TOKEN_KEY_ = 'CLOVER_API_TOKEN';
var CLOVER_MERCHANT_KEY_ = 'CLOVER_MERCHANT_ID';
var CLOVER_ENABLED_KEY_ = 'CLOVER_ENABLED';
var CLOVER_PAGE_SIZE_ = 1000;
var CLOVER_MAX_PAGES_ = 10;
var CLOVER_CUSTOMER_LOOKUPS_ = 80;
// Clover limits how many requests a token may have open at once, and answers 429 when there are too many: requests go a
// few at a time, and a 429 is tried again after a pause.
var CLOVER_AT_ONCE_ = 3;
var CLOVER_RETRIES_ = 4;
var CLOVER_RETRY_PAUSE_MS_ = 1500;
// Clover answers at most 90 days of payments per request; the report asks for a little either side of the range.
var CLOVER_REPORT_MAX_DAYS_ = 85;
var CLOVER_FEES_ = { junior: 5, member: 10, visitor: 15 };
var CLOVER_LINK_HEADERS = ['link_key', 'player_id', 'source', 'updated_at'];
// Words Clover and the card networks put where a cardholder name would be.
var CLOVER_PLACEHOLDER_NAME_ = /\b(valued|cardholder|card holder|customer|guest|instant issue|apple pay|google pay)\b/;
var CLOVER_NAME_SUFFIXES_ = ['jr', 'sr', 'ii', 'iii', 'iv'];

function cloverConfig_() {
  var properties = PropertiesService.getScriptProperties();
  return {
    token: String(properties.getProperty(CLOVER_TOKEN_KEY_) || '').trim(),
    merchant: String(properties.getProperty(CLOVER_MERCHANT_KEY_) || '').trim(),
    enabled: properties.getProperty(CLOVER_ENABLED_KEY_) === 'true'
  };
}

// Says what is missing without ever repeating a value.
function cloverConfigProblem_(config) {
  if (!config.token && !config.merchant) return 'Add CLOVER_API_TOKEN and CLOVER_MERCHANT_ID in the script\'s Project Settings > Script Properties.';
  if (!config.token) return 'Add CLOVER_API_TOKEN in the script\'s Project Settings > Script Properties.';
  if (!config.merchant) return 'Add CLOVER_MERCHANT_ID in the script\'s Project Settings > Script Properties.';
  if (!/^[A-Za-z0-9]{6,32}$/.test(config.merchant)) return 'CLOVER_MERCHANT_ID does not look like a Clover merchant ID (letters and digits only, from the dashboard address after /m/).';
  return '';
}

function cloverRequest_(config, path, query) {
  return {
    url: CLOVER_API_ + '/v3/merchants/' + config.merchant + path + (query && query.length ? '?' + query.join('&') : ''),
    headers: { Authorization: 'Bearer ' + config.token, Accept: 'application/json' },
    muteHttpExceptions: true
  };
}

// Errors name the setting to fix; they never include the token or what Clover sent back.
function cloverResponse_(response) {
  var code = response.getResponseCode();
  if (code === 200) return JSON.parse(response.getContentText());
  if (code === 401) throw new Error('Clover did not accept CLOVER_API_TOKEN (401). Create a new token in the Clover dashboard and replace it in Script Properties.');
  if (code === 403) throw new Error('The Clover token is missing a permission (403). It needs Read for Payments, Orders and Customers.');
  if (code === 404) throw new Error('Clover does not know CLOVER_MERCHANT_ID (404). Check it in Script Properties.');
  if (code === 429) throw new Error('Clover asked the desk to slow down (429). Try again in a minute.');
  throw new Error('Clover did not answer as expected (' + code + '). Try again in a minute.');
}

// Sends the requests a few at a time and returns each one's parsed answer, in order.
function cloverFetchAll_(requests) {
  var answers = [];
  for (var start = 0; start < requests.length; start += CLOVER_AT_ONCE_) {
    var batch = requests.slice(start, start + CLOVER_AT_ONCE_);
    var responses = UrlFetchApp.fetchAll(batch);
    for (var attempt = 1; attempt < CLOVER_RETRIES_; attempt += 1) {
      var waiting = [];
      responses.forEach(function (response, index) { if (response.getResponseCode() === 429) waiting.push(index); });
      if (!waiting.length) break;
      Utilities.sleep(CLOVER_RETRY_PAUSE_MS_ * attempt);
      var retried = UrlFetchApp.fetchAll(waiting.map(function (index) { return batch[index]; }));
      waiting.forEach(function (index, position) { responses[index] = retried[position]; });
    }
    responses.forEach(function (response) { answers.push(cloverResponse_(response)); });
  }
  return answers;
}

function cloverList_(config, path, filters, expand) {
  var elements = [];
  for (var page = 0; page < CLOVER_MAX_PAGES_; page += 1) {
    var query = filters.map(function (filter) { return 'filter=' + encodeURIComponent(filter); });
    if (expand) query.push('expand=' + encodeURIComponent(expand));
    query.push('limit=' + CLOVER_PAGE_SIZE_, 'offset=' + page * CLOVER_PAGE_SIZE_);
    var batch = cloverFetchAll_([cloverRequest_(config, path, query)])[0].elements || [];
    elements = elements.concat(batch);
    if (batch.length < CLOVER_PAGE_SIZE_) return elements;
  }
  throw new Error('Clover returned more records than the desk reads at once; choose a shorter range.');
}

// Customer records hold the name, phone and email a payer gave for a receipt. Orders say which customer, so the
// orders are read for the same window (from a few hours earlier, as a sale is opened before it is paid), then each
// customer once.
function cloverCustomersByOrder_(config, fromMs, toMs) {
  var orders = cloverList_(config, '/orders', ['createdTime>=' + (fromMs - 6 * 3600000), 'createdTime<' + toMs], 'customers');
  var customerOfOrder = {};
  var wanted = {};
  orders.forEach(function (order) {
    var first = ((order.customers && order.customers.elements) || [])[0];
    if (!order.id || !first || !first.id) return;
    customerOfOrder[order.id] = first.id;
    wanted[first.id] = true;
  });
  var ids = Object.keys(wanted).slice(0, CLOVER_CUSTOMER_LOOKUPS_);
  var customers = {};
  if (ids.length) {
    var requests = ids.map(function (id) { return cloverRequest_(config, '/customers/' + encodeURIComponent(id), ['expand=' + encodeURIComponent('phoneNumbers,emailAddresses')]); });
    cloverFetchAll_(requests).forEach(function (customer, index) {
      customers[ids[index]] = {
        id: ids[index],
        name: normalizeName_([customer.firstName, customer.lastName].filter(Boolean).join(' ')),
        phones: ((customer.phoneNumbers && customer.phoneNumbers.elements) || []).map(function (phone) { return String(phone.phoneNumber || '').trim(); }).filter(Boolean),
        emails: ((customer.emailAddresses && customer.emailAddresses.elements) || []).map(function (email) { return String(email.emailAddress || '').trim().toLowerCase(); }).filter(Boolean)
      };
    });
  }
  var byOrder = {};
  Object.keys(customerOfOrder).forEach(function (orderId) { if (customers[customerOfOrder[orderId]]) byOrder[orderId] = customers[customerOfOrder[orderId]]; });
  return byOrder;
}

// Every payment from the start of fromDate to the end of toDate (club time), oldest first.
function cloverPaymentsBetween_(config, fromDate, toDate) {
  var timeZone = Session.getScriptTimeZone();
  // A day either side covers any time zone; payments are then kept by their date in club time.
  var fromMs = Date.parse(fromDate + 'T00:00:00Z') - 86400000;
  var toMs = Date.parse(toDate + 'T00:00:00Z') + 2 * 86400000;
  var raw = cloverList_(config, '/payments', ['createdTime>=' + fromMs, 'createdTime<' + toMs], 'cardTransaction,refunds');
  var customers = raw.length ? cloverCustomersByOrder_(config, fromMs, toMs) : {};
  return raw.map(function (payment) { return cloverPayment_(payment, customers, timeZone); })
  .filter(function (payment) { return payment.date >= fromDate && payment.date <= toDate; })
  .sort(function (left, right) { return left.time - right.time; });
}

// The parts of a Clover payment the desk uses. Amounts stay in cents.
function cloverPayment_(raw, customersByOrder, timeZone) {
  var card = raw.cardTransaction || null;
  var amount = Number(raw.amount) || 0;
  var refunded = ((raw.refunds && raw.refunds.elements) || []).reduce(function (sum, refund) { return sum + (Number(refund.amount) || 0); }, 0);
  var result = String(raw.result || '').toUpperCase();
  var state = result === 'SUCCESS' || result === 'AUTH_COMPLETED' || result === 'VOID_FAILED' ? (refunded >= amount ? 'refunded' : 'paid')
    : result === 'VOIDED' || result === 'VOIDING' ? 'voided'
    : result === 'FAIL' ? 'failed' : 'pending';
  var tender = String((raw.tender && raw.tender.label) || '');
  var time = Number(raw.createdTime) || 0;
  var digits = function (value) { return /^\d+$/.test(String(value || '')) ? String(value) : ''; };
  return {
    id: String(raw.id || ''),
    time: time,
    date: Utilities.formatDate(new Date(time), timeZone, 'yyyy-MM-dd'),
    clock: Utilities.formatDate(new Date(time), timeZone, 'h:mm a'),
    amount: amount,
    refunded: refunded,
    net: amount - refunded,
    state: state,
    kind: card ? 'card' : /cash/i.test(tender) ? 'cash' : 'other',
    brand: card ? String(card.cardType || '') : '',
    first6: card ? digits(card.first6) : '',
    last4: card ? digits(card.last4) : '',
    cardholder: card ? normalizeName_(card.cardholderName) : '',
    customer: (raw.order && raw.order.id && customersByOrder[raw.order.id]) || null
  };
}

// What can link a payment to a player once the organizer has matched it: the card (brand, first 6 and last 4
// digits), and the Clover customer with their phone and email.
function cloverPaymentKeys_(payment) {
  var keys = [];
  if (payment.brand && payment.first6 && payment.last4) keys.push('card:' + payment.brand.toUpperCase() + '|' + payment.first6 + '|' + payment.last4);
  var customer = payment.customer;
  if (customer) {
    keys.push('customer:' + customer.id);
    customer.phones.forEach(function (phone) { var digits = phone.replace(/\D/g, '').slice(-10); if (digits.length === 10) keys.push('phone:' + digits); });
    customer.emails.forEach(function (email) { keys.push('email:' + email); });
  }
  return keys;
}

// Cards print LAST/FIRST ("SMITH/JOHN A"); either order gives "john a smith".
function cloverNameKey_(name) {
  var text = String(name || '').trim();
  var slash = text.indexOf('/');
  if (slash > 0) text = text.slice(slash + 1) + ' ' + text.slice(0, slash);
  var key = linkedNameKey_(text);
  return CLOVER_PLACEHOLDER_NAME_.test(key) ? '' : key;
}

// First and last name with middle initials and suffixes left out: "john a smith jr" is ["john", "smith"].
function cloverNameTokens_(key) {
  var tokens = String(key || '').split(' ').filter(Boolean);
  while (tokens.length > 2 && CLOVER_NAME_SUFFIXES_.indexOf(tokens[tokens.length - 1]) >= 0) tokens.pop();
  if (tokens.length < 2) return [];
  return [tokens[0]].concat(tokens.slice(1, -1).filter(function (token) { return token.length > 1; }), [tokens[tokens.length - 1]]);
}

function cloverPlayerIndex_(players, aliases) {
  var exact = {};
  var people = [];
  var active = {};
  var add = function (name, playerId) {
    var key = cloverNameKey_(name);
    if (!key) return;
    [key, cloverNameTokens_(key).join(' ')].forEach(function (variant) {
      if (variant) (exact[variant] || (exact[variant] = {}))[playerId] = true;
    });
    var tokens = cloverNameTokens_(key);
    if (tokens.length) people.push({ playerId: playerId, first: tokens[0], last: tokens[tokens.length - 1] });
  };
  players.forEach(function (player) { active[player.playerId] = true; add(player.name, player.playerId); });
  Object.keys(aliases || {}).forEach(function (alias) { if (active[aliases[alias]]) add(alias, aliases[alias]); });
  return { exact: exact, people: people, active: active };
}

function cloverFirstNamesFit_(cardFirst, playerFirst) {
  if (cardFirst.length === 1 || playerFirst.length === 1) return cardFirst[0] === playerFirst[0];
  return cardFirst.indexOf(playerFirst) === 0 || playerFirst.indexOf(cardFirst) === 0;
}

// { playerId, reason } for exactly one player, or { candidates } when the name fits several.
function cloverByName_(name, index) {
  var key = cloverNameKey_(name);
  if (!key) return { candidates: [] };
  var tokens = cloverNameTokens_(key);
  var found = {};
  [key, tokens.join(' ')].forEach(function (variant) { Object.keys(index.exact[variant] || {}).forEach(function (id) { found[id] = true; }); });
  var ids = Object.keys(found);
  if (ids.length === 1) return { playerId: ids[0], reason: 'name' };
  if (ids.length > 1) return { candidates: ids };
  if (!tokens.length) return { candidates: [] };
  var first = tokens[0];
  var last = tokens[tokens.length - 1];
  found = {};
  index.people.forEach(function (person) { if (person.last === last && cloverFirstNamesFit_(first, person.first)) found[person.playerId] = true; });
  ids = Object.keys(found);
  return ids.length === 1 ? { playerId: ids[0], reason: 'initial' } : { candidates: ids };
}

function cloverIdentify_(payment, context) {
  var ambiguousLink = false;
  var keys = cloverPaymentKeys_(payment);
  for (var i = 0; i < keys.length; i += 1) {
    var linked = context.links[keys[i]];
    if (linked === null) ambiguousLink = true;
    else if (linked && context.index.active[linked]) return { playerId: linked, reason: keys[i].split(':')[0] };
  }
  var candidates = [];
  var names = [[payment.cardholder, ''], [payment.customer && payment.customer.name, 'customer-']];
  for (var j = 0; j < names.length; j += 1) {
    if (!names[j][0]) continue;
    var match = cloverByName_(names[j][0], context.index);
    if (match.playerId) return { playerId: match.playerId, reason: names[j][1] + match.reason };
    candidates = candidates.concat(match.candidates);
  }
  return { playerId: '', candidates: candidates.filter(function (id, index) { return candidates.indexOf(id) === index; }), ambiguousLink: ambiguousLink };
}

function cloverFee_(playerId, context) {
  return CLOVER_FEES_[context.statuses[playerId]] || CLOVER_FEES_.visitor;
}

// The players one payment covers: the payer alone, or with (or only) the players their 'pays_for' links name, when
// exactly one such group's fees add up to the amount. Several fitting groups narrow to those all checked in.
function cloverCoveredGroup_(payerId, dollars, context) {
  var others = (context.paysFor[payerId] || []).filter(function (id) { return id !== payerId && context.index.active[id]; });
  var people = [payerId].concat(others);
  var fits = [];
  for (var mask = 1; mask < (1 << people.length); mask += 1) {
    var group = people.filter(function (id, bit) { return mask & (1 << bit); });
    var total = group.reduce(function (sum, id) { return sum + cloverFee_(id, context); }, 0);
    if (total === dollars) fits.push(group);
  }
  if (fits.length > 1) fits = fits.filter(function (group) { return group.every(function (id) { return context.roster[id]; }); });
  return fits.length === 1 ? fits[0] : null;
}

function cloverMoney_(dollars) {
  return '$' + (Math.round(dollars * 100) % 100 ? dollars.toFixed(2) : String(Math.round(dollars)));
}

// One night's payments, oldest first, each with what the desk would do:
//   matched       playerIds are recorded as Credit (notCheckedIn lists any not on the roster yet);
//   needs-action  the organizer decides; payerId and playerIds are the suggestion;
//   unmatched     no single player fits; suggestions are checked-in players whose fee is the amount;
//   ignored       not a completed card payment (refunded, voided, declined, cash entered on Clover).
// context: index (cloverPlayerIndex_), links, paysFor, statuses, covered (Zeffy), roster, hand (methods chosen by hand).
function cloverMatchNight_(payments, context) {
  var claimed = {};
  var rows = payments.slice().sort(function (left, right) { return left.time - right.time; }).map(function (payment) {
    var row = { payment: payment, state: '', reason: '', payerId: '', playerIds: [], note: '', suggestions: [], notCheckedIn: [] };
    var dollars = payment.net / 100;
    if (payment.kind !== 'card') return Object.assign(row, { state: 'ignored', note: payment.kind === 'cash' ? 'Cash entered on Clover' : 'Not a card payment' });
    if (payment.state !== 'paid') return Object.assign(row, { state: 'ignored', note: { refunded: 'Refunded', voided: 'Voided', failed: 'Declined', pending: 'Not completed' }[payment.state] });
    var who = cloverIdentify_(payment, context);
    if (!who.playerId) {
      row.state = 'unmatched';
      row.note = who.candidates.length ? 'The name fits more than one player' : who.ambiguousLink ? 'This card has paid for more than one player' : 'No player found';
      row.suggestions = who.candidates.length ? who.candidates : [];
      return row;
    }
    row.payerId = who.playerId;
    row.reason = who.reason;
    var group = cloverCoveredGroup_(who.playerId, dollars, context);
    if (!group) {
      var fee = cloverFee_(who.playerId, context);
      row.state = 'needs-action';
      row.playerIds = [who.playerId];
      row.note = dollars > fee ? 'Paid ' + cloverMoney_(dollars) + ', fee is ' + cloverMoney_(fee) + ': ' + cloverMoney_(dollars - fee) + ' more. Who else does it cover?'
        : 'Paid ' + cloverMoney_(dollars) + ', fee is ' + cloverMoney_(fee);
      return row;
    }
    row.playerIds = group;
    if (group.length > 1 || group[0] !== who.playerId) row.reason = 'pays-for';
    for (var i = 0; i < group.length; i += 1) {
      var id = group[i];
      var problem = context.covered[id] ? 'has a Zeffy play pass'
        : claimed[id] ? 'already has a Clover payment tonight'
        : context.hand[id] && context.hand[id] !== 'credit' ? 'is already marked ' + context.hand[id] + ' (paid twice?)' : '';
      // The page puts the player's name in place of {player}.
      if (problem) return Object.assign(row, { state: 'needs-action', note: '{player} ' + problem, notePlayerId: id });
    }
    group.forEach(function (id) { claimed[id] = payment.id; });
    row.state = 'matched';
    row.notCheckedIn = group.filter(function (id) { return !context.roster[id]; });
    return row;
  });
  // For payments no single player fits, suggest checked-in players still without a payment whose fee is the amount.
  var open = Object.keys(context.roster).filter(function (id) { return !claimed[id] && !context.hand[id] && !context.covered[id]; });
  rows.forEach(function (row) {
    if (row.state !== 'unmatched') return;
    var dollars = row.payment.net / 100;
    var fits = open.filter(function (id) { return cloverFee_(id, context) === dollars; });
    row.suggestions = row.suggestions.filter(function (id) { return context.roster[id]; }).concat(fits.filter(function (id) { return row.suggestions.indexOf(id) < 0; })).slice(0, 6);
  });
  return rows;
}

// A key learned for one player links to them; a key that turns up for a second player stops linking (null).
function cloverRemember_(links, keys, playerId) {
  keys.forEach(function (key) {
    if (links[key] === undefined) links[key] = playerId;
    else if (links[key] !== playerId) links[key] = null;
  });
}

function cloverLinkRows_() {
  if (!SpreadsheetApp.getActive().getSheetByName('CloverLinks')) return {};
  TABLES.CloverLinks = CLOVER_LINK_HEADERS;
  var links = {};
  rows_('CloverLinks').forEach(function (row) {
    var key = String(row.link_key || '').trim();
    if (key) links[key] = String(row.player_id || '') || null;
  });
  return links;
}

function cloverPaysFor_(players, linkRows) {
  var paysFor = {};
  resolveLinks_(nameLinks_('pays_for', true, linkRows), players).resolved.forEach(function (link) {
    (paysFor[link.left.playerId] || (paysFor[link.left.playerId] = [])).push(link.right.playerId);
  });
  return paysFor;
}

// The night as recorded by hand, compared with what the desk would have done. Matching runs night by night, oldest
// first, and learns as the organizer would have taught it. Each match links its card. The payments left over are then
// paired with the players marked Credit by hand that night (context.marks: when each was marked, from the AuditLog),
// where a payment and a player can only pair if the fee is the amount and the mark is within 15 minutes of the payment.
// A pair is learned only when every way of pairing up the night uses it, so nothing rests on a guess between people who
// arrived together. A $20-style payment is paired with two players only when they are the one pair that fits. Last, a
// night left with exactly one payment and one Credit player at the same amount is paired too. A pairing of two players
// links no card: which of them paid is not known.
var CLOVER_MARK_WINDOW_MS_ = 15 * 60000;

// The size of the largest pairing of payments (left) with players (right), leaving out one edge if asked.
function cloverMaxPairs_(left, edges, skip) {
  var owner = {};
  var tryPay = function (payment, seen) {
    var targets = edges[payment] || [];
    for (var i = 0; i < targets.length; i += 1) {
      var player = targets[i];
      if ((skip && skip[0] === payment && skip[1] === player) || seen[player]) continue;
      seen[player] = true;
      if (owner[player] === undefined || tryPay(owner[player], seen)) { owner[player] = payment; return true; }
    }
    return false;
  };
  return left.reduce(function (count, payment) { return count + (tryPay(payment, {}) ? 1 : 0); }, 0);
}

function cloverReviewNight_(rows, context, links) {
  var claimed = {};
  rows.forEach(function (row) {
    if (row.state !== 'matched') return;
    row.playerIds.forEach(function (id) { claimed[id] = true; });
    row.verdicts = row.playerIds.map(function (id) {
      var hand = context.hand[id] || '';
      return { playerId: id, hand: hand, verdict: hand === 'credit' ? 'agrees' : hand ? 'conflict' : context.roster[id] ? 'missing' : 'not-checked-in' };
    });
    if (row.payerId && row.payerId === row.playerIds[0]) cloverRemember_(links, cloverPaymentKeys_(row.payment), row.payerId);
  });
  var credit = Object.keys(context.hand).filter(function (id) { return context.hand[id] === 'credit' && !claimed[id]; });
  var marks = context.marks || {};
  var gap = function (row, id) {
    return (marks[id] || []).reduce(function (best, at) { return Math.min(best, Math.abs(at - row.payment.time)); }, Infinity);
  };
  var learn = function (row, group, by) {
    row.learnedPlayerIds = group;
    row.learnedBy = by;
    if (by === 'time') row.learnedMinutes = Math.round(Math.max.apply(null, group.map(function (id) { return gap(row, id); })) / 6000) / 10;
    group.forEach(function (id) { claimed[id] = true; });
    if (group.length === 1) cloverRemember_(links, cloverPaymentKeys_(row.payment), group[0]);
  };
  var open = function () { return rows.filter(function (row) { return row.state === 'unmatched' && !row.learnedPlayerIds; }); };
  var near = function (row) { return credit.filter(function (id) { return !claimed[id] && gap(row, id) <= CLOVER_MARK_WINDOW_MS_; }); };

  // One payment, one player: the pairs every largest pairing uses.
  var waiting = open();
  var edges = {};
  waiting.forEach(function (row, index) {
    edges[index] = near(row).filter(function (id) { return cloverFee_(id, context) === row.payment.net / 100; });
  });
  var left = waiting.map(function (row, index) { return index; });
  var best = cloverMaxPairs_(left, edges);
  var forced = [];
  left.forEach(function (index) {
    edges[index].forEach(function (id) { if (cloverMaxPairs_(left, edges, [index, id]) < best) forced.push([index, id]); });
  });
  forced.forEach(function (pair) { learn(waiting[pair[0]], [pair[1]], 'time'); });

  // One payment, two players whose fees add up to it, when they are the only pair near it and near no other payment.
  waiting = open();
  var pairs = waiting.map(function (row) {
    var people = near(row);
    var found = [];
    people.forEach(function (first, i) {
      people.slice(i + 1).forEach(function (second) { if (cloverFee_(first, context) + cloverFee_(second, context) === row.payment.net / 100) found.push([first, second]); });
    });
    return found;
  });
  waiting.forEach(function (row, i) {
    if (pairs[i].length !== 1) return;
    var group = pairs[i][0];
    var contested = waiting.some(function (other, j) { return j !== i && near(other).some(function (id) { return group.indexOf(id) >= 0; }); });
    if (!contested && group.every(function (id) { return !claimed[id]; })) learn(row, group, 'time');
  });

  var byAmount = {};
  open().forEach(function (row) { var amount = row.payment.net / 100; (byAmount[amount] || (byAmount[amount] = [])).push(row); });
  var byFee = {};
  credit.forEach(function (id) { if (!claimed[id]) { var fee = cloverFee_(id, context); (byFee[fee] || (byFee[fee] = [])).push(id); } });
  Object.keys(byAmount).forEach(function (amount) {
    if (byAmount[amount].length === 1 && (byFee[amount] || []).length === 1) learn(byAmount[amount][0], byFee[amount], 'only-one');
  });
  return credit.filter(function (id) { return !claimed[id]; });
}

function cloverPage_(event) {
  var template = HtmlService.createTemplateFromFile('Clover');
  template.deskMode = deskMode_();
  var deskUrl = '';
  try { deskUrl = String(ScriptApp.getService().getUrl() || ''); } catch (error) { deskUrl = ''; }
  template.deskUrl = deskUrl;
  return template.evaluate()
  .setTitle(template.deskMode === 'dev' ? 'DEV - CTTC Clover payments' : 'CTTC Clover payments')
  .addMetaTag('viewport', 'width=device-width, initial-scale=1')
  .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// The Clover page: every night from fromDate to toDate with its Clover payments, what the desk would do with each,
// and how that compares with the payments recorded by hand. Only reads, from Clover and the Sheet.
function getCloverReport(fromDate, toDate) {
  var fromTime = cashDate_(fromDate, 'Start date');
  var toTime = cashDate_(toDate, 'End date');
  if (fromTime > toTime) throw new Error('The start date must be on or before the end date.');
  if ((toTime - fromTime) / 86400000 + 1 > CLOVER_REPORT_MAX_DAYS_) throw new Error('Choose at most ' + CLOVER_REPORT_MAX_DAYS_ + ' days at a time.');
  var config = cloverConfig_();
  var problem = cloverConfigProblem_(config);
  if (problem) return { connected: false, problem: problem, enabled: config.enabled };

  var payments = cloverPaymentsBetween_(config, fromDate, toDate);
  var playerRows = rows_('Players');
  var players = listPlayers(playerRows);
  var names = {};
  playerRows.forEach(function (player) { names[String(player.player_id)] = String(player.display_name); });
  var linkRows = nameLinkRows_();
  var index = cloverPlayerIndex_(players, playerAliases_());
  var statuses = getMemberStatuses().statuses;
  var coveredOn = cashZeffyCoverage_(playerRows, players, linkRows);
  var paysFor = cloverPaysFor_(players, linkRows);
  var links = cloverLinkRows_();
  var storedLinks = Object.keys(links).length;
  var dateOfSession = function (sessionId) { var match = /^session-(\d{4}-\d{2}-\d{2})$/.exec(String(sessionId)); return match ? match[1] : ''; };
  var inRange = function (date) { return date >= fromDate && date <= toDate; };
  var rosters = {};
  var hands = {};
  rows_('SessionPlayers').forEach(function (row) {
    var date = dateOfSession(row.session_id);
    if (inRange(date)) (rosters[date] || (rosters[date] = {}))[String(row.player_id)] = true;
  });
  cashRows_('OpenPlay').forEach(function (row) {
    var date = displayDate_(row.session_date).slice(0, 10);
    if (inRange(date)) (rosters[date] || (rosters[date] = {}))[String(row.player_id)] = true;
  });
  // When each player was marked Credit: every such change in the AuditLog, and the payment row's own last update.
  var marks = {};
  var mark = function (date, playerId, at) {
    var time = at instanceof Date ? at.getTime() : Date.parse(at);
    if (!isFinite(time)) return;
    var night = marks[date] || (marks[date] = {});
    (night[playerId] || (night[playerId] = [])).push(time);
  };
  cashRows_('SessionPayments').forEach(function (row) {
    var date = dateOfSession(row.session_id);
    if (!inRange(date) || !row.method) return;
    (hands[date] || (hands[date] = {}))[String(row.player_id)] = String(row.method);
    if (String(row.method) === 'credit') mark(date, String(row.player_id), row.updated_at);
  });
  var auditMarks = 0;
  cashRows_('AuditLog').forEach(function (row) {
    if (row.action !== 'session_payment_updated') return;
    var date = dateOfSession(row.entity_id);
    if (!inRange(date)) return;
    var details;
    try { details = JSON.parse(row.details_json || '{}'); } catch (error) { return; }
    if (details && details.method === 'credit' && details.playerId) { mark(date, String(details.playerId), row.event_time); auditMarks += 1; }
  });
  var byDate = {};
  payments.forEach(function (payment) { (byDate[payment.date] || (byDate[payment.date] = [])).push(payment); });
  var dates = Object.keys(rosters).concat(Object.keys(byDate)).filter(function (date, i, all) { return all.indexOf(date) === i; }).sort();

  var totals = { cardPayments: 0, matched: 0, agrees: 0, conflict: 0, missing: 0, notCheckedIn: 0, needsAction: 0, unmatched: 0, learnedByTime: 0, learned: 0, ignored: 0, creditWithoutPayment: 0, withName: 0, withCustomer: 0, withCard: 0 };
  var gaps = { within2: 0, within5: 0, within15: 0, within60: 0, over60: 0, none: 0 };
  // Cards seen on an earlier night: once matched by hand the first time, these would match by themselves.
  var cardNights = {};
  var repeat = { cards: 0, payments: 0 };
  var nights = dates.map(function (date) {
    var context = { index: index, links: links, paysFor: paysFor, statuses: statuses, covered: coveredOn(date), roster: rosters[date] || {}, hand: hands[date] || {}, marks: marks[date] || {} };
    var rows = cloverMatchNight_(byDate[date] || [], context);
    var creditWithoutPayment = cloverReviewNight_(rows, context, links);
    rows.forEach(function (row) {
      var key = cloverPaymentKeys_(row.payment)[0];
      if (row.state === 'ignored' || !key || key.indexOf('card:') !== 0) return;
      if (!cardNights[key]) { cardNights[key] = date; repeat.cards += 1; } else if (cardNights[key] < date) repeat.payments += 1;
    });
    // How far each payment left over is from the nearest Credit mark that night, whoever it was for.
    var times = [];
    Object.keys(context.marks).forEach(function (id) { if (context.hand[id] === 'credit') times = times.concat(context.marks[id]); });
    rows.forEach(function (row) {
      if (row.state !== 'unmatched' || row.learnedPlayerIds) return;
      var nearest = times.reduce(function (best, at) { return Math.min(best, Math.abs(at - row.payment.time)); }, Infinity);
      var minutes = nearest / 60000;
      gaps[minutes <= 2 ? 'within2' : minutes <= 5 ? 'within5' : minutes <= 15 ? 'within15' : minutes <= 60 ? 'within60' : isFinite(minutes) ? 'over60' : 'none'] += 1;
      row.nearestMarkMinutes = isFinite(minutes) ? Math.round(minutes) : '';
    });
    rows.forEach(function (row) {
      if (row.state === 'ignored') { totals.ignored += 1; return; }
      totals.cardPayments += 1;
      if (cloverNameKey_(row.payment.cardholder)) totals.withName += 1;
      if (row.payment.customer) totals.withCustomer += 1;
      if (row.payment.first6 && row.payment.last4) totals.withCard += 1;
      if (row.state === 'matched') {
        totals.matched += 1;
        row.verdicts.forEach(function (verdict) { totals[{ agrees: 'agrees', conflict: 'conflict', missing: 'missing', 'not-checked-in': 'notCheckedIn' }[verdict.verdict]] += 1; });
      } else if (row.state === 'needs-action') totals.needsAction += 1;
      else totals.unmatched += 1;
      if (row.learnedPlayerIds) totals[row.learnedBy === 'time' ? 'learnedByTime' : 'learned'] += 1;
    });
    totals.creditWithoutPayment += creditWithoutPayment.length;
    return { date: date, rosterCount: Object.keys(context.roster).length, rows: rows.map(cloverReportRow_), creditWithoutPayment: creditWithoutPayment };
  });
  var learned = Object.keys(links).filter(function (key) { return links[key]; }).length;
  return {
    connected: true,
    enabled: config.enabled,
    from: fromDate,
    to: toDate,
    names: names,
    fees: CLOVER_FEES_,
    totals: totals,
    storedLinks: storedLinks,
    gaps: gaps,
    repeat: repeat,
    auditMarks: auditMarks,
    linksAfter: learned,
    nights: nights.reverse()
  };
}

// What the page shows for one payment. google.script.run cannot send null fields, so empty values are ''.
function cloverReportRow_(row) {
  var payment = row.payment;
  var customer = payment.customer;
  return {
    id: payment.id,
    clock: payment.clock,
    amount: payment.amount / 100,
    net: payment.net / 100,
    kind: payment.kind,
    state: row.state,
    card: payment.kind === 'card' ? [payment.brand, payment.last4 ? '••' + payment.last4 : ''].filter(Boolean).join(' ') : '',
    cardholder: payment.cardholder,
    customer: customer ? [customer.name].concat(customer.phones, customer.emails).filter(Boolean).join(' · ') || 'no name or contact saved' : '',
    reason: row.reason,
    payerId: row.payerId,
    playerIds: row.playerIds,
    note: row.note,
    notePlayerId: row.notePlayerId || '',
    suggestions: row.suggestions,
    notCheckedIn: row.notCheckedIn,
    verdicts: row.verdicts || [],
    learnedPlayerIds: row.learnedPlayerIds || [],
    learnedBy: row.learnedBy || '',
    learnedMinutes: row.learnedMinutes === undefined ? '' : row.learnedMinutes,
    nearestMarkMinutes: row.nearestMarkMinutes === undefined ? '' : row.nearestMarkMinutes
  };
}
