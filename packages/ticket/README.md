# @stateless-engineering/ticket

Stateless ticket management on GitHub issues — the org's issue-first workflow
as **verbs**, not prose. Implements `docs/specs/stateless-tickets.md` (issues
#5/#6/#7).

The GitHub API is the only state. The CLI is a pure function of
`(argv, repo state) → (output, transitions)`: every read is a live API call,
every write is an API mutation, and an invocation that does nothing changes
nothing.

## Usage

```bash
npm run ticket -- list                  # the queue, deterministic sort
npm run ticket -- next                  # top of the ready queue (unassigned)
npm run ticket -- new --type feature --title "add thing"
npm run ticket -- triage 12             # gate to ready (type+priority+acceptance)
npm run ticket -- claim 12              # assign to you → in-progress
npm run ticket -- review 12 --reviewer @alice
npm run ticket -- close 12              # done (merged PR or reviewer lgtm)
npm run ticket -- block 12 "waiting on CI" / unblock 12
npm run ticket -- report --json         # stateless status board
```

- `--repo owner/name` — explicit repo (else detected from `git remote`).
- `--json` — stable machine schema (`lib/flow.js` `normalize`).
- `--dry-run` — reads run for real (validation), mutations are printed, never
  executed.

## Layout

- `lib/flow.js` — the state machine + normalizer. Pure, zero-dep, shared with
  the flow Action. `checkTransition(from, to, ctx)` owns every gate.
- `lib/gh.js` — `gh` subprocess wrapper (reads live, writes mutation-safe).
- `bin/ticket.js` — the CLI verbs.
- `test/flow.test.js` — `node --test`; the state machine's contract.

## Stateless contract

No local state, no config files, no caches, no daemon. Same inputs → same
outputs → same exit code. Deterministic sort: priority (p0→p3), then
`created_at` asc, then number asc.
