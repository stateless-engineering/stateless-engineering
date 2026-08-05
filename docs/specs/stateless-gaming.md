# Spec: Gaming in the Ecosystem (stateless-gaming)

Tracked under issue #13. Running games — Steam-class, GPU-bound, native —
inside the stateless platform: the **game service**. A game session is a
service invocation: the game runs in a GPU service (Proton on Linux, like
the Steam Deck), frames stream to any device as service outputs, inputs
are service inputs, and the save game is the state blob. "Down is the
default" — a paused game hibernates to its save blob.

## Objective

A player launches a game from the webshell, plays it on any device
(desktop, TV, phone — local GPU or a remote GPU service over the mesh),
pauses, and resumes later from exactly the save state — on any device.
The platform treats gaming as one more stateless service: manifest +
state blob + render service, exactly like every other app.

Success criteria:

1. `app.json` gains a `game` capability: `{ "type": "game", "gpu": true,
   "save": { "format": "blob" } }` — a game is a manifest, nothing else
   new in the model.
2. Launch/pause/resume works over the mesh: frames stream (local or
   remote GPU), save state syncs as a blob, resume is blob → game.
3. Steam-class games run on the platform's Linux base (Proton) with
   modern compatibility — verified against the Steam catalog's playable
   set.
4. A background game is a save blob at rest: zero GPU, zero CPU, zero
   network ("down is the default").
5. **Saves are deterministic**: a paused game seals a canonical blob —
   same game state → same hash. Resume is hash-verified and
   byte-identical on any device; a pause with no state change produces
   the same blob, not a new one.

## Research grounding

- **Proton** (Valve) is a compatibility layer on Wine + **DXVK**
  (DirectX 9/10/11 → Vulkan) + **VKD3D-Proton** (DirectX 12 → Vulkan).
  It is *not* an emulator — the GPU is used directly. Proton 11.0 (2026)
  is stable, rebased on Wine 11, with Windows-level frame pacing; the
  community GE-Proton builds push compatibility further.
- **Steam Deck / SteamOS** proves the base: a Linux handheld running
  Steam games via Proton, with gamescope as the compositor — the exact
  host shape a game service needs.
- **Frame streaming** precedent: Moonlight/Sunshine (open-source
  NVIDIA GameStream protocol implementation — H.264/HEVC/AV1 encode,
  low-latency transport) and Steam Remote Play show the streaming half
  works today.
- **Honesty check**: anti-cheat is the hard boundary. Kernel-level
  anti-cheat (EAC, BattlEye) historically breaks under Wine/VMs; both
  vendors added Linux/Proton support for whitelisted titles, but the
  platform must treat anti-cheat games as a compatibility question, not a
  solved one.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  game service (the GPU row of the service table)            │
│  headless Linux base (SteamOS-class) + Proton + gamescope   │
│  render: frames out · input: gamepad/pointer in ·           │
│  state: save blob in/out                                     │
└──────────┬──────────────────────────────────────────────────┘
           │ frame stream (H.264/HEVC/AV1, low latency)
           │ input events (service inputs)
           │ save blob (content-addressed, signed)
┌──────────▼──────────────────────────────────────────────────┐
│  player device (webshell client)                            │
│  renders frames · forwards input · holds the save blob      │
└─────────────────────────────────────────────────────────────┘
```

### The stateless fit

- **Session = save blob + service invocation.** A game at rest is its
  save game (content-addressed, versioned — same envelope as every blob).
  "Pause" = seal save blob + evict the game process; "resume" = spawn the
  game service with the blob. No running game holds memory when nobody is
  playing — the platform's tab-hibernation discipline applied to games.
- **GPU state is derived** (same rule as the browser spec): never
  serialize the GPU — the frame output is rebuilt from the game state.
  Save blobs carry *game* state (progress, settings, world), not GPU
  internals.
- **Local or remote is the same contract**: the webshell dispatches to
  the GPU service wherever it is — local machine, LAN peer, or a mesh GPU
  node (`stateless-mesh.md`). The player device only renders.
- **Native games aren't freeze-dried** — honest boundary: the audit-layer
  (browser rebuild) serializes web runtimes; native game processes are
  not serializable. The save blob is the state unit, and streaming covers
  the "instant resume" UX (resume = load save, not replay a journal).

### Components

| Component | Language | Responsibility |
|---|---|---|
| game service | Rust core + Proton | headless game host: launch via Proton, gamescope compositing, input/audio plumbing |
| streamer | Rust | frame encode (VA-API/NVENC), low-latency transport (Moonlight/Sunshine-class protocol) |
| save sync | shared blob store | save game as content-addressed blob; sync across devices; conflict = newest-wins by hash? |
| input service | shared | gamepad/pointer events as service inputs (same contract as every input) |

## Deterministic game saving (pause = sealed blob)

A paused game is a **deterministic save blob**: a pure function of game
state. Same state → same hash. This is the platform's rule 3 (same inputs
→ same behavior) applied to game saves, and it turns "pause" into the
cleanest possible state primitive.

### The determinism contract

`seal(state) → blob` must be canonical: identical state serializes to
identical bytes, always.

1. **Fixed timestep** — the simulation advances on a fixed tick, never
   wall-clock; the tick counter is part of state. Wall-clock/playtime is
   *metadata outside the blob*, declared nondeterministic.
2. **Seeded RNG** — every source of randomness is a seeded PRNG; the
   seed is part of state. No unseeded entropy enters the simulation.
3. **Deterministic iteration** — no hash-map/hash-set order dependence;
   iteration is by explicit order (arrays, sorted collections).
4. **Canonical serialization** — ordered fields, fixed-width numerics,
   IEEE floats serialized canonically (explicit NaN/denormal policy), no
   timestamps, no session IDs, no machine identifiers in the payload.
5. **Verifiable** — the blob is hashed + signed (the platform envelope);
   loading verifies before materializing. A corrupted or malicious save
   cannot inject state.

### Pause = freeze, seal, evict

```
player pauses
  → game service freezes the fixed-timestep loop (no further ticks)
  → seal(state) → canonical blob → hash + sign → store
  → game process evicted ("down is the default")
resume
  → open(blob) → verify hash/signature → materialize state
  → advance ticks from the recorded tick counter
```

"Pause" and "quit" are the same operation — seal + evict. A checkpoint is
just another seal, and because blobs are content-addressed, an unchanged
game between checkpoints produces *the same hash* — one blob, not two.

### What determinism buys

- **Dedupe** — pause twice with no change = one blob.
- **Time travel** — every seal is a new hashed blob; rewind = materialize
  an older hash (the tab-runtime blob format's versioning, free).
- **Cross-device resume** — byte-identical state on any device with the
  game; deterministic seal + blob = no drift.
- **Replay** — the same determinism that makes replays reproduce
  (record inputs + seed, re-simulate — shmup/TAS practice) makes saves
  rewind points in replay space: a deterministic save + input stream is an
  exact re-run.
- **Divergence checking** — after resume, optionally re-simulate N ticks
  and compare a derived hash against the recorded one (the deterministic
  engine-substrate pattern) — corruption detection beyond the blob hash.

### Honest limits

- Determinism covers the *simulation*, not the renderer — GPU output is
  derived (the platform's rule; same as browser/GPU state), so frames may
  differ across drivers while state is identical.
- Long-run replay determinism has practical limits (recording inputs +
  seed reproduces runs, but unbounded state growth needs rewind points —
  exactly what versioned blobs provide).
- Some engines are not deterministic by default; determinism is an
  opt-in contract games declare in `app.json`
  (`"deterministicSaves": true`), and the platform validates it at
  development time: seal twice → same hash → test gate.

## Open questions (resolved by research)

1. **GPU virtualization** — *resolved:* **VFIO passthrough** (whole GPU)
   is the default for a game service — one game at a time, full
   performance, no license friction; **SR-IOV / MIG** for sharing GPUs
   across concurrent sessions where the vendor path allows it (research:
   NVIDIA MIG/vGPU requires AI Enterprise licensing; AMD SR-IOV/ROCm on
   Instinct; licensing cost is the gating factor, not technology).
2. **Anti-cheat** — *resolved (policy):* whitelisted-Proton titles are
   supported; everything else degrades with a clear compatibility badge in
   the manifest. Kernel anti-cheat (EAC/BattlEye) compatibility is the
   vendor's call — the platform never circumvents it.
3. **Streaming budget** — *resolved:* AV1 where the encoder exists
   (VA-API/NVENC), H.264/HEVC fallback; target < 60 ms glass-to-glass on
   LAN (the mesh local tier), WAN via the WebRTC tier (Moonlight/
   Sunshine-class protocol precedent).
4. **Save conflict semantics** — *resolved by deterministic saves:*
   conflicts are explicit — two hashes, resume by reference (the manifest
   pins the blob); automatic merge only for structured saves, later.
5. **Save-state frequency** — *resolved by deterministic saves:*
   pause-seal is the default (seal + evict, same as quit); optional
   checkpoints for crash-prone sessions — unchanged state between
   checkpoints yields the *same* hash (dedupe for free).

## Boundaries

- **Always:** game = manifest + save blob + service; GPU state derived,
   never serialized; "down is the default" (no running game without a
   player); content-addressed saves.
- **Ask first:** a game launcher/storefront (out of scope — the platform
   runs games, it doesn't sell them); DRM integration; multi-GPU
   scheduling; anti-cheat workarounds (never circumvent — compatibility
   is the vendor's call).
- **Never:** emulator claims (Proton is a compatibility layer, not an
   emulator); serialize GPU state; a game holding resources while
   paused; universal-compatibility claims.

## Relationship

- `stateless-mesh.md` / `stateless-compute.md` — remote GPU play and
  background jobs (shader caches, telemetry aggregation) use the mesh
  and auto-decomposition; the compute spec's determinism rules are the
  save-blob contract's cousins.
- `stateless-languages.md` — the GPU service is the Zig/C++ hot-loop row
  wrapped in Rust; streaming is the Go/Rust network row.
- `stateless-native-apps.md` — the player client is a native app (the
  Rust host) when not in the browser.
- The tab-runtime blob format carries saves (versioned, hashed, signed);
  deterministic saves are that envelope with a canonical payload. No new
  contract.

## Sources

- Proton (Valve) / DXVK / VKD3D — compatibility layer docs (dxvk.org,
  Valve releases; Proton 11.0 stable, 2026)
- GE-Proton community builds (2026)
- Steam Deck / SteamOS / gamescope — the headless-game-host precedent
- Moonlight/Sunshine — open-source GameStream protocol implementation
- Deterministic simulation for replays — fixed timestep, seeded RNG,
  deterministic iteration/math (bugnet.io, 2026)
- Save/replay systems in shmups — input stream + RNG seed re-simulation,
  serialization versioning, long-run limits (flukz.org, 2026)
- GGPO-style rollback netcode — fixed-step simulation, state capture,
  replay (Rollback-Core, UE5)
- Deterministic engine substrate — fixed timestep, seed/tick handling,
  replay + divergence checking, snapshot boundaries (xenor-engine)
- GPU virtualization for gaming VMs: VFIO passthrough, NVIDIA MIG/vGPU
  licensing, AMD SR-IOV (2025–2026)
