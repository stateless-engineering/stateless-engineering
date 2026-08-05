'use strict';
/**
 * actions/lib.js — pure decision logic for the flow Action (issue #7).
 * Given an issue event plus live context (comments, PR state), returns a
 * list of actions for the runner to execute. Zero side effects; unit-tested
 * with synthetic events. The state machine lives in ../lib/flow.js — this
 * module only decides *which* hygiene/transition actions to take.
 */
const flow = require('../lib/flow.js');

const TYPE_TITLE_RE = /^\[(bug|feature|security|chore|docs)\]\s/i;

// Pre-close state derived from the status/* label, NOT flow.stateOf —
// on a `closed` event GitHub has already flipped issue.state to "closed",
// which stateOf maps to 'done'. The label is the machine's record of where
// the ticket was when it was closed.
function labelState(issue) {
  const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const status = labels.find((l) => l && l.startsWith('status/'));
  const name = status ? status.slice('status/'.length) : null;
  return name && flow.STATES.includes(name) ? name : 'triage';
}

// Legitimate non-flow closes carry an anchored resolution marker: the CLI
// posts "Resolution: …" on ticket close; maintainers close as wontfix /
// duplicate / not planned. Unanchored matching is a trap — the Action's own
// "closed from X without a resolution comment" text contains the word.
const RESOLUTION_RE =
  /^(resolution\s*:|wontfix|wont fix|duplicate|superseded|not planned|no longer needed|lgtm|fixed by|closes #|fixes #)/im;

function hygieneNeeds(issue) {
  const needs = [];
  if (!flow.typeOf(issue)) {
    needs.push('a type/* label (type/bug, type/feature, type/security, type/chore)');
  }
  if (!TYPE_TITLE_RE.test(issue.title || '')) needs.push('a `[type] ` title prefix');
  if (flow.typeOf(issue) === 'feature' && !flow.hasAcceptance(issue.body)) {
    needs.push('acceptance criteria in the body (### Acceptance criteria)');
  }
  return needs;
}

// ── event handlers ────────────────────────────────────────────────────────

// opened: apply defaults (priority), comment hygiene violations.
function onOpened(issue) {
  const acts = [];
  const needs = hygieneNeeds(issue);
  if (needs.length) {
    acts.push({
      op: 'comment',
      body:
        `**ticket hygiene:** missing ${needs.join('; ')}.\n\n` +
        'The ticket flow needs a `type/*` label (and priority) to leave triage — ' +
        'see docs/specs/stateless-tickets.md. Fix with `ticket triage` or the GitHub UI.',
    });
  }
  if (!flow.priorityOf(issue)) {
    acts.push({ op: 'label', name: `priority/${flow.DEFAULT_PRIORITY}` });
  }
  return acts;
}

// labeled: announce status transitions; re-check acceptance for features.
function onLabeled(issue, labelName) {
  const acts = [];
  if (labelName && labelName.startsWith('status/')) {
    const state = labelName.slice('status/'.length);
    if (flow.STATES.includes(state) && state !== 'triage') {
      acts.push({ op: 'comment', body: `→ **${state}**` });
    }
  }
  if (labelName && labelName.startsWith('type/')) {
    const type = labelName.slice('type/'.length);
    if (type === 'feature' && !flow.hasAcceptance(issue.body)) {
      acts.push({
        op: 'comment',
        body: '**ticket hygiene:** `type/feature` requires acceptance criteria in the body (### Acceptance criteria).',
      });
    }
  }
  return acts;
}

// unlabeled: a removed type/* label breaks the machine.
function onUnlabeled(issue, labelName) {
  if (labelName && labelName.startsWith('type/')) {
    return [{
      op: 'comment',
      body: `**ticket hygiene:** removed ${labelName} — the ticket flow requires a type/* label (see docs/specs/stateless-tickets.md).`,
    }];
  }
  return [];
}

// assigned: assignment from ready = claim (ready → in-progress). Assignment
// while in triage warns without advancing (the gates still apply).
function onAssigned(issue, assigneeLogin) {
  const state = flow.stateOf(issue);
  if (state === 'ready') {
    return [
      { op: 'label', name: flow.STATUS_LABEL['in-progress'] },
      { op: 'comment', body: `claimed by @${assigneeLogin} — → in-progress` },
    ];
  }
  if (state === 'triage') {
    return [{
      op: 'comment',
      body:
        `assigned to @${assigneeLogin} while in triage — run \`ticket triage #${issue.number}\` ` +
        '(needs type/*, priority/*, acceptance) before claiming.',
    }];
  }
  return [];
}

// closed: enforce the machine. From review → require PR-merged or reviewer
// lgtm. From anywhere else → require a resolution comment, else reopen.
function onClosed(issue, { comments = [], prMerged = false } = {}) {
  const state = labelState(issue);
  const reviewer = flow.extractReviewer(comments);

  if (state === 'review') {
    const ok = flow.checkTransition('review', 'done', {
      issue,
      reviewer,
      ctx: { comments, prMerged },
    });
    if (ok.ok) return [];
    return [
      {
        op: 'comment',
        body:
          `**close blocked:** ${ok.reason}. Reopening — resolve via the flow ` +
          `(merge the linked PR, or \`ticket review #${issue.number}\` + reviewer lgtm).`,
      },
      { op: 'reopen' },
      { op: 'fail' },
    ];
  }

  const resolution = comments.some((c) => RESOLUTION_RE.test(c.body || ''));
  if (resolution) return []; // legitimate not-planned / duplicate / wontfix close

  return [
    {
      op: 'comment',
      body:
        `closed from **${state}** without a resolution comment or the review step. Reopening — ` +
        `the flow is triage → ready → in-progress → review → close (\`ticket close #${issue.number}\`).`,
    },
    { op: 'reopen' },
    { op: 'fail' },
  ];
}

module.exports = { onOpened, onLabeled, onUnlabeled, onAssigned, onClosed, hygieneNeeds, labelState };
