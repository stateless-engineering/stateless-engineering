#!/usr/bin/env node
'use strict';
/**
 * actions/flow.js — runner for the ticket flow Action (issue #7).
 *
 * Runs inside .github/workflows/flow.yml on issue events. Reads the event
 * payload (GITHUB_EVENT_PATH), decides via lib.js, executes mutations
 * through `gh`, and exits non-zero on violations (red check). Stateless:
 * reads the API, writes labels/comments only, leaves no artifacts.
 */
const fs = require('node:fs');
const { Gh } = require('../lib/gh.js');
const lib = require('./lib.js');

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!repo || !eventPath) {
    console.error('flow: GITHUB_REPOSITORY and GITHUB_EVENT_PATH are required');
    return 2;
  }

  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const issue = event.issue;
  // Issue events never carry PRs, but the guard is cheap and the issues API
  // can surface PR-shaped objects.
  if (!issue || issue.pull_request) return 0;

  const gh = new Gh({ repo });
  const n = issue.number;
  let acts = [];

  switch (event.action) {
    case 'opened':
      acts = lib.onOpened(issue);
      break;
    case 'labeled':
      acts = lib.onLabeled(issue, (event.label || {}).name);
      break;
    case 'unlabeled':
      acts = lib.onUnlabeled(issue, (event.label || {}).name);
      break;
    case 'assigned':
      acts = lib.onAssigned(issue, (event.assignee || {}).login);
      break;
    case 'closed': {
      const view = await gh.viewIssue(n);
      const comments = (view.comments || []).map((c) => ({
        user: { login: (c.user || {}).login || '' },
        body: c.body || '',
      }));
      const prs = await gh.mergedPrsReferencing(n);
      acts = lib.onClosed(issue, { comments, prMerged: prs.length > 0 });
      break;
    }
    default:
      return 0;
  }

  let failed = false;
  for (const a of acts) {
    switch (a.op) {
      case 'comment':
        await gh.comment(n, a.body);
        break;
      case 'label':
        await gh.editIssue(n, { addLabels: [a.name] });
        break;
      case 'reopen':
        await gh.reopenIssue(n);
        break;
      case 'fail':
        failed = true;
        break;
      default:
        throw new Error(`flow: unknown action op: ${a.op}`);
    }
  }

  if (failed) {
    console.error(`flow: violation on #${n} (${event.action}) — see issue comments`);
    return 1;
  }
  console.log(`flow: #${n} ok (${event.action})`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`flow: ${err.message}`);
    process.exit(1);
  });
