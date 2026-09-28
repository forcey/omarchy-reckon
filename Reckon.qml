import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import qs.Commons
import qs.Ui
import "Engine.js" as Engine

// Reckon: a pocket answer box. Type a sum, a conversion or a small question,
// and the answer appears underneath; Enter copies it and closes. Forked from
// the answer engine of dzhibas.menu, without the menu around it, so it sits
// beside the stock Omarchy menu rather than replacing it.
Item {
  id: root

  // Injected by omarchy-shell when this plugin is summoned.
  property var shell: null
  property var manifest: null

  // Plugin lifecycle hooks. The host calls open(payloadJson) after
  // `omarchy-shell shell summon forcey.reckon` and close() when hidden.
  // A payload may carry a starting query: '{"query":"100 usd to eur"}'.
  function open(payloadJson) {
    var payload = ({})
    try { payload = JSON.parse(payloadJson || "{}") } catch (e) { payload = ({}) }

    if (payload.fontFamily) root.fontFamily = payload.fontFamily
    root.opened = true
    root.setFilter(payload.query ? String(payload.query).slice(0, 512) : "")
    Qt.callLater(function() { queryInput.forceActiveFocus() })
  }

  function close() {
    root.cancel()
  }

  function ping() { return "ok" }

  property string fontFamily: Style.font.menuFamily
  property bool opened: false
  property string filterText: ""
  // The one row under the query: what it came to, or null for a query that
  // is not a question Reckon knows how to answer.
  property var answer: null
  readonly property bool answerReady: !!root.answer && !root.answer.disabled

  onOpenedChanged: if (!opened) utilityAnswers = ({})

  // Currency conversion typed into the search: "123 eur to usd". The rates
  // behind it are exchangerate-api's free daily snapshot, which needs no key,
  // cached under ~/.cache and refetched about once a day.
  readonly property string currencyRatesUrl: "https://open.er-api.com/v6/latest/EUR"
  readonly property string currencyRatesPath: (Quickshell.env("XDG_CACHE_HOME") || (Quickshell.env("HOME") + "/.cache")) + "/omarchy/reckon-exchange-rates.json"
  property bool currencyCacheRead: false
  property var currencyRates: null
  property bool currencyFetchFailed: false
  property real currencyFetchedAt: 0

  // Randomness for the rows that make some. Math.random is not something to
  // build a password out of, so bytes come from /dev/urandom in bulk and are
  // drawn down from a pool; a row that needs more than is left says so and
  // waits rather than making do with less.
  property var randomPool: []
  property real randomFetchedAt: 0
  // A generated answer must not change while the query that asked for it is
  // still being typed, so each is kept against the query that produced it --
  // and thrown away when the box closes, so the next one is new.
  property var utilityAnswers: ({})
  // The system's zone database, borrowed rather than reimplemented: the zone
  // list from timedatectl, and each zone's current offset from `date`. The
  // engine QML runs has no Intl, so the offset is what the clock is built on.
  property var timeZones: []
  property var zoneOffsets: ({})
  property real localZoneOffset: 0

  // Bound to the central [menu] section in shell.toml via Color.qml, so the
  // box wears the same theme as the Omarchy menu.
  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color border: Color.menu.border
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Color.menu.scrim
  property color selectedBackground: Color.menu.selectedBackground
  property color selectedText: Color.menu.selectedText
  property color selectedBorder: Color.menu.selectedBorder
  property var selectedBorderSpec: Border.surfaceSpec("menu", "selected-border", selectedBorder, 0)
  readonly property real rowReservedBorderLeft: Border.left(selectedBorderSpec)
  readonly property real rowReservedBorderRight: Border.right(selectedBorderSpec)
  readonly property int cornerRadius: Style.cornerRadius
  property int contentMargin: Style.spacing.panelPadding
  property int headerHeight: Math.max(Style.space(34), Style.font.title + Style.spacing.controlPaddingY * 2)
  property int contentSpacing: Style.spacing.md
  // One row, always the same height whether it holds an answer or the hint,
  // so the card never jumps while typing.
  property int answerHeight: Math.max(Style.space(58), Style.font.body + Style.font.caption + Style.spacing.rowPaddingX * 2)
  property int cardWidth: Math.min(Style.space(420), panel.width - Style.gapsOut * 2)
  property int cardHeight: contentMargin * 2 + headerHeight + contentSpacing + answerHeight

  // ------------------------------------------------------------------
  // Reading files off disk.
  //
  // The rate cache sits under ~/.cache, somewhere another process can
  // arrange. A pathname is only ever a hint -- checking it and then opening it
  // by name again is two separate resolutions of that hint, and whatever sits
  // at the path can change in between. So the path is resolved exactly once:
  // open first, then every check -- and the read itself -- work off that same
  // descriptor, never the name again.
  //
  // O_NOFOLLOW on the open rejects a symlink at the final component outright,
  // so a swap cannot redirect it to another file. O_NONBLOCK means a FIFO or
  // device planted at the path returns from the open instead of blocking the
  // thread that draws the box. The fstat that follows reads the open
  // descriptor -- regular file, ours or root's, within the ceiling -- which
  // describes the bytes about to be read rather than whatever the name
  // resolves to by then. timeout remains as the backstop for a descriptor
  // that opened clean but stalls on read, e.g. a hung network mount.
  readonly property int currencyFileCeiling: 262144  // 256 KiB of rates
  readonly property int fileReadDeadline: 5          // seconds

  // perl is a hard dependency of the omarchy package itself, so it is always
  // present -- no fallback path that would reintroduce a weaker read. Path
  // and byte ceiling arrive as argv, never interpolated into a script, so
  // there is no shell and nothing here to quote.
  readonly property string fileReaderProgram: [
    'use Fcntl;',
    'my ($path, $max) = @ARGV;',
    'sysopen(my $fh, $path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK) or exit 1;',
    'my @st = stat($fh) or exit 1;',
    'exit 1 unless -f _;',
    'exit 1 unless $st[4] == $< || $st[4] == 0;',
    'exit 1 if $st[7] > $max;',
    'my $out = "";',
    'while (length($out) < $max) {',
    '  my $n = sysread($fh, my $chunk, $max - length($out));',
    '  exit 1 unless defined $n;',
    '  last if $n == 0;',
    '  $out .= $chunk;',
    '}',
    'print $out;'
  ].join("\n")

  function readFileCommand(path, maxBytes) {
    return ["timeout", String(root.fileReadDeadline),
            "perl", "-e", root.fileReaderProgram,
            "--", path, String(maxBytes)]
  }

  // ------------------------------------------------------------------
  // Running helpers.
  //
  // Every helper below writes to a pipe this shell drains on the thread that
  // draws the box, so each is bounded twice: `timeout` ends one that stalls,
  // and `head -c` ends output that will not stop on its own.
  readonly property int helperDeadline: 10           // seconds
  readonly property int helperOutputCeiling: 262144  // 256 KiB

  function boundedCommand(script, seconds, maxBytes) {
    return ["bash", "-c",
      'timeout ' + (seconds > 0 ? seconds : root.helperDeadline)
      + ' bash -c ' + Util.shellQuote(script)
      + ' | head -c ' + (maxBytes > 0 ? maxBytes : root.helperOutputCeiling)]
  }

  function loadCurrencyCache() {
    if (currencyCacheProc.running) return
    currencyCacheProc.command = root.readFileCommand(root.currencyRatesPath, root.currencyFileCeiling)
    currencyCacheProc.running = true
  }

  // Every answer has the same shape, so only the icon, the two lines of text
  // and what gets copied are worth writing out each time.
  function queryRow(spec) {
    return Engine.sanitizeRow({
      // A row still waiting on something it needs cannot be copied yet.
      disabled: spec.ready === false,
      kind: spec.kind,
      icon: spec.icon,
      label: spec.label,
      // The label is written to be read, and it is rarely the exact text that
      // is wanted on the clipboard, so the payload travels separately.
      target: spec.payload || "",
      detail: spec.detail || ""
    })
  }

  // The questions, in the order they get asked. Each builder takes the query
  // and returns a row, or null for a query it does not recognise; the first
  // one that recognises it wins.
  //
  // Order settles the overlaps. Arithmetic goes first because it is the
  // strictest grammar. Currency goes before units so that "100 cup to eur" is
  // the Cuban peso, while units still take "2 cup to ml" -- currency declines
  // it, since "ml" is not money.
  function answerFor(query) {
    if (!query) return null

    var builders = [
      root.calculatorRow,
      root.currencyRow,
      root.unitRow,
      root.timeRow,
      root.utilityRow
    ]

    for (var i = 0; i < builders.length; i++) {
      // These parse whatever was typed, and a throw in one of them should cost
      // that one answer, not the box. Log it and carry on without it.
      try {
        var produced = builders[i](query)
        if (produced) return produced
      } catch (e) {
        console.warn("forcey.reckon: answer builder failed:", e)
      }
    }

    return null
  }

  function refreshAnswer() {
    root.answer = root.answerFor(root.filterText.trim())
  }

  function calculatorRow(query) {
    var result = Engine.evaluateMath(query)
    if (!result) return null

    return root.queryRow({
      kind: "calc",
      icon: "󰃬",
      label: result,
      detail: "Copy to clipboard"
    })
  }

  // Currency's twin, answered from a table that ships with the plugin: no
  // network, no cache, and an answer on the first keystroke that completes the
  // query. A pair is only a unit conversion when both sides measure the same
  // thing, which is what keeps it from arguing with the currency table.
  function unitRow(query) {
    var parsed = Engine.parseUnitQuery(query)
    if (!parsed) return null

    var converted = Engine.convertUnit(parsed)
    if (!converted) return null

    var asked = Engine.formatMathResult(parsed.amount) + " " + parsed.from.symbol
    // Temperature scales disagree about zero, so there is no ratio between
    // them to show and the row just restates what was asked.
    var detail = converted.rate
      ? asked + " at " + Engine.formatUnitValue(converted.rate)
      : asked

    return root.queryRow({
      kind: "unit",
      icon: "󰓡",
      label: Engine.formatUnitValue(converted.value) + " " + parsed.to.symbol,
      detail: detail,
      payload: Engine.formatUnitValue(converted.value)
    })
  }

  // The small answers a terminal usually gets opened for. A keyword and the
  // rest of the line.
  function utilityRow(query) {
    var parsed = Engine.parseUtilityQuery(query)
    if (!parsed) return null

    var answer = root.utilityAnswer(query, parsed)
    if (!answer) return null

    if (answer === "pending") {
      return root.queryRow({
        kind: "util",
        icon: "󰅴",
        label: parsed.keyword,
        detail: "Gathering randomness…",
        ready: false
      })
    }

    return root.queryRow({
      kind: "util",
      icon: "󰅴",
      label: answer.label,
      detail: answer.detail,
      payload: answer.copy
    })
  }

  function utilityAnswer(query, parsed) {
    if (Object.prototype.hasOwnProperty.call(root.utilityAnswers, query))
      return root.utilityAnswers[query]

    var answer = root.computeUtility(parsed)
    // A row still waiting on /dev/urandom has no answer to remember yet.
    if (answer === "pending") return answer

    root.utilityAnswers[query] = answer
    return answer
  }

  // Returns the answer, "pending" while the randomness for it is still being
  // read, or null for a keyword that was given nothing to work on.
  function computeUtility(parsed) {
    var argument = parsed.argument
    var keyword = parsed.keyword

    if (keyword === "uuid") {
      if (argument) return null
      if (!root.ensureRandomBytes(16)) return "pending"
      var uuid = Engine.uuidFromBytes(root.takeRandomBytes(16))
      return { label: uuid, detail: "Random UUID v4", copy: uuid }
    }

    if (keyword === "password") {
      var length = argument ? parseInt(argument, 10) : 20
      if (!(length > 0)) return null
      length = Math.min(length, 64)
      // Three bytes per character leaves room for the ones rejection sampling
      // throws away, with plenty of margin.
      var needed = length * 3
      if (!root.ensureRandomBytes(needed)) return "pending"
      var password = Engine.passwordFromBytes(root.takeRandomBytes(needed), length)
      if (!password) return "pending"
      return { label: password, detail: length + " random characters", copy: password }
    }

    if (keyword === "base64" || keyword === "b64") {
      if (!argument) return null
      var encoded = Engine.base64Encode(argument)
      return { label: encoded, detail: "base64 of “" + argument + "”", copy: encoded }
    }

    if (keyword === "b64d" || keyword === "unbase64") {
      if (!argument) return null
      var decoded = Engine.base64Decode(argument)
      if (!decoded) return null
      return { label: decoded, detail: "Decoded from base64", copy: decoded }
    }

    if (keyword === "urlencode") {
      if (!argument) return null
      var escaped = encodeURIComponent(argument)
      return { label: escaped, detail: "Percent-encoded", copy: escaped }
    }

    if (keyword === "urldecode") {
      if (!argument) return null
      var unescaped = ""
      try { unescaped = decodeURIComponent(argument) } catch (e) { return null }
      return { label: unescaped, detail: "Percent-decoded", copy: unescaped }
    }

    if (keyword === "sha256") {
      if (!argument) return null
      var digest = Engine.sha256Hex(argument)
      return { label: digest, detail: "SHA-256 of “" + argument + "”", copy: digest }
    }

    if (keyword === "epoch") {
      if (!argument) {
        var now = String(Math.floor(Date.now() / 1000))
        return {
          label: now,
          detail: "Seconds since 1970 · " + Qt.formatDateTime(new Date(), "d MMM HH:mm:ss"),
          copy: now
        }
      }
      var milliseconds = Engine.epochMilliseconds(argument)
      if (milliseconds === null) return null
      var when = Qt.formatDateTime(new Date(milliseconds), "ddd d MMM yyyy HH:mm:ss")
      return { label: when, detail: "Local time for " + argument, copy: when }
    }

    return null
  }

  // True when the pool can already cover `needed`. When it cannot, one read of
  // /dev/urandom is started and the answer waits for it.
  function ensureRandomBytes(needed) {
    if (root.randomPool.length >= needed) return true
    if (randomProc.running) return false

    var now = Math.floor(Date.now() / 1000)
    // Every keystroke asks, so a read that failed must not be retried by the
    // next character typed.
    if (now - root.randomFetchedAt < 5) return false
    root.randomFetchedAt = now

    randomProc.command = root.boundedCommand("od -An -v -tu1 -N 1024 /dev/urandom", 5, 16384)
    randomProc.running = true
    return false
  }

  function takeRandomBytes(count) {
    if (root.randomPool.length < count) return null

    var taken = root.randomPool.slice(0, count)
    root.randomPool = root.randomPool.slice(count)
    // Top up before the pool is empty, so the next answer does not have to
    // wait on a read that could have happened already.
    if (root.randomPool.length < 256) root.ensureRandomBytes(1024)
    return taken
  }

  // "time in tokyo". Two things have to be fetched before this can answer --
  // the zone list once, then the zone's offset -- and each one that is missing
  // shows as a row that says so rather than as nothing at all.
  function timeRow(query) {
    var place = Engine.parseTimeQuery(query)
    if (place === null) return null

    if (!root.ensureTimeZones()) return root.timePendingRow(place)

    var zone = Engine.resolveZone(place, root.timeZones)
    if (!zone) return null

    if (!root.ensureZoneOffset(zone)) return root.timePendingRow(place)

    var offset = root.zoneOffsets[zone].offset
    var there = Engine.zoneClock(Date.now(), offset)
    var here = Engine.zoneClock(Date.now(), root.localZoneOffset)
    // The day only earns a place on the line when it is not today's.
    var sameDay = there.date === here.date && there.month === here.month && there.year === here.year
    var weekday = Engine.zoneWeekdayName(there.weekday).slice(0, 3)

    return root.queryRow({
      kind: "time",
      icon: "󰅐",
      label: sameDay ? there.time : there.time + " " + weekday,
      detail: zone + " · " + Engine.zoneDifference(offset, root.localZoneOffset),
      payload: there.time
    })
  }

  function timePendingRow(place) {
    return root.queryRow({
      kind: "time",
      icon: "󰅐",
      label: place,
      detail: "Reading the zone database…",
      ready: false
    })
  }

  function ensureTimeZones() {
    if (root.timeZones.length > 0) return true
    if (!zoneListProc.running) zoneListProc.running = true
    return false
  }

  // Offsets are re-read after half an hour. They only move when a zone enters
  // or leaves summer time, and a shell that has been up for a week should not
  // still be an hour out because of it.
  function ensureZoneOffset(zone) {
    var known = root.zoneOffsets[zone]
    var now = Math.floor(Date.now() / 1000)
    if (known && now - known.readAt < 1800) return true
    if (zoneOffsetProc.running) return false

    zoneOffsetProc.zone = zone
    zoneOffsetProc.command = root.boundedCommand(
      "TZ=" + Util.shellQuote(zone) + " date +%z; date +%z", 5, 256)
    zoneOffsetProc.running = true
    return false
  }

  // The other question that answers itself, give or take a table of rates.
  // The first conversion anyone types asks for the rates and stands in for the
  // answer until they land, and every one after it reads the cached snapshot.
  function currencyRow(query) {
    var parsed = Engine.parseCurrencyQuery(query)
    if (!parsed) return null

    root.ensureCurrencyRates()

    var snapshot = root.currencyRates
    var converted = snapshot ? Engine.convertCurrency(parsed, snapshot.rates) : null
    var asked = Engine.formatMathResult(parsed.amount) + " " + parsed.from
    var label = ""
    var detail = ""

    if (converted) {
      label = Engine.formatCurrencyValue(converted.value) + " " + parsed.to
      // Terse because the row is one line of a narrow card: what was asked,
      // the rate it went through, and how old that rate is.
      detail = asked + " at " + Engine.formatCurrencyRate(converted.rate)
      var asOf = root.currencyRatesDate()
      if (asOf) detail += " · " + asOf
    } else {
      label = asked + " → " + parsed.to
      if (!snapshot)
        detail = root.currencyFetchFailed ? "Exchange rates unavailable" : "Fetching exchange rates…"
      else
        detail = "No rate for " + (snapshot.rates[parsed.from] ? parsed.to : parsed.from)
    }

    return root.queryRow({
      kind: "currency",
      icon: "󰄔",
      label: label,
      detail: detail,
      payload: converted ? Engine.formatCurrencyValue(converted.value) : "",
      ready: !!converted
    })
  }

  // The date the snapshot was published, which is the honest thing to put
  // next to a rate that is up to a day old.
  function currencyRatesDate() {
    var snapshot = root.currencyRates
    if (!snapshot) return ""
    if (snapshot.updated > 0) return Qt.formatDate(new Date(snapshot.updated * 1000), "d MMM")
    return snapshot.date || ""
  }

  // Fetched on demand -- the first conversion someone types -- so a box never
  // used as a converter never reaches the network, and one that is reaches it
  // about as often as the rates change. Written to a temporary name and moved
  // into place so a fetch cut off halfway cannot leave half a snapshot behind.
  function ensureCurrencyRates() {
    if (currencyRatesProc.running || currencyCacheProc.running) return

    // The cache is read on the first conversion typed rather than at startup.
    // Its collector refreshes the answer, which comes back through here to
    // decide whether what it found is still current.
    if (!root.currencyCacheRead) {
      root.currencyCacheRead = true
      root.loadCurrencyCache()
      return
    }

    var now = Math.floor(Date.now() / 1000)
    if (!Engine.currencyRatesStale(root.currencyRates, now)) return
    // Every keystroke of a conversion comes through here, so a fetch that
    // failed has to stay failed for a while rather than be retried by the
    // next character typed.
    if (now - root.currencyFetchedAt < 60) return
    root.currencyFetchedAt = now

    var target = root.currencyRatesPath
    var directory = target.substring(0, target.lastIndexOf("/"))

    // Nothing here writes to a name anyone could have guessed. mktemp creates
    // with O_EXCL and mode 600, so a pre-placed file or symlink at the
    // temporary path makes the fetch fail rather than redirect it; the cache
    // directory is checked to be ours and not writable by anyone else before
    // that; curl is capped so a source that answers with gigabytes cannot fill
    // the disk; and the move is a rename, which replaces a symlink sitting at
    // the target instead of writing through it.
    var script = [
      'set -u',
      'd=' + Util.shellQuote(directory),
      't=',
      'cleanup() { [ -n "$t" ] && rm -f -- "$t"; }',
      'trap cleanup EXIT',
      'mkdir -p -m 700 -- "$d" 2>/dev/null',
      // A directory that is a symlink, or belongs to someone else, or that
      // anyone can write to, cannot hold a cache worth trusting.
      'if [ -L "$d" ] || [ ! -d "$d" ]; then exit 1; fi',
      'find "$d" -maxdepth 0 -uid "$(id -u)" ! -perm /022 -print -quit 2>/dev/null | grep -q . || exit 1',
      't=$(mktemp -- "$d/.rates.XXXXXXXXXXXX") || exit 1',
      'curl -fsS --max-time 8 --max-filesize ' + root.currencyFileCeiling
        + ' -o "$t" -- ' + Util.shellQuote(root.currencyRatesUrl) + ' || exit 1',
      // curl only enforces --max-filesize against a declared length, so a
      // chunked reply is measured here before it is kept.
      '[ "$(wc -c < "$t")" -le ' + root.currencyFileCeiling + ' ] || exit 1',
      'mv -f -- "$t" ' + Util.shellQuote(target) + ' || exit 1',
      't='
    ].join("\n")

    currencyRatesProc.command = ["bash", "-c", script]
    currencyRatesProc.running = true
  }

  // The query lives in queryInput, which owns the caret; filterText follows
  // it. Setting it from here (open, clear) moves the caret to the end.
  function setFilter(nextFilter) {
    if (queryInput.text !== nextFilter) queryInput.text = nextFilter
    queryInput.cursorPosition = queryInput.text.length
    root.filterText = nextFilter
    root.refreshAnswer()
  }

  // A paste lands at the caret, replacing whatever is selected, the way it
  // would in any other text field.
  function insertAtCursor(text) {
    if (queryInput.selectedText) queryInput.remove(queryInput.selectionStart, queryInput.selectionEnd)
    queryInput.insert(queryInput.cursorPosition, text)
  }

  // Read at the moment it is asked for rather than watched in the background:
  // the box wants the clipboard once, and nothing here should be holding on
  // to whatever was copied.
  function pasteIntoFilter() {
    if (pasteProc.running) return
    pasteProc.command = root.boundedCommand("wl-paste --no-newline --type text 2>/dev/null", 5, 4096)
    pasteProc.running = true
  }

  function copyAnswer() {
    if (!root.answerReady) return
    var text = root.answer.target || root.answer.label
    root.cancel()
    // printf rather than echo so the result lands without a trailing newline,
    // and shellQuote so it lands as text however it was spelled.
    Quickshell.execDetached(["bash", "-c", "printf %s " + Util.shellQuote(text) + " | wl-copy"])
  }

  function cancel() {
    opened = false
    filterText = ""
    answer = null
  }

  Process {
    id: zoneListProc
    command: root.boundedCommand("timedatectl list-timezones", 5, 65536)
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var zones = String(text || "").split("\n")
        var kept = []
        for (var i = 0; i < zones.length; i++) {
          var zone = zones[i].trim()
          if (zone) kept.push(zone)
        }
        if (kept.length === 0) return

        root.timeZones = kept
        root.refreshAnswer()
      }
    }
  }

  Process {
    id: zoneOffsetProc
    property string zone: ""
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var lines = String(text || "").trim().split("\n")
        var offset = Engine.parseZoneOffset(lines[0])
        var local = lines.length > 1 ? Engine.parseZoneOffset(lines[1]) : null
        if (offset === null) return

        if (local !== null) root.localZoneOffset = local
        var next = root.zoneOffsets
        next[zoneOffsetProc.zone] = { offset: offset, readAt: Math.floor(Date.now() / 1000) }
        root.zoneOffsets = next
        root.refreshAnswer()
      }
    }
  }

  Process {
    id: pasteProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        // The search field is one line, so newlines and tabs come in as
        // spaces, and a clipboard holding half a file cannot become the whole
        // query.
        var pasted = Engine.sanitizeText(String(text || "").replace(/\s+/g, " ").trim()).trim()
        if (!pasted) return
        if (pasted.length > 512) pasted = pasted.slice(0, 512)

        root.insertAtCursor(pasted)
      }
    }
  }

  Process {
    id: randomProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var parts = String(text || "").split(/\s+/)
        var bytes = []
        for (var i = 0; i < parts.length; i++) {
          if (!parts[i]) continue
          var value = parseInt(parts[i], 10)
          if (value >= 0 && value <= 255) bytes.push(value)
        }
        if (bytes.length === 0) return

        root.randomPool = root.randomPool.concat(bytes)
        root.refreshAnswer()
      }
    }
  }

  Process {
    id: currencyRatesProc
    onExited: function(exitCode, exitStatus) {
      if (exitCode === 0 && exitStatus === 0) {
        root.loadCurrencyCache()
        return
      }

      // Offline, or the source is down. The row says so rather than sitting on
      // "fetching…" forever; `currencyFetchedAt` keeps the retry off the next
      // keystroke.
      root.currencyFetchFailed = true
      root.refreshAnswer()
    }
  }

  // The cached snapshot, which is a plain copy of what the rate source last
  // answered. Missing on a machine that has never converted anything, which is
  // what the first conversion typed goes and fixes.
  Process {
    id: currencyCacheProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var snapshot = Engine.parseCurrencyRates(String(text || ""))
        root.currencyRates = snapshot
        if (snapshot) root.currencyFetchFailed = false
        // Refresh either way. A cache that was missing or stale leaves the row
        // to ask ensureCurrencyRates again, which is what starts the fetch.
        root.refreshAnswer()
      }
    }
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    // Shares the menu's namespace so Omarchy's layer rule for it (no open
    // animation) applies here too.
    WlrLayershell.namespace: "omarchy-menu"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.cancel()
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      height: root.cardHeight
      radius: root.cornerRadius
      anchors.horizontalCenter: parent.horizontalCenter
      y: Math.max(Style.gapsOut, Math.round((panel.height - root.cardHeight) / 2))
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; onClicked: {} }

      Column {
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        spacing: root.contentSpacing

        Item {
          width: parent.width
          height: root.headerHeight

          // A real text field, so the caret can move: Left/Right, Home/End,
          // Ctrl+Left/Right by word, Shift to select, and a click to place it.
          // Only the keys that mean something to the box as a whole are taken
          // here; everything else is TextInput's own editing.
          TextInput {
            id: queryInput
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            focus: true
            clip: true
            maximumLength: 512
            color: root.foreground
            selectionColor: root.selectedBackground
            selectedTextColor: root.selectedText
            selectByMouse: true
            font.family: root.fontFamily
            font.pixelSize: Style.font.heading

            onTextChanged: {
              if (text === root.filterText) return
              root.filterText = text
              root.refreshAnswer()
            }

            Keys.onPressed: function(event) {
              if (event.key === Qt.Key_Escape) {
                if (root.filterText) root.setFilter("")
                else root.cancel()
                event.accepted = true
              } else if ((event.key === Qt.Key_V && (event.modifiers & (Qt.ControlModifier | Qt.MetaModifier)))
                         || (event.key === Qt.Key_Insert && (event.modifiers & Qt.ShiftModifier))) {
                // Through wl-paste rather than TextInput's own paste. Super+V
                // never arrives as Super+V: omarchy binds it to "universal
                // paste", which sends Ctrl+V on to whatever has focus -- layer
                // surfaces like this one included.
                root.pasteIntoFilter()
                event.accepted = true
              } else if (event.key === Qt.Key_U && event.modifiers === Qt.ControlModifier) {
                // Ctrl+U clears to the start of the line, as in a shell.
                queryInput.remove(0, queryInput.cursorPosition)
                event.accepted = true
              } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                root.copyAnswer()
                event.accepted = true
              }
            }
          }

          Text {
            textFormat: Text.PlainText
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            visible: !queryInput.text
            text: "Reckon…"
            color: root.foreground
            opacity: 0.58
            font.family: root.fontFamily
            font.pixelSize: Style.font.heading
          }
        }

        BorderSurface {
          id: answerRow
          readonly property bool hasCursor: root.answerReady

          width: parent.width
          height: root.answerHeight
          radius: root.cornerRadius
          color: hasCursor ? root.selectedBackground : "transparent"
          borderSpec: hasCursor ? root.selectedBorderSpec : Border.none()
          opacity: root.answer && !root.answerReady ? 0.6 : 1

          Text {
            textFormat: Text.PlainText
            id: iconText
            visible: !!root.answer
            text: root.answer ? root.answer.icon : ""
            color: answerRow.hasCursor ? root.selectedText : root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.iconLarge
            width: Style.space(36)
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            anchors.left: parent.left
            anchors.leftMargin: root.rowReservedBorderLeft + Style.space(8)
            y: contentColumn.y + labelText.y + (labelText.height - height) / 2
          }

          Column {
            id: contentColumn
            visible: !!root.answer
            anchors.left: iconText.right
            anchors.leftMargin: Style.space(6)
            anchors.right: parent.right
            anchors.rightMargin: root.rowReservedBorderRight + Style.space(14)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(3)

            Text {
              textFormat: Text.PlainText
              id: labelText
              width: parent.width
              text: root.answer ? root.answer.label : ""
              color: answerRow.hasCursor ? root.selectedText : root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.heading
              font.weight: Font.Medium
              elide: Text.ElideRight
            }

            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: root.answer ? root.answer.detail : ""
              visible: text.length > 0
              color: answerRow.hasCursor ? root.selectedText : root.foreground
              opacity: 0.52
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              elide: Text.ElideRight
            }
          }

          // With nothing to answer, the row says what can be asked instead.
          Text {
            textFormat: Text.PlainText
            visible: !root.answer
            anchors.fill: parent
            anchors.leftMargin: root.rowReservedBorderLeft + Style.space(14)
            anchors.rightMargin: root.rowReservedBorderRight + Style.space(14)
            text: root.filterText.trim()
              ? "No answer for that"
              : "2^10 · 5 km to mi · 100 usd to eur · time in tokyo · uuid"
            color: root.foreground
            opacity: 0.45
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            verticalAlignment: Text.AlignVCenter
            elide: Text.ElideRight
          }

          MouseArea {
            anchors.fill: parent
            cursorShape: root.answerReady ? Qt.PointingHandCursor : Qt.ArrowCursor
            onClicked: root.copyAnswer()
          }
        }
      }
    }
  }
}
