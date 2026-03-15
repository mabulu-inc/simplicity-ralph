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
  addAndCommit: vi.fn(),
}));

vi.mock('../commands/shas.js', () => ({
  run: vi.fn(),
}));

vi.mock('../commands/cost.js', () => ({
  run: vi.fn(),
}));

vi.mock('../commands/milestones.js', () => ({
  run: vi.fn(),
}));

import * as processModule from '../core/process.js';
import * as gitModule from '../core/git.js';
import * as shasModule from '../commands/shas.js';
import * as costModule from '../commands/cost.js';
import * as milestonesModule from '../commands/milestones.js';
import { LoopOrchestrator } from '../commands/loop/orchestrator.js';
import type { LoopOptions } from '../commands/loop/index.js';
import { registerProvider, resetRegistry, type AgentProvider } from '../core/agent-provider.js';
import { resetProviderInit } from '../providers/index.js';

const spawnWithCapture = vi.mocked(processModule.spawnWithCapture);
const monitorProcess = vi.mocked(processModule.monitorProcess);
const discardUnstaged = vi.mocked(gitModule.discardUnstaged);
const getHeadSha = vi.mocked(gitModule.getHeadSha);
const hasUnpushedCommits = vi.mocked(gitModule.hasUnpushedCommits);
const pushToRemote = vi.mocked(gitModule.pushToRemote);
const resolveGitTarget = vi.mocked(gitModule.resolveGitTarget);
const addAndCommit = vi.mocked(gitModule.addAndCommit);
const shasRun = vi.mocked(shasModule.run);
const costRun = vi.mocked(costModule.run);
const milestonesRun = vi.mocked(milestonesModule.run);

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
      'Task {{task.id}}: {{task.title}}\nConfig: {{config.language}}\n{{retryContext}}',
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
    addAndCommit.mockResolvedValue('meta123');
    shasRun.mockResolvedValue(undefined);
    costRun.mockResolvedValue(undefined);
    milestonesRun.mockResolvedValue(undefined);
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
    await writeFile(
      join(tmpDir, 'docs', 'prompts', 'boot.md'),
      'Task {{task.id}}: {{task.title}}\n{{retryContext}}',
    );
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

    expect(discardUnstaged).toHaveBeenCalledWith(
      tmpDir,
      expect.arrayContaining([
        'docs/tasks/',
        'docs/PRD.md',
        'docs/prompts/',
        'docs/RALPH-METHODOLOGY.md',
        'ralph.config.json',
      ]),
    );
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
      supportsSystemPrompt: false,
      systemPromptFlag: '',
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
      supportsSystemPrompt: false,
      systemPromptFlag: '',
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

  it('injects retry context when a task is retried after failure', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();

    // First iteration: non-zero exit (failure)
    // Second iteration: success
    monitorProcess
      .mockResolvedValueOnce({ exitCode: 1, timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, timedOut: false });

    // Create a log file that simulates the failed first attempt
    const logsDir = join(tmpDir, '.ralph-logs');
    await mkdir(logsDir, { recursive: true });
    const logContent = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '[PHASE] Entering: Verify' }] },
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'tool_result',
        tool_name: 'Bash',
        content: 'Error: test failed badly',
      }),
    ].join('\n');
    await writeFile(join(logsDir, 'T-001-20250101-120000.jsonl'), logContent);

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ iterations: 2 }));
    await orchestrator.execute();

    // The second spawn call should have a prompt containing retry context
    expect(spawnWithCapture).toHaveBeenCalledTimes(2);
    const secondCallArgs = spawnWithCapture.mock.calls[1][1] as string[];
    const allArgs = secondCallArgs.join(' ');
    expect(allArgs).toContain('Verify');
  });

  it('does not inject retry context on first attempt', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    const calledArgs = spawnWithCapture.mock.calls[0][1] as string[];
    const allArgs = calledArgs.join(' ');
    expect(allArgs).not.toContain('RETRY CONTEXT');
  });

  it('passes system prompt separately when system.md exists and provider supports it', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    await writeFile(
      join(tmpDir, 'docs', 'prompts', 'system.md'),
      'You are a methodology-following agent.',
    );
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    const calledArgs = spawnWithCapture.mock.calls[0][1] as string[];
    expect(calledArgs).toContain('--system-prompt');
    const flagIdx = calledArgs.indexOf('--system-prompt');
    expect(calledArgs[flagIdx + 1]).toBe('You are a methodology-following agent.');
  });

  it('concatenates system + user prompt when provider does not support system prompt', async () => {
    await setupProject();
    await writeFile(join(tmpDir, 'docs', 'prompts', 'system.md'), 'System rules.');
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const noSysProvider: AgentProvider = {
      binary: 'gemini',
      outputFormat: ['--output-format', 'stream-json'],
      supportsMaxTurns: false,
      supportsSystemPrompt: false,
      systemPromptFlag: '',
      instructionsFile: 'GEMINI.md',
      buildArgs: (prompt, options) => ['-p', prompt, ...options.outputFormat],
      parseOutput: (raw) => raw,
    };

    resetRegistry();
    registerProvider('gemini', noSysProvider);

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ agent: 'gemini' }));
    await orchestrator.execute();

    const calledArgs = spawnWithCapture.mock.calls[0][1] as string[];
    // System content should be concatenated into the prompt (second arg after -p)
    const promptArg = calledArgs[1]; // ['-p', prompt, ...]
    expect(promptArg).toContain('System rules.');
    expect(calledArgs).not.toContain('--system-prompt');
  });

  it('runs post-iteration metadata updates after commit detected', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    getHeadSha.mockResolvedValueOnce('aaa1111').mockResolvedValueOnce('bbb2222');

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    expect(shasRun).toHaveBeenCalledWith([], tmpDir);
    expect(costRun).toHaveBeenCalledWith(['--update-tasks'], tmpDir);
    expect(milestonesRun).toHaveBeenCalledWith([], tmpDir);
  });

  it('does not run post-iteration metadata updates when no commit detected', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    // HEAD unchanged
    getHeadSha.mockResolvedValue('same_sha');

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    expect(shasRun).not.toHaveBeenCalled();
    expect(costRun).not.toHaveBeenCalled();
    expect(milestonesRun).not.toHaveBeenCalled();
  });

  it('runs metadata updates before push', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    getHeadSha.mockResolvedValueOnce('aaa1111').mockResolvedValueOnce('bbb2222');
    hasUnpushedCommits.mockResolvedValue(true);

    const callOrder: string[] = [];
    shasRun.mockImplementation(async () => {
      callOrder.push('shas');
    });
    costRun.mockImplementation(async () => {
      callOrder.push('cost');
    });
    milestonesRun.mockImplementation(async () => {
      callOrder.push('milestones');
    });
    addAndCommit.mockImplementation(async () => {
      callOrder.push('metadataCommit');
      return 'meta1';
    });
    pushToRemote.mockImplementation(async () => {
      callOrder.push('push');
    });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ push: true }));
    await orchestrator.execute();

    const pushIdx = callOrder.indexOf('push');
    const shasIdx = callOrder.indexOf('shas');
    expect(shasIdx).toBeLessThan(pushIdx);
    expect(callOrder.indexOf('metadataCommit')).toBeLessThan(pushIdx);
  });

  it('logs warning and continues when a metadata update fails', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    getHeadSha.mockResolvedValueOnce('aaa1111').mockResolvedValueOnce('bbb2222');

    shasRun.mockRejectedValue(new Error('shas failed'));

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    // Should warn but not throw
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('shas'));
    // Cost and milestones should still be called
    expect(costRun).toHaveBeenCalled();
    expect(milestonesRun).toHaveBeenCalled();
  });

  it('creates a metadata commit after post-iteration updates', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    getHeadSha.mockResolvedValueOnce('aaa1111').mockResolvedValueOnce('bbb2222');

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    expect(addAndCommit).toHaveBeenCalledWith(
      tmpDir,
      expect.arrayContaining(['docs/tasks', 'docs/MILESTONES.md']),
      'Update task metadata',
    );
  });

  it('skips metadata commit when addAndCommit fails (nothing to commit)', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    getHeadSha.mockResolvedValueOnce('aaa1111').mockResolvedValueOnce('bbb2222');
    addAndCommit.mockRejectedValue(new Error('nothing to commit'));

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    // Should not throw
    await orchestrator.execute();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('metadata commit'));
  });

  it('injects retry context on timeout failure', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();

    monitorProcess
      .mockResolvedValueOnce({ exitCode: null, timedOut: true })
      .mockResolvedValueOnce({ exitCode: 0, timedOut: false });

    const logsDir = join(tmpDir, '.ralph-logs');
    await mkdir(logsDir, { recursive: true });
    const logContent = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '[PHASE] Entering: Green' }] },
      }),
    ].join('\n');
    await writeFile(join(logsDir, 'T-001-20250101-120000.jsonl'), logContent);

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ iterations: 2, timeout: 60 }));
    await orchestrator.execute();

    expect(spawnWithCapture).toHaveBeenCalledTimes(2);
    const secondCallArgs = spawnWithCapture.mock.calls[1][1] as string[];
    const allArgs = secondCallArgs.join(' ');
    expect(allArgs).toContain('Green');
  });
});
