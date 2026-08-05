'use strict';
/**
 * actions.test.js — the flow Action's decision logic (issue #7), tested with
 * synthetic issue/event payloads. No network, no gh.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const lib = require('../actions/lib.js');

const issue = (over = {}) => ({
  number: 1,
  title: '[feature] thing',
  body: '## Problem\nx\n## Proposed fix\ny\n### Acceptance criteria\n- [ ] z',
  labels: [{ name: 'type/feature' }, { name: 'priority/p2' }],
  state: 'open',
  ...over,
});

// ── opened ────────────────────────────────────────────────────────────────

test('opened: fully-typed ticket yields no actions', () => {
  assert.deepStrictEqual(lib.onOpened(issue()), []);
});

test('opened: untyped ticket gets hygiene comment + default priority', () => {
  const acts = lib.onOpened(issue({ labels: [], title: 'no prefix' }));
  assert.ok(acts.some((a) => a.op === 'label' && a.name === 'priority/p2'));
  assert.ok(acts.some((a) => a.op === 'comment' && /type\/\*/.test(a.body)));
});

test('opened: feature without acceptance gets hygiene comment', () => {
  const acts = lib.onOpened(issue({ body: 'no acceptance here' }));
  assert.ok(acts.some((a) => a.op === 'comment' && /acceptance/i.test(a.body)));
});

test('opened: typed non-feature without acceptance is fine (bug carries repro)', () => {
  const acts = lib.onOpened(issue({
    title: '[bug] crash',
    labels: [{ name: 'type/bug' }, { name: 'priority/p2' }],
    body: '## Observed\nx\n## Expected\ny\n## Reproduction\nsteps',
  }));
  assert.ok(!acts.some((a) => a.op === 'comment' && /acceptance/i.test(a.body)));
});

// ── labeled / unlabeled ───────────────────────────────────────────────────

test('labeled: status/ready announces the transition', () => {
  assert.deepStrictEqual(lib.onLabeled(issue(), 'status/ready'), [
    { op: 'comment', body: '→ **ready**' },
  ]);
});

test('labeled: unrelated label is ignored', () => {
  assert.deepStrictEqual(lib.onLabeled(issue(), 'area/runtime'), []);
});

test('labeled: feature typed later without acceptance still warns', () => {
  const acts = lib.onLabeled(issue({ body: 'no acceptance' }), 'type/feature');
  assert.ok(acts.some((a) => a.op === 'comment' && /acceptance/i.test(a.body)));
});

test('unlabeled: removing type/* warns', () => {
  const acts = lib.onUnlabeled(issue(), 'type/feature');
  assert.ok(acts.some((a) => a.op === 'comment' && /type\/\*/.test(a.body)));
});

test('unlabeled: removing a priority label is ignored', () => {
  assert.deepStrictEqual(lib.onUnlabeled(issue(), 'priority/p2'), []);
});

// ── assigned ──────────────────────────────────────────────────────────────

test('assigned from ready advances to in-progress', () => {
  const acts = lib.onAssigned(issue({ labels: [{ name: 'status/ready' }] }), 'grave0x');
  assert.deepStrictEqual(acts, [
    { op: 'label', name: 'status/in-progress' },
    { op: 'comment', body: 'claimed by @grave0x — → in-progress' },
  ]);
});

test('assigned from triage warns, does not advance', () => {
  const acts = lib.onAssigned(issue({ labels: [] }), 'grave0x');
  assert.strictEqual(acts.length, 1);
  assert.strictEqual(acts[0].op, 'comment');
  assert.ok(/triage/.test(acts[0].body));
});

test('assigned while in-progress or review is a no-op', () => {
  assert.deepStrictEqual(lib.onAssigned(issue({ labels: [{ name: 'status/review' }] }), 'grave0x'), []);
});

// ── closed ────────────────────────────────────────────────────────────────

test('closed from review without lgtm or PR is blocked (reopen + fail)', () => {
  const acts = lib.onClosed(issue({ labels: [{ name: 'status/review' }] }), {
    comments: [{ user: { login: 'other' }, body: 'almost there' }],
    prMerged: false,
  });
  assert.ok(acts.some((a) => a.op === 'reopen'));
  assert.ok(acts.some((a) => a.op === 'fail'));
  assert.ok(acts.some((a) => a.op === 'comment' && /close blocked/.test(a.body)));
});

test('closed from review with reviewer lgtm is allowed', () => {
  const comments = [
    { user: { login: 'rev' }, body: 'review requested: @rev' },
    { user: { login: 'rev' }, body: 'lgtm' },
  ];
  assert.deepStrictEqual(
    lib.onClosed(issue({ labels: [{ name: 'status/review' }] }), { comments, prMerged: false }),
    [],
  );
});

test('closed from review with merged PR is allowed', () => {
  const acts = lib.onClosed(issue({ labels: [{ name: 'status/review' }] }), {
    comments: [{ user: { login: 'x' }, body: 'closes #1' }],
    prMerged: true,
  });
  assert.deepStrictEqual(acts, []);
});

test('closed from ready with resolution comment is allowed', () => {
  const acts = lib.onClosed(issue({ labels: [{ name: 'status/ready' }] }), {
    comments: [{ user: { login: 'x' }, body: 'Resolution: wontfix' }],
    prMerged: false,
  });
  assert.deepStrictEqual(acts, []);
});

test('bot text mentioning "resolution" does NOT count as a resolution', () => {
  const acts = lib.onClosed(issue({ labels: [{ name: 'status/ready' }] }), {
    comments: [{ user: { login: 'x' }, body: 'closed from ready without a resolution comment or the review step. Reopening.' }],
    prMerged: false,
  });
  assert.ok(acts.some((a) => a.op === 'reopen'));
});

test('closed from ready without resolution is reopened', () => {
  const acts = lib.onClosed(issue({ labels: [{ name: 'status/ready' }] }), {
    comments: [],
    prMerged: false,
  });
  assert.ok(acts.some((a) => a.op === 'reopen'));
  assert.ok(acts.some((a) => a.op === 'fail'));
  assert.ok(acts.some((a) => a.op === 'comment' && /closed from \*\*ready\*\*/.test(a.body)));
});

test('closed from triage (no status label) without resolution is reopened', () => {
  const acts = lib.onClosed(issue({ labels: [{ name: 'type/feature' }] }), {
    comments: [],
    prMerged: false,
  });
  assert.ok(acts.some((a) => a.op === 'reopen'));
});

// ── closed-event shape (regression): GitHub sends state:"closed", so the
// pre-close state must come from the status label, not flow.stateOf ────────

const closedEvent = (labels, comments = [], prMerged = false) =>
  lib.onClosed(issue({ state: 'closed', labels }), { comments, prMerged });

test('closed event from review without lgtm/pr is blocked', () => {
  const acts = closedEvent([{ name: 'status/review' }], [{ user: { login: 'x' }, body: 'almost' }]);
  assert.ok(acts.some((a) => a.op === 'reopen'));
  assert.ok(acts.some((a) => a.op === 'fail'));
  assert.ok(acts.some((a) => a.op === 'comment' && /close blocked/.test(a.body)));
});

test('closed event from review with reviewer lgtm is allowed', () => {
  const comments = [
    { user: { login: 'rev' }, body: 'review requested: @rev' },
    { user: { login: 'rev' }, body: 'lgtm' },
  ];
  assert.deepStrictEqual(closedEvent([{ name: 'status/review' }], comments), []);
});

test('closed event from triage reports triage, not done', () => {
  const acts = closedEvent([{ name: 'type/feature' }], []);
  assert.ok(acts.some((a) => a.op === 'comment' && /closed from \*\*triage\*\*/.test(a.body)));
});
