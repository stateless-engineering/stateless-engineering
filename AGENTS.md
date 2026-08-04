# AGENTS — stateless-engineering monorepo

## Hard rule: everything in this repo is stateless

A project MUST NOT keep state between runs. "Stateless" is defined as:

1. **No files left behind.** Nothing a run creates may persist inside the
   repo or workspace: no caches, logs, profiles, snapshots, or result files.
   Temp artifacts live in `os.tmpdir()` and MUST be cleaned up — in
   `try/finally`, plus a `process.on('exit')` handler where a hard kill is
   possible — even when the run fails.
2. **No ambient state.** No config files that steer behavior, no reliance on
   the environment, no global installs, no pre-existing data. Every input
   comes from argv/env at invocation; a fresh checkout runs the same.
3. **Deterministic.** Same inputs → same behavior. Fixed (sorted) ordering,
   ephemeral ports (bind port 0), unique temp names (pid / `mkdtemp`), no
   shared mutable state between components or across runs.
4. **Self-contained.** Zero runtime dependencies where practical (Node
   stdlib). External tooling is a declared dependency — never vendored or
   copied state.
5. **Clean teardown.** Browsers, servers, and child processes MUST be closed
   in `finally` blocks. A killed run leaves the tree exactly as it found it.
6. **No generated artifacts in git.** `node_modules`, logs, browser profiles,
   snapshots, and build output are gitignored; commits contain source only.

## Repo layout

```
packages/webshell/    the stateless app runtime & compositor (webshell.js)
packages/bench-runner/ the stateless CLI: RESULT_JSON aggregation
packages/formatting/  pretty ANSI box tables (stdin → stdout)
packages/benchmarks/  the benchmark store: one dir per benchmark, bench.js entry
docs/                 architecture + wiki (the org's knowledge base)
notes/                provenance: verbatim chat-log exports that started it all
.github/              org-level issue templates + CI workflows
```

## Issue-first workflow

Features, problems, and vulnerabilities land as GitHub issues before code is
touched. Branch per issue (`<number>-<slug>`), Conventional Commits with the
issue reference (`feat(#12): …`), merge only when CI is green, then update the
issue with the problem → fix explanation.

Exceptions require explicit user approval in this conversation.
