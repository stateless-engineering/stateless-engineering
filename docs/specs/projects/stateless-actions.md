# Spec: stateless-actions (standalone FOSS)

Composable, marketplace-publishable GitHub Actions that **enforce and
announce** the stateless ticket flow without running any CLI. Adoption is a
two-file change (labels + one workflow) — the family's Tier-1 funnel
(`docs/specs/foss-projects.md`). Member of the family; issue #7 is the
org-internal origin of this project's `flow.yml`.

## Objective

A maintainer copies one workflow file into `.github/workflows/`, and the
org's state machine (triage → ready → in-progress → review → done) is
enforced on their repo: hygiene violations get comments, transitions get
announced, bad closes get blocked. No code, no install, no local state —
the Action is a pure function of (issue event, API state) → (comments,
labels).

Success criteria:

1. **Two files = full flow**: the label set + one workflow. Verified on a
   clean fork with zero other changes.
2. **Three composable actions**, each with a documented contract, usable
   separately or together:
   - `issue-hygiene` — on `opened`/`labeled`: validate title `[type] `
     prefix, required `type/*` + `priority/*` labels, acceptance criteria
     present for features; apply defaults (`status/triage`,
     `priority/p2`); comment violations.
   - `flow-enforce` — on `labeled`/`closed`: block close without a
     resolution comment or reviewer `lgtm`; announce transitions
     (triage → ready → in-progress → review).
   - `pr-reconcile` — on `closed` PRs: find `Closes #n`/`#n`, check CI,
     comment the problem → fix summary on the issue (org rule 4).
3. Actions are **stateless**: read the API, write labels/comments only,
   produce no artifacts.
4. Versioned (semver tags, `v1`/`v2`), pinned in consumers, documented
   inputs/outputs.

## Repo layout

```
stateless-actions/
  issue-hygiene/action.yml     inputs: token, labels-prefix · permissions: issues: write
  issue-hygiene/src/main.js    zero-dep Node; gh CLI or REST via fetch (GITHUB_TOKEN)
  flow-enforce/action.yml
  flow-enforce/src/main.js
  pr-reconcile/action.yml
  pr-reconcile/src/main.js
  labels.yml                   canonical label set (the shared adoption artifact)
  templates/flow.yml           the one-file adoption template wiring all three
  README.md                    adoption guide + contracts
  LICENSE                      MIT
  test/                        node --test against mocked GitHub payloads
  .github/workflows/ci.yml     action-contract self-test
```

Each action directory is independently releasable (standard GitHub Action
layout: `action.yml` + entrypoint).

## Interfaces

`issue-hygiene` — inputs: `token`, `labels-prefix` (default `""`).
Behavior: on `opened` and `labeled` events, parse the issue; if the title
lacks the `[type] ` prefix or required labels → comment the violation;
if no status label → add `status/triage`; if no priority → add
`priority/p2`; for `type/feature` without an acceptance section → comment
the missing acceptance criteria.

`flow-enforce` — on `closed`: require a resolution comment on the issue
(posted by the closer or `lgtm` by the reviewer) and a linked merged PR
(or reviewer `lgtm`); else reopen + comment. On `labeled`: announce the
transition in a short comment ("→ review — reviewer: @u").

`pr-reconcile` — on PR `closed`+`merged`: parse `Closes #n`/`#n` from the
PR body/commits; comment the merged PR + CI status on issue #n; if the
issue has no resolution comment, prompt for one.

All three: `permissions: issues: write` (nothing more); no artifacts;
no caches; fail loudly via comment, never silently.

## Adoption contract (Tier 1)

1. Copy `labels.yml` → run once (or via a setup Action) to create labels.
2. Copy `templates/flow.yml` into `.github/workflows/`.
3. Done. Open an issue without a type label → violation comment +
   `status/triage` + `priority/p2`. Try to close without a resolution →
   blocked.

The template pins actions by tag (`uses:
stateless-engineering/stateless-actions/issue-hygiene@v1`) — no rolling
`main` references.

## Phases

- **P1 — Extract:** split the monorepo `packages/ticket/flow.yml` (issue #7)
  into the three composable actions; same behavior, factored contracts.
- **P2 — Self-test:** mocked-GitHub-payload unit tests + a fork
  end-to-end run (the acceptance proof: two files → full flow).
- **P3 — Version + publish:** semver tags; GitHub Marketplace listing under
  the org; `labels.yml` + template promoted in READMEs.
- **P4 — Community:** adoption docs, template gallery, issue templates
  that reference the flow; dogfood on the family's own repos.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Marketplace approval friction | Tag-pinned actions work without Marketplace — publish later (family open question 1) |
| Action fork abuse (public repos, `pull_request_target`) | Issue events only; never `pull_request_target`; minimal permissions |
| Contract drift vs CLI (`stateless-issues`) | Same state machine (family spec); both tested against the same fixture set |
| Close-block UX (reopening feels aggressive) | Comment + reopen with an explicit reason; `flow-enforce` input `reopen: false` escape hatch |

## Success gates

- P1: monorepo flow.yml behavior reproduced by the three actions.
- P2: clean-fork two-file run passes end-to-end; `node --test` green.
- P3: `v1` tags published; marketplace listing live; CI green.
- P4: ≥ 5 external repos running the template (measured via workflow refs).

## Boundaries

- **Always:** issue-events only; minimal permissions; semver-pinned
  consumers; no artifacts/caches; MIT.
- **Ask first:** a fourth action; scheduled-event polling; write access
  beyond issues; marketplace specifics.
- **Never:** `pull_request_target`; secrets in comments; local state of
  any kind; blocking legitimately-resolved issues without a comment trail.

## Open questions

1. **Granularity** — three actions vs one mega-action with inputs? Default:
   three (composability; each tiny).
2. **Close-block strictness** — hard reopen (default) vs warning-comment
   only? Default: hard reopen with reason; escape hatch above.
3. **Resolution comment format** — freeform vs a `## Resolution` template
   the actions validate? Default: freeform + presence check (adoption
   friction first).
