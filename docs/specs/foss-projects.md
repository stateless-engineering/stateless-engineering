# Spec: Stateless FOSS Project Family

The stateless ticket/job-management idea — `docs/specs/stateless-tickets.md`
(issues #5/#6/#7) — built out from an org-internal dev tool into **standalone
FOSS projects** that any project can adopt. Tracked as issue #8.

The org's longer-term flagship, the stateless tab runtime
(`docs/specs/stateless-tab-runtime.md`), is deliberately **not** part of this
family's tooling scope — it is the consumer that the family keeps
tracked via tickets.

## Objective

The org's ticket idea becomes an ecosystem: **another FOSS project gets a
stateless job queue with zero code, zero local state, and (in the best case)
one workflow file.** The idea must survive contact with the real world —
repos that are not the org's, forges that are not GitHub, maintainers who
will not install a tool that leaves files or daemons behind.

Success criteria:

1. A third-party FOSS repo adopts the flow in **≤ 5 minutes**: labels +
   one workflow file, no code changes, no new services.
2. The same state machine (triage → ready → in-progress → review → done)
   runs on at least **two forges** with identical verbs and sort order.
3. Every member project satisfies the shared stateless contract — zero
   files written, zero config files, deterministic, no daemon — and can
   point to it in one sentence.
4. At least **five external FOSS projects** use the family (measured by
   workflow/template adoption or npm downloads).
5. The org dogfoods everything: the family's own repos run on the flow
   they ship (issue #6's `ticket sync` on the family's own PRs).

## The family

| Project | Status | Spec | Key interface | Adoption cost |
|---|---|---|---|---|
| `stateless-issues` | spec'd (#6) | `projects/stateless-issues.md` | CLI: `ticket <verb>` → forge API | `npm i -g` + labels |
| `stateless-actions` | spec'd (#7) | `projects/stateless-actions.md` | published Actions on issue events | one workflow file |
| `stateless-queue` | spec'd (#8, this family) | `projects/stateless-queue.md` | lib: `Queue` core + pluggable backends | `npm i` + one binding |
| `stateless-runtime` | spec'd (flagship) | `stateless-tab-runtime.md` | tab hibernation service + blobs | n/a (consumer) |
| `stateless-browser` | spec'd (#9) | `stateless-browser.md` | ground-up stateless browser | the destination |

Relation: `stateless-queue` is the **core** (state machine, sort,
normalizer — forge-agnostic). `stateless-issues` is the **GitHub binding**
as a user-facing CLI. `stateless-actions` is the **event surface** — it
reacts to the same state machine without running a CLI at all. `queue`
ships first as a lib inside `stateless-issues`; it becomes its own repo
when a second binding lands (GitLab).

The **destination** project is `stateless-browser` (issue #9): a ground-up
browser rebuilt so the stateless model is the architecture. It inherits the
family's tooling (ticket flow runs the build), the runtime spec's engine
research (Track B), and the benchmark suite as its acceptance contract.

## The shared stateless contract

Every member project MUST satisfy the org's six rules (monorepo
`AGENTS.md`), condensed to the adoptable form:

1. **No files left behind** — nothing a run creates persists; temp state
   lives in `os.tmpdir()` and is cleaned in `try/finally` (+ `exit`
   handler where a hard kill is possible).
2. **No ambient state** — no config files, no dotfiles, no environment
   dependence beyond the forge token at invocation.
3. **Deterministic** — same inputs → same behavior; fixed sort (priority →
   created → number); idempotent or erroring transitions.
4. **Self-contained** — zero runtime deps where practical (Node stdlib);
   external tooling (`gh`, forge CLIs) is a *declared* dependency.
5. **Clean teardown** — no children, sockets, or watchers left running.
6. **No generated artifacts in git** — commits contain source only.

Forge API is truth; the tool is a pure function. An invocation that
mutates nothing changes nothing.

## Adoption model (tiers)

- **Tier 1 — drop-in (Actions).** Copy two files: the label set and
  `flow.yml` (from `stateless-actions`). The Action validates hygiene,
  applies defaults, blocks bad closes. Zero install, zero code.
- **Tier 2 — CLI.** `npm i -g stateless-issues` (or `gh extension`).
  Full verb set locally and in CI: `ticket next`, `claim`, `review`,
  `report`, `sync`.
- **Tier 3 — embedded.** A tool that wants the queue as a library imports
  `stateless-queue` and binds its own backend.

Tier 1 is the funnel; Tier 2 is the power user path; Tier 3 is how the
idea reaches non-GitHub forges.

## Licensing & governance

- **License:** MIT — matches the monorepo's `license` field; the lowest
  adoption friction for FOSS consumers.
- **Repo shape:** one repo per member project under the
  `stateless-engineering` org (mirrors how `benchmarks`/`webshell`/
  `bench-runner`/`formatting` already exist as repos).
- **Contribution flow:** issues-first, enforced by the family's own
  tools (the org's github-use-rules skill; each repo's `AGENTS.md` points
  at the family spec + the stateless contract).
- **Dogfood:** the family repos' CI runs the flow they ship; the tab
  runtime is tracked through `stateless-issues` from Track A's P5.

## Boundaries

- **Always:** shared stateless contract; issues-first; deterministic
  ordering; MIT; benchmark gates unchanged (9/9).
- **Ask first:** adding a member project to the family; hosted/SaaS
  ambitions; marketplace publishing setup; a second forge binding's
  priority order; changing the shared contract.
- **Never:** a daemon or hosted service (the family is CLI + Actions +
  lib only); a local cache; config files; pushing `notes/` or personal
  exports into any family repo.

## Open questions

1. **Marketplace publishing** — publish `stateless-actions` to the GitHub
   Marketplace vs. tag-pinned YAML in-repo? Default: marketplace later;
   versioned tags first.
2. **Package scope** — publish `stateless-issues` as `stateless-issues`
   on npm vs. `@stateless-engineering/issues`? Default: unscoped for
   v1 (adoption simplicity), scoped if a namespace conflict appears.
3. **Second forge priority** — GitLab (largest non-GitHub FOSS base) vs
   Gitea/Forgejo (self-hosted, one file to run). Default: GitLab REST,
   then Gitea.
4. **`gh` extension vs npm global** — extension (`gh ticket`) is the
   friendlier install for GitHub users; npm is forge-neutral. Default:
   ship both from the same `bin`.

## Non-goals (this round)

- No SaaS, dashboard, or hosted queue — `report` is terminal, the forge
  UI is the web view.
- No sync/aggregation across forges — one `--repo` per invocation.
- No replacement of forge-native issue UIs.
- No re-spec of the tab runtime; it is the family's flagship consumer,
  tracked as tickets once Track A dogfoods.
