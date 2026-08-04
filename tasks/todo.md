# Tasks — Stateless Ticket Management (Track A) + Tab Runtime (Track B)

Per `tasks/plan.md`, specs `docs/specs/stateless-tickets.md` (#5/#6/#7) and
`docs/specs/stateless-tab-runtime.md`. Ordered by dependency; each task ≤ ~5
files, with acceptance + verification. Skip nothing; issue-first means every
task below that touches code lands as an issue reference first.

## Track A — Tickets (immediate)

### P1 — state machine library

- [ ] Task: scaffold `packages/ticket` (zero-dep, Node stdlib)
  - Acceptance: package.json + `lib/` + `bin/` + `test/`; root workspace resolves
  - Verify: `node -e "require('./packages/ticket/lib/flow')"`
  - Files: `packages/ticket/package.json`, `packages/ticket/lib/flow.js`

- [ ] Task: transition table + preconditions (triage/claim/review/close/block/reopen)
  - Acceptance: `transitions[from][to] → allowed` covers the full machine; preconditions enforced (triage needs type+priority+acceptance; close needs review + merged-or-lgtm)
  - Verify: `node --test packages/ticket/test` — every transition + precondition tested
  - Files: `packages/ticket/lib/flow.js`, `packages/ticket/test/flow.test.js`

- [ ] Task: deterministic sort + ticket normalizer (API → `--json` schema)
  - Acceptance: sort = priority order → created asc → number asc, stable; normalizer emits the spec's stable JSON
  - Verify: sort-stability + normalizer unit tests green
  - Files: `packages/ticket/lib/flow.js`, `packages/ticket/test/flow.test.js`

### P2 — CLI verbs

- [ ] Task: `gh` wrapper + `list`/`next`/`new`
  - Acceptance: `list [--state S] [--label L] [--mine] [--json]` sorted; `next` = top ready unassigned; `new --type` creates via template contract with type label
  - Verify: dogfood on the live repo — `ticket list` shows #1–#7; `ticket next` deterministic
  - Files: `packages/ticket/bin/ticket.js`

- [ ] Task: transitions — `triage`/`claim`/`unclaim`/`review`/`close`/`reopen`/`block`/`unblock`
  - Acceptance: valid transitions idempotent (exit 0); invalid exit non-zero with clear message; close posts resolution comment
  - Verify: throwaway issue cycled triage→ready→in-progress→review→close; then reopen→block→unblock; exit codes checked (`echo $status`)
  - Files: `packages/ticket/bin/ticket.js`

- [ ] Task: `comment` + root script `"ticket"`
  - Acceptance: `npm run ticket -- comment 5 "…"` posts; root script resolves
  - Verify: comment visible on a real issue
  - Files: `packages/ticket/bin/ticket.js`, `package.json`

### P3 — flow Action (parallel-safe after P1)

- [ ] Task: `packages/ticket/flow.yml` — hygiene validation + defaults
  - Acceptance: opened issue without type label → violation comment + `status/triage` + `priority/p2`; title `[type] ` enforced
  - Verify: open a test issue via `gh issue create` without labels → check comments/labels
  - Files: `packages/ticket/flow.yml`

- [ ] Task: transition comments + close block
  - Acceptance: transitions announced in-issue; close without resolution comment → red check + comment
  - Verify: try closing a test issue without resolution → blocked
  - Files: `packages/ticket/flow.yml`

### P4 — report + sync (parallel-safe after P2)

- [ ] Task: `report` — status board (markdown/ANSI/`--json`)
  - Acceptance: grouped by status, deterministic sort, `--json` matches schema
  - Verify: `npm run ticket -- report --json` renders #1–#7
  - Files: `packages/ticket/bin/ticket.js`

- [ ] Task: `sync <n>` — PR reconcile + fix summary
  - Acceptance: finds `Closes #n`/`#n` PRs, checks CI, posts problem → fix summary on the issue
  - Verify: `sync` on an issue with a merged PR posts the summary
  - Files: `packages/ticket/bin/ticket.js`

### P5 — CI gate + dogfood (sequential last)

- [ ] Task: ci.yml `ticket` job (state-machine tests + contract probe)
  - Acceptance: CI green with the new job alongside the existing 4
  - Verify: push the branch → `gh pr checks` green → merge
  - Files: `.github/workflows/ci.yml`

- [ ] Task: dogfood — triage org backlog (#1–#7) into the flow
  - Acceptance: every open issue has type + priority + status; `ticket next` yields a real task; tab-runtime flagship filed as `area/runtime` tickets
  - Verify: `ticket report` shows a fully-typed queue; `bench:all` still 9/9
  - Files: org repo state (labels/assignees/comments)

## Track B — Tab runtime (long-term, via tickets)

- [ ] Task: file tab-runtime phases as typed tickets (`area/runtime`)
  - Acceptance: one ticket per tab-runtime phase, each with type/priority/acceptance; tracked through `ticket` flow
  - Verify: `ticket list --label area/runtime` non-empty, statuses valid
  - Files: org repo state

- [ ] Task: execute tab-runtime phases (per `docs/specs/stateless-tab-runtime.md`)
  - Acceptance: each phase lands through the ticket flow with its checkpoint (bench gates stay green)
  - Verify: per-phase checkpoints in that spec's plan
  - Files: packages per the tab-runtime plan

## Track C — FOSS family (after Track A P5)

Per `docs/specs/foss-projects.md` (#8) and the three project specs. Spec'd
and issue #8 tracked; implementation starts when Track A P5 (dogfood gate)
lands. Each project is its own repo, filing issues via the flow it ships.

### C1 — stateless-issues (spec: `docs/specs/projects/stateless-issues.md`)

- [ ] Task: extract `packages/ticket` → `stateless-issues` repo (single source)
  - Acceptance: `lib/flow.js` + `lib/github.js` + `bin/ticket.js` move; monorepo re-exports or drops the package; tests green
  - Verify: `node --test` in the new repo; monorepo `bench:all` 9/9
  - Files: new repo (org), `stateless-engineering/packages/ticket` (removed/re-exported)

- [ ] Task: install paths — npm publish + `gh extension`
  - Acceptance: `npm i -g stateless-issues` and `gh extension install stateless-engineering/stateless-issues` both work
  - Verify: fresh-shell `ticket --version` / `gh ticket --version`
  - Files: `package.json` (bin), extension manifest

- [ ] Task: dogfood — this repo's backlog through its own flow; `ticket sync` on merged PRs
  - Acceptance: repo issues typed/prioritized; sync reconciles a merged PR
  - Verify: `ticket report`; `ticket sync <n>`
  - Files: repo state

### C2 — stateless-actions (spec: `docs/specs/projects/stateless-actions.md`)

- [ ] Task: split Track A `flow.yml` into issue-hygiene / flow-enforce / pr-reconcile
  - Acceptance: three composable actions; same behavior as the monorepo Action; mocked-payload tests green
  - Verify: `node --test` (mocked GitHub payloads); clean-fork two-file run
  - Files: `stateless-actions/` repo (org)

- [ ] Task: labels.yml + templates/flow.yml adoption artifacts
  - Acceptance: two-file adoption (labels + workflow) verified on a clean fork
  - Verify: end-to-end on a throwaway fork
  - Files: `stateless-actions/labels.yml`, `stateless-actions/templates/flow.yml`

- [ ] Task: semver tags + marketplace listing
  - Acceptance: `v1` tags pinned by consumers; marketplace live
  - Verify: `uses: stateless-engineering/stateless-actions/issue-hygiene@v1` resolves
  - Files: repo tags, marketplace config

### C3 — stateless-queue (spec: `docs/specs/projects/stateless-queue.md`)

- [ ] Task: extract `lib/flow.js` as the single core (network-free tests)
  - Acceptance: transition table + sort + normalizer run on fixtures with zero deps; `stateless-issues` re-exports it
  - Verify: `node --test` core; family CI green
  - Files: `stateless-queue/` repo (org)

- [ ] Task: GitHub reference backend (parity with stateless-issues v1)
  - Acceptance: same verbs, same `--json` schema, same sort
  - Verify: parity fixtures green
  - Files: `stateless-queue/lib/backends/github.js`

- [ ] Task: GitLab backend — full verb parity on a CI instance
  - Acceptance: GitLab REST binding passes the backend-contract suite; `--json` byte-identical for the same queue state
  - Verify: CI matrix (Dockerized GitLab fixture)
  - Files: `stateless-queue/lib/backends/gitlab.js`

- [ ] Task: file backend (offline/no-forge boundary case)
  - Acceptance: one dir per queue; transitions move files; markdown+frontmatter; full lifecycle round-trip
  - Verify: `node --test` file-backend lifecycle
  - Files: `stateless-queue/lib/backends/file.js`

## Definition of done (Track A)

`npm test` green (state machine + normalizer), `bench:all` 9/9, CI green with
the ticket job, org backlog fully triaged, tab-runtime flagship filed as
tickets. No files written at runtime; no config files; nothing pushed without
review.

## Definition of done (Track C)

Three family repos live under the org, each dogfooding the flow; GitHub +
GitLab verb parity; ≥ 5 external adopters; family specs' success gates met.
Nothing pushed to the public monorepo's `notes/` without review.

## Track D — Stateless browser rebuild (destination, research-gated)

Per `docs/specs/stateless-browser.md` (#9). Spec'd and issue #9 tracked;
engine work starts only when Track B phase 6 (audit-layer research) lands.
Each task below is the browser's phase gate — benchmark-falsifiable, never
vibes.

### D0 — prerequisites (inherit from the tab-runtime track)

- [ ] Task: tab-runtime Track A phases 0–5 land first (blob, hibernation,
      progressive restore, webshell control plane, 12/12 gates)
  - Acceptance: the browser's first five phases are proven work, not fresh starts
  - Verify: tab-runtime plan checkpoints green
  - Files: per tab-runtime plan

### D1 — engine prototype (gated on B:phase-6 research)

- [ ] Task: audit-layer research decision (record-replay vs heap snapshot; engine base)
  - Acceptance: `docs/specs/audit-layer.md` concludes with a decision + rationale; engine choice made (Servo-class recommended, not Chromium fork)
  - Verify: doc reviewed; decision recorded in the issue
  - Files: `docs/specs/audit-layer.md`

- [ ] Task: journal-everything engine prototype
  - Acceptance: audit layer is a core subsystem (not a bolt-on); captures + replays a fixture page
  - Verify: replay bit-stable on fixtures (same blob → identical DOM + state)
  - Files: engine repo (org) — per the phase-6 decision

### D2 — base/delta runtime

- [ ] Task: immutable shared base + per-tab deltas
  - Acceptance: N tabs share one base; per-tab cost = delta, not page
  - Verify: `base-sharing` gate — memory proves the sharing
  - Files: engine repo

### D3 — stateless browser

- [ ] Task: subsystems as stateless services (network, storage, rendering, permissions, downloads)
  - Acceptance: no long-lived stateful daemons; every subsystem is an invocation; permission/download are services
  - Verify: benchmark suite as CI gates (9 existing + replay-bitstable, base-sharing, wasm-fallback)
  - Files: engine repo

- [ ] Task: down-is-default tab manager + progressive restore
  - Acceptance: background tab = blob at rest (0 RSS); open = shell < 100 ms, full < 300 ms
  - Verify: memory-delta, tab-spray, snap-restore, network-skip gates green
  - Files: engine repo

### D4 — dogfood

- [ ] Task: the org's daily driver runs on the stateless browser
  - Acceptance: survival-matrix 7/7 at scale; crash = nothing lost (blob on disk)
  - Verify: full benchmark suite green on the browser; real usage week
  - Files: engine repo

## Definition of done (Track D)

A working browser, FOSS (MIT), benchmark-gated, whose every phase descended
from a falsifiable gate — and which the org actually uses. WASM fallback is
controlled and counted, never silent. Nothing personal pushed anywhere
public.
