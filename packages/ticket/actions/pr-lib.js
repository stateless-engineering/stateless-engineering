'use strict';
/**
 * pr-lib.js — decision logic for pr-reconcile (the stateless-actions spec's
 * `pr-reconcile` action): on a merged PR, sync the issues it references and
 * auto-close those whose state the machine allows (review + merged PR).
 * Pure and unit-tested; the runner (pr-reconcile.js) executes the actions.
 */
const flow = require('../lib/flow.js');

// any "#n" in the PR title or body — "Closes #n" is just a ref with a word
function referencedIssues(pr) {
  const text = `${pr.title || ''}\n${pr.body || ''}`;
  const nums = new Set();
  for (const m of text.matchAll(/#(\d+)\b/g)) nums.add(parseInt(m[1], 10));
  return [...nums];
}

// Decide what to do for one issue referenced by a merged PR.
// - state review (or otherwise close-legal with a merged PR) → close with a
//   resolution comment (the machine's review → done via prMerged).
// - anything else open → a sync comment, no close.
function decide(issue, pr, { comments = [], prCi = null } = {}) {
  const acts = [];
  const close = flow.checkClose(issue, { comments, prMerged: true });
  const ci = prCi ? `, ${prCi}` : '';
  if (close.ok) {
    acts.push({
      op: 'close',
      body: `Resolution: fixed in #${pr.number} (${pr.title}) — merged${ci}.`,
    });
  } else {
    const state = flow.labelState(issue);
    acts.push({
      op: 'comment',
      body:
        `PR #${pr.number} merged${ci} — issue is still **${state}**. ` +
        `Run \`ticket close #${issue.number}\` once review passes.`,
    });
  }
  return acts;
}

module.exports = { referencedIssues, decide };
