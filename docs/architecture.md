# Architecture

One repository, four packages, three roots, zero daemons.

## Repository layout

```
stateless-engineering/
├── package.json              # npm workspace root; scripts: bench:all, bench:one, webshell, test
├── packages/
│   ├── webshell/             # the app runtime & compositor (webshell.js)
│   │   ├── webshell.js       #   HTTP server: discovery, /run, /wire, /settings
│   │   ├── apps/summary/     #   transformer app: RESULT_JSON array → table form
│   │   └── public/           #   the terminal UI
│   ├── bench-runner/         # stateless CLI: every */bench.js → RESULT_JSON summary
│   ├── formatting/           # pretty ANSI box tables; consumed by bench-runner in-process
│   └── benchmarks/           # the store: one dir per benchmark with bench.js
│       └── lib/common.js     #   shared: launch, serveFixture, treeRssKb, snapshot/restore
├── docs/                     # architecture + wiki
├── notes/                    # provenance chat-log exports
└── .github/                  # issue templates + CI workflows
```

## Data flow

```mermaid
flowchart LR
    UI[public/index.html] -->|GET /apps, /health| WS[webshell.js]
    UI -->|POST /run/:app| WS
    UI -->|POST /wire| WS
    WS -->|spawn node run.js| BR[bench-runner]
    WS -->|spawn node summary.js| SUM[summary app]
    WS -->|spawn bin/formatting.js| FMT[formatting]
    BR -->|spawn node bench.js per benchmark| BM[benchmarks dir]
    BR -->|require in-process| FMT
    BM -->|RESULT_JSON line| BR
    BR -->|--json array| SUM
    SUM -->|table form| FMT
    FMT -->|ANSI table| UI
```

## Discovery = path resolution

- `webshell.js` scans three roots for `app.json` manifests (or legacy
  `bench.js`): its own `apps/`, `packages/benchmarks/`, and `packages/`.
- A service exists if its directory is on disk. No registry, no config.
- **"Down" is the default** — every app is a short-lived process spawned per
  request, gated on exit code, reaped on disconnect.

## Stateless guarantees

- Temp files → `os.tmpdir()` with `try/finally` + `process.on('exit')` cleanup.
- Ephemeral ports (webshell binds 0 by default; benchmarks bind 0).
- Sorted discovery ordering; no ambient state; no generated artifacts in git.
