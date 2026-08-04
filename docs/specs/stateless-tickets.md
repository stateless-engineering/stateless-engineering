# Spec: Stateless Ticket Management on GitHub Issues

The org's dev tool / integration layer. GitHub issues are the job/ticket
store; a stateless CLI (`packages/ticket`) plus a flow GitHub Action
(`packages/ticket/flow.yml`) make the issue-first workflow — already mandated
by `AGENTS.md`, `.github/ISSUE_TEMPLATE/`, and the github-use-rules skill —
**executable**: triage, queue, claim, review, and close become verbs, not
prose.

Tracked as issues: #5 (this spec), #6 (CLI), #7 (flow Action).
The long-term flagship — the stateless tab runtime
(`docs/specs/stateless-tab-runtime.md`) — is managed end-to-end through this
system, which is how it gets proven on the org's own work.

## Objective

Every feature, bug, and vulnerability is a **ticket** (a GitHub issue) with a
typed template. Tickets move through a labeled lifecycle — triage → ready →
in-progress → review → done — enforced by the CLI and the Action. The queue
is queryable, deterministic, and stateless: **the GitHub API is the only
state; the tool is a pure function of (argv, repo state) → (output,
transitions).**

Success criteria:

1. `ticket next` returns the same ticket for the same repo state to the same
   viewer — deterministic ordering, no local state.
2. Every transition is idempotent or errors with a clear message; no step can
   be skipped (close requires review; claim requires ready).
3. Zero files written, zero config files. Fresh checkout + `gh auth` runs the
   full flow. Nothing persists between invocations.
4. The org's issue-first workflow is executed by the tool, not just
   documented — CI enforces what the CLI standardizes.
5. The tab-runtime flagship is tracked as tickets end-to-end through this
   system.

## The model

```
ticket = GitHub issue            (the only store)
state  = derived from labels     (status/*, type/*, priority/*; no hidden state)
CLI    = pure function: (argv, API state) → (stdout, transitions)
Action = same function, run on issue events
"The API is truth; the tool is a pure function."
```

Stateless means *no state of our own*: every read is a live API call, every
write is an API mutation (label/assign/comment/close), and an invocation that
does nothing changes nothing. Same inputs → same outputs → same exit code.

## State machine

State lives in `status/*` labels (an issue with no status label is `triage`).

| State | Label | Meaning |
|---|---|---|
| triage | (none) | new; untyped/unprioritized |
| ready | `status/ready` | triaged; type + priority + acceptance present |
| in-progress | `status/in-progress` | claimed; assignee set |
| review | `status/review` | reviewer assigned; awaiting ack |
| blocked | `status/blocked` | blocked; reason in comment |
| done | closed (no label) | resolution comment posted |

Transitions (each is exactly one CLI verb; the Action comments when the API
state changes outside the CLI):

```
triage ──triaged──► ready ──claim──► in-progress ──review──► review ──close──► done
   ▲                    ▲                                    │
   └─────reopen─────────┘               block ──► blocked ◄──┘
                                            ▲        │
                                            └─unblock─┘
```

- `triage <n>` — ready requires `type/*` + `priority/*` + acceptance
  criteria in the body; otherwise error.
- `claim <n>` — ready + unassigned only. Already yours = no-op (exit 0,
  "already claimed"); someone else's = error.
- `review <n> --reviewer @u` — in-progress + assignee set; moves to review.
- `close <n>` — review only; requires linked PR merged **or** an `lgtm`
  comment from the reviewer; posts a resolution comment (problem → fix) per
  the org's rule 4.
- `block <n> "reason"` / `unblock <n>` — any state; reason required to block.
- `reopen <n>` — done → ready.

Labels: `type/bug|feature|security|chore`, `priority/p0|p1|p2|p3`,
`area/<pkg>`.

## CLI verbs (`npm run ticket -- …`)

| Verb | Effect |
|---|---|
| `list [--state S] [--label L] [--mine] [--json]` | the queue, deterministic sort |
| `next [--label L] [--json]` | top of ready queue, unassigned only |
| `new --type bug\|feature --title "…"` | create from the template contract; applies type label |
| `triage <n>` | ready gate: type + priority + acceptance |
| `claim <n>` / `unclaim <n>` | assign to you / clear |
| `review <n> --reviewer @u` | hand to review |
| `close <n>` / `reopen <n>` | done / back to ready |
| `block <n> "reason"` / `unblock <n>` | parked / resumed |
| `comment <n> "…"` | annotate |
| `report [--json]` | stateless status board (markdown/ANSI) |
| `sync <n>` | reconcile: find PRs referencing #n, check CI, post fix summary |

Output contract: human-readable by default; `--json` is the stable machine
schema (below). Exit 0 on success; non-zero + message on invalid transitions.
ANSI only when stdout is a TTY (same discipline as `formatting`).

## Determinism & statelessness mapping

- **Sort** (fixed): priority order (p0 < p1 < p2 < p3), then `created_at`
  asc, then number asc. No tie-break variance.
- **Idempotency**: repeat a valid transition → no-op success. Repeat an
  invalid one → same error, same message.
- **No ambient state**: `--repo owner/name`, else detected from
  `git remote get-url origin` of cwd (an *input*, deterministic per cwd).
  Token via `gh` (declared external tooling — same standing as system
  Chromium for the benchmarks). No config files, no caches, no dotfiles.
- **Every write is an API mutation**; an invocation that performs no mutation
  leaves the repo byte-identical.

Normalized ticket JSON (stable schema for `--json`):

```json
{
  "number": 6, "title": "[feature] Stateless ticket CLI",
  "type": "feature", "priority": "p2", "area": "ticket",
  "status": "triage", "assignee": null, "reviewer": null,
  "createdAt": "2026-08-05T…Z", "updatedAt": "2026-08-05T…Z",
  "url": "https://github.com/stateless-engineering/stateless-engineering/issues/6",
  "acceptance": true
}
```

## Integration

- **CLI** — `packages/ticket/bin/ticket.js`, zero npm deps, wraps `gh`
  subprocess. State machine in `packages/ticket/lib/flow.js`
  (`transitions[from][to] → allowed`), unit-tested with `node --test`.
- **Action** — `packages/ticket/flow.yml`, on issue events (opened, labeled,
  unlabeled, assigned, closed): validate hygiene (title `[type] ` prefix,
  required labels, acceptance present for features), apply defaults
  (`status/triage`, `priority/p2`), comment transition prompts, red-check
  violations. Permissions `issues: write`. Stateless: reads API, writes
  labels/comments only.
- **Root scripts** — `"ticket": "node packages/ticket/bin/ticket.js"`,
  `"test": "node --test packages/*/test"` once the first lib tests land.
- **CI** — ci.yml gains a `ticket` self-test job (state-machine unit tests +
  a contract probe like the existing runner/format jobs). The Action owns
  issue events; ci.yml stays code-focused.

## Boundaries

- **Always:** issue-first (no code without an issue — enforced, not
  suggested); deterministic ordering; stable `--json` schema; the six
  stateless rules; benchmark gates unchanged (9/9).
- **Ask first:** new status/type/priority labels (state-machine change), new
  verbs, Action permissions beyond `issues: write`, milestone/iteration use,
  pushing `notes/` without review.
- **Never:** close without a resolution comment; skip a transition; local
  caches or config files; write anything into the repo tree at runtime.

## Open questions

1. **Reviewer ack** — is `lgtm`-comment-only sufficient to close, or must the
   closer be the reviewer? Default: linked-PR-merged OR reviewer `lgtm`.
2. **Priority default** — new issues start `p2` (Action-applied) unless
   triage says otherwise. Default: yes.
3. **Iterations** — milestones for sprints, or priority + created enough for
   a solo org? Default: enough; milestones later if the queue says so.
4. **Auto-assign in CI** — should push events auto-assign the pusher the next
   ready ticket? Default: no; the Action validates, the CLI decides.

## Non-goals

- No board UI — `report` is terminal output; GitHub's own issues UI is the
  web view.
- No local cache, no offline mode, no daemon.
- No replacement of GitHub issues — we standardize the flow on top of it.
- Tab-runtime implementation is **tracked through** this system (as issues),
  not in scope here.
