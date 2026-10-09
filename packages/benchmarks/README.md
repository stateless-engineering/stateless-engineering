# benchmarks

The [stateless-engineering](https://github.com/stateless-engineering) benchmark
store: every build repo's benchmarks land here, one directory per benchmark,
each a `bench.js` that speaks the runner's `RESULT_JSON` contract. Currently
that is the browser tab-caching suite — Puppeteer-based hibernation & restore
benchmarks. Every benchmark is stateless: fresh browser on an ephemeral port,
temp files cleaned up, nothing left behind (workspace rule in
`../../AGENTS.md`).

## Tooling (sibling packages in the monorepo)

- `../bench-runner/` — the stateless CLI: runs every `*/bench.js`, collects
  each benchmark's `RESULT_JSON` headline line, prints the summary. Zero npm
  deps; argv in, stdout out, exit code as verdict.
- `../formatting/` — in-process pretty output (ANSI box tables, status
  chips), required by the runner with a plain-text fallback.

Run the suite with `npm run bench:all` (spawns `../bench-runner/run.js`).

## The suite

Browsers don't cache the full rendered state + JavaScript runtime of a
background tab, so restoring one means a full reload. The suite demonstrates
the gap:

- **Snap**: capture DOM, scroll position, form values, and shallow JS state from a live tab
- **Kill**: close the tab process (free memory)
- **Restore**: spin up a new tab and replay the snapshot — skipping network, parse, and layout

## Benchmarks

| Benchmark | What it shows |
|-----------|---------------|
| `stateless-inference/` | Cold projection: 4,096 operations; warm reuse: 0 (4,096 avoided), identical inference output (1,484,440). Deterministic operation counts, not a latency speedup. |
| `snap-restore/` | Full reload vs snapshot restore: time, JS heap, scroll/form/JS-state preservation |
| `memory-delta/` | Lifecycle memory spectrum: live → frozen → discarded → restored, process-tree RSS |
| `bfcache/` | Real back/forward cache: instant back-nav keeps JS state; reload resets it |
| `cpu-burn/` | Live tab burns renderer CPU; freezing zeroes it while holding all memory |
| `restart/` | Hibernate the whole browser: snapshot to disk, kill the process, restore in a new one |
| `survival-matrix/` | What survives reload / new tab / browser restart / snapshot restore |
| `network-skip/` | Reload re-downloads the 700 KiB dataset; restore fetches 0 bytes |
| `tab-spray/` | 8 heavy tabs ≈ 3.1 GB; the discard lever and the snapshot-restore cost at scale |
| `pixel-ghost/` | Caching pixels looks right but is dead; snapshot restore is the same page, alive |

## Quick start

```bash
npm install puppeteer
npm run bench:all          # run every benchmark through the bench-runner
# or individually:
npm run bench              # snap-restore
npm run bench:memory
npm run bench:bfcache
npm run bench:cpu
npm run bench:restart
npm run bench:survival
npm run bench:network
npm run bench:tabs
npm run bench:pixel
```

The benchmarks prefer a system Chromium (`/usr/bin/chromium`, `google-chrome`, …)
so they run with no browser download on most machines; they fall back to
Puppeteer's bundled Chrome, then `chrome-headless-shell`.

## The runner

`npm run bench:all` invokes the [bench-runner](https://github.com/stateless-engineering/stateless-engineering/tree/main/packages/bench-runner)
package (sibling in this monorepo, zero deps, no config/cache/result files,
argv in / stdout out / exit code as verdict). Each benchmark reports a
machine-readable `RESULT_JSON` line that the runner aggregates into the
summary table.

## Sample output

```
=== summary ===
benchmark        | dur     | status | headline
-----------------+---------+--------+---------------------------------------------
bfcache          |   4.9s | ok    | back via bfcache 0.026s (79x faster than reload's 2.08s), JS state kept
cpu-burn         |   6.4s | ok    | live tab burned 1.50s CPU in 1.5s of work; frozen burned 0.00s
memory-delta     |   7.7s | ok    | freeze holds 99% of 1046 MB RAM; discard frees 444 MB
network-skip     |   7.1s | ok    | reload: 6 requests / 709.0 KiB; restore: 0 requests / 0.0 KiB
pixel-ghost      |   4.3s | ok    | pixel ghost is dead (5 nodes); snapshot restore is alive (60021)
restart          |   9.9s | ok    | snapshot survives process death: restore 1.49s vs reload 2.07s
snap-restore     |   6.2s | ok    | restore 3.0x faster, state kept; reload lost it
survival-matrix  |  13.0s | ok    | reload keeps 3/7, new tab 2/7, restart 2/7, snapshot 6/7
tab-spray        |  30.8s | ok    | 8 tabs ≈ 3139 MB; discarding half frees 1704 MB
total: 9/9 benchmarks ok
```

All benchmarks share helpers in `lib/common.js` (system-Chromium launch, fixture
server with a 700 KiB dataset payload, tree-RSS via `/proc`, snapshot/restore)
and a heavy fixture that fetches its dataset over the network like a real app.

## Adding a benchmark

Any build repo's benchmark goes in its own directory here: a `bench.js` that
emits one `RESULT_JSON` line (contract in `bench-runner/README.md`), using
`lib/common.js` helpers where they fit. `npm run bench:all` picks it up
automatically — sorted order, no registration needed.

## Organization

[stateless-engineering](https://github.com/stateless-engineering)

### Stateless inference (dependency-free)

Run from `packages/benchmarks`:

```bash
node ../bench-runner/run.js . --only stateless-inference
```

CI proves **4,096 projection operations avoided on warm runs, identical inference output**. `durationMs: 0` is a placeholder, not a timing measurement. Real model-load, cache construction, memory and latency measurements on a P4000 are pending. The npm-distributed `npx @stateless-engineering/bench-runner` invocation is not yet verified; the checked-in runner is the reproducible path today.
