#!/usr/bin/env node
'use strict';
/**
 * Stateless ticket CLI — the GitHub API is the only state.
 * Zero npm deps. Wraps `gh` subprocesses; every read is a live API call,
 * every write is an API mutation, and a no-op invocation changes nothing.
 *
 *   ticket list|next|new|triage|claim|unclaim|review|close|reopen|
 *          block|unblock|comment|report|sync
 *
 *   --repo owner/name   explicit repo (else detected from git remote)
 *   --json              stable machine schema
 *   --dry-run           print the gh commands without executing them
 *
 * State machine + normalization live in lib/flow.js (the shared contract,
 * also used by the flow Action). Per docs/specs/stateless-tickets.md (#6).
 */
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const flow = require('../lib/flow.js');
const { Gh, GhError } = require('../lib/gh.js');

const exec = promisify(execFile);
const TTY = Boolean(process.stdout.isTTY);
const C = TTY
  ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m` }
  : { dim: (s) => s, green: (s) => s, red: (s) => s, yellow: (s) => s, cyan: (s) => s };

const STATUS_COLOR = {
  triage: C.dim, ready: C.cyan, 'in-progress': C.yellow, review: C.yellow, blocked: C.red, done: C.green,
};

function usage() {
  console.log(`usage: ticket <verb> [args] [--repo owner/name] [--json] [--dry-run]

verbs:
  list [--state S] [--label L] [--mine]     the queue, deterministic sort
  next [--label L]                           top of ready queue (unassigned)
  new --type bug|feature|security|chore|docs --title "…" [--body "…"]
  triage <n>                                 gate to ready (type+priority+acceptance)
  claim <n> / unclaim <n>                    assign to you / release
  review <n> --reviewer @user                hand to review
  close <n> / reopen <n>                     done / back to ready
  block <n> "reason" / unblock <n>           parked / resumed
  comment <n> "…"                            annotate
  report [--json]                            stateless status board
  sync <n>                                   PR/CI reconcile + fix summary`);
}

function fail(msg, code = 1) {
  console.error(C.red(`✗ ${msg}`));
  process.exit(code);
}

// ── arg parsing (zero deps) ──────────────────────────────────────────────
function pair(argv, i) {
  const v = argv[i];
  if (v === undefined) fail(`missing value for ${argv[i - 1]}`);
  return v;
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--mine') opts.mine = true;
    else if (a.startsWith('--repo=')) opts.repo = a.slice(7);
    else if (a === '--repo') opts.repo = pair(argv, ++i);
    else if (a.startsWith('--state=')) opts.state = a.slice(8);
    else if (a === '--state') opts.state = pair(argv, ++i);
    else if (a.startsWith('--label=')) { (opts.labels = opts.labels || []).push(a.slice(8)); }
    else if (a === '--label') { (opts.labels = opts.labels || []).push(pair(argv, ++i)); }
    else if (a.startsWith('--type=')) opts.type = a.slice(7);
    else if (a === '--type') opts.type = pair(argv, ++i);
    else if (a.startsWith('--title=')) opts.title = a.slice(8);
    else if (a === '--title') opts.title = pair(argv, ++i);
    else if (a.startsWith('--body=')) opts.body = a.slice(7);
    else if (a === '--body') opts.body = pair(argv, ++i);
    else if (a.startsWith('--reviewer=')) opts.reviewer = a.slice(11).replace(/^@/, '');
    else if (a === '--reviewer') opts.reviewer = pair(argv, ++i).replace(/^@/, '');
    else opts._.push(a);
  }
  return opts;
}

async function detectRepo(cwd) {
  try {
    const { stdout } = await exec('git', ['-C', cwd, 'remote', 'get-url', 'origin']);
    const m = String(stdout).trim().match(/(?:github\.com[:/])([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (m) return `${m[1]}/${m[2]}`;
  } catch { /* no remote */ }
  return null;
}

// ── helpers ──────────────────────────────────────────────────────────────
async function loadTicket(gh, n) {
  const issue = await gh.viewIssue(n);
  if (!issue) fail(`issue #${n} not found`);
  return { issue, t: flow.normalize(issue, issue.comments) };
}

const transitionOk = (r) => (r.ok ? null : r.reason);

function renderTicket(t) {
  const st = STATUS_COLOR[t.status] ? STATUS_COLOR[t.status](t.status.padEnd(11)) : t.status.padEnd(11);
  const pri = (t.priority || '—').padEnd(3);
  const who = t.assignee ? ` @${t.assignee}` : '';
  return `${C.dim(`#${String(t.number).padEnd(4)}`)} ${st} ${pri} ${t.title}${who}`;
}

// ── verbs ────────────────────────────────────────────────────────────────
async function verbList(gh, opts) {
  let issues = await gh.listIssues({ state: opts.state || 'open', labels: opts.labels || [] });
  if (opts.mine) {
    const me = await gh.whoami();
    issues = issues.filter((i) => i.assignee && i.assignee.login === me);
  }
  const tickets = flow.sortTickets(issues).map((i) => flow.normalize(i, []));
  if (opts.json) return console.log(JSON.stringify(tickets, null, 2));
  if (!tickets.length) return console.log(C.dim('no tickets'));
  tickets.forEach((t) => console.log(renderTicket(t)));
}

async function verbNext(gh, opts) {
  const issues = await gh.listIssues({ state: 'open', labels: opts.labels || [] });
  const tickets = flow.sortTickets(issues)
    .map((i) => flow.normalize(i, []))
    .filter((t) => t.status === 'ready' && !t.assignee);
  if (!tickets.length) {
    if (opts.json) return console.log(JSON.stringify(null));
    return console.log(C.dim('ready queue is empty'));
  }
  const top = tickets[0];
  if (opts.json) return console.log(JSON.stringify(top, null, 2));
  console.log(renderTicket(top));
}

async function verbNew(gh, opts) {
  const type = opts.type || 'feature';
  if (!flow.TYPES.includes(type)) fail(`unknown type "${type}" (${flow.TYPES.join('|')})`);
  const title = opts.title || opts._[0];
  if (!title) fail('--title is required');
  const body = opts.body || [
    '## Context',
    '',
    '## Acceptance criteria',
    '- [ ] ',
    '',
  ].join('\n');
  const labels = [flow.labelOf ? `type/${type}` : `type/${type}`, `priority/${flow.DEFAULT_PRIORITY || 'p2'}`];
  if (opts.dryRun) {
    console.log(`[dry-run] would create issue "[${type}] ${title}" with labels ${labels.join(', ')}`);
    return;
  }
  const out = await gh.createIssue({ title: `[${type}] ${title}`, body, labels });
  console.log(out);
}

async function verbTriage(gh, opts, n) {
  const { issue, t } = await loadTicket(gh, n);
  if (t.status === 'ready') return console.log(`#${n} already ready`);
  const reason = transitionOk(flow.checkTransition(t.status, 'ready', { issue }));
  if (reason) fail(`cannot triage #${n}: ${reason}`);
  await gh.editIssue(n, { addLabels: [flow.labelOf('ready')] });
  console.log(`#${n} triaged → ready`);
}

async function verbClaim(gh, opts, n) {
  const me = await gh.whoami();
  const { issue, t } = await loadTicket(gh, n);
  const reason = transitionOk(flow.checkTransition(t.status, 'in-progress', { issue, viewer: me }));
  if (reason) fail(`cannot claim #${n}: ${reason}`);
  const already = issue.assignee && issue.assignee.login === me;
  if (already) return console.log(`#${n} already claimed by you`);
  await gh.editIssue(n, { addAssignee: me, addLabels: [flow.labelOf('in-progress')] });
  console.log(`#${n} claimed → in-progress (@${me})`);
}

async function verbUnclaim(gh, opts, n) {
  const me = await gh.whoami();
  const { issue, t } = await loadTicket(gh, n);
  const reason = transitionOk(flow.checkTransition(t.status, 'ready', { issue }));
  if (reason) fail(`cannot unclaim #${n}: ${reason}`);
  const owner = issue.assignee ? issue.assignee.login : me;
  if (owner !== me && !opts.dryRun) fail(`#${n} is claimed by @${owner} — only they (or an admin) can unclaim`);
  await gh.editIssue(n, { removeAssignee: owner, removeLabels: [flow.labelOf('in-progress')], addLabels: [flow.labelOf('ready')] });
  console.log(`#${n} unclaimed → ready`);
}

async function verbReview(gh, opts, n) {
  const reviewer = opts.reviewer;
  if (!reviewer) fail('--reviewer @user is required');
  const { issue, t } = await loadTicket(gh, n);
  const reason = transitionOk(flow.checkTransition(t.status, 'review', { issue, reviewer }));
  if (reason) fail(`cannot review #${n}: ${reason}`);
  await gh.editIssue(n, { addLabels: [flow.labelOf('review')] });
  await gh.comment(n, `review requested: @${reviewer} — please review (acceptance criteria in the body).`);
  console.log(`#${n} → review (@${reviewer})`);
}

async function verbClose(gh, opts, n) {
  const { issue, t } = await loadTicket(gh, n);
  const prs = await gh.mergedPrsReferencing(n);
  const prMerged = prs.length > 0;
  // The single close-enforcement (shared with the flow Action): review +
  // PR-merged or reviewer lgtm.
  const ok = flow.checkClose(issue, { comments: issue.comments, prMerged });
  if (!ok.ok) fail(`cannot close #${n}: ${ok.reason}`);
  const reviewer = flow.extractReviewer(issue.comments);
  const resolution = prMerged
    ? `Resolution: fixed in #${prs[0].number} (${prs[0].title}) — merged.`
    : `Resolution: reviewed and accepted (lgtm by @${reviewer || 'reviewer'}).`;
  // Comment BEFORE close: the flow Action's `closed` handler must observe
  // the resolution marker or a legit close gets reopened.
  await gh.comment(n, resolution);
  await gh.closeIssue(n);
  console.log(`#${n} → done: ${resolution}`);
}

async function verbReopen(gh, opts, n) {
  const { issue, t } = await loadTicket(gh, n);
  const reason = transitionOk(flow.checkTransition(t.status, 'ready', { issue }));
  if (reason) fail(`cannot reopen #${n}: ${reason}`);
  await gh.reopenIssue(n);
  await gh.editIssue(n, { addLabels: [flow.labelOf('ready')] });
  console.log(`#${n} reopened → ready`);
}

async function verbBlock(gh, opts, n, reasonText) {
  const { issue, t } = await loadTicket(gh, n);
  const reason = transitionOk(flow.checkTransition(t.status, 'blocked', { issue, reason: reasonText }));
  if (reason) fail(`cannot block #${n}: ${reason}`);
  if (t.status === 'blocked') return console.log(`#${n} already blocked`);
  await gh.editIssue(n, { addLabels: [flow.labelOf('blocked')] });
  await gh.comment(n, `Blocked: ${reasonText}`);
  console.log(`#${n} → blocked`);
}

async function verbUnblock(gh, opts, n) {
  const { issue, t } = await loadTicket(gh, n);
  const reason = transitionOk(flow.checkTransition(t.status, 'ready', { issue }));
  if (reason) fail(`cannot unblock #${n}: ${reason}`);
  await gh.editIssue(n, { removeLabels: [flow.labelOf('blocked')], addLabels: [flow.labelOf('ready')] });
  console.log(`#${n} unblocked → ready`);
}

async function verbComment(gh, opts, n, text) {
  if (!text) fail('comment text is required');
  await gh.comment(n, text);
  console.log(`commented on #${n}`);
}

async function verbReport(gh, opts) {
  const issues = await gh.listIssues({ state: 'all' });
  const tickets = flow.sortTickets(issues).map((i) => flow.normalize(i, []));
  const byStatus = {};
  for (const t of tickets) (byStatus[t.status] = byStatus[t.status] || []).push(t);
  const order = flow.STATES;
  if (opts.json) return console.log(JSON.stringify({
    generated: new Date().toISOString(),
    counts: Object.fromEntries(order.map((s) => [s, (byStatus[s] || []).length])),
    tickets,
  }, null, 2));
  console.log(C.dim(`stateless ticket board — ${tickets.length} issues`));
  for (const s of order) {
    const list = byStatus[s] || [];
    console.log(`${STATUS_COLOR[s](s.toUpperCase().padEnd(11))} ${C.dim(String(list.length))}`);
    for (const t of list) console.log(`  ${renderTicket(t)}`);
  }
}

async function verbSync(gh, opts, n) {
  const { issue, t } = await loadTicket(gh, n);
  const prs = await gh.mergedPrsReferencing(n);
  let summary = `Sync #${n}: status=${t.status}, type=${t.type || '—'}, priority=${t.priority || '—'}`;
  if (prs.length) {
    const ci = await gh.prCiStatus(prs[0].number);
    summary += `, merged PR #${prs[0].number} (${prs[0].title}), ${ci || 'ci: unknown'}`;
  } else {
    summary += ', no merged PR referencing it';
  }
  console.log(summary);
  if (opts.json) console.log(JSON.stringify({ number: n, status: t.status, pr: prs[0] || null }, null, 2));
  if (!opts.dryRun) await gh.comment(n, summary);
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const verb = opts._.shift();
  const repo = opts.repo || (await detectRepo(process.cwd()));
  if (!repo) fail('cannot detect repo (set --repo owner/name or run inside a git checkout with an origin)');
  const gh = new Gh({ repo, dryRun: opts.dryRun });

  switch (verb) {
    case 'list': return verbList(gh, opts);
    case 'next': return verbNext(gh, opts);
    case 'new': return verbNew(gh, opts);
    case 'triage': return verbTriage(gh, opts, parseInt(opts._[0], 10));
    case 'claim': return verbClaim(gh, opts, parseInt(opts._[0], 10));
    case 'unclaim': return verbUnclaim(gh, opts, parseInt(opts._[0], 10));
    case 'review': return verbReview(gh, opts, parseInt(opts._[0], 10));
    case 'close': return verbClose(gh, opts, parseInt(opts._[0], 10));
    case 'reopen': return verbReopen(gh, opts, parseInt(opts._[0], 10));
    case 'block': return verbBlock(gh, opts, parseInt(opts._[0], 10), opts._[1]);
    case 'unblock': return verbUnblock(gh, opts, parseInt(opts._[0], 10));
    case 'comment': return verbComment(gh, opts, parseInt(opts._[0], 10), opts._[1]);
    case 'report': return verbReport(gh, opts);
    case 'sync': return verbSync(gh, opts, parseInt(opts._[0], 10));
    default:
      usage();
      process.exit(verb ? 1 : 0);
  }
}

main().catch((err) => {
  if (err instanceof GhError) {
    const stderr = (err.stderr || '').trim();
    const detail = stderr && !err.message.includes(stderr) ? `\n${C.dim(stderr)}` : '';
    fail(`${err.message}${detail}`);
  }
  fail(err.stack || String(err));
});
