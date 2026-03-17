import { describe, it, expect, beforeEach } from 'vitest';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { retryTask } from '../core/retry.js';

async function makeTempDir(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  return mkdtemp(join(tmpdir(), 'retry-test-'));
}

function blockedTaskContent(id: string): string {
  return [
    `# ${id}: Test task`,
    '',
    `- **Status**: BLOCKED`,
    `- **Milestone**: 1 — Setup`,
    `- **Depends**: none`,
    `- **PRD Reference**: §1`,
    `- **Blocked reason**: Cost cap exceeded`,
    '',
    '## Description',
    '',
    'Some description.',
    '',
    '## Produces',
    '',
    '- `src/foo.ts`',
    '',
  ].join('\n');
}

function doneTaskContent(id: string): string {
  return [
    `# ${id}: Done task`,
    '',
    `- **Status**: DONE`,
    `- **Milestone**: 1 — Setup`,
    `- **Depends**: none`,
    `- **PRD Reference**: §1`,
    `- **Completed**: 2026-01-01 12:00`,
    `- **Commit**: abc1234`,
    '',
    '## Description',
    '',
    'Already done.',
    '',
  ].join('\n');
}

function todoTaskContent(id: string): string {
  return [
    `# ${id}: Todo task`,
    '',
    `- **Status**: TODO`,
    `- **Milestone**: 1 — Setup`,
    `- **Depends**: none`,
    `- **PRD Reference**: §1`,
    '',
    '## Description',
    '',
    'Not yet started.',
    '',
  ].join('\n');
}

describe('retryTask', () => {
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

  it('resets a BLOCKED task to TODO and removes Blocked reason', async () => {
    await writeFile(join(tasksDir, 'T-005.md'), blockedTaskContent('T-005'));

    const result = await retryTask('T-005', projectDir);

    expect(result.status).toBe('reset');
    const content = await readFile(join(tasksDir, 'T-005.md'), 'utf-8');
    expect(content).toContain('**Status**: TODO');
    expect(content).not.toContain('BLOCKED');
    expect(content).not.toContain('Blocked reason');
    // Other fields preserved
    expect(content).toContain('**Milestone**: 1 — Setup');
    expect(content).toContain('**PRD Reference**: §1');
    expect(content).toContain('Some description.');
  });

  it('archives log files to resets subfolder', async () => {
    await writeFile(join(tasksDir, 'T-005.md'), blockedTaskContent('T-005'));
    await writeFile(join(logsDir, 'T-005-attempt-1.jsonl'), '{"line":1}\n');
    await writeFile(join(logsDir, 'T-005-attempt-2.jsonl'), '{"line":2}\n');

    await retryTask('T-005', projectDir);

    const resetsDir = join(logsDir, 'T-005-resets');
    const files = await readdir(resetsDir);
    expect(files).toContain('T-005-attempt-1.jsonl');
    expect(files).toContain('T-005-attempt-2.jsonl');

    // Original files should be gone
    const logsFiles = await readdir(logsDir);
    expect(logsFiles).not.toContain('T-005-attempt-1.jsonl');
    expect(logsFiles).not.toContain('T-005-attempt-2.jsonl');
  });

  it('preserves existing archived logs on repeated resets', async () => {
    await writeFile(join(tasksDir, 'T-005.md'), blockedTaskContent('T-005'));

    // Simulate a prior reset with archived logs
    const resetsDir = join(logsDir, 'T-005-resets');
    await mkdir(resetsDir, { recursive: true });
    await writeFile(join(resetsDir, 'T-005-attempt-1.jsonl'), '{"old":true}\n');

    // New log from the retry attempt that also failed
    await writeFile(join(logsDir, 'T-005-attempt-2.jsonl'), '{"new":true}\n');

    await retryTask('T-005', projectDir);

    const files = await readdir(resetsDir);
    expect(files).toContain('T-005-attempt-1.jsonl');
    expect(files).toContain('T-005-attempt-2.jsonl');

    // Verify old file is untouched
    const oldContent = await readFile(join(resetsDir, 'T-005-attempt-1.jsonl'), 'utf-8');
    expect(oldContent).toBe('{"old":true}\n');
  });

  it('returns error for DONE tasks', async () => {
    await writeFile(join(tasksDir, 'T-010.md'), doneTaskContent('T-010'));

    const result = await retryTask('T-010', projectDir);

    expect(result.status).toBe('error');
    expect(result.message).toMatch(/DONE/);
  });

  it('returns noop for TODO tasks with no logs', async () => {
    await writeFile(join(tasksDir, 'T-010.md'), todoTaskContent('T-010'));

    const result = await retryTask('T-010', projectDir);

    expect(result.status).toBe('noop');
  });

  it('returns error for nonexistent task', async () => {
    const result = await retryTask('T-999', projectDir);

    expect(result.status).toBe('error');
    expect(result.message).toMatch(/not found/i);
  });

  it('handles BLOCKED task with no log files', async () => {
    await writeFile(join(tasksDir, 'T-005.md'), blockedTaskContent('T-005'));

    const result = await retryTask('T-005', projectDir);

    expect(result.status).toBe('reset');
    const content = await readFile(join(tasksDir, 'T-005.md'), 'utf-8');
    expect(content).toContain('**Status**: TODO');
  });

  it('only moves logs matching the task ID', async () => {
    await writeFile(join(tasksDir, 'T-005.md'), blockedTaskContent('T-005'));
    await writeFile(join(logsDir, 'T-005-attempt-1.jsonl'), 'log1\n');
    await writeFile(join(logsDir, 'T-006-attempt-1.jsonl'), 'other\n');

    await retryTask('T-005', projectDir);

    const logsFiles = await readdir(logsDir);
    expect(logsFiles).toContain('T-006-attempt-1.jsonl');
    expect(logsFiles).not.toContain('T-005-attempt-1.jsonl');
  });
});
