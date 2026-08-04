# webshell

The **stateless app runtime & compositor** for [stateless-engineering](https://github.com/stateless-engineering).
A terminal in the browser that discovers apps, runs them on demand, and wires
them into pipelines — a working example of the stateless service model: nothing
runs until you ask, nothing is left behind.

Webshell is the main tool for *building and wiring stateless apps*: an app is
just a directory with a manifest, and the webshell gives it discovery, a spawn
runtime, streaming output, composition, and a settings surface — for free.

## What an app is

An app is a directory with an `app.json` manifest:

```json
{
  "name": "formatting",
  "description": "Pretty box tables from JSON on stdin",
  "entry": ["node", "bin/formatting.js"]
}
```

- `entry` is an **argv array** (no shell interpolation — stateless and safe).
- Legacy benchmark directories (a `bench.js`, no manifest) are discovered
  automatically as `entry: ["node", "bench.js"]`.
- Apps are discovered by **path resolution** over three roots: this repo's
  `apps/`, `--apps` (default `../benchmarks`), and `--services` (default
  `../services`). There is no registry to register with — drop a directory
  with a manifest on disk and it appears.

## Run it

```bash
git clone --recurse-submodules https://github.com/stateless-engineering/stateless-engineering.git
cd stateless-engineering
npm install                 # hoists puppeteer (benchmarks) to the workspace root
node packages/webshell/webshell.js   # --port 8080 to pin; ephemeral by default
# webshell: prints its port (http://127.0.0.1:<port>)
```

Open the printed URL — a terminal with the app list, service status chips, a
per-app run button, a **pipeline builder**, and a **settings** panel. Click an
app to run it, or build a pipeline: add steps, give each step optional args,
run. Output streams into the page live. Binds `127.0.0.1` only; it executes app
commands on your machine.

## Endpoints

| Endpoint | What it does |
|---|---|
| `GET /` | the terminal UI |
| `GET /apps` | discovered apps (name, description, entry, origin) |
| `GET /settings` | effective runtime config: port, roots, overrides, health |
| `POST /settings` | session-scoped root repointing (`{"apps": "...", "services": "..."}`) — never persisted |
| `GET /health` | root + submodule status; 503 with remediation when something's missing |
| `POST /run/:app` | spawn the app (`{"args": [...]}`), stream stdout/stderr, `[exit N]` |
| `POST /wire` | run a pipeline — each step's stdout becomes the next step's stdin |

## The compositor

`/wire` is shell pipes, but every stage is a fresh stateless process. Run
steps sequentially, feed `stdout → stdin`, stop the pipeline when a step exits
non-zero. The flagship wiring:

```json
{
  "steps": [
    { "app": "bench-runner", "args": ["--json", "../../benchmarks"] },
    { "app": "summary" },
    { "app": "formatting" }
  ]
}
```

`bench-runner` aggregates every benchmark's `RESULT_JSON` into a JSON array →
`summary` (a transformer app in this repo) reshapes it into the table form →
`formatting` renders the pretty table. Three zero-dep processes, one pipeline,
no state between them. That's the whole model: **apps declare what they eat
and emit; the webshell composes them like pipes.**

## Settings

The settings panel shows the effective runtime config (port, roots, health) and
lets you repoint the app/service roots **for the session** — so you can wire in
a different app store live without restarting. Nothing is persisted: restart
the server and it's back to defaults. That's the stateless rule applied to
configuration itself.

## The service model: discovery, "down is the default", spawn on demand

Every benchmark-backed "service" here is a short-lived process, not a daemon.
That inverts the usual ops questions:

| Ops question | Classic daemon model | This model |
|---|---|---|
| How do I discover services? | registry / mDNS / config | **path resolution** — repos on disk at known relative paths; `GET /apps` scans the roots for `app.json` / `bench.js` |
| Is a service up? | health checks, retries | it's up when you ask, down when you don't — the only failure is a missing piece on disk, surfaced as a 503 with remediation |
| How do I restart it? | restart policies, supervisors | spawn again — there is nothing to keep alive |
| How do I scale it? | more daemons, load balancers | another request — each spawn is isolated and stateless |

Disconnect handling is deliberate: the child is killed on response close with
a `done` flag set on child exit. (`req.on('close')` fires as soon as the POST
body is read and would kill the child before it produces output — the
response's close is the real signal.)

## The idea this suite demos — from the chat logs

This is the question that started the repo farm, verbatim from a DeepSeek
conversation:

> "when it comes to web engines there has to be some dumb missed optimisation
> of caching — the render and runtime of a tab but not loading it"

Re-read: *why don't browsers cache the full rendered state and JavaScript
runtime of a background tab so it can be restored instantly, without keeping
the tab "loaded"?* Essentially: hibernate a tab, like an OS hibernates a
laptop. And why does this feel like a "dumb missed optimisation"? Because
operating systems suspend processes to disk, and mobile apps do state
restoration — yet browsers kill background tabs and reload them from scratch.

### What browsers actually do today

1. **Keep tabs alive but throttle them.** Background tabs still hold a process,
   a DOM, a JS heap, timers. Modern browsers throttle timers and
   requestAnimationFrame, but the memory and process overhead remain — and on
   memory pressure these tabs are the first to be discarded.
2. **Discard: kill the process, remember the URL.** The renderer dies; only the
   URL and session history are kept. Clicking back reloads from scratch —
   network, parse, execute, paint. Fast on modern connections, but not instant,
   and all JavaScript state (form input, scroll, in-memory data) is gone unless
   the page manually saved it.
3. **Back/forward cache (bfcache).** The closest thing that ships: for
   same-session history navigation, the browser freezes the whole page — DOM,
   render tree, JS heap, listeners — in memory and restores it in under a
   frame. But it lives only in memory, is dropped under pressure, and only
   works for back/forward, not arbitrary background tabs.
4. **Freeze.** Some browsers pause background tab JS without unloading:
   CPU saved, but all memory stays resident — no relief under pressure.

### Why full serialization is brutally hard

A JS heap is an enormous, deeply interlinked graph of objects with native code
hooks: DOM wrappers pointing into the C++ renderer, pending promises,
WebSockets, IndexedDB transactions, canvas/GPU state. Serializing it means
capturing every native-side reference and restoring it, possibly in a new
process, with correct GC roots. The browser would have to serialize the entire
rendering pipeline — style resolution, layout tree, compositor layers, GPU
textures — and it would be brittle across browser versions. V8 has snapshotting
for the browser's own startup, but arbitrary untrusted web content with live
DOM attachments is a different beast. That's why app platforms get state
preservation by making the *app's own code* do it, not by transparently
capturing the runtime.

### It's not dumb — it's being worked on

- **Chrome's "freeze-dried tabs"** prototype serialized renderer state to disk
  and restored it ~80% faster than a reload, saving ~40% memory — but only for
  pages that didn't rely on dynamic JS state (closures, event handlers,
  WebSockets were lost). It evolved into Chromium's experimental page
  serialization work.
- **Firefox's lightweight tab suspension** freezes the event loop, evicts
  cached resources, and keeps a restore manifest of DOM structure, scroll, and
  form state — faster than reload, but JS state still lost.
- **Service Worker / offline-first** shifts restoration to the app itself:
  the browser replays DOM handles; the app rebuilds its state from
  IndexedDB/Cache.
- **OS-level suspend-to-swap** saves CPU but not address space — stopped
  processes still occupy mappings.

The pragmatic spectrum: freeze short-term tabs (instant, same memory), partially
serialize idle ones (fast restore, real savings), fully discard abandoned ones
(no data loss, slower restore). The benchmarks measure where each approach
lands.

## The benchmark suite — what each app proves

All benchmarks share a heavy fixture: a 12,000-record dataset fetched over HTTP
and rendered into a grid — like a real app. `lib/common.js` holds the shared
helpers (system-Chromium launch, fixture server, `/proc` tree-RSS,
snapshot/restore). Every app is stateless: fresh browser, ephemeral port, temp
files cleaned up even on failure.

| App | What it shows |
|---|---|
| `snap-restore` | full reload vs snapshot restore: time, JS heap, scroll/form/JS-state preservation |
| `memory-delta` | lifecycle memory spectrum: live → frozen → discarded → restored |
| `bfcache` | real back/forward cache: 0.026s back-nav keeps JS state; reload resets it |
| `cpu-burn` | live tab burns renderer CPU; frozen burns ~0 while holding all memory |
| `restart` | snapshot to disk, kill the whole browser, restore in a new process |
| `survival-matrix` | what survives reload / new tab / restart / snapshot |
| `network-skip` | reload re-downloads 709 KiB; restore fetches 0 bytes |
| `tab-spray` | 8 heavy tabs ≈ 3.1 GB; discarding half frees ~1.7 GB |
| `pixel-ghost` | pixel "restore" looks right but is dead; snapshot restore is alive |
| `bench-runner` | the runner itself (services) — aggregates every bench's RESULT_JSON |
| `formatting` | pretty tables from JSON on stdin (services) — the wire target |
| `summary` | transformer: JSON array of objects → table form (this repo) |

## The stateless rule

The workspace hard rule (in `../../AGENTS.md`): no files left
behind, no ambient state or config, deterministic runs (ephemeral ports, sorted
order), zero dependencies where practical, clean teardown in `finally`, no
generated artifacts in git. This repo follows it: the server writes nothing,
spawns children per request, and reports missing pieces instead of papering
over them.
