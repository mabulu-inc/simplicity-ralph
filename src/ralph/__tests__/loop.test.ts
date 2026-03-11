import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock external dependencies before importing
vi.mock('../core/process.js', () => ({
  spawnWithCapture: vi.fn(),
  monitorProcess: vi.fn(),
  killProcessTree: vi.fn(),
  findProcessesByPattern: vi.fn(),
}));

vi.mock('../core/git.js', () => ({
  getHeadSha: vi.fn(),
  discardUnstaged: vi.fn(),
  hasUnpushedCommits: vi.fn(),
  pushToRemote: vi.fn(),
  isWorkingTreeClean: vi.fn(),
}));

import * as processModule from '../core/process.js';
import * as gitModule from '../core/git.js';
import {
  parseLoopOptions,
  preflightChecks,
  generateBootPrompt,
  scaleForComplexity,
} from '../commands/loop.js';
import type { Task } from '../core/tasks.js';
import type { ProjectConfig } from '../core/config.js';

const spawnWithCapture = vi.mocked(processModule.spawnWithCapture);
const monitorProcess = vi.mocked(processModule.monitorProcess);
const getHeadSha = vi.mocked(gitModule.getHeadSha);
const discardUnstaged = vi.mocked(gitModule.discardUnstaged);
const hasUnpushedCommits = vi.mocked(gitModule.hasUnpushedCommits);
const pushToRemote = vi.mocked(gitModule.pushToRemote);

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
      db: true,
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

  it('parses --no-db', () => {
    expect(parseLoopOptions(['--no-db']).db).toBe(false);
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
      db: true,
    });
  });
});

describe('scaleForComplexity', () => {
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
      ...overrides,
    };
  }

  it('returns light tier defaults for simple tasks', () => {
    const result = scaleForComplexity(taskWith({}));
    expect(result).toEqual({ tier: 'light', maxTurns: 50, timeout: 600 });
  });

  it('returns standard tier for tasks with 2-3 deps', () => {
    const result = scaleForComplexity(taskWith({ depends: ['T-001', 'T-002'] }));
    expect(result).toEqual({ tier: 'standard', maxTurns: 75, timeout: 900 });
  });

  it('returns heavy tier for tasks with 4+ deps', () => {
    const result = scaleForComplexity(taskWith({ depends: ['T-001', 'T-002', 'T-003', 'T-004'] }));
    expect(result).toEqual({ tier: 'heavy', maxTurns: 125, timeout: 1200 });
  });

  it('returns heavy tier for integration keyword in title', () => {
    const result = scaleForComplexity(taskWith({ title: 'End-to-end integration tests' }));
    expect(result).toEqual({ tier: 'heavy', maxTurns: 125, timeout: 1200 });
  });

  it('returns standard tier for 3-4 produces', () => {
    const result = scaleForComplexity(taskWith({ producesCount: 3 }));
    expect(result).toEqual({ tier: 'standard', maxTurns: 75, timeout: 900 });
  });

  it('returns heavy tier for 5+ produces', () => {
    const result = scaleForComplexity(taskWith({ producesCount: 5 }));
    expect(result).toEqual({ tier: 'heavy', maxTurns: 125, timeout: 1200 });
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

  it('succeeds when tasks directory exists', async () => {
    await mkdir(join(tmpDir, 'docs', 'tasks'), { recursive: true });
    const result = await preflightChecks(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('generateBootPrompt', () => {
  const mockTask: Task = {
    id: 'T-005',
    number: 5,
    title: 'Build feature X',
    status: 'TODO',
    milestone: '2 — Core',
    depends: ['T-003', 'T-004'],
    prdReference: '§3.1',
    completed: undefined,
    commit: undefined,
    cost: undefined,
    blocked: false,
    description: 'Implement feature X as described in the PRD.',
  };

  const mockConfig: ProjectConfig = {
    language: 'TypeScript',
    fileNaming: 'kebab-case',
    packageManager: 'pnpm',
    testingFramework: 'Vitest',
    qualityCheck: 'pnpm check',
    testCommand: 'pnpm test',
    database: undefined,
  };

  it('includes the task ID and title', () => {
    const prompt = generateBootPrompt(mockTask, mockConfig);
    expect(prompt).toContain('T-005');
    expect(prompt).toContain('Build feature X');
  });

  it('includes PRD reference', () => {
    const prompt = generateBootPrompt(mockTask, mockConfig);
    expect(prompt).toContain('§3.1');
  });

  it('includes project config values', () => {
    const prompt = generateBootPrompt(mockTask, mockConfig);
    expect(prompt).toContain('TypeScript');
    expect(prompt).toContain('pnpm');
    expect(prompt).toContain('Vitest');
    expect(prompt).toContain('pnpm check');
  });

  it('includes TDD methodology instructions', () => {
    const prompt = generateBootPrompt(mockTask, mockConfig);
    expect(prompt).toContain('red');
    expect(prompt).toContain('green');
    expect(prompt).toContain('TDD');
  });

  it('includes quality gate instructions', () => {
    const prompt = generateBootPrompt(mockTask, mockConfig);
    expect(prompt).toContain('pnpm check');
    expect(prompt.toLowerCase()).toContain('quality');
  });

  it('includes one-commit-per-task rule', () => {
    const prompt = generateBootPrompt(mockTask, mockConfig);
    expect(prompt).toContain('ONE commit per task');
  });

  it('includes task file update instructions', () => {
    const prompt = generateBootPrompt(mockTask, mockConfig);
    expect(prompt).toContain('Status');
    expect(prompt).toContain('DONE');
    expect(prompt).toContain('same commit');
  });

  it('includes commit message format', () => {
    const prompt = generateBootPrompt(mockTask, mockConfig);
    expect(prompt).toContain('T-NNN:');
  });

  it('includes tool usage rules', () => {
    const prompt = generateBootPrompt(mockTask, mockConfig);
    expect(prompt).toContain('Read tool');
    expect(prompt).toContain('Grep');
  });

  it('includes phase logging instructions', () => {
    const prompt = generateBootPrompt(mockTask, mockConfig);
    expect(prompt).toContain('[PHASE]');
    expect(prompt).toContain('Boot');
    expect(prompt).toContain('Red');
    expect(prompt).toContain('Green');
    expect(prompt).toContain('Verify');
    expect(prompt).toContain('Commit');
  });

  it('includes bash timeout guidance', () => {
    const prompt = generateBootPrompt(mockTask, mockConfig);
    expect(prompt).toContain('120000ms');
    expect(prompt).toContain('120 seconds');
    expect(prompt).toContain('timeout');
  });
});

describe('run', () => {
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  async function setupProject(taskContent: string = TODO_TASK) {
    await mkdir(join(tmpDir, 'docs', 'tasks'), { recursive: true });
    await mkdir(join(tmpDir, '.claude'), { recursive: true });
    await writeFile(join(tmpDir, '.claude', 'CLAUDE.md'), CLAUDE_MD);
    await writeFile(join(tmpDir, 'docs', 'tasks', 'T-001.md'), taskContent);
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
    await mkdir(join(tmpDir, '.claude'), { recursive: true });
    await writeFile(join(tmpDir, '.claude', 'CLAUDE.md'), CLAUDE_MD);
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

    expect(pushToRemote).toHaveBeenCalledWith(tmpDir, 'origin', 'main');
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

    expect(discardUnstaged).toHaveBeenCalledWith(tmpDir);
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
});
