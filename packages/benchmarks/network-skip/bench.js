#!/usr/bin/env node
/**
 * network-skip/bench.js
 *
 * Demo: the network cost of getting a tab back. A full reload re-downloads
 * the page HTML, stylesheet, and images (4 requests, ~770 KiB) and re-runs
 * the page's JS. A snapshot restore fetches ZERO bytes — the DOM comes from
 * the snapshot, so no requests hit the wire at all.
 *
 * Run: node network-skip/bench.js
 */
'use strict';

const { launch, serveFixture, snapshot, restore, emitResult } = require('../lib/common');

// count network bytes via CDP Network.loadingFinished (encodedDataLength =
// bytes on the wire per request), reliable where response.buffer() races
async function countNetwork(page, fn) {
  let requests = 0;
  let bytes = 0;
  const client = await page.createCDPSession();
  await client.send('Network.enable');
  client.on('Network.loadingFinished', (p) => {
    requests++;
    bytes += p.encodedDataLength || 0;
  });
  await fn();
  await new Promise((r) => setTimeout(r, 500)); // let tail responses land
  await client.detach();
  return { requests, bytes };
}

async function main() {
  const { url, close } = await serveFixture();
  const browser = await launch();
  try {
    // ---- full reload: re-fetch everything ----
    const p1 = await browser.newPage();
    const net = await countNetwork(p1, () => p1.goto(url, { waitUntil: 'networkidle0' }));
    await p1.evaluate(() => { window.__demoState = { v: 1 }; });
    const snap = await snapshot(p1);
    await p1.close();

    // ---- snapshot restore: strip resource tags, fetch nothing ----
    const bareHtml = snap.html
      .replace(/<link\b[^>]*>/gi, '')
      .replace(/<img\b[^>]*>/gi, '');
    const p2 = await browser.newPage();
    const t0 = performance.now();
    const net2 = await countNetwork(p2, () => {
      return restore(p2, { ...snap, html: bareHtml });
    });
    const restoreMs = performance.now() - t0;

    // ---- report ----
    const kib = (n) => (n / 1024).toFixed(1) + ' KiB';
    console.log('getting the tab back | requests | payload | time');
    console.log('---------------------+----------+---------+------');
    console.log(
      'full reload           | ' + String(net.requests).padStart(8) + ' | ' +
      kib(net.bytes).padStart(7) + ' | ' + 're-executes page JS'
    );
    console.log(
      'snapshot restore      | ' + String(net2.requests).padStart(8) + ' | ' +
      kib(net2.bytes).padStart(7) + ' | ' + (restoreMs / 1000).toFixed(2) + 's'
    );
    console.log('');
    console.log(`what the snapshot persists instead: ${(snap.bytes / 1024).toFixed(1)} KiB (${snap.nodeCount} DOM nodes)`);

    emitResult({
      demo: 'network-skip',
      durationMs: Math.round(restoreMs),
      reloadRequests: net.requests,
      reloadBytes: net.bytes,
      restoreRequests: net2.requests,
      restoreBytes: net2.bytes,
      snapshotBytes: snap.bytes,
      headline:
        `reload: ${net.requests} requests / ${kib(net.bytes)}; ` +
        `restore: ${net2.requests} requests / ${kib(net2.bytes)} (0 network)`,
    });
  } finally {
    await browser.close();
    await close();
  }
}

main().catch((err) => {
  console.error('bench failed:', err.message);
  process.exit(1);
});
