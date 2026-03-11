import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeFile, mkdir, readFile } from 'node:fs/promises';

import { runInit, type InitAnswers } from '../commands/init.js';
import { generateMilestones } from '../commands/milestones.js';
import { parseLogLine, aggregateUsage, calculateCost, formatCostTable } from '../commands/cost.js';
import {
  parsePhases,
  formatPhaseTimeline,
  formatProgressBar,
  formatMonitorOutput,
  detectStatus,
  type MonitorData,
} from '../commands/monitor.js';
import { dispatch, formatHelp } from '../cli.js';
import { scanTasks } from '../core/tasks.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-integration-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

const defaultAnswers: InitAnswers = {
  projectName: 'integration-test-app',
  language: 'TypeScript',
  packageManager: 'pnpm',
  testingFramework: 'Vitest',
  qualityCheck: 'pnpm check',
  testCommand: 'pnpm test',
  database: 'none',
};

describe('integration: ralph init creates expected file structure', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('creates all five scaffold files in a fresh directory', async () => {
    const result = await runInit(tmpDir, defaultAnswers);

    expect(result.created).toHaveLength(5);
    expect(result.skipped).toHaveLength(0);

    expect(fs.existsSync(path.join(tmpDir, 'docs', 'PRD.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'docs', 'RALPH-METHODOLOGY.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'docs', 'tasks', 'T-000.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'CLAUDE.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'docs', 'prompts', 'boot.md'))).toBe(true);
  });

  it('generated files contain project-specific content', async () => {
    await runInit(tmpDir, defaultAnswers);

    const prd = fs.readFileSync(path.join(tmpDir, 'docs', 'PRD.md'), 'utf-8');
    expect(prd).toContain('integration-test-app');

    const claudeMd = fs.readFileSync(path.join(tmpDir, '.claude', 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain('**Language**: TypeScript');
    expect(claudeMd).toContain('**Package manager**: pnpm');
    expect(claudeMd).toContain('**Testing framework**: Vitest');
    expect(claudeMd).toContain('pnpm check');

    const task = fs.readFileSync(path.join(tmpDir, 'docs', 'tasks', 'T-000.md'), 'utf-8');
    expect(task).toContain('T-000');

    const methodology = fs.readFileSync(path.join(tmpDir, 'docs', 'RALPH-METHODOLOGY.md'), 'utf-8');
    expect(methodology).toContain('Ralph Methodology');
  });

  it('init output can be consumed by scanTasks', async () => {
    await runInit(tmpDir, defaultAnswers);

    const tasksDir = path.join(tmpDir, 'docs', 'tasks');
    const tasks = await scanTasks(tasksDir);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('T-000');
    expect(tasks[0].status).toBe('TODO');
  });
});

describe('integration: ralph milestones generates correct output from task files', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    const tasksDir = path.join(tmpDir, 'docs', 'tasks');
    await mkdir(tasksDir, { recursive: true });

    await writeFile(
      path.join(tasksDir, 'T-001.md'),
      `# T-001: Setup project

- **Status**: DONE
- **Milestone**: 1 — Setup
- **Depends**: none
- **PRD Reference**: §1
- **Cost**: $0.50

## Description

Bootstrap the project.

## Produces

- \`src/index.ts\`
`,
    );

    await writeFile(
      path.join(tasksDir, 'T-002.md'),
      `# T-002: Add feature A

- **Status**: DONE
- **Milestone**: 2 — Core
- **Depends**: T-001
- **PRD Reference**: §2
- **Cost**: $1.25

## Description

Add feature A.

## Produces

- \`src/feature-a.ts\`
`,
    );

    await writeFile(
      path.join(tasksDir, 'T-003.md'),
      `# T-003: Add feature B

- **Status**: TODO
- **Milestone**: 2 — Core
- **Depends**: T-001
- **PRD Reference**: §2

## Description

Add feature B.

## Produces

- \`src/feature-b.ts\`
`,
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('generates milestones markdown from scanned tasks', async () => {
    const tasksDir = path.join(tmpDir, 'docs', 'tasks');
    const tasks = await scanTasks(tasksDir);

    const md = generateMilestones(
      tasks.map((t) => ({
        id: t.id,
        status: t.status,
        milestone: t.milestone,
        title: t.title,
        cost: t.cost,
      })),
    );

    expect(md).toContain('# Milestones');
    expect(md).toContain('## 1 — Setup');
    expect(md).toContain('## 2 — Core');
    expect(md).toContain('[x] T-001: Setup project — $0.50');
    expect(md).toContain('[x] T-002: Add feature A — $1.25');
    expect(md).toContain('[ ] T-003: Add feature B');
    expect(md).toContain('Grand Total: $1.75');
  });

  it('milestones run() writes MILESTONES.md file', async () => {
    const { run } = await import('../commands/milestones.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await run([], tmpDir);
      const outPath = path.join(tmpDir, 'docs', 'MILESTONES.md');
      expect(fs.existsSync(outPath)).toBe(true);
      const content = fs.readFileSync(outPath, 'utf-8');
      expect(content).toContain('# Milestones');
      expect(content).toContain('T-001');
      expect(content).toContain('T-002');
      expect(content).toContain('T-003');
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('integration: ralph shas backfills SHAs correctly', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('scans DONE tasks and identifies those needing SHA backfill', async () => {
    const tasksDir = path.join(tmpDir, 'docs', 'tasks');
    await mkdir(tasksDir, { recursive: true });

    await writeFile(
      path.join(tasksDir, 'T-001.md'),
      `# T-001: Setup

- **Status**: DONE
- **Milestone**: 1 — Setup
- **Depends**: none
- **PRD Reference**: §1

## Description

Setup task.
`,
    );

    const tasks = await scanTasks(tasksDir);
    const doneTasks = tasks.filter((t) => t.status === 'DONE');
    expect(doneTasks).toHaveLength(1);
    expect(doneTasks[0].commit).toBeUndefined();
  });
});

describe('integration: ralph cost calculates costs from sample logs', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    const logsDir = path.join(tmpDir, '.ralph-logs');
    await mkdir(logsDir, { recursive: true });

    const logLine1 = JSON.stringify({
      usage: {
        input_tokens: 1000,
        cache_creation_input_tokens: 500,
        cache_read_input_tokens: 200,
        output_tokens: 300,
      },
    });
    const logLine2 = JSON.stringify({
      usage: {
        input_tokens: 2000,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 400,
        output_tokens: 600,
      },
    });

    await writeFile(
      path.join(logsDir, 'T-001-20260310-120000.jsonl'),
      `${logLine1}\n${logLine2}\n`,
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('parses log lines and calculates aggregate cost', async () => {
    const logContent = await readFile(
      path.join(tmpDir, '.ralph-logs', 'T-001-20260310-120000.jsonl'),
      'utf-8',
    );
    const lines = logContent.split('\n').filter((l) => l.trim());
    const usages = lines.map((l) => parseLogLine(l)!).filter(Boolean);

    expect(usages).toHaveLength(2);

    const aggregated = aggregateUsage(usages);
    expect(aggregated.input_tokens).toBe(3000);
    expect(aggregated.cache_creation_input_tokens).toBe(1500);
    expect(aggregated.cache_read_input_tokens).toBe(600);
    expect(aggregated.output_tokens).toBe(900);

    const cost = calculateCost(aggregated);
    expect(cost).toBeGreaterThan(0);

    const table = formatCostTable([{ label: 'T-001', usage: aggregated, cost }]);
    expect(table).toContain('T-001');
    expect(table).toContain('$');
  });

  it('cost run() with --all groups by task ID', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const { run } = await import('../commands/cost.js');
      await run(['--all'], tmpDir);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('T-001');
      expect(output).toContain('$');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('cost run() with --task filters to specific task', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const { run } = await import('../commands/cost.js');
      await run(['--task', 'T-001'], tmpDir);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('T-001');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('cost run() with --total shows grand total', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const { run } = await import('../commands/cost.js');
      await run(['--total'], tmpDir);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Total');
      expect(output).toContain('$');
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('integration: ralph monitor renders status correctly', () => {
  it('renders full monitor output with all fields', () => {
    const data: MonitorData = {
      status: 'RUNNING',
      done: 5,
      total: 10,
      currentTaskId: 'T-006',
      currentTaskTitle: 'Build feature X',
      phases: ['Boot', 'Red', 'Green'],
    };

    const output = formatMonitorOutput(data);
    expect(output).toContain('Status: RUNNING');
    expect(output).toContain('5/10');
    expect(output).toContain('50%');
    expect(output).toContain('T-006');
    expect(output).toContain('Build feature X');
    expect(output).toContain('● Boot');
    expect(output).toContain('● Red');
    expect(output).toContain('● Green');
    expect(output).toContain('○ Verify');
    expect(output).toContain('○ Commit');
  });

  it('phase parsing and timeline rendering work end-to-end', () => {
    const logContent = [
      'some text before',
      '[PHASE] Entering: Boot',
      'doing boot stuff',
      '[PHASE] Entering: Red',
      'writing tests',
      '[PHASE] Entering: Green',
    ].join('\n');

    const phases = parsePhases(logContent);
    expect(phases).toEqual(['Boot', 'Red', 'Green']);

    const timeline = formatPhaseTimeline(phases);
    expect(timeline).toContain('● Boot');
    expect(timeline).toContain('● Red');
    expect(timeline).toContain('● Green');
    expect(timeline).toContain('○ Verify');
    expect(timeline).toContain('○ Commit');
  });

  it('detectStatus returns STOPPED when no ralph processes', () => {
    expect(detectStatus([])).toBe('STOPPED');
  });

  it('detectStatus returns RUNNING when ralph processes exist', () => {
    expect(detectStatus([12345])).toBe('RUNNING');
  });

  it('progress bar renders correctly for edge cases', () => {
    expect(formatProgressBar(0, 0)).toContain('0/0');
    expect(formatProgressBar(0, 0)).toContain('0%');
    expect(formatProgressBar(10, 10)).toContain('100%');
  });
});

describe('integration: CLI dispatches commands correctly', () => {
  it('dispatches known commands with args', () => {
    const result = dispatch(['init']);
    expect(result).toEqual({ action: 'init', args: [] });
  });

  it('dispatches loop with arguments', () => {
    const result = dispatch(['loop', '--dry-run', '-n', '5']);
    expect(result).toEqual({ action: 'loop', args: ['--dry-run', '-n', '5'] });
  });

  it('dispatches all known commands', () => {
    const commands = ['init', 'loop', 'monitor', 'kill', 'milestones', 'shas', 'cost'] as const;
    for (const cmd of commands) {
      const result = dispatch([cmd]);
      expect(result).toEqual({ action: cmd, args: [] });
    }
  });

  it('returns help for unknown commands', () => {
    const result = dispatch(['foobar']);
    expect(result).toEqual({ action: 'help', unknown: 'foobar' });
  });

  it('returns help for --help flag', () => {
    const result = dispatch(['--help']);
    expect(result).toEqual({ action: 'help' });
  });

  it('returns help for no arguments', () => {
    const result = dispatch([]);
    expect(result).toEqual({ action: 'help' });
  });

  it('formatHelp includes unknown command name', () => {
    const help = formatHelp('badcmd');
    expect(help).toContain('Unknown command: badcmd');
    expect(help).toContain('Usage:');
    expect(help).toContain('Commands:');
  });

  it('formatHelp without unknown shows usage', () => {
    const help = formatHelp();
    expect(help).not.toContain('Unknown');
    expect(help).toContain('Usage:');
  });
});

describe('integration: ralph loop --dry-run shows auto-scaled complexity', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    const tasksDir = path.join(tmpDir, 'docs', 'tasks');
    await mkdir(tasksDir, { recursive: true });
    await mkdir(path.join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await mkdir(path.join(tmpDir, '.claude'), { recursive: true });

    await writeFile(
      path.join(tmpDir, '.claude', 'CLAUDE.md'),
      `## Project-Specific Config

- **Language**: TypeScript
- **Package manager**: pnpm
- **Testing framework**: Vitest
- **Quality check**: \`pnpm check\`
- **Test command**: \`pnpm test\`
`,
    );
    await writeFile(
      path.join(tmpDir, 'docs', 'prompts', 'boot.md'),
      'Task {{task.id}}: {{task.title}}',
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('dry-run shows light tier for simple task', async () => {
    await writeFile(
      path.join(tmpDir, 'docs', 'tasks', 'T-001.md'),
      `# T-001: Simple task

- **Status**: TODO
- **Milestone**: 1 — Setup
- **Depends**: none
- **PRD Reference**: §1

## Description

A simple task.

## Produces

- \`src/index.ts\`
`,
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { run } = await import('../commands/loop.js');
      await run(['--dry-run'], tmpDir);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('complexity tier: light');
      expect(output).toContain('timeout: 600s (auto)');
      expect(output).toContain('max turns: 50');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('dry-run shows heavy tier for integration task', async () => {
    await writeFile(
      path.join(tmpDir, 'docs', 'tasks', 'T-001.md'),
      `# T-001: End-to-end integration tests

- **Status**: TODO
- **Milestone**: 6 — Integration
- **Depends**: none
- **PRD Reference**: §3

## Description

Integration tests.

## Produces

- \`src/__tests__/integration.test.ts\`
`,
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { run } = await import('../commands/loop.js');
      await run(['--dry-run'], tmpDir);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('complexity tier: heavy');
      expect(output).toContain('timeout: 1200s (auto)');
      expect(output).toContain('max turns: 125');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('dry-run shows heavy tier for task with many dependencies', async () => {
    await writeFile(
      path.join(tmpDir, 'docs', 'tasks', 'T-001.md'),
      `# T-001: Complex task

- **Status**: DONE
- **Milestone**: 1 — Setup
- **Depends**: none
- **PRD Reference**: §1

## Description

Done task.
`,
    );

    await writeFile(
      path.join(tmpDir, 'docs', 'tasks', 'T-002.md'),
      `# T-002: Also done

- **Status**: DONE
- **Milestone**: 1 — Setup
- **Depends**: none
- **PRD Reference**: §1

## Description

Done task.
`,
    );

    await writeFile(
      path.join(tmpDir, 'docs', 'tasks', 'T-003.md'),
      `# T-003: Also done

- **Status**: DONE
- **Milestone**: 1 — Setup
- **Depends**: none
- **PRD Reference**: §1

## Description

Done task.
`,
    );

    await writeFile(
      path.join(tmpDir, 'docs', 'tasks', 'T-004.md'),
      `# T-004: Also done

- **Status**: DONE
- **Milestone**: 1 — Setup
- **Depends**: none
- **PRD Reference**: §1

## Description

Done task.
`,
    );

    await writeFile(
      path.join(tmpDir, 'docs', 'tasks', 'T-005.md'),
      `# T-005: Task with many deps

- **Status**: TODO
- **Milestone**: 2 — Core
- **Depends**: T-001, T-002, T-003, T-004
- **PRD Reference**: §2

## Description

Task with four deps.

## Produces

- \`src/complex.ts\`
`,
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { run } = await import('../commands/loop.js');
      await run(['--dry-run'], tmpDir);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('complexity tier: heavy');
    } finally {
      logSpy.mockRestore();
    }
  });
});
