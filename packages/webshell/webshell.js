#!/usr/bin/env node
/**
 * webshell — the stateless app runtime & compositor.
 *
 * Discover apps, run them on demand, wire them into pipelines. An "app" is a
 * directory with an `app.json` manifest (`entry` is an argv array) — or a
 * legacy `bench.js` benchmark, which defaults to `node bench.js`. Nothing
 * runs until asked; nothing is left behind.
 *
 * Stateless service model:
 *   - Discovery = path resolution, not a registry. Roots: this repo's
 *     `apps/`, plus `--apps` (default ../benchmarks) and `--services`
 *     (default ../services); GET /apps lists what's discoverable.
 *   - "Down" is the default state: every app is spawned on demand per
 *     request and gated on readiness (exit code). The only real failure is
 *     a missing piece on disk, surfaced via /health and a 503 with
 *     remediation.
 *   - Compositor: POST /wire runs a pipeline of apps sequentially, feeding
 *     each app's stdout into the next app's stdin — shell pipes, but each
 *     stage is a fresh stateless process.
 *
 * Usage:
 *   node server.js [--port 0] [--apps ../../packages/benchmarks] [--services ../../packages]
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const PORT = parseInt(opt('--port', '0'), 10);
let APPS_DIR = path.resolve(opt('--apps', path.join(__dirname, '..', '..', 'packages', 'benchmarks')));
let SERVICES_DIR = path.resolve(opt('--services', path.join(__dirname, '..', '..', 'packages')));
let APPS_OVERRIDE = null; // session-only overrides via POST /settings
let SERVICES_OVERRIDE = null;
const OWN_APPS = path.join(__dirname, 'apps');
const INDEX = path.join(__dirname, 'public', 'index.html');

// ---- discovery: path resolution over registry ---------------------------------
function scanDir(root, origin) {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const dir = path.join(root, d.name);
        const manifestPath = path.join(dir, 'app.json');
        if (fs.existsSync(manifestPath)) {
          let manifest = {};
          try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          } catch { /* malformed manifest */ }
          if (Array.isArray(manifest.entry) && manifest.entry.length) {
            return {
              name: manifest.name || d.name,
              description: manifest.description || '',
              entry: manifest.entry,
              dir,
              origin,
            };
          }
        }
        if (fs.existsSync(path.join(dir, 'bench.js'))) {
          return {
            name: d.name,
            description: 'legacy benchmark app (bench.js)',
            entry: ['node', 'bench.js'],
            dir,
            origin,
            legacy: true,
          };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function apps() {
  return [
    ...scanDir(OWN_APPS, 'webshell'),
    ...scanDir(APPS_DIR, 'benchmarks'),
    ...scanDir(SERVICES_DIR, 'services'),
  ];
}

function findApp(name) {
  return apps().find((a) => a.name === name);
}

function health() {
  const list = apps();
  const runner = findApp('bench-runner');
  const formatting = findApp('formatting');
  return {
    status: runner && formatting ? 'ok' : 'degraded',
    apps: { count: list.length, byOrigin: Object.entries(
      list.reduce((m, a) => ((m[a.origin] = (m[a.origin] || 0) + 1), m), {})
    ).map(([origin, count]) => ({ origin, count })) },
    roots: {
      webshell: { present: fs.existsSync(OWN_APPS) },
      benchmarks: { present: fs.existsSync(APPS_DIR), path: APPS_DIR },
      services: { present: fs.existsSync(SERVICES_DIR), path: SERVICES_DIR },
    },
    runner: {
      present: !!runner,
      note: runner
        ? 'app: spawns every bench.js and aggregates RESULT_JSON'
        : 'missing: git submodule update --init --recursive in ../benchmarks and ../services',
    },
    formatting: {
      present: !!formatting,
      note: formatting
        ? 'app: pretty tables from JSON on stdin (wire target)'
        : 'missing: services/formatting submodule not checked out',
    },
  };
}

// ---- server ------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj, null, 2));
  };
  const plain = (code, text) => {
    res.writeHead(code, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' });
    res.end(text);
  };
  const readBody = () =>
    new Promise((resolve) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => resolve(body));
    });

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(INDEX));
  } else if (req.method === 'GET' && url.pathname === '/settings') {
    json(200, {
      port: server.address().port,
      ephemeral: PORT === 0,
      roots: { apps: APPS_DIR, services: SERVICES_DIR, webshellApps: OWN_APPS },
      overrides: { apps: APPS_OVERRIDE, services: SERVICES_OVERRIDE },
      note: 'session-only overrides; lost on restart (stateless — nothing persisted)',
      health: health(),
    });
  } else if (req.method === 'POST' && url.pathname === '/settings') {
    // session-scoped root repointing so you can wire in other app stores live
    readBody().then((body) => {
      let p = null;
      try {
        p = JSON.parse(body);
      } catch { /* malformed */ }
      if (!p) {
        plain(400, 'bad JSON');
        return;
      }
      if (p.apps) {
        const r = path.resolve(p.apps);
        if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) {
          plain(400, `not a directory: ${r}`);
          return;
        }
        APPS_DIR = r;
        APPS_OVERRIDE = r;
      }
      if (p.services) {
        const r = path.resolve(p.services);
        if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) {
          plain(400, `not a directory: ${r}`);
          return;
        }
        SERVICES_DIR = r;
        SERVICES_OVERRIDE = r;
      }
      json(200, { roots: { apps: APPS_DIR, services: SERVICES_DIR }, note: 'session-only; lost on restart' });
    });
  } else if (req.method === 'GET' && url.pathname === '/health') {
    const h = health();
    json(h.status === 'ok' ? 200 : 503, h);
  } else if (req.method === 'GET' && url.pathname === '/apps') {
    json(200, { apps: apps() });
  } else if (req.method === 'POST' && (url.pathname === '/run' || /^\/run\/[^/]+$/.test(url.pathname))) {
    // /run (backwards-compat: body app/demo) or /run/:app
    const named = url.pathname === '/run' ? null : decodeURIComponent(url.pathname.slice('/run/'.length));
    readBody().then((body) => {
      let app = null;
      let args = [];
      try {
        const p = JSON.parse(body);
        app = named ? findApp(named) : findApp(p.app || p.demo);
        args = Array.isArray(p.args) ? p.args : [];
      } catch { /* malformed */ }
      if (!app) {
        plain(400, `unknown app: ${named || '(none)'}. available: ${apps().map((a) => a.name).join(', ')}`);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' });
      const child = spawn(app.entry[0], [...app.entry.slice(1), ...args], { cwd: app.dir });
      child.stdin.end(); // stdin-reading apps see EOF immediately; others ignore it
      let done = false;
      child.stdout.on('data', (d) => res.write(d));
      child.stderr.on('data', (d) => res.write(d));
      child.on('close', (code) => {
        done = true;
        res.end(`\n[exit ${code}]\n`);
      });
      // client disconnected mid-run: stop the child. (req 'close' fires as
      // soon as the body is read — the response 'close' is the real signal.)
      res.on('close', () => {
        if (!done) child.kill('SIGTERM');
      });
    });
  } else if (req.method === 'POST' && url.pathname === '/wire') {
    // pipeline: run steps sequentially, feeding stdout → next stdin.
    // { "steps": [ {"app":"bench-runner","args":["--json","../benchmarks"]}, {"app":"summary"}, {"app":"formatting"} ] }
    readBody().then(async (body) => {
      let steps = [];
      try {
        steps = JSON.parse(body).steps || [];
      } catch { /* malformed */ }
      if (!Array.isArray(steps) || !steps.length) {
        plain(400, 'wire requires {"steps":[{"app":"...","args":[...]}, ...]}');
        return;
      }
      for (const s of steps) {
        if (!findApp(s && s.app)) {
          plain(400, `unknown app in step: ${s && s.app}`);
          return;
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' });
      const safeWrite = (d) => {
        if (!res.writableEnded) res.write(d);
      };
      let done = false;
      let current = null;
      res.on('close', () => {
        if (!done && current) current.kill('SIGTERM');
      });
      const runStep = (app, args, stdinText) =>
        new Promise((resolve) => {
          current = spawn(app.entry[0], [...app.entry.slice(1), ...args], { cwd: app.dir });
          let out = '';
          current.stdout.on('data', (d) => { out += d; safeWrite(d); });
          current.stderr.on('data', (d) => safeWrite(d));
          if (stdinText != null) current.stdin.write(stdinText);
          current.stdin.end();
          current.on('close', (code) => { current = null; resolve({ exit: code, stdout: out }); });
        });
      let input = null;
      for (let i = 0; i < steps.length; i++) {
        const app = findApp(steps[i].app);
        safeWrite(`── step ${i + 1}/${steps.length}: ${app.name} (${app.origin}) ──\n`);
        const r = await runStep(app, steps[i].args || [], input);
        if (r.exit !== 0) {
          safeWrite(`[step ${i + 1} exited ${r.exit} — pipeline stopped]\n`);
          break;
        }
        input = r.stdout;
      }
      done = true;
      safeWrite('\n[wire done]\n');
      if (!res.writableEnded) res.end();
    });
  } else {
    plain(404, 'not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address();
  const h = health();
  console.log(`webshell: http://127.0.0.1:${addr.port}  (ephemeral port; pin with --port)`);
  console.log(`  apps:       ${h.apps.count} discovered ${JSON.stringify(h.apps.byOrigin)}`);
  console.log(`  runner:     ${h.runner.present ? 'ok' : 'MISSING — git submodule update --init --recursive'}`);
  console.log(`  formatting: ${h.formatting.present ? 'ok' : 'missing — services/formatting not checked out'}`);
});
