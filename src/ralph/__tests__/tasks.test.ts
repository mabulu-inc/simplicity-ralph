import { describe, expect, it } from 'vitest';
import {
  parseTaskFile,
  scanTasks,
  findNextTask,
  countByStatus,
  allDone,
  type Task,
} from '../core/tasks.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// --- Fixtures ---

const DONE_TASK = `# T-000: Project infrastructure

- **Status**: DONE
- **Milestone**: 1 — Infrastructure
- **Depends**: none
- **PRD Reference**: §3
- **Completed**: 2026-03-10 18:14 (5m duration)
- **Commit**: 40caf07
- **Cost**: $10.56

## Description

Set up the project infrastructure.

## Produces

- \`src/cli.ts\`

## Completion Notes

Done. 21 tests.
`;

const TODO_TASK = `# T-001: Task file parser

- **Status**: TODO
- **Milestone**: 2 — Core Modules
- **Depends**: T-000
- **PRD Reference**: §1, §1.1, §1.2

## Description

Parse task files.

## Produces

- \`src/ralph/core/tasks.ts\`
`;

const TODO_NO_DEPS = `# T-005: Standalone feature

- **Status**: TODO
- **Milestone**: 3 — Features
- **Depends**: none
- **PRD Reference**: §4

## Description

A standalone task with no deps.

## Produces

- \`src/feature.ts\`
`;

const BLOCKED_TASK = `# T-003: Blocked feature

- **Status**: TODO
- **Milestone**: 2 — Core Modules
- **Depends**: T-000
- **PRD Reference**: §2

## Description

This task is blocked.

## Blocked

Waiting for upstream API to be available.

## Produces

- \`src/blocked.ts\`
`;

const MULTI_DEPS_TASK = `# T-004: Multi-dep feature

- **Status**: TODO
- **Milestone**: 2 — Core Modules
- **Depends**: T-001, T-002
- **PRD Reference**: §3.1

## Description

Depends on two tasks.

## Produces

- \`src/multi.ts\`
`;

const MINIMAL_TASK = `# T-010: Minimal

- **Status**: TODO
- **Milestone**: 1 — Infra
- **Depends**: none
- **PRD Reference**: §1

## Description

Minimal task.
`;

// --- Tests ---

describe('parseTaskFile', () => {
  it('parses a completed task with all fields', () => {
    const task = parseTaskFile('T-000.md', DONE_TASK);
    expect(task).toEqual({
      id: 'T-000',
      number: 0,
      title: 'Project infrastructure',
      status: 'DONE',
      milestone: '1 — Infrastructure',
      depends: [],
      prdReference: '§3',
      completed: '2026-03-10 18:14 (5m duration)',
      commit: '40caf07',
      cost: '$10.56',
      blocked: false,
      description: 'Set up the project infrastructure.',
    });
  });

  it('parses a TODO task with dependencies', () => {
    const task = parseTaskFile('T-001.md', TODO_TASK);
    expect(task).toEqual({
      id: 'T-001',
      number: 1,
      title: 'Task file parser',
      status: 'TODO',
      milestone: '2 — Core Modules',
      depends: ['T-000'],
      prdReference: '§1, §1.1, §1.2',
      completed: undefined,
      commit: undefined,
      cost: undefined,
      blocked: false,
      description: 'Parse task files.',
    });
  });

  it('parses "none" depends as empty array', () => {
    const task = parseTaskFile('T-005.md', TODO_NO_DEPS);
    expect(task.depends).toEqual([]);
  });

  it('detects blocked tasks', () => {
    const task = parseTaskFile('T-003.md', BLOCKED_TASK);
    expect(task.blocked).toBe(true);
  });

  it('parses multiple dependencies', () => {
    const task = parseTaskFile('T-004.md', MULTI_DEPS_TASK);
    expect(task.depends).toEqual(['T-001', 'T-002']);
  });

  it('handles minimal task with no optional fields', () => {
    const task = parseTaskFile('T-010.md', MINIMAL_TASK);
    expect(task.id).toBe('T-010');
    expect(task.number).toBe(10);
    expect(task.completed).toBeUndefined();
    expect(task.commit).toBeUndefined();
    expect(task.cost).toBeUndefined();
    expect(task.blocked).toBe(false);
  });

  it('extracts the task ID from the heading, not filename', () => {
    const task = parseTaskFile('whatever.md', TODO_NO_DEPS);
    expect(task.id).toBe('T-005');
  });

  it('falls back to filename when heading is missing', () => {
    const content = `- **Status**: TODO\n- **Milestone**: 1 — Test\n- **Depends**: none\n- **PRD Reference**: §1\n`;
    const task = parseTaskFile('T-099.md', content);
    expect(task.id).toBe('T-099');
    expect(task.title).toBe('');
    expect(task.description).toBe('');
  });
});

describe('scanTasks', () => {
  let dir: string;

  async function setup(files: Record<string, string>) {
    dir = await mkdtemp(join(tmpdir(), 'ralph-tasks-'));
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content);
    }
  }

  async function cleanup() {
    if (dir) await rm(dir, { recursive: true, force: true });
  }

  it('scans a directory and returns all tasks sorted by number', async () => {
    await setup({
      'T-000.md': DONE_TASK,
      'T-001.md': TODO_TASK,
      'T-005.md': TODO_NO_DEPS,
    });
    try {
      const tasks = await scanTasks(dir);
      expect(tasks).toHaveLength(3);
      expect(tasks[0].id).toBe('T-000');
      expect(tasks[1].id).toBe('T-001');
      expect(tasks[2].id).toBe('T-005');
    } finally {
      await cleanup();
    }
  });

  it('ignores non-task files', async () => {
    await setup({
      'T-000.md': DONE_TASK,
      'README.md': '# README',
      'notes.txt': 'some notes',
    });
    try {
      const tasks = await scanTasks(dir);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('T-000');
    } finally {
      await cleanup();
    }
  });

  it('returns empty array for empty directory', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ralph-tasks-'));
    try {
      const tasks = await scanTasks(dir);
      expect(tasks).toEqual([]);
    } finally {
      await cleanup();
    }
  });
});

describe('findNextTask', () => {
  it('finds the lowest-numbered eligible TODO', () => {
    const tasks: Task[] = [
      parseTaskFile('T-000.md', DONE_TASK),
      parseTaskFile('T-001.md', TODO_TASK),
      parseTaskFile('T-005.md', TODO_NO_DEPS),
    ];
    const next = findNextTask(tasks);
    expect(next?.id).toBe('T-001');
  });

  it('skips tasks with unmet dependencies', () => {
    const tasks: Task[] = [
      parseTaskFile('T-001.md', TODO_TASK), // depends on T-000 which is not DONE
      parseTaskFile('T-005.md', TODO_NO_DEPS), // no deps
    ];
    const next = findNextTask(tasks);
    expect(next?.id).toBe('T-005');
  });

  it('skips blocked tasks', () => {
    const tasks: Task[] = [
      parseTaskFile('T-000.md', DONE_TASK),
      parseTaskFile('T-003.md', BLOCKED_TASK), // blocked, even though deps met
      parseTaskFile('T-005.md', TODO_NO_DEPS),
    ];
    const next = findNextTask(tasks);
    expect(next?.id).toBe('T-005');
  });

  it('returns undefined when no eligible tasks exist', () => {
    const tasks: Task[] = [
      parseTaskFile('T-004.md', MULTI_DEPS_TASK), // deps T-001, T-002 not done
    ];
    const next = findNextTask(tasks);
    expect(next).toBeUndefined();
  });

  it('returns undefined when all tasks are done', () => {
    const tasks: Task[] = [parseTaskFile('T-000.md', DONE_TASK)];
    const next = findNextTask(tasks);
    expect(next).toBeUndefined();
  });
});

describe('countByStatus', () => {
  it('counts tasks by status', () => {
    const tasks: Task[] = [
      parseTaskFile('T-000.md', DONE_TASK),
      parseTaskFile('T-001.md', TODO_TASK),
      parseTaskFile('T-005.md', TODO_NO_DEPS),
    ];
    const counts = countByStatus(tasks);
    expect(counts).toEqual({ TODO: 2, DONE: 1 });
  });

  it('returns zeros for empty array', () => {
    const counts = countByStatus([]);
    expect(counts).toEqual({ TODO: 0, DONE: 0 });
  });
});

describe('allDone', () => {
  it('returns true when all tasks are DONE', () => {
    const tasks: Task[] = [parseTaskFile('T-000.md', DONE_TASK)];
    expect(allDone(tasks)).toBe(true);
  });

  it('returns false when some tasks are TODO', () => {
    const tasks: Task[] = [
      parseTaskFile('T-000.md', DONE_TASK),
      parseTaskFile('T-001.md', TODO_TASK),
    ];
    expect(allDone(tasks)).toBe(false);
  });

  it('returns true for empty array', () => {
    expect(allDone([])).toBe(true);
  });
});
