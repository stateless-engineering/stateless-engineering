'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const flow = require('../lib/flow');

// ---- fixtures ----------------------------------------------------------------
const issue = (over = {}) => ({
  number: 1,
  title: '[feature] something',
  state: 'open',
  labels: [],
  assignee: null,
  body: '### Problem\nx\n\n### Acceptance criteria\n- [ ] works',
  created_at: '2026-08-04T00:00:00Z',
  updated_at: '2026-08-04T00:00:00Z',
  html_url: 'https://github.com/stateless-engineering/stateless-engineering/issues/1',
  ...over,
});

const labels = (...names) => ({ labels: names.map((name) => ({ name })) });
const typed = () => issue(labels('type/feature', 'priority/p1', 'status/ready'));

// ---- stateOf -------------------------------------------------------------------
test('stateOf: no status label → triage; status/* → state; closed → done', () => {
  assert.equal(flow.stateOf(issue()), 'triage');
  assert.equal(flow.stateOf(issue(labels('status/ready'))), 'ready');
  assert.equal(flow.stateOf(issue(labels('status/in-progress'))), 'in-progress');
  assert.equal(flow.stateOf(issue(labels('status/review'))), 'review');
  assert.equal(flow.stateOf(issue(labels('status/blocked'))), 'blocked');
  assert.equal(flow.stateOf(issue({ state: 'closed' })), 'done');
  assert.equal(flow.stateOf(issue(labels('status/nonsense'))), 'triage'); // unknown → triage
});

// ---- label extraction -----------------------------------------------------------
test('type/priority/area extracted from labels', () => {
  assert.equal(flow.typeOf(issue(labels('type/bug'))), 'bug');
  assert.equal(flow.priorityOf(issue(labels('priority/p0'))), 'p0');
  assert.equal(flow.areaOf(issue(labels('area/webshell'))), 'webshell');
  assert.equal(flow.typeOf(issue()), null);
  assert.equal(flow.priorityOf(issue()), null);
});

// ---- acceptance -----------------------------------------------------------------
test('hasAcceptance: template heading, explicit marker, and task lists count', () => {
  assert.ok(flow.hasAcceptance('### Acceptance criteria\n- [ ] x'));
  assert.ok(flow.hasAcceptance('**Acceptance:** observable outcome'));
  assert.ok(flow.hasAcceptance('- [ ] ship it'));
  assert.ok(flow.hasAcceptance('  - [x] done item'));
  assert.ok(!flow.hasAcceptance('no criteria here'));
  assert.ok(!flow.hasAcceptance(''));
});

// ---- reviewer / lgtm -------------------------------------------------------------
test('extractReviewer: last "review requested: @u" comment wins; null without', () => {
  const comments = [
    { user: { login: 'a' }, body: 'review requested: @grave0x' },
    { user: { login: 'b' }, body: 'review requested: @alice' },
    { user: { login: 'c' }, body: 'bump' },
  ];
  assert.equal(flow.extractReviewer(comments), 'alice');
  assert.equal(flow.extractReviewer([{ user: { login: 'a' }, body: 'hi' }]), null);
  assert.equal(flow.extractReviewer(null), null);
});

test('hasLgtm: only a comment from the reviewer counts', () => {
  const comments = [
    { user: { login: 'alice' }, body: 'LGTM' },
    { user: { login: 'eve' }, body: 'lgtm' },
  ];
  assert.ok(flow.hasLgtm(comments, 'alice'));
  assert.ok(!flow.hasLgtm(comments, 'bob')); // reviewer never commented
  assert.ok(!flow.hasLgtm([], 'alice'));
});

// ---- transitions: every allowed edge ---------------------------------------------
test('transition table covers the full machine', () => {
  const allowed = flow.allowedTransitions().sort();
  const expected = [
    ['blocked', 'ready'], // unblock
    ['done', 'blocked'], // block (any state)
    ['done', 'ready'], // reopen
    ['in-progress', 'blocked'],
    ['in-progress', 'ready'], // unclaim
    ['in-progress', 'review'],
    ['ready', 'blocked'],
    ['ready', 'in-progress'], // claim
    ['review', 'blocked'],
    ['review', 'done'], // close
    ['triage', 'blocked'],
    ['triage', 'ready'], // triage
  ];
  assert.deepEqual(allowed, expected);
});

test('checkTransition: unknown state / unknown edge → clear error', () => {
  assert.equal(flow.checkTransition('nope', 'ready').ok, false);
  assert.match(flow.checkTransition('nope', 'ready').reason, /unknown state/);
  assert.equal(flow.checkTransition('triage', 'done').ok, false);
  assert.match(flow.checkTransition('triage', 'done').reason, /no transition/);
});

// ---- preconditions ---------------------------------------------------------------
test('triage → ready: requires type + priority + acceptance', () => {
  const ctx = { issue: issue() };
  assert.equal(flow.checkTransition('triage', 'ready', ctx).ok, false); // no type
  assert.match(flow.checkTransition('triage', 'ready', ctx).reason, /type/);
  assert.equal(flow.checkTransition('triage', 'ready', { issue: issue(labels('type/bug')) }).ok, false); // no priority
  assert.equal(
    flow.checkTransition('triage', 'ready', { issue: issue({ ...labels('type/bug', 'priority/p1'), body: 'nothing here' }) }).ok,
    false // no acceptance
  );
  assert.equal(flow.checkTransition('triage', 'ready', { issue: issue(labels('type/bug', 'priority/p1')) }).ok, true);
});

test('claim: ready + unassigned ok; already yours no-op ok; someone else’s → error', () => {
  const ready = typed();
  assert.equal(flow.checkTransition('ready', 'in-progress', { issue: ready, viewer: 'grave0x' }).ok, true);
  assert.equal(
    flow.checkTransition('ready', 'in-progress', { issue: issue({ ...labels('status/ready'), assignee: { login: 'grave0x' } }), viewer: 'grave0x' }).ok,
    true // already mine — CLI no-ops
  );
  const taken = flow.checkTransition('ready', 'in-progress', { issue: issue({ ...labels('status/ready'), assignee: { login: 'alice' } }), viewer: 'grave0x' });
  assert.equal(taken.ok, false);
  assert.match(taken.reason, /assigned to alice/);
});

test('unclaim: in-progress → ready always allowed', () => {
  assert.equal(flow.checkTransition('in-progress', 'ready', { issue: issue(labels('status/in-progress')) }).ok, true);
});

test('review: requires assignee + --reviewer', () => {
  const claimed = issue({ ...labels('status/in-progress'), assignee: { login: 'grave0x' } });
  assert.equal(flow.checkTransition('in-progress', 'review', { issue: issue(labels('status/in-progress')) }).ok, false); // no assignee
  assert.equal(flow.checkTransition('in-progress', 'review', { issue: claimed }).ok, false); // no reviewer
  assert.equal(flow.checkTransition('in-progress', 'review', { issue: claimed, reviewer: 'alice' }).ok, true);
});

test('close: review only; requires PR merged or reviewer lgtm', () => {
  const reviewed = issue(labels('status/review'));
  assert.equal(flow.checkTransition('ready', 'done', { issue: reviewed }).ok, false); // wrong edge
  assert.equal(flow.checkTransition('review', 'done', { issue: reviewed }).ok, false); // neither
  assert.equal(flow.checkTransition('review', 'done', { issue: reviewed, ctx: { prMerged: true } }).ok, true);
  const lgtm = flow.checkTransition('review', 'done', {
    issue: reviewed,
    reviewer: 'alice',
    ctx: { comments: [{ user: { login: 'alice' }, body: 'LGTM' }] },
  });
  assert.equal(lgtm.ok, true);
  const wrongPerson = flow.checkTransition('review', 'done', {
    issue: reviewed,
    reviewer: 'alice',
    ctx: { comments: [{ user: { login: 'eve' }, body: 'lgtm' }] },
  });
  assert.equal(wrongPerson.ok, false);
});

test('block: any state, reason required; unblock: blocked → ready', () => {
  for (const from of ['triage', 'ready', 'in-progress', 'review', 'blocked', 'done']) {
    assert.equal(flow.checkTransition(from, 'blocked', { issue: issue(), reason: 'waiting on CI' }).ok, true, `${from} → blocked`);
    assert.equal(flow.checkTransition(from, 'blocked', { issue: issue() }).ok, false, `${from} → blocked without reason`);
  }
  assert.equal(flow.checkTransition('blocked', 'ready', { issue: issue(labels('status/blocked')) }).ok, true);
  assert.equal(flow.checkTransition('ready', 'ready', { issue: issue() }).ok, false); // no self-loop
});

test('reopen: done → ready', () => {
  assert.equal(flow.checkTransition('done', 'ready', { issue: issue({ state: 'closed' }) }).ok, true);
  assert.equal(flow.checkTransition('done', 'in-progress', { issue: issue({ state: 'closed' }) }).ok, false);
});

test('idempotency: same invalid transition twice → same error', () => {
  const ctx = { issue: issue() };
  const a = flow.checkTransition('triage', 'ready', ctx);
  const b = flow.checkTransition('triage', 'ready', ctx);
  assert.equal(a.ok, b.ok);
  assert.equal(a.reason, b.reason);
});

// ---- deterministic sort -----------------------------------------------------------
test('sort: priority → created → number, deterministic and stable', () => {
  const mk = (number, priority, created) => issue({ ...labels(priority ? `priority/${priority}` : ''), number, created_at: created });
  const input = [
    mk(9, 'p1', '2026-08-02T00:00:00Z'),
    mk(3, 'p0', '2026-08-03T00:00:00Z'),
    mk(1, 'p2', '2026-08-01T00:00:00Z'),
    mk(2, null, '2026-08-01T00:00:00Z'), // missing priority → sorts as p2
    mk(5, 'p1', '2026-08-02T00:00:00Z'),
    mk(4, 'p1', '2026-08-02T00:00:00Z'),
    mk(7, 'p3', '2026-08-01T00:00:00Z'),
  ];
  const out = flow.sortTickets(input).map((i) => i.number);
  assert.deepEqual(out, [3, 4, 5, 9, 1, 2, 7]);
  // determinism: same input twice, shuffled input, same output
  const again = flow.sortTickets([...input].reverse()).map((i) => i.number);
  assert.deepEqual(again, out);
  assert.deepEqual(flow.sortTickets(input).map((i) => i.number), out);
});

test('sort: created asc tie-break by number asc', () => {
  const mk = (number, created) => issue({ ...labels('priority/p2'), number, created_at: created });
  const out = flow.sortTickets([mk(20, '2026-08-01T00:00:00Z'), mk(10, '2026-08-01T00:00:00Z')]).map((i) => i.number);
  assert.deepEqual(out, [10, 20]);
});

// ---- normalizer --------------------------------------------------------------------
test('normalize: stable schema from a GitHub issue + comments', () => {
  const src = issue({
    ...labels('type/feature', 'priority/p1', 'area/ticket', 'status/review'),
    assignee: { login: 'grave0x' },
    created_at: '2026-08-04T10:00:00Z',
    updated_at: '2026-08-05T11:00:00Z',
  });
  const comments = [{ user: { login: 'grave0x' }, body: 'review requested: @alice' }];
  assert.deepEqual(flow.normalize(src, comments), {
    number: 1,
    title: '[feature] something',
    type: 'feature',
    priority: 'p1',
    area: 'ticket',
    status: 'review',
    assignee: 'grave0x',
    reviewer: 'alice',
    createdAt: '2026-08-04T10:00:00Z',
    updatedAt: '2026-08-05T11:00:00Z',
    url: 'https://github.com/stateless-engineering/stateless-engineering/issues/1',
    acceptance: true,
  });
});

test('normalize: untyped ticket → nulls, triage, no assignee', () => {
  const n = flow.normalize(issue({ body: 'plain' }));
  assert.equal(n.type, null);
  assert.equal(n.priority, null);
  assert.equal(n.area, null);
  assert.equal(n.status, 'triage');
  assert.equal(n.assignee, null);
  assert.equal(n.reviewer, null);
  assert.equal(n.acceptance, false);
});

test('labelOf: status label per state, null for triage/done', () => {
  assert.equal(flow.labelOf('ready'), 'status/ready');
  assert.equal(flow.labelOf('blocked'), 'status/blocked');
  assert.equal(flow.labelOf('triage'), null);
  assert.equal(flow.labelOf('done'), null);
});
