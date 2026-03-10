import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { run } from '../commands/shas.js';

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8' }).trim();
}

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ralph-shas-test-'));
  git(dir, 'init');
  git(dir, 'config user.email "test@test.com"');
  git(dir, 'config user.name "Test"');
  return dir;
}

async function makeCommit(
  dir: string,
  filename: string,
  content: string,
  message: string,
): Promise<string> {
  await writeFile(join(dir, filename), content);
  git(dir, `add ${filename}`);
  git(dir, `commit -m "${message}"`);
  return git(dir, 'rev-parse HEAD');
}

describe('ralph shas', () => {
  let dir: string;
  let tasksDir: string;
  let logSpy: ReturnType<typeof import('vitest').vi.spyOn>;

  beforeEach(async () => {
    dir = await initRepo();
    tasksDir = join(dir, 'docs', 'tasks');
    await mkdir(tasksDir, { recursive: true });
    // Need an initial commit so git log works
    await makeCommit(dir, 'init.txt', 'init', 'initial commit');
    logSpy = (await import('vitest')).vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  });

  it('backfills a missing Commit field in a DONE task', async () => {
    const sha = await makeCommit(dir, 'feature.ts', 'code', 'T-001: Add feature');
    await writeFile(
      join(tasksDir, 'T-001.md'),
      `# T-001: Add feature

- **Status**: DONE
- **Milestone**: 1 — Core
- **Depends**: none
- **PRD Reference**: §1
- **Completed**: 2026-03-10 10:00 (5m duration)

## Description

Add a feature.
`,
    );

    await run([], dir);

    const content = await readFile(join(tasksDir, 'T-001.md'), 'utf-8');
    expect(content).toContain(`- **Commit**: ${sha}`);
  });

  it('corrects an incorrect Commit SHA', async () => {
    const sha = await makeCommit(dir, 'feature.ts', 'code', 'T-002: Fix bug');
    await writeFile(
      join(tasksDir, 'T-002.md'),
      `# T-002: Fix bug

- **Status**: DONE
- **Milestone**: 1 — Core
- **Depends**: none
- **PRD Reference**: §1
- **Completed**: 2026-03-10 10:00 (5m duration)
- **Commit**: 0000000000000000000000000000000000000000

## Description

Fix a bug.
`,
    );

    await run([], dir);

    const content = await readFile(join(tasksDir, 'T-002.md'), 'utf-8');
    expect(content).toContain(`- **Commit**: ${sha}`);
    expect(content).not.toContain('0000000000000000000000000000000000000000');
  });

  it('does not modify a task with the correct SHA', async () => {
    const sha = await makeCommit(dir, 'feature.ts', 'code', 'T-003: Correct task');
    const original = `# T-003: Correct task

- **Status**: DONE
- **Milestone**: 1 — Core
- **Depends**: none
- **PRD Reference**: §1
- **Completed**: 2026-03-10 10:00 (5m duration)
- **Commit**: ${sha}

## Description

Already correct.
`;
    await writeFile(join(tasksDir, 'T-003.md'), original);

    await run([], dir);

    const content = await readFile(join(tasksDir, 'T-003.md'), 'utf-8');
    expect(content).toBe(original);
  });

  it('skips TODO tasks', async () => {
    const original = `# T-004: Pending task

- **Status**: TODO
- **Milestone**: 2 — Features
- **Depends**: none
- **PRD Reference**: §2

## Description

Not done yet.
`;
    await writeFile(join(tasksDir, 'T-004.md'), original);

    await run([], dir);

    const content = await readFile(join(tasksDir, 'T-004.md'), 'utf-8');
    expect(content).toBe(original);
  });

  it('reports what was changed', async () => {
    await makeCommit(dir, 'feature.ts', 'code', 'T-005: Report test');
    await writeFile(
      join(tasksDir, 'T-005.md'),
      `# T-005: Report test

- **Status**: DONE
- **Milestone**: 1 — Core
- **Depends**: none
- **PRD Reference**: §1
- **Completed**: 2026-03-10 10:00 (5m duration)

## Description

Test reporting.
`,
    );

    await run([], dir);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('T-005'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Updated'));
  });

  it('reports no changes when nothing needs updating', async () => {
    const sha = await makeCommit(dir, 'feature.ts', 'code', 'T-006: Already done');
    await writeFile(
      join(tasksDir, 'T-006.md'),
      `# T-006: Already done

- **Status**: DONE
- **Milestone**: 1 — Core
- **Depends**: none
- **PRD Reference**: §1
- **Completed**: 2026-03-10 10:00 (5m duration)
- **Commit**: ${sha}

## Description

Already correct.
`,
    );

    await run([], dir);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No changes'));
  });

  it('handles DONE tasks with no matching commit in git log', async () => {
    await writeFile(
      join(tasksDir, 'T-007.md'),
      `# T-007: No commit found

- **Status**: DONE
- **Milestone**: 1 — Core
- **Depends**: none
- **PRD Reference**: §1
- **Completed**: 2026-03-10 10:00 (5m duration)

## Description

No matching commit.
`,
    );

    await run([], dir);

    // Should not modify the file since no commit was found
    const content = await readFile(join(tasksDir, 'T-007.md'), 'utf-8');
    expect(content).not.toContain('- **Commit**:');
    // Should warn about the missing commit
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('T-007'));
  });

  it('handles multiple tasks with mixed states', async () => {
    const sha1 = await makeCommit(dir, 'a.ts', 'a', 'T-010: First feature');
    const sha2 = await makeCommit(dir, 'b.ts', 'b', 'T-011: Second feature');

    // T-010: missing commit
    await writeFile(
      join(tasksDir, 'T-010.md'),
      `# T-010: First feature

- **Status**: DONE
- **Milestone**: 1 — Core
- **Depends**: none
- **PRD Reference**: §1
- **Completed**: 2026-03-10 10:00 (5m duration)

## Description

First.
`,
    );

    // T-011: correct commit
    await writeFile(
      join(tasksDir, 'T-011.md'),
      `# T-011: Second feature

- **Status**: DONE
- **Milestone**: 1 — Core
- **Depends**: none
- **PRD Reference**: §1
- **Completed**: 2026-03-10 10:00 (5m duration)
- **Commit**: ${sha2}

## Description

Second.
`,
    );

    // T-012: TODO, should be skipped
    await writeFile(
      join(tasksDir, 'T-012.md'),
      `# T-012: Pending

- **Status**: TODO
- **Milestone**: 2 — Features
- **Depends**: T-010
- **PRD Reference**: §2

## Description

Pending.
`,
    );

    await run([], dir);

    const content10 = await readFile(join(tasksDir, 'T-010.md'), 'utf-8');
    expect(content10).toContain(`- **Commit**: ${sha1}`);

    const content11 = await readFile(join(tasksDir, 'T-011.md'), 'utf-8');
    expect(content11).toContain(`- **Commit**: ${sha2}`);

    const content12 = await readFile(join(tasksDir, 'T-012.md'), 'utf-8');
    expect(content12).not.toContain('- **Commit**:');
  });

  it('inserts Commit field after PRD Reference when Completed is missing', async () => {
    const sha = await makeCommit(dir, 'feature.ts', 'code', 'T-009: No completed field');
    await writeFile(
      join(tasksDir, 'T-009.md'),
      `# T-009: No completed field

- **Status**: DONE
- **Milestone**: 1 — Core
- **Depends**: none
- **PRD Reference**: §1

## Description

DONE task missing Completed field.
`,
    );

    await run([], dir);

    const content = await readFile(join(tasksDir, 'T-009.md'), 'utf-8');
    expect(content).toContain(`- **Commit**: ${sha}`);
    const lines = content.split('\n');
    const prdIdx = lines.findIndex((l) => l.startsWith('- **PRD Reference**:'));
    const commitIdx = lines.findIndex((l) => l.startsWith('- **Commit**:'));
    expect(commitIdx).toBe(prdIdx + 1);
  });

  it('inserts Commit field after Completed when adding new field', async () => {
    await makeCommit(dir, 'feature.ts', 'code', 'T-008: Field ordering');
    await writeFile(
      join(tasksDir, 'T-008.md'),
      `# T-008: Field ordering

- **Status**: DONE
- **Milestone**: 1 — Core
- **Depends**: none
- **PRD Reference**: §1
- **Completed**: 2026-03-10 10:00 (5m duration)

## Description

Check field ordering.
`,
    );

    await run([], dir);

    const content = await readFile(join(tasksDir, 'T-008.md'), 'utf-8');
    const lines = content.split('\n');
    const completedIdx = lines.findIndex((l) => l.startsWith('- **Completed**:'));
    const commitIdx = lines.findIndex((l) => l.startsWith('- **Commit**:'));
    expect(commitIdx).toBe(completedIdx + 1);
  });
});
