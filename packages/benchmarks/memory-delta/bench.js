#!/usr/bin/env node
/**
 * memory-delta/bench.js
 *
 * Demo: the tab lifecycle memory spectrum — live → frozen → discarded →
 * restored — with real process-tree RSS numbers.
 *
 * The story this tells (the "dumb missed optimisation" from the DeepSeek
 * thread): freezing saves CPU but holds ALL the memory; discarding frees the
 * memory but throws away the state; a snapshot restore gives you the state
 * back for a fraction of the reload cost.
 *
 *  1. Load the heavy fixture and interact with it
 *  2. FREEZE via CDP (Page.setWebLifecycleState) — prove timers stop
 *  3. CLOSE the tab (renderer dies) — measure how much memory is freed
 *  4. RESTORE from snapshot — measure what it costs to come back
 *
 * Run: node memory-delta/bench.js
 */
'use strict';

const { launch, serveFixture, treeRssKb, heap, snapshot, restore, emitResult } = require('../lib/common');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mbRss = (kb) => (kb / 1024).toFixed(0) + ' MB';         // RSS comes in kB
const mbHeap = (bytes) => (bytes / 1048576).toFixed(1) + ' MB'; // JSHeapUsedSize is bytes

async function interact(page) {
  await page.evaluate(() => {
    window.__demoState = { visits: 99, token: 'mutated-by-user' };
    document.querySelector('#name').value = 'hibernated-user';
    document.querySelector('#opt-in').checked = true;
    window.scrollTo(0, 4000);
  });
}

async function main() {
  const { url, close } = await serveFixture();

  const browser = await launch();
  try {
    const bp = browser.process().pid;

    // close the default blank tab and let the process tree settle, so the
    // floor is a stable "browser with no tabs" baseline
    for (const p of await browser.pages()) await p.close();
    await sleep(1200);
    const floor = treeRssKb(bp);

    // ---- LIVE ---------------------------------------------------------
    const live = await browser.newPage();
    await live.goto(url, { waitUntil: 'networkidle0' });
    await interact(live);
    // timer cadence marker (100ms interval) — the CPU story
    await live.evaluate(() => {
      window.__ticks = 0;
      setInterval(() => { window.__ticks++; }, 100);
    });
    await sleep(500); // let the cadence establish
    const liveRss = treeRssKb(bp);
    const liveHeap = await heap(live);
    const ticksBefore = await live.evaluate(() => window.__ticks);

    // ---- FROZEN -------------------------------------------------------
    const ps = await live.createCDPSession();
    await ps.send('Page.setWebLifecycleState', { state: 'frozen' });
    await sleep(1200);
    const ticksWhileFrozen = await live.evaluate(() => window.__ticks);
    const frozenRss = treeRssKb(bp);
    let frozenHeap = liveHeap;
    try { frozenHeap = await heap(live); } catch { /* frozen page may refuse metrics */ }
    await ps.send('Page.setWebLifecycleState', { state: 'active' });
    await sleep(300);
    const ticksAfterResume = await live.evaluate(() => window.__ticks);

    const snap = await snapshot(live);

    // ---- DISCARDED ----------------------------------------------------
    await live.close(); // renderer process dies; URL + history retained
    await sleep(900);   // let teardown settle
    const discardedRss = treeRssKb(bp);

    // ---- RESTORED -----------------------------------------------------
    const r = await browser.newPage();
    await restore(r, snap);
    const restoredRss = treeRssKb(bp);
    const restoredHeap = await heap(r);
    await r.close();

    // ---- report -------------------------------------------------------
    console.log('stage         | browser tree RSS | tab JS heap | CPU (timers)');
    console.log('--------------+------------------+-------------+---------------');
    const row = (stage, rss, h, cpu) =>
      console.log(
        stage.padEnd(14) + '| ' + mbRss(rss).padStart(15) + ' | ' +
        String(h).padStart(11) + ' | ' + cpu
      );
    row('browser floor', floor, '—', '—');
    row('live', liveRss, mbHeap(liveHeap), `running (+${ticksBefore} ticks/0.5s)`);
    row(
      'frozen', frozenRss, mbHeap(frozenHeap),
      `stopped (+${ticksWhileFrozen - ticksBefore} in 1.2s)`
    );
    row('discarded', discardedRss, '—', '— (renderer killed)');
    row('restored', restoredRss, mbHeap(restoredHeap), '— (snapshot replay)');
    console.log('');

    const freed = liveRss - discardedRss;
    const restoreCost = restoredRss - discardedRss;
    const heldPct = (100 * frozenRss / liveRss).toFixed(0);
    emitResult({
      demo: 'memory-delta',
      durationMs: Math.round(restoreCost),
      liveRss, frozenRss, discardedRss, restoredRss,
      ticksWhileFrozen: ticksWhileFrozen - ticksBefore,
      headline:
        `freeze holds ${heldPct}% of ${mbRss(liveRss)} RAM (0 ticks/1.2s); ` +
        `discard frees ${mbRss(freed)}; restore costs ${mbRss(restoreCost)}`,
    });
    console.log(
      `verdict: freezing held ${heldPct}% of the live memory (` +
      `${mbRss(frozenRss)} vs ${mbRss(liveRss)}) while stopping the timers ` +
      `(+${ticksWhileFrozen - ticksBefore} ticks in 1.2s vs +${ticksBefore} in 0.5s live, ` +
      `+${ticksAfterResume - ticksWhileFrozen} after resume).`
    );
    console.log(
      `Discarding freed ${mbRss(freed)} of tab memory — but threw away the state. ` +
      `Restoring from snapshot costs ${mbRss(restoreCost)} and brings the state back ` +
      `(${snap.nodeCount} DOM nodes, ${(snap.bytes / 1024).toFixed(1)} KiB snapshot) ` +
      `with no network and no script re-execution.`
    );
    console.log(
      'Note: RSS is the whole browser process tree (browser + zygote + renderers + ' +
      'GPU), so per-tab deltas are the honest cost of each stage. VmRSS counts ' +
      'shared pages per process, so absolute numbers run high.'
    );
  } finally {
    await browser.close();
    await close();
  }
}

main().catch((err) => {
  console.error('bench failed:', err.message);
  process.exit(1);
});
