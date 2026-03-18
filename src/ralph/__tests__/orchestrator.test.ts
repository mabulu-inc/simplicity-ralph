import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../core/process.js', () => ({
  spawnWithCapture: vi.fn(),
  monitorProcess: vi.fn(),
  killProcessTree: vi.fn(),
}));

vi.mock('../core/jsonl-result.js', () => ({
  parseSessionResult: vi.fn(),
}));

vi.mock('../core/preflight.js', () => ({
  runPreflightCheck: vi.fn(),
  formatPreflightBaseline: vi.fn(),
  buildPreflightLogEntry: vi.fn(),
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
import * as jsonlModule from '../core/jsonl-result.js';
import * as preflightModule from '../core/preflight.js';
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
const parseSessionResult = vi.mocked(jsonlModule.parseSessionResult);
const runPreflightCheck = vi.mocked(preflightModule.runPreflightCheck);
const formatPreflightBaseline = vi.mocked(preflightModule.formatPreflightBaseline);
const buildPreflightLogEntry = vi.mocked(preflightModule.buildPreflightLogEntry);
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
    parseSessionResult.mockResolvedValue(undefined);
    runPreflightCheck.mockResolvedValue({ passed: true, output: '', timedOut: false });
    formatPreflightBaseline.mockReturnValue('');
    buildPreflightLogEntry.mockReturnValue('{"type":"preflight"}');
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
      allowDirty: false,
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
    expect(output).toContain('re-run with -v for details');
  });

  it('prints per-task diagnostic in verbose mode when no eligible task found', async () => {
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

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ verbose: true }));
    await orchestrator.execute();

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('1 TODO tasks remain');
    expect(output).toContain('T-002');
    expect(output).toContain('T-001');
    expect(output).toContain('unknown task');
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

  it('logs complexity tier and effective limits at iteration start', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Complexity: light');
    expect(output).toContain('50 turns');
    expect(output).toContain('600s timeout');
  });

  it('logs specific message when session hits max turns', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 1, timedOut: false });
    parseSessionResult.mockResolvedValue({
      subtype: 'error_max_turns',
      numTurns: 50,
      stopReason: 'max_turns',
    });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    const errors = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(errors).toContain('exhausted all 50 turns');
    expect(errors).toContain('light');
    expect(errors).toContain('--max-turns');
  });

  it('logs turns used on successful commit', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    getHeadSha.mockResolvedValueOnce('aaa1111').mockResolvedValueOnce('bbb2222');
    parseSessionResult.mockResolvedValue({
      subtype: 'success',
      numTurns: 42,
      stopReason: 'end_turn',
    });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('used 42/50 turns');
  });

  it('falls back to generic error when JSONL parse returns no result', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 1, timedOut: false });
    parseSessionResult.mockResolvedValue(undefined);

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    const errors = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(errors).toContain('exited with code 1');
  });

  it('marks task as BLOCKED after maxRetries failures and moves on', async () => {
    resetRegistry();
    resetProviderInit();

    // Setup with ralph.config.json that has maxRetries: 2
    await mkdir(join(tmpDir, 'docs', 'tasks'), { recursive: true });
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await writeFile(
      join(tmpDir, 'ralph.config.json'),
      JSON.stringify({
        language: 'TypeScript',
        packageManager: 'pnpm',
        testingFramework: 'Vitest',
        qualityCheck: 'pnpm check',
        testCommand: 'pnpm test',
        maxRetries: 2,
      }),
    );
    await writeFile(join(tmpDir, 'docs', 'tasks', 'T-001.md'), TODO_TASK);
    await writeFile(
      join(tmpDir, 'docs', 'tasks', 'T-002.md'),
      `# T-002: Second task\n\n- **Status**: TODO\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nAnother task.\n`,
    );
    await writeFile(
      join(tmpDir, 'docs', 'prompts', 'boot.md'),
      'Task {{task.id}}: {{task.title}}\nConfig: {{config.language}}\n{{retryContext}}',
    );

    // Create 2 existing log files for T-001 (simulating 2 prior failures)
    const logsDir = join(tmpDir, '.ralph-logs');
    await mkdir(logsDir, { recursive: true });
    await writeFile(join(logsDir, 'T-001-20250101-120000.jsonl'), '{}');
    await writeFile(join(logsDir, 'T-001-20250101-130000.jsonl'), '{}');

    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ iterations: 1 }));
    await orchestrator.execute();

    // T-001 should now be BLOCKED in the task file
    const { readFile: rf } = await import('node:fs/promises');
    const t001Content = await rf(join(tmpDir, 'docs', 'tasks', 'T-001.md'), 'utf-8');
    expect(t001Content).toContain('**Status**: BLOCKED');
    expect(t001Content).toContain('**Blocked reason**:');

    // The orchestrator should have moved on to T-002
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('T-001');
    expect(output).toContain('BLOCKED');
  });

  it('detects [BLOCKED] signal in agent output and marks task BLOCKED', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();
    // Agent exits 0 but no commit (HEAD unchanged) — BLOCKED signal in log
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    getHeadSha.mockResolvedValue('same_sha');

    // Write a log file that contains [BLOCKED] signal
    // The orchestrator writes to .ralph-logs/T-001-<timestamp>.jsonl
    // We need to intercept spawnWithCapture to write a log with BLOCKED signal
    const logsDir = join(tmpDir, '.ralph-logs');
    await mkdir(logsDir, { recursive: true });

    // Override spawnWithCapture to write a blocked log
    spawnWithCapture.mockImplementation((_cmd, _args, opts) => {
      const logFile = (opts as { logFile?: string }).logFile;
      if (logFile) {
        const blockedLog = JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: '[BLOCKED] Same circular dependency as previous attempt' },
            ],
          },
        });
        writeFileSync(logFile, blockedLog + '\n');
      }
      return { pid: 12345, stdout: null, stderr: null } as unknown as ReturnType<
        typeof processModule.spawnWithCapture
      >;
    });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    // Should log the BLOCKED detection
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('BLOCKED');
    expect(output).toContain('circular dependency');
  });

  it('does not mark task as BLOCKED when retries are under the limit', async () => {
    resetRegistry();
    resetProviderInit();

    await mkdir(join(tmpDir, 'docs', 'tasks'), { recursive: true });
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await writeFile(
      join(tmpDir, 'ralph.config.json'),
      JSON.stringify({
        language: 'TypeScript',
        packageManager: 'pnpm',
        testingFramework: 'Vitest',
        qualityCheck: 'pnpm check',
        testCommand: 'pnpm test',
        maxRetries: 3,
      }),
    );
    await writeFile(join(tmpDir, 'docs', 'tasks', 'T-001.md'), TODO_TASK);
    await writeFile(
      join(tmpDir, 'docs', 'prompts', 'boot.md'),
      'Task {{task.id}}: {{task.title}}\nConfig: {{config.language}}\n{{retryContext}}',
    );

    // Only 1 existing log file (under maxRetries of 3)
    const logsDir = join(tmpDir, '.ralph-logs');
    await mkdir(logsDir, { recursive: true });
    await writeFile(join(logsDir, 'T-001-20250101-120000.jsonl'), '{}');

    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 1, timedOut: false });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ iterations: 1 }));
    await orchestrator.execute();

    // T-001 should still be TODO
    const { readFile: rf } = await import('node:fs/promises');
    const t001Content = await rf(join(tmpDir, 'docs', 'tasks', 'T-001.md'), 'utf-8');
    expect(t001Content).toContain('**Status**: TODO');
    expect(t001Content).not.toContain('BLOCKED');
  });

  it('runs preflight check once before the loop starts', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ iterations: 2 }));
    // Make second iteration find all tasks done
    monitorProcess
      .mockResolvedValueOnce({ exitCode: 0, timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, timedOut: false });

    await orchestrator.execute();

    // Preflight should only be called once, not per-iteration
    expect(runPreflightCheck).toHaveBeenCalledTimes(1);
    expect(runPreflightCheck).toHaveBeenCalledWith(
      'pnpm check',
      expect.objectContaining({ cwd: tmpDir }),
    );
  });

  it('logs preflight result to preflight.jsonl', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    buildPreflightLogEntry.mockReturnValue('{"type":"preflight","passed":true}');

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    const { readFile: rf } = await import('node:fs/promises');
    const logContent = await rf(join(tmpDir, '.ralph-logs', 'preflight.jsonl'), 'utf-8');
    expect(logContent).toContain('preflight');
  });

  it('aborts with error when preflight fails and allowDirty is false', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    runPreflightCheck.mockResolvedValue({
      passed: false,
      output: 'Error: lint failed\nsome details',
      timedOut: false,
    });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ allowDirty: false }));
    await orchestrator.execute();

    const errOutput = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(errOutput).toContain('Preflight');
    expect(errOutput).toContain('lint failed');
    // Should NOT spawn the agent
    expect(spawnWithCapture).not.toHaveBeenCalled();
  });

  it('sets process.exitCode to 1 when preflight fails and allowDirty is false', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();

    runPreflightCheck.mockResolvedValue({
      passed: false,
      output: 'Error: lint failed',
      timedOut: false,
    });

    const originalExitCode = process.exitCode;
    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ allowDirty: false }));
    await orchestrator.execute();

    expect(process.exitCode).toBe(1);
    process.exitCode = originalExitCode;
  });

  it('injects preflight baseline into prompt when preflight fails and allowDirty is true', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    await writeFile(
      join(tmpDir, 'docs', 'prompts', 'boot.md'),
      'Task {{task.id}}\n{{preflightBaseline}}\n{{retryContext}}',
    );
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    runPreflightCheck.mockResolvedValue({
      passed: false,
      output: 'Error: lint failed',
      timedOut: false,
    });
    formatPreflightBaseline.mockReturnValue(
      '# Pre-existing failures\nDo not fix these.\n```\nError: lint failed\n```',
    );

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ allowDirty: true }));
    await orchestrator.execute();

    const calledArgs = spawnWithCapture.mock.calls[0][1] as string[];
    const allArgs = calledArgs.join(' ');
    expect(allArgs).toContain('Pre-existing failures');
  });

  it('does not inject baseline when preflight passes', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    await writeFile(
      join(tmpDir, 'docs', 'prompts', 'boot.md'),
      'Task {{task.id}}\n[{{preflightBaseline}}]\n{{retryContext}}',
    );
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    runPreflightCheck.mockResolvedValue({ passed: true, output: 'ok', timedOut: false });
    formatPreflightBaseline.mockReturnValue('');

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    const calledArgs = spawnWithCapture.mock.calls[0][1] as string[];
    const allArgs = calledArgs.join(' ');
    expect(allArgs).not.toContain('Pre-existing failures');
  });

  it('logs warning and proceeds when preflight times out', async () => {
    resetRegistry();
    resetProviderInit();
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    runPreflightCheck.mockResolvedValue({ passed: false, output: '', timedOut: true });
    formatPreflightBaseline.mockReturnValue('');

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Preflight: timed out');
    // Should still spawn the agent
    expect(spawnWithCapture).toHaveBeenCalled();
  });

  it('marks task BLOCKED when cumulative cost exceeds maxCostPerTask', async () => {
    resetRegistry();
    resetProviderInit();

    await mkdir(join(tmpDir, 'docs', 'tasks'), { recursive: true });
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await writeFile(
      join(tmpDir, 'ralph.config.json'),
      JSON.stringify({
        language: 'TypeScript',
        packageManager: 'pnpm',
        testingFramework: 'Vitest',
        qualityCheck: 'pnpm check',
        testCommand: 'pnpm test',
        maxCostPerTask: 0.01,
      }),
    );
    await writeFile(join(tmpDir, 'docs', 'tasks', 'T-001.md'), TODO_TASK);
    await writeFile(
      join(tmpDir, 'docs', 'tasks', 'T-002.md'),
      `# T-002: Second task\n\n- **Status**: TODO\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nAnother task.\n`,
    );
    await writeFile(
      join(tmpDir, 'docs', 'prompts', 'boot.md'),
      'Task {{task.id}}: {{task.title}}\nConfig: {{config.language}}\n{{retryContext}}',
    );

    // Create a log file with high cost usage for T-001
    const logsDir = join(tmpDir, '.ralph-logs');
    await mkdir(logsDir, { recursive: true });
    const expensiveLog = JSON.stringify({
      type: 'result',
      usage: {
        input_tokens: 1_000_000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 1_000_000,
      },
    });
    await writeFile(join(logsDir, 'T-001-20250101-120000.jsonl'), expensiveLog);

    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ iterations: 1 }));
    await orchestrator.execute();

    // T-001 should be BLOCKED due to cost
    const { readFile: rf } = await import('node:fs/promises');
    const t001Content = await rf(join(tmpDir, 'docs', 'tasks', 'T-001.md'), 'utf-8');
    expect(t001Content).toContain('**Status**: BLOCKED');
    expect(t001Content).toContain('cost limit exceeded');

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('BLOCKED');
    expect(output).toContain('cost');
  });

  it('stops the loop when total spend exceeds maxLoopBudget', async () => {
    resetRegistry();
    resetProviderInit();

    await mkdir(join(tmpDir, 'docs', 'tasks'), { recursive: true });
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await writeFile(
      join(tmpDir, 'ralph.config.json'),
      JSON.stringify({
        language: 'TypeScript',
        packageManager: 'pnpm',
        testingFramework: 'Vitest',
        qualityCheck: 'pnpm check',
        testCommand: 'pnpm test',
        maxLoopBudget: 0.01,
      }),
    );
    await writeFile(join(tmpDir, 'docs', 'tasks', 'T-001.md'), TODO_TASK);
    await writeFile(
      join(tmpDir, 'docs', 'prompts', 'boot.md'),
      'Task {{task.id}}: {{task.title}}\nConfig: {{config.language}}\n{{retryContext}}',
    );

    // Simulate a completed expensive iteration by writing a log file with cost in the log
    const logsDir = join(tmpDir, '.ralph-logs');
    await mkdir(logsDir, { recursive: true });

    mockChildProcess();
    // First iteration succeeds but after it completes, cost tracking will find the expensive log
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    // Override spawnWithCapture to write an expensive log file
    spawnWithCapture.mockImplementation((_cmd, _args, opts) => {
      const logFile = (opts as { logFile?: string }).logFile;
      if (logFile) {
        const expensiveLog = JSON.stringify({
          type: 'result',
          usage: {
            input_tokens: 1_000_000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 1_000_000,
          },
        });
        writeFileSync(logFile, expensiveLog + '\n');
      }
      return { pid: 12345, stdout: null, stderr: null } as unknown as ReturnType<
        typeof processModule.spawnWithCapture
      >;
    });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts({ iterations: 5 }));
    await orchestrator.execute();

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('loop budget exceeded');
  });

  it('writes loop-start.json snapshot before first iteration', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    const snapshotPath = join(tmpDir, '.ralph-logs', 'loop-start.json');
    const raw = await readFile(snapshotPath, 'utf-8');
    const snapshot = JSON.parse(raw);
    expect(snapshot.doneAtStart).toBe(0);
    expect(snapshot.total).toBe(1);
    expect(typeof snapshot.startedAt).toBe('string');
  });

  it('records correct doneAtStart when some tasks already completed', async () => {
    await mkdir(join(tmpDir, 'docs', 'tasks'), { recursive: true });
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await mkdir(join(tmpDir, '.claude'), { recursive: true });
    await writeFile(join(tmpDir, '.claude', 'CLAUDE.md'), CLAUDE_MD);
    await writeFile(
      join(tmpDir, 'docs', 'prompts', 'boot.md'),
      'Task {{task.id}}: {{task.title}}\nConfig: {{config.language}}\n{{retryContext}}',
    );
    await writeFile(
      join(tmpDir, 'docs', 'tasks', 'T-001.md'),
      `# T-001: Done task\n\n- **Status**: DONE\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nDone.\n`,
    );
    await writeFile(
      join(tmpDir, 'docs', 'tasks', 'T-002.md'),
      `# T-002: Todo task\n\n- **Status**: TODO\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nTodo.\n`,
    );
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const orchestrator = new LoopOrchestrator(tmpDir, defaultOpts());
    await orchestrator.execute();

    const snapshotPath = join(tmpDir, '.ralph-logs', 'loop-start.json');
    const raw = await readFile(snapshotPath, 'utf-8');
    const snapshot = JSON.parse(raw);
    expect(snapshot.doneAtStart).toBe(1);
    expect(snapshot.total).toBe(2);
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
