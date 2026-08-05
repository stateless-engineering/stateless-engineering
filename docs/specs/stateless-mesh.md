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

### BLE open questions (resolved by research)

1. **Provisioning UX** — *resolved:* a provisioner service on the bridge;
   network keys derived from a signed manifest; no ambient key storage
   (SIG Mesh provisioning is the one setup step, and the bridge owns it).
2. **Blob size policy** — *resolved:* ≤ 200 B payloads on the BLE tier;
   larger content is a *pointer* to a content-addressed blob fetched
   out-of-band (BLE MTU reality).
3. **Relay flooding bandwidth** — *resolved:* subnets (SIG Mesh network
   keys partition the mesh) for dense deployments; managed flooding
   scales by partition, observed before tuning.
4. **Security** — *resolved:* signed micro-blobs + SIG Mesh keys (AES-128)
   for transport; the platform's blob signatures add authenticity that
   mesh keys alone don't provide.
5. **Bridge availability** — *resolved:* store-and-forward, always — the
   platform never depends on a bridge being up; BLE is a presence
   technology and the mesh treats it as such.

## Open questions (resolved by research)

1. **Peer selection** — *resolved:* capability ∩ trust, tie-broken by
   latency, then by stable peer-id (deterministic — the platform's rule 3).
   BOINC's volunteer model validates opt-in attach + trust weighting:
   peers advertise capabilities and attach deliberately; no peer is
   drafted.
2. **TURN economics** — *resolved:* one self-hosted relay per mesh
   (coturn-class); relay is the only infrastructure, and only symmetric
   NATs use it (the p2p-localhost finding: the data plane is direct after
   one negotiation touchpoint).
3. **Blob sync vs dispatch** — *resolved:* in-band under ~64 KiB (unified
   with the BLE micro-blob policy), out-of-band content-addressed fetch
   above — matches how model weights and media flow (see stateless-ai.md).
4. **Untrusted peers** — *resolved:* a three-rung sandbox ladder: **WASM**
   first (lightest, fastest cold start), **gVisor** for syscall-level
   native execution, **Firecracker microVM** for strong isolation on the
   VM tier (research heuristic: untrusted code ≥ gVisor; production data →
   microVM). The manifest declares which rung a job needs.
5. **Symmetric NATs** — *resolved:* TURN fallback accepted — relay for
   those peers only; direct for everyone else (ICE reality, RFC 8831).

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
- Bluetooth Mesh SIG profile + nRF Connect SDK docs (Nordic, 2026)
- Agent sandboxing: Firecracker microVMs, gVisor, WASM isolation
  comparisons (2025–2026)
- BOINC volunteer computing — opt-in attach, credit/trust weighting
  (boinc.berkeley.edu)
