import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function makeTempDir(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  return mkdtemp(join(tmpdir(), 'retry-cmd-test-'));
}

function blockedTaskContent(id: string): string {
  return [
    `# ${id}: Test task`,
    '',
    `- **Status**: BLOCKED`,
    `- **Milestone**: 1 — Setup`,
    `- **Depends**: none`,
    `- **PRD Reference**: §1`,
    `- **Blocked reason**: Retry limit exceeded`,
    '',
    '## Description',
    '',
    'A task.',
    '',
  ].join('\n');
}

describe('retry command', () => {
  let projectDir: string;
  let tasksDir: string;
  let logsDir: string;

  beforeEach(async () => {
    projectDir = await makeTempDir();
    tasksDir = join(projectDir, 'docs', 'tasks');
    logsDir = join(projectDir, '.ralph-logs');
    await mkdir(tasksDir, { recursive: true });
    await mkdir(logsDir, { recursive: true });
  });

  it('resets multiple BLOCKED tasks in one invocation', async () => {
    await writeFile(join(tasksDir, 'T-005.md'), blockedTaskContent('T-005'));
    await writeFile(join(tasksDir, 'T-006.md'), blockedTaskContent('T-006'));

    const { run } = await import('../commands/retry.js');
    await run(['T-005', 'T-006'], projectDir);

    const content5 = await readFile(join(tasksDir, 'T-005.md'), 'utf-8');
    const content6 = await readFile(join(tasksDir, 'T-006.md'), 'utf-8');
    expect(content5).toContain('**Status**: TODO');
    expect(content6).toContain('**Status**: TODO');
  });

  it('exits with error when no task IDs provided', async () => {
    const { run } = await import('../commands/retry.js');
    await expect(run([], projectDir)).rejects.toThrow(/task ID/i);
  });

  it('reports errors for individual tasks without stopping others', async () => {
    await writeFile(join(tasksDir, 'T-005.md'), blockedTaskContent('T-005'));
    // T-999 doesn't exist

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { run } = await import('../commands/retry.js');
    await run(['T-999', 'T-005'], projectDir);

    consoleSpy.mockRestore();
    logSpy.mockRestore();

    // T-005 should still be reset despite T-999 failing
    const content = await readFile(join(tasksDir, 'T-005.md'), 'utf-8');
    expect(content).toContain('**Status**: TODO');
  });
});
