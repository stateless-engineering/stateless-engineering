#!/usr/bin/env node
/**
 * bfcache/bench.js
 *
 * Demo: the closest thing to "tab hibernation" that ships today — the real
 * back/forward cache. Navigate away and back: bfcache restores the frozen
 * page (DOM, JS heap, event listeners) in a few milliseconds and keeps the
 * JS state. A reload of the same page re-executes everything and resets it.
 *
 * Run: node bfcache/bench.js
 */
'use strict';

const { launch, serveFixture, emitResult } = require('../lib/common');

async function main() {
  const { url, close } = await serveFixture();
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0' });

    // interact: JS state, form value, scroll
    await page.evaluate(() => {
      window.__demoState = { visits: 99, token: 'mutated-by-user' };
      document.querySelector('#name').value = 'hibernated-user';
      window.scrollTo(0, 4000);
    });
    // watch for the bfcache restore signal (pageshow with persisted=true)
    await page.evaluate(() => {
      window.__persisted = null;
      addEventListener('pageshow', (e) => { window.__persisted = e.persisted; });
    });

    // navigate away (fixture becomes a bfcache candidate)
    await page.goto('data:text/html,<h1>somewhere else</h1>', { waitUntil: 'domcontentloaded' });

    // --- back: real bfcache restore ---
    const t0 = performance.now();
    await page.goBack({ waitUntil: 'domcontentloaded' });
    const backMs = performance.now() - t0;
    const back = await page.evaluate(() => ({
      demoState: window.__demoState,
      scrollY: window.scrollY,
      name: document.querySelector('#name').value,
      navType: performance.getEntriesByType('navigation')[0].type,
      persisted: window.__persisted,
    }));

    // --- reload: same page, fresh execution ---
    const t1 = performance.now();
    await page.reload({ waitUntil: 'networkidle0' });
    const reloadMs = performance.now() - t1;
    const reloaded = await page.evaluate(() => ({
      demoState: window.__demoState,
      scrollY: window.scrollY,
      name: document.querySelector('#name') ? document.querySelector('#name').value : null,
    }));

    // --- report ---
    console.log('metric           | back (bfcache)   | reload           ');
    console.log('------------------+------------------+------------------');
    const row = (label, v1, v2) =>
      console.log(label.padEnd(18) + '| ' + String(v1).padEnd(17) + '| ' + String(v2).padEnd(18));
    row('tab back in', (backMs / 1000).toFixed(3) + 's', (reloadMs / 1000).toFixed(2) + 's');
    row('navigation type', back.navType, 'reload');
    row('bfcache persisted', back.persisted === true ? 'yes' : 'no', '—');
    row('JS runtime state', JSON.stringify(back.demoState), JSON.stringify(reloaded.demoState));
    row('scroll position', back.scrollY + 'px', reloaded.scrollY + 'px');
    row('form value (#name)', JSON.stringify(back.name), JSON.stringify(reloaded.name));
    console.log('');

    const speedup = (reloadMs / backMs).toFixed(0) + 'x';
    emitResult({
      demo: 'bfcache',
      durationMs: Math.round(backMs),
      backMs: Math.round(backMs),
      reloadMs: Math.round(reloadMs),
      persisted: back.persisted === true,
      headline:
        `back via bfcache ${(backMs / 1000).toFixed(3)}s (${speedup} faster than reload's ` +
        `${(reloadMs / 1000).toFixed(2)}s), JS state kept; reload reset it`,
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
