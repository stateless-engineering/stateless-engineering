# Spec: Distributed AI Inference (stateless-ai)

Tracked under issue #13. The AI row of the language strategy
(`stateless-languages.md` — Python behind gRPC, ONNX-Rust later) made
concrete and *distributed*: inference is a stateless service; model
weights are content-addressed blobs; requests route over the mesh
(`stateless-mesh.md`) to whichever peer has the model + capacity; large
models split across peers via automatic decomposition
(`stateless-compute.md`). "Down is the default" — a model is a blob at
rest, loaded only while a request is being served.

## Objective

A request (`model`, `prompt`, `state`) is a service invocation. The
platform:

1. **Routes** — sends the request to a peer that holds the model
   (weights as blobs) and has capacity (capability ∩ trust, latency
   tie-break).
2. **Serves locally-first** — a local llama.cpp-class engine answers when
   the model fits; no network hop for local models.
3. **Distributes when needed** — models too big for one peer split via
   tensor/pipeline parallelism (stateless-compute's decomposition rules
   applied to weights).
4. **Keeps continuations stateless** — the conversation/KV state is a
   blob, so a request can resume on a different peer.

Success criteria:

1. `infer(model, inputBlob) → outputBlob` is the only contract — same
   shape as every service in the platform.
2. Model weights are content-addressed, signed blobs: fetch once, verify
   by hash, share across peers (dedupe by hash).
3. A model too large for one device still runs: decomposed across mesh
   peers with deterministic output (tensor/pipeline splitting).
4. Continuation portability: a conversation state blob resumes on any
   peer that holds the model.
5. Idle models cost zero resources — loaded on demand, evicted after
   (the platform's core claim, applied to AI).

## Research grounding

- **llama.cpp** is the local-first engine: runs models on consumer
  hardware, and supports **tensor parallelism and pipeline parallelism**
  across GPUs/machines (multi-GPU and distributed inference) plus an
  RPC server for multi-node clusters. The Red Hat comparison: llama.cpp
  for local/single-user; **vLLM** for high-throughput server-side
  (PagedAttention, continuous batching).
- **Distributed-inference guides** distinguish tensor (split layers across
  devices — bandwidth-hungry), pipeline (split by layer stages — LAN/
  WAN-tolerant), and data parallelism (replicate + shard requests —
  bandwidth-light). A key finding: **1 Gbps is enough for some workloads,
  not others** — tensor parallelism across WAN is impractical; pipeline
  and data parallelism travel well.
- **distributed-llama.cpp** shows the operational pattern: a central
  server accepts OpenAI-compatible requests and routes them to client
  nodes running llama.cpp, secured with mutual TLS — the routing +
  mTLS shape the mesh already needs.

## Architecture

```
infer(model, inputBlob) → outputBlob
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  model registry (blob store)                                │
│  weights: content-addressed, signed blobs · quantized forms │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  router (mesh dispatcher)                                   │
│  capability: has-model ∩ gpu/ram ∩ trust, latency tie-break │
└──────────┬──────────────────────────────────────────────────┘
           │
   ┌───────┴──────────┐
   ▼                  ▼
┌──────────────┐  ┌──────────────────────────────┐
│ local engine │  │ decomposed inference         │
│ llama.cpp    │  │ pipeline parallel across     │
│ (model fits) │  │ peers (stateless-compute)    │
└──────────────┘  └──────────────────────────────┘
        │
        ▼
   outputBlob + state blob (KV/conversation, content-addressed)
```

### The stateless fit

- **Weights are blobs, not installs.** A model is a content-addressed,
  signed blob (or a set: base + quantized forms). A peer "has the model"
  iff its blob store holds the hash. Fetch = blob sync (mesh spec);
  update = new hash. No model installers, no global state.
- **Inference is a pure function with a state blob.** `infer(model,
  input, state)` → `(output, newState)` — the KV cache/conversation is
  the state blob, versioned like everything else. Continuation on another
  peer = dispatch with the state blob (the tab-runtime restore idea, at
  the token level).
- **Decomposition rules apply to weights.** Pipeline parallelism is the
  natural mesh split (layer stages travel well over WAN); tensor
  parallelism stays LAN-only (bandwidth); data parallelism is the
  stateless-compute N-replica path for batch workloads.
- **"Down is the default" for models.** No model resident without a
  request: the engine loads on dispatch, evicts after idle. A 70B model
  on a laptop is a blob at rest until something asks for it.
- **Local-first is the platform's ethic** — same model, same contract,
  fewer hops: the router prefers the peer that already holds the weights.

### Components

| Component | Language | Responsibility |
|---|---|---|
| inference service | Rust wrapper + llama.cpp/vLLM | local serving; tensor/pipeline split orchestration |
| model registry | shared blob store | signed weight blobs; quantization variants; provenance |
| router | mesh dispatcher | has-model ∩ capacity ∩ trust selection; state-blob routing |
| state store | shared blob store | KV/conversation blobs (content-addressed, sealed per turn) |
| batch worker | stateless-compute | data-parallel inference: N requests as idempotent shards |

## Open questions

1. **Parallelism policy** — pipeline across the mesh (WAN-tolerant) vs
   tensor within a LAN node-group? Default: local single-node when the
   model fits; pipeline across peers for bigger models; tensor only
   inside one trusted LAN peer-group (bandwidth math decides).
2. **Engine choice** — llama.cpp (local, single-user) vs vLLM
   (server-side throughput) per deployment, same contract? Default: yes —
   the engine is a service implementation behind `infer()`, exactly the
   language spec's "swap without touching the system".
3. **KV portability** — is the KV cache blob truly portable across
   engines (format is engine-specific today)? Default: state blob v1 =
   conversation + session metadata (portable); raw KV cache is a
   peer-local cache optimization, not the contract (same answer as
   gaming savevm).
4. **Weights distribution** — pull-by-hash from the mesh (store-and-
   forward over BLE/WebRTC) vs a seed peer? Default: pull-by-hash;
   a 70B blob over BLE is a pointer + patience, not a transfer.
5. **Trust for inference** — models are signed; untrusted models run in
   the same sandbox as untrusted apps (capability-confined). Default:
   yes — a model is data, not code, until it runs; then it's the
   native-app sandbox.

## Boundaries

- **Always:** `infer(model, inputBlob) → outputBlob` + state blob;
   weights content-addressed and signed; local-first; "down is the
   default" for models; decomposition rules from stateless-compute.
- **Ask first:** model training (out of scope — inference only); a
   model marketplace (a registry, not a storefront); tensor-parallel
   spans beyond one trusted LAN group; hosted/inference-as-a-SaaS (the
   platform is FOSS software, not a cloud API).
- **Never:** weights shipped as unverified opaque installs; state that
   cannot resume on another peer (beyond engine-local KV caches); a model
   resident without a request.

## Relationship

- `stateless-mesh.md` — routing, capability advertisement, blob sync
  (and BLE micro-inference for tiny models/classifiers on the low-power
  tier).
- `stateless-compute.md` — data-parallel batches and pipeline splits are
  this spec's decomposition rules.
- `stateless-vm.md` — a VM is a natural inference node (mounts weight
  blobs, runs the engine in the guest).
- `stateless-languages.md` — Python/gRPC now, ONNX-Rust later; the
  engine is a swappable service implementation.
- The tab-runtime blob format carries weights and state; no new
  contract.

## Sources

- llama.cpp: multi-GPU and distributed inference (tensor/pipeline
  parallelism), RPC server (DeepWiki, 2026)
- "Distributed Inference: Run One LLM Across Many Machines" — tensor vs
  pipeline vs data parallelism, bandwidth guidance (2026)
- Red Hat: llama.cpp vs vLLM — choosing the local inference engine (2026)
- distributed-llama.cpp — central server routing to mTLS client nodes
  (GitHub, 2026)
