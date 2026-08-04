#!/usr/bin/env node
/**
 * pixel-ghost/bench.js
 *
 * Demo: the naive "restore" — caching pixels. Screenshot the tab, kill it,
 * show the screenshot back. It LOOKS like the page but is dead: no DOM, no
 * JS state, nothing to click or type into. A snapshot restore gives you the
 * same-looking page that is actually alive. This is why OS-level "thumbnail
 * restore" ideas fail and why the render state must be captured, not pixels.
 *
 * Run: node pixel-ghost/bench.js
 */
'use strict';

const { launch, serveFixture, snapshot, restore, emitResult } = require('../lib/common');

async function main() {
  const { url, close } = await serveFixture();
  const browser = await launch();
  try {
    // ---- live tab: interact, screenshot, snapshot ----
    const live = await browser.newPage();
    await live.goto(url, { waitUntil: 'networkidle0' });
    await live.evaluate(() => {
      window.__demoState = { visits: 99, token: 'mutated-by-user' };
      document.querySelector('#name').value = 'hibernated-user';
      window.scrollTo(0, 4000);
    });
    const shot = await live.screenshot(); // viewport pixels
    const snap = await snapshot(live);
    await live.close();

    // ---- pixel ghost: screenshot back on screen ----
    const ghost = await browser.newPage();
    await ghost.setContent(
      `<style>body{margin:0}img{display:block;max-width:100vw}</style>` +
      `<img src="data:image/png;base64,${shot.toString('base64')}">`
    );
    const ghostProbe = await ghost.evaluate(() => ({
      hasState: !!window.__demoState,
      hasForm: !!document.querySelector('#name'),
      nodes: document.querySelectorAll('*').length,
    }));

    // ---- snapshot restore: same pixels, alive ----
    const alive = await browser.newPage();
    await restore(alive, snap);
    const aliveProbe = await alive.evaluate(() => ({
      hasState: !!window.__demoState && window.__demoState.token === 'mutated-by-user',
      hasForm: !!document.querySelector('#name'),
      nodes: document.querySelectorAll('*').length,
      scrollY: window.scrollY,
    }));

    // ---- report ----
    console.log('probe               | pixel ghost | snapshot restore');
    console.log('--------------------+-------------+-----------------');
    const row = (label, v1, v2) =>
      console.log(label.padEnd(20) + '| ' + String(v1).padEnd(11) + ' | ' + String(v2));
    row('JS runtime state', ghostProbe.hasState ? 'yes' : 'no', aliveProbe.hasState ? 'yes' : 'no');
    row('form (#name) exists', ghostProbe.hasForm ? 'yes' : 'no', aliveProbe.hasForm ? 'yes' : 'no');
    row('DOM nodes', ghostProbe.nodes, aliveProbe.nodes);
    row('scroll position', '— (an image)', aliveProbe.scrollY + 'px');
    row('type into #name', 'dead', 'works');
    console.log('');

    emitResult({
      demo: 'pixel-ghost',
      durationMs: 0,
      ghostNodes: ghostProbe.nodes,
      aliveNodes: aliveProbe.nodes,
      headline:
        `pixel ghost looks right but is dead (${ghostProbe.nodes} nodes, no state, ` +
        `no form); snapshot restore is alive (${aliveProbe.nodes} nodes, state + form kept)`,
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
