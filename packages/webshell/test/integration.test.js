'use strict';
/**
 * Integration tests for the webshell control plane (issue #3):
 * GET /health, /apps, /settings; POST /run/:app; POST /wire (pipeline,
 * stdout→stdin chaining, stop on non-zero exit).
 *
 * Spawns webshell.js on an ephemeral port, waits for the startup line,
 * exercises the API, and kills it when the suite finishes. A tiny bench
 * fixture in /tmp (created here) drives the fast pipeline tests.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WEBSHELL = path.join(__dirname, '..', 'webshell.js');
const FIXTURE = path.join(os.tmpdir(), 'ws-bench-fixture', 'fixture');

let child = null;
let base = null;

before(async () => {
  // stateless bench fixture: emits one RESULT_JSON line, exits 0
  fs.mkdirSync(FIXTURE, { recursive: true });
  fs.writeFileSync(path.join(FIXTURE, 'bench.js'),
    "console.log('RESULT_JSON ' + JSON.stringify({ demo: 'fixture', status: 'ok', value: 42 }));\n");

  child = spawn(process.execPath, [WEBSHELL, '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('webshell startup timeout')), 15000);
    child.on('exit', (code) => reject(new Error(`webshell exited early (${code})`)));
    child.stdout.on('data', (d) => {
      const m = String(d).match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    });
  });
});

after(() => {
  if (child) child.kill('SIGTERM');
});

async function get(p) {
  const r = await fetch(base + p);
  return { status: r.status, text: await r.text() };
}

async function post(p, body) {
  const r = await fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, text: await r.text() };
}

test('GET /health — ok, apps discovered, runner + formatting present', async () => {
  const { status, text } = await get('/health');
  assert.equal(status, 200);
  const h = JSON.parse(text);
  assert.equal(h.status, 'ok');
  assert.ok(h.apps.count >= 10, `expected >= 10 apps, got ${h.apps.count}`);
  assert.equal(h.runner.present, true);
  assert.equal(h.formatting.present, true);
});

test('GET /apps — discovers summary, bench-runner, formatting', async () => {
  const { status, text } = await get('/apps');
  assert.equal(status, 200);
  const names = JSON.parse(text).apps.map((a) => a.name);
  for (const want of ['summary', 'bench-runner', 'formatting']) {
    assert.ok(names.includes(want), `apps missing ${want}: ${names.join(',')}`);
  }
});

test('GET /settings — effective config with roots and port', async () => {
  const { status, text } = await get('/settings');
  assert.equal(status, 200);
  const s = JSON.parse(text);
  assert.ok(s.roots && s.roots.apps, 'roots.apps missing');
  assert.ok(s.roots.services, 'roots.services missing');
  assert.ok(Number.isInteger(s.port) && s.port > 0, `bad port: ${s.port}`);
});

test('POST /run/summary — stdin app without input fails cleanly ([exit 1])', async () => {
  // /run does not feed the request body to stdin; summary requires stdin JSON.
  const { status, text } = await post('/run/summary', { args: [] });
  assert.equal(status, 200);
  assert.match(text, /bad JSON on stdin/);
  assert.match(text, /\[exit 1\]/);
});

test('POST /run/bench-runner — args-driven app succeeds ([exit 0])', async () => {
  const { status, text } = await post('/run/bench-runner', {
    args: ['--json', path.dirname(FIXTURE)],
  });
  assert.equal(status, 200);
  assert.match(text, /"demo": "fixture"/);
  assert.match(text, /\[exit 0\]/);
});

test('POST /run/unknown — 400 with remediation', async () => {
  const { status, text } = await post('/run/nonexistent', {});
  assert.equal(status, 400);
  assert.match(text, /unknown app/);
});

test('POST /wire — bench-runner → summary → formatting (box table out)', async () => {
  const { status, text } = await post('/wire', {
    steps: [
      { app: 'bench-runner', args: ['--json', path.dirname(FIXTURE)] },
      { app: 'summary' },
      { app: 'formatting' },
    ],
  });
  assert.equal(status, 200);
  assert.match(text, /[│┌┐└┘]/);           // formatting rendered the box table
  assert.match(text, /\[wire done\]/);
  assert.match(text, /step 3\/3: formatting/);
});

test('POST /wire — unknown app step → 400', async () => {
  const { status, text } = await post('/wire', { steps: [{ app: 'nope' }] });
  assert.equal(status, 400);
  assert.match(text, /unknown app in step/);
});

test('POST /wire — empty steps → 400', async () => {
  const { status, text } = await post('/wire', { steps: [] });
  assert.equal(status, 400);
  assert.match(text, /wire requires/);
});

test('POST /wire — failing step stops the pipeline (no box output)', async () => {
  // formatting with empty stdin exits 1 (bad JSON) → pipeline halts before
  // producing any rendered table.
  const { status, text } = await post('/wire', { steps: [{ app: 'formatting' }] });
  assert.equal(status, 200);
  assert.match(text, /exited 1/);
  assert.match(text, /pipeline stopped/);
  assert.doesNotMatch(text, /[│┌┐└┘]/);    // nothing rendered after the failure
});
