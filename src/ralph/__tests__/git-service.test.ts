import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/git.js', () => ({
  getHeadSha: vi.fn(),
  discardUnstaged: vi.fn(),
  hasUnpushedCommits: vi.fn(),
  pushToRemote: vi.fn(),
  isWorkingTreeClean: vi.fn(),
  resolveGitTarget: vi.fn(),
}));

import * as gitModule from '../core/git.js';
import { LoopGitService } from '../commands/loop/git-service.js';

const discardUnstaged = vi.mocked(gitModule.discardUnstaged);
const getHeadSha = vi.mocked(gitModule.getHeadSha);
const hasUnpushedCommits = vi.mocked(gitModule.hasUnpushedCommits);
const pushToRemote = vi.mocked(gitModule.pushToRemote);
const resolveGitTarget = vi.mocked(gitModule.resolveGitTarget);

describe('LoopGitService', () => {
  let service: LoopGitService;
  const projectDir = '/test/project';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LoopGitService(projectDir);
    discardUnstaged.mockResolvedValue(undefined);
    getHeadSha.mockResolvedValue('abc1234');
    hasUnpushedCommits.mockResolvedValue(false);
    pushToRemote.mockResolvedValue(undefined);
    resolveGitTarget.mockResolvedValue({ remote: 'origin', branch: 'main' });
  });

  describe('discardUnstaged', () => {
    it('delegates to core git discardUnstaged', async () => {
      await service.discardUnstaged();
      expect(discardUnstaged).toHaveBeenCalledWith(projectDir);
    });

    it('returns error message on failure', async () => {
      discardUnstaged.mockRejectedValueOnce(new Error('checkout failed'));
      const result = await service.discardUnstaged();
      expect(result).toBe('checkout failed');
    });

    it('returns undefined on success', async () => {
      const result = await service.discardUnstaged();
      expect(result).toBeUndefined();
    });
  });

  describe('getHeadSha', () => {
    it('delegates to core git getHeadSha', async () => {
      await service.getHeadSha();
      expect(getHeadSha).toHaveBeenCalledWith(projectDir);
    });

    it('returns SHA on success', async () => {
      getHeadSha.mockResolvedValue('def5678');
      const result = await service.getHeadSha();
      expect(result).toEqual({ sha: 'def5678' });
    });

    it('returns error on failure', async () => {
      getHeadSha.mockRejectedValueOnce(new Error('not a git repo'));
      const result = await service.getHeadSha();
      expect(result).toEqual({ error: 'not a git repo' });
    });
  });

  describe('pushIfNeeded', () => {
    it('resolves git target and pushes when unpushed commits exist', async () => {
      hasUnpushedCommits.mockResolvedValue(true);
      const result = await service.pushIfNeeded();
      expect(resolveGitTarget).toHaveBeenCalledWith(projectDir);
      expect(hasUnpushedCommits).toHaveBeenCalledWith(projectDir, 'origin', 'main');
      expect(pushToRemote).toHaveBeenCalledWith(projectDir, 'origin', 'main');
      expect(result).toEqual({ pushed: true, remote: 'origin', branch: 'main' });
    });

    it('skips push when no unpushed commits', async () => {
      hasUnpushedCommits.mockResolvedValue(false);
      const result = await service.pushIfNeeded();
      expect(pushToRemote).not.toHaveBeenCalled();
      expect(result).toEqual({ pushed: false, remote: 'origin', branch: 'main' });
    });

    it('returns error on failure', async () => {
      hasUnpushedCommits.mockRejectedValueOnce(new Error('remote not found'));
      const result = await service.pushIfNeeded();
      expect(result).toEqual({ pushed: false, error: 'remote not found' });
    });

    it('uses resolved remote and branch', async () => {
      resolveGitTarget.mockResolvedValue({ remote: 'upstream', branch: 'develop' });
      hasUnpushedCommits.mockResolvedValue(true);
      const result = await service.pushIfNeeded();
      expect(hasUnpushedCommits).toHaveBeenCalledWith(projectDir, 'upstream', 'develop');
      expect(pushToRemote).toHaveBeenCalledWith(projectDir, 'upstream', 'develop');
      expect(result).toEqual({ pushed: true, remote: 'upstream', branch: 'develop' });
    });
  });
});
