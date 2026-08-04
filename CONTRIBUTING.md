# Contributing

Welcome. This is the single repository of the
[stateless-engineering](https://github.com/stateless-engineering) org: the
Node.js implementation, the benchmarks, the docs/wiki, and the provenance
notes live here together.

## What "stateless" means here

Read [`AGENTS.md`](AGENTS.md) first — six hard rules. The short version:
nothing a run creates persists, no ambient state or config, deterministic
runs, zero deps where practical, clean teardown in `finally`, no generated
artifacts in git.

## Layout

| Path | What it is |
|---|---|
| `packages/webshell/` | The app runtime & compositor. `webshell.js`; discovers apps across three roots, spawns on demand, wires pipelines (`/wire`). |
| `packages/bench-runner/` | Stateless CLI: runs every `*/bench.js`, aggregates `RESULT_JSON` lines. Zero deps. |
| `packages/formatting/` | Pretty ANSI box tables, stdin → stdout. Zero deps. Consumed by the runner in-process. |
| `packages/benchmarks/` | The benchmark store: one directory per benchmark with a `bench.js` entry. |
| `docs/` | Architecture + wiki — the org's knowledge base. |
| `notes/` | Provenance: verbatim chat-log exports. Edits belong in consuming docs, not here. |

## Running things

```bash
npm install               # hoists puppeteer (benchmarks) to the workspace root
npm run bench:all         # every benchmark through the runner
npm run bench:one bfcache # a single benchmark
npm run webshell          # the app runtime & compositor (ephemeral port)
```

The benchmarks prefer a system Chromium (`/usr/bin/chromium`, `google-chrome`,
…) and fall back to Puppeteer's bundled Chrome.

## Issue-first workflow

1. Open an issue (feature or bug template) — problem, proposed fix,
   acceptance criteria.
2. Branch per issue: `git checkout -b <number>-<slug>`.
3. Implement; commit with Conventional Commits referencing the issue
   (`feat(#12): …`, `fix(#12): …`).
4. Open a PR with `Closes #<n>`, wait for CI green, merge.
5. Update the issue with the problem → fix explanation.

Keep changes stateless: no files written to the repo by tests or runs, no
config, deterministic ordering.
