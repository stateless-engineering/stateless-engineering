# Spec: Automatic Work Decomposition & Distribution (stateless-compute)

Tracked under issue #13. The mesh doesn't just forward service
invocations — the platform **breaks work up and distributes it
automatically**: a job manifest declares a pure function over a blob; the
dispatcher derives the shard plan from the input, fans the shards out to
capable mesh peers (WebRTC and BLE tiers, `docs/specs/stateless-mesh.md`),
and merges the results deterministically. No cluster, no scheduler daemon —
the mesh *is* the pool, and "down is the default" means peers take shards
when they are available.

## Objective

A developer declares *what* to compute, never *how to split or schedule
it*. Given a job manifest and an input blob, the platform:

1. **Shards automatically** — deterministic, content-addressed split of
   the input (same input → same shard set, stateless rule 3).
2. **Distributes automatically** — each shard is dispatched to a peer
   chosen by capability ∩ trust, tie-broken by latency.
3. **Collects and merges** — shard results are blobs; the merge is a pure
   function ordered deterministically (index or sort-key).
4. **Recovers without state** — a lost shard is re-dispatched; shards are
   idempotent pure-function applications, so retry is replay, not repair.

Success criteria:

1. A 10-minute job on one machine completes in ~1/N wall time across N
   capable peers, with identical output to the single-machine run
   (determinism is the contract).
2. The dispatcher holds zero state: given the same manifest + input + peer
   inventory, any dispatcher re-derives the same plan.
3. Peers need no job knowledge — a peer executes (blob, input) → (blob,
   output); sharding and merging live entirely in the dispatcher.
4. Partial results are observable as blobs (progress without a daemon).
5. The BLE tier participates with micro-shards (≤ 200 B or pointers).

## The job manifest

```json
{
  "format": "stateless-job",
  "version": 1,
  "hash": "sha256:…",
  "function": "render.video-clip | infer.batch | transform.asset",
  "input": { "blob": "sha256:…", "shard": { "by": "hash-suffix" } },
  "n": 8,
  "merge": { "fn": "concat.sorted", "order": "index" }
}
```

- `function` is a pure service id — the same blob-contract dispatch as any
  webshell service (the mesh spec's `dispatch(peer, service, inputBlob)`).
- `shard.by` is a deterministic strategy: `hash-suffix` (split by content
  hash bits — balanced regardless of input order), `range` (numeric ranges
  for ordered data), or `list` (explicit shard pointers).
- `n` is the target shard count; the dispatcher may adapt to the peer
  inventory, but the *mapping from input to shards* is fixed by the
  manifest — adaptation changes only how many peers each shard visits.
- `merge` is a pure function over shard results, ordered by `index` (for
  ordered splits) or a `sort-key` (for map-style aggregation).

## Architecture

```
job manifest + input blob
        │
        ▼
dispatcher (stateless — re-derives the plan each run)
        │  shard plan: content-addressed, deterministic
        ├─► shard 0 ──► peer A ──► result blob 0
        ├─► shard 1 ──► peer B ──► result blob 1
        │  ...
        └─► shard N ──► peer C ──► result blob N
        │
        ▼
merge (pure, ordered) ──► output blob (hash-verified)
```

- **Shards and results are blobs** — content-addressed, hashed, signed.
  A lost shard is found again by hash; a re-run is a replay, not a repair.
- **Tree merge** for wide jobs: merge is itself decomposable, so a
  10,000-shard job merges hierarchically over the same mesh.
- **Progress** = the set of result blobs present in the blob store — an
  observer renders progress from content, with no job queue to query.

### The decomposition rules

1. **Derive, don't schedule.** The shard plan is a pure function of
   (manifest, input). No planner daemon remembers a job.
2. **Idempotent shards.** A shard is one pure-function application; peers
   may execute it twice with no corruption — dedupe happens at the merge
   by content hash.
3. **Capability before speed.** Peers advertise capabilities (GPU, RAM,
   BLE, model weights present); the dispatcher never sends a shard to a
   peer that cannot execute it.
4. **Micro-tier inclusion.** On the BLE tier, a shard is ≤ 200 B or a
   pointer to a content-addressed blob; store-and-forward means the BLE
   mesh contributes latency-tolerant shards (sensor aggregation, small
   transforms) without any infrastructure.
5. **Determinism is the contract.** Same manifest + input + peer set →
   same merged output; `sortTickets`-style discipline applied to
   distributed compute.

## Open questions

1. **Shard granularity** — fixed-size shards (max determinism) vs
   capability-adaptive (fast peers get more)? Default: fixed-size from the
   manifest; adaptive only as a *merge-time* optimization (never changes
   the shard mapping, only dispatch order).
2. **Retry semantics** — at-least-once with content-hash dedupe at merge
   (default; shards are pure) vs exactly-once via a checkpoint blob
   (needed only for side-effecting services, which the platform
   discourages anyway).
3. **Peer inventory** — where does the dispatcher learn who's capable?
   Default: the mesh's DHT + capability advertisement (mesh spec), cached
   for one plan-run only — no ambient inventory.
4. **Merge distribution** — when does a job warrant tree merge vs a
   single dispatcher merge? Default: single merge up to ~256 shards, tree
   beyond (merge blobs are themselves shardable).
5. **Trust weighting** — capability ∩ trust tie-broken by latency (mesh
   spec default) vs trust-first for financial/medical data? Default:
   manifest declares a `trust` requirement; default is capability-first.

## Boundaries

- **Always:** blob-contract dispatch; deterministic shard mapping;
  content-addressed results; zero dispatcher state; "down is the default"
  (peers take shards when available).
- **Ask first:** a stateful scheduler or job queue (violates the model);
  side-effecting functions in the job graph; cross-mesh federation;
  checkpoint/rollback semantics beyond replay.
- **Never:** a planner daemon; shard mapping that depends on which peers
  are online (the split is fixed; only dispatch adapts); results that
  cannot be verified by hash.

## Relationship

- `stateless-mesh.md` — the transport (WebRTC + BLE) and the
  `dispatch(peer, service, inputBlob)` primitive this spec builds on.
- `stateless-ai.md` — distributed inference is the first demanding
  workload: data-parallel sharding of prompts/requests, and model
  parallel sharding is this spec's decomposition rules applied to weights
  (tensor/pipeline splitting).
- `stateless-gaming.md` — background asset transforms (shader caches,
  save-sync, telemetry aggregation) are natural stateless-compute jobs.
- The tab-runtime blob format is the payload; no new contract.

## Sources

- The mesh spec's WebRTC/BLE research (RFC 8831, libp2p, Bluetooth Mesh
  SIG/nRF) — the transport layer.
- Map-reduce is standard distributed-compute knowledge; this spec's
  contribution is making it stateless: derive-don't-schedule, idempotent
  shards, blob-only I/O.
