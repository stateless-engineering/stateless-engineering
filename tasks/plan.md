# Plan: Stateless Ticket Management (immediate) + Tab Runtime (long-term)

Two tracks, one queue. The **immediate** track builds the org's dev tool:
stateless job/ticket management on GitHub issues (spec:
`docs/specs/stateless-tickets.md`, issues #5/#6/#7). The **long-term** track
— the stateless tab runtime flagship (`docs/specs/stateless-tab-runtime.md`)
— is itself tracked end-to-end as tickets through the tool being built, which
proves the tool on the org's own work. Every phase ends at a green checkpoint
(`npm run bench:all` = 9/9 and/or `npm test`).

A **third track** — Track C, the stateless FOSS family (spec:
`docs/specs/foss-projects.md`, issue #8) — productizes the ticket idea into
standalone FOSS projects anyone can adopt. Spec'd now; implementation gates
on Track A dogfooding (P5).

A **fourth track** — Track D, the stateless browser rebuild (spec:
`docs/specs/stateless-browser.md`, issue #9) — the org's destination: a
ground-up browser where the stateless model is the architecture. Track B's
engine research (phase 6) is its gate; Track D consumes the tab-runtime,
ticket, and family work rather than replacing it.

## Dependency graph

```
Track A — tickets (immediate):
P0 (issues exist) ──► P1 (state machine lib) ──► P2 (CLI verbs) ──► P3 (Action)
      │                       │                        │                │
      └───────────────► P4 (report + sync) ◄───────────┘                │
      └──────────────────────────────────────────────► P5 (CI gate + dogfood)
                                                          │
Track B — tab runtime (long-term):  managed as tickets via the tool
  P6 (triage flagship into tickets) ──► P7 (P1–P5 of tab-runtime plan)
                                                          │
Track C — FOSS family (after A's P5 dogfood gate):
  C1 (stateless-issues) ──► C2 (stateless-actions) ──► C3 (stateless-queue)

Track D — stateless browser (destination; gated on B's engine research):
  B:phase-6 (audit-layer research) ──► D1 (engine prototype) ──► D2 (base/delta)
  ──► D3 (stateless browser) ──► D4 (dogfood daily driver)
```

Track A phases are the work of issues #5 (spec — done), #6 (CLI), #7
(Action). Track B reuses the tab-runtime plan's phases but only after Track A
is dogfooding. Track C implements `docs/specs/foss-projects.md` (issue #8):
each project spec'd, implementation starts when Track A P5 lands — the family
must dogfood on the flow it ships. Track D implements
`docs/specs/stateless-browser.md` (issue #9): spec'd now, engine work starts
only when Track B's phase-6 research settles the audit-layer strategy and
engine choice — the rebuild is research-gated by design, never vibes.

## Track A — Stateless tickets (immediate)

### P0 — Spec + issues (done)
- [x] Issues #5 (spec), #6 (CLI), #7 (Action) created.
- [x] `docs/specs/stateless-tickets.md` written (state machine, verbs,
  determinism contract, integration, boundaries).
- [x] `tasks/plan.md` + `tasks/todo.md` reference the issues.
- **Checkpoint:** issues exist with acceptance criteria; spec links resolve.

### P1 — State machine library (sequential first)
`packages/ticket/lib/flow.js` — zero-dep, pure: the transition table, the
deterministic sort, and the ticket normalizer (API → `--json` schema).

- Transition table `transitions[from][to] → allowed` + per-transition
  preconditions (type/priority/acceptance for triage; assignee for review;
  PR-merged-or-lgtm for close).
- Sort: priority order → created asc → number asc.
- Unit tests (`node --test`): every transition, every precondition, sort
  stability, idempotency.
- **Parallelizable:** P3's Action validation logic is the same table — design
  it as the shared contract in the spec, not shared code (Action is YAML +
  `gh api`, CLI is Node).
- **Checkpoint:** `node --test packages/ticket/test` green.

### P2 — CLI verbs (sequential on P1)
`packages/ticket/bin/ticket.js` — `gh` subprocess wrapper, zero npm deps.
Verbs: `list`, `next`, `new`, `triage`, `claim`, `unclaim`, `review`, `close`,
`reopen`, `block`, `unblock`, `comment`, `report`, `sync`. Root script
`"ticket": "node packages/ticket/bin/ticket.js"`.

- Human output by default; `--json` stable schema; ANSI only on TTY.
- Exit 0 / non-zero + message per the transition contract.
- **Risks:** `gh` availability + auth; **mitigation:** clear error on
  `gh auth status` failure, documented in the package README as declared
  external tooling.
- **Checkpoint:** dogfood on the org's own repo — `ticket list` shows #1–#7,
  `ticket next` deterministic, transitions exercised on a throwaway issue.

### P3 — Flow Action (parallel-safe after P1)
`packages/ticket/flow.yml` — issue-event workflow: hygiene validation
(title `[type] `, required labels, acceptance presence), default labels
(`status/triage`, `priority/p2`), transition comments, red-check violations.

- Permissions `issues: write` only.
- **Risks:** Action approval on a public repo; **mitigation:** issue events
  are safe (no `pull_request_target`); document the permission ask.
- **Checkpoint:** a test issue opened without a type label gets the
  violation comment + `status/triage`; closing without resolution is blocked.

### P4 — Report + sync (parallel-safe after P2)
- `report` — stateless status board: grouped by status, deterministic sort,
  markdown + ANSI, `--json`.
- `sync <n>` — reconcile issue with its PRs: find `Closes #n` / `#n` refs,
  check CI state, post the problem → fix summary (org rule 4).
- **Checkpoint:** `ticket report --json` renders the org queue; `sync`
  reconciles a real merged PR.

### P5 — CI gate + dogfood (sequential last)
- ci.yml `ticket` job: `npm test` (state machine) + a contract probe
  (mirrors the runner/format self-test pattern).
- **Dogfood:** triage the org's open backlog (#1–#7) into the flow; run the
  tab-runtime flagship through the tool from here on.
- **Checkpoint:** CI green with the new job; org queue fully in the state
  machine; `bench:all` still 9/9.

## Track B — Stateless tab runtime (long-term, via tickets)

P6 — Triage the flagship: file the tab-runtime work as typed, prioritized
tickets (`area/runtime`) through `ticket new` + `ticket triage` — one ticket
per phase of the tab-runtime plan. P7 — execute the tab-runtime plan
(`docs/specs/stateless-tab-runtime.md`, its own phases 0–5 then 6–9) with
every phase driven through the ticket flow. Track B starts only when Track A
is dogfooding (P5 checkpoint).

## Track C — Stateless FOSS family (after Track A P5)

Implements `docs/specs/foss-projects.md` (issue #8): the ticket idea built
out into standalone FOSS projects — `stateless-issues` (npm/gh-ext CLI,
`docs/specs/projects/stateless-issues.md`), `stateless-actions` (composable
published Actions, `docs/specs/projects/stateless-actions.md`),
`stateless-queue` (forge-agnostic core, `docs/specs/projects/stateless-queue.md`).

- **C1 — stateless-issues:** extract from Track A's `packages/ticket` into
  its own repo; npm + `gh extension` install paths; self-test CI.
- **C2 — stateless-actions:** split Track A's `flow.yml` into three
  composable actions; tag-versioned; marketplace later; two-file adoption.
- **C3 — stateless-queue:** extract `lib/flow.js` as the single core;
  GitHub reference binding, then GitLab parity, then file backend.
- Track C starts only when Track A P5 lands (the family dogfoods on the
  flow it ships). Each project files its own issues via the flow.

## Track D — Stateless browser rebuild (destination, research-gated)

Implements `docs/specs/stateless-browser.md` (issue #9): a ground-up browser
where the stateless model is the architecture — base/delta runtime,
journal-everything audit layer, down-is-default tab manager, subsystems as
stateless services, progressive restore, versioned storage, determinism.

- **D0 — evidence & prerequisites:** tab-runtime Track A phases 0–5
  (blob format, hibernation service, progressive restore, webshell control
  plane, benchmark gates) are the browser's first five phases — the rebuild
  is not a fresh start, it inherits the proven work.
- **D1 — engine prototype:** Track B's phase 6 (audit-layer research) picks
  record-replay vs heap snapshot and the engine base (recommended:
  memory-safe, embeddable, Servo-class — not a Chromium fork). Phase 7 of
  the tab-runtime plan builds the journal-everything prototype; gate =
  replay bit-stable on fixtures. The platform-wide language strategy is
  `docs/specs/stateless-languages.md` (#12): Rust core, blob as the only
  contract, services in any language that speaks it.
- **D2 — base/delta runtime:** immutable shared base + per-tab deltas; gate
  = N tabs ≈ delta memory, not N pages.
- **D3 — stateless browser:** subsystems as services, down-is-default, the
  9 benchmarks (plus replay-bitstable, base-sharing, wasm-fallback) as CI
  gates.
- **D4 — dogfood:** the org's daily driver runs on it; survival-matrix 7/7
  at scale.
- Track D starts when Track B phase 6 lands. It is a multi-year,
  research-gated program; every phase is falsifiable (benchmark gates), no
  phase proceeds on vibes.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `gh` auth missing in fresh environments | Clear `gh auth status` error + README note; CI uses the standard `GITHUB_TOKEN` |
| State machine drift between CLI and Action | The table in `lib/flow.js` is the contract; Action validates the same transitions in YAML — spec documents both |
| Public-repo Action permission approval friction | `issues: write` only; issue events are safe; explain in PR |
| Scope creep into a board UI / milestones | Non-goals in the spec; milestones gated on open question 3 |
| Tab-runtime work stalls while tooling is built | Track B is tickets from P6 on; the tool is 5 phases, each with a green checkpoint |
| `notes/` personal exports pushed publicly | Boundary rule + review gate before any push (unchanged) |
| Family projects drift from the core contract | `stateless-queue` core is the single source; CI fails on mismatch; all three dogfood |
| FOSS adoption friction (forge lock-in, install) | Tier-1 Actions funnel; forge-agnostic core; `gh extension` + npm install paths |
| Browser rebuild scope (multi-year) | Research-gated: phase-6 audit-layer design decides the engine; every phase is benchmark-falsifiable |
| Heap serialization unproven (the make-or-break) | Record-replay vs heap snapshot decided by research, prototyped in D1 before any engine commitment |
| Engine choice paralysis | Spec recommends Servo-class memory-safe embeddable; the research deliverable is a decision, not a survey |

## Verification checkpoints (each phase)

1. P1: `node --test packages/ticket/test` green.
2. P2: dogfooded on the live repo — list/next/transitions on a throwaway
   issue; exit codes correct.
3. P3: test-issue violations get comment + labels; blocked close.
4. P4: `report --json` correct; `sync` reconciles a real merged PR.
5. P5: CI green (new job + existing 4), `bench:all` 9/9, backlog triaged.

## Parallelism

P3 (Action) runs in parallel with P2 (CLI) once P1's transition table is
fixed — both implement the same contract. P4 depends on P2 only. P5 is
strictly last (CI gate + dogfood). Track B starts only after P5. Track C
starts after P5 too: C1 and C2 are parallel (both extract from Track A's
P1–P3 output); C3 (queue core) starts when C1 lands (it owns the core) and
runs alongside C2. Track D is strictly sequential after Track B phase 6 —
the audit-layer research is the single gate; nothing in D proceeds before
its decision lands.
