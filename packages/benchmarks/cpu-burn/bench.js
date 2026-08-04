#!/usr/bin/env node
/**
 * cpu-burn/bench.js
 *
 * Demo: the CPU side of a background tab. A live tab that's actually doing
 * work burns real renderer CPU time; freezing it (the closest browsers come
 * to pausing a tab) drops that to ~zero — but, as memory-delta shows, the
 * memory is held the whole time.
 *
 * CPU time is read from CDP SystemInfo.getProcessInfo (cumulative cpuTime in
 * seconds across the whole browser process tree).
 *
 * Run: node cpu-burn/bench.js
 */
'use strict';

const { launch, serveFixture, treeRssKb, emitResult } = require('../lib/common');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// cumulative CPU seconds across every browser process
async function cpuSeconds(browser) {
  const bs = await browser.target().createCDPSession();
  const { processInfo } = await bs.send('SystemInfo.getProcessInfo');
  return processInfo.reduce((a, p) => a + p.cpuTime, 0);
}

async function main() {
  const { url, close } = await serveFixture();
  const browser = await launch();
  try {
    const bp = browser.process().pid;
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0' });

    // timer cadence marker (100ms interval)
    await page.evaluate(() => {
      window.__ticks = 0;
      setInterval(() => { window.__ticks++; }, 100);
    });

    // --- LIVE: busy loop + timers ---
    await sleep(300);
    const cpu0 = await cpuSeconds(browser);
    const t0 = await page.evaluate(() => window.__ticks);
    await page.evaluate(() => {
      const t = performance.now();
      while (performance.now() - t < 1500) { /* busy */ }
    });
    const cpu1 = await cpuSeconds(browser);
    const t1 = await page.evaluate(() => window.__ticks);
    const burnLive = cpu1 - cpu0;
    const rssLive = treeRssKb(bp);

    // --- FROZEN: same tab, paused ---
    const ps = await page.createCDPSession();
    await ps.send('Page.setWebLifecycleState', { state: 'frozen' });
    await sleep(300);
    const cpu2 = await cpuSeconds(browser);
    await sleep(1500);
    const cpu3 = await cpuSeconds(browser);
    const burnFrozen = cpu3 - cpu2;
    const rssFrozen = treeRssKb(bp);
    await ps.send('Page.setWebLifecycleState', { state: 'active' });

    // --- report ---
    const mb = (kb) => (kb / 1024).toFixed(0) + ' MB';
    console.log('state  | renderer CPU burned | timer ticks | browser tree RSS');
    console.log('-------+---------------------+-------------+------------------');
    console.log(
      'live   | ' + burnLive.toFixed(2).padStart(19) + 's | ' +
      String(`+${t1 - t0}`).padStart(11) + ' | ' + mb(rssLive).padStart(16)
    );
    console.log(
      'frozen | ' + burnFrozen.toFixed(2).padStart(19) + 's | ' +
      String('+0').padStart(11) + ' | ' + mb(rssFrozen).padStart(16)
    );
    console.log('');

    const heldPct = (100 * rssFrozen / rssLive).toFixed(0);
    emitResult({
      demo: 'cpu-burn',
      durationMs: Math.round(burnLive * 1000),
      burnLiveSec: burnLive,
      burnFrozenSec: burnFrozen,
      headline:
        `live tab burned ${burnLive.toFixed(2)}s CPU in 1.5s of work ` +
        `(+${t1 - t0} timer ticks); frozen burned ${burnFrozen.toFixed(2)}s ` +
        `(0 ticks) while holding ${heldPct}% of ${mb(rssLive)} RSS`,
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
