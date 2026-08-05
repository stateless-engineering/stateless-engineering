# ADR 0003 — Rust core, Tauri native host, browser as the demo shell

Status: accepted (2026-08-05, spec: stateless-languages + stateless-native-apps, proposal #14)

## Context

The stateless runtime (state blob, determinism, capability manifest) must
eventually run as a desktop app — the Electron proposal (#14) asked for a
stateless answer. The demo shell today is a browser tab (zero install);
the strategic shell must be small, safe, and deterministic.

## Decision

- **Rust is the strategic core bet**: the state engine, blob codec, and
  capability sandbox are written in Rust — deterministic, memory-safe,
  small, and portable to every target below.
- **The native host is built on Tauri 2** (10–40 MB, system webview) rather
  than Electron (~150 MB, bundled Chromium). One blob contract, two shells:
  the browser tab is the instant demo; the Tauri shell is the packaged
  answer to Electron-class apps.
- The webview choice inside Tauri is deferred to a future ADR (E5) — the
  contract layer is shell-agnostic.

## Consequences

- Two shells share one engine: anything that runs in the tab runs packaged,
  with the same determinism guarantees.
- Rust buys the hard properties (determinism, safety, size) at the cost of
  a slower prototyping loop than JS — the JS monorepo remains the fast
  iteration surface until the contract is frozen.
- Tauri's system-webview dependency is accepted; if a platform's webview
  lags, the Rust core still ships.
