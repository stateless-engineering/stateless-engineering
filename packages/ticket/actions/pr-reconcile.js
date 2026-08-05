#!/usr/bin/env node
'use strict';
/**
 * pr-reconcile.js — runner for the pr-reconcile flow: on a merged PR,
 * reconcile the issues it references (sync comment, or close from review
 * via the machine's review → done with prMerged). Stateless: reads the
 * API, writes comments/labels only.
 */
const fs = require('node:fs');
const { Gh } = require('../lib/gh.js');
const { referencedIssues, decide } = require('./pr-lib.js');

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!repo || !eventPath) {
    console.error('pr-reconcile: GITHUB_REPOSITORY and GITHUB_EVENT_PATH are required');
    return 2;
  }

  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const pr = event.pull_request;
  if (!pr || event.action !== 'closed' || !pr.merged) return 0;

  const gh = new Gh({ repo });
  const prCi = await gh.prCiStatus(pr.number);
  let handled = 0;

  for (const n of referencedIssues(pr)) {
    if (n === pr.number) continue; // PRs are not tickets
    const issue = await gh.viewIssue(n);
    if (!issue || issue.state !== 'open') continue;
    const comments = (issue.comments || []).map((c) => ({
      user: { login: (c.user || {}).login || '' },
      body: c.body || '',
    }));
    for (const a of decide(issue, pr, { comments, prCi })) {
      if (a.op === 'close') {
        await gh.comment(n, a.body); // resolution must exist before close
        await gh.closeIssue(n);
      } else {
        await gh.comment(n, a.body);
      }
    }
    handled += 1;
    console.log(`pr-reconcile: #${n} handled (PR #${pr.number} merged)`);
  }
  console.log(`pr-reconcile: ${handled} issue(s) reconciled`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`pr-reconcile: ${err.message}`);
    process.exit(1);
  });
