# Reckon

A pop-up answer box for Omarchy. Press a hotkey (or click the calculator in the
bar), type a sum, a conversion or a small question, and the answer appears
underneath. Enter (or a click) copies it to the clipboard and closes the box;
Escape clears the query, then closes.

Forked from the answer engine of
[dzhibas.menu](https://github.com/dzhibas/omarchy.dzhibas.menu), without the
menu around it: it is its own overlay (`forcey.reckon`), so the stock Omarchy
menu stays exactly as it is.

## Install

```bash
omarchy plugin add https://github.com/forcey/omarchy-reckon --enable
~/.config/omarchy/plugins/forcey.reckon/bind-hotkey
```

The first line clones the plugin, enables it, and puts a calculator button on
the right of the bar. The second binds **Super + Alt + C** to open it. Omarchy
plugins have no install hook, so the hotkey is this one extra command.

### Hotkey

`bind-hotkey` writes one marked block to `~/.config/hypr/bindings.lua` (after
backing the file up) and reloads Hyprland. Running it again replaces the block
rather than adding a second one.

```bash
cd ~/.config/omarchy/plugins/forcey.reckon
./bind-hotkey                      # Super + Alt + C
./bind-hotkey "SUPER + EQUAL"      # any other chord
./bind-hotkey --force "SUPER + R"  # take a chord that is already bound
./bind-hotkey --remove             # remove the hotkey
```

It refuses a chord that is already bound and says what it is bound to; `--force`
unbinds the old action first. Prefer to do it by hand? Add this to
`bindings.lua`:

```lua
o.bind("SUPER + ALT + C", "Reckon", "omarchy-shell shell toggle forcey.reckon")
```

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
~/.config/omarchy/plugins/forcey.reckon/bind-hotkey --remove
omarchy plugin remove forcey.reckon
```

## Features

### Calculator

| Type | Get |
| --- | --- |
| `2+3` | `5` |
| `sqrt(144)+2^8` | `268` |
| `(1920*1080)/2` | `1036800` |

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

Commas are not accepted in amounts: `1,000` means one thousand in half of
Europe and one-point-nought in the other half, and neither reading is worth
guessing at. Crypto is not supported — the rate source is fiat only.

### Time zones

| Type | Get |
| --- | --- |
| `time in tokyo` | `18:13` · `Asia/Tokyo · 6 hours ahead` |
| `now in utc` | `09:13` · `UTC · 3 hours behind` |
| `time in pst` | `02:13` · `America/Los_Angeles · 10 hours behind` |

Any city the system knows — the zone list comes from `timedatectl` — plus the
usual abbreviations (`utc`, `cet`, `est`, `pst`, `ist`, `jst`, `aest`). The day
is shown alongside the time when it isn't today's.


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
