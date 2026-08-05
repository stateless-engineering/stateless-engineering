# ADR 0004 — The GitHub wiki is a derived mirror of docs/

Status: accepted (2026-08-05, `.github/workflows/wiki.yml`)

## Context

The org needed a public wiki without hand-maintaining two copies of every
page. The wiki lives in a separate git repo (`OWNER/REPO.wiki`) that is
easy to drift out of sync; hand-edited wikis rot.

## Decision

`docs/` is the single source of truth. On every push touching `docs/**`
(and on `workflow_dispatch`), a workflow wipes the wiki and rebuilds it
from `docs/`: wiki root ← `docs/wiki/` (index → Home), specs and
architecture mirrored, docs-relative links rewritten to wiki form,
`[[Page]]` sidebar generated. The wiki is never edited by hand.

## Consequences

- The wiki can never drift: it is a render of the tree.
- Human wiki edits are destroyed on the next sync — accepted and
  documented as a risk; the workflow is the only writer.
- The mirror costs one small job per docs push; wiki-only changes still
  land through docs/ PRs, keeping the issue-first flow intact.
