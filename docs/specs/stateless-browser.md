# Spec: The Stateless Browser (ground-up rebuild)

The org's destination project — tracked as issue #9. A browser **rebuilt** so
the stateless model is the architecture itself, not a feature bolted onto a
Chromium-class stateful engine:

> A tab is a **state blob + a service invocation**. State is truth; the
> engine is a pure function of (blob, inputs) → (new blob, outputs).
> **"Down" is the default.**

This spec is the system-level vision. Its component specs are the stateless
tab runtime (`docs/specs/stateless-tab-runtime.md`, Track B — the engine
seed) and the FOSS family (`docs/specs/foss-projects.md` — the browser is the
family's destination project). The benchmark suite is its acceptance
contract.

## Why rebuild at all

Stateful browsers are memory liabilities by design: every background tab
holds a full runtime in RAM; cold start re-fetches, re-parses, and
re-executes everything; a crashed tab is a lost session; "restore session"
is a reload in disguise. The org's benchmarks quantify the gap — a snapshot
restores in 0.97s vs 4.04s for reload, holds 99% of JS state, survives 6/7
state classes, uses 0 network. The tab-runtime spec closes that gap **as a
feature**. But a feature implies an engine that fights it: the audit layer —
journaling every mutation between page code and engine — is *impossible to
add* to a 30M-line C++ engine designed around mutable state. The complete
vision requires an engine where serializability is the substrate, not a
patch. That engine is a rebuild.

## The inversion

| Stateful browser | Stateless browser |
|---|---|
| Tab = running process in RAM | Tab = blob on disk; process materialized on demand |
| Background tabs = memory debt | Background tabs = zero RSS (memory-delta gate) |
| State lives in the engine, opaquely | State lives in the blob, versioned + hashed |
| Restore session = reload everything | Restore tab = replay a journal over a shared base |
| Engine mutates; bugs are unreproducible | Engine is a pure function; bugs are replayable bit-for-bit |
| Every subsystem is a daemon | Every subsystem is a service invocation |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  UI / compositor — thin, stateless                          │
│  materialize on demand · "down is the default"              │
└──────────┬──────────────────────────────────────────────────┘
           │ requests: open(tab-blob) → view
┌──────────▼──────────────────────────────────────────────────┐
│  tab manager (control plane — the webshell model)           │
│  open = materialize blob over base · close = seal + evict   │
│  discovery = path resolution into the blob store            │
└──────────┬──────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│  base/delta runtime                                         │
│  immutable shared base ── per-tab delta (DOM+heap+journal)  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ audit layer: journals every page→engine mutation       │ │
│  │ (DOM ops, heap writes, timers, network, storage, ...)  │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────┬──────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│  stateless subsystems (pure functions, invoked on demand)   │
│  network · storage · rendering · permissions · downloads    │
└──────────┬──────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│  blob store (content-addressed, hashed, versioned)          │
│  tab blobs · storage diffs · recorded network · the base    │
└─────────────────────────────────────────────────────────────┘
```

### 1. Base/delta runtime

One pristine, prewarmed, **immutable** base runtime: engine core, empty
document machinery, standard library. Every tab is a delta over the base —
its DOM tree, JS heap diff, and mutation journal. N tabs share one base;
per-tab memory cost = delta size, not page size. The base is read-only
memory (copy-on-write pages, kernel-hardened): a compromised base would
compromise every tab, so it is treated like a kernel — the one component
that must never be wrong.

### 2. The audit layer (journal-everything)

Interposition between page code and engine primitives that records **every
mutation**: DOM operations, JS heap writes, timer registrations, network
calls, storage writes, crypto/PRNG state, worker messages. Capture = stop
the world, seal the journal, hash it. Restore = materialize a fresh delta
and replay. This is the tab-runtime spec's Track B idea promoted to the
engine's core: the page layer is *defined* as a replay log.

### 3. Down is the default

No tab runs unless visible (or explicitly pinned). The tab manager is the
webshell's control-plane model: discovery is path resolution into the blob
store; a background tab is a blob at rest, not a process. Open = materialize
over base; close = seal + evict; crash = nothing lost, the blob is on disk.

### 4. Subsystems as stateless services

Rendering, compositing, networking, storage, permissions, downloads — each
is a pure function: (current state, input) → (new state, output). No
long-lived stateful daemons. The compositor is the webshell's `/wire`
pipeline: stages as pipes, stdout→stdin, stop on non-zero exit. A permission
prompt is a service invocation; a download is a service invocation; storage
is a blob diff.

### 5. Progressive restore (freeze-dried tabs)

Restore in stages, so the tab is *visible* before it is *alive*:

1. **Shell** — static capture (bitmap/DOM skeleton) painted immediately
   (< 100 ms — the tab "opens").
2. **Fast** — DOM + layout + scroll + form applied.
3. **Full** — JS runtime via journal replay; scripts resume at their last
   await.

The perceived cost of opening a tab is the shell, not the page.

### 6. Storage as versioned blobs

localStorage, IndexedDB, cookies, and site data are blobs — content-
addressed, hashed, versioned — not opaque side files. Site storage and tab
state use the same format family, so a site's data is a first-class,
auditable, restorable object. Sealed (encrypted) blobs are an option for
sensitive origins.

### 7. Determinism

Replay is bit-stable: same blob + same inputs → same behavior (the org's
rule 3, applied to a browser). This makes session replay, time-travel
debugging, and reproducible bug reports first-class features, and it makes
the benchmark suite able to assert *exact* state instead of statistical
proxies.

## The hard problems (honest horizons)

1. **Serializing the JS heap** — the make-or-break. Options, in feasibility
   order: (a) **record-replay** (rr-style journaling of the engine's own
   mutations — the audit layer at the VM boundary); (b) **heap snapshots**
   (serialize the heap — proven by V8's snapshot API, but slow and
   memory-hungry at tab scale); (c) **deep-fork engine** (rebuild the VM
   around serializability — 5–10 years, the ultimate form). The audit layer
   research (phase 6) picks (a) vs (b) as the phase-7 prototype path.
2. **Virtualized time** — timers and `Date` must replay deterministically:
   a virtual clock per tab, seeded and journaled; the restore replays with
   the clock frozen at capture, then resumes.
3. **Nondeterminism** — `Math.random` (per-tab seeded PRNG, seed in the
   blob), `performance.now`, device input, layout-dependent values: all
   journaled or seeded.
4. **Network** — recorded responses (headers + body) replayed on restore,
   revalidated against cache headers when online; offline-first by
   construction.
5. **Workers & service workers** — separate blobs with their own journals;
   message channels journaled as ordered events.
6. **GPU/compositing** — never serialized: derived state, rebuilt from
   DOM + layout deterministically. Only the decision inputs are journaled.
7. **Security of the shared base** — immutable, read-only, COW pages,
   kernel-grade hardening; per-tab sandboxing on top of a base that all tabs
   trust. The base is the browser's kernel; everything else is a service.
8. **WebAssembly** — WASM linear-memory serialization is large and
   poorly specified across engines. Phase-gate: WASM tabs fall back to a
   controlled reload in early phases; WASM replay is a later phase, only if
   the heap strategy supports it.

None of these are solved by a Chromium fork. All of them are *designable*
in a memory-safe, embeddable engine where the audit layer is a core
subsystem rather than an intrusion.

## Acceptance contract (benchmarks → browser gates)

The org's 9 benchmarks are the browser's CI gates, unchanged in spirit:

| Benchmark | Browser gate |
|---|---|
| `memory-delta` | N background tabs ≈ sum of deltas, not N pages |
| `tab-spray` | hibernate N tabs ≈ 0 RSS while away |
| `snap-restore` | restore < 300 ms p95 (shell < 100 ms) |
| `network-skip` | restore = 0 requests, 0 KiB |
| `survival-matrix` | 7/7 state classes survive |
| `bfcache` | back/forward instant, no reload |
| `pixel-ghost` | no ghost processes after close |
| `restart` | cold start < reload (blob over base) |
| `cpu-burn` | away tabs burn zero CPU |

New gates at the browser level: `replay-bitstable` (same blob → identical
DOM+state), `base-sharing` (N tabs, one base — memory proves it),
`wasm-fallback` (controlled reload, counted and never silent).

## Relationship to the org

- **Component spec:** the stateless tab runtime (Track B = the engine seed:
  audit layer, base/delta, lifecycle APIs). This spec is the system the
  runtime becomes.
- **Dev tooling:** the whole build runs through the ticket system (issue
  #5/#6/#7) — the browser is the flagship that proves the tooling.
- **Family:** the browser is the FOSS family's destination project
  (`docs/specs/foss-projects.md`) — the ultimate "stateless project".
- **Provenance:** the idea traces to the blueprint conversation
  (`notes/README.md`, share `dz4o26do539t1ncire`): freeze-dried tabs,
  saveState/restoreState, progressive restore.

## Phases

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | Evidence: benchmark suite proves the gap (9/9) | done |
| 1 | `state-blob` format (layer 0: DOM/scroll/form/JS state) | blob-roundtrip green |
| 2 | Hibernation service (CDP-based, on today's engine) | hibernate→restore exit 0 |
| 3 | Progressive restore (shell → full) | shell < 100 ms, full < 300 ms |
| 4 | Webshell tab control plane (`/hibernate`, `/restore`) | browser-driven round-trip |
| 5 | Benchmark gates 12/12 (hibernate-restore, blob-roundtrip, tab-spray-hibernate) | bench:all green |
| 6 | Audit-layer design (research): record-replay vs heap snapshot | docs/specs/audit-layer.md reviewed |
| 7 | Journal-everything engine prototype (audit layer as core) | replay bit-stable on fixtures |
| 8 | Base/delta runtime (immutable base + deltas) | N tabs ≈ delta memory |
| 9 | Stateless browser: subsystems as services, down-is-default, freeze-dried restore | benchmark suite as CI gates |
| 10 | Dogfood: the org's daily driver runs on it | survival-matrix 7/7 at scale |

Phases 0–5 are Track A of the tab-runtime plan (buildable now). Phase 6 is
the research gate: its conclusion (record-replay vs heap snapshot, engine
choice) decides phases 7–10. The rebuild is a multi-year, research-gated
program — this spec exists to make every phase falsifiable, never vibes.

## Boundaries

- **Always:** stateless contract (six rules); benchmark gates as the
  acceptance contract; deterministic ordering; issues-first; MIT.
- **Ask first:** the engine choice (phase 6 — this is *the* decision);
  WASM policy; offline network policy (record vs revalidate); any
  stateful carve-out (see open questions).
- **Never:** a daemon, server, or hosted service; an opaque stateful core
  that grows; pushing personal `notes/` exports anywhere public.

## Open questions

1. **Engine base** — the phase-6 decision. Recommended: a **memory-safe,
   embeddable engine (Servo-class)** — compositor-first, no 30M-line
   mutable-state inheritance, audit-layer interposition feasible; a Chromium
   fork is explicitly *not* recommended (the audit layer is un-addable).
   Servo vs a from-scratch engine vs record-replay over an existing
   embeddable VM is the research deliverable.
2. **Heap strategy** — record-replay (journal at VM boundary) vs heap
   snapshot (serialize). Default research direction: record-replay; heap
   snapshot as fallback for pathological pages.
3. **WASM** — controlled-reload fallback (default) vs investing in WASM
   replay early.
4. **Stateful carve-out** — permissions, crypto keys, and autofill may need
   a small trusted stateful core. Default: yes, *bounded and explicit* — the
   spec's only admitted exception to "everything is a service".
5. **Storage policy** — site storage blobs unsealed (default, like a
   browser today) vs sealed by default for sensitive origins.

## Non-goals (this round)

- No Chromium/WebKit fork — the rebuild is the point.
- No hosted browser service — the browser is FOSS software, not a SaaS.
- No spec of the engine internals beyond the audit layer's contract — that
  is the phase-6 research deliverable.
- The tab-runtime and ticket plans are not superseded; this spec is their
  destination, and their phases are its first five.
