# The stateless model

A discipline for building systems where **state is truth and engines are pure
function**. Hibernate anything. Restore progressively. Waste nothing.

## The two primitives

- **State blobs** — portable, encrypted-able, hashable snapshots of everything
  a system needs to continue. They can live anywhere, move anywhere, and be
  cached at any node, at any depth.
- **Stateless services** — pure functions of (state blob, inputs) → (new state
  blob, outputs). No retained memory, no hidden configuration, no ambient
  dependencies. A service is identified by its *code*, not by a running
  instance.

## The operational inversion

| Ops question | Classic daemon model | Stateless model |
|---|---|---|
| How do I discover services? | registry / mDNS / config | **path resolution** — a service exists if its directory with a manifest is on disk |
| What if a service is down? | health probe, restart supervisor | **"down" is the default** — nothing runs until a request arrives; the spawn *is* the start |
| How do I know it worked? | readiness endpoint | readiness is the **exit code** of the spawned process |
| What's the real failure mode? | crash loop | a **missing piece on disk** — surfaced as a 503 with remediation |

## Why this is a security and behavior win

- **Determinism** — same blob + same service versions = same output. Perfect
  for testing, debugging, cross-device consistency.
- **Crash recovery** — a crashed renderer loses nothing; the blob is intact,
  re-invoke the service.
- **Auditability** — every side effect is mediated by a service invocation you
  can log and restrict; the blob is portable and can be encrypted, preventing
  tampering.
- **No use-after-free class bugs** — no mutable retained state between runs to
  corrupt.

## Democratization of compute

Because services are pure functions, any machine with the blob can run them —
idle devices become a public utility, breaking the cloud monopoly. Every user
is a potential provider and consumer; high-performance compute becomes
accessible to anyone with a web browser.
