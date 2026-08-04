# bench-runner

Stateless benchmark runner for the [stateless-engineering](https://github.com/stateless-engineering) org.

Runs every `bench.js` found in a directory of demos, collects the machine-readable
result each demo emits, and prints a master summary.

## Stateless by design

- **Zero npm dependencies** — Node stdlib, plus the `formatting` package as a
  sibling in the monorepo for pretty output (it degrades to plain text if
  missing)
- **No state** — no config file, no cache, no result files; nothing is written to disk
- **Pure CLI** — every input comes from argv; all output goes to stdout; the exit code
  carries pass/fail
- **Deterministic** — demos run in sorted order, no ambient state between runs

## Usage

```bash
npx @stateless-engineering/bench-runner [DIR] [--json] [--only a,b] [--timeout SECS]
```

| flag | meaning |
|------|---------|
| `DIR` | directory containing `*/bench.js` demos (default: current directory) |
| `--json` | print a JSON array of results only, for piping into other tools |
| `--only a,b` | run a subset of demos |
| `--timeout SECS` | per-demo timeout in seconds (default 180) |

Exit code: `0` if every demo ran clean, `1` if any failed or timed out, `2` on bad input.

## The `RESULT_JSON` contract

A demo signals its headline result to the runner by printing one line:

```
RESULT_JSON {"demo":"snap-restore","durationMs":1330,"headline":"restore 2.9x faster, state kept"}
```

- The runner uses the **last** `RESULT_JSON` line on stdout.
- A `headline` string is the only required field; anything else in the object is passed
  through into `--json` output.
- Emitting no line is fine — the demo still runs, reports `(no headline)`.

## Example

```bash
$ bench-runner .          # from the benchmarks repo root

=== snap-restore ===
metric             | full reload        | snapshot restore
--------------------+--------------------+--------------------
tab back in         |  3.90s             |  1.33s
...
=== summary ===
demo             | dur     | status | headline
-----------------+---------+--------+---------------------------------------------
snap-restore     |  10.7s | ok    | restore 2.9x faster (3.90s vs 1.33s), state kept
total: 1/1 demos ok, 10.7s wall
```
