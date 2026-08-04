# Tab hibernation — the idea that started the org

The question, verbatim from a DeepSeek conversation (see `notes/`):

> "when it comes to web engines there has to be some dumb missed optimisation
> of caching — the render and runtime of a tab but not loading it"

Re-read: *why don't browsers cache the full rendered state and JavaScript
runtime of a background tab so it can be restored instantly, without keeping
the tab "loaded"?* Essentially: hibernate a tab, like an OS hibernates a
laptop. Operating systems suspend processes to disk, and mobile apps do state
restoration — yet browsers kill background tabs and reload them from scratch.

## What browsers actually do today

1. **Keep tabs alive but throttle them.** Background tabs still hold a
   process, DOM, and JS heap — memory is held even when the tab does nothing.
2. **Freeze** (`Page.setWebLifecycleState('frozen')`) — stops timers, keeps
   memory. Restore is instant but memory is never reclaimed.
3. **Discard** — the renderer is killed and the tab reloads from scratch on
   return: network, parse, layout, script — everything, slowly.
4. **bfcache** — back/forward navigation restores the page from memory, but
   only for the last navigated page, and it doesn't cover reloads or restarts.

## Why full serialization is brutally hard

A JS heap is an enormous, deeply interlinked graph of objects with native code
hooks: DOM wrappers pointing into the C++ renderer, pending promises,
WebSockets, IndexedDB transactions, canvas/GPU state. Serializing it means
capturing every native-side reference and restoring it, possibly in a new
process, with correct GC roots. V8 has snapshotting for the browser's own
startup, but arbitrary untrusted web content with live DOM attachments is a
different beast. That's why app platforms get state preservation by making the
*app's own code* do it, not by transparently capturing the runtime.

## The pragmatic spectrum

- **Freeze** short-term tabs — instant, same memory.
- **Partially serialize** idle tabs — fast restore, ~40–60% savings.
- **Discard** abandoned tabs — slower restore, no data loss.

The `packages/benchmarks` suite measures where each approach lands: restore
speed, memory held, what survives reload / new tab / restart / snapshot
restore, network bytes skipped, and the pixel-ghost trap (cached pixels look
right but are dead).
