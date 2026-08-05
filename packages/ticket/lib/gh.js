'use strict';
/**
 * Thin `gh` subprocess wrapper. Zero deps. Every read is a live API call;
 * every write is an API mutation. With `dryRun: true` nothing is executed —
 * the exact `gh` commands are printed instead.
 *
 * Output is mapped to the REST-ish shape the flow module expects
 * (snake_case timestamps/html_url, single `assignee`, `user.login` comments).
 */
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const exec = promisify(execFile);

class GhError extends Error {
  constructor(message, code, stderr) {
    super(message);
    this.name = 'GhError';
    this.code = code;
    this.stderr = stderr;
  }
}

const ISSUE_FIELDS = 'number,title,labels,assignees,state,createdAt,updatedAt,url,body';
const ISSUE_FIELDS_WITH_COMMENTS = `${ISSUE_FIELDS},comments`;

// gh CLI emits camelCase + uppercase state; flow.js expects REST snake_case
// shapes with lowercase 'open'/'closed' (stateOf compares exact strings).
function toIssueShape(raw) {
  return {
    number: raw.number,
    title: raw.title,
    state: String(raw.state || '').toLowerCase(),
    labels: (raw.labels || []).map((l) => ({ name: l.name })),
    assignee: (raw.assignees && raw.assignees[0]) ? { login: raw.assignees[0].login } : null,
    body: raw.body || '',
    created_at: raw.createdAt,
    updated_at: raw.updatedAt,
    html_url: raw.url,
  };
}

// flow.js reviewer/lgtm logic reads `user.login`; gh emits `author.login`.
function toCommentShape(c) {
  return { user: { login: (c.author || c.user || {}).login || '' }, body: c.body || '' };
}

class Gh {
  constructor({ repo = null, dryRun = false } = {}) {
    this.repo = repo;
    this.dryRun = dryRun;
  }

  _args(args) {
    if (this.repo) args = args.concat(['--repo', this.repo]);
    return args;
  }

  async _run(args, { mutation = false, allowFail = false } = {}) {
    if (this.dryRun && mutation) {
      // Reads always execute so dry-run validates against real state;
      // only mutations are skipped (printed, never run).
      console.log(`[dry-run] gh ${args.join(' ')}`);
      return null;
    }
    try {
      const { stdout } = await exec('gh', this._args(args), { maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
      return stdout.trim();
    } catch (err) {
      if (allowFail) return null;
      throw new GhError(`gh ${args[0]} failed: ${err.stderr?.trim() || err.message}`, err.code, err.stderr);
    }
  }

  // ── reads ──────────────────────────────────────────────────────────────
  async whoami() {
    const out = await this._run(['api', 'user', '--jq', '.login'], { allowFail: true });
    return out || null;
  }

  async listIssues({ state = 'open', labels = [], limit = 200 } = {}) {
    const args = ['issue', 'list', '--state', state, '--limit', String(limit), '--json', ISSUE_FIELDS, '--jq', '.'];
    for (const l of labels) args.push('--label', l);
    const raw = await this._run(args, { allowFail: true });
    return raw ? JSON.parse(raw).map(toIssueShape) : [];
  }

  async viewIssue(n) {
    const args = ['issue', 'view', String(n), '--json', ISSUE_FIELDS_WITH_COMMENTS, '--jq', '.'];
    const raw = await this._run(args, { allowFail: true });
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { ...toIssueShape(d), comments: (d.comments || []).map(toCommentShape) };
  }

  // ── writes (mutations) ─────────────────────────────────────────────────
  async createIssue({ title, body, labels }) {
    const args = ['issue', 'create', '--title', title, '--body', body];
    for (const l of labels) args.push('--label', l);
    return this._run(args, { mutation: true });
  }

  async editIssue(n, { addLabels = [], removeLabels = [], addAssignee = null, removeAssignee = null } = {}) {
    const args = ['issue', 'edit', String(n)];
    for (const l of addLabels) args.push('--add-label', l);
    for (const l of removeLabels) args.push('--remove-label', l);
    if (addAssignee) args.push('--add-assignee', addAssignee);
    if (removeAssignee) args.push('--remove-assignee', removeAssignee);
    return this._run(args, { mutation: true });
  }

  async comment(n, body) {
    return this._run(['issue', 'comment', String(n), '--body', body], { mutation: true });
  }

  async closeIssue(n) {
    return this._run(['issue', 'close', String(n)], { mutation: true });
  }

  async reopenIssue(n) {
    return this._run(['issue', 'reopen', String(n)], { mutation: true });
  }

  async mergedPrsReferencing(n) {
    const raw = await this._run(['pr', 'list', '--state', 'merged', '--search', `"#${n}"`, '--limit', '10', '--json', 'number,title', '--jq', '.'], { allowFail: true });
    return raw ? JSON.parse(raw) : [];
  }

  // CI rollup for a PR: summarizes statusCheckRollup conclusions (CheckRun)
  // and states (StatusContext) into one human line. null when unknown.
  async prCiStatus(n) {
    const raw = await this._run(['pr', 'view', String(n), '--json', 'statusCheckRollup'], { allowFail: true });
    if (!raw) return null;
    const rollup = (JSON.parse(raw).statusCheckRollup || []).map(
      (c) => (c.conclusion || c.state || '').toUpperCase()
    );
    if (!rollup.length) return 'no checks';
    if (rollup.every((s) => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(s))) return 'ci: green';
    if (rollup.some((s) => ['FAILURE', 'ERROR', 'CANCELLED'].includes(s))) return 'ci: failing';
    return 'ci: pending';
  }
}

module.exports = { Gh, GhError };
