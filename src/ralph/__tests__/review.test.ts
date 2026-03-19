import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeAssistantText(text: string, timestamp?: string): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: timestamp ?? '2026-03-19T10:00:00Z',
    message: { content: [{ type: 'text', text }] },
  });
}

function makeAssistantToolUse(
  name: string,
  input: Record<string, unknown>,
  timestamp?: string,
): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: timestamp ?? '2026-03-19T10:00:00Z',
    message: { content: [{ type: 'tool_use', name, input }] },
  });
}

function makeResult(fields: Record<string, unknown>): string {
  return JSON.stringify({ type: 'result', ...fields });
}

describe('review command', () => {
  let tmpDir: string;
  let logsDir: string;
  let tasksDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ralph-review-'));
    logsDir = join(tmpDir, '.ralph-logs');
    tasksDir = join(tmpDir, 'docs', 'tasks');
    await mkdir(logsDir, { recursive: true });
    await mkdir(tasksDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('formatReviewTimeline', () => {
    it('formats a single successful attempt', async () => {
      const { formatReviewTimeline } = await import('../commands/review.js');
      const logContent = [
        makeAssistantText('[PHASE] Entering: Boot', '2026-03-19T10:00:00Z'),
        makeAssistantText('[ROLE: Product Manager] Task aligns with PRD.', '2026-03-19T10:01:00Z'),
        makeAssistantText('[PHASE] Entering: Red', '2026-03-19T10:05:00Z'),
        makeAssistantText('[PHASE] Entering: Green', '2026-03-19T10:10:00Z'),
        makeAssistantText('[PHASE] Entering: Verify', '2026-03-19T10:15:00Z'),
        makeAssistantText('[ROLE: SDET] TDD compliance verified.', '2026-03-19T10:16:00Z'),
        makeAssistantText('[PHASE] Entering: Commit', '2026-03-19T10:20:00Z'),
        makeAssistantToolUse('Write', { file_path: '/project/src/foo.ts' }),
        makeResult({ subtype: 'success', num_turns: 20, stop_reason: 'end_turn' }),
      ].join('\n');
      await writeFile(join(logsDir, 'T-042-1711036800000.jsonl'), logContent);

      const output = formatReviewTimeline('T-042', logsDir);
      const result = await output;
      expect(result).toContain('T-042');
      expect(result).toContain('Boot');
      expect(result).toContain('Red');
      expect(result).toContain('Product Manager');
      expect(result).toContain('SDET');
    });

    it('shows multiple attempts in sequence', async () => {
      const { formatReviewTimeline } = await import('../commands/review.js');
      const attempt1 = [
        makeAssistantText('[PHASE] Entering: Boot', '2026-03-19T09:00:00Z'),
        makeAssistantText('[PHASE] Entering: Red', '2026-03-19T09:05:00Z'),
        makeResult({ subtype: 'error', stop_reason: 'max_turns', num_turns: 50 }),
      ].join('\n');
      const attempt2 = [
        makeAssistantText('[PHASE] Entering: Boot', '2026-03-19T10:00:00Z'),
        makeAssistantText('[PHASE] Entering: Red', '2026-03-19T10:05:00Z'),
        makeAssistantText('[PHASE] Entering: Commit', '2026-03-19T10:20:00Z'),
        makeResult({ subtype: 'success', num_turns: 25, stop_reason: 'end_turn' }),
      ].join('\n');
      await writeFile(join(logsDir, 'T-042-1711033200000.jsonl'), attempt1);
      await writeFile(join(logsDir, 'T-042-1711036800000.jsonl'), attempt2);

      const result = await formatReviewTimeline('T-042', logsDir);
      expect(result).toContain('Attempt 1');
      expect(result).toContain('Attempt 2');
    });

    it('handles task with no logs', async () => {
      const { formatReviewTimeline } = await import('../commands/review.js');
      const result = await formatReviewTimeline('T-999', logsDir);
      expect(result).toContain('No log files found');
    });
  });

  describe('formatDiagnosis', () => {
    it('diagnoses max_turns failure', async () => {
      const { formatDiagnosis } = await import('../commands/review.js');
      const logContent = [
        makeAssistantText('[PHASE] Entering: Boot', '2026-03-19T10:00:00Z'),
        makeAssistantText('[PHASE] Entering: Red', '2026-03-19T10:05:00Z'),
        makeResult({ subtype: 'error', stop_reason: 'max_turns', num_turns: 50 }),
      ].join('\n');
      await writeFile(join(logsDir, 'T-042-1711036800000.jsonl'), logContent);

      const result = await formatDiagnosis('T-042', logsDir);
      expect(result).toContain('max_turns');
      expect(result).toContain('Recommendation');
    });

    it('diagnoses blocked_by_agent failure', async () => {
      const { formatDiagnosis } = await import('../commands/review.js');
      const logContent = [
        makeAssistantText('[PHASE] Entering: Boot', '2026-03-19T10:00:00Z'),
        makeAssistantText('[BLOCKED] Missing external API credentials'),
        makeResult({ subtype: 'error', num_turns: 10 }),
      ].join('\n');
      await writeFile(join(logsDir, 'T-042-1711036800000.jsonl'), logContent);

      const result = await formatDiagnosis('T-042', logsDir);
      expect(result).toContain('blocked_by_agent');
      expect(result).toContain('Missing external API credentials');
    });

    it('surfaces role gate rejections as likely cause', async () => {
      const { formatDiagnosis } = await import('../commands/review.js');
      const logContent = [
        makeAssistantText('[PHASE] Entering: Verify', '2026-03-19T10:00:00Z'),
        makeAssistantText(
          '[ROLE: SDET] TDD compliance FAILED: tests written after implementation',
          '2026-03-19T10:01:00Z',
        ),
        makeResult({ subtype: 'error', num_turns: 30 }),
      ].join('\n');
      await writeFile(join(logsDir, 'T-042-1711036800000.jsonl'), logContent);

      const result = await formatDiagnosis('T-042', logsDir);
      expect(result).toContain('role_rejection');
      expect(result).toContain('SDET');
    });

    it('handles task with no logs', async () => {
      const { formatDiagnosis } = await import('../commands/review.js');
      const result = await formatDiagnosis('T-999', logsDir);
      expect(result).toContain('No log files found');
    });
  });

  describe('formatReviewJson', () => {
    it('returns structured JSON for timeline mode', async () => {
      const { formatReviewJson } = await import('../commands/review.js');
      const logContent = [
        makeAssistantText('[PHASE] Entering: Boot', '2026-03-19T10:00:00Z'),
        makeAssistantText('[PHASE] Entering: Red', '2026-03-19T10:05:00Z'),
        makeResult({ subtype: 'success', num_turns: 20, stop_reason: 'end_turn' }),
      ].join('\n');
      await writeFile(join(logsDir, 'T-042-1711036800000.jsonl'), logContent);

      const result = await formatReviewJson('T-042', logsDir, false);
      const parsed = JSON.parse(result);
      expect(parsed.taskId).toBe('T-042');
      expect(parsed.attempts).toHaveLength(1);
      expect(parsed.attempts[0].phases).toHaveLength(2);
    });

    it('includes diagnosis in JSON when requested', async () => {
      const { formatReviewJson } = await import('../commands/review.js');
      const logContent = [
        makeAssistantText('[PHASE] Entering: Boot', '2026-03-19T10:00:00Z'),
        makeResult({ subtype: 'error', stop_reason: 'max_turns', num_turns: 50 }),
      ].join('\n');
      await writeFile(join(logsDir, 'T-042-1711036800000.jsonl'), logContent);

      const result = await formatReviewJson('T-042', logsDir, true);
      const parsed = JSON.parse(result);
      expect(parsed.diagnosis).toBeDefined();
      expect(parsed.diagnosis.classification).toBe('max_turns');
    });
  });

  describe('run', () => {
    it('exits with error for missing task ID', async () => {
      const { run } = await import('../commands/review.js');
      const logs: string[] = [];
      const origError = console.error;
      console.error = (msg: string) => logs.push(msg);
      try {
        await run([], tmpDir);
        expect(logs.some((l) => l.includes('task ID'))).toBe(true);
      } finally {
        console.error = origError;
      }
    });

    it('exits with error for invalid task ID', async () => {
      const { run } = await import('../commands/review.js');
      const logs: string[] = [];
      const origError = console.error;
      console.error = (msg: string) => logs.push(msg);
      try {
        await run(['bad-id'], tmpDir);
        expect(logs.some((l) => l.includes('Invalid'))).toBe(true);
      } finally {
        console.error = origError;
      }
    });

    it('displays timeline by default', async () => {
      const { run } = await import('../commands/review.js');
      const logContent = [
        makeAssistantText('[PHASE] Entering: Boot', '2026-03-19T10:00:00Z'),
        makeResult({ subtype: 'success', num_turns: 10, stop_reason: 'end_turn' }),
      ].join('\n');
      await writeFile(join(logsDir, 'T-042-1711036800000.jsonl'), logContent);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (msg: string) => logs.push(msg);
      try {
        await run(['T-042'], tmpDir);
        expect(logs.some((l) => l.includes('T-042'))).toBe(true);
      } finally {
        console.log = origLog;
      }
    });

    it('displays diagnosis with --diagnose flag', async () => {
      const { run } = await import('../commands/review.js');
      const logContent = [
        makeAssistantText('[PHASE] Entering: Boot', '2026-03-19T10:00:00Z'),
        makeResult({ subtype: 'error', stop_reason: 'max_turns', num_turns: 50 }),
      ].join('\n');
      await writeFile(join(logsDir, 'T-042-1711036800000.jsonl'), logContent);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (msg: string) => logs.push(msg);
      try {
        await run(['T-042', '--diagnose'], tmpDir);
        expect(logs.some((l) => l.includes('max_turns'))).toBe(true);
      } finally {
        console.log = origLog;
      }
    });

    it('outputs JSON with --json flag', async () => {
      const { run } = await import('../commands/review.js');
      const logContent = [
        makeAssistantText('[PHASE] Entering: Boot', '2026-03-19T10:00:00Z'),
        makeResult({ subtype: 'success', num_turns: 10, stop_reason: 'end_turn' }),
      ].join('\n');
      await writeFile(join(logsDir, 'T-042-1711036800000.jsonl'), logContent);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (msg: string) => logs.push(msg);
      try {
        await run(['T-042', '--json'], tmpDir);
        const json = JSON.parse(logs.join(''));
        expect(json.taskId).toBe('T-042');
      } finally {
        console.log = origLog;
      }
    });
  });
});
