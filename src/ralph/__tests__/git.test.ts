import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import {
  getHeadSha,
  isWorkingTreeClean,
  discardUnstaged,
  getCommitLog,
  findCommitByMessage,
  hasUnpushedCommits,
  pushToRemote,
  addAndCommit,
  detectCurrentBranch,
  detectTrackingRemote,
  resolveGitTarget,
} from '../core/git.js';

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8' }).trim();
}

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ralph-git-test-'));
  git(dir, 'init -b main');
  git(dir, 'config user.email "test@test.com"');
  git(dir, 'config user.name "Test"');
  return dir;
}

async function makeCommit(
  dir: string,
  filename: string,
  content: string,
  message: string,
): Promise<string> {
  await writeFile(join(dir, filename), content);
  git(dir, `add ${filename}`);
  git(dir, `commit -m "${message}"`);
  return git(dir, 'rev-parse HEAD');
}

describe('git operations', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await initRepo();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('getHeadSha', () => {
    it('returns the full SHA of HEAD', async () => {
      const sha = await makeCommit(dir, 'a.txt', 'hello', 'initial commit');
      const result = await getHeadSha(dir);
      expect(result).toBe(sha);
      expect(result).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe('isWorkingTreeClean', () => {
    it('returns true when no changes exist', async () => {
      await makeCommit(dir, 'a.txt', 'hello', 'initial');
      expect(await isWorkingTreeClean(dir)).toBe(true);
    });

    it('returns false when there are unstaged changes', async () => {
      await makeCommit(dir, 'a.txt', 'hello', 'initial');
      await writeFile(join(dir, 'a.txt'), 'modified');
      expect(await isWorkingTreeClean(dir)).toBe(false);
    });

    it('returns false when there are staged changes', async () => {
      await makeCommit(dir, 'a.txt', 'hello', 'initial');
      await writeFile(join(dir, 'a.txt'), 'staged');
      git(dir, 'add a.txt');
      expect(await isWorkingTreeClean(dir)).toBe(false);
    });

    it('returns false when there are untracked files', async () => {
      await makeCommit(dir, 'a.txt', 'hello', 'initial');
      await writeFile(join(dir, 'new.txt'), 'untracked');
      expect(await isWorkingTreeClean(dir)).toBe(false);
    });
  });

  describe('discardUnstaged', () => {
    it('restores modified files to their committed state', async () => {
      await makeCommit(dir, 'a.txt', 'hello', 'initial');
      await writeFile(join(dir, 'a.txt'), 'dirty');
      await discardUnstaged(dir);
      const content = git(dir, 'show HEAD:a.txt');
      expect(content).toBe('hello');
    });

    it('does not discard staged changes', async () => {
      await makeCommit(dir, 'a.txt', 'hello', 'initial');
      await writeFile(join(dir, 'a.txt'), 'staged-change');
      git(dir, 'add a.txt');
      await discardUnstaged(dir);
      const status = git(dir, 'status --porcelain');
      expect(status).toContain('M  a.txt');
    });
  });

  describe('getCommitLog', () => {
    it('returns commits in oneline format', async () => {
      await makeCommit(dir, 'a.txt', 'v1', 'first commit');
      await makeCommit(dir, 'a.txt', 'v2', 'second commit');
      const log = await getCommitLog(dir);
      expect(log).toHaveLength(2);
      expect(log[0].message).toBe('second commit');
      expect(log[1].message).toBe('first commit');
    });

    it('supports maxCount option', async () => {
      await makeCommit(dir, 'a.txt', 'v1', 'first');
      await makeCommit(dir, 'a.txt', 'v2', 'second');
      await makeCommit(dir, 'a.txt', 'v3', 'third');
      const log = await getCommitLog(dir, { maxCount: 2 });
      expect(log).toHaveLength(2);
      expect(log[0].message).toBe('third');
    });

    it('returns sha and message for each entry', async () => {
      const sha = await makeCommit(dir, 'a.txt', 'v1', 'test message');
      const log = await getCommitLog(dir);
      expect(log[0].sha).toBe(sha.slice(0, 7));
      expect(log[0].message).toBe('test message');
    });
  });

  describe('findCommitByMessage', () => {
    it('finds a commit matching a pattern', async () => {
      await makeCommit(dir, 'a.txt', 'v1', 'T-001: initial feature');
      await makeCommit(dir, 'a.txt', 'v2', 'T-002: next feature');
      const result = await findCommitByMessage(dir, 'T-001:');
      expect(result).not.toBeUndefined();
      expect(result!.message).toBe('T-001: initial feature');
    });

    it('returns undefined when no match is found', async () => {
      await makeCommit(dir, 'a.txt', 'v1', 'unrelated commit');
      const result = await findCommitByMessage(dir, 'T-999:');
      expect(result).toBeUndefined();
    });

    it('returns the full SHA', async () => {
      const sha = await makeCommit(dir, 'a.txt', 'v1', 'T-005: something');
      const result = await findCommitByMessage(dir, 'T-005:');
      expect(result!.sha).toBe(sha);
    });
  });

  describe('hasUnpushedCommits', () => {
    it('returns false and warns to stderr when there is no remote', async () => {
      await makeCommit(dir, 'a.txt', 'v1', 'initial');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await hasUnpushedCommits(dir, 'origin', 'main');
      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('unpushed'));
      errorSpy.mockRestore();
    });

    it('detects unpushed commits', async () => {
      // Create a bare remote
      const bare = await mkdtemp(join(tmpdir(), 'ralph-bare-'));
      git(bare, 'init --bare');
      git(dir, `remote add origin ${bare}`);
      await makeCommit(dir, 'a.txt', 'v1', 'initial');
      git(dir, 'push -u origin HEAD:main');
      await makeCommit(dir, 'a.txt', 'v2', 'local only');
      const result = await hasUnpushedCommits(dir, 'origin', 'main');
      expect(result).toBe(true);
      await rm(bare, { recursive: true, force: true });
    });

    it('returns false when everything is pushed', async () => {
      const bare = await mkdtemp(join(tmpdir(), 'ralph-bare-'));
      git(bare, 'init --bare');
      git(dir, `remote add origin ${bare}`);
      await makeCommit(dir, 'a.txt', 'v1', 'initial');
      git(dir, 'push -u origin HEAD:main');
      const result = await hasUnpushedCommits(dir, 'origin', 'main');
      expect(result).toBe(false);
      await rm(bare, { recursive: true, force: true });
    });
  });

  describe('pushToRemote', () => {
    it('pushes commits to the remote', async () => {
      const bare = await mkdtemp(join(tmpdir(), 'ralph-bare-'));
      git(bare, 'init --bare');
      git(dir, `remote add origin ${bare}`);
      await makeCommit(dir, 'a.txt', 'v1', 'initial');
      git(dir, 'push -u origin HEAD:main');
      await makeCommit(dir, 'a.txt', 'v2', 'second');
      await pushToRemote(dir, 'origin', 'main');
      // Verify the remote has the commit
      const remoteLog = git(bare, 'log --oneline');
      expect(remoteLog).toContain('second');
      await rm(bare, { recursive: true, force: true });
    });
  });

  describe('addAndCommit', () => {
    it('stages files and creates a commit', async () => {
      await makeCommit(dir, 'a.txt', 'v1', 'initial');
      await writeFile(join(dir, 'b.txt'), 'new file');
      const sha = await addAndCommit(dir, ['b.txt'], 'T-003: add b.txt');
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      const log = git(dir, 'log --oneline -1');
      expect(log).toContain('T-003: add b.txt');
    });

    it('stages multiple files', async () => {
      await makeCommit(dir, 'a.txt', 'v1', 'initial');
      await writeFile(join(dir, 'b.txt'), 'b');
      await writeFile(join(dir, 'c.txt'), 'c');
      await addAndCommit(dir, ['b.txt', 'c.txt'], 'T-003: add two files');
      const status = git(dir, 'status --porcelain');
      expect(status).toBe('');
    });

    it('returns the SHA of the new commit', async () => {
      await makeCommit(dir, 'a.txt', 'v1', 'initial');
      await writeFile(join(dir, 'b.txt'), 'new');
      const sha = await addAndCommit(dir, ['b.txt'], 'commit msg');
      const headSha = git(dir, 'rev-parse HEAD');
      expect(sha).toBe(headSha);
    });
  });

  describe('detectCurrentBranch', () => {
    it('returns the current branch name', async () => {
      await makeCommit(dir, 'a.txt', 'v1', 'initial');
      const branch = await detectCurrentBranch(dir);
      expect(typeof branch).toBe('string');
      expect(branch.length).toBeGreaterThan(0);
    });

    it('returns the branch after switching', async () => {
      await makeCommit(dir, 'a.txt', 'v1', 'initial');
      git(dir, 'checkout -b feature-branch');
      const branch = await detectCurrentBranch(dir);
      expect(branch).toBe('feature-branch');
    });
  });

  describe('detectTrackingRemote', () => {
    it('returns the tracking remote for a branch', async () => {
      const bare = await mkdtemp(join(tmpdir(), 'ralph-bare-'));
      git(bare, 'init --bare');
      git(dir, `remote add upstream ${bare}`);
      await makeCommit(dir, 'a.txt', 'v1', 'initial');
      git(dir, 'push -u upstream HEAD:main');
      const remote = await detectTrackingRemote(dir, 'main');
      expect(remote).toBe('upstream');
      await rm(bare, { recursive: true, force: true });
    });

    it('returns undefined when no tracking remote is configured', async () => {
      await makeCommit(dir, 'a.txt', 'v1', 'initial');
      const remote = await detectTrackingRemote(dir, 'main');
      expect(remote).toBeUndefined();
    });
  });

  describe('resolveGitTarget', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('auto-detects branch and defaults remote to origin', async () => {
      await makeCommit(dir, 'a.txt', 'v1', 'initial');
      const target = await resolveGitTarget(dir);
      expect(target.branch).toBeTruthy();
      expect(target.remote).toBe('origin');
    });

    it('uses tracking remote when available', async () => {
      const bare = await mkdtemp(join(tmpdir(), 'ralph-bare-'));
      git(bare, 'init --bare');
      git(dir, `remote add upstream ${bare}`);
      await makeCommit(dir, 'a.txt', 'v1', 'initial');
      git(dir, 'push -u upstream HEAD:main');
      const target = await resolveGitTarget(dir);
      expect(target.remote).toBe('upstream');
      await rm(bare, { recursive: true, force: true });
    });

    it('respects RALPH_GIT_REMOTE env var', async () => {
      await makeCommit(dir, 'a.txt', 'v1', 'initial');
      process.env.RALPH_GIT_REMOTE = 'custom-remote';
      const target = await resolveGitTarget(dir);
      expect(target.remote).toBe('custom-remote');
    });

    it('respects RALPH_GIT_BRANCH env var', async () => {
      await makeCommit(dir, 'a.txt', 'v1', 'initial');
      process.env.RALPH_GIT_BRANCH = 'develop';
      const target = await resolveGitTarget(dir);
      expect(target.branch).toBe('develop');
    });

    it('env vars take precedence over auto-detection', async () => {
      const bare = await mkdtemp(join(tmpdir(), 'ralph-bare-'));
      git(bare, 'init --bare');
      git(dir, `remote add upstream ${bare}`);
      await makeCommit(dir, 'a.txt', 'v1', 'initial');
      git(dir, 'push -u upstream HEAD:main');
      process.env.RALPH_GIT_REMOTE = 'override-remote';
      process.env.RALPH_GIT_BRANCH = 'override-branch';
      const target = await resolveGitTarget(dir);
      expect(target.remote).toBe('override-remote');
      expect(target.branch).toBe('override-branch');
      await rm(bare, { recursive: true, force: true });
    });
  });
});
