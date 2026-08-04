#!/usr/bin/env node
/**
 * survival-matrix/bench.js
 *
 * Demo: what survives each way of "getting a tab back"? Browser state lives
 * in different places — some in the page (DOM, JS heap, scroll, forms), some
 * in the profile (cookies, localStorage), some in the tab (sessionStorage).
 * Each recovery path keeps a different subset:
 *
 *   reload       — same tab: cookies, localStorage, sessionStorage survive
 *   new tab      — sessionStorage dies
 *   restart      — only profile state (cookies, localStorage) survives
 *   snapshot     — everything the snapshot captured survives
 *
 * Run: node survival-matrix/bench.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { launch, serveFixture, snapshot, restore, emitResult } = require('../lib/common');

async function seed(page) {
  await page.evaluate(() => {
    document.cookie = 'dcookie=1; path=/; max-age=3600';
    localStorage.setItem('ls', 'yes');
    sessionStorage.setItem('ss', 'yes');
    window.__demoState = { visits: 99, token: 'mutated-by-user' };
    const extra = document.createElement('div');
    extra.id = 'extra-node';
    document.body.appendChild(extra);
    const name = document.querySelector('#name');
    if (name) name.value = 'hibernated-user';
    window.scrollTo(0, 4000);
  });
}

async function probe(page) {
  return page.evaluate(() => {
    let cookie = false;
    try { cookie = (document.cookie || '').includes('dcookie=1'); } catch { /* opaque origin */ }
    return {
      cookie,
      localStorage: (() => { try { return localStorage.getItem('ls') === 'yes'; } catch { return false; } })(),
      sessionStorage: (() => { try { return sessionStorage.getItem('ss') === 'yes'; } catch { return false; } })(),
      scroll: window.scrollY > 3000,
      form: (document.querySelector('#name') || {}).value === 'hibernated-user',
      jsState: !!window.__demoState && window.__demoState.token === 'mutated-by-user',
      domNode: !!document.querySelector('#extra-node'),
    };
  });
}

async function main() {
  // temp profile so cookies/localStorage survive the restart scenario;
  // created per-run and removed in finally (no state left behind)
  const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-profile-'));
  const { url, close } = await serveFixture();
  let b1 = null;
  let b2 = null;
  try {
    // ---- live tab: seed everything, snapshot ----
    b1 = await launch({ userDataDir: PROFILE });
    const p = await b1.newPage();
    await p.goto(url, { waitUntil: 'networkidle0' });
    await seed(p);
    const snap = await snapshot(p);

    // A: reload same tab
    await p.reload({ waitUntil: 'networkidle0' });
    const a = await probe(p);

    // B: new tab, same profile
    const p2 = await b1.newPage();
    await p2.goto(url, { waitUntil: 'networkidle0' });
    const b = await probe(p2);

    // C: full browser restart, same profile
    await b1.close();
    b1 = null;
    b2 = await launch({ userDataDir: PROFILE });
    const p3 = await b2.newPage();
    await p3.goto(url, { waitUntil: 'networkidle0' });
    const c = await probe(p3);

    // D: snapshot restore — navigate to the URL first so the page has the
    // fixture origin (cookies/localStorage readable), then replay the
    // snapshot on top (DOM, scroll, form, JS state all from the snapshot)
    const p4 = await b2.newPage();
    await p4.goto(url, { waitUntil: 'networkidle0' });
    await restore(p4, snap);
    const d = await probe(p4);

    // ---- report ----
    const names = { cookie: 'cookie', localStorage: 'localStorage', sessionStorage: 'sessionStorage', scroll: 'scroll pos', form: 'form value', jsState: 'JS state', domNode: 'DOM node' };
    console.log('survival matrix   | reload | new tab | restart | snapshot');
    console.log('------------------+--------+---------+---------+----------');
    for (const [key, label] of Object.entries(names)) {
      const vals = { a: a[key], b: b[key], c: c[key], d: d[key] };
      console.log(
        label.padEnd(18) + '| ' +
        (vals.a ? 'yes' : ' no').padEnd(6) + ' | ' +
        (vals.b ? 'yes' : ' no').padEnd(7) + ' | ' +
        (vals.c ? 'yes' : ' no').padEnd(7) + ' | ' +
        (vals.d ? 'yes' : ' no')
      );
    }
    console.log('');

    emitResult({
      demo: 'survival-matrix',
      durationMs: 0,
      reload: a, newTab: b, restart: c, snapshot: d,
      headline:
        `reload keeps ${Object.values(a).filter(Boolean).length}/7, new tab ${Object.values(b).filter(Boolean).length}/7, ` +
        `restart ${Object.values(c).filter(Boolean).length}/7, snapshot ${Object.values(d).filter(Boolean).length}/7`,
    });
  } finally {
    if (b1) await b1.close();
    if (b2) await b2.close();
    await close();
    fs.rmSync(PROFILE, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('bench failed:', err.message);
  process.exit(1);
});
