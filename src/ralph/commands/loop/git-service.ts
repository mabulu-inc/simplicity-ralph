import {
  addAndCommit,
  discardUnstaged,
  getHeadSha,
  hasUnpushedCommits,
  isWorkingTreeClean,
  pushToRemote,
  resolveGitTarget,
} from '../../core/git.js';

export interface PushResult {
  pushed: boolean;
  remote?: string;
  branch?: string;
  error?: string;
}

export interface ShaResult {
  sha?: string;
  error?: string;
}

export class LoopGitService {
  constructor(private readonly projectDir: string) {}

  async discardUnstaged(): Promise<string | undefined> {
    try {
      await discardUnstaged(this.projectDir);
      return undefined;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  async getHeadSha(): Promise<ShaResult> {
    try {
      const sha = await getHeadSha(this.projectDir);
      return { sha };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async commitMetadata(
    files: string[],
    message: string,
  ): Promise<{ sha?: string; error?: string; skipped?: boolean }> {
    try {
      const clean = await isWorkingTreeClean(this.projectDir);
      if (clean) {
        return { skipped: true };
      }
      const sha = await addAndCommit(this.projectDir, files, message);
      return { sha };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async pushIfNeeded(): Promise<PushResult> {
    try {
      const gitTarget = await resolveGitTarget(this.projectDir);
      const unpushed = await hasUnpushedCommits(
        this.projectDir,
        gitTarget.remote,
        gitTarget.branch,
      );
      if (unpushed) {
        await pushToRemote(this.projectDir, gitTarget.remote, gitTarget.branch);
        return { pushed: true, remote: gitTarget.remote, branch: gitTarget.branch };
      }
      return { pushed: false, remote: gitTarget.remote, branch: gitTarget.branch };
    } catch (err) {
      return { pushed: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
