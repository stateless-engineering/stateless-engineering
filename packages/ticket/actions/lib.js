'use strict';
/**
 * actions/lib.js — decision logic for the flow Action (issue #7).
 * Pure, unit-tested. The state machine lives in ../lib/flow.js — this
 * module only decides *which* hygiene/transition actions to take, and
 * delegates every gate to the machine (checkTransition / checkClose).
 */
const flow = require('../lib/flow.js');

const TYPE_TITLE_RE = /^\[(bug|feature|security|chore|docs)\]\s/i;

function hygieneNeeds(issue) {
  const needs = [];
  if (!flow.typeOf(issue)) {
    needs.push('a type/* label (type/bug, type/feature, type/security, type/chore, type/docs)');
  }
  if (!TYPE_TITLE_RE.test(issue.title || '')) needs.push('a `[type] ` title prefix');
  if (flow.typeOf(issue) === 'feature' && !flow.hasAcceptance(issue.body)) {
    needs.push('acceptance criteria in the body (### Acceptance criteria)');
  }
  return needs;
}

// The machine's triage gate: type + priority + acceptance → ready.
function canAutoTriage(issue) {
  return flow.checkTransition('triage', 'ready', { issue }).ok;
}

// ── event handlers ────────────────────────────────────────────────────────

// opened: apply defaults (priority), comment hygiene violations, and
// auto-triage when the gate already passes (typed + prioritized + acceptance).
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
  if (canAutoTriage(issue)) {
    acts.push({ op: 'label', name: flow.STATUS_LABEL.ready });
  }
  return acts;
}

// labeled: auto-triage on label additions (type/priority now present),
// announce status transitions, re-check acceptance for features.
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
  if (canAutoTriage(issue) && flow.stateOf(issue) === 'triage') {
    acts.push({ op: 'label', name: flow.STATUS_LABEL.ready });
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

// closed: enforce the machine via flow.checkClose — review needs PR-merged
// or reviewer lgtm; otherwise a resolution marker; else reopen + red check.
function onClosed(issue, { comments = [], prMerged = false } = {}) {
  const ok = flow.checkClose(issue, { comments, prMerged });
  if (ok.ok) return [];
  return [
    {
      op: 'comment',
      body:
        `**close blocked:** ${ok.reason}. Reopening — resolve via the flow ` +
        `(\`ticket close #${issue.number}\`).`,
    },
    { op: 'reopen' },
    { op: 'fail' },
  ];
}

module.exports = { onOpened, onLabeled, onUnlabeled, onAssigned, onClosed, hygieneNeeds, canAutoTriage };
