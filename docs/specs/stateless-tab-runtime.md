# Spec: Stateless Tab Runtime

The org's flagship project: hibernate a tab the way an OS hibernates a laptop —
capture the rendered state + runtime delta of a background tab, evict its
memory, and restore it instantly without a network reload, preserving JS
state, scroll, form, and DOM.

Provenance: the idea that started the org
(`notes/browser_tab_caching_optimization_explained_…c4271490-bc3.md`, public
share `https://chat.deepseek.com/share/dz4o26do539t1ncire`), measured by the
benchmark suite (`packages/benchmarks/`), governed by the stateless model
(`docs/wiki/stateless-model.md`).

## Objective

A user returns to a background tab and gets it **back in < 300 ms with all
state intact** — no network requests, no script re-execution, no lost form
input — while the tab's memory was fully reclaimed while away.

This spec covers **two tracks** — the near-term build and the long-term
destination:

- **Track A — now, browser-adjacent.** A hibernation service and state-blob
  format built on the existing Puppeteer/CDP stack and governed by the 9
  benchmark gates. Ships this quarter; everything in this spec's success
  criteria is measurable today.
- **Track B — longer term, engine-level.** The blueprint's full vision: a
  base/delta runtime with an audit layer between page code and engine that
  journals mutations, making any page a serializable delta over a pristine
  base. This is the org's destination; Track A is the proving ground (the
  blob format, progressive restore, and lifecycle APIs are designed so Track
  B inherits them, not re-invents them). Track B is the engine seed of the
  full stateless browser rebuild — see `docs/specs/stateless-browser.md`.

Success criteria (each is a benchmark gate, not a vibe):

1. **Survival matrix 6/7 → 7/7** — a hibernated tab preserves cookie,
   localStorage, sessionStorage, scroll, form, JS state, and DOM (today's
   snapshot restores 6/7).
2. **Restore beats reload on the wire**: `network-skip` = 0 requests, 0 KiB on
   restore (already true) — and restore latency < 300 ms p95 on the
   `snap-restore` benchmark.
3. **Memory is actually reclaimed**: `memory-delta` shows hibernation frees
   ≥ 90% of the tab's RSS (today: freeze holds 99%, discard frees ~42%).
4. **`tab-spray`** — N hibernated tabs cost near-zero RSS while away, and
   restore in bounded time independent of N.
5. **Stateless rule intact** — the runtime itself leaves nothing behind: no
   daemons, no caches, no result files. Blobs are explicit, portable, hashed.

## The model in one sentence

A tab is a **state blob + a service invocation**: hibernate = snapshot the
blob and evict; restore = re-invoke the service with the blob. State is
truth; the engine is a pure function of (blob, inputs) → (new blob, outputs).

## Architecture

Track A (now — buildable):

```
┌─────────────────────────────────────────────────────────────┐
│  webshell (control plane — already exists)                  │
│  discovery = path resolution · "down" is the default        │
│  /run /wire /settings → + /hibernate /restore              │
└──────────┬──────────────────────────────────────────────────┘
           │ spawn (cwd = app dir, stdin/stdout, exit code)
┌──────────▼──────────────────────────────────────────────────┐
│  hibernation service (new)                                  │
│  freeze → snapshot(state blob) → evict → [away] → restore   │
│  progressive restore: shell → DOM+layout → JS runtime       │
└──────────┬──────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│  state-blob format (new library)                            │
│  versioned · hashed · encrypted-able · portable             │
│  layer 0: DOM + scroll + form + shallow JS state (today)    │
│  layer 1: journal of mutations (audit layer — Track B)      │
└──────────┬──────────────────────────────────────────────────┘
           │ consumes / emits
┌──────────▼──────────────────────────────────────────────────┐
│  benchmark store (acceptance contract — already exists)     │
│  snap-restore · survival-matrix · memory-delta ·            │
│  network-skip · tab-spray · bfcache · cpu-burn · restart ·  │
│  pixel-ghost — all must stay green; new gates added         │
└─────────────────────────────────────────────────────────────┘
```

Track B (longer term — the blueprint destination):

```
┌──────────────────────────────────────────────────────────────┐
│  engine (browser runtime)                                    │
│  base runtime: pristine, prewarmed, shared                  │
│  page = delta over base: DOM + JS heap + engine state       │
└──────────┬───────────────────────────────────────────────────┘
           │ interposition
┌──────────▼──────────────────────────────────────────────────┐
│  audit layer (research → prototype → engine)                │
│  journals every mutation between page code and engine       │
│  makes the page layer serializable: capture = replay log    │
└──────────┬───────────────────────────────────────────────────┘
           │ emits
┌──────────▼──────────────────────────────────────────────────┐
│  layer-1 blob: { baseRef, journal, engineDelta }            │
│  (same envelope + hash discipline as layer 0)               │
└──────────┬───────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│  lifecycle: saveState()/restoreState()                      │
│  opt-in app mode → heuristic transparent → default          │
└─────────────────────────────────────────────────────────────┘
```

The pipeline from the blueprint conversation: freeze-dried tabs (static
capture first, DOM after, JS runtime last) is Track A's progressive restore;
the audit layer is Track B's capture mechanism. Same UX, deeper machinery.

### Long-term success criteria (Track B)

6. **Transparent serialization** — a background tab hibernates with **zero
   cooperation** from page code (no opt-in), and restores byte-identically:
   engine state, timers, network sockets, `Math.random` sequence — the whole
   runtime, not just DOM + localStorage.
7. **Base/delta economics** — 100 tabs share one pristine base; each tab's
   memory cost is its delta. Hibernating N tabs reclaims N×(delta) with
   restore bounded by delta size, not page size.
8. **Determinism** — replay of a journal is bit-stable across runs (the
   same checkpoint the stateless model already demands of services, now
   demanded of a page).
9. **The runtime is a service** — a tab at rest is a blob + an invocation.
   The engine exposes `saveState()`/`restoreState()` as first-class,
   inspectable, benchmarkable operations — not a hidden feature.

### Components

| Component | Status | Responsibility |
|---|---|---|
| `webshell` | exists | control plane: discovery, spawn-on-demand, compositor (`/wire`), settings |
| `bench-runner` | exists | stateless CLI; every `*/bench.js` → `RESULT_JSON` |
| `formatting` | exists | pretty tables; consumed in-process |
| `benchmarks` | exists | 9 benchmarks; the acceptance contract |
| `lib/common.js` snapshot/restore | exists | today's capture: DOM (60021 nodes), scroll, form, shallow JS state |
| `state-blob` (new) | Track A | versioned blob format: encode/decode/hash/verify; layer-0 today, layer-1 in Track B |
| `hibernation` service (new) | Track A | freeze → snapshot → evict → progressive restore |
| audit layer | Track B | interposition between page code and engine; journals mutations so the page layer becomes serializable (base/delta) |
| base/delta engine runtime | Track B | pristine shared base + per-page delta; the blueprint's "the layer on top" |

## State blob format (layer 0 — buildable now)

```json
{
  "format": "stateless-blob",
  "version": 1,
  "hash": "sha256:…",             // of the payload, canonical
  "captured": "2026-08-05T…Z",
  "engine": { "kind": "chromium", "version": "…" },
  "app": { "name": "snap-restore", "entry": ["node", "bench.js"] },
  "payload": {
    "dom": "<serialized DOM>",
    "scroll": { "x": 0, "y": 4000 },
    "form": { "#name": "hibernated-user" },
    "jsState": { "visits": 99, "token": "mutated-by-user" }
  }
}
```

- The blob is the **only** thing that crosses the eviction boundary. No
  ambient state, no side files.
- `hash` lets the runtime verify a blob before restore and cache blobs
  content-addressed (dedupe identical tabs).
- Versioned: layer 1 (journal replay) and layer 2 (engine delta) extend the
  payload without breaking restores of layer-0 blobs.
- Encrypted-able: blob may be sealed (e.g. cross-device) — sealing is an
  option, not a default.

## Interfaces

### Manifest (extends `app.json`)

```json
{
  "name": "…",
  "entry": ["node", "…"],
  "hibernation": {
    "supports": true,
    "lifecycle": ["saveState", "restoreState"],   // opt-in page hooks (Phase C direction)
    "layers": ["dom", "scroll", "form", "jsState"]
  }
}
```

Legacy apps (no manifest) hibernate with layer-0 capture only — always safe,
never better than the app's own hooks.

### Hibernation service protocol

```
hibernate app        → freeze → snapshot → emit blob → evict (SIGKILL) → blob on stdout
restore app blob     → spawn app → apply blob → verify (hash + survival probe) → [exit 0]
```

Same shape as every other service: argv in, stdout out, exit code as verdict.

### Webshell endpoints (additive)

| Endpoint | What it does |
|---|---|
| `POST /hibernate/:app` | capture + evict; returns the blob (and its hash) |
| `POST /restore` | `{"app": "…", "blob": "…"}` — spawn, apply, verify |
| `GET /blobs` | content-addressed blob store (memory/disk, opt-in) |

## Testing strategy

- **The 9 benchmarks are the regression gate** — `npm run bench:all` must stay
  green (9/9) at every phase.
- New gates added per phase:
  - `hibernate-restore` — restore < 300 ms p95, 0 network, state 7/7.
  - `blob-roundtrip` — encode → decode → hash-verify → restore, byte-stable.
  - `tab-spray-hibernate` — N hibernated tabs ≈ 0 RSS while away.
- Unit tests live beside the new library (`packages/state-blob/test`), run via
  `node --test` (workspace `test` script), no new test framework.
- Stateless discipline applies to the tests: no fixtures written to the repo,
  temp files in `os.tmpdir()` cleaned in `try/finally`.

## Boundaries

- **Always:** run `npm run bench:all` before any merge; follow the stateless
  rule; keep blobs versioned + hashed; sorted, deterministic discovery.
- **Ask first:** state-blob format changes (breaking), new dependencies, new
  workspace packages, engine-level work (browser patches), changing CI.
- **Never:** leave state behind; commit generated artifacts; push `notes/`
  without review (contains personal chat exports — provenance yes, public
  exposure no).

## Open questions

1. ~~Engine scope~~ — **resolved: both, sequenced.** Track A (browser-adjacent
   service, CDP-based) ships now; Track B (engine-fork, audit layer) is the
   destination. The remaining question is *when* Track B starts — this spec
   gates it on Track A's layer-0 blob and progressive restore being
   benchmark-green (plan Phase 6 gate).
2. **Blob store** — memory-only (stateless-pure) vs opt-in disk cache for
   cross-session restore. Default: memory-only, content-addressed.
3. **Layer-1 journal format** — spec the audit-layer journal format as a
   design doc during Track A (so layer-0 blobs upgrade cleanly), or only when
   Track B starts? Default: design doc in parallel with Track A.
4. **Where restore runs** — same process pool or a fresh process per restore?
   Default: fresh process (stateless purity) with the base-runtime prewarm
   done by the runner, matching today's spawn model.

## Non-goals

**Track A (now):**
- No engine/Chromium patches — Track A works through CDP, like the benchmarks.
- No cross-device blob sync (later, both tracks).

**Track B (longer term) — out of scope until its own phases land:**
- No audit-layer implementation during Track A (design doc only).
- No changes to the browser's own tab manager — we are the tab manager, in
  miniature: the webshell is the compositor, hibernation is a service, and
  the engine's `saveState`/`restoreState` are the long-term version of that
  same contract.
