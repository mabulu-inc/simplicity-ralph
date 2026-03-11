import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  extractRetryContext,
  formatRetryContext,
  findLatestLogForTask,
  buildRetryContext,
  type RetryContext,
} from '../core/retry-context.js';

describe('extractRetryContext', () => {
  it('returns null for empty log content', () => {
    const result = extractRetryContext('');
    expect(result).toBeNull();
  });

  it('extracts last phase from [PHASE] markers in text content', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '[PHASE] Entering: Boot' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '[PHASE] Entering: Red' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '[PHASE] Entering: Green' }] },
      }),
    ].join('\n');

    const result = extractRetryContext(lines);
    expect(result).not.toBeNull();
    expect(result!.lastPhase).toBe('Green');
  });

  it('extracts error output from result entries with non-zero exit code', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '[PHASE] Entering: Verify' }] },
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'tool_result',
        tool_name: 'Bash',
        content: 'Error: test failed\nExpected 3 but got 5',
      }),
    ].join('\n');

    const result = extractRetryContext(lines);
    expect(result).not.toBeNull();
    expect(result!.lastError).toContain('test failed');
  });

  it('extracts modified files from tool calls with file paths', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '[PHASE] Entering: Red' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: { file_path: '/project/src/foo.ts', content: 'code' },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Edit',
              input: { file_path: '/project/src/bar.ts', old_string: 'a', new_string: 'b' },
            },
          ],
        },
      }),
    ].join('\n');

    const result = extractRetryContext(lines);
    expect(result).not.toBeNull();
    expect(result!.modifiedFiles).toContain('src/foo.ts');
    expect(result!.modifiedFiles).toContain('src/bar.ts');
  });

  it('deduplicates modified files', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '[PHASE] Entering: Red' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: { file_path: '/project/src/foo.ts', content: 'v1' },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Edit',
              input: { file_path: '/project/src/foo.ts', old_string: 'v1', new_string: 'v2' },
            },
          ],
        },
      }),
    ].join('\n');

    const result = extractRetryContext(lines);
    expect(result).not.toBeNull();
    expect(result!.modifiedFiles).toHaveLength(1);
  });

  it('extracts the last error text from assistant text content', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '[PHASE] Entering: Verify' }] },
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'tool_result',
        tool_name: 'Bash',
        content:
          'FAIL src/__tests__/foo.test.ts\n  × should work\n    Expected: true\n    Received: false',
      }),
    ].join('\n');

    const result = extractRetryContext(lines);
    expect(result).not.toBeNull();
    expect(result!.lastError).toContain('FAIL');
  });

  it('defaults lastPhase to "unknown" when no phase markers found', () => {
    const lines = [
      JSON.stringify({
        type: 'result',
        subtype: 'tool_result',
        tool_name: 'Bash',
        content: 'Error occurred',
      }),
    ].join('\n');

    const result = extractRetryContext(lines);
    expect(result).not.toBeNull();
    expect(result!.lastPhase).toBe('unknown');
  });

  it('strips absolute path prefix from file paths', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '[PHASE] Entering: Red' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: { file_path: '/Users/dev/myproject/src/core/task.ts', content: 'code' },
            },
          ],
        },
      }),
    ].join('\n');

    const result = extractRetryContext(lines);
    expect(result).not.toBeNull();
    // Should have a relative-ish path, not the full absolute path
    expect(result!.modifiedFiles[0].startsWith('/Users/dev')).toBe(false);
    expect(result!.modifiedFiles[0]).toContain('task.ts');
  });
});

describe('formatRetryContext', () => {
  it('returns empty string for null context', () => {
    const result = formatRetryContext(null);
    expect(result).toBe('');
  });

  it('formats context with all fields populated', () => {
    const ctx: RetryContext = {
      lastPhase: 'Verify',
      lastError: 'TypeScript error: Cannot find name "foo"',
      modifiedFiles: ['src/core/task.ts', 'src/__tests__/task.test.ts'],
    };

    const result = formatRetryContext(ctx);
    expect(result).toContain('Verify');
    expect(result).toContain('Cannot find name "foo"');
    expect(result).toContain('src/core/task.ts');
    expect(result).toContain('src/__tests__/task.test.ts');
    expect(result).toContain('previous attempt');
  });

  it('handles context with empty error', () => {
    const ctx: RetryContext = {
      lastPhase: 'Boot',
      lastError: '',
      modifiedFiles: [],
    };

    const result = formatRetryContext(ctx);
    expect(result).toContain('Boot');
    expect(result.length).toBeGreaterThan(0);
  });

  it('caps output to 2000 characters', () => {
    const ctx: RetryContext = {
      lastPhase: 'Verify',
      lastError: 'x'.repeat(3000),
      modifiedFiles: ['src/a.ts'],
    };

    const result = formatRetryContext(ctx);
    expect(result.length).toBeLessThanOrEqual(2000);
  });

  it('instructs agent not to repeat the same approach', () => {
    const ctx: RetryContext = {
      lastPhase: 'Green',
      lastError: 'Test timeout',
      modifiedFiles: ['src/foo.ts'],
    };

    const result = formatRetryContext(ctx);
    // Should contain guidance about not repeating the failure
    expect(result).toMatch(/avoid|different|repeat|same/i);
  });

  it('tells agent to focus on the failure point', () => {
    const ctx: RetryContext = {
      lastPhase: 'Verify',
      lastError: 'Lint error',
      modifiedFiles: ['src/bar.ts'],
    };

    const result = formatRetryContext(ctx);
    expect(result).toMatch(/focus|failure|fix/i);
  });
});

describe('findLatestLogForTask', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ralph-retry-log-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null when logs dir does not exist', async () => {
    const result = await findLatestLogForTask('/nonexistent', 'T-001');
    expect(result).toBeNull();
  });

  it('returns null when no matching log files exist', async () => {
    await writeFile(join(tmpDir, 'T-002-20250101-120000.jsonl'), '{}');
    const result = await findLatestLogForTask(tmpDir, 'T-001');
    expect(result).toBeNull();
  });

  it('returns the latest log file for the task', async () => {
    await writeFile(join(tmpDir, 'T-001-20250101-120000.jsonl'), '{}');
    await writeFile(join(tmpDir, 'T-001-20250102-120000.jsonl'), '{}');
    await writeFile(join(tmpDir, 'T-002-20250101-120000.jsonl'), '{}');

    const result = await findLatestLogForTask(tmpDir, 'T-001');
    expect(result).toBe(join(tmpDir, 'T-001-20250102-120000.jsonl'));
  });
});

describe('buildRetryContext', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ralph-retry-build-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty string when no log files exist', async () => {
    const result = await buildRetryContext(tmpDir, 'T-001');
    expect(result).toBe('');
  });

  it('returns formatted retry context from log file', async () => {
    const logContent = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '[PHASE] Entering: Verify' }] },
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'tool_result',
        tool_name: 'Bash',
        content: 'Error: test failed',
      }),
    ].join('\n');

    await writeFile(join(tmpDir, 'T-001-20250101-120000.jsonl'), logContent);
    const result = await buildRetryContext(tmpDir, 'T-001');
    expect(result).toContain('Verify');
    expect(result).toContain('test failed');
  });
});
