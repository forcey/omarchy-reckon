# Reckon

A pop-up answer box for Omarchy. Press a hotkey (or click the calculator in the
bar), type a sum, a conversion or a small question, and the answer appears
underneath. Enter (or a click) copies it to the clipboard and closes the box;
Escape clears the query, then closes. The empty box suggests a few things to
try, different each time it opens.

The query is an ordinary text field: move the caret with Left/Right, Home/End
or Ctrl+Left/Right, select with Shift, click to place it, and edit anywhere in
the line. Ctrl+V (or Shift+Insert) pastes at the caret; Ctrl+U clears back to
the start.

Forked from the answer engine of
[dzhibas.menu](https://github.com/dzhibas/omarchy.dzhibas.menu), without the
menu around it: it is its own overlay (`forcey.reckon`), so the stock Omarchy
menu stays exactly as it is.

## Install

```bash
omarchy plugin add https://github.com/forcey/omarchy-reckon --enable
```

This clones the plugin, enables it, and puts a calculator button on the right
of the bar.

### Hotkey

Add a binding to `~/.config/hypr/bindings.lua` (Hyprland reloads it on save):

```lua
o.bind("SUPER + ALT + C", "Reckon", "omarchy-shell shell toggle forcey.reckon")
```

`SUPER + ALT + C` is free on a stock Omarchy install. To use a chord that is
already taken, unbind it first, e.g. `hl.unbind("SUPER + R")` on the line
above. `omarchy menu keybindings` shows what is bound already, and
`hyprctl configerrors` will say if the line has a problem.

### Bar button

The button can be moved like any other widget, e.g.
`omarchy bar move forcey.reckon --section left`. It stays on the bar while the
plugin is enabled: removing it from the bar disables the whole plugin, hotkey
included.

### Opening it from scripts

```bash
omarchy-shell shell toggle forcey.reckon
omarchy-shell shell summon forcey.reckon '{"query":"100 usd to eur"}'
```

### Update and remove

```bash
omarchy plugin update forcey.reckon
omarchy plugin remove forcey.reckon
```

Remove the `o.bind` line from `bindings.lua` too.

## Features

### Calculator

| Type | Get |
| --- | --- |
| `2+3` | `5` |
| `sqrt(144)+2^8` | `268` |
| `(1920*1080)/2` | `1036800` |
| `$10.10 + $0.40` | `$10.50` |
| `sin(30)` | `0.5` (degrees) and `-0.988031624093` (radians) |
| `asin(0.5)` | `30` (degrees) and `0.523598775598` (radians) |

Figures pasted from a statement work as they are. Commas are thousands
separators, but only in strict groups of three — `1,5` is refused rather than
guessed at. A currency symbol may lead a number (`$` `€` `£` `¥` `₹` …, and
`-$40` or `$-40`), as long as the whole expression uses the same one. When the
input used separators or a symbol, so does the answer, and the answer is what
Enter copies.

Trigonometry answers twice, once with angles in degrees and once in radians,
each row labelled. Up/Down (or Tab) picks one and Enter copies it; the pick
sticks while you keep editing. Degrees come first unless the expression
mentions `pi` or `tau`. A reading with no value — `tan(90)` in degrees — is
left out.

Operators `+ - * / % ^`, parentheses, unary signs, the constants `pi` `tau` `e`,
and the functions `sqrt cbrt abs round floor ceil exp ln log log2 sin cos tan
asin acos atan`.

The expression is parsed by hand rather than handed to the JavaScript engine
that runs your shell — nothing typed into the search field is ever evaluated as
code. A bare number stays a search term.


### Unit conversion

| Type | Get |
| --- | --- |
| `100 km to miles` | `62.1371 mi` |
| `20 c to f` | `68 °F` |
| `5 gb to mb` | `5000 MB` |
| `1 tb to gib` | `931.323 GiB` |
| `70 kg to lb` | `154.324 lb` |
| `2 cup to ml` | `473.176 ml` |
| `1 nm to km` | `1.852 km` |

Length, mass, volume, temperature, data, speed, time and area. Data covers both
the decimal (`kb mb gb tb`) and binary (`kib mib gib tib`) ladders, because the
difference between them is most of why anyone asks. Units take their full names
too — `miles`, `pounds`, `celsius`, `kilometres`. No network, no cache.


### Currency conversion

| Type | Get |
| --- | --- |
| `123 eur to usd` | `143.31 USD` · `123 EUR at 1.1651 · 28 Aug` |
| `123USD to eur` | `105.57 EUR` |
| `$120 to eur` | `102.99 EUR` |
| `50 euros to dollars` | `58.26 USD` |
| `(20+5) eur to usd` | `29.13 USD` |
| `eur to usd` | Today's rate for one unit |


166 currencies, any pair. Codes, symbols (`$ € £ ¥ ₹ ₽ ₴ zł`) and names all
work, and the amount can be any expression the calculator understands.

Rates come from [exchangerate-api's free daily
endpoint](https://open.er-api.com/v6/latest/EUR) — no API key — and are cached
at `~/.cache/omarchy/reckon-exchange-rates.json`. **The fetch happens the first
time you actually type a conversion**, so a box never used as a converter
never touches the network; after that it refreshes about once a day. Offline,
the row says so rather than showing a stale number without warning.

Amounts take thousands separators the same way the calculator does
(`$1,200 to eur`). Crypto is not supported — the rate source is fiat only.

### Time zones

| Type | Get |
| --- | --- |
| `utc` | `17:13` · `UTC · 7 hours ahead` |
| `tokyo` | `02:13 Tue` · `Asia/Tokyo (JST) · 16 hours ahead` |
| `time in pst` | `10:13` · `America/Los_Angeles (PDT) · same time as here` |
| `14:00 mst in pst` | `13:00` · `14:00 Denver MDT → Los Angeles PDT` |
| `2pm est to utc` | `6pm` · `2pm New York EDT → UTC` |
| `11pm pst to tokyo` | `3pm next day` |
| `9am london` | `1am` · `9am London BST → local PDT` |

Any city the system knows — the zone list comes from `timedatectl` — plus the
usual abbreviations (`utc`, `cet`, `est`, `cst`, `mst`, `pst`, `ist`, `jst`,
`aest`). A zone typed on its own has to be the whole name (`tokyo`, not `tok`);
after `time in` or in a conversion, the start of a city name is enough.

A conversion is a time with a colon or an am/pm, a place, and optionally `in`,
`to` or `->` and a second place. Leave either place out and it means local
time. Answers come back on the same clock face the question used.

Abbreviations name a region rather than a fixed offset: `est` is New York and
`mst` is Denver, so in summer they follow daylight saving time. The answer
shows the abbreviation that was actually applied (`MDT`) so this is never a
surprise. Conversions use the offsets in force today.

### Developer utilities

| Type | Get |
| --- | --- |
| `uuid` | A random UUID v4 |
| `password 24` | A 24-character password |
| `sha256 omarchy` | `382a803dcc0de9…` |
| `base64 hello world` | `aGVsbG8gd29ybGQ=` |
| `b64d aGVsbG8=` | `hello` |
| `urlencode a b&c` | `a%20b%26c` |
| `urldecode a%20b` | `a b` |
| `epoch` | Current epoch seconds |
| `epoch 1787875351` | `Fri 28 Aug 2026 03:02:31` |

Keywords: `uuid` `password` `sha256` `base64` `b64` `b64d` `unbase64`
`urlencode` `urldecode` `epoch`.

Random bytes come from `/dev/urandom`, not `Math.random`, so `password` is
worth trusting. The answer holds still while you finish typing and is new the
next time you open the box.
