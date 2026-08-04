# The compositor

`POST /wire` on the webshell is shell pipes, but every stage is a fresh
stateless process. Run steps sequentially, feed `stdout → stdin`, stop the
pipeline when a step exits non-zero.

## The flagship pipeline

```json
{
  "steps": [
    { "app": "bench-runner", "args": ["--json", "packages/benchmarks", "--only", "bfcache"] },
    { "app": "summary" },
    { "app": "formatting" }
  ]
}
```

- `bench-runner` aggregates every benchmark's `RESULT_JSON` line into a JSON
  array.
- `summary` (a transformer app in `packages/webshell/apps/`) reshapes the
  array into the table form.
- `formatting` renders the pretty box table.

Three zero-dep processes, one pipeline, no state between them.

## How it works internally

1. The server validates every step's app against discovery (`findApp`).
2. Each step is spawned with `cwd = app.dir`; its `stdout` is captured *and*
   streamed to the client.
3. The captured stdout becomes the next step's `stdin` (written then
   `stdin.end()`).
4. A non-zero exit stops the pipeline with `[step N exited X — pipeline
   stopped]`.
5. Client disconnect mid-pipeline SIGTERMs the current step (the `done` flag
   prevents killing after completion).

The model in one line: **apps declare what they eat and emit; the webshell
composes them like pipes.**
