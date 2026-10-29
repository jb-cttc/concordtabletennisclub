// Clover card payments (issue #87). The club's Clover POS takes only nightly desk fees, round robin or Open Play ($5
// Junior, $10 Member, $15 Visitor, $10 on a first visit: NightFees.js), so each card payment there is one night's fee for
// someone (or two). The desk reads those payments with a
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
var CLOVER_CUSTOMER_CACHE_SECONDS_ = 6 * 3600;
// Clover limits how many requests a token may have open at once, and answers 429 when there are too many: requests go a
// few at a time, and a 429 is tried again after a pause.
var CLOVER_AT_ONCE_ = 3;
var CLOVER_RETRIES_ = 4;
var CLOVER_RETRY_PAUSE_MS_ = 1500;
// Clover answers at most 90 days of payments per request; the report asks for a little either side of the range.
var CLOVER_REPORT_MAX_DAYS_ = 85;
var CLOVER_LINK_HEADERS = ['link_key', 'player_id', 'source', 'updated_at'];
// Words Clover and the card networks put where a cardholder name would be.
var CLOVER_PLACEHOLDER_NAME_ = /\b(valued|cardholder|card holder|customer|guest|instant issue|apple pay|google pay)\b/;
var CLOVER_NAME_SUFFIXES_ = ['jr', 'sr', 'ii', 'iii', 'iv'];
var CLOVER_METHOD_NAMES_ = { cash: 'Cash', venmo: 'Venmo', zelle: 'Zelle', credit: 'Credit', zeffy: 'Zeffy' };

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
  // The desk checks every minute, so each customer is kept for a few hours rather than read again each time.
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (error) { cache = null; }
  var customers = {};
  if (cache && ids.length) {
    var kept = cache.getAll(ids.map(function (id) { return 'clover-customer:' + id; }));
    ids.forEach(function (id) { if (kept['clover-customer:' + id]) customers[id] = JSON.parse(kept['clover-customer:' + id]); });
  }
  var missing = ids.filter(function (id) { return !customers[id]; });
  if (missing.length) {
    var requests = missing.map(function (id) { return cloverRequest_(config, '/customers/' + encodeURIComponent(id), ['expand=' + encodeURIComponent('phoneNumbers,emailAddresses')]); });
    var read = {};
    cloverFetchAll_(requests).forEach(function (customer, index) {
      var id = missing[index];
      customers[id] = {
        id: id,
        name: normalizeName_([customer.firstName, customer.lastName].filter(Boolean).join(' ')),
        phones: ((customer.phoneNumbers && customer.phoneNumbers.elements) || []).map(function (phone) { return String(phone.phoneNumber || '').trim(); }).filter(Boolean),
        emails: ((customer.emailAddresses && customer.emailAddresses.elements) || []).map(function (email) { return String(email.emailAddress || '').trim().toLowerCase(); }).filter(Boolean)
      };
      read['clover-customer:' + id] = JSON.stringify(customers[id]);
    });
    if (cache) { try { cache.putAll(read, CLOVER_CUSTOMER_CACHE_SECONDS_); } catch (error) { /* read again next time */ } }
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
  return nightFee_(context.statuses[playerId], context.firstVisits && context.firstVisits[playerId]);
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
// context: index (cloverPlayerIndex_), links, paysFor, statuses, firstVisits (optional), covered (Zeffy), roster, hand
// (methods chosen by hand), claimed (optional).
function cloverMatchNight_(payments, context) {
  // context.claimed: players another Clover payment already covers tonight (recorded earlier).
  var claimed = Object.assign({}, context.claimed || {});
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
        : context.hand[id] && context.hand[id] !== 'credit' ? 'is already marked ' + (CLOVER_METHOD_NAMES_[context.hand[id]] || context.hand[id]) + ' (paid twice?)' : '';
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

// Learning cards from the payments recorded by hand. Clover payments rarely carry a name (tap to pay), so a card is
// linked to the player the desk's own records point to, and only when they point to exactly one:
//   - each night the card paid once, at one player's fee, is a clue: the payer is among the players marked Credit at
//     that fee that night (nights where nothing was marked Credit, or the card paid twice, say nothing);
//   - the payer is a player who fits every clue for that card;
//   - a player already linked to another card that paid the same night is not this card's payer.
// A card is linked when one player is left, unless another card that paid on one of the same nights is also left with
// only that player: then the records cannot say which card is theirs, and neither is linked. This repeats until nothing
// changes, so the result never depends on which card is looked at first. A card no player fits on every night (a
// Credit record missing, or a shared card) is never linked, and neither is one several players still fit. Timing is
// not used to decide: people arrive together.
// known: cards already linked (matched at the desk or saved), which count as settled from the start. A night may carry
// its own statuses and firstVisits, for the fees that night; statuses is used otherwise.
// Returns { links: { key: playerId }, cards: [ { key, payments, nights, candidates, why, conflict, almost } ] }.
function cloverLearnCards_(nights, statuses, known) {
  var fee = function (id, night) { return nightFee_((night.statuses || statuses)[id], night.firstVisits && night.firstVisits[id]); };
  var cards = {};
  nights.forEach(function (night) {
    var used = {};
    night.payments.forEach(function (payment) {
      var key = cloverPaymentKeys_(payment)[0];
      if (payment.kind !== 'card' || payment.state !== 'paid' || !key || key.indexOf('card:') !== 0) return;
      (used[key] || (used[key] = [])).push(payment);
    });
    Object.keys(used).forEach(function (key) {
      var card = cards[key] || (cards[key] = { key: key, payments: 0, clues: [] });
      card.payments += used[key].length;
      if (!night.credit.length || used[key].length !== 1) return;
      var dollars = used[key][0].net / 100;
      card.clues.push({ date: night.date, payment: used[key][0], options: night.credit.filter(function (id) { return fee(id, night) === dollars; }) });
    });
  });
  var links = {};
  var takenOn = {};
  var list = Object.keys(cards).map(function (key) { return cards[key]; });
  list.forEach(function (card) {
    if (!known || !known[card.key]) return;
    links[card.key] = known[card.key];
    card.known = true;
    card.clues.forEach(function (clue) { (takenOn[clue.date] || (takenOn[clue.date] = {}))[known[card.key]] = card.key; });
  });
  var fitting = function (card) {
    if (!card.clues.length) return null;
    return card.clues.reduce(function (left, clue) {
      return left.filter(function (id) { return clue.options.indexOf(id) >= 0 && !(takenOn[clue.date] && takenOn[clue.date][id] && takenOn[clue.date][id] !== card.key); });
    }, card.clues[0].options.slice());
  };
  var sharesNight = function (one, two) {
    return one.clues.some(function (clue) { return two.clues.some(function (other) { return other.date === clue.date; }); });
  };
  for (var changed = true; changed;) {
    changed = false;
    var forced = list.filter(function (card) {
      if (links[card.key]) return false;
      var left = fitting(card);
      card.only = left && left.length === 1 ? left[0] : '';
      return !!card.only;
    });
    forced.forEach(function (card) {
      var rivals = forced.filter(function (other) { return other !== card && other.only === card.only && sharesNight(card, other); });
      card.conflict = rivals.length ? { playerId: card.only, cards: rivals.map(function (other) { return other.key; }) } : null;
    });
    forced.filter(function (card) { return !card.conflict; }).forEach(function (card) {
      links[card.key] = card.only;
      card.clues.forEach(function (clue) { (takenOn[clue.date] || (takenOn[clue.date] = {}))[card.only] = card.key; });
      changed = true;
    });
  }
  list.forEach(function (card) {
    var left = fitting(card);
    card.nights = card.clues.length;
    card.candidates = links[card.key] ? [links[card.key]] : left || [];
    if (links[card.key]) card.conflict = null;
    // Why a learned card is that player: each night's Credit players at the card's amount, and why every other one of
    // them is not the payer (not marked Credit at that amount on another of the card's nights, or their own card paid
    // that night).
    if (links[card.key] && !card.known) {
      var chosen = links[card.key];
      var others = [];
      card.clues.forEach(function (clue) { clue.options.forEach(function (id) { if (id !== chosen && others.indexOf(id) < 0) others.push(id); }); });
      card.why = {
        nights: card.clues.map(function (clue) { return { date: clue.date, amount: clue.payment.net / 100, credit: clue.options.slice() }; }),
        ruledOut: others.map(function (id) {
          var missing = card.clues.filter(function (clue) { return clue.options.indexOf(id) < 0; })[0];
          if (missing) return { playerId: id, reason: 'not-credit', date: missing.date };
          var taken = card.clues.filter(function (clue) { return takenOn[clue.date] && takenOn[clue.date][id] && takenOn[clue.date][id] !== card.key; })[0];
          return { playerId: id, reason: 'other-card', date: taken.date, card: takenOn[taken.date][id] };
        })
      };
    }
    // Not learned, but one player fits every night but one: a record to check (a payment marked another way, or the card
    // paying for someone else that night), never a link.
    if (links[card.key] || card.clues.length < 3) return;
    var counts = {};
    card.clues.forEach(function (clue) { clue.options.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; }); });
    var close = Object.keys(counts).filter(function (id) { return counts[id] === card.clues.length - 1; });
    if (close.length === 1) card.almost = { playerId: close[0], dates: card.clues.filter(function (clue) { return clue.options.indexOf(close[0]) < 0; }).map(function (clue) { return clue.date; }) };
  });
  return { links: links, cards: list };
}

// Compares each matched payment with the method chosen by hand that night; returns the players marked Credit by hand
// whom no Clover payment matched.
function cloverReviewNight_(rows, context) {
  var claimed = {};
  rows.forEach(function (row) {
    if (row.state !== 'matched') return;
    row.playerIds.forEach(function (id) { claimed[id] = true; });
    row.verdicts = row.playerIds.map(function (id) {
      var hand = context.hand[id] || '';
      return { playerId: id, hand: hand, verdict: hand === 'credit' ? 'agrees' : hand ? 'conflict' : context.roster[id] ? 'missing' : 'not-checked-in' };
    });
  });
  return Object.keys(context.hand).filter(function (id) { return context.hand[id] === 'credit' && !claimed[id]; });
}

// The desk. getCloverDesk is the Clover section's check, about once a minute on the open night: it reads that day's
// Clover payments, matches the new ones, and (once CLOVER_ENABLED is 'true') records each match as Credit. The
// organizer then matches the rest by hand, sets aside a payment that is not a desk fee, or undoes a match.
//
// CloverMatches holds one row per payment and player matched, with how ('hand' for the organizer, or the rule that
// matched it), and one row with no player for a payment the organizer decides ('held': a match was undone, so it never
// matches by itself again) or set aside ('ignored': not a desk fee). A matched payment Clover later refunds or voids
// keeps its rows as 'refunded', and its Credit goes back to unpaid. CloverLinks holds what the desk has learned: a card,
// Clover customer, phone or email and its player, or no player once it has paid for two different people.
var CLOVER_MATCH_HEADERS = ['payment_id', 'session_id', 'player_id', 'how', 'amount', 'card', 'paid_at', 'updated_at'];
// A day's Clover payments are kept this long, so two desk tabs or a check right after a match do not ask Clover again.
var CLOVER_DAY_CACHE_SECONDS_ = 20;

function cloverTable_(name, headers) {
  TABLES[name] = headers;
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getSheetByName(name);
  var created = !sheet;
  if (created) sheet = spreadsheet.insertSheet(name);
  ensureHeader_(sheet, headers);
  if (created) formatTable_(sheet, headers.length);
  return sheet;
}

// Reading never adds the tab: before the first match it simply has no rows.
function cloverMatchRows_(sessionId) {
  if (!SpreadsheetApp.getActive().getSheetByName('CloverMatches')) return [];
  TABLES.CloverMatches = CLOVER_MATCH_HEADERS;
  return rows_('CloverMatches').filter(function (row) { return String(row.session_id) === sessionId; });
}

function cloverDayPayments_(config, sessionDate, fresh) {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (error) { cache = null; }
  var key = 'clover-day:' + sessionDate;
  if (cache && !fresh) {
    var kept = cache.get(key);
    if (kept) return JSON.parse(kept);
  }
  var payments = cloverPaymentsBetween_(config, sessionDate, sessionDate);
  if (cache) { try { cache.put(key, JSON.stringify(payments), CLOVER_DAY_CACHE_SECONDS_); } catch (error) { /* read again next time */ } }
  return payments;
}

// Changes need Clover connected and switched on; until then the desk only shows what it would do.
function cloverLive_() {
  var config = cloverConfig_();
  var problem = cloverConfigProblem_(config);
  if (problem) throw new Error(problem);
  if (!config.enabled) throw new Error('Clover matching is off: set CLOVER_ENABLED to true in Script Properties to record matches.');
  return config;
}

// Everything the desk's rules need about one night, read once.
function cloverNight_(sessionDate) {
  var sessionId = 'session-' + sessionDate;
  var playerRows = rows_('Players');
  var players = listPlayers(playerRows);
  var names = {};
  playerRows.forEach(function (player) { names[String(player.player_id)] = String(player.display_name); });
  var linkRows = nameLinkRows_();
  var covered = {};
  getZeffyCoveredPlayerIds(getZeffyPlayers(playerRows, sessionDate, true), players).forEach(function (id) { covered[id] = true; });
  var roster = {};
  var sessionRows = rows_('SessionPlayers');
  var openRows = cashRows_('OpenPlay');
  sessionRows.forEach(function (row) { if (String(row.session_id) === sessionId) roster[String(row.player_id)] = true; });
  openRows.forEach(function (row) { if (displayDate_(row.session_date).slice(0, 10) === sessionDate) roster[String(row.player_id)] = true; });
  var hand = {};
  cashRows_('SessionPayments').forEach(function (row) { if (String(row.session_id) === sessionId && row.method) hand[String(row.player_id)] = String(row.method); });
  return {
    sessionId: sessionId,
    names: names,
    index: cloverPlayerIndex_(players, playerAliases_()),
    statuses: getMemberStatuses().statuses,
    firstVisits: firstVisitFinder_(playerRows, sessionRows, openRows)(sessionDate),
    covered: covered,
    roster: roster,
    hand: hand,
    links: cloverLinkRows_(),
    paysFor: cloverPaysFor_(players, linkRows),
    matches: cloverMatchRows_(sessionId)
  };
}

// Records the night's new matches as Credit. A payment recorded meanwhile (another tab) is skipped, and a method chosen
// by hand meanwhile is left as it is: the next check shows the difference.
function cloverRecord_(sessionDate, rows) {
  var sessionId = 'session-' + sessionDate;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensurePrivatePaymentTables_();
    cloverTable_('CloverMatches', CLOVER_MATCH_HEADERS);
    var recorded = {};
    rows_('CloverMatches').forEach(function (row) { if (String(row.session_id) === sessionId) recorded[String(row.payment_id)] = true; });
    var payments = rows_('SessionPayments').filter(function (row) { return String(row.session_id) === sessionId; });
    var now = new Date();
    var added = [];
    rows.forEach(function (row) {
      if (recorded[row.payment.id]) return;
      row.playerIds.forEach(function (id) {
        added.push({ payment_id: row.payment.id, session_id: sessionId, player_id: id, how: row.reason, amount: row.payment.net / 100, card: cloverCardLabel_(row.payment), paid_at: new Date(row.payment.time), updated_at: now });
        var existing = payments.filter(function (payment) { return String(payment.player_id) === id; });
        if (existing.length > 1) throw new Error('Duplicate payment for ' + id);
        if (!existing.length) appendObjects_('SessionPayments', [{ session_id: sessionId, player_id: id, method: 'credit', updated_at: now }]);
        else if (!existing[0].method) updateRow_('SessionPayments', existing[0].__row, { method: 'credit', updated_at: now });
      });
      // A card first matched by its name is remembered, so it matches when Clover sends no name next time.
      if (row.payerId && row.playerIds[0] === row.payerId && /name|initial/.test(row.reason)) cloverLearnKeys_(cloverPaymentKeys_(row.payment), row.payerId, 'name');
      row.recorded = true;
      appendAudit_('clover_payment_matched', 'session', sessionId, { playerId: row.playerIds[0], players: row.playerIds.length, how: row.reason });
    });
    if (added.length) appendObjects_('CloverMatches', added);
  } finally {
    lock.releaseLock();
  }
}

// Links each key to the player; a key already linked to someone else stops linking (no player). Hold the script lock.
function cloverLearnKeys_(keys, playerId, source) {
  if (!keys.length) return;
  cloverTable_('CloverLinks', CLOVER_LINK_HEADERS);
  var rows = rows_('CloverLinks');
  var now = new Date();
  keys.forEach(function (key) {
    var existing = rows.filter(function (row) { return String(row.link_key) === key; })[0];
    if (!existing) {
      appendObjects_('CloverLinks', [{ link_key: key, player_id: playerId, source: source, updated_at: now }]);
      rows.push({ link_key: key, player_id: playerId });
    } else if (String(existing.player_id) !== playerId) {
      if (existing.__row && String(existing.player_id)) updateRow_('CloverLinks', existing.__row, { player_id: '', source: 'paid for two players', updated_at: now });
    }
  });
}

// Forgets what linked these keys to these players (after a match is undone). Hold the script lock.
function cloverForgetKeys_(keys, playerIds) {
  if (!keys.length || !SpreadsheetApp.getActive().getSheetByName('CloverLinks')) return;
  TABLES.CloverLinks = CLOVER_LINK_HEADERS;
  var sheet = SpreadsheetApp.getActive().getSheetByName('CloverLinks');
  rows_('CloverLinks').filter(function (row) { return keys.indexOf(String(row.link_key)) >= 0 && playerIds.indexOf(String(row.player_id)) >= 0; })
  .map(function (row) { return row.__row; }).sort(function (a, b) { return b - a; })
  .forEach(function (row) { sheet.deleteRow(row); });
}

// Removes this payment's rows for the night, bottom up so the row numbers stay right. Hold the script lock.
function cloverClearPayment_(sessionId, paymentId) {
  var sheet = SpreadsheetApp.getActive().getSheetByName('CloverMatches');
  rows_('CloverMatches').filter(function (row) { return String(row.session_id) === sessionId && String(row.payment_id) === paymentId; })
  .map(function (row) { return row.__row; }).sort(function (a, b) { return b - a; })
  .forEach(function (row) { sheet.deleteRow(row); });
}

// Matches are recorded by themselves only on tonight's date, or last night's (a desk still open after midnight).
function cloverRecent_(sessionDate) {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var yesterday = Utilities.formatDate(new Date(Date.now() - 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return sessionDate === today || sessionDate === yesterday;
}
var CLOVER_REASON_WORDS_ = { card: 'a card used before', customer: 'a Clover customer seen before', phone: 'a phone used before', email: 'an email used before', name: 'the name on the card',
  initial: 'the initial and last name on the card', 'customer-name': 'the Clover customer name', 'customer-initial': 'the Clover customer\'s initial and last name', 'pays-for': 'a pays_for link' };

// What the Clover section shows for the night, newest payment first. Each item's state:
//   matched     recorded as Credit (or, before CLOVER_ENABLED, would be); changed lists players since marked otherwise;
//   needs-action / unmatched   waiting for the organizer, with the likely players;
//   ignored     not a completed card payment (refunded, voided, declined, cash entered on Clover);
//   set-aside   the organizer said it is not a desk fee.
function cloverDeskState_(sessionDate, payments, config) {
  var night = cloverNight_(sessionDate);
  var decided = {};
  night.matches.forEach(function (row) { (decided[String(row.payment_id)] || (decided[String(row.payment_id)] = [])).push(row); });
  var matchedPlayers = function (id) {
    return (decided[id] || []).filter(function (row) { return String(row.player_id) && row.how !== 'refunded'; }).map(function (row) { return String(row.player_id); });
  };
  // Refunded or voided on Clover after it was recorded: its Credit is taken back, then the night is read again.
  var refunded = payments.filter(function (payment) { return payment.state !== 'paid' && matchedPlayers(payment.id).length; });
  if (config.enabled && refunded.length) {
    cloverRefunded_(night.sessionId, refunded);
    return cloverDeskState_(sessionDate, payments, config);
  }
  var claimed = {};
  Object.keys(decided).forEach(function (id) { matchedPlayers(id).forEach(function (playerId) { claimed[playerId] = id; }); });
  // Credit a Clover match recorded is that match's, not a choice by hand.
  var hand = {};
  Object.keys(night.hand).forEach(function (id) { if (!(claimed[id] && night.hand[id] === 'credit')) hand[id] = night.hand[id]; });
  var context = { index: night.index, links: night.links, paysFor: night.paysFor, statuses: night.statuses, firstVisits: night.firstVisits, covered: night.covered, roster: night.roster, hand: hand, claimed: claimed };
  var held = function (id) { return (decided[id] || []).some(function (row) { return row.how === 'held'; }); };
  var open = payments.filter(function (payment) { return !decided[payment.id] || held(payment.id); });
  var rows = cloverMatchNight_(open, context);
  rows.forEach(function (row) {
    // A match the organizer undid is never made again by itself: its players become the suggestion.
    if (!held(row.payment.id)) return;
    if (row.state === 'matched' || row.state === 'needs-action') row.suggestions = row.playerIds.concat(row.suggestions.filter(function (id) { return row.playerIds.indexOf(id) < 0; }));
    if (row.state !== 'ignored') Object.assign(row, { state: 'unmatched', note: 'Undone at the desk: choose who it is for', playerIds: [], notCheckedIn: [] });
  });
  if (config.enabled && cloverRecent_(sessionDate)) {
    var fresh = rows.filter(function (row) { return row.state === 'matched'; });
    if (fresh.length) cloverRecord_(sessionDate, fresh);
  } else if (config.enabled) {
    // An earlier night is never changed by itself: its matches wait, ticked, for the organizer to confirm.
    rows.forEach(function (row) {
      if (row.state === 'matched') Object.assign(row, { state: 'needs-action', note: 'Matched by ' + (CLOVER_REASON_WORDS_[row.reason] || row.reason) + '. On an earlier night, confirm with Match.' });
    });
  }
  var byPayment = {};
  rows.forEach(function (row) { byPayment[row.payment.id] = row; });
  var referenced = {};
  var items = payments.slice().sort(function (left, right) { return right.time - left.time; }).map(function (payment) {
    var stored = decided[payment.id] && !held(payment.id) ? decided[payment.id] : null;
    var takenBack = stored && stored.some(function (row) { return row.how === 'refunded'; });
    var item = cloverReportRow_(byPayment[payment.id] || { payment: payment, state: '', reason: '', payerId: '', playerIds: [], note: '', suggestions: [], notCheckedIn: [] });
    item.time = payment.time;
    item.recorded = !!(byPayment[payment.id] && byPayment[payment.id].recorded);
    if (takenBack) {
      item.state = 'ignored';
      item.playerIds = stored.map(function (row) { return String(row.player_id); }).filter(Boolean);
      item.note = (payment.state === 'voided' ? 'Voided' : 'Refunded') + ' on Clover after it was matched: Credit taken back';
    } else if (stored) {
      var players = matchedPlayers(payment.id);
      if (players.length) {
        item.state = 'matched';
        item.playerIds = players;
        item.reason = String(stored[0].how || '');
        item.recorded = true;
        item.notCheckedIn = players.filter(function (id) { return !night.roster[id]; });
      } else {
        item.state = 'set-aside';
        item.note = 'Not a desk fee';
      }
    }
    // Recorded as Credit, then changed by hand: the organizer sees it and can undo the match.
    item.changed = item.recorded ? item.playerIds.filter(function (id) { return night.hand[id] && night.hand[id] !== 'credit'; }).map(function (id) {
      return { playerId: id, method: CLOVER_METHOD_NAMES_[night.hand[id]] || night.hand[id] };
    }) : [];
    [item.payerId, item.notePlayerId].concat(item.playerIds, item.suggestions).forEach(function (id) { if (id) referenced[id] = true; });
    return item;
  });
  Object.keys(night.roster).forEach(function (id) { referenced[id] = true; });
  var names = {};
  var fees = {};
  Object.keys(referenced).forEach(function (id) {
    names[id] = night.names[id] || 'Unknown player';
    fees[id] = cloverFee_(id, context);
  });
  var pageUrl = '';
  try { pageUrl = String(ScriptApp.getService().getUrl() || ''); } catch (error) { pageUrl = ''; }
  return { connected: true, enabled: config.enabled, date: sessionDate, checkedAt: Date.now(), items: items, names: names, fees: fees, pageUrl: pageUrl ? pageUrl + '?view=clover' : '' };
}

// The Clover section's check for the open night. Reads Clover (without the script lock: score saves never wait on it),
// then matches and, when switched on, records.
function getCloverDesk(sessionDate) {
  validateSessionDate_(sessionDate);
  var config = cloverConfig_();
  var problem = cloverConfigProblem_(config);
  if (problem) return { connected: false, enabled: config.enabled, problem: problem, date: sessionDate };
  return cloverDeskState_(sessionDate, cloverDayPayments_(config, sessionDate), config);
}

function cloverPaymentFor_(config, sessionDate, paymentId) {
  var find = function (payments) { return payments.filter(function (payment) { return payment.id === paymentId; })[0]; };
  var payments = cloverDayPayments_(config, sessionDate);
  var payment = find(payments);
  if (!payment) {
    payments = cloverDayPayments_(config, sessionDate, true);
    payment = find(payments);
  }
  if (!payment) throw new Error('Clover has no such payment on this date.');
  return { payment: payment, payments: payments };
}

// The organizer's match: the payment is for these players (several when one person paid for others). Recorded as Credit
// for each, replacing any method chosen by hand, and with remember the card (or Clover customer) is linked to the one
// player so it matches by itself next time.
function matchCloverPayment(sessionDate, paymentId, playerIds, remember) {
  validateSessionDate_(sessionDate);
  paymentId = String(paymentId || '');
  playerIds = (Array.isArray(playerIds) ? playerIds : []).map(String).filter(function (id, index, all) { return id && all.indexOf(id) === index; });
  if (!paymentId || !playerIds.length || playerIds.length > 6) throw new Error('Choose who this Clover payment is for.');
  var config = cloverLive_();
  var found = cloverPaymentFor_(config, sessionDate, paymentId);
  if (found.payment.kind !== 'card' || found.payment.state !== 'paid') throw new Error('Not a completed card payment on Clover.');
  var sessionId = 'session-' + sessionDate;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensurePrivatePaymentTables_();
    cloverTable_('CloverMatches', CLOVER_MATCH_HEADERS);
    var tonight = rows_('CloverMatches').filter(function (row) { return String(row.session_id) === sessionId; });
    var matched = tonight.filter(function (row) { return String(row.player_id) && row.how !== 'refunded'; });
    if (matched.some(function (row) { return String(row.payment_id) === paymentId; })) throw new Error('This Clover payment is already matched.');
    if (matched.some(function (row) { return playerIds.indexOf(String(row.player_id)) >= 0; })) throw new Error('Already has a Clover payment tonight: undo that match first.');
    var players = rows_('Players');
    var covered = getZeffyCoveredPlayerIds(getZeffyPlayers(players, sessionDate, true));
    playerIds.forEach(function (id) {
      var player = players.filter(function (row) { return String(row.player_id) === id; })[0];
      if (!player || !asBoolean_(player.active)) throw new Error('Unknown or inactive player');
      if (covered.indexOf(id) >= 0) throw new Error('Zeffy play pass covers this session');
    });
    cloverClearPayment_(sessionId, paymentId);
    var now = new Date();
    var payment = found.payment;
    appendObjects_('CloverMatches', playerIds.map(function (id) {
      return { payment_id: paymentId, session_id: sessionId, player_id: id, how: 'hand', amount: payment.net / 100, card: cloverCardLabel_(payment), paid_at: new Date(payment.time), updated_at: now };
    }));
    var methods = rows_('SessionPayments').filter(function (row) { return String(row.session_id) === sessionId; });
    playerIds.forEach(function (id) {
      var existing = methods.filter(function (row) { return String(row.player_id) === id; });
      if (existing.length > 1) throw new Error('Duplicate payment for ' + id);
      if (existing.length) updateRow_('SessionPayments', existing[0].__row, { method: 'credit', updated_at: now });
      else appendObjects_('SessionPayments', [{ session_id: sessionId, player_id: id, method: 'credit', updated_at: now }]);
    });
    if (remember === true && playerIds.length === 1) cloverLearnKeys_(cloverPaymentKeys_(payment), playerIds[0], 'hand');
    appendAudit_('clover_payment_matched', 'session', sessionId, { playerId: playerIds[0], players: playerIds.length, how: 'hand', remember: remember === true });
  } finally {
    lock.releaseLock();
  }
  return cloverDeskState_(sessionDate, found.payments, config);
}

// Credit taken back from matched payments Clover has since refunded or voided; the rows stay, marked 'refunded'.
function cloverRefunded_(sessionId, payments) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensurePrivatePaymentTables_();
    cloverTable_('CloverMatches', CLOVER_MATCH_HEADERS);
    var ids = payments.map(function (payment) { return payment.id; });
    var rows = rows_('CloverMatches').filter(function (row) { return String(row.session_id) === sessionId && ids.indexOf(String(row.payment_id)) >= 0 && String(row.player_id) && row.how !== 'refunded'; });
    var players = rows.map(function (row) { return String(row.player_id); });
    var now = new Date();
    rows_('SessionPayments').forEach(function (row) {
      if (String(row.session_id) === sessionId && players.indexOf(String(row.player_id)) >= 0 && String(row.method) === 'credit') updateRow_('SessionPayments', row.__row, { method: '', updated_at: now });
    });
    rows.forEach(function (row) { updateRow_('CloverMatches', row.__row, { how: 'refunded', updated_at: now }); });
    rows.forEach(function (row) { appendAudit_('clover_payment_refunded', 'session', sessionId, { playerId: String(row.player_id) }); });
  } finally {
    lock.releaseLock();
  }
}

// Undoes a match (or a set-aside): the players' Credit goes back to unpaid unless it was changed by hand since, the card
// stops pointing to them, and the payment waits for the organizer; it never matches by itself again.
function unmatchCloverPayment(sessionDate, paymentId) {
  validateSessionDate_(sessionDate);
  paymentId = String(paymentId || '');
  var config = cloverLive_();
  var found = cloverPaymentFor_(config, sessionDate, paymentId);
  var sessionId = 'session-' + sessionDate;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensurePrivatePaymentTables_();
    cloverTable_('CloverMatches', CLOVER_MATCH_HEADERS);
    var rows = rows_('CloverMatches').filter(function (row) { return String(row.session_id) === sessionId && String(row.payment_id) === paymentId; });
    var players = rows.map(function (row) { return String(row.player_id); }).filter(Boolean);
    var now = new Date();
    rows_('SessionPayments').forEach(function (row) {
      if (String(row.session_id) === sessionId && players.indexOf(String(row.player_id)) >= 0 && String(row.method) === 'credit') updateRow_('SessionPayments', row.__row, { method: '', updated_at: now });
    });
    cloverForgetKeys_(cloverPaymentKeys_(found.payment), players);
    cloverClearPayment_(sessionId, paymentId);
    appendObjects_('CloverMatches', [{ payment_id: paymentId, session_id: sessionId, player_id: '', how: 'held', amount: found.payment.net / 100, card: cloverCardLabel_(found.payment), paid_at: new Date(found.payment.time), updated_at: now }]);
    appendAudit_('clover_payment_unmatched', 'session', sessionId, { playerId: players[0] || '', players: players.length });
  } finally {
    lock.releaseLock();
  }
  return cloverDeskState_(sessionDate, found.payments, config);
}

// Not a desk fee (a payment for something else): it leaves the list and is never matched.
function setAsideCloverPayment(sessionDate, paymentId) {
  validateSessionDate_(sessionDate);
  paymentId = String(paymentId || '');
  var config = cloverLive_();
  var found = cloverPaymentFor_(config, sessionDate, paymentId);
  var sessionId = 'session-' + sessionDate;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    cloverTable_('CloverMatches', CLOVER_MATCH_HEADERS);
    var rows = rows_('CloverMatches').filter(function (row) { return String(row.session_id) === sessionId && String(row.payment_id) === paymentId; });
    if (rows.some(function (row) { return String(row.player_id) && row.how !== 'refunded'; })) throw new Error('This Clover payment is matched: undo the match first.');
    cloverClearPayment_(sessionId, paymentId);
    appendObjects_('CloverMatches', [{ payment_id: paymentId, session_id: sessionId, player_id: '', how: 'ignored', amount: found.payment.net / 100, card: cloverCardLabel_(found.payment), paid_at: new Date(found.payment.time), updated_at: new Date() }]);
    appendAudit_('clover_payment_set_aside', 'session', sessionId, {});
  } finally {
    lock.releaseLock();
  }
  return cloverDeskState_(sessionDate, found.payments, config);
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

// The Clover page: the cards the desk can learn from the payments recorded by hand, and every night from fromDate to
// toDate with its Clover payments and what the desk would do with each once those cards are linked, compared with what
// was recorded. Only reads, from Clover and the Sheet.
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
  var auditRows = cashRows_('AuditLog');
  var statusesOn = memberStatusFinder_(getMemberStatuses().statuses, players, linkRows, auditRows);
  var coveredOn = cashZeffyCoverage_(playerRows, players, linkRows);
  var paysFor = cloverPaysFor_(players, linkRows);
  var stored = cloverLinkRows_();
  var dateOfSession = function (sessionId) { var match = /^session-(\d{4}-\d{2}-\d{2})$/.exec(String(sessionId)); return match ? match[1] : ''; };
  var inRange = function (date) { return date >= fromDate && date <= toDate; };
  var rosters = {};
  var hands = {};
  var sessionRows = rows_('SessionPlayers');
  var openRows = cashRows_('OpenPlay');
  var firstVisitsOn = firstVisitFinder_(playerRows, sessionRows, openRows);
  sessionRows.forEach(function (row) {
    var date = dateOfSession(row.session_id);
    if (inRange(date)) (rosters[date] || (rosters[date] = {}))[String(row.player_id)] = true;
  });
  openRows.forEach(function (row) {
    var date = displayDate_(row.session_date).slice(0, 10);
    if (inRange(date)) (rosters[date] || (rosters[date] = {}))[String(row.player_id)] = true;
  });
  // When each player was marked Credit (the payment row's last update, and every such change in the AuditLog): shown
  // beside a learned card as supporting evidence, never used to decide.
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
  auditRows.forEach(function (row) {
    if (row.action !== 'session_payment_updated') return;
    var date = dateOfSession(row.entity_id);
    if (!inRange(date)) return;
    var details;
    try { details = JSON.parse(row.details_json || '{}'); } catch (error) { return; }
    if (details && details.method === 'credit' && details.playerId) mark(date, String(details.playerId), row.event_time);
  });
  var byDate = {};
  payments.forEach(function (payment) { (byDate[payment.date] || (byDate[payment.date] = [])).push(payment); });
  var dates = Object.keys(rosters).concat(Object.keys(byDate)).filter(function (date, i, all) { return all.indexOf(date) === i; }).sort();

  var known = {};
  Object.keys(stored).forEach(function (key) { if (stored[key]) known[key] = stored[key]; });
  var learned = cloverLearnCards_(dates.map(function (date) {
    var hand = hands[date] || {};
    return { date: date, payments: byDate[date] || [], credit: Object.keys(hand).filter(function (id) { return hand[id] === 'credit'; }), statuses: statusesOn(date), firstVisits: firstVisitsOn(date) };
  }), {}, known);
  var links = {};
  Object.keys(learned.links).forEach(function (key) { links[key] = learned.links[key]; });
  Object.keys(stored).forEach(function (key) { links[key] = stored[key]; });
  var cards = learned.cards.map(function (card) {
    var minutes = card.clues.map(function (clue) {
      var at = (marks[clue.date] || {})[learned.links[card.key]] || [];
      return at.length ? Math.round(Math.min.apply(null, at.map(function (time) { return Math.abs(time - clue.payment.time); })) / 60000) : null;
    }).filter(function (value) { return value !== null; });
    var sample = card.clues.length ? card.clues[0].payment : null;
    var labelOf = function (key) {
      var other = learned.cards.filter(function (entry) { return entry.key === key; })[0];
      return other && other.clues.length ? cloverCardLabel_(other.clues[0].payment) : key.split('|').pop();
    };
    return {
      key: card.key,
      card: sample ? cloverCardLabel_(sample) : card.key.split('|').pop(),
      why: card.why ? { nights: card.why.nights, ruledOut: card.why.ruledOut.map(function (out) { return out.card ? Object.assign({}, out, { card: labelOf(out.card) }) : out; }) } : null,
      // Not learned because another card that paid on one of the same nights also points only to this player.
      conflict: card.conflict ? { playerId: card.conflict.playerId, cards: card.conflict.cards.map(labelOf) } : null,
      playerId: learned.links[card.key] || '',
      saved: !!learned.links[card.key] && stored[card.key] === learned.links[card.key],
      // The night the record disagrees: what was chosen by hand for that player, and whether they were checked in.
      almost: card.almost ? { playerId: card.almost.playerId, nights: card.nights - card.almost.dates.length, odd: card.almost.dates.map(function (date) {
        var payment = card.clues.filter(function (clue) { return clue.date === date; })[0].payment;
        return { date: date, clock: payment.clock, amount: payment.net / 100, method: (hands[date] || {})[card.almost.playerId] || '', checkedIn: !!(rosters[date] || {})[card.almost.playerId] };
      }) } : null,
      payments: card.payments,
      nights: card.nights,
      candidates: card.candidates.length,
      minutes: minutes
    };
  });

  var totals = { cardPayments: 0, matched: 0, agrees: 0, conflict: 0, missing: 0, notCheckedIn: 0, needsAction: 0, unmatched: 0, ignored: 0, creditWithoutPayment: 0, withName: 0, withCustomer: 0 };
  // Payments from a card seen on an earlier night: once each card is matched the first time, these match by themselves.
  var firstNight = {};
  var repeat = { cards: 0, payments: 0 };
  var nights = dates.map(function (date) {
    var context = { index: index, links: links, paysFor: paysFor, statuses: statusesOn(date), firstVisits: firstVisitsOn(date), covered: coveredOn(date), roster: rosters[date] || {}, hand: hands[date] || {} };
    var rows = cloverMatchNight_(byDate[date] || [], context);
    var creditWithoutPayment = cloverReviewNight_(rows, context);
    rows.forEach(function (row) {
      if (row.state === 'ignored') { totals.ignored += 1; return; }
      var key = cloverPaymentKeys_(row.payment)[0];
      if (key && key.indexOf('card:') === 0) {
        if (!firstNight[key]) { firstNight[key] = date; repeat.cards += 1; } else if (firstNight[key] < date) repeat.payments += 1;
      }
      totals.cardPayments += 1;
      if (cloverNameKey_(row.payment.cardholder)) totals.withName += 1;
      if (row.payment.customer) totals.withCustomer += 1;
      if (row.state === 'matched') {
        totals.matched += 1;
        row.verdicts.forEach(function (verdict) { totals[{ agrees: 'agrees', conflict: 'conflict', missing: 'missing', 'not-checked-in': 'notCheckedIn' }[verdict.verdict]] += 1; });
      } else if (row.state === 'needs-action') totals.needsAction += 1;
      else totals.unmatched += 1;
    });
    totals.creditWithoutPayment += creditWithoutPayment.length;
    return { date: date, rosterCount: Object.keys(context.roster).length, rows: rows.map(cloverReportRow_), creditWithoutPayment: creditWithoutPayment };
  });
  return {
    connected: true,
    enabled: config.enabled,
    from: fromDate,
    to: toDate,
    names: names,
    totals: totals,
    storedLinks: Object.keys(stored).length,
    cards: cards,
    repeat: repeat,
    nights: nights.reverse()
  };
}

// The cards the owner checked on the Clover page, saved so the desk matches them by themselves: [{ key, playerId }].
function saveCloverCards(cards) {
  if (!Array.isArray(cards) || !cards.length || cards.length > 200) throw new Error('Choose the cards to save.');
  cards = cards.map(function (card) { return { key: String(card && card.key || ''), playerId: String(card && card.playerId || '') }; });
  cards.forEach(function (card) { if (!/^card:[A-Z_ ]*\|\d{6}\|\d{4}$/.test(card.key) || !card.playerId) throw new Error('Not a card the desk learned.'); });
  cloverLive_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var active = {};
    listPlayers().forEach(function (player) { active[player.playerId] = true; });
    cards.forEach(function (card) {
      if (!active[card.playerId]) throw new Error('Unknown or inactive player');
      cloverLearnKeys_([card.key], card.playerId, 'records');
    });
    appendAudit_('clover_cards_saved', 'database', 'CloverLinks', { cards: cards.length });
  } finally {
    lock.releaseLock();
  }
  return cards.length;
}

function cloverCardLabel_(payment) {
  return [payment.brand, payment.last4 ? '••' + payment.last4 : ''].filter(Boolean).join(' ');
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
    card: payment.kind === 'card' ? cloverCardLabel_(payment) : '',
    // Clover's stand-ins for a missing name ("VISA CARDHOLDER") are not shown as names.
    cardholder: cloverNameKey_(payment.cardholder) ? payment.cardholder : '',
    customer: customer ? [customer.name].concat(customer.phones, customer.emails).filter(Boolean).join(' · ') || 'no name or contact saved' : '',
    reason: row.reason,
    payerId: row.payerId,
    playerIds: row.playerIds,
    note: row.note,
    notePlayerId: row.notePlayerId || '',
    suggestions: row.suggestions,
    notCheckedIn: row.notCheckedIn,
    verdicts: row.verdicts || []
  };
}
