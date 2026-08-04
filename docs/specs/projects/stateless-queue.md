# Spec: stateless-queue (standalone FOSS)

The **forge-agnostic core** of the stateless ticket idea: the state machine,
deterministic sort, and ticket normalizer as a library with pluggable
backends. The idea survives contact with projects that are not on GitHub —
GitLab, Gitea/Forgejo, or no forge at all. Member of the stateless FOSS
family (`docs/specs/foss-projects.md`); the family's answer to "what if the
repo isn't on GitHub?"

## Objective

One queue core, many forges. A project on GitLab, Gitea, or a file-based
queue gets the **same verbs, the same state machine, the same sort order**
as a GitHub project — because the core (`lib/flow.js`) never touches a
forge API. Backends are thin adapters: normalize(issue) → ticket;
apply(transition) → forge mutation.

Success criteria:

1. **Full verb parity on two forges**: GitHub (reference binding) and
   GitLab — same verbs, same `--json` schema, same deterministic sort,
   same transition preconditions.
2. **Backends are swappable, not forked**: a project moves GitHub → GitLab
   by changing `--backend`; no queue code changes.
3. **A file backend** exists for offline / self-hosted / no-forge queues:
   a plain-directory queue (one file per ticket) that satisfies the
   stateless contract as a *boundary case* — the directory is explicit
   input/output, never ambient.
4. The core is dependency-free and unit-testable without any network:
   the whole transition table + sort + normalizer run on fixtures.
5. `stateless-issues` and the family's Actions consume the same core —
   one contract, three surfaces.

## Repo layout

```
stateless-queue/
  package.json          name: stateless-queue · license: MIT · deps: none
  lib/flow.js           THE contract: transitions, sort, normalizer (pure)
  lib/backend.js        backend interface: normalize(), apply(), list()
  lib/backends/github.js    gh subprocess or REST (GITHUB_TOKEN/fetch)
  lib/backends/gitlab.js    GitLab REST (project labels + issue states)
  lib/backends/gitea.js     (later) Gitea/Forgejo API
  lib/backends/file.js      (later) one dir per queue; ticket = file
  bin/queue.js          CLI: queue <verb> --backend github|gitlab|… --repo …
  test/                 node --test: flow tests (network-free) + backend-contract tests
  README.md             binding guide: "write a backend in an afternoon"
  LICENSE               MIT
  .github/workflows/ci.yml    flow tests + backend matrix (GitHub API stubbed)
  AGENTS.md             stateless contract + family pointer
```

## The backend contract

A backend implements four functions; nothing else may touch the forge:

```js
list(repo, filters)          → Ticket[]            // raw → normalized
apply(repo, ticket, transition) → { ok, message }  // mutation; idempotent or error
get(repo, number)            → Ticket
close(repo, ticket, resolution) → ok               // resolution comment required
```

- `normalize()` lives in the **core** (forges are normalized into the
  family's stable `--json` ticket schema); backends only translate their
  forge's shapes into that schema.
- The deterministic sort (priority → created → number) is core-side;
  backends may not reorder.
- Transition preconditions (triage needs type+priority+acceptance; close
  needs review + merged-or-lgtm) are core-side; backends just execute.

Forge primitive mapping (the only backend-specific knowledge):

| Family verb | GitHub | GitLab | File |
|---|---|---|---|
| status | `status/*` labels | labels + `workflow` state | filename prefix (`ready/`, `done/`) |
| type/priority | labels | labels (or `priority` field) | frontmatter |
| assignee | assignee | assignee | `assignee:` field |
| reviewer | reviewer via comment | assignee scope | `reviewer:` field |
| close | close + comment | close + note | move file |

## Interfaces

CLI shape mirrors the family (`docs/specs/stateless-tickets.md` verbs),
plus `--backend`:

```
queue list|next|triage|claim|review|close|block|report [--backend B] [--repo R]
  default --backend: github (the reference binding)
  --json schema: identical to the family's ticket schema
```

The core is also a library: `const { Queue } = require('stateless-queue')`
→ `new Queue(backend, repo)` → the full verb surface. `stateless-issues`
v2 becomes a thin wrapper: `stateless-queue` core + the GitHub backend +
CLI sugar.

## Phases

- **P1 — Core extraction:** move `lib/flow.js` from `stateless-issues`
  (family Track C gate: happens after `stateless-issues` P1) into this repo
  as the single source of truth; network-free tests.
- **P2 — GitHub binding:** the reference backend; parity proof with
  `stateless-issues` v1.
- **P3 — GitLab binding:** full verb parity on a real or Dockerized GitLab
  instance in CI (self-hosted test fixture).
- **P4 — File backend:** the offline queue (one dir per queue; sorted by
  filename; transitions move files); document it as the "no-forge"
  boundary case.
- **P5 — Matrix CI:** GitHub + GitLab (+ Gitea if cheap) backends run the
  same flow-fixture suite; `stateless-issues` and Actions consume the
  core.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| GitLab API drift (labels vs scoped labels vs states) | Backend contract isolates it; CI on a real instance catches drift |
| "Write a backend in an afternoon" promise broken | `test/backend-contract.test.js` is the checklist: 4 functions, fixtures provided |
| File backend violates the no-ambient-state rule | Directory is explicit argv; rule holds — nothing ambient, no caches |
| Core drift across family projects | One source of truth (this repo); others re-export; CI fails on mismatch |

## Success gates

- P1: core tests green; `stateless-issues` re-exports the core; family CI
  green.
- P2: GitHub parity with `stateless-issues` v1 verbs.
- P3: GitLab full-verb parity on a CI instance; `--json` byte-identical to
  GitHub output for the same queue state.
- P4: file backend round-trips a full lifecycle; documented boundary case.
- P5: backend matrix green; Actions + CLI consume the core without forks.

## Boundaries

- **Always:** the six stateless rules; core is forge-free (no GitHub
  strings in `lib/flow.js`); deterministic sort is core-side; MIT.
- **Ask first:** a new backend (priority order: GitLab → Gitea/Forgejo →
  others); a hosted/syncing variant; changing the ticket schema.
- **Never:** a daemon, server, or sync service; network calls in the core;
  backend logic in the CLI; a backend that reorders or relaxes
  preconditions.

## Open questions

1. **Backend order** — GitLab first (family open question 3 default) or
   Gitea (one binary, simpler CI)? Default: GitLab.
2. **REST vs GraphQL for GitLab** — REST is stable and simple; GraphQL is
   the future. Default: REST, GraphQL only if a verb requires it.
3. **File-queue format** — markdown + frontmatter (fits the org's
   `notes/` provenance style) vs JSON per ticket. Default: markdown +
   frontmatter (human-editable, diff-friendly).
4. **Does `stateless-issues` become a wrapper** — v2 CLI = queue core +
   GitHub backend (Default: yes, one core everywhere) or stay a standalone
   GitHub-only package (simpler v1, drift risk)?
