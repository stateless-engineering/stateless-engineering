#!/usr/bin/env node
/**
 * tab-spray/bench.js
 *
 * Demo: the optimization at scale. Eight heavy tabs loaded simultaneously is
 * the real-world memory problem — measure the RSS growth, then exercise the
 * two levers browsers have: discard (free the memory, lose the state) and
 * snapshot restore (bring the state back for a fraction of the reload cost).
 *
 * Run: node tab-spray/bench.js
 */
'use strict';

const { launch, serveFixture, treeRssKb, snapshot, restore, emitResult } = require('../lib/common');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (kb) => (kb / 1024).toFixed(0) + ' MB';

const N = 8;

async function main() {
  const { url, close } = await serveFixture();
  const browser = await launch();
  try {
    const bp = browser.process().pid;
    for (const p of await browser.pages()) await p.close();
    await sleep(1000);
    const floor = treeRssKb(bp);

    // open N tabs of the fixture
    const tabs = [];
    for (let i = 0; i < N; i++) {
      const p = await browser.newPage();
      await p.goto(url, { waitUntil: 'networkidle0' });
      await p.evaluate(() => { window.__demoState = { tab: location.href, idx: 1 }; });
      tabs.push(p);
    }
    const rssAll = treeRssKb(bp);
    const perTab = (rssAll - floor) / N;

    // snapshot every tab
    const snaps = [];
    for (const p of tabs) snaps.push(await snapshot(p));

    // discard half (close the renderers)
    const kept = tabs.slice(0, N / 2);
    for (const p of tabs.slice(N / 2)) await p.close();
    await sleep(900);
    const rssHalf = treeRssKb(bp);

    // restore the discarded half from snapshots
    for (const s of snaps.slice(N / 2)) {
      const p = await browser.newPage();
      await restore(p, s);
      kept.push(p);
    }
    await sleep(500);
    const rssRestored = treeRssKb(bp);

    // ---- report ----
    console.log(`stage                    | browser tree RSS | vs floor`);
    console.log('-------------------------+------------------+-----------');
    const row = (stage, rss) =>
      console.log(stage.padEnd(25) + '| ' + mb(rss).padStart(15) + ' | ' + (rss - floor >= 0 ? '+' : '') + mb(rss - floor).padStart(8));
    row('floor (0 tabs)', floor);
    row(`${N} tabs live`, rssAll);
    row(`${N / 2} discarded`, rssHalf);
    row(`${N} back (${N / 2} restored)`, rssRestored);
    console.log('');

    const freed = rssAll - rssHalf;
    const restoreCost = rssRestored - rssHalf;
    emitResult({
      demo: 'tab-spray',
      durationMs: 0,
      tabs: N,
      perTabKb: Math.round(perTab),
      rssAll, rssHalf, rssRestored,
      headline:
        `${N} tabs ≈ ${mb(rssAll)} (~${(perTab / 1024).toFixed(1)} MB each); ` +
        `discarding half frees ${mb(freed)}; snapshot-restoring them costs ${mb(restoreCost)}`,
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
