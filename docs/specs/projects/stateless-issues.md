# Spec: stateless-issues (standalone FOSS)

The GitHub-issues-backed stateless ticket CLI, built out of the org-internal
tool (`packages/ticket`, issue #6) into an **installable FOSS package** that
any repository — org or not — can adopt. Member of the stateless FOSS family
(`docs/specs/foss-projects.md`); shares its contract with `stateless-queue`
(core) and `stateless-actions` (event surface).

## Objective

A maintainer runs `ticket next`, `ticket claim`, `ticket review`,
`ticket close` against their own GitHub issues and gets the org's flow —
triage → ready → in-progress → review → done — without writing any code,
without any local state, and with the GitHub API as the only store.

Success criteria:

1. `npm i -g stateless-issues` (or `gh extension install`) + the label set
   is a complete install — no other setup.
2. Full verb set (`list`/`next`/`new`/`triage`/`claim`/`unclaim`/`review`/
   `close`/`reopen`/`block`/`unblock`/`comment`/`report`/`sync`) works
   against any repo where the labels exist.
3. The six stateless rules hold: zero files written, zero config files,
   deterministic sort, idempotent-or-error transitions, clean teardown,
   no generated artifacts.
4. The same binary serves as `ticket` (npm) and `gh ticket` (extension) —
   one `bin`, two install paths.
5. Five external repos adopt (npm downloads + workflow refs); the org
   dogfoods it on the family's own repos.

## Repo layout

```
stateless-issues/
  package.json          name: stateless-issues · bin: { ticket: "bin/ticket.js" }
                        engines: node >= 18 · license: MIT · deps: none
  bin/ticket.js         CLI entry: argv → verb → exit code
  lib/flow.js           state machine + deterministic sort + normalizer (pure, forge-agnostic)
  lib/github.js         `gh` subprocess binding (declared external tooling)
  lib/print.js          human output; ANSI only on TTY; --json stable schema
  test/                 node --test (flow + sort + binding-contract stubs)
  README.md             adoption guide (Tier 1/2) + stateless contract
  LICENSE               MIT
  .github/workflows/ci.yml       self-test (mirrors monorepo ci.yml ticket job)
  .github/workflows/flow.yml     dogfood: this repo runs on its own flow
  AGENTS.md             points at the family spec + stateless contract
```

## Interfaces

Verbs, transitions, and the `--json` ticket schema are **identical** to
`docs/specs/stateless-tickets.md` — that spec is the contract; this project
is the shipped binding. `lib/flow.js` is the same file that becomes
`stateless-queue`'s core (see `projects/stateless-queue.md`).

```
ticket <verb> [args] [--repo owner/repo] [--json]
  --repo default: git remote get-url origin of cwd (an input, not state)
  exit 0 = success/no-op · non-zero + message = invalid transition
```

## Adoption contract

A third-party repo adopts in four steps (documented in README):

1. Create the label set (`status/*`, `type/*`, `priority/*`, `area/*` —
   one `gh label create` loop or the `labels.yml` from `stateless-actions`).
2. `npm i -g stateless-issues` or `gh extension install
   stateless-engineering/stateless-issues`.
3. `ticket new --type feature --title "…"` — typed ticket, template body.
4. Run the flow: `triage` → `next` → `claim` → `review` → `close`.

No config file, no `.stateless/` directory, no hooks. The tool refuses to
write anything into the repo tree.

## Phases

- **P1 — Extract** (from the org monorepo's Track A P1–P2): `lib/flow.js`,
  `lib/github.js`, `bin/ticket.js` move to this repo as the single source;
  the monorepo `packages/ticket` becomes a thin re-export or is removed.
- **P2 — Install paths:** npm publish (`stateless-issues`) + `gh extension`
  (same `bin`). CI self-test job green.
- **P3 — Dogfood:** this repo's own issues (#1…, filed through the flow);
  `ticket sync` reconciles its PRs. Family repos adopt.
- **P4 — External adopters:** README + template issue + a `labels.yml`
  generator; measure adoption; iterate on friction.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Forge lock-in (GitHub-only) | Core is forge-agnostic by construction → `stateless-queue` binding (GitLab) is a port, not a rewrite |
| `gh` auth friction | Clear `gh auth status` error; `gh extension` install path lowers friction |
| Monorepo drift (two copies of flow.js) | One source of truth: this repo; monorepo re-exports or drops the package |
| Label name collisions in foreign repos | Namespaced labels (`status/…`) + README note; `--labels-prefix` flag if asked |

## Success gates

- P1: `node --test` green; monorepo `bench:all` unchanged (9/9).
- P2: `npm pack` + `gh extension` install both work; CI green.
- P3: this repo's backlog fully in the flow; `sync` reconciles a merged PR.
- P4: ≥ 5 external adopters; zero open issues about state violations.

## Boundaries

- **Always:** the six stateless rules; the ticket spec's state machine;
  MIT; issues-first.
- **Ask first:** new verbs (contract change → `stateless-tickets.md` first);
  npm scope; a hosted variant; labels-prefix customization.
- **Never:** a daemon, server, or local cache; config files; writing into
  the repo tree; GitHub-only logic leaking into `lib/flow.js` (it belongs in
  `lib/github.js`).

## Open questions

1. **Extension vs npm priority** — which install path gets the v1 marketing
   push? Default: `gh extension` (lowest friction for the Tier-2 audience).
2. **`ticket sync` depth** — CI-state checking needs read access to
   Actions; some forks restrict it. Default: degrade to PR-state-only with a
   clear note.
3. **Label bootstrap** — a `ticket init` verb that creates labels, vs.
   README-only instructions. Default: README + Action `labels.yml` (no new
   verb until asked).
