# Spec: Distributed VMs as Stateless Services (stateless-vm)

Tracked under issue #13. **Cloud compute, but better**: VMs run as
stateless services on the stateless mesh. A VM is a manifest + disk blob +
service invocation — it hosts an OS the way a tab hosts a page. The disk
is an immutable base image plus a per-VM overlay delta (the tab runtime's
base/delta pattern applied to storage); "down is the default" — an idle VM
is a sealed delta blob, not a running hypervisor process. Peers contribute
CPU/RAM the way they contribute everything else: capability + trust,
brokered by the blob contract.

## Objective

A developer declares a VM (`os`, `cpu`, `ram`, `disk`, `cloud-init`), and
the platform runs it wherever a capable peer exists — local machine, LAN,
or a peer on the mesh. The VM is a service:

1. **At rest** — a sealed delta blob over a signed base image. Zero
   CPU, zero RAM, zero process. "Down is the default."
2. **Running** — materialized on a capable peer (KVM/QEMU), reachable
   like any service; inputs (SSH, HTTP, RPC) are service inputs.
3. **Mobile** — the delta blob migrates; the same VM continues on another
   peer (live migration via QCOW2 snapshot, LXD-class mechanism).
4. **Scaled** — a fleet of identical VMs is a stateless-compute job
   (`stateless-compute.md`): one manifest, N replicas, deterministic.

Success criteria:

1. An idle VM costs zero resources — the platform's core claim, applied
   to cloud compute.
2. Boot is from (base image blob + delta blob) — reproducible, signed,
   content-addressed; no golden-image drift.
3. Migration is blob movement, not state transfer gymnastics — the delta
   is the state.
4. A VM speaks the blob contract: it can dispatch to and receive from
   other services (mesh, AI, compute) like any peer.

## Research grounding

- **Akash Network** proves decentralized VM compute is real: a lease
  market on decentralized cloud resources deploys, manages, and scales
  VMs "securely and cost-effectively" — the "like cloud compute but
  better" precedent. The stateless twist: no lease market, no scheduler
  daemon — the mesh's capability + trust selection is the market.
- **QEMU qcow2** is the base/delta mechanism, already in production:
  an image with a **backing file** (immutable base) plus a writable
  **overlay** holding only the writes. That is exactly the blob base/delta
  pattern — a VM's entire state *is* the overlay.
- **LXD live migration** shows the mechanism: a QCOW2 snapshot of the
  root disk captures changes during migration — the delta is snapshotted,
  not the whole VM.
- **qemu snapshot save/load** (savevm/loadvm) can work on raw rootfs via
  a live overlay: in-session rewind is cheap; durable snapshots need a
  writable qcow2 for metadata. Honest boundary: fast suspend/resume is
  machine-specific (CPU flags, device state) — a cold boot from the
  delta is the portable contract; savevm is the optimization.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  VM manifest (app.json-style)                               │
│  { os: "debian-13", cpu: 2, ram: 4Gi, disk: 20Gi,          │
│    cloudInit: {…}, ports: [22, 80], capabilities: […] }    │
└──────────┬──────────────────────────────────────────────────┘
           │ materialize on capable peer (capability ∩ trust)
┌──────────▼──────────────────────────────────────────────────┐
│  VM service (KVM/QEMU on the peer)                          │
│  disk = signed base image blob ─ overlay delta blob         │
│  inputs: SSH/HTTP/RPC (service inputs)                      │
│  state: sealed delta blob at rest · snapshot = seal delta   │
└──────────┬──────────────────────────────────────────────────┘
           │ migration: delta blob moves (QCOW2 snapshot, LXD-class)
┌──────────▼──────────────────────────────────────────────────┐
│  blob store (the image registry, decentralized)             │
│  base images: signed, content-addressed · deltas: per-VM    │
└─────────────────────────────────────────────────────────────┘
```

### The stateless fit

- **Disk = base + delta = the tab runtime's base/delta.** An immutable
  signed base image (qcow2 backing file) + a per-VM writable overlay
  (qcow2 overlay = the delta blob). N VMs from one base share it; each
  VM's state is its delta. Snapshot = seal the delta; restore = new
  overlay over the same base.
- **Memory is derived** (same rule as GPU in the browser/gaming specs):
  the portable state is the delta disk + manifest, not RAM. Fast resume
  via savevm exists as an optimization where the host CPU matches; cold
  boot from the delta is the contract that always works.
- **The mesh is the cloud.** No data center, no lease market: the
  dispatcher (mesh spec) selects a peer by capability ∩ trust, tie-broken
  by latency. A VM is one more service in the pool.
- **Fleet = stateless-compute job.** "Break up work and distribute it
  automatically" applies to scale-out: a job manifest with `n` replicas
  of the same VM image; each replica is an idempotent shard (boot, run,
  seal).
- **cloud-init = the config blob.** Declarative provisioning (users,
  packages, SSH keys) is a manifest field, so every boot from a base
  image is reproducible — no golden-image drift.

### Components

| Component | Language | Responsibility |
|---|---|---|
| VM service | Rust core + QEMU/KVM | materialize/seal VMs; overlay delta management; port mapping |
| image store | shared blob store | signed base images (content-addressed); the decentralized registry |
| migration | Rust | delta snapshot + transfer (QCOW2 snapshot, LXD-class); live for LAN, cold for WAN |
| fleet dispatcher | stateless-compute | N-replica scale-out: one manifest → idempotent VM shards |
| capability broker | shared | peers advertise CPU/RAM/KVM; dispatcher never schedules on incapable peers |

## Open questions

1. **Fast resume (savevm) vs cold boot** — savevm gives instant resume
   but is host-CPU-specific; cold boot from the delta is portable. 
   Default: cold boot is the contract; savevm is a peer-local cache
   optimization, never the portable state.
2. **Live migration scope** — LAN live migration (LXD-class, QCOW2
   snapshot) vs WAN (cold: seal delta, move, boot). Default: live on LAN,
   cold across the WAN mesh; memory-heavy live migration over WebRTC
   bandwidth is not the v1.
3. **Trust for running VMs** — an untrusted peer hosting a VM is a
   hypervisor-trust question. Default: signed base images + KVM
   isolation; manifest declares `trust` (same field as stateless-compute);
   confidential computing (SEV/SNP) is a later, explicit capability.
4. **Image provenance** — base images are signed by whom? Default: the
   org's key for the platform's images; third-party images require an
   explicit trust declaration in the manifest (same shape as the mesh
   trust weighting).
5. **Delta growth** — an overlay grows with uptime; snapshot cadence?
   Default: seal-on-quit + periodic checkpoint deltas for long-running
   VMs (each checkpoint is a new hashed blob — versioning makes them
   free, same answer as gaming saves).

## Boundaries

- **Always:** VM = manifest + disk blob + service invocation; disk is
  base+delta; "down is the default" (no running VM without a consumer);
  memory is derived, never the portable state; signed images.
- **Ask first:** a lease market or scheduler daemon (violates the model —
  the mesh's capability+trust selection is the market); confidential
  computing as a platform capability; multi-tenant GPU VM scheduling
  (gaming spec's open question); reverse-engineering anti-cheat or DRM
  inside VMs (never — compatibility is the vendor's call).
- **Never:** golden-image drift (every boot from signed base + manifest);
  state outside the delta (no host-local VM state); a VM that cannot be
  sealed and re-materialized elsewhere.

## Relationship

- `stateless-mesh.md` — the transport and capability advertisement; a VM
  peer is a mesh peer with CPU/RAM/KVM capabilities.
- `stateless-compute.md` — fleets are N-replica shards; the VM lifecycle
  (boot/run/seal) is the idempotent shard contract.
- `stateless-gaming.md` — the GPU service is a VM-shaped capability; the
  same base/delta disk model carries game environments.
- `stateless-native-apps.md` — native apps can be the guest payload a VM
  hosts; both are manifest + blob + service.
- `stateless-ai.md` — a GPU/CPU VM is a natural inference node on the
  mesh; model weights are blobs the VM mounts.
- The tab-runtime blob format carries disk deltas; no new contract.

## Sources

- Akash Network — decentralized VM cloud compute (AEP-49, 2026)
- QEMU qcow2 backing-file/overlay images (Ubuntu cloud image docs)
- LXD VM live migration internals — QCOW2 snapshot of the root disk
- QEMU snapshot save/load on raw rootfs via live overlay (qmu issue #17)
