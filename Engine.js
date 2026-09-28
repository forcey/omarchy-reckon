// --- Untrusted text ----------------------------------------------------------
// Every string a row shows was typed, pasted, or fetched: whatever was on the
// clipboard, a currency code off the wire, the argument to base64/sha256. A row is one line
// of a narrow card, so control characters, bidi overrides and line separators
// have nothing to do there and plenty to do against whoever is reading -- a
// right-to-left override rewrites what the rest of the line appears to say.
// Strip them, and cap the length so no single row can make the list expensive
// to lay out.
//
// The other half of this lives in the QML: every Text that shows one of these
// sets `textFormat: Text.PlainText`, because AutoText would otherwise sniff a
// string like `<img src=http://...>` as markup and go and fetch it.

var TEXT_CEILING = 512
var ICON_CEILING = 16

// C0 and C1, the bidi marks, overrides and isolates, the two line separators,
// and the byte-order mark. Zero-width joiners are left alone: they hold emoji
// sequences together, and an application named in emoji is a real application.
var TEXT_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u200e-\u200f\u2028-\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g

function sanitizeText(value, ceiling) {
  var text = String(value === undefined || value === null ? "" : value)
  var limit = ceiling > 0 ? ceiling : TEXT_CEILING
  if (text.length > limit) text = text.slice(0, limit)
  return text.replace(TEXT_CONTROLS, " ")
}

// The last gate before a row reaches the ListView, applied to every row
// whatever built it, so a row builder added later cannot forget it.
function sanitizeRow(row) {
  if (!row) return row
  row.label = sanitizeText(row.label)
  row.detail = sanitizeText(row.detail)
  row.path = sanitizeText(row.path)
  row.icon = sanitizeText(row.icon, ICON_CEILING)
  row.iconFont = sanitizeText(row.iconFont, ICON_CEILING * 4)
  return row
}

// --- Calculator -------------------------------------------------------------
// A search that reads as arithmetic ("2+3", "3.23 + 343", "(4+6)/2") answers
// itself, so the menu doubles as a pocket calculator. The expression is parsed
// by hand rather than handed to the JS engine: the input is whatever the user
// typed, and nothing typed into a search field should be able to reach the
// engine that runs the shell.
var MATH_CONSTANTS = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E
}

var MATH_FUNCTIONS = {
  sqrt: function(x) { return Math.sqrt(x) },
  cbrt: function(x) { return x < 0 ? -Math.pow(-x, 1 / 3) : Math.pow(x, 1 / 3) },
  abs: function(x) { return Math.abs(x) },
  round: function(x) { return Math.round(x) },
  floor: function(x) { return Math.floor(x) },
  ceil: function(x) { return Math.ceil(x) },
  exp: function(x) { return Math.exp(x) },
  ln: function(x) { return Math.log(x) },
  // Math.log10/log2 postdate the ES5 baseline this file otherwise sticks to.
  log: function(x) { return Math.log(x) / Math.LN10 },
  log2: function(x) { return Math.log(x) / Math.LN2 },
  sin: function(x) { return Math.sin(x) },
  cos: function(x) { return Math.cos(x) },
  tan: function(x) { return Math.tan(x) },
  asin: function(x) { return Math.asin(x) },
  acos: function(x) { return Math.acos(x) },
  atan: function(x) { return Math.atan(x) }
}

function mathHas(table, name) {
  return Object.prototype.hasOwnProperty.call(table, name)
}

// Symbols that may lead a number, the way a statement prints money:
// "$127,000 -$40", or "$-40" for the same thing.
var MATH_CURRENCY_PREFIXES = "$€£¥₹₽₴₺₩₪฿₫₱₦"

// Anything the grammar does not name is a tokenize failure rather than a
// character to skip: a query is only ever an expression if all of it is one.
//
// Commas are read as thousands separators, but only in strict groups of three
// ("172,618.93", "1,000,000"), which is how figures pasted from a US broker or
// bank look. "1,5" fits no grouping and is refused rather than guessed at.
//
// The array comes back carrying two facts about how the numbers were written,
// so the answer can be written the same way: `grouped` when any of them had
// separators, and `symbol` when they were money. Mixing symbols -- "$5 + €5"
// -- is not arithmetic, and is refused.
function tokenizeMath(text) {
  var src = String(text || "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
  var tokens = []
  tokens.grouped = false
  tokens.symbol = ""
  var i = 0

  while (i < src.length) {
    var ch = src.charAt(i)

    // Non-breaking and thin spaces too: web pages put them between a figure
    // and its sign, and they come along with a copy.
    if (/[ \t\u00a0\u202f]/.test(ch)) { i += 1; continue }

    if (MATH_CURRENCY_PREFIXES.indexOf(ch) >= 0) {
      if (!/[0-9.(+-]/.test(src.charAt(i + 1))) return null
      if (tokens.symbol && tokens.symbol !== ch) return null
      tokens.symbol = ch
      i += 1
      continue
    }

    if (/[0-9.]/.test(ch)) {
      var number = ""
      while (i < src.length && /[0-9.,]/.test(src.charAt(i))) { number += src.charAt(i); i += 1 }
      if (number.indexOf(",") >= 0) {
        if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(number)) return null
        number = number.replace(/,/g, "")
        tokens.grouped = true
      }
      if (/^[eE]/.test(src.charAt(i)) && /[0-9+-]/.test(src.charAt(i + 1))) {
        number += src.charAt(i); i += 1
        if (/[+-]/.test(src.charAt(i))) { number += src.charAt(i); i += 1 }
        while (i < src.length && /[0-9]/.test(src.charAt(i))) { number += src.charAt(i); i += 1 }
      }
      if (!/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(number)) return null
      tokens.push({ type: "number", value: parseFloat(number) })
      continue
    }

    if (/[a-zA-Z]/.test(ch)) {
      var name = ""
      while (i < src.length && /[a-zA-Z0-9]/.test(src.charAt(i))) { name += src.charAt(i); i += 1 }
      tokens.push({ type: "name", value: name.toLowerCase() })
      continue
    }

    if ("+-*/%^()".indexOf(ch) >= 0) { tokens.push({ type: ch }); i += 1; continue }

    return null
  }

  return tokens
}

// Evaluates while it parses -- there is no tree to keep, one expression is
// answered per keystroke, and a null anywhere means "not arithmetic" and stops
// the whole thing. `operators` counts the work done, so a bare number stays a
// search term instead of turning into a result row for itself.
function parseMathTokens(tokens) {
  var pos = 0
  var operators = 0

  function peek() { return pos < tokens.length ? tokens[pos] : null }

  function eat(type) {
    var token = peek()
    if (!token || token.type !== type) return null
    pos += 1
    return token
  }

  function parseExpression() {
    var left = parseTerm()
    if (left === null) return null

    for (;;) {
      var token = peek()
      if (!token || (token.type !== "+" && token.type !== "-")) return left
      pos += 1
      operators += 1
      var right = parseTerm()
      if (right === null) return null
      left = token.type === "+" ? left + right : left - right
    }
  }

  function parseTerm() {
    var left = parseUnary()
    if (left === null) return null

    for (;;) {
      var token = peek()
      if (!token || (token.type !== "*" && token.type !== "/" && token.type !== "%")) return left
      pos += 1
      operators += 1
      var right = parseUnary()
      if (right === null) return null
      if (token.type === "*") left = left * right
      else if (token.type === "/") left = left / right
      else left = left % right
    }
  }

  function parseUnary() {
    var token = peek()
    if (token && (token.type === "+" || token.type === "-")) {
      pos += 1
      var operand = parseUnary()
      if (operand === null) return null
      return token.type === "-" ? -operand : operand
    }
    return parsePower()
  }

  // Right-associative, and the exponent takes a sign of its own: 2^-3.
  function parsePower() {
    var base = parseAtom()
    if (base === null) return null
    if (!peek() || peek().type !== "^") return base
    pos += 1
    operators += 1
    var exponent = parseUnary()
    if (exponent === null) return null
    return Math.pow(base, exponent)
  }

  function parseAtom() {
    if (eat("(")) {
      var grouped = parseExpression()
      if (grouped === null || !eat(")")) return null
      return grouped
    }

    var number = eat("number")
    if (number) return number.value

    var name = eat("name")
    if (!name) return null
    if (mathHas(MATH_CONSTANTS, name.value)) return MATH_CONSTANTS[name.value]
    if (!mathHas(MATH_FUNCTIONS, name.value)) return null
    if (!eat("(")) return null
    var argument = parseExpression()
    if (argument === null || !eat(")")) return null
    operators += 1
    return MATH_FUNCTIONS[name.value](argument)
  }

  var value = parseExpression()
  if (value === null || pos !== tokens.length) return null
  return { value: value, operators: operators }
}

// Binary floating point leaves 0.1 + 0.2 at 0.30000000000000004. Twelve
// significant digits is past anything typed by hand and short of the noise.
function formatMathResult(value) {
  if (typeof value !== "number" || !isFinite(value)) return ""

  var text = value.toPrecision(12)
  if (text.indexOf("e") >= 0) return String(parseFloat(text))
  if (text.indexOf(".") >= 0) text = text.replace(/0+$/, "").replace(/\.$/, "")
  // -0 reads as a typo, not an answer.
  return text === "-0" ? "0" : text
}

// The formatted answer for a query that is entirely an expression, or "" for
// one that is not -- including a bare number, which is still a search.
function evaluateMath(query) {
  var text = String(query || "").trim()
  // Typing the `=` is how a calculator is asked, so let it mean nothing here.
  if (text.charAt(text.length - 1) === "=") text = text.slice(0, -1).trim()
  if (!text) return ""

  var tokens = tokenizeMath(text)
  if (!tokens || tokens.length === 0) return ""

  var parsed = parseMathTokens(tokens)
  if (!parsed || parsed.operators === 0) return ""
  // Division by zero and the like: an answer the row cannot honestly show.
  if (!isFinite(parsed.value)) return ""

  var result = formatMathResult(parsed.value)
  if (tokens.grouped || tokens.symbol) result = groupThousands(result)
  if (tokens.symbol) result = formatMoney(result, tokens.symbol)
  return result
}

// "106781.99" -> "106,781.99". Exponent notation is left as it is: a number
// that needs one is past where separators help anyone read it.
function groupThousands(text) {
  var match = String(text).match(/^(-?)(\d+)(\.\d+)?$/)
  if (!match) return text
  return match[1] + match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (match[3] || "")
}

// The symbol goes after the sign, as a statement prints it ("-$40"), and cents
// keep both digits ("$10.50", not "$10.5").
function formatMoney(text, symbol) {
  var negative = text.charAt(0) === "-"
  var digits = negative ? text.slice(1) : text
  if (/\.\d$/.test(digits)) digits += "0"
  return (negative ? "-" : "") + symbol + digits
}

// --- Currency ----------------------------------------------------------------
// "123 eur to usd" is the other search that has an obvious answer the menu can
// give, so it answers itself the way arithmetic does: the conversion leads the
// list and Enter copies it. The rates behind it are a daily snapshot cached on
// disk, fetched the first time somebody actually asks for a conversion -- a
// menu never used as a converter never reaches the network.

// ISO 4217 codes the rate source carries. Static rather than read off the
// cached rates: a query has to be recognised as a conversion before there is
// anything cached to recognise it against, since recognising it is what asks
// for the fetch.
var CURRENCY_CODES = (
  "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND " +
  "BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLF CLP CNH CNY COP CRC CUP CVE " +
  "CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP FOK GBP GEL GGP GHS GIP GMD " +
  "GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS IMP INR IQD IRR ISK JEP JMD JOD " +
  "JPY KES KGS KHR KID KMF KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL " +
  "MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD " +
  "OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK " +
  "SGD SHP SLE SLL SOS SRD SSP STN SYP SZL THB TJS TMT TND TOP TRY TTD TVD " +
  "TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XDR XOF XPF YER " +
  "ZAR ZMW ZWG ZWL"
).split(" ")

var CURRENCY_CODE_SET = (function() {
  var set = {}
  for (var i = 0; i < CURRENCY_CODES.length; i++) set[CURRENCY_CODES[i]] = true
  return set
})()

// Only symbols with one sensible reading. "$" is claimed by a dozen dollars
// and "kr" by four kronor; the bare ones go to the currency that owns them in
// ordinary use, and the ambiguous rest are left to be spelled as codes.
var CURRENCY_SYMBOLS = {
  "$": "USD", "us$": "USD", "usd$": "USD",
  "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR", "₽": "RUB", "₴": "UAH",
  "₺": "TRY", "₩": "KRW", "₪": "ILS", "฿": "THB", "₫": "VND", "₱": "PHP",
  "₦": "NGN", "₸": "KZT", "₮": "MNT", "₾": "GEL", "₼": "AZN", "₵": "GHS",
  "₲": "PYG", "៛": "KHR", "zł": "PLN", "kč": "CZK",
  "r$": "BRL", "c$": "CAD", "a$": "AUD", "nz$": "NZD", "hk$": "HKD", "s$": "SGD"
}

// Typing the name instead of the code is the same question.
var CURRENCY_WORDS = {
  euro: "EUR", euros: "EUR",
  dollar: "USD", dollars: "USD", buck: "USD", bucks: "USD",
  pound: "GBP", pounds: "GBP", sterling: "GBP", quid: "GBP",
  yen: "JPY", yuan: "CNY", rmb: "CNY",
  rupee: "INR", rupees: "INR",
  ruble: "RUB", rubles: "RUB", rouble: "RUB", roubles: "RUB",
  franc: "CHF", francs: "CHF",
  zloty: "PLN", zlotys: "PLN",
  won: "KRW", shekel: "ILS", shekels: "ILS",
  hryvnia: "UAH", lira: "TRY", rand: "ZAR", baht: "THB"
}

function currencyHas(table, name) {
  return Object.prototype.hasOwnProperty.call(table, name)
}

// A code, a symbol or a name, however it was capitalised -- or "" for a word
// that is none of them, which is how a plain search stays a plain search.
function currencyCodeFor(token) {
  var raw = String(token || "").trim()
  if (!raw) return ""

  var lower = raw.toLowerCase()
  if (currencyHas(CURRENCY_SYMBOLS, lower)) return CURRENCY_SYMBOLS[lower]
  if (currencyHas(CURRENCY_WORDS, lower)) return CURRENCY_WORDS[lower]

  var upper = raw.toUpperCase()
  return currencyHas(CURRENCY_CODE_SET, upper) ? upper : ""
}

// The target is the tail after "to"/"in"/"into"/"as"/"->", or just the last
// word when the connector is left out ("120 usd eur"). The head is greedy, so
// a query with more than one "to" in it splits on the last one.
function splitConversionQuery(text) {
  var connected = text.match(/^(.*\S)(?:\s+(?:to|into|in|as)\s+|\s*(?:->|=>|→)\s*)(\S.*)$/i)
  if (connected) return { head: connected[1].trim(), to: connected[2].trim() }

  var bare = text.match(/^(.*\S)\s+(\S+)$/)
  if (bare) return { head: bare[1].trim(), to: bare[2].trim() }

  return null
}

// The source currency sits on either side of the amount: "$120", "120 eur",
// "120eur", "usd 120". A head that is only a currency converts one unit of it,
// which is how a rate gets looked up without inventing an amount to look it
// up with.
//
// Both readings are offered rather than picked, because either can be the one
// that is a currency at all: the trailing word in "sqrt(4) eur", the leading
// one in "usd 100". The caller keeps the first that names a currency.
function conversionHeadSplits(head) {
  var splits = []

  var suffixed = head.match(/^(.*?)\s*([^\s0-9.,()+\-*\/%^]+)$/)
  if (suffixed) splits.push({ code: suffixed[2], amount: suffixed[1].trim() })

  var prefixed = head.match(/^([^\s0-9.,()+\-*\/%^]+)\s*(.*)$/)
  if (prefixed) splits.push({ code: prefixed[1], amount: prefixed[2].trim() })

  return splits
}

// The amount goes through the calculator rather than parseFloat: it is the
// same grammar, it already refuses anything it does not recognise, and it
// makes "(20+5) eur to usd" work for free. A missing amount is one unit.
function conversionAmount(text) {
  var raw = String(text || "").trim()
  if (!raw) return 1

  var tokens = tokenizeMath(raw)
  if (!tokens || tokens.length === 0) return null

  var parsed = parseMathTokens(tokens)
  if (!parsed || !isFinite(parsed.value)) return null

  return parsed.value
}

// The grammar shared by every "<amount> <x> to <y>" search. Currency and units
// differ only in what they will accept for x and y, so the splitting, the
// connectors and the calculator-parsed amount are written once here and the
// caller passes in a resolver.
//
// `resolve(fromToken, toToken)` returns `{ from, to }` -- whatever the caller
// wants to carry forward -- or null to reject the pair. Rejecting is how two
// tables that share a word stay out of each other's way.
//
// Returns { amount, from, to } or null, and bails on the first thing it cannot
// name, since most of what is typed here is not a conversion at all.
function parseConversionQuery(query, resolve) {
  var text = String(query || "").trim()
  if (text.charAt(text.length - 1) === "=") text = text.slice(0, -1).trim()
  if (!text) return null

  var split = splitConversionQuery(text)
  if (!split) return null

  var heads = conversionHeadSplits(split.head)
  for (var i = 0; i < heads.length; i++) {
    var pair = resolve(heads[i].code, split.to)
    if (!pair) continue

    var amount = conversionAmount(heads[i].amount)
    if (amount === null) continue

    return { amount: amount, from: pair.from, to: pair.to }
  }

  return null
}

function parseCurrencyQuery(query) {
  return parseConversionQuery(query, function(fromToken, toToken) {
    var from = currencyCodeFor(fromToken)
    if (!from) return null
    var to = currencyCodeFor(toToken)
    if (!to) return null
    return { from: from, to: to }
  })
}

// The snapshot is one base-relative table, so any cross rate is the ratio of
// two of its entries and no second request is needed to get one.
function convertCurrency(parsed, rates) {
  if (!parsed || !rates) return null

  var from = rates[parsed.from]
  var to = rates[parsed.to]
  if (typeof from !== "number" || typeof to !== "number") return null
  if (!(from > 0) || !(to > 0)) return null

  var rate = to / from
  var value = parsed.amount * rate
  if (!isFinite(value)) return null

  return { value: value, rate: rate }
}

// Money reads in two decimals. An amount that rounds away to nothing there is
// not an answer, so small ones keep digits until they say something.
function formatCurrencyValue(value) {
  if (typeof value !== "number" || !isFinite(value)) return ""

  var magnitude = Math.abs(value)
  var digits = 2
  if (magnitude > 0 && magnitude < 0.01)
    digits = Math.min(10, 2 + Math.ceil(-Math.log(magnitude) / Math.LN10))

  var text = value.toFixed(digits)
  if (digits > 2) text = text.replace(/0+$/, "").replace(/\.$/, "")
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text
}

// The rate is a fact about the pair rather than an amount of money, so it
// keeps significant digits instead of decimal places: 0.00000123, not 0.00.
// Five of them, because it rides along in a row that is one line wide and the
// converted amount above it is where the precision actually matters.
function formatCurrencyRate(rate) {
  if (typeof rate !== "number" || !isFinite(rate) || rate <= 0) return ""
  return String(parseFloat(rate.toPrecision(5)))
}

// Accepts what either of the usual free rate sources answers with -- the
// exchangerate-api shape (base_code, time_last_update_unix) and the
// frankfurter/ECB one (base, date) -- and normalises it to one snapshot.
function parseCurrencyRates(text) {
  var payload = null
  try { payload = JSON.parse(String(text || "")) } catch (e) { return null }
  if (!payload || !payload.rates || typeof payload.rates !== "object") return null

  var base = String(payload.base_code || payload.base || "").toUpperCase()
  var rates = {}
  var count = 0

  for (var code in payload.rates) {
    if (!Object.prototype.hasOwnProperty.call(payload.rates, code)) continue
    var value = payload.rates[code]
    if (typeof value !== "number" || !isFinite(value) || value <= 0) continue
    rates[String(code).toUpperCase()] = value
    count += 1
  }

  if (count === 0) return null
  // Sources differ on whether the base is one of its own rates. It is 1.
  if (base && !currencyHas(rates, base)) { rates[base] = 1; count += 1 }

  return {
    base: base,
    rates: rates,
    count: count,
    updated: Number(payload.time_last_update_unix) || 0,
    nextUpdate: Number(payload.time_next_update_unix) || 0,
    date: String(payload.date || "")
  }
}

// Rates move once a day. The source says when it will next publish, so honour
// that when it does and fall back to the age of what we have when it doesn't.
function currencyRatesStale(snapshot, nowSeconds) {
  if (!snapshot || !snapshot.rates || !snapshot.count) return true
  if (snapshot.nextUpdate > 0) return nowSeconds >= snapshot.nextUpdate
  if (snapshot.updated > 0) return nowSeconds - snapshot.updated >= 12 * 3600
  return true
}

// --- Units -------------------------------------------------------------------
// The same grammar as currency, answered from a table instead of a server.
// Every ratio unit is a factor against the base unit of its dimension, so a
// conversion is two multiplications. Temperature is the exception: its scales
// disagree about where zero is, so it converts through kelvin by hand.

var UNITS = ({})

function defineUnit(dimension, factor, symbol, names) {
  var unit = { dimension: dimension, factor: factor, symbol: symbol }
  var list = names.split(" ")
  for (var i = 0; i < list.length; i++) UNITS[list[i]] = unit
}

function defineTemperature(symbol, names, toKelvin, fromKelvin) {
  var unit = { dimension: "temperature", symbol: symbol, toKelvin: toKelvin, fromKelvin: fromKelvin }
  var list = names.split(" ")
  for (var i = 0; i < list.length; i++) UNITS[list[i]] = unit
}

// Length, against the metre.
defineUnit("length", 0.001, "mm", "mm millimetre millimetres millimeter millimeters")
defineUnit("length", 0.01, "cm", "cm centimetre centimetres centimeter centimeters")
defineUnit("length", 1, "m", "m metre metres meter meters")
defineUnit("length", 1000, "km", "km kilometre kilometres kilometer kilometers")
defineUnit("length", 0.0254, "in", "in inch inches")
defineUnit("length", 0.3048, "ft", "ft foot feet")
defineUnit("length", 0.9144, "yd", "yd yard yards")
defineUnit("length", 1609.344, "mi", "mi mile miles")
defineUnit("length", 1852, "nmi", "nmi nm nauticalmile nauticalmiles")

// Mass, against the kilogram.
defineUnit("mass", 0.000001, "mg", "mg milligram milligrams")
defineUnit("mass", 0.001, "g", "g gram grams")
defineUnit("mass", 1, "kg", "kg kilogram kilograms kilo kilos")
defineUnit("mass", 1000, "t", "t tonne tonnes")
defineUnit("mass", 0.028349523125, "oz", "oz ounce ounces")
defineUnit("mass", 0.45359237, "lb", "lb lbs pound pounds")
defineUnit("mass", 6.35029318, "st", "st stone stones")

// Volume, against the litre. The gallon and its subdivisions are the US ones,
// which is the reading anyone typing "gal" into a Linux menu almost certainly
// wants; the imperial gallon is spelled out.
defineUnit("volume", 0.001, "ml", "ml millilitre millilitres milliliter milliliters")
defineUnit("volume", 0.01, "cl", "cl centilitre centilitres")
defineUnit("volume", 0.1, "dl", "dl decilitre decilitres")
defineUnit("volume", 1, "l", "l litre litres liter liters")
defineUnit("volume", 3.785411784, "gal", "gal gallon gallons")
defineUnit("volume", 4.54609, "impgal", "impgal imperialgallon")
defineUnit("volume", 0.946352946, "qt", "qt quart quarts")
defineUnit("volume", 0.473176473, "pt", "pt pint pints")
defineUnit("volume", 0.2365882365, "cup", "cup cups")
defineUnit("volume", 0.0295735295625, "floz", "floz fluidounce fluidounces")
defineUnit("volume", 0.01478676478125, "tbsp", "tbsp tablespoon tablespoons")
defineUnit("volume", 0.00492892159375, "tsp", "tsp teaspoon teaspoons")

// Data, against the byte. Both the decimal and the binary ladders, because
// the difference between them is most of why anyone asks.
defineUnit("data", 0.125, "bit", "bit bits")
defineUnit("data", 1, "B", "b byte bytes")
defineUnit("data", 1000, "kB", "kb kilobyte kilobytes")
defineUnit("data", 1000000, "MB", "mb megabyte megabytes")
defineUnit("data", 1000000000, "GB", "gb gigabyte gigabytes")
defineUnit("data", 1000000000000, "TB", "tb terabyte terabytes")
defineUnit("data", 1024, "KiB", "kib kibibyte kibibytes")
defineUnit("data", 1048576, "MiB", "mib mebibyte mebibytes")
defineUnit("data", 1073741824, "GiB", "gib gibibyte gibibytes")
defineUnit("data", 1099511627776, "TiB", "tib tebibyte tebibytes")

// Speed, against the metre per second. Spelled without the slash: the grammar
// keeps "/" for arithmetic, so "km/h" could never reach this table.
defineUnit("speed", 1, "m/s", "mps")
defineUnit("speed", 0.2777777777777778, "km/h", "kmh kph")
defineUnit("speed", 0.44704, "mph", "mph")
defineUnit("speed", 0.5144444444444445, "kn", "kn knot knots")

// Time, against the second. The year is the Julian one, at 365.25 days.
defineUnit("time", 0.001, "ms", "ms millisecond milliseconds")
defineUnit("time", 1, "s", "s sec secs second seconds")
defineUnit("time", 60, "min", "min mins minute minutes")
defineUnit("time", 3600, "h", "h hr hrs hour hours")
defineUnit("time", 86400, "d", "d day days")
defineUnit("time", 604800, "wk", "wk week weeks")
defineUnit("time", 31557600, "yr", "yr year years")

// Area, against the square metre.
defineUnit("area", 1, "m²", "m2 sqm squaremetre squaremeter")
defineUnit("area", 1000000, "km²", "km2 sqkm")
defineUnit("area", 0.09290304, "ft²", "ft2 sqft squarefoot squarefeet")
defineUnit("area", 2589988.110336, "mi²", "mi2 sqmi")
defineUnit("area", 10000, "ha", "ha hectare hectares")
defineUnit("area", 4046.8564224, "acre", "acre acres")

defineTemperature("°C", "c celsius centigrade",
  function(v) { return v + 273.15 },
  function(k) { return k - 273.15 })
defineTemperature("°F", "f fahrenheit",
  function(v) { return (v - 32) * 5 / 9 + 273.15 },
  function(k) { return (k - 273.15) * 9 / 5 + 32 })
defineTemperature("K", "k kelvin",
  function(v) { return v },
  function(k) { return k })

// The degree sign is how a temperature is usually written and never how it is
// stored, so it comes off before the lookup.
function unitFor(token) {
  var name = String(token || "").trim().toLowerCase().replace(/^°/, "")
  if (!name) return null
  return Object.prototype.hasOwnProperty.call(UNITS, name) ? UNITS[name] : null
}

// Resolves only when both sides measure the same thing. That is what keeps
// this table and the currency one out of each other's way: "cup" is a volume
// here and the Cuban peso there, and only the pair it appears in says which.
// It also throws out the nonsense pairs -- "5 kg to km" has no answer.
function resolveUnitPair(fromToken, toToken) {
  var from = unitFor(fromToken)
  if (!from) return null

  var to = unitFor(toToken)
  if (!to || to.dimension !== from.dimension) return null

  return { from: from, to: to }
}

function parseUnitQuery(query) {
  return parseConversionQuery(query, resolveUnitPair)
}

function convertUnit(parsed) {
  if (!parsed || !parsed.from || !parsed.to) return null

  var value = parsed.from.dimension === "temperature"
    ? parsed.to.fromKelvin(parsed.from.toKelvin(parsed.amount))
    : parsed.amount * parsed.from.factor / parsed.to.factor

  if (typeof value !== "number" || !isFinite(value)) return null

  // The ratio between the two units, which is worth showing for everything
  // except temperature, where there isn't one.
  var rate = parsed.from.dimension === "temperature"
    ? 0
    : parsed.from.factor / parsed.to.factor

  return { value: value, rate: rate }
}

// Six significant digits: past what anyone measured to get the number in, and
// short of the noise that 0.1 + 0.2 leaves behind.
function formatUnitValue(value) {
  if (typeof value !== "number" || !isFinite(value)) return ""
  var text = String(parseFloat(value.toPrecision(6)))
  return text === "-0" ? "0" : text
}

// --- Utilities ---------------------------------------------------------------
// The small answers a terminal gets opened for: a UUID, a base64 round trip, a
// digest, an epoch read back as a date, a throwaway password. Each is a
// keyword and the rest of the line, and each is computed here rather than
// shelled out -- the argument is whatever was typed into a search field, and
// the calculator's rule about not letting that reach the shell holds here too.

// UTF-8 in and out, so text outside ASCII survives a base64 or digest round
// trip instead of being mangled a byte at a time.
function utf8Bytes(text) {
  var source = String(text)
  var bytes = []

  for (var i = 0; i < source.length; i++) {
    var code = source.charCodeAt(i)

    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < source.length) {
      var low = source.charCodeAt(i + 1)
      var full = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00)
      i += 1
      bytes.push(0xf0 | (full >> 18), 0x80 | ((full >> 12) & 0x3f),
                 0x80 | ((full >> 6) & 0x3f), 0x80 | (full & 0x3f))
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    }
  }

  return bytes
}

function utf8Text(bytes) {
  var out = ""
  var i = 0

  while (i < bytes.length) {
    var byte = bytes[i]
    var code = 0
    var extra = 0

    if (byte < 0x80) { code = byte; extra = 0 }
    else if ((byte & 0xe0) === 0xc0) { code = byte & 0x1f; extra = 1 }
    else if ((byte & 0xf0) === 0xe0) { code = byte & 0x0f; extra = 2 }
    else if ((byte & 0xf8) === 0xf0) { code = byte & 0x07; extra = 3 }
    else return null

    if (i + extra >= bytes.length) return null
    for (var k = 1; k <= extra; k++) {
      var next = bytes[i + k]
      if ((next & 0xc0) !== 0x80) return null
      code = (code << 6) | (next & 0x3f)
    }
    i += extra + 1

    if (code > 0xffff) {
      code -= 0x10000
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff))
    } else {
      out += String.fromCharCode(code)
    }
  }

  return out
}

// QML's JavaScript has no btoa/atob -- those belong to the browser -- so the
// codec is spelled out.
var BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function base64Encode(text) {
  var bytes = utf8Bytes(text)
  var out = ""

  for (var i = 0; i < bytes.length; i += 3) {
    var remaining = bytes.length - i
    var chunk = (bytes[i] << 16) | ((remaining > 1 ? bytes[i + 1] : 0) << 8) | (remaining > 2 ? bytes[i + 2] : 0)
    out += BASE64_ALPHABET.charAt((chunk >> 18) & 0x3f)
    out += BASE64_ALPHABET.charAt((chunk >> 12) & 0x3f)
    out += remaining > 1 ? BASE64_ALPHABET.charAt((chunk >> 6) & 0x3f) : "="
    out += remaining > 2 ? BASE64_ALPHABET.charAt(chunk & 0x3f) : "="
  }

  return out
}

// "" for anything that is not base64, which is most of what gets typed while
// a base64 string is still being typed.
function base64Decode(text) {
  var source = String(text || "").replace(/\s+/g, "").replace(/=+$/, "")
  if (!source || /[^A-Za-z0-9+/]/.test(source) || source.length % 4 === 1) return ""

  var bytes = []
  var buffer = 0
  var bits = 0

  for (var i = 0; i < source.length; i++) {
    buffer = (buffer << 6) | BASE64_ALPHABET.indexOf(source.charAt(i))
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }

  var decoded = utf8Text(bytes)
  return decoded === null ? "" : decoded
}

var SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]

function sha256RotateRight(value, count) {
  return ((value >>> count) | (value << (32 - count))) >>> 0
}

function sha256Hex(text) {
  var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
           0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  var bytes = utf8Bytes(text)
  var bitLength = bytes.length * 8

  bytes = bytes.slice(0)
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  // The length goes in as 64 bits big-endian. Anything typed into a search
  // field is far short of 2^32 bits, so the high word is always zero.
  bytes.push(0, 0, 0, 0,
             (bitLength >>> 24) & 0xff, (bitLength >>> 16) & 0xff,
             (bitLength >>> 8) & 0xff, bitLength & 0xff)

  var w = new Array(64)

  for (var offset = 0; offset < bytes.length; offset += 64) {
    for (var i = 0; i < 16; i++) {
      w[i] = ((bytes[offset + i * 4] << 24) | (bytes[offset + i * 4 + 1] << 16)
            | (bytes[offset + i * 4 + 2] << 8) | bytes[offset + i * 4 + 3]) >>> 0
    }
    for (i = 16; i < 64; i++) {
      var s0 = (sha256RotateRight(w[i - 15], 7) ^ sha256RotateRight(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0
      var s1 = (sha256RotateRight(w[i - 2], 17) ^ sha256RotateRight(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }

    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7]

    for (i = 0; i < 64; i++) {
      var S1 = (sha256RotateRight(e, 6) ^ sha256RotateRight(e, 11) ^ sha256RotateRight(e, 25)) >>> 0
      var ch = ((e & f) ^ (~e & g)) >>> 0
      var temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0
      var S0 = (sha256RotateRight(a, 2) ^ sha256RotateRight(a, 13) ^ sha256RotateRight(a, 22)) >>> 0
      var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      var temp2 = (S0 + maj) >>> 0

      hh = g; g = f; f = e
      e = (d + temp1) >>> 0
      d = c; c = b; b = a
      a = (temp1 + temp2) >>> 0
    }

    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0
  }

  var out = ""
  for (i = 0; i < 8; i++) {
    var hex = h[i].toString(16)
    while (hex.length < 8) hex = "0" + hex
    out += hex
  }

  return out
}

// Version 4, from bytes the caller got somewhere better than Math.random.
function uuidFromBytes(bytes) {
  if (!bytes || bytes.length < 16) return ""

  var b = bytes.slice(0, 16)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80

  var hex = []
  for (var i = 0; i < 16; i++) hex.push((b[i] < 16 ? "0" : "") + b[i].toString(16))

  return hex.slice(0, 4).join("") + "-" + hex.slice(4, 6).join("") + "-"
       + hex.slice(6, 8).join("") + "-" + hex.slice(8, 10).join("") + "-"
       + hex.slice(10, 16).join("")
}

// No l/I/1 or O/0: a password gets read off a screen and typed somewhere else
// at least once.
var PASSWORD_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+?"

// "" when the bytes ran out, which tells the caller to go and get more rather
// than quietly returning a shorter password than was asked for.
function passwordFromBytes(bytes, length) {
  if (!bytes || !(length > 0)) return ""

  var alphabet = PASSWORD_ALPHABET
  // Bytes past the last whole multiple of the alphabet would make the
  // characters at the start of it slightly likelier, so they are thrown away
  // rather than folded back in with a modulo.
  var limit = Math.floor(256 / alphabet.length) * alphabet.length
  var out = ""

  for (var i = 0; i < bytes.length && out.length < length; i++) {
    if (bytes[i] >= limit) continue
    out += alphabet.charAt(bytes[i] % alphabet.length)
  }

  return out.length === length ? out : ""
}

var UTILITY_KEYWORDS = ("uuid base64 b64 b64d unbase64 urlencode urldecode "
  + "sha256 epoch password").split(" ")

// { keyword, argument } for a query that opens with one of the keywords, or
// null. The keyword has to be the whole first word -- "passwords" is a search
// for the menu, not a request for one.
function parseUtilityQuery(query) {
  var text = String(query || "").trim()
  if (!text) return null

  var match = text.match(/^([a-z0-9]+)(?:\s+([\s\S]*))?$/i)
  if (!match) return null

  var keyword = match[1].toLowerCase()
  if (UTILITY_KEYWORDS.indexOf(keyword) < 0) return null

  return { keyword: keyword, argument: (match[2] || "").trim() }
}

// Epoch seconds, milliseconds or neither. Ten digits is a timestamp in
// seconds and thirteen is one in milliseconds; the split at 1e11 tells them
// apart without either having to be spelled out.
function epochMilliseconds(argument) {
  var raw = String(argument || "").trim()
  if (!/^\d{1,15}$/.test(raw)) return null

  var value = parseInt(raw, 10)
  if (!isFinite(value) || value <= 0) return null

  return value < 100000000000 ? value * 1000 : value
}

// --- Time zones --------------------------------------------------------------
// "time in tokyo". The engine QML runs has no Intl -- `toLocaleString` takes a
// timeZone option and quietly ignores it -- so the zone database is the
// system's own: the list of zones comes from timedatectl and each zone's
// current offset from `date`, both cached, and the clock arithmetic is done
// here from the offset.

// The abbreviations people type that are not the name of a city. Everything
// else is matched against the real zone list.
var ZONE_ALIASES = {
  utc: "UTC", gmt: "UTC", z: "UTC", zulu: "UTC",
  cet: "Europe/Paris", cest: "Europe/Paris",
  eet: "Europe/Helsinki", eest: "Europe/Helsinki",
  bst: "Europe/London", uk: "Europe/London",
  est: "America/New_York", edt: "America/New_York", et: "America/New_York",
  cst: "America/Chicago", cdt: "America/Chicago", ct: "America/Chicago",
  mst: "America/Denver", mdt: "America/Denver",
  pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pt: "America/Los_Angeles",
  ist: "Asia/Kolkata", jst: "Asia/Tokyo", kst: "Asia/Seoul",
  aest: "Australia/Sydney", aedt: "Australia/Sydney",
  nyc: "America/New_York", sf: "America/Los_Angeles", la: "America/Los_Angeles"
}

function parseTimeQuery(query) {
  var match = String(query || "").trim().match(/^(?:time|now|clock)\s+(?:in\s+|at\s+)?(\S[\s\S]*)$/i)
  return match ? match[1].trim() : null
}

// The city half of a zone name, as somebody would type it: "America/New_York"
// is asked for as "new york".
function zoneCityName(zone) {
  var parts = String(zone).split("/")
  return parts[parts.length - 1].replace(/_/g, " ").toLowerCase()
}

// Best zone for what was typed, or "" for a place the system has never heard
// of. Exact beats city-exact beats a city that starts with it, so "york" does
// not win over "new york" and a half-typed name still finds something.
function resolveZone(place, zones) {
  var wanted = String(place || "").trim().toLowerCase().replace(/\s+/g, " ")
  if (!wanted) return ""

  if (Object.prototype.hasOwnProperty.call(ZONE_ALIASES, wanted)) return ZONE_ALIASES[wanted]
  if (!zones || zones.length === 0) return ""

  var slashed = wanted.replace(/ /g, "_")
  var startsWith = ""

  for (var i = 0; i < zones.length; i++) {
    var zone = zones[i]
    var lower = zone.toLowerCase()
    if (lower === wanted || lower === slashed) return zone

    var city = zoneCityName(zone)
    if (city === wanted) return zone
    if (!startsWith && city.indexOf(wanted) === 0) startsWith = zone
  }

  return startsWith
}

// "+0900" or "-0430" as seconds. Returns null for anything else, so a `date`
// that failed cannot be read as UTC.
function parseZoneOffset(text) {
  var match = String(text || "").trim().match(/^([+-])(\d{2})(\d{2})$/)
  if (!match) return null

  var seconds = parseInt(match[2], 10) * 3600 + parseInt(match[3], 10) * 60
  return match[1] === "-" ? -seconds : seconds
}

function padTwo(value) {
  return (value < 10 ? "0" : "") + value
}

// Wall clock in a zone, worked out from the offset rather than from any local
// notion of where the date falls. The UTC getters are doing real work here:
// the Date is deliberately shifted, so reading it back in local time would
// apply this machine's offset a second time.
function zoneClock(utcMilliseconds, offsetSeconds) {
  var shifted = new Date(utcMilliseconds + offsetSeconds * 1000)

  return {
    time: padTwo(shifted.getUTCHours()) + ":" + padTwo(shifted.getUTCMinutes()),
    weekday: shifted.getUTCDay(),
    date: shifted.getUTCDate(),
    month: shifted.getUTCMonth(),
    year: shifted.getUTCFullYear()
  }
}

var ZONE_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

// A function rather than the bare array: QML sees the top level declarations
// of this file directly, and the module.exports block at the bottom -- which
// is what the node tests read -- does not exist there.
function zoneWeekdayName(index) {
  return ZONE_WEEKDAYS[index] || ""
}

// How far ahead or behind the other place is, in the words someone would use:
// a whole number of hours where it is one, and the odd half hour where it is
// not, because plenty of the world is not on the hour.
function zoneDifference(offsetSeconds, localOffsetSeconds) {
  var delta = offsetSeconds - localOffsetSeconds
  if (delta === 0) return "same time as here"

  var ahead = delta > 0
  var minutes = Math.abs(delta) / 60
  var hours = Math.floor(minutes / 60)
  var rest = minutes % 60

  var amount = hours ? (hours + (hours === 1 ? " hour" : " hours")) : ""
  if (rest) amount += (amount ? " " : "") + rest + " min"

  return amount + (ahead ? " ahead" : " behind")
}

if (typeof module !== "undefined") {
  module.exports = {
    tokenizeMath: tokenizeMath,
    formatMathResult: formatMathResult,
    evaluateMath: evaluateMath,
    groupThousands: groupThousands,
    formatMoney: formatMoney,
    currencyCodeFor: currencyCodeFor,
    parseCurrencyQuery: parseCurrencyQuery,
    convertCurrency: convertCurrency,
    formatCurrencyValue: formatCurrencyValue,
    formatCurrencyRate: formatCurrencyRate,
    parseCurrencyRates: parseCurrencyRates,
    currencyRatesStale: currencyRatesStale,
    parseConversionQuery: parseConversionQuery,
    unitFor: unitFor,
    parseUnitQuery: parseUnitQuery,
    convertUnit: convertUnit,
    formatUnitValue: formatUnitValue,
    base64Encode: base64Encode,
    base64Decode: base64Decode,
    sha256Hex: sha256Hex,
    uuidFromBytes: uuidFromBytes,
    passwordFromBytes: passwordFromBytes,
    parseUtilityQuery: parseUtilityQuery,
    epochMilliseconds: epochMilliseconds,
    parseTimeQuery: parseTimeQuery,
    resolveZone: resolveZone,
    parseZoneOffset: parseZoneOffset,
    zoneClock: zoneClock,
    zoneWeekdayName: zoneWeekdayName,
    zoneDifference: zoneDifference
  }
}
