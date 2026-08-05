'use strict';
/**
 * close.test.js — the shared close-enforcement (flow.checkClose), the flow
 * Action's auto-triage, and pr-reconcile's decision logic. All pure; the
 * state machine is the single source these tests pin down.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const flow = require('../lib/flow.js');
const lib = require('../actions/lib.js');
const pr = require('../actions/pr-lib.js');

const issue = (over = {}) => ({
  number: 1,
  title: '[feature] thing',
  body: '## Problem\nx\n## Proposed fix\ny\n### Acceptance criteria\n- [ ] z',
  labels: [{ name: 'type/feature' }, { name: 'priority/p2' }],
  state: 'open',
  ...over,
});

// ── checkClose (shared enforcement) ────────────────────────────────────────

test('checkClose: review + reviewer lgtm is allowed', () => {
  const comments = [
    { user: { login: 'rev' }, body: 'review requested: @rev' },
    { user: { login: 'rev' }, body: 'lgtm' },
  ];
  assert.ok(flow.checkClose(issue({ labels: [{ name: 'status/review' }] }), { comments }).ok);
});

test('checkClose: review + merged PR is allowed (closed-event shape)', () => {
  const ok = flow.checkClose(issue({ state: 'closed', labels: [{ name: 'status/review' }] }), {
    comments: [{ user: { login: 'x' }, body: 'closes #1' }],
    prMerged: true,
  });
  assert.ok(ok.ok);
});

test('checkClose: review without lgtm or PR is blocked with the gate reason', () => {
  const r = flow.checkClose(issue({ labels: [{ name: 'status/review' }] }), {
    comments: [{ user: { login: 'other' }, body: 'almost' }],
    prMerged: false,
  });
  assert.strictEqual(r.ok, false);
  assert.ok(/review/.test(r.reason));
});

test('checkClose: triage/ready with anchored resolution is allowed', () => {
  assert.ok(flow.checkClose(issue({ labels: [{ name: 'status/ready' }] }), {
    comments: [{ user: { login: 'x' }, body: 'Resolution: wontfix' }],
  }).ok);
});

test('checkClose: triage without resolution is blocked', () => {
  const r = flow.checkClose(issue({ labels: [] }), { comments: [], prMerged: false });
  assert.strictEqual(r.ok, false);
  assert.ok(/closed from triage/.test(r.reason));
});

test('checkClose: bot text mentioning "resolution" does NOT count (regression)', () => {
  const r = flow.checkClose(issue({ labels: [{ name: 'status/ready' }] }), {
    comments: [{ user: { login: 'x' }, body: 'closed from ready without a resolution comment or the review step. Reopening.' }],
  });
  assert.strictEqual(r.ok, false);
});

test('checkClose: a merged-PR close from review flows to the Action as allowed', () => {
  const acts = lib.onClosed(issue({ state: 'closed', labels: [{ name: 'status/review' }] }), {
    comments: [{ user: { login: 'x' }, body: 'closes #1' }],
    prMerged: true,
  });
  assert.deepStrictEqual(acts, []);
});

// ── auto-triage (the machine gate, applied by the flow Action) ─────────────

test('canAutoTriage: typed + prioritized + acceptance passes', () => {
  assert.strictEqual(lib.canAutoTriage(issue()), true);
});

test('canAutoTriage: missing acceptance fails', () => {
  assert.strictEqual(lib.canAutoTriage(issue({ body: 'no acceptance here' })), false);
});

test('canAutoTriage: missing type fails', () => {
  assert.strictEqual(lib.canAutoTriage(issue({ labels: [{ name: 'priority/p2' }] })), false);
});

test('opened with complete gates auto-triages to ready', () => {
  const acts = lib.onOpened(issue());
  assert.ok(acts.some((a) => a.op === 'label' && a.name === 'status/ready'));
});

test('opened without gates does not auto-triage', () => {
  const acts = lib.onOpened(issue({ labels: [], body: 'nope' }));
  assert.ok(!acts.some((a) => a.op === 'label' && a.name === 'status/ready'));
});

test('labeled: adding the last missing gate auto-triages', () => {
  const acts = lib.onLabeled(
    issue({ labels: [{ name: 'type/feature' }, { name: 'priority/p2' }], body: '### Acceptance criteria\n- [ ] x' }),
    'priority/p2',
  );
  assert.ok(acts.some((a) => a.op === 'label' && a.name === 'status/ready'));
});

test('labeled: already-triage-out tickets are not re-advanced', () => {
  const acts = lib.onLabeled(issue({ labels: [{ name: 'status/ready' }, { name: 'type/feature' }, { name: 'priority/p2' }] }), 'priority/p2');
  assert.ok(!acts.some((a) => a.op === 'label' && a.name === 'status/ready'));
});

// ── pr-reconcile (stateless-actions spec) ──────────────────────────────────

test('pr-lib: referencedIssues extracts, dedupes, ignores non-refs', () => {
  const ref = { title: 'feat(#6): ticket CLI', body: 'Closes #5 and #7\nsee #6 and #5' };
  assert.deepStrictEqual(pr.referencedIssues(ref).sort((a, b) => a - b), [5, 6, 7]);
});

test('pr-lib: decide closes a review-state issue (merged PR satisfies the gate)', () => {
  const merged = { number: 42, title: 'fix the thing' };
  const issue42 = issue({ number: 5, labels: [{ name: 'status/review' }] });
  const acts = pr.decide(issue42, merged, { comments: [], prCi: 'ci: green' });
  assert.strictEqual(acts[0].op, 'close');
  assert.ok(/Resolution: fixed in #42/.test(acts[0].body));
  assert.ok(/ci: green/.test(acts[0].body));
});

test('pr-lib: decide only syncs (no close) for a ready-state issue', () => {
  const merged = { number: 42, title: 'fix the thing' };
  const acts = pr.decide(issue({ number: 5, labels: [{ name: 'status/ready' }] }), merged, { comments: [], prCi: null });
  assert.strictEqual(acts[0].op, 'comment');
  assert.ok(!acts.some((a) => a.op === 'close'));
  assert.ok(/still \*\*ready\*\*/.test(acts[0].body));
});
