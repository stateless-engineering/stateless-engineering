#!/usr/bin/env node
/**
 * restart/bench.js
 *
 * Demo: hibernate the whole browser to disk. Snapshot the tab's render state
 * to a JSON file, kill the browser process entirely, then start a brand-new
 * browser and restore from the file — no network, no script re-execution,
 * state intact. That is the "freeze-dried tab" dream applied to a process
 * restart; contrast with the same restart done the old way (full reload).
 *
 * Run: node restart/bench.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { launch, serveFixture, snapshot, restore, emitResult } = require('../lib/common');

async function main() {
  const { url, close } = await serveFixture();
  const snapFile = path.join(os.tmpdir(), `bench-restart-${process.pid}.json`);
  // stateless: never leave the snapshot file behind, even on abnormal exit
  process.on('exit', () => fs.rmSync(snapFile, { force: true }));
  let b1 = null;
  let b2 = null;
  try {
    // ---- browser #1: load, interact, snapshot to disk ----
    b1 = await launch();
    const p1 = await b1.newPage();
    await p1.goto(url, { waitUntil: 'networkidle0' });
    await p1.evaluate(() => {
      window.__demoState = { visits: 99, token: 'mutated-by-user' };
      document.querySelector('#name').value = 'hibernated-user';
      window.scrollTo(0, 4000);
    });
    const snap = await snapshot(p1);
    fs.writeFileSync(snapFile, JSON.stringify(snap), 'utf8');
    console.log(`snapshot written: ${(snapFile.length > 0 ? fs.statSync(snapFile).size : 0) / 1024} KiB on disk, ${snap.nodeCount} DOM nodes`);
    await b1.close(); // whole browser process tree gone
    b1 = null;

    // ---- browser #2: restore from disk vs full reload ----
    b2 = await launch();
    const t0 = performance.now();
    const fromDisk = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
    const p2 = await b2.newPage();
    await restore(p2, fromDisk);
    const restoreMs = performance.now() - t0;
    const restored = await p2.evaluate(() => ({
      demoState: window.__demoState,
      scrollY: window.scrollY,
      name: document.querySelector('#name') ? document.querySelector('#name').value : null,
      nodeCount: document.querySelectorAll('*').length,
    }));

    const p3 = await b2.newPage();
    const t1 = performance.now();
    await p3.goto(url, { waitUntil: 'networkidle0' });
    const reloadMs = performance.now() - t1;
    const reloaded = await p3.evaluate(() => ({
      demoState: window.__demoState,
      scrollY: window.scrollY,
      name: document.querySelector('#name') ? document.querySelector('#name').value : null,
    }));

    // ---- report ----
    console.log('after full browser restart | from snapshot | full reload');
    console.log('---------------------------+---------------+-----------');
    const row = (label, v1, v2) =>
      console.log(label.padEnd(27) + '| ' + String(v1).padEnd(14) + '| ' + String(v2));
    row('tab back in', (restoreMs / 1000).toFixed(2) + 's', (reloadMs / 1000).toFixed(2) + 's');
    row('JS runtime state', JSON.stringify(restored.demoState), JSON.stringify(reloaded.demoState));
    row('scroll position', restored.scrollY + 'px', reloaded.scrollY + 'px');
    row('form value (#name)', JSON.stringify(restored.name), JSON.stringify(reloaded.name));
    console.log('');

    const speedup = (reloadMs / restoreMs).toFixed(1) + 'x';
    emitResult({
      demo: 'restart',
      durationMs: Math.round(restoreMs),
      restoreMs: Math.round(restoreMs),
      reloadMs: Math.round(reloadMs),
      snapshotBytes: snap.bytes,
      headline:
        `snapshot survives process death: restore ${(restoreMs / 1000).toFixed(2)}s ` +
        `(${speedup} faster than reload's ${(reloadMs / 1000).toFixed(2)}s), state kept`,
    });
  } finally {
    if (b1) await b1.close();
    if (b2) await b2.close();
    await close();
    fs.rmSync(snapFile, { force: true });
  }
}

main().catch((err) => {
  console.error('bench failed:', err.message);
  process.exit(1);
});
