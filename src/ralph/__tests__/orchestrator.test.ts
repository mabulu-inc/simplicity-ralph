import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../core/process.js', () => ({
  spawnWithCapture: vi.fn(),
  monitorProcess: vi.fn(),
  killProcessTree: vi.fn(),
}));

vi.mock('../core/pid-file.js', () => ({
  writePidFile: vi.fn(),
  removePidFile: vi.fn(),
  readPidFile: vi.fn(),
}));

vi.mock('../core/git.js', () => ({
  getHeadSha: vi.fn(),
  discardUnstaged: vi.fn(),
  hasUnpushedCommits: vi.fn(),
  pushToRemote: vi.fn(),
  isWorkingTreeClean: vi.fn(),
  resolveGitTarget: vi.fn(),
}));

import * as processModule from '../core/process.js';
import * as gitModule from '../core/git.js';
import { LoopOrchestrator } from '../commands/loop/orchestrator.js';
import type { LoopOptions } from '../commands/loop/index.js';
import { registerProvider, resetRegistry, type AgentProvider } from '../core/agent-provider.js';

const spawnWithCapture = vi.mocked(processModule.spawnWithCapture);
const monitorProcess = vi.mocked(processModule.monitorProcess);
const discardUnstaged = vi.mocked(gitModule.discardUnstaged);
const getHeadSha = vi.mocked(gitModule.getHeadSha);
const hasUnpushedCommits = vi.mocked(gitModule.hasUnpushedCommits);
const pushToRemote = vi.mocked(gitModule.pushToRemote);
const resolveGitTarget = vi.mocked(gitModule.resolveGitTarget);

const CLAUDE_MD = `## Project-Specific Config\n\n- **Language**: TypeScript\n- **Package manager**: pnpm\n- **Testing framework**: Vitest\n- **Quality check**: \`pnpm check\`\n- **Test command**: \`pnpm test\`\n`;
const TODO_TASK = `# T-001: Test task\n\n- **Status**: TODO\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nA test task.\n`;

describe('LoopOrchestrator', () => {
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  async function setupProject(taskContent: string = TODO_TASK) {
    await mkdir(join(tmpDir, 'docs', 'tasks'), { recursive: true });
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await mkdir(join(tmpDir, '.claude'), { recursive: true });
    await writeFile(join(tmpDir, '.claude', 'CLAUDE.md'), CLAUDE_MD);
    await writeFile(join(tmpDir, 'docs', 'tasks', 'T-001.md'), taskContent);
    await writeFile(
      join(tmpDir, 'docs', 'prompts', 'boot.md'),
      'Task {{task.id}}: {{task.title}}\nConfig: {{config.language}}',
    );
  }

  function mockChildProcess() {
    const fakeChild = { pid: 12345, stdout: null, stderr: null } as unknown as ReturnType<
      typeof processModule.spawnWithCapture
    >;
    spawnWithCapture.mockReturnValue(fakeChild);
    return fakeChild;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await mkdtemp(join(tmpdir(), 'ralph-orch-test-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    discardUnstaged.mockResolvedValue(undefined);
    getHeadSha.mockResolvedValue('abc1234');
    hasUnpushedCommits.mockResolvedValue(false);
    pushToRemote.mockResolvedValue(undefined);
    resolveGitTarget.mockResolvedValue({ remote: 'origin', branch: 'main' });
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(tmpDir, { recursive: true, force: true });
  });

  function defaultOpts(overrides: Partial<LoopOptions> = {}): LoopOptions {
    return {
      iterations: 1,
      delay: 0,
      timeout: 0,
      maxTurns: 0,
      verbose: false,
      dryRun: false,
      push: false,
      db: true,
      agent: 'claude',
      ...overrides,
    };
  }

  it('exits when all tasks are done', async () => {
    const doneTask = TODO_TASK.replace('TODO', 'DONE');
    await setupProject(doneTask);

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('All tasks are DONE');
  });

  it('exits when no eligible task found', async () => {
    await mkdir(join(tmpDir, 'docs', 'tasks'), { recursive: true });
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await mkdir(join(tmpDir, '.claude'), { recursive: true });
    await writeFile(join(tmpDir, '.claude', 'CLAUDE.md'), CLAUDE_MD);
    await writeFile(join(tmpDir, 'docs', 'prompts', 'boot.md'), 'Task {{task.id}}: {{task.title}}');
    await writeFile(
      join(tmpDir, 'docs', 'tasks', 'T-002.md'),
      `# T-002: Blocked task\n\n- **Status**: TODO\n- **Milestone**: 1 — Setup\n- **Depends**: T-001\n- **PRD Reference**: §1\n\n## Description\n\nA blocked task.\n`,
    );

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No eligible task');
  });

  it('spawns claude with auto-scaled max-turns and timeout', async () => {
    await setupProject();
    const fakeChild = mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    expect(spawnWithCapture).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--print', '--output-format', 'stream-json', '--max-turns', '50']),
      expect.objectContaining({ cwd: tmpDir }),
    );
    expect(monitorProcess).toHaveBeenCalledWith(
      fakeChild,
      expect.objectContaining({ timeoutMs: 600000 }),
    );
  });

  it('passes explicit max-turns override to claude', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ maxTurns: 200 }));
    await orchestrator.execute();

    expect(spawnWithCapture).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--max-turns', '200']),
      expect.objectContaining({ cwd: tmpDir }),
    );
  });

  it('uses explicit timeout override', async () => {
    await setupProject();
    const fakeChild = mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ timeout: 300 }));
    await orchestrator.execute();

    expect(monitorProcess).toHaveBeenCalledWith(
      fakeChild,
      expect.objectContaining({ timeoutMs: 300000 }),
    );
  });

  it('logs timeout when iteration exceeds time limit', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: null, timedOut: true });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ timeout: 60 }));
    await orchestrator.execute();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Timed out'));
  });

  it('logs error when claude exits with non-zero code', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 1, timedOut: false });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('exited with code 1'));
  });

  it('detects new commit after successful iteration', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    getHeadSha.mockResolvedValueOnce('aaa1111').mockResolvedValueOnce('bbb2222');

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Commit detected');
  });

  it('pushes to remote when push is enabled', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    hasUnpushedCommits.mockResolvedValue(true);

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ push: true }));
    await orchestrator.execute();

    expect(resolveGitTarget).toHaveBeenCalledWith(tmpDir);
    expect(pushToRemote).toHaveBeenCalledWith(tmpDir, 'origin', 'main');
  });

  it('skips push when --no-push', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ push: false }));
    await orchestrator.execute();

    expect(hasUnpushedCommits).not.toHaveBeenCalled();
    expect(pushToRemote).not.toHaveBeenCalled();
  });

  it('discards unstaged changes before each iteration', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    expect(discardUnstaged).toHaveBeenCalledWith(tmpDir);
  });

  it('creates log file with task ID', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    expect(spawnWithCapture).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({
        logFile: expect.stringContaining('T-001-'),
      }),
    );
  });

  it('warns when discardUnstaged fails', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    discardUnstaged.mockRejectedValueOnce(new Error('git checkout failed'));

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('discard unstaged'));
  });

  it('warns when getHeadSha fails before iteration', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    getHeadSha.mockRejectedValueOnce(new Error('not a git repository'));

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('HEAD SHA'));
  });

  it('warns when push fails', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    hasUnpushedCommits.mockResolvedValue(true);
    pushToRemote.mockRejectedValueOnce(new Error('authentication failed'));

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ push: true }));
    await orchestrator.execute();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('push'));
  });

  it('uses a custom provider when --agent specifies one', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const customProvider: AgentProvider = {
      binary: 'gemini',
      outputFormat: ['--output-format', 'stream-json'],
      supportsMaxTurns: false,
      instructionsFile: 'GEMINI.md',
      buildArgs: (prompt, options) => ['-p', prompt, ...options.outputFormat],
      parseOutput: (raw) => raw,
    };

    resetRegistry();
    registerProvider('gemini', customProvider);

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ agent: 'gemini' }));
    await orchestrator.execute();

    expect(spawnWithCapture).toHaveBeenCalledWith(
      'gemini',
      ['-p', expect.any(String), '--output-format', 'stream-json'],
      expect.objectContaining({ cwd: tmpDir }),
    );
  });

  it('omits max-turns for providers that do not support it', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const noMaxTurnsProvider: AgentProvider = {
      binary: 'codex',
      outputFormat: ['--json'],
      supportsMaxTurns: false,
      instructionsFile: 'AGENTS.md',
      buildArgs: (prompt, options) => {
        const args = ['exec', ...options.outputFormat];
        if (options.maxTurns !== undefined) {
          args.push('--max-turns', String(options.maxTurns));
        }
        args.push('-p', prompt);
        return args;
      },
      parseOutput: (raw) => raw,
    };

    resetRegistry();
    registerProvider('codex', noMaxTurnsProvider);

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ agent: 'codex' }));
    await orchestrator.execute();

    const calledArgs = spawnWithCapture.mock.calls[0][1];
    expect(calledArgs).not.toContain('--max-turns');
  });

  it('throws when an unknown agent is specified', () => {
    resetRegistry();
    expect(() => new LoopOrchestrator(tmpDir, defaultOpts({ agent: 'unknown' }))).toThrow(
      'Unknown agent provider: unknown',
    );
  });
});
