import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseLogLine,
  aggregateUsage,
  calculateCost,
  formatCostTable,
  run,
} from '../commands/cost.js';

// Sample JSONL log entries with usage data
const usageLine = (input: number, cacheWrite: number, cacheRead: number, output: number) =>
  JSON.stringify({
    type: 'result',
    usage: {
      input_tokens: input,
      cache_creation_input_tokens: cacheWrite,
      cache_read_input_tokens: cacheRead,
      output_tokens: output,
    },
  });

const nonUsageLine = JSON.stringify({ type: 'text', text: 'hello' });

describe('parseLogLine', () => {
  it('extracts usage fields from a valid result line', () => {
    const result = parseLogLine(usageLine(1000, 500, 200, 300));
    expect(result).toEqual({
      input_tokens: 1000,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 200,
      output_tokens: 300,
    });
  });

  it('returns null for lines without usage data', () => {
    expect(parseLogLine(nonUsageLine)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseLogLine('not json')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseLogLine('')).toBeNull();
  });

  it('handles usage with missing optional fields (defaults to 0)', () => {
    const line = JSON.stringify({
      type: 'result',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const result = parseLogLine(line);
    expect(result).toEqual({
      input_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 50,
    });
  });
});

describe('aggregateUsage', () => {
  it('sums usage across multiple entries', () => {
    const entries = [
      {
        input_tokens: 100,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 20,
        output_tokens: 30,
      },
      {
        input_tokens: 200,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 40,
        output_tokens: 60,
      },
    ];
    const result = aggregateUsage(entries);
    expect(result).toEqual({
      input_tokens: 300,
      cache_creation_input_tokens: 150,
      cache_read_input_tokens: 60,
      output_tokens: 90,
    });
  });

  it('returns zeros for empty array', () => {
    expect(aggregateUsage([])).toEqual({
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
    });
  });
});

describe('calculateCost', () => {
  it('calculates cost using Claude pricing rates', () => {
    const usage = {
      input_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
    };
    const cost = calculateCost(usage);
    // Input: $3/MTok
    expect(cost).toBeCloseTo(3.0);
  });

  it('calculates output token cost', () => {
    const usage = {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 1_000_000,
    };
    const cost = calculateCost(usage);
    // Output: $15/MTok
    expect(cost).toBeCloseTo(15.0);
  });

  it('calculates cache write cost', () => {
    const usage = {
      input_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 0,
      output_tokens: 0,
    };
    const cost = calculateCost(usage);
    // Cache write: $3.75/MTok
    expect(cost).toBeCloseTo(3.75);
  });

  it('calculates cache read cost', () => {
    const usage = {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 1_000_000,
      output_tokens: 0,
    };
    const cost = calculateCost(usage);
    // Cache read: $0.30/MTok
    expect(cost).toBeCloseTo(0.3);
  });

  it('calculates combined cost', () => {
    const usage = {
      input_tokens: 500_000,
      cache_creation_input_tokens: 200_000,
      cache_read_input_tokens: 100_000,
      output_tokens: 50_000,
    };
    // Input: 0.5 * 3 = 1.5, Cache write: 0.2 * 3.75 = 0.75, Cache read: 0.1 * 0.30 = 0.03, Output: 0.05 * 15 = 0.75
    const cost = calculateCost(usage);
    expect(cost).toBeCloseTo(3.03);
  });
});

describe('formatCostTable', () => {
  it('formats a single entry as a table', () => {
    const entries = [
      {
        label: 'T-001-20260310-120000.jsonl',
        usage: {
          input_tokens: 1000,
          cache_creation_input_tokens: 500,
          cache_read_input_tokens: 200,
          output_tokens: 300,
        },
        cost: 0.012,
      },
    ];
    const output = formatCostTable(entries);
    expect(output).toContain('Input');
    expect(output).toContain('Cache Write');
    expect(output).toContain('Cache Read');
    expect(output).toContain('Output');
    expect(output).toContain('Cost');
    expect(output).toContain('1,000');
    expect(output).toContain('$0.01');
  });

  it('formats multiple entries with a total row', () => {
    const entries = [
      {
        label: 'file1',
        usage: {
          input_tokens: 1000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 500,
        },
        cost: 0.01,
      },
      {
        label: 'file2',
        usage: {
          input_tokens: 2000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 1000,
        },
        cost: 0.02,
      },
    ];
    const output = formatCostTable(entries);
    expect(output).toContain('Total');
    expect(output).toContain('3,000');
    expect(output).toContain('1,500');
  });

  it('returns message for empty entries', () => {
    const output = formatCostTable([]);
    expect(output).toContain('No log files found');
  });
});

describe('ralph cost (run)', () => {
  let dir: string;
  let logsDir: string;
  let tasksDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ralph-cost-test-'));
    logsDir = join(dir, '.ralph-logs');
    tasksDir = join(dir, 'docs', 'tasks');
    await mkdir(logsDir, { recursive: true });
    await mkdir(tasksDir, { recursive: true });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  });

  it('processes a single log file', async () => {
    const logFile = join(logsDir, 'T-001-20260310-120000.jsonl');
    await writeFile(logFile, [usageLine(1000, 500, 200, 300), nonUsageLine].join('\n'));

    await run([logFile], dir);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('1,000');
  });

  it('processes logs for a specific task with --task', async () => {
    await writeFile(join(logsDir, 'T-001-20260310-120000.jsonl'), usageLine(1000, 0, 0, 500));
    await writeFile(join(logsDir, 'T-001-20260310-130000.jsonl'), usageLine(2000, 0, 0, 1000));
    await writeFile(join(logsDir, 'T-002-20260310-120000.jsonl'), usageLine(5000, 0, 0, 2000));

    await run(['--task', 'T-001'], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('3,000'); // total input: 1000 + 2000
    expect(output).not.toContain('5,000'); // T-002 should not appear
  });

  it('processes all logs grouped by task with --all', async () => {
    await writeFile(join(logsDir, 'T-001-20260310-120000.jsonl'), usageLine(1000, 0, 0, 500));
    await writeFile(join(logsDir, 'T-002-20260310-120000.jsonl'), usageLine(2000, 0, 0, 1000));

    await run(['--all'], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('T-001');
    expect(output).toContain('T-002');
  });

  it('shows grand total only with --total', async () => {
    await writeFile(join(logsDir, 'T-001-20260310-120000.jsonl'), usageLine(1000, 0, 0, 500));
    await writeFile(join(logsDir, 'T-002-20260310-120000.jsonl'), usageLine(2000, 0, 0, 1000));

    await run(['--total'], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Total');
    // Should show combined input: 3000
    expect(output).toContain('3,000');
  });

  it('updates task files with --update-tasks', async () => {
    await writeFile(
      join(logsDir, 'T-001-20260310-120000.jsonl'),
      usageLine(500_000, 200_000, 100_000, 50_000),
    );

    await writeFile(
      join(tasksDir, 'T-001.md'),
      `# T-001: Test task

- **Status**: DONE
- **Milestone**: 1 — Setup
- **Depends**: none
- **PRD Reference**: §1
- **Completed**: 2026-03-10 12:00 (5m duration)
- **Commit**: abc1234

## Description

Test task.
`,
    );

    await run(['--update-tasks'], dir);

    const content = await readFile(join(tasksDir, 'T-001.md'), 'utf-8');
    expect(content).toContain('- **Cost**:');
    expect(content).toMatch(/\$\d+\.\d{2}/);
  });

  it('shows help when no arguments given', async () => {
    await run([], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Usage');
  });

  it('warns when log directory does not exist', async () => {
    await rm(logsDir, { recursive: true, force: true });

    await run(['--all'], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No log');
  });

  it('handles --update-tasks inserting cost after commit field', async () => {
    await writeFile(join(logsDir, 'T-002-20260310-120000.jsonl'), usageLine(100_000, 0, 0, 10_000));

    await writeFile(
      join(tasksDir, 'T-002.md'),
      `# T-002: Another task

- **Status**: DONE
- **Milestone**: 1 — Setup
- **Depends**: none
- **PRD Reference**: §1
- **Completed**: 2026-03-10 12:00 (5m duration)
- **Commit**: def5678

## Description

Another task.
`,
    );

    await run(['--update-tasks'], dir);

    const content = await readFile(join(tasksDir, 'T-002.md'), 'utf-8');
    // Cost should appear after Commit
    const commitIdx = content.indexOf('**Commit**');
    const costIdx = content.indexOf('**Cost**');
    expect(costIdx).toBeGreaterThan(commitIdx);
  });

  it('updates existing cost field in task file', async () => {
    await writeFile(join(logsDir, 'T-003-20260310-120000.jsonl'), usageLine(100_000, 0, 0, 10_000));

    await writeFile(
      join(tasksDir, 'T-003.md'),
      `# T-003: Task with cost

- **Status**: DONE
- **Milestone**: 1 — Setup
- **Depends**: none
- **PRD Reference**: §1
- **Completed**: 2026-03-10 12:00 (5m duration)
- **Commit**: abc1234
- **Cost**: $0.00

## Description

Task with existing cost.
`,
    );

    await run(['--update-tasks'], dir);

    const content = await readFile(join(tasksDir, 'T-003.md'), 'utf-8');
    // Cost should be updated, not $0.00
    expect(content).not.toContain('$0.00');
    expect(content).toMatch(/\$\d+\.\d{2}/);
  });

  it('skips TODO tasks with --update-tasks', async () => {
    await writeFile(join(logsDir, 'T-004-20260310-120000.jsonl'), usageLine(100_000, 0, 0, 10_000));

    await writeFile(
      join(tasksDir, 'T-004.md'),
      `# T-004: TODO task

- **Status**: TODO
- **Milestone**: 1 — Setup
- **Depends**: none
- **PRD Reference**: §1

## Description

Not done yet.
`,
    );

    await run(['--update-tasks'], dir);

    const content = await readFile(join(tasksDir, 'T-004.md'), 'utf-8');
    expect(content).not.toContain('**Cost**');
  });

  it('shows no-logs message for --task with empty logs dir', async () => {
    // logsDir exists but is empty (no .jsonl files)
    await run(['--task', 'T-001'], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No log files found');
  });

  it('shows no-match message for --task with no matching logs', async () => {
    await writeFile(join(logsDir, 'T-002-20260310-120000.jsonl'), usageLine(1000, 0, 0, 500));

    await run(['--task', 'T-999'], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No log files found for T-999');
  });

  it('shows no-logs message for --total with no logs dir', async () => {
    await rm(logsDir, { recursive: true, force: true });

    await run(['--total'], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No log files found');
  });

  it('inserts cost after Completed when no Commit field exists', async () => {
    await writeFile(join(logsDir, 'T-005-20260310-120000.jsonl'), usageLine(100_000, 0, 0, 10_000));

    await writeFile(
      join(tasksDir, 'T-005.md'),
      `# T-005: No commit field

- **Status**: DONE
- **Milestone**: 1 — Setup
- **Depends**: none
- **PRD Reference**: §1
- **Completed**: 2026-03-10 12:00 (5m duration)

## Description

Task without commit field.
`,
    );

    await run(['--update-tasks'], dir);

    const content = await readFile(join(tasksDir, 'T-005.md'), 'utf-8');
    expect(content).toContain('**Cost**');
    const completedIdx = content.indexOf('**Completed**');
    const costIdx = content.indexOf('**Cost**');
    expect(costIdx).toBeGreaterThan(completedIdx);
  });

  it('shows --task usage when no task ID provided', async () => {
    await run(['--task'], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Usage');
  });

  it('inserts cost after PRD Reference as last fallback', async () => {
    await writeFile(join(logsDir, 'T-006-20260310-120000.jsonl'), usageLine(100_000, 0, 0, 10_000));

    await writeFile(
      join(tasksDir, 'T-006.md'),
      `# T-006: Minimal task

- **Status**: DONE
- **Milestone**: 1 — Setup
- **Depends**: none
- **PRD Reference**: §1

## Description

Minimal done task.
`,
    );

    await run(['--update-tasks'], dir);

    const content = await readFile(join(tasksDir, 'T-006.md'), 'utf-8');
    expect(content).toContain('**Cost**');
    const prdIdx = content.indexOf('**PRD Reference**');
    const costIdx = content.indexOf('**Cost**');
    expect(costIdx).toBeGreaterThan(prdIdx);
  });
});
