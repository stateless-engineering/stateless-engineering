# Spec: Distributed Mesh Compute (stateless-mesh)

Tracked under issue #13. The mesh row of the language strategy
(`docs/specs/stateless-languages.md` — Go for networking/concurrency) made
concrete: a peer-to-peer mesh where **compute is a service invocation**.
Peers execute (blob, input) → (blob, output) contracts over WebRTC data
channels; the state blob is the only thing that crosses the wire.

## Objective

A device farm — laptops, desktops, edge boxes — forms a mesh and runs
stateless services for each other: a render job dispatched from one peer,
executed on another, result returned as a blob. No cloud relay for data
("touch the cloud exactly once, to negotiate the connection, then carry
traffic directly between peers" — the WebRTC localhost-mesh pattern), no
daemons, no ambient state. Peers are pure services behind the blob
contract; "down is the default" — an idle peer hibernates.

Success criteria:

1. A task blob dispatched from peer A executes on peer B and returns a
   result blob — same contract as every other service in the platform.
2. NAT traversal is automatic (ICE/STUN/TURN); direct peer-to-peer when
   possible, relay only as fallback.
3. Discovery is decentralized (DHT), deterministic, and stateless — no
   registry daemon to keep alive.
4. A peer contributes compute without running any persistent service —
   the mesh host is itself stateless and disposable.
5. Trust is explicit: blobs are signed/hashed; a peer executes only
   manifests it accepts.

## Research grounding

- **WebRTC data channels (RFC 8831)** are the transport: SCTP-based,
  encrypted (DTLS), with automatic NAT traversal via ICE. They give
  browser peers *and* native peers the same p2p path.
- **libp2p's WebRTC transport** is its most actively developed transport —
  browser-compatible, "superior NAT traversal capabilities" — and libp2p
  already provides Kademlia DHT discovery, which is the discovery half.
- **STUN/TURN/ICE**: STUN punches holes; TURN relays when the NAT is
  symmetric/unbeatable. The p2p-localhost-mesh pattern shows the data
  plane can be fully direct after a one-time negotiation touchpoint.
- **Distributed-compute precedents** (BOINC-class grid, Golem-class
  markets) prove task-blob dispatch at scale; the stateless twist is that
  we dispatch *service invocations with blob I/O*, not batch jobs.

## Architecture

```
┌─────────────┐  task blob (signed, hashed)   ┌─────────────┐
│ peer A      │ ────────────────────────────► │ peer B      │
│ (dispatcher)│                               │ (executor)  │
│ webshell    │  result blob ◄──────────────── │ mesh host   │
└─────────────┘                               └─────────────┘
     ▲  discovery: Kademlia DHT (libp2p)
     │  transport: WebRTC data channel (ICE/STUN/TURN)
     ▼  state: blob store sync (CRDT-style, content-addressed)
┌───────────────────────────────────────────────────────────┐
│  relay fallback (TURN) — only when a NAT cannot be beaten │
└───────────────────────────────────────────────────────────┘
```

### Components

| Component | Language | Responsibility |
|---|---|---|
| mesh host (peer runtime) | Go | WebRTC transport, DHT discovery, task execution, capability advertisement |
| dispatcher | webshell integration | picks a peer (capability + latency + trust), sends task blob, verifies result blob |
| blob store sync | shared | content-addressed sync of task/result blobs across peers; dedupe by hash |
| TURN relay (fallback) | Go | last-resort relay for symmetric NATs; the only infrastructure a mesh needs |

### The dispatch contract

```
dispatch(peer, service, inputBlob) → outputBlob
  inputBlob:  { service, payload, signed-by: dispatcher }
  outputBlob: { result, hash, signed-by: executor }
```

Same shape as every webshell service call — a mesh peer is just a service
that happens to be remote. Breaking work up and distributing it
automatically is `docs/specs/stateless-compute.md` — this contract is its
primitive.

## BLE + Bluetooth meshing (the low-power mesh)

The WebRTC mesh is high-bandwidth but power-hungry and range-limited by
Wi-Fi/cellular. The platform's mesh also needs a **low-power, short-range,
ad-hoc** tier: phones, wearables, sensors, controllers — devices whose
radio budget rules out continuous WebRTC. That tier is native BLE with the
Bluetooth SIG Mesh profile.

### Research grounding (BLE)

- **Bluetooth Mesh (SIG profile)** extends BLE from a star topology
  (one central, many peripherals) to a **many-to-many network**: one-to-
  one, one-to-many, and many-to-many messaging; hundreds of nodes across
  hundreds of meters — far beyond any single device's range.
- It uses **managed flooding with relay nodes** — no routing tables.
  Every node can relay; network reach grows by density, not by
  configuration. That is a mesh that *is* the network: no registry, no
  daemon, no route computation — exactly the stateless disposition.
- **nRF Connect SDK (Nordic)** is the reference implementation, with
  samples for provisioning, relay, and low-power nodes.
- BLE packets are tiny (advertising ~31–62 B; MTU ~251 B) and
  low-power by design — advertising *is* beacon-on-demand, which is
  "down is the default" at the radio level.

### BLE in the stateless model

- A BLE node is a **stateless service with micro-blobs**: a sensor
  *is* a state-blob emitter; a controller is an input service; a display
  is a render service. The blob contract is unchanged — only the payload
  size shrinks.
- **Managed flooding = no ambient state**: provisioning (network key +
  app keys) is the only setup; after that, nodes relay without knowing a
  topology. This is the mesh's strongest fit with the six stateless rules.
- **Opportunistic store-and-forward**: a node that cannot reach the
  WebRTC mesh holds signed micro-blobs and forwards them when a bridge is
  in range — the blob is the only thing that waits; no queue daemon.
- **Heterogeneous mesh, one contract**: a phone or laptop with both
  radios is a **bridge** — BLE tier ↔ WebRTC tier. The blob format is
  the only thing that crosses the bridge, so the two meshes are one
  logical network with two physical layers.

```
BLE nodes (sensors/controllers) ── BLE Mesh (flooding, relays) ──► bridge ──► WebRTC mesh ──► peers
     micro-blobs (signed)          no routing, no daemons            (phone/laptop)     full blob store
```

### BLE open questions

1. **Provisioning UX** — Bluetooth Mesh provisioning (out-of-band
   identification, network keys) is the one stateful setup step. Default:
   a provisioner service on the bridge; keys derived from a signed
   manifest, no ambient key storage.
2. **Blob size policy** — what fits in a micro-blob? Default: ≤ 200 B
   payloads on the BLE tier; anything larger is a *pointer* to a
   content-addressed blob fetched out-of-band when a bridge is reached.
3. **Relay flooding bandwidth** — managed flooding is robust but
   bandwidth-hungry as nodes grow. Default: subnets (BLE Mesh network
   keys partition the mesh) for dense deployments; observe before tuning.
4. **Security** — BLE Mesh uses 128-bit AES with network/app keys; the
   stateless twist is that blob signatures must be verifiable by any
   relay (public-key verify, not secret sharing). Default: signed
   micro-blobs; mesh keys protect the transport only.
5. **Bridge availability** — BLE is a *presence* technology; the mesh
   must treat bridges as "down by default" and survive without them
   (store-and-forward). Default: yes — the platform never depends on a
   bridge being up.

## Open questions

1. **Peer selection** — capability-first (who has the GPU) vs latency-first
   vs trust-weighted? Default: capability ∩ trust, tie-broken by latency.
2. **TURN economics** — who runs the relay? Default: self-hosted, one
   relay per mesh; relay bandwidth is the only cloud touchpoint.
3. **Blob sync vs dispatch** — do task/result blobs flow over the data
   channel (in-band) or via content-addressed fetch (out-of-band, DHT)? 
   Default: in-band for small blobs, out-of-band for large (weights,
   media) — matches how the platform will ship model weights (see
   stateless-ai.md).
4. **Untrusted peers** — execution sandboxing on the executor
   (container/WASM?), and what a peer may *not* do even with a valid
   manifest. Default: WASM first (matches app-logic), native exec only
   with explicit capability grants.
5. **Symmetric NATs** — TURN is the answer but adds latency; is a mesh
   that degrades gracefully to relay-only for those peers acceptable?
   Default: yes.

## Boundaries

- **Always:** blob contract only; signed+hashed payloads; no registry
  daemon; peers stateless and disposable; "down is the default".
- **Ask first:** a central scheduler/registry (violates the model);
  un-sandboxed native execution on untrusted peers; cross-mesh federation.
- **Never:** a cloud relay as the data plane (negotiation-only);
  ambient state on peers; a mesh that cannot function when the cloud
  touchpoint is gone.

## Relationship

- `stateless-languages.md` — mesh = Go row; this spec is its architecture.
- `stateless-ai.md` — distributed inference is the first demanding mesh
  workload (bandwidth, model blobs).
- `stateless-gaming.md` — game streaming can use the mesh for LAN-local
  frame transport.
- The tab-runtime blob format is the payload format; no new contract.

## Sources

- RFC 8831 (WebRTC Data Channels), datatracker.ietf.org/doc/rfc8831/
- libp2p go-libp2p WebRTC transport docs (DeepWiki, 2026)
- "P2P Localhost Meshes: Replacing Cloud Relays with WebRTC Data
  Channels" (Substack, 2026)
- WebRTC NAT traversal STUN/TURN/hole-punching guides (2026)
