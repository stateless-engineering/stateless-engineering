# Spec: Building Native Apps in the Ecosystem (stateless-native-apps)

Tracked under issue #13. How developers build **native apps** on the
platform: a Rust-based native webshell host (Tauri-class — the language
spec's "native host" row made real), an app SDK whose model is the state
blob, WASM app logic, and a packaging story where an app is a manifest +
blob + thin host. An app quits by **sealing its state blob**; relaunching
is blob → host — "down is the default" for applications.

## Objective

A developer writes an app once (state reducers + render projection) and
ships it as a native binary *and* a web app from the same code. The app is
a service: `app.json` manifest, blob state, render service. The native
host (Rust) provides system access behind a capability manifest — no
permissions-by-convention, no ambient privileges.

Success criteria:

1. Same app source runs in the browser webshell and the native host with
   identical state semantics (blob in → render → blob out).
2. Native apps are small (10–40 MB class, system webview, Rust core —
   Tauri's proven shape) and start cold from a sealed blob, not a reload.
3. Capabilities are explicit: an app declares what it may touch (fs,
   network, BLE, GPU); the host enforces the manifest — the platform's
   stateless/least-privilege discipline applied to apps.
4. A native app in the ecosystem talks the same blob contract as every
   service — it can call mesh services and be called by them.

## Research grounding

- **Tauri 2** (GA late 2024, mature by 2026) is the reference shape: a
  Rust core + system webview for UI, 10–40 MB bundles vs Electron's
  ~150+ MB, ~80% less memory (claimed), capabilities-based security
  model, iOS/Android targets, Rust plugins for native features. Its
  trade-offs vs Electron are documented (webview consistency across
  platforms, plugin ecosystem maturity).
- The webview is the rendering substrate; the Rust core is the service
  host. That maps 1:1 onto the stateless model: webview = render
  service projection; Rust core = the app's service runtime; state blob =
  the app's model.
- Precedents for blob-as-app-state: the tab-runtime spec's layer-0 blob
  (DOM/scroll/form/JS state) is exactly what a native app's UI state
  needs; the browser rebuild's render-service projection is the same
  architecture at engine scale.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  native host (Rust, Tauri-class)                            │
│  system webview = render service projection                 │
│  capability enforcement (fs, network, BLE, GPU)             │
└──────────┬──────────────────────────────────────────────────┘
           │ app manifest + state blob
┌──────────▼──────────────────────────────────────────────────┐
│  app runtime (the webshell model)                           │
│  discovery = path resolution · app.json · "down" default    │
│  app quit = seal state blob · app launch = blob → host      │
└──────────┬──────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│  app logic (WASM or native plugin)                          │
│  state reducers: (blob, input) → blob — pure, testable      │
│  render projection: blob → view model                       │
└─────────────────────────────────────────────────────────────┘
```

### The stateless fit

- **App = manifest + blob + host.** The app's entire state is the blob;
  the host is stateless between launches. Quit = seal + evict (the tab
  hibernation lifecycle, applied to apps). Relaunch = materialize.
- **Capabilities as manifest, not convention.** The `app.json` declares
  `capabilities: ["fs:read:/home/user/data", "ble:scan"]`; the host
  enforces them at the syscall boundary. No ambient permissions — the
  platform never grants what the manifest doesn't name.
- **One source, two shells.** The render projection is the same function
  in the browser webshell and the native host — the webview differs, the
  state contract doesn't.
- **Apps are services.** A native app can be a mesh peer, a compute
  shard executor (`stateless-compute.md`), or a GPU game host
  (`stateless-gaming.md`) — it's all the blob contract.

### Components

| Component | Language | Responsibility |
|---|---|---|
| native host | Rust | webview shell, capability enforcement, blob lifecycle (seal/materialize) |
| app SDK | Rust + TS | state reducer + render projection API; `app.json` schema; dev tooling |
| capability broker | Rust | syscall-boundary enforcement of the manifest (fs, network, BLE, GPU) |
| packaging | shared | bundle = host + app manifest + blob; signed; AppImage/Flatpak for Linux |

## Open questions (resolved by research)

1. **Build on Tauri vs from scratch** — *resolved:* build on **Tauri 2**
   (GA late 2024, mature by 2026: 10–40 MB bundles, Rust core, system
   webview, capabilities security model); the blob seal/materialize
   lifecycle is a plugin layer on top. From-scratch only if Tauri's
   webview abstraction fights the model (unlikely — the capability
   model already matches).
2. **Webview choice** — *open, deferred to E5:* platform webviews
   (WebKitGTK / wry) are the Tauri default; the render projection API
   must insulate apps from webview quirks. Decide at implementation with
   the capability broker; consistency-vs-size trade-off is the known axis.
3. **App distribution** — *resolved:* signed, content-addressed bundles —
   the blob store is the distribution channel (an update is a new blob
   hash); no storefront daemon.
4. **WASM vs native plugin logic** — *resolved:* WASM (component model)
   first for portable logic; native plugins behind the same blob contract
   for hot loops (the language spec's rule).
5. **App state portability** — *resolved:* yes for capability-confined
   apps — the blob is the app's session (sealed blob + capability grant
   resume anywhere, same answer as gaming saves and VM deltas).

## Boundaries

- **Always:** blob-is-state; capability manifest enforced; host
  stateless; "down is the default"; apps speak the blob contract.
- **Ask first:** a storefront/registry daemon; background/always-on apps
  (violates down-is-default — only system services may persist, and they
  are services, not apps); webview bundling (defeats the small-binary
  point).
- **Never:** ambient permissions; state outside the blob (local config
  files, hidden caches); an app that cannot be sealed and re-materialized.

## Relationship

- `stateless-languages.md` — the native-host row; Rust core, JS/TS UI.
- `stateless-browser.md` — the native host is the browser rebuild's
  companion: same render-service idea, webview instead of engine.
- `stateless-gaming.md` — a game client is a native app; the GPU service
  is a capability.
- `stateless-mesh.md` / `stateless-compute.md` — native apps are mesh
  peers and shard executors.
- The tab-runtime blob format carries app state; no new contract.

## Sources

- Tauri 2 docs + ecosystem analyses (2025–2026): bundle size, memory,
  capabilities security model, webview trade-offs vs Electron/Wails/
  Neutralino
- Tauri vs Electron comparisons (OpenReplay, Reintech, buildmvpfast, 2026)
