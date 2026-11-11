#!/usr/bin/env node
// tdd-cover: e2e .github/scripts/ci-scope.test.mjs
// Which part of the Turbo graph the `code` job runs for this revision.
//
// THE DEFAULT IS THE FULL GRAPH. `--affected` is an optimisation for pull
// requests only: push, merge queue and manual runs prove everything. Any doubt
// (no merge commit, an unreadable diff, a path outside the workspaces that is
// not documentation) runs the full graph, never a narrower one. Turbo itself
// also widens to every package on a lockfile, root manifest or turbo.json
// change, and on a checkout too shallow to compare.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A file inside a workspace package: Turbo maps it to that package and its
// dependents. `_modules/README.md` is not inside a package and falls through.
const WORKSPACE = /^(?:apps|packages|_modules|tooling)\/[^/]+\//;
// Paths outside the workspaces that no Turbo task reads. Markdown inside a
// package also matches WORKSPACE, so Turbo still marks that package affected.
const NO_TASK_INPUT = [
  /^docs\//,
  /^\.void\//,
  /^\.claude\//,
  /^\.agents\//,
  /^\.codex\//,
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.github\/pull_request_template\.md$/,
  /\.md$/,
];
const SHA = /^[0-9a-f]{40}$/;

const full = (reason) => ({ affected: false, reason: `full graph: ${reason}` });

export function planScope({ eventName, parents, files }) {
  if (eventName !== 'pull_request') return full(`event is ${eventName ?? 'unknown'}`);
  // actions/checkout checks out refs/pull/N/merge: its first parent is the base
  // branch tip the pull request is merged into, its second the branch head.
  if (!Array.isArray(parents) || parents.length !== 2 || !parents.every((p) => SHA.test(p))) {
    return full('HEAD is not the pull request merge commit');
  }
  if (!Array.isArray(files) || files.length === 0) return full('no readable change list');
  for (const file of files) {
    if (typeof file !== 'string' || file === '') return full('a changed path is unreadable');
    if (!WORKSPACE.test(file) && !NO_TASK_INPUT.some((pattern) => pattern.test(file))) {
      return full(`${file} is outside the workspaces`);
    }
  }
  return {
    affected: true,
    base: parents[0],
    reason: `affected graph: ${files.length} changed path(s) against ${parents[0]}`,
  };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function readRevision() {
  const [, ...parents] = git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ');
  if (parents.length !== 2) return { parents };
  // No rename detection: a move out of a package changes that package too.
  const files = git(['diff', '--no-renames', '--name-only', '-z', parents[0], 'HEAD'])
    .split('\0')
    .filter(Boolean);
  return { parents, files };
}

function main() {
  const { GITHUB_EVENT_NAME, GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;
  if (!GITHUB_OUTPUT) throw new Error('CI_SCOPE: GITHUB_OUTPUT is unset.');
  let revision = {};
  if (GITHUB_EVENT_NAME === 'pull_request') {
    try {
      revision = readRevision();
    } catch (error) {
      process.stdout.write(
        `::warning title=ci-scope::git failed, running the full graph (${error})\n`,
      );
    }
  }
  const plan = planScope({ eventName: GITHUB_EVENT_NAME, ...revision });
  const line = `ci-scope: ${plan.reason}`;
  process.stdout.write(`${line}\n`);
  if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, `${line}\n`);
  appendFileSync(GITHUB_OUTPUT, `affected=${plan.affected}\nbase=${plan.base ?? ''}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
