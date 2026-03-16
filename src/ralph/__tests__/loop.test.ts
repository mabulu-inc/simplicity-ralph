import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock external dependencies before importing
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

vi.mock('../core/preflight.js', () => ({
  runPreflightCheck: vi.fn(),
  formatPreflightBaseline: vi.fn(),
  buildPreflightLogEntry: vi.fn(),
}));

import * as processModule from '../core/process.js';
import * as gitModule from '../core/git.js';
import * as preflightModule from '../core/preflight.js';
import { parseLoopOptions, preflightChecks, scaleForComplexity } from '../commands/loop.js';
import type { Task } from '../core/tasks.js';

const spawnWithCapture = vi.mocked(processModule.spawnWithCapture);
const monitorProcess = vi.mocked(processModule.monitorProcess);
const getHeadSha = vi.mocked(gitModule.getHeadSha);
const discardUnstaged = vi.mocked(gitModule.discardUnstaged);
const runPreflightCheck = vi.mocked(preflightModule.runPreflightCheck);
const formatPreflightBaseline = vi.mocked(preflightModule.formatPreflightBaseline);
const buildPreflightLogEntry = vi.mocked(preflightModule.buildPreflightLogEntry);
const hasUnpushedCommits = vi.mocked(gitModule.hasUnpushedCommits);
const pushToRemote = vi.mocked(gitModule.pushToRemote);
const resolveGitTarget = vi.mocked(gitModule.resolveGitTarget);

const CLAUDE_MD = `## Project-Specific Config\n\n- **Language**: TypeScript\n- **Package manager**: pnpm\n- **Testing framework**: Vitest\n- **Quality check**: \`pnpm check\`\n- **Test command**: \`pnpm test\`\n`;
const TODO_TASK = `# T-001: Test task\n\n- **Status**: TODO\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nA test task.\n`;

describe('parseLoopOptions', () => {
  it('returns defaults with no args', () => {
    const opts = parseLoopOptions([]);
    expect(opts).toEqual({
      iterations: 10,
      delay: 2,
      timeout: 0,
      maxTurns: 0,
      verbose: false,
      dryRun: false,
      push: true,
      agent: 'claude',
      allowDirty: false,
    });
  });

  it('parses -n / --iterations', () => {
    expect(parseLoopOptions(['-n', '5']).iterations).toBe(5);
    expect(parseLoopOptions(['--iterations', '0']).iterations).toBe(0);
  });

  it('parses -d / --delay', () => {
    expect(parseLoopOptions(['-d', '10']).delay).toBe(10);
    expect(parseLoopOptions(['--delay', '3']).delay).toBe(3);
  });

  it('parses -t / --timeout', () => {
    expect(parseLoopOptions(['-t', '600']).timeout).toBe(600);
    expect(parseLoopOptions(['--timeout', '1200']).timeout).toBe(1200);
  });

  it('parses -v / --verbose', () => {
    expect(parseLoopOptions(['-v']).verbose).toBe(true);
    expect(parseLoopOptions(['--verbose']).verbose).toBe(true);
  });

  it('parses --dry-run', () => {
    expect(parseLoopOptions(['--dry-run']).dryRun).toBe(true);
  });

  it('parses --no-push', () => {
    expect(parseLoopOptions(['--no-push']).push).toBe(false);
  });

  it('parses -m / --max-turns', () => {
    expect(parseLoopOptions(['-m', '50']).maxTurns).toBe(50);
    expect(parseLoopOptions(['--max-turns', '100']).maxTurns).toBe(100);
  });

  it('parses multiple options together', () => {
    const opts = parseLoopOptions([
      '-n',
      '3',
      '-t',
      '120',
      '-m',
      '75',
      '-v',
      '--no-push',
      '--dry-run',
    ]);
    expect(opts).toEqual({
      iterations: 3,
      delay: 2,
      timeout: 120,
      maxTurns: 75,
      verbose: true,
      dryRun: true,
      push: false,
      agent: 'claude',
      allowDirty: false,
    });
  });

  it('parses -a / --agent', () => {
    expect(parseLoopOptions(['-a', 'gemini']).agent).toBe('gemini');
    expect(parseLoopOptions(['--agent', 'codex']).agent).toBe('codex');
  });

  it('parses --allow-dirty', () => {
    expect(parseLoopOptions(['--allow-dirty']).allowDirty).toBe(true);
  });

  it('defaults allowDirty to false', () => {
    expect(parseLoopOptions([]).allowDirty).toBe(false);
  });
});

describe('scaleForComplexity', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function taskWith(overrides: Partial<Task>): Task {
    return {
      id: 'T-001',
      number: 1,
      title: 'Simple task',
      status: 'TODO',
      milestone: '1 — Setup',
      depends: [],
      prdReference: '§1',
      completed: undefined,
      commit: undefined,
      cost: undefined,
      blocked: false,
      description: 'A simple task.',
      producesCount: 1,
      touches: [],
      hints: '',
      complexity: undefined,
      ...overrides,
    };
  }

  it('returns light tier defaults for simple tasks', () => {
    const result = scaleForComplexity(taskWith({}));
    expect(result).toEqual({ tier: 'light', maxTurns: 50, timeout: 600, source: 'heuristic' });
  });

  it('uses overridden tier scaling from env vars', () => {
    process.env.RALPH_TIER_LIGHT_MAX_TURNS = '30';
    process.env.RALPH_TIER_LIGHT_TIMEOUT = '400';
    const result = scaleForComplexity(taskWith({}));
    expect(result).toEqual({ tier: 'light', maxTurns: 30, timeout: 400, source: 'heuristic' });
  });

  it('returns standard tier for tasks with 2-3 deps', () => {
    const result = scaleForComplexity(taskWith({ depends: ['T-001', 'T-002'] }));
    expect(result).toEqual({ tier: 'standard', maxTurns: 75, timeout: 900, source: 'heuristic' });
  });

  it('returns heavy tier for tasks with 4+ deps', () => {
    const result = scaleForComplexity(taskWith({ depends: ['T-001', 'T-002', 'T-003', 'T-004'] }));
    expect(result).toEqual({ tier: 'heavy', maxTurns: 125, timeout: 1200, source: 'heuristic' });
  });

  it('returns heavy tier for integration keyword in title', () => {
    const result = scaleForComplexity(taskWith({ title: 'End-to-end integration tests' }));
    expect(result).toEqual({ tier: 'heavy', maxTurns: 125, timeout: 1200, source: 'heuristic' });
  });

  it('returns standard tier for 3-4 produces', () => {
    const result = scaleForComplexity(taskWith({ producesCount: 3 }));
    expect(result).toEqual({ tier: 'standard', maxTurns: 75, timeout: 900, source: 'heuristic' });
  });

  it('returns heavy tier for 5+ produces', () => {
    const result = scaleForComplexity(taskWith({ producesCount: 5 }));
    expect(result).toEqual({ tier: 'heavy', maxTurns: 125, timeout: 1200, source: 'heuristic' });
  });

  it('uses explicit complexity from task file when present', () => {
    const result = scaleForComplexity(taskWith({ complexity: 'heavy' }));
    expect(result).toEqual({ tier: 'heavy', maxTurns: 125, timeout: 1200, source: 'task-file' });
  });

  it('uses explicit light complexity even when heuristic would say heavy', () => {
    const result = scaleForComplexity(
      taskWith({ complexity: 'light', depends: ['T-001', 'T-002', 'T-003', 'T-004'] }),
    );
    expect(result).toEqual({ tier: 'light', maxTurns: 50, timeout: 600, source: 'task-file' });
  });

  it('falls back to heuristic when complexity is undefined', () => {
    const result = scaleForComplexity(taskWith({ complexity: undefined }));
    expect(result).toEqual({ tier: 'light', maxTurns: 50, timeout: 600, source: 'heuristic' });
  });
});

describe('preflightChecks', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ralph-loop-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('fails when tasks directory does not exist', async () => {
    const result = await preflightChecks(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('docs/tasks/ directory not found');
  });

  it('fails when boot.md does not exist', async () => {
    await mkdir(join(tmpDir, 'docs', 'tasks'), { recursive: true });
    const result = await preflightChecks(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('docs/prompts/boot.md not found');
  });

  it('succeeds when tasks directory and boot.md exist', async () => {
    await mkdir(join(tmpDir, 'docs', 'tasks'), { recursive: true });
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await writeFile(join(tmpDir, 'docs', 'prompts', 'boot.md'), 'template');
    const result = await preflightChecks(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('run', () => {
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
    tmpDir = await mkdtemp(join(tmpdir(), 'ralph-loop-run-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    discardUnstaged.mockResolvedValue(undefined);
    getHeadSha.mockResolvedValue('abc1234');
    hasUnpushedCommits.mockResolvedValue(false);
    pushToRemote.mockResolvedValue(undefined);
    resolveGitTarget.mockResolvedValue({ remote: 'origin', branch: 'main' });
    runPreflightCheck.mockResolvedValue({ passed: true, output: '', timedOut: false });
    formatPreflightBaseline.mockReturnValue('');
    buildPreflightLogEntry.mockReturnValue('{"type":"preflight"}');
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('dry-run prints config with complexity tier and exits without spawning', async () => {
    await setupProject();

    const { run } = await import('../commands/loop.js');
    await run(['--dry-run'], tmpDir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('iterations');
    expect(output).toContain('timeout');
    expect(output).toContain('complexity tier');
    expect(output).toContain('max turns');
    expect(spawnWithCapture).not.toHaveBeenCalled();
  });

  it('exits with error when preflight checks fail', async () => {
    const { run } = await import('../commands/loop.js');
    await run([], tmpDir);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Pre-flight'));
  });

  it('exits with error when config is missing', async () => {
    await mkdir(join(tmpDir, 'docs', 'tasks'), { recursive: true });
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await writeFile(join(tmpDir, 'docs', 'prompts', 'boot.md'), 'template');

    const { run } = await import('../commands/loop.js');
    await run([], tmpDir);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to read config'));
  });

  it('exits when all tasks are done', async () => {
    const doneTask = TODO_TASK.replace('TODO', 'DONE');
    await setupProject(doneTask);

    const { run } = await import('../commands/loop.js');
    await run([], tmpDir);

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

    const { run } = await import('../commands/loop.js');
    await run([], tmpDir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No eligible task');
  });

  it('spawns claude with auto-scaled max-turns and timeout', async () => {
    await setupProject();
    const fakeChild = mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const { run } = await import('../commands/loop.js');
    await run(['-n', '1', '--no-push'], tmpDir);

    expect(spawnWithCapture).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--print', '--output-format', 'stream-json', '--max-turns', '50']),
      expect.objectContaining({ cwd: tmpDir }),
    );
    // Light tier: 600s timeout
    expect(monitorProcess).toHaveBeenCalledWith(
      fakeChild,
      expect.objectContaining({ timeoutMs: 600000 }),
    );
  });

  it('passes explicit --max-turns override to claude', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const { run } = await import('../commands/loop.js');
    await run(['-n', '1', '-m', '200', '--no-push'], tmpDir);

    expect(spawnWithCapture).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--max-turns', '200']),
      expect.objectContaining({ cwd: tmpDir }),
    );
  });

  it('uses explicit -t override instead of auto-scaled timeout', async () => {
    await setupProject();
    const fakeChild = mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const { run } = await import('../commands/loop.js');
    await run(['-n', '1', '-t', '300', '--no-push'], tmpDir);

    expect(monitorProcess).toHaveBeenCalledWith(
      fakeChild,
      expect.objectContaining({ timeoutMs: 300000 }),
    );
  });

  it('logs timeout when iteration exceeds time limit', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: null, timedOut: true });

    const { run } = await import('../commands/loop.js');
    await run(['-n', '1', '-t', '60', '--no-push'], tmpDir);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Timed out'));
  });

  it('logs error when claude exits with non-zero code', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 1, timedOut: false });

    const { run } = await import('../commands/loop.js');
    await run(['-n', '1', '--no-push'], tmpDir);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('exited with code 1'));
  });

  it('detects new commit after successful iteration', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    getHeadSha.mockResolvedValueOnce('aaa1111').mockResolvedValueOnce('bbb2222');

    const { run } = await import('../commands/loop.js');
    await run(['-n', '1', '--no-push'], tmpDir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Commit detected');
  });

  it('pushes to remote when push is enabled and commits exist', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    hasUnpushedCommits.mockResolvedValue(true);

    const { run } = await import('../commands/loop.js');
    await run(['-n', '1'], tmpDir);

    expect(resolveGitTarget).toHaveBeenCalledWith(tmpDir);
    expect(pushToRemote).toHaveBeenCalledWith(tmpDir, 'origin', 'main');
  });

  it('uses resolved git target for push operations', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    hasUnpushedCommits.mockResolvedValue(true);
    resolveGitTarget.mockResolvedValue({ remote: 'upstream', branch: 'develop' });

    const { run } = await import('../commands/loop.js');
    await run(['-n', '1'], tmpDir);

    expect(hasUnpushedCommits).toHaveBeenCalledWith(tmpDir, 'upstream', 'develop');
    expect(pushToRemote).toHaveBeenCalledWith(tmpDir, 'upstream', 'develop');
  });

  it('skips push when --no-push is set', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const { run } = await import('../commands/loop.js');
    await run(['-n', '1', '--no-push'], tmpDir);

    expect(hasUnpushedCommits).not.toHaveBeenCalled();
    expect(pushToRemote).not.toHaveBeenCalled();
  });

  it('discards unstaged changes before each iteration', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const { run } = await import('../commands/loop.js');
    await run(['-n', '1', '--no-push'], tmpDir);

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

  it('creates log directory and log file with task ID', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });

    const { run } = await import('../commands/loop.js');
    await run(['-n', '1', '--no-push'], tmpDir);

    expect(spawnWithCapture).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({
        logFile: expect.stringContaining('T-001-'),
      }),
    );
  });

  it('warns to stderr when discardUnstaged fails', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    discardUnstaged.mockRejectedValueOnce(new Error('git checkout failed'));

    const { run } = await import('../commands/loop.js');
    await run(['-n', '1', '--no-push'], tmpDir);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('discard unstaged'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('git checkout failed'));
  });

  it('warns to stderr when getHeadSha fails before iteration', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    getHeadSha.mockRejectedValueOnce(new Error('not a git repository'));

    const { run } = await import('../commands/loop.js');
    await run(['-n', '1', '--no-push'], tmpDir);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('HEAD SHA'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not a git repository'));
  });

  it('warns to stderr when getHeadSha fails after iteration', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    getHeadSha.mockResolvedValueOnce('abc1234').mockRejectedValueOnce(new Error('rev-parse error'));

    const { run } = await import('../commands/loop.js');
    await run(['-n', '1', '--no-push'], tmpDir);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('HEAD SHA'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('rev-parse error'));
  });

  it('warns to stderr when push fails', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    hasUnpushedCommits.mockResolvedValue(true);
    pushToRemote.mockRejectedValueOnce(new Error('authentication failed'));

    const { run } = await import('../commands/loop.js');
    await run(['-n', '1'], tmpDir);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('push'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('authentication failed'));
  });

  it('warns to stderr when hasUnpushedCommits fails', async () => {
    await setupProject();
    mockChildProcess();
    monitorProcess.mockResolvedValue({ exitCode: 0, timedOut: false });
    hasUnpushedCommits.mockRejectedValueOnce(new Error('remote not found'));

    const { run } = await import('../commands/loop.js');
    await run(['-n', '1'], tmpDir);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('push'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('remote not found'));
  });
});
