# ADR 0001 — GitHub issues are the ticket store

Status: accepted (2026-08-05, implements spec #5 / Track A)

## Context

The ticket flow needs a job queue with transitions
(triage → ready → in-progress → review → done), labels, review threads, and
audit history. Options: a local database, a hosted issue tracker, or the
GitHub issues API the repo already uses.

The org's hard rule is that every project is stateless: no files left
behind, no ambient state. A local DB breaks that; a separate tracker splits
truth across systems.

## Decision

GitHub issues ARE the ticket store. The GitHub API is the only state — the
CLI (`packages/ticket`) and the flow Action read and write issues, labels,
and comments exclusively through `gh`. The state machine (`lib/flow.js`)
is a pure function: ticket in, transition, ticket out. No local cache, no
daemon, no database.

## Consequences

- Zero infrastructure: the store already exists, is backed up, and is the
  collaboration surface.
- Transitions are observable: every state change is a label, every review a
  comment — the issue thread is the audit log.
- The flow Action enforces the machine (reopens illegal closes), so the
  store and the process cannot drift.
- Rate limits and the markdown body are the price; tickets are small and
  the CLI batches reads.
