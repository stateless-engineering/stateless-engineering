# formatting

Stateless output formatting for the [stateless-engineering](https://github.com/stateless-engineering) org.

Zero-dependency helpers for pretty terminal output: box tables with automatic
column widths and ANSI colors. Used by the bench-runner's summary and available
as a CLI for anything else.

## Stateless by design

- **Zero dependencies** — Node stdlib only
- **No state** — stdin in, stdout out, nothing written to disk
- **Color-safe** — ANSI is auto-disabled when stdout is not a TTY or when
  `NO_COLOR` is set, so piped output stays clean and diffable

## CLI

```bash
echo '{"headers":["demo","dur","status"],"rows":[["snap-restore","6.2s","ok"]]}' | formatting
```

```
┌──────────────┬──────┬────────┐
│ demo         │ dur  │ status │
├──────────────┼──────┼────────┤
│ snap-restore │ 6.2s │ ok     │
└──────────────┴──────┴────────┘
```

Input forms: `{"headers":[],"rows":[],"align":{}}` or a bare array whose first
row is the header row. Column alignment via `align: {"1":"right"}`.

## Library

```js
const format = require('@stateless-engineering/formatting');

format.table(['demo', 'dur'], [['snap-restore', '6.2s']], { align: { 1: 'right' } });
format.statusChip('ok');        // green ' ok ' (plain when piped)
format.green('done'); format.red('fail'); format.yellow('warn'); format.dim('note');
```

## Example

```bash
cd ../../packages/benchmarks   # the benchmark store (sibling package)
node bench-runner/run.js --json . | jq -r '
  .[] | [.demo, (.durationMs/1000|tostring)+"s", .status, (.result.headline // "")]
' | (read -r; printf '[%s,' "$REPLY"; while read -r; do printf '[%s],' "$REPLY"; done; printf ']\n') | formatting
```
