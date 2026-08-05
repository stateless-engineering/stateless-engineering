# Audit layer (phase 6 — record-replay vs heap snapshot)

Status: research deliverable for `stateless-browser.md` phase 6 (Track B).
Decides the engine base and the heap strategy; gates phases 7–10 (the
journal-everything engine prototype and the rebuild).

## Context

A stateless browser's core problem is the JS heap: a tab's state lives in
opaque, mutable engine memory, and "restore" today means reload. The
tab-runtime spec's Track B promoted the audit layer — journaling every
page→engine mutation — to the engine's substrate: the page layer is
*defined* as a replay log. Two strategies can capture that state; the
engine choice determines which is even possible.

The benchmark evidence frames the target: a snapshot restores in 0.97s vs
4.04s for reload, holds 99% of JS state, survives 6/7 state classes, uses
0 network. The audit layer must beat reload the same way while making the
result **bit-stable** (rule 3: same blob + same inputs → same behavior).

## The strategies

### A. Record-replay (rr-class journaling at the VM boundary)

Interpose between page code and engine primitives and record every
mutation as a journal entry: DOM ops, heap writes, timer registrations,
network calls, storage writes, crypto/PRNG state, worker messages.

- **Capture** = freeze the world, seal the journal, hash it.
- **Restore** = materialize a fresh delta over the shared base and replay
  the journal; scripts resume at their last await.
- **Cost** is proportional to *mutations since last checkpoint*, not heap
  size. Idle tabs journal almost nothing.
- **Determinism is structural**: the journal *is* the program's input
  history; replay is bit-stable by construction if the engine is
  deterministic (seeded PRNG, virtual clock, recorded network).
- **Requires** an engine where interposition is feasible — a memory-safe,
  embeddable VM with explicit mutation boundaries. This is the make-or-break
  for engine choice: rr over a 30M-line mutable C++ engine (Chromium) is
  not feasible; the audit layer is un-addable there.

### B. Heap snapshot (serialize the heap)

Freeze the engine and serialize its heap (DOM + JS objects) — the V8
snapshot API and Chrome's freeze-dried-tabs prototype (DOM + shallow heap
snapshot, ~80% faster cold start).

- **Capture** = serialize; **restore** = deserialize into a fresh heap.
- **Cost** is proportional to heap size: slow and memory-hungry at tab
  scale (a large page's heap is tens–hundreds of MB; serializing it on
  every hibernate defeats the memory win).
- **Determinism is not structural**: restoring a snapshot resumes *state*,
  not *behavior*; timers, RNG, and in-flight async all need extra
  instrumentation to replay faithfully.
- **Proven** (V8 snapshot API, freeze-dried) and engine-agnostic: works on
  today's engines over CDP — which is exactly its value as the interim.

### C. Deep-fork VM (rebuild around serializability)

Rebuild the VM so serializability is the substrate. The ultimate form, but
a 5–10 year program with no incremental wins. Not the phase-7 path; kept
open as the horizon if A fails in practice.

## Decision

1. **Engine base: a memory-safe, embeddable engine (Servo-class)** —
   compositor-first, Rust, no 30M-line mutable-state inheritance. This is
   the platform-wide Rust bet (`stateless-languages.md`, #12) applied to
   the browser. A Chromium/WebKit fork is explicitly rejected: the audit
   layer is un-addable to a mutable-state C++ engine, and the rebuild is
   the point. Servo vs from-scratch is settled at phase-7 kickoff by the
   prototype's feasibility study (embedding API, mutation-boundary hooks,
   compositor-first pipeline).
2. **Heap strategy: record-replay (A) is the primary strategy.** Journal at
   the VM boundary; cost tracks mutations, not heap size; determinism is
   structural. Heap snapshot (B) is the **bounded fallback** for
   pathological pages — WASM-heavy or large-heap origins where journaling
   is impractical — with an explicit `snapshot` mode in the blob envelope
   (`meta.capture: "journal" | "snapshot"`).
3. **Interim (tracks A 0–5, on today's engine): snapshot over CDP.** The
   tab-runtime's hibernation uses mechanism B on Chromium via CDP *today*,
   under the same blob contract. Different mechanism, same envelope — the
   interim ships the feature while the engine research runs, and its
   benchmarks (snapshot 0.97s, 99% state) become the audit layer's
   baseline to beat.

## The audit layer contract

The journal is a typed event log; the schema is a versioned part of the
state blob (`schemaVersion` gates it, per ADR 0002).

- **Event taxonomy** (the mutation surface): DOM operations, JS heap
  writes, timer registrations + firings, network (recorded request/response
  pairs), storage writes, crypto/PRNG state, worker + service-worker
  messages (ordered channels, separate per-worker journals), device input
  (the one untrusted external stream — journaled as events, not
  replayed by re-injection).
- **Checkpointing**: the journal is a delta over the last checkpoint;
  checkpoints are taken on hibernate (down-is-default) and on demand.
  Restore replays checkpoint → journal tail.
- **Virtualized time**: a per-tab virtual clock, seeded and journaled;
  `Date` and timers run on it; restore replays with the clock frozen at
  capture, then resumes.
- **Determinism obligations**: per-tab seeded PRNG (seed in the blob),
  `performance.now` from the virtual clock, layout-derived values treated
  as derived (never journaled), GPU/compositing rebuilt from DOM + layout.
- **WASM**: linear-memory serialization is large and poorly specified
  across engines. Phase-gate: WASM tabs fall back to a **controlled
  reload** (counted, never silent) in early phases; WASM journaling is a
  later phase, gated on the heap strategy proving out.
- **Sealing**: capture = stop the world → freeze → seal (hash + sign) →
  evict. The sealed blob is the only contract (rule 1).

## What phase 7 must prove (falsifiable gates)

The prototype (journal-everything engine core) passes only if:

- **Replay bit-stable**: same blob + same inputs → identical DOM + heap
  state on fixtures (the org's `replay-bitstable` gate).
- **Journal overhead < 25% of heap size** on the fixture set (idle tabs
  journal ≈ 0) — journaling must not turn memory debt into disk debt.
- **Capture pause < 300 ms** on the fixture set (hibernate is a
  background operation; visible tabs never freeze).
- **Restore to first paint < shell gate (100 ms)** and **full replay <
  reload time** for the fixture set — beating the snapshot baseline
  (0.97s) on the same benchmarks.
- **Base sharing**: N tabs over one immutable base; per-tab memory ≈ delta
  size (the `base-sharing` gate).

Any gate missed is reported as a finding, not papered over: the
checkpoint strategy, journal compression, and the snapshot fallback
threshold are the tuning knobs, in that order.

## Risks

- **Servo-class maturity**: embedding API and mutation-boundary hooks may
  not be ready — the phase-7 feasibility study must fail fast and name a
  fallback engine *before* code is written (the prototype is the proof).
- **Journal volume**: pathological pages (chat UIs, games, analytics
  storms) mutate heavily; the 25% gate and the snapshot fallback bound the
  exposure.
- **Trusted base**: the shared base is the browser's kernel — one
  compromised base compromises every tab. Immutable, read-only, COW,
  kernel-grade hardening; the audit layer itself is the security boundary,
  so journal validation (schema, bounds, signature) is mandatory on
  restore.

## Relationship

- `stateless-browser.md` — this spec is its phase-6 deliverable; phases
  7–10 consume the decision.
- `stateless-tab-runtime.md` — Track A's CDP snapshot is the interim
  mechanism under the same envelope.
- `stateless-languages.md` (#12) — Rust is the strategic core bet; the
  engine choice is that bet's largest consumer.
- ADR 0002 — the blob envelope (`meta.capture` distinguishes journal from
  snapshot) and ADR 0003 (Rust core) are the governing decisions.
