import { describe, expect, it } from 'vitest';
import {
  parseTaskFile,
  scanTasks,
  findNextTask,
  countByStatus,
  allDone,
  diagnoseIneligible,
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

const TASK_WITH_HINTS = `# T-062: Task with hints

- **Status**: TODO
- **Milestone**: 2 — Core
- **Depends**: none
- **PRD Reference**: §3

## Description

A task that has implementation hints.

## Hints

Follow the existing pattern in core/tasks.ts. The markdown utility should handle section extraction.

## Produces

- \`src/core/tasks.ts\`
`;

const TASK_WITH_TOUCHES_AND_HINTS = `# T-063: Task with touches and hints

- **Status**: TODO
- **Milestone**: 2 — Core
- **Depends**: none
- **PRD Reference**: §3
- **Touches**: \`src/core/tasks.ts\`, \`src/core/config.ts\`

## Description

A task with both touches and hints.

## Hints

Use extractSectionFirstParagraph for parsing.

## Produces

- \`src/core/tasks.ts\`
`;

const TASK_WITH_TOUCHES = `# T-060: Task with touches

- **Status**: TODO
- **Milestone**: 2 — Core
- **Depends**: none
- **PRD Reference**: §3
- **Touches**: \`src/core/tasks.ts\`, \`src/core/config.ts\`

## Description

A task that specifies which files it touches.

## Produces

- \`src/core/tasks.ts\`
`;

const TASK_WITH_COMPLEXITY = `# T-070: Heavy task with explicit complexity

- **Status**: TODO
- **Milestone**: 1 — Infra
- **Depends**: none
- **PRD Reference**: §1
- **Complexity**: heavy

## Description

A task with explicit complexity.

## Produces

- \`src/heavy.ts\`
`;

const STATUS_BLOCKED_TASK = `# T-080: Status-blocked task

- **Status**: BLOCKED
- **Milestone**: 2 — Core Modules
- **Depends**: T-000
- **PRD Reference**: §2
- **Blocked reason**: Failed 3 times — test suite crashes on missing fixture

## Description

This task was blocked by the orchestrator after repeated failures.

## Produces

- \`src/blocked.ts\`
`;

const TASK_WITH_INVALID_COMPLEXITY = `# T-071: Task with invalid complexity

- **Status**: TODO
- **Milestone**: 1 — Infra
- **Depends**: none
- **PRD Reference**: §1
- **Complexity**: extreme

## Description

A task with an invalid complexity value.

## Produces

- \`src/invalid.ts\`
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
      producesCount: 1,
      touches: [],
      hints: '',
      complexity: undefined,
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
      producesCount: 1,
      touches: [],
      hints: '',
      complexity: undefined,
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

  it('counts items in Produces section', () => {
    const task = parseTaskFile('T-000.md', DONE_TASK);
    expect(task.producesCount).toBe(1);
  });

  it('returns 0 producesCount when Produces section is missing', () => {
    const task = parseTaskFile('T-010.md', MINIMAL_TASK);
    expect(task.producesCount).toBe(0);
  });

  it('counts multiple produces items', () => {
    const content = `# T-020: Multi produce

- **Status**: TODO
- **Milestone**: 1 — Test
- **Depends**: none
- **PRD Reference**: §1

## Description

Test task.

## Produces

- \`src/a.ts\`
- \`src/b.ts\`
- \`src/c.ts\`
- Tests
`;
    const task = parseTaskFile('T-020.md', content);
    expect(task.producesCount).toBe(4);
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

  it('parses fields with single asterisks (non-bold)', () => {
    const content = `# T-050: Single asterisks

- *Status*: DONE
- *Milestone*: 3 — Features
- *Depends*: none
- *PRD Reference*: §5
- *Completed*: 2026-03-10 10:00 (3m duration)
- *Commit*: abc1234
- *Cost*: $5.00

## Description

Uses single asterisks for emphasis.

## Produces

- \`src/single.ts\`
`;
    const task = parseTaskFile('T-050.md', content);
    expect(task.status).toBe('DONE');
    expect(task.milestone).toBe('3 — Features');
    expect(task.depends).toEqual([]);
    expect(task.prdReference).toBe('§5');
    expect(task.completed).toBe('2026-03-10 10:00 (3m duration)');
    expect(task.commit).toBe('abc1234');
    expect(task.cost).toBe('$5.00');
  });

  it('parses fields with extra whitespace', () => {
    const content = `# T-051: Extra spaces

-  **Status**:   TODO
-  **Milestone**:   4 — Cleanup
-  **Depends**:   T-001 , T-002
-  **PRD Reference**:   §6

## Description

Extra whitespace around colons and values.

## Produces

- \`src/spaces.ts\`
`;
    const task = parseTaskFile('T-051.md', content);
    expect(task.status).toBe('TODO');
    expect(task.milestone).toBe('4 — Cleanup');
    expect(task.depends).toEqual(['T-001', 'T-002']);
    expect(task.prdReference).toBe('§6');
  });

  it('parses fields with trailing spaces', () => {
    const content = `# T-052: Trailing spaces

- **Status**: DONE
- **Milestone**: 2 — Core
- **Depends**: none
- **PRD Reference**: §2

## Description

Fields have trailing spaces.

## Produces

- \`src/trailing.ts\`
`;
    const task = parseTaskFile('T-052.md', content);
    expect(task.status).toBe('DONE');
    expect(task.milestone).toBe('2 — Core');
    expect(task.depends).toEqual([]);
    expect(task.prdReference).toBe('§2');
  });

  it('parses touches field as array of file paths', () => {
    const task = parseTaskFile('T-060.md', TASK_WITH_TOUCHES);
    expect(task.touches).toEqual(['src/core/tasks.ts', 'src/core/config.ts']);
  });

  it('returns empty array when touches field is absent', () => {
    const task = parseTaskFile('T-010.md', MINIMAL_TASK);
    expect(task.touches).toEqual([]);
  });

  it('parses single touches value', () => {
    const content = `# T-061: Single touch

- **Status**: TODO
- **Milestone**: 1 — Test
- **Depends**: none
- **PRD Reference**: §1
- **Touches**: \`src/single.ts\`

## Description

Single touch file.
`;
    const task = parseTaskFile('T-061.md', content);
    expect(task.touches).toEqual(['src/single.ts']);
  });

  it('parses hints section as free text', () => {
    const task = parseTaskFile('T-062.md', TASK_WITH_HINTS);
    expect(task.hints).toBe(
      'Follow the existing pattern in core/tasks.ts. The markdown utility should handle section extraction.',
    );
  });

  it('returns empty string when hints section is absent', () => {
    const task = parseTaskFile('T-010.md', MINIMAL_TASK);
    expect(task.hints).toBe('');
  });

  it('parses both touches and hints together', () => {
    const task = parseTaskFile('T-063.md', TASK_WITH_TOUCHES_AND_HINTS);
    expect(task.touches).toEqual(['src/core/tasks.ts', 'src/core/config.ts']);
    expect(task.hints).toBe('Use extractSectionFirstParagraph for parsing.');
  });

  it('parses explicit complexity field', () => {
    const task = parseTaskFile('T-070.md', TASK_WITH_COMPLEXITY);
    expect(task.complexity).toBe('heavy');
  });

  it('sets complexity to undefined for invalid values', () => {
    const task = parseTaskFile('T-071.md', TASK_WITH_INVALID_COMPLEXITY);
    expect(task.complexity).toBeUndefined();
  });

  it('sets complexity to undefined when field is absent', () => {
    const task = parseTaskFile('T-010.md', MINIMAL_TASK);
    expect(task.complexity).toBeUndefined();
  });

  it('parses all valid complexity tiers', () => {
    for (const tier of ['light', 'standard', 'heavy']) {
      const content = `# T-072: Complexity ${tier}

- **Status**: TODO
- **Milestone**: 1 — Test
- **Depends**: none
- **PRD Reference**: §1
- **Complexity**: ${tier}

## Description

Test task.
`;
      const task = parseTaskFile('T-072.md', content);
      expect(task.complexity).toBe(tier);
    }
  });

  it('parses BLOCKED status', () => {
    const task = parseTaskFile('T-080.md', STATUS_BLOCKED_TASK);
    expect(task.status).toBe('BLOCKED');
    expect(task.blockedReason).toBe('Failed 3 times — test suite crashes on missing fixture');
  });

  it('returns empty blockedReason when field is absent', () => {
    const task = parseTaskFile('T-010.md', MINIMAL_TASK);
    expect(task.blockedReason).toBeUndefined();
  });

  it('parses fields with mixed bold styles (underscore bold)', () => {
    const content = `# T-053: Underscore bold

- __Status__: TODO
- __Milestone__: 1 — Setup
- __Depends__: none
- __PRD Reference__: §1

## Description

Uses underscore bold syntax.

## Produces

- \`src/underscore.ts\`
`;
    const task = parseTaskFile('T-053.md', content);
    expect(task.status).toBe('TODO');
    expect(task.milestone).toBe('1 — Setup');
    expect(task.depends).toEqual([]);
    expect(task.prdReference).toBe('§1');
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

  it('skips tasks with status BLOCKED', () => {
    const tasks: Task[] = [
      parseTaskFile('T-000.md', DONE_TASK),
      parseTaskFile('T-080.md', STATUS_BLOCKED_TASK), // BLOCKED, deps met
      parseTaskFile('T-005.md', TODO_NO_DEPS),
    ];
    const next = findNextTask(tasks);
    expect(next?.id).toBe('T-005');
  });

  it('does not treat BLOCKED tasks as DONE for dependency resolution', () => {
    const blockedParent = STATUS_BLOCKED_TASK.replace('T-080', 'T-000').replace(
      'Depends**: T-000',
      'Depends**: none',
    );
    const tasks: Task[] = [
      parseTaskFile('T-000.md', blockedParent),
      parseTaskFile('T-001.md', TODO_TASK), // depends on T-000
    ];
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
    expect(counts).toEqual({ TODO: 2, DONE: 1, BLOCKED: 0 });
  });

  it('returns zeros for empty array', () => {
    const counts = countByStatus([]);
    expect(counts).toEqual({ TODO: 0, DONE: 0, BLOCKED: 0 });
  });

  it('counts BLOCKED tasks separately', () => {
    const tasks: Task[] = [
      parseTaskFile('T-000.md', DONE_TASK),
      parseTaskFile('T-080.md', STATUS_BLOCKED_TASK),
      parseTaskFile('T-005.md', TODO_NO_DEPS),
    ];
    const counts = countByStatus(tasks);
    expect(counts).toEqual({ TODO: 1, DONE: 1, BLOCKED: 1 });
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

describe('parseDeps — robust "none" variants', () => {
  it('treats "(none)" as no dependencies', () => {
    const task = parseTaskFile(
      'T-090.md',
      TODO_NO_DEPS.replace('T-005', 'T-090').replace('Depends**: none', 'Depends**: (none)'),
    );
    expect(task.depends).toEqual([]);
  });

  it('treats em-dash "—" as no dependencies', () => {
    const task = parseTaskFile(
      'T-091.md',
      TODO_NO_DEPS.replace('T-005', 'T-091').replace('Depends**: none', 'Depends**: —'),
    );
    expect(task.depends).toEqual([]);
  });

  it('treats en-dash "–" as no dependencies', () => {
    const task = parseTaskFile(
      'T-092.md',
      TODO_NO_DEPS.replace('T-005', 'T-092').replace('Depends**: none', 'Depends**: –'),
    );
    expect(task.depends).toEqual([]);
  });

  it('treats single hyphen "-" as no dependencies', () => {
    const task = parseTaskFile(
      'T-093.md',
      TODO_NO_DEPS.replace('T-005', 'T-093').replace('Depends**: none', 'Depends**: -'),
    );
    expect(task.depends).toEqual([]);
  });

  it('treats empty string as no dependencies', () => {
    const task = parseTaskFile(
      'T-094.md',
      TODO_NO_DEPS.replace('T-005', 'T-094').replace('Depends**: none', 'Depends**:'),
    );
    expect(task.depends).toEqual([]);
  });

  it('treats whitespace-only as no dependencies', () => {
    const task = parseTaskFile(
      'T-095.md',
      TODO_NO_DEPS.replace('T-005', 'T-095').replace('Depends**: none', 'Depends**:   '),
    );
    expect(task.depends).toEqual([]);
  });
});

describe('diagnoseIneligible', () => {
  it('returns empty array when there are no TODO tasks', () => {
    const tasks: Task[] = [parseTaskFile('T-000.md', DONE_TASK)];
    expect(diagnoseIneligible(tasks)).toEqual([]);
  });

  it('identifies tasks blocked by section', () => {
    const tasks: Task[] = [
      parseTaskFile('T-000.md', DONE_TASK),
      parseTaskFile('T-003.md', BLOCKED_TASK),
    ];
    const diag = diagnoseIneligible(tasks);
    expect(diag).toHaveLength(1);
    expect(diag[0].taskId).toBe('T-003');
    expect(diag[0].blocked).toBe(true);
  });

  it('identifies unmet dependencies with their status', () => {
    const tasks: Task[] = [
      parseTaskFile('T-001.md', TODO_TASK), // depends on T-000 (not present => phantom)
      parseTaskFile('T-004.md', MULTI_DEPS_TASK), // depends on T-001, T-002
    ];
    const diag = diagnoseIneligible(tasks);
    const t001Diag = diag.find((d) => d.taskId === 'T-001');
    expect(t001Diag).toBeDefined();
    expect(t001Diag!.unmetDeps).toHaveLength(1);
    expect(t001Diag!.unmetDeps[0].depId).toBe('T-000');
    expect(t001Diag!.unmetDeps[0].status).toBe('unknown');

    const t004Diag = diag.find((d) => d.taskId === 'T-004');
    expect(t004Diag).toBeDefined();
    expect(t004Diag!.unmetDeps).toHaveLength(2);
    expect(t004Diag!.unmetDeps[0].depId).toBe('T-001');
    expect(t004Diag!.unmetDeps[0].status).toBe('TODO');
    expect(t004Diag!.unmetDeps[1].depId).toBe('T-002');
    expect(t004Diag!.unmetDeps[1].status).toBe('unknown');
  });

  it('flags phantom dependencies (task IDs that do not exist)', () => {
    const taskWithPhantom = `# T-087: Phantom dep task

- **Status**: TODO
- **Milestone**: 2 — Core
- **Depends**: (none)
- **PRD Reference**: §3

## Description

A task whose dep field was mistyped.

## Produces

- \`src/phantom.ts\`
`;
    // Since (none) is now treated as no deps, this should be eligible — not in diagnostics
    const tasks: Task[] = [parseTaskFile('T-087.md', taskWithPhantom)];
    const diag = diagnoseIneligible(tasks);
    expect(diag).toEqual([]);
  });

  it('returns formatted diagnostic lines', () => {
    const tasks: Task[] = [
      parseTaskFile('T-001.md', TODO_TASK), // depends on T-000 (phantom)
    ];
    const diag = diagnoseIneligible(tasks);
    expect(diag).toHaveLength(1);
    expect(diag[0].taskId).toBe('T-001');
    expect(diag[0].unmetDeps[0].depId).toBe('T-000');
    expect(diag[0].unmetDeps[0].status).toBe('unknown');
  });
});
