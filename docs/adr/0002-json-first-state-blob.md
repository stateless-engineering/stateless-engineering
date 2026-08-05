# ADR 0002 — JSON-first state blob, CBOR/Protobuf evolution inside the envelope

Status: accepted (2026-08-05, spec family: stateless-tab-runtime + expansion)

## Context

Every platform surface — tab runtime, mesh, compute, VMs, gaming, native
apps, AI — shares one state contract. The blob must be debuggable by hand,
diff-able, portable across engines, and evolvable without breaking old
saves. Binary formats are smaller but opaque; JSON is transparent but
bloated.

## Decision

The canonical contract is a **versioned JSON envelope**: `schemaVersion`,
`meta` (origin, timestamp, engine, signature), and `state` (the app's
sealed payload). JSON is the interchange and debug format. Two escapes
hatch inside the same envelope:

- **CBOR** when payload size matters (mesh micro-blobs, network transfer) —
  it is JSON's value model in binary, so the decoder is trivial.
- **Protobuf** only when a schema-stable, versioned binary format is
  justified by a measured need (not speculation) — gated by the same
  `schemaVersion` envelope so old readers still degrade cleanly.

`schemaVersion` gates every migration; a reader that does not know a
version refuses, it does not guess.

## Consequences

- Every tool can `jq` a save; tests diff blobs as text.
- Size-critical paths get CBOR without a new contract, Protobuf later
  without a breaking change.
- Two formats to maintain, but both derive from the same value model and
  the envelope keeps the migration surface small.
