#!/usr/bin/env node
/**
 * flow.js — the ticket state machine, pure and zero-dep.
 *
 * The ticket model (docs/specs/stateless-tickets.md): a ticket is a GitHub
 * issue; state is *derived* from `status/*` labels (no status label and open
 *  = triage; closed = done). This module is the shared contract the CLI and
 * the flow Action both implement — every transition, the deterministic sort,
 * and the stable `--json` normalizer. It performs no I/O: callers feed it
 * GitHub API objects and receive decisions.
 *
 * Stateless: a pure function of (argv, repo state) → (output, transitions).
 * Same inputs → same outputs → same exit code.
 */
'use strict';

// ---- states ----------------------------------------------------------------
const STATES = ['triage', 'ready', 'in-progress', 'review', 'blocked', 'done'];

// label applied to mark each non-terminal state (triage = absence, done = closed)
const STATUS_LABEL = {
  ready: 'status/ready',
  'in-progress': 'status/in-progress',
  review: 'status/review',
  blocked: 'status/blocked',
};

const labelOf = (state) => STATUS_LABEL[state] || null;

// derive a ticket's state from a GitHub issue object
function stateOf(issue) {
  if (!issue || issue.state === 'closed') return 'done';
  const status = (issue.labels || []).find((l) => typeof l === 'string' ? l.startsWith('status/') : (l.name || '').startsWith('status/'));
  if (!status) return 'triage';
  const name = typeof status === 'string' ? status : status.name;
  return STATES.includes(name.slice('status/'.length)) ? name.slice('status/'.length) : 'triage';
}

// ---- labels ----------------------------------------------------------------
const labelValue = (issue, prefix) => {
  const hit = (issue.labels || []).find((l) => {
    const name = typeof l === 'string' ? l : (l.name || '');
    return name.startsWith(prefix);
  });
  if (!hit) return null;
  const name = typeof hit === 'string' ? hit : hit.name;
  return name.slice(prefix.length) || null;
};

const typeOf = (issue) => labelValue(issue, 'type/');
const priorityOf = (issue) => labelValue(issue, 'priority/');
const areaOf = (issue) => labelValue(issue, 'area/');

const TYPES = ['bug', 'feature', 'security', 'chore'];
const PRIORITIES = ['p0', 'p1', 'p2', 'p3'];
const PRIORITY_RANK = { p0: 0, p1: 1, p2: 2, p3: 3 };
const DEFAULT_PRIORITY = 'p2'; // org default (Action-applied on open)

// ---- acceptance ------------------------------------------------------------
// The feature template renders "### Acceptance criteria"; bugs carry
// observed/expected/repro instead, so a markdown task list also counts.
const ACCEPTANCE_RE = /acceptance\s*criteria|acceptance\s*:|- \[[ x]\]/im;

function hasAcceptance(body) {
  return typeof body === 'string' && ACCEPTANCE_RE.test(body);
}

// ---- reviewer / lgtm (review ack lives in comments) -------------------------
const REVIEW_REQ_RE = /review requested:?\s*@?([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)/i;

// last "review requested: @u" comment wins
function extractReviewer(comments) {
  if (!Array.isArray(comments)) return null;
  let reviewer = null;
  for (const c of comments) {
    const m = (c.body || '').match(REVIEW_REQ_RE);
    if (m) reviewer = m[1];
  }
  return reviewer;
}

function hasLgtm(comments, reviewer) {
  if (!reviewer || !Array.isArray(comments)) return false;
  return comments.some(
    (c) => (c.user && c.user.login === reviewer) && /lgtm/i.test(c.body || '')
  );
}

// ---- transitions ------------------------------------------------------------
// transitions[from][to] → precondition check. check returns { ok:true } or
// { ok:false, reason } — callers map `ok` to exit codes and messages.
const transitions = {
  triage: {
    ready: ({ issue }) => {
      if (!typeOf(issue)) return 'triage requires a type/* label (bug|feature|security|chore)';
      if (!priorityOf(issue)) return 'triage requires a priority/* label (p0|p1|p2|p3)';
      if (!hasAcceptance(issue.body)) return 'triage requires acceptance criteria in the body';
      return null;
    },
    blocked: ({ reason }) => (reason ? null : 'block requires a reason'),
  },
  ready: {
    'in-progress': ({ issue, viewer }) => {
      // Already mine → legal no-op (idempotency contract), even when the
      // ticket predates the triage gates.
      if (issue.assignee && issue.assignee.login) {
        if (issue.assignee.login === viewer) return null;
        return `assigned to ${issue.assignee.login}`;
      }
      if (!typeOf(issue)) return 'claim requires type/*';
      if (!priorityOf(issue)) return 'claim requires priority/*';
      if (!hasAcceptance(issue.body)) return 'claim requires acceptance criteria in the body';
      return null;
    },
    blocked: ({ reason }) => (reason ? null : 'block requires a reason'),
  },
  'in-progress': {
    ready: () => null, // unclaim — assignee cleared, back to ready
    review: ({ issue, reviewer }) => {
      if (!issue.assignee || !issue.assignee.login) return 'review requires an assignee (claim first)';
      if (!reviewer) return 'review requires --reviewer @user';
      return null;
    },
    blocked: ({ reason }) => (reason ? null : 'block requires a reason'),
  },
  review: {
    done: ({ reviewer, ctx }) => {
      if (ctx.prMerged) return null;
      if (hasLgtm(ctx.comments, reviewer)) return null;
      return 'close requires the linked PR merged or an lgtm comment from the reviewer';
    },
    blocked: ({ reason }) => (reason ? null : 'block requires a reason'),
  },
  blocked: {
    ready: () => null, // unblock — reason was recorded at block time
  },
  done: {
    ready: () => null, // reopen
    blocked: ({ reason }) => (reason ? null : 'block requires a reason'),
  },
};

// checkTransition(from, to, ctx) → { ok } | { ok:false, reason }
function checkTransition(from, to, ctx = {}) {
  if (!transitions[from]) return { ok: false, reason: `unknown state: ${from}` };
  // Idempotent re-block: blocked → blocked is a legal no-op (reason still
  // required). The machine table has no self-loops; the block verb is the
  // one idempotent repeat.
  if (from === 'blocked' && to === 'blocked') {
    return ctx.reason ? { ok: true } : { ok: false, reason: 'block requires a reason' };
  }
  if (!transitions[from][to]) return { ok: false, reason: `no transition ${from} → ${to}` };
  // Top-level fields are flattened for the precondition; nested `ctx` carries
  // verb-specific extras (prMerged, comments for close, ...).
  const fail = transitions[from][to]({
    issue: ctx.issue || {},
    viewer: ctx.viewer || null,
    reviewer: ctx.reviewer || null,
    reason: ctx.reason,
    ctx: ctx.ctx || {},
  });
  return fail ? { ok: false, reason: fail } : { ok: true };
}

// every allowed (from, to) pair, for tests and the Action's validation
function allowedTransitions() {
  const out = [];
  for (const from of Object.keys(transitions))
    for (const to of Object.keys(transitions[from])) out.push([from, to]);
  return out;
}

// ---- deterministic sort ------------------------------------------------------
// priority order (p0 < p1 < p2 < p3) → created_at asc → number asc.
// Missing priority sorts as the org default (p2). Total, stable comparator.
function sortTickets(tickets) {
  return [...tickets].sort((a, b) => {
    const pa = PRIORITY_RANK[priorityOf(a)] ?? PRIORITY_RANK[DEFAULT_PRIORITY];
    const pb = PRIORITY_RANK[priorityOf(b)] ?? PRIORITY_RANK[DEFAULT_PRIORITY];
    if (pa !== pb) return pa - pb;
    const ca = Date.parse(a.created_at || '') || 0;
    const cb = Date.parse(b.created_at || '') || 0;
    if (ca !== cb) return ca - cb;
    return a.number - b.number;
  });
}

// ---- normalizer (API → stable --json schema) ---------------------------------
function normalize(issue, comments) {
  return {
    number: issue.number,
    title: issue.title,
    type: typeOf(issue),
    priority: priorityOf(issue),
    area: areaOf(issue),
    status: stateOf(issue),
    assignee: issue.assignee && issue.assignee.login ? issue.assignee.login : null,
    reviewer: extractReviewer(comments),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    url: issue.html_url,
    acceptance: hasAcceptance(issue.body),
  };
}

module.exports = {
  STATES,
  STATUS_LABEL,
  TYPES,
  PRIORITIES,
  PRIORITY_RANK,
  DEFAULT_PRIORITY,
  labelOf,
  stateOf,
  typeOf,
  priorityOf,
  areaOf,
  hasAcceptance,
  extractReviewer,
  hasLgtm,
  transitions,
  checkTransition,
  allowedTransitions,
  sortTickets,
  normalize,
};
