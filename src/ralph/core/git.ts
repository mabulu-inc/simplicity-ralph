import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertSafeGitRef, assertSafeFilePath, assertSafeShellArg } from './sanitize.js';

const execFileAsync = promisify(execFile);

export interface LogEntry {
  sha: string;
  message: string;
}

async function run(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

export async function getHeadSha(cwd: string): Promise<string> {
  return run(cwd, ['rev-parse', 'HEAD']);
}

export async function isWorkingTreeClean(cwd: string): Promise<boolean> {
  const status = await run(cwd, ['status', '--porcelain']);
  return status === '';
}

function isProtectedPath(filePath: string, protectedPaths: string[]): boolean {
  return protectedPaths.some((p) => {
    if (p.endsWith('/')) {
      return filePath.startsWith(p);
    }
    return filePath === p;
  });
}

export async function discardUnstaged(cwd: string, protectedPaths?: string[]): Promise<void> {
  if (!protectedPaths || protectedPaths.length === 0) {
    await run(cwd, ['checkout', '--', '.']);
    return;
  }

  // Restore modified tracked files, excluding protected paths
  const diffOutput = await run(cwd, ['diff', '--name-only']).catch(() => '');
  if (diffOutput) {
    const filesToRestore = diffOutput
      .split('\n')
      .filter((f) => f && !isProtectedPath(f, protectedPaths));
    if (filesToRestore.length > 0) {
      await run(cwd, ['checkout', '--', ...filesToRestore]);
    }
  }

  // Clean untracked files, excluding protected paths
  const cleanArgs = ['clean', '-fd'];
  for (const p of protectedPaths) {
    cleanArgs.push('-e', p);
  }
  await run(cwd, cleanArgs);
}

export async function getCommitLog(
  cwd: string,
  options?: { maxCount?: number },
): Promise<LogEntry[]> {
  const args = ['log', '--oneline'];
  if (options?.maxCount) {
    args.push(`-${options.maxCount}`);
  }
  const output = await run(cwd, args);
  if (!output) return [];
  return output.split('\n').map((line) => {
    const spaceIdx = line.indexOf(' ');
    return {
      sha: line.slice(0, spaceIdx),
      message: line.slice(spaceIdx + 1),
    };
  });
}

export async function findCommitByMessage(
  cwd: string,
  pattern: string,
): Promise<LogEntry | undefined> {
  assertSafeShellArg(pattern);
  const args = ['log', '--oneline', '--all', `--grep=${pattern}`];
  const output = await run(cwd, args);
  if (!output) return undefined;
  const line = output.split('\n')[0];
  const spaceIdx = line.indexOf(' ');
  const shortSha = line.slice(0, spaceIdx);
  // Return the full SHA
  const fullSha = await run(cwd, ['rev-parse', shortSha]);
  return {
    sha: fullSha,
    message: line.slice(spaceIdx + 1),
  };
}

export async function hasUnpushedCommits(
  cwd: string,
  remote: string,
  branch: string,
): Promise<boolean> {
  assertSafeGitRef(remote);
  assertSafeGitRef(branch);
  try {
    const output = await run(cwd, ['rev-list', `${remote}/${branch}..HEAD`]);
    return output !== '';
  } catch (err) {
    console.error(
      `[ralph] Failed to check unpushed commits for ${remote}/${branch}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

export async function pushToRemote(cwd: string, remote: string, branch: string): Promise<void> {
  assertSafeGitRef(remote);
  assertSafeGitRef(branch);
  await run(cwd, ['push', remote, branch]);
}

export async function addAndCommit(cwd: string, files: string[], message: string): Promise<string> {
  for (const file of files) {
    assertSafeFilePath(file);
  }
  assertSafeShellArg(message);
  await run(cwd, ['add', ...files]);
  await run(cwd, ['commit', '-m', message]);
  return run(cwd, ['rev-parse', 'HEAD']);
}

export async function detectCurrentBranch(cwd: string): Promise<string> {
  return run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

export async function detectTrackingRemote(
  cwd: string,
  branch: string,
): Promise<string | undefined> {
  assertSafeGitRef(branch);
  try {
    return await run(cwd, ['config', `branch.${branch}.remote`]);
  } catch {
    return undefined;
  }
}

export interface GitTarget {
  remote: string;
  branch: string;
}

export async function resolveGitTarget(cwd: string): Promise<GitTarget> {
  const branch = process.env.RALPH_GIT_BRANCH ?? (await detectCurrentBranch(cwd));
  const envRemote = process.env.RALPH_GIT_REMOTE;
  if (envRemote) {
    return { remote: envRemote, branch };
  }
  const trackingRemote = await detectTrackingRemote(cwd, branch);
  return { remote: trackingRemote ?? 'origin', branch };
}
