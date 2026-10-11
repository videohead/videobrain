# Data control fixtures

Synthetic, deterministic sample data for VideoBrain's data nodes. No external
service, credentials, real device data, or personal data is included.

These files are served under `test-data/` relative to the application's base
URL after building/deploying. For example, an app at `/videobrain/` serves
`/videobrain/test-data/controls.json`. Fetch requires the complete HTTPS URL
(or HTTP on loopback), followed by an explicit Fetch action. Adding a node
does not fetch automatically. These are data files, not project imports.

## Files and expected results

| File | Use | Expected results |
| --- | --- | --- |
| [controls.json](controls.json) | Fetch → JSON Parse → JSON Select → JSON to Text | `/title` = `Signal Test`; `/amount` = `0.75`; `/patches/1/title` = `Main Scene` |
| [cues.csv](cues.csv) | CSV Parse with Header=yes and Delimiter=comma | Four rows; includes a quoted comma, escaped quotes, embedded newline, and an empty cell |
| [parameters.csv](parameters.csv) | Right input to Table Join | Four rows; duplicate `main` keys exercise multiple join matches; negative hue exercises decimal conversion |
| [stream-messages.json](stream-messages.json) | Sample WebSocket/SSE message payloads | Five messages with sequence 0..4, timestamps 0..1000 ms, and values 0, 0.25, 0.75, 1, 0 |
| [parser-cases.json](parser-cases.json) | Valid/invalid input corpus | JSON/CSV cases contain `input` and `valid`; decimal cases contain `input` and `expected`, where null means conversion must fail |

## JSON selection

Select `/labels/stage~1name` to get `Main / Left` and `/labels/~0cue` to get
`Opening`. JSON Pointer escapes `/` as `~1` and `~` as `~0`.
`/optional` is a present JSON null; `/missing` is an error. `/channels/4` is 1.
Use JSON to Text in string mode to remove quotes from string values. Route
`/decimalText` through JSON to Text → Text to Number to obtain -125.

## CSV join and transform

Parse both CSV files and join on `id` in each input. The inner join has four
rows: intro, main, main, outro. The unmatched `unused` row is excluded.
Columns are prefixed `left.` and `right.` to avoid collisions.

Filter `left.id` with Contains=`main`, then select `right.mix`. The resulting
rows are `0.75` and `1`. Table Cell with column `right.mix` and row 0 emits
`0.75`; Text to Number converts it to a scalar control.

The quoted note for `main` is `Say "hello"`; the `outro` note contains a real
newline. Sort uses lexical string order, not numeric order. Table to CSV
escapes spreadsheet-sensitive prefixes, including negative-looking values:
`-0.1` exports with a leading apostrophe. Consequently, spreadsheet-safe export
is not a lossless numeric round-trip. Keep the original table for numeric work.

## Error and boundary tests

The parser-cases file is itself valid JSON. To exercise an error, put the
case's `input` string into the corresponding parser, rather than parsing the
whole case envelope as malformed data. Failed nodes report Valid=0 and Error;
their typed outputs use the documented empty/null/fallback value.

The automated tests also generate exact-limit fixtures in memory, avoiding
large committed files: 32 KiB ASCII text, 256 rows × 16 columns (4096 cells),
and a JSON array with 4095 elements plus its root (4096 values). Each has an
over-limit counterpart that must be rejected. UTF-8 byte and nesting limits
are tested separately.

## Network and storage use

The stream-messages file is a static envelope, not a live server and not the
planned JSON show format. Send each element of `messages` separately as a JSON
WebSocket text message. For Server Events, send default events with a
`Content-Type: text/event-stream` response, for example:

```text
data: {"sequence":0,"timestampMs":0,"source":"fixture","value":0,"caption":"Opening"}

```

Each SSE event ends with a blank line. The timestamps are fixture fields;
the current data nodes do not schedule playback from them. Live network
tests should use a controlled local fixture server or mocked transport, not
a public service. The application requires explicit connection and reconnect.

For Storage, route a Text Source or JSON to Text into its text input, choose
a test key such as `fixture-controls`, and explicitly Write. Read returns the
stored text; Delete removes only that namespaced key. This never uses or
overwrites the project persistence key.

Parser expectations are checked by `src/graph/data.test.ts`. Network lifecycle
checks live in `src/engine/DataSessions.test.ts` and `e2e/studio.spec.ts`.