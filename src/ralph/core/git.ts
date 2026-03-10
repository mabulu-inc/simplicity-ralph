import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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

export async function discardUnstaged(cwd: string): Promise<void> {
  await run(cwd, ['checkout', '--', '.']);
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
  try {
    const output = await run(cwd, ['rev-list', `${remote}/${branch}..HEAD`]);
    return output !== '';
  } catch {
    return false;
  }
}

export async function pushToRemote(cwd: string, remote: string, branch: string): Promise<void> {
  await run(cwd, ['push', remote, branch]);
}

export async function addAndCommit(cwd: string, files: string[], message: string): Promise<string> {
  await run(cwd, ['add', ...files]);
  await run(cwd, ['commit', '-m', message]);
  return run(cwd, ['rev-parse', 'HEAD']);
}
