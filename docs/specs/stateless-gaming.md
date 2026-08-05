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

## Open questions

1. **GPU virtualization** — for remote/mesh GPU services: full GPU
   passthrough (VM), SR-IOV, or MFA (mediated passthrough)? Default:
   passthrough where available; MFA when sharing matters; a GPU service
   is one game at a time in early phases (deterministic, no scheduler).
2. **Anti-cheat** — kernel anti-cheat (EAC/BattlEye) breaks Wine/VMs.
   Default: whitelisted-Proton titles are supported; others degrade with
   a clear compatibility badge in the manifest. Never claim universal
   compatibility.
3. **Streaming budget** — target latency/codec: default 1080p60 AV1
   where the encoder exists, H.264/HEVC fallback; < 60 ms glass-to-glass
   on LAN (mesh local tier), WAN via the WebRTC tier.
4. **Save conflict semantics** — the blob store is content-addressed;
   two devices resume the same save → merge policy? Default: explicit
   "resume latest" by blob reference (the manifest pins the save blob);
   automatic merge only for structured saves, later.
5. **Save-state frequency** — checkpoint blobs (periodic) vs quit-only?
   Default: quit-only + optional checkpoints for games with crash-prone
   sessions; the blob versioning makes checkpoints free (each is a new
   hashed blob).

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
  and auto-decomposition.
- `stateless-languages.md` — the GPU service is the Zig/C++ hot-loop row
  wrapped in Rust; streaming is the Go/Rust network row.
- `stateless-native-apps.md` — the player client is a native app (the
  Rust host) when not in the browser.
- The tab-runtime blob format carries saves; no new contract.

## Sources

- Proton (Valve) / DXVK / VKD3D — compatibility layer docs (dxvk.org,
  Valve releases; Proton 11.0 stable, 2026)
- GE-Proton community builds (2026)
- Steam Deck / SteamOS / gamescope — the headless-game-host precedent
- Moonlight/Sunshine — open-source GameStream protocol implementation
