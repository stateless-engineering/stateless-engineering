#!/usr/bin/env node
/**
 * bench-runner — a stateless benchmark runner.
 *
 * Runs every `bench.js` found in a directory of demos, collects the
 * machine-readable result each one emits (a line starting with `RESULT_JSON`),
 * and prints a master summary. A demo that prints no RESULT_JSON line still
 * runs and shows up as "(no headline)"; failures and timeouts are surfaced.
 *
 * Stateless by design:
 *   - zero npm dependencies (Node stdlib + the formatting package, a sibling
 *     in the monorepo)
 *   - no config file, no cache, no result files — nothing written to disk
 *   - every input comes from argv; all output goes to stdout (--json for
 *     machine consumption); the exit code carries pass/fail
 *   - identical inputs produce identical runs: deterministic ordering,
 *     no ambient state
 *
 * The summary renders through the `formatting` package (pretty box table,
 * colored status chips); it degrades to plain text if the sibling
 * `formatting` package isn't present (partial monorepo checkout).
 *
 * Usage:
 *   bench-runner [DIR] [--json] [--only a,b] [--timeout SECS]
 *
 *   DIR            directory containing a bench.js per demo (default: cwd)
 *   --json         print a JSON array of results only (CI-friendly)
 *   --only a,b     run a subset of demos
 *   --timeout SECS per-demo timeout in seconds (default 180)
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// pretty output via the formatting package (sibling in the monorepo); plain text if it isn't checked out
let fmt = null;
try {
  fmt = require('../../formatting/lib/format.js');
} catch {
  /* formatting package (sibling in the monorepo) missing (clone without --recursive): plain text */
}

function usage() {
  console.log('usage: bench-runner [DIR] [--json] [--only a,b] [--timeout SECS]');
}

function parseArgs(argv) {
  const out = { dir: null, json: false, only: null, timeout: 180 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--only') out.only = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--timeout') out.timeout = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else if (!out.dir) out.dir = a;
  }
  return out;
}

function findDemos(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, 'bench.js')))
    .map((d) => d.name)
    .sort();
}

function runDemo(root, name, timeoutSecs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn('node', [path.join(root, name, 'bench.js')], { cwd: root });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutSecs * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ name, code, timedOut, stdout, stderr, durationMs: Date.now() - start });
    });
  });
}

// last RESULT_JSON line in stdout wins
function parseResult(stdout) {
  const lines = stdout.split('\n').filter((l) => l.startsWith('RESULT_JSON '));
  if (!lines.length) return null;
  try {
    return JSON.parse(lines[lines.length - 1].slice('RESULT_JSON '.length));
  } catch {
    return null;
  }
}

function statusOf(r) {
  if (r.timedOut) return 'TIMED OUT';
  if (r.code !== 0) return `FAILED (exit ${r.code})`;
  return 'ok';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = path.resolve(opts.dir || process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`bench-runner: not a directory: ${root}`);
    process.exit(2);
  }

  let demos = findDemos(root);
  if (opts.only) {
    const missing = opts.only.filter((n) => !demos.includes(n));
    for (const n of missing) console.warn(`warning: no demo named "${n}" in ${root}`);
    demos = opts.only.filter((n) => demos.includes(n));
  }
  if (!demos.length) {
    console.error(`bench-runner: no */bench.js demos found in ${root}`);
    process.exit(2);
  }

  const started = Date.now();
  const results = [];
  for (const name of demos) {
    if (!opts.json) console.log(fmt ? fmt.cyan(`\n=== ${name} ===`) : `\n=== ${name} ===`);
    const r = await runDemo(root, name, opts.timeout);
    r.result = parseResult(r.stdout);
    results.push(r);
    if (!opts.json) {
      if (r.stdout.trim()) process.stdout.write(r.stdout.trim() + '\n');
      if (r.stderr.trim()) process.stderr.write(r.stderr.trim() + '\n');
    }
  }
  const totalMs = Date.now() - started;

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        results.map((r) => ({
          demo: r.name,
          status: statusOf(r),
          durationMs: r.durationMs,
          result: r.result || null,
        })),
        null,
        2
      ) + '\n'
    );
    process.exit(results.some((r) => r.code !== 0 || r.timedOut) ? 1 : 0);
  }

  console.log('\n');
  if (fmt) {
    const rows = results.map((r) => [
      r.name,
      (r.durationMs / 1000).toFixed(1) + 's',
      fmt.statusChip(statusOf(r)),
      r.result && r.result.headline ? r.result.headline : '(no headline)',
    ]);
    console.log(fmt.table(['demo', 'dur', 'status', 'headline'], rows, { align: { 1: 'right' } }));
  } else {
    console.log('demo             | dur     | status | headline');
    console.log('-----------------+---------+--------+---------------------------------------------');
    for (const r of results) {
      const headline = r.result && r.result.headline ? r.result.headline : '(no headline)';
      console.log(
        r.name.padEnd(17) +
        '| ' + (r.durationMs / 1000).toFixed(1).padStart(5) + 's ' +
        '| ' + statusOf(r).padEnd(6) +
        '| ' + headline
      );
    }
    console.log('-----------------+---------+--------+---------------------------------------------');
  }
  const ok = results.filter((r) => r.code === 0 && !r.timedOut).length;
  const totalLine = `total: ${ok}/${results.length} demos ok, ${(totalMs / 1000).toFixed(1)}s wall`;
  console.log(fmt ? fmt.bold(totalLine) : totalLine);
  process.exit(ok === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error('bench-runner failed:', err.message);
  process.exit(1);
});
