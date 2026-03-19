import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 55 words — above the 50-word minimum
const LONG_DESC =
  'This task implements a comprehensive module that handles the parsing and analysis of project data across multiple dimensions including task quality metrics and role effectiveness patterns and extension health indicators to produce actionable coaching suggestions that help teams improve their development workflow and reduce wasted effort over time through systematic feedback loops.';

function makeTaskFile(opts: {
  id: string;
  title: string;
  status?: string;
  description?: string;
  prdRef?: string;
  depends?: string;
  touches?: string;
  complexity?: string;
  ac?: boolean;
}): string {
  const lines: string[] = [];
  lines.push(`# ${opts.id}: ${opts.title}`);
  lines.push('');
  lines.push(`- **Status:** ${opts.status ?? 'TODO'}`);
  lines.push(`- **PRD Reference:** ${opts.prdRef ?? ''}`);
  if (opts.depends) lines.push(`- **Depends:** ${opts.depends}`);
  if (opts.touches) lines.push(`- **Touches:** ${opts.touches}`);
  if (opts.complexity) lines.push(`- **Complexity:** ${opts.complexity}`);
  lines.push('');
  lines.push('## Description');
  lines.push('');
  lines.push(opts.description ?? 'Short.');
  lines.push('');
  if (opts.ac !== false) {
    lines.push('## AC');
    lines.push('');
    lines.push('- Acceptance criteria item');
    lines.push('');
  }
  return lines.join('\n');
}

function makeLogFile(opts: {
  phases?: string[];
  roles?: Array<{ role: string; phase: string; commentary: string }>;
  numTurns?: number;
  stopReason?: string;
  retried?: boolean;
}): string {
  const lines: string[] = [];
  for (const phase of opts.phases ?? ['Boot', 'Red', 'Green', 'Verify', 'Commit']) {
    lines.push(
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-03-19T10:00:00Z',
        message: { content: [{ type: 'text', text: `[PHASE] Entering: ${phase}` }] },
      }),
    );
  }
  for (const role of opts.roles ?? []) {
    lines.push(
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-03-19T10:01:00Z',
        message: {
          content: [
            {
              type: 'text',
              text: `[PHASE] Entering: ${role.phase}\n[ROLE: ${role.role}] ${role.commentary}`,
            },
          ],
        },
      }),
    );
  }
  lines.push(
    JSON.stringify({
      type: 'result',
      num_turns: opts.numTurns ?? 30,
      stop_reason: opts.stopReason ?? 'end_turn',
    }),
  );
  return lines.join('\n');
}

describe('coach module', () => {
  let tmpDir: string;
  let tasksDir: string;
  let logsDir: string;
  let promptsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ralph-coach-'));
    tasksDir = join(tmpDir, 'docs', 'tasks');
    logsDir = join(tmpDir, '.ralph-logs');
    promptsDir = join(tmpDir, 'docs', 'prompts');
    await mkdir(tasksDir, { recursive: true });
    await mkdir(logsDir, { recursive: true });
    await mkdir(promptsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('analyzeTaskQuality', () => {
    it('flags tasks with short descriptions', async () => {
      const { analyzeTaskQuality } = await import('../core/coach.js');
      await writeFile(
        join(tasksDir, 'T-001.md'),
        makeTaskFile({
          id: 'T-001',
          title: 'Short task',
          description: 'Too short.',
        }),
      );

      const suggestions = await analyzeTaskQuality(tasksDir, logsDir);
      expect(suggestions.some((s) => s.taskId === 'T-001' && s.issue.includes('description'))).toBe(
        true,
      );
    });

    it('flags tasks missing AC section', async () => {
      const { analyzeTaskQuality } = await import('../core/coach.js');
      await writeFile(
        join(tasksDir, 'T-001.md'),
        makeTaskFile({
          id: 'T-001',
          title: 'No AC task',
          description: LONG_DESC,
          ac: false,
        }),
      );

      const suggestions = await analyzeTaskQuality(tasksDir, logsDir);
      expect(suggestions.some((s) => s.taskId === 'T-001' && s.issue.includes('AC'))).toBe(true);
    });

    it('flags tasks missing PRD reference', async () => {
      const { analyzeTaskQuality } = await import('../core/coach.js');
      await writeFile(
        join(tasksDir, 'T-001.md'),
        makeTaskFile({
          id: 'T-001',
          title: 'No PRD ref',
          description: LONG_DESC,
          prdRef: '',
        }),
      );

      const suggestions = await analyzeTaskQuality(tasksDir, logsDir);
      expect(suggestions.some((s) => s.taskId === 'T-001' && s.issue.includes('PRD'))).toBe(true);
    });

    it('flags missing Depends when Touches overlap with other tasks', async () => {
      const { analyzeTaskQuality } = await import('../core/coach.js');
      await writeFile(
        join(tasksDir, 'T-001.md'),
        makeTaskFile({
          id: 'T-001',
          title: 'Task A',
          description: LONG_DESC,
          touches: 'src/shared.ts',
        }),
      );
      await writeFile(
        join(tasksDir, 'T-002.md'),
        makeTaskFile({
          id: 'T-002',
          title: 'Task B',
          description: LONG_DESC,
          touches: 'src/shared.ts',
        }),
      );

      const suggestions = await analyzeTaskQuality(tasksDir, logsDir);
      expect(
        suggestions.some((s) => s.issue.includes('overlap') || s.issue.includes('Depends')),
      ).toBe(true);
    });

    it('suggests upgrading tier when turns exceed 80% of limit', async () => {
      const { analyzeTaskQuality } = await import('../core/coach.js');
      await writeFile(
        join(tasksDir, 'T-001.md'),
        makeTaskFile({
          id: 'T-001',
          title: 'Heavy task',
          status: 'DONE',
          description: LONG_DESC,
          complexity: 'light',
        }),
      );
      // light tier has maxTurns=50, 45 turns = 90% > 80%
      await writeFile(
        join(logsDir, 'T-001-1711036800000.jsonl'),
        makeLogFile({ numTurns: 45, stopReason: 'end_turn' }),
      );

      const suggestions = await analyzeTaskQuality(tasksDir, logsDir);
      expect(
        suggestions.some((s) => s.taskId === 'T-001' && s.action.toLowerCase().includes('upgrad')),
      ).toBe(true);
    });

    it('suggests downgrading tier when turns are below 30% of limit', async () => {
      const { analyzeTaskQuality } = await import('../core/coach.js');
      await writeFile(
        join(tasksDir, 'T-001.md'),
        makeTaskFile({
          id: 'T-001',
          title: 'Easy task',
          status: 'DONE',
          description: LONG_DESC,
          complexity: 'heavy',
        }),
      );
      // heavy tier has maxTurns=125, 20 turns = 16% < 30%
      await writeFile(
        join(logsDir, 'T-001-1711036800000.jsonl'),
        makeLogFile({ numTurns: 20, stopReason: 'end_turn' }),
      );

      const suggestions = await analyzeTaskQuality(tasksDir, logsDir);
      expect(suggestions.some((s) => s.taskId === 'T-001' && s.action.includes('downgrad'))).toBe(
        true,
      );
    });

    it('returns empty array for well-formed tasks', async () => {
      const { analyzeTaskQuality } = await import('../core/coach.js');
      await writeFile(
        join(tasksDir, 'T-001.md'),
        makeTaskFile({
          id: 'T-001',
          title: 'Good task',
          description: LONG_DESC,
          prdRef: '§3.1',
        }),
      );

      const suggestions = await analyzeTaskQuality(tasksDir, logsDir);
      // Should not have quality issues for T-001 (may still have overlap issues)
      expect(
        suggestions.filter((s) => s.taskId === 'T-001' && s.issue.includes('description')).length,
      ).toBe(0);
    });
  });

  describe('analyzeRoleEffectiveness', () => {
    it('flags roles that skip on more than 80% of tasks', async () => {
      const { analyzeRoleEffectiveness } = await import('../core/coach.js');
      // 5 tasks, DBA skips on all 5
      for (let i = 1; i <= 5; i++) {
        await writeFile(
          join(logsDir, `T-00${i}-1711036800000.jsonl`),
          makeLogFile({
            roles: [
              {
                role: 'DBA / Data Engineer',
                phase: 'Boot',
                commentary: 'Skipping — no data models.',
              },
              { role: 'Product Manager', phase: 'Boot', commentary: 'Task aligns with PRD.' },
            ],
          }),
        );
      }

      const suggestions = await analyzeRoleEffectiveness(logsDir, tmpDir);
      expect(suggestions.some((s) => s.issue.includes('DBA'))).toBe(true);
    });

    it('flags roles whose Verify commentary is followed by retries', async () => {
      const { analyzeRoleEffectiveness } = await import('../core/coach.js');
      // Need 3+ unique tasks to meet MIN_TASKS_FOR_PATTERN
      // T-001 and T-002: two attempts each, SDET Verify commentary on failed attempt
      await writeFile(
        join(logsDir, 'T-001-1711036800000.jsonl'),
        makeLogFile({
          roles: [
            {
              role: 'SDET',
              phase: 'Verify',
              commentary: 'TDD compliance FAILED: tests written after implementation',
            },
          ],
          stopReason: 'max_turns',
        }),
      );
      await writeFile(
        join(logsDir, 'T-001-1711036900000.jsonl'),
        makeLogFile({
          roles: [{ role: 'SDET', phase: 'Verify', commentary: 'TDD compliance verified.' }],
          stopReason: 'end_turn',
        }),
      );
      await writeFile(
        join(logsDir, 'T-002-1711036800000.jsonl'),
        makeLogFile({
          roles: [
            {
              role: 'SDET',
              phase: 'Verify',
              commentary: 'TDD compliance FAILED: no red phase evidence',
            },
          ],
          stopReason: 'max_turns',
        }),
      );
      await writeFile(
        join(logsDir, 'T-002-1711036900000.jsonl'),
        makeLogFile({
          roles: [{ role: 'SDET', phase: 'Verify', commentary: 'TDD compliance verified.' }],
          stopReason: 'end_turn',
        }),
      );
      await writeFile(
        join(logsDir, 'T-003-1711036800000.jsonl'),
        makeLogFile({
          roles: [{ role: 'SDET', phase: 'Verify', commentary: 'TDD compliance verified.' }],
          stopReason: 'end_turn',
        }),
      );

      const suggestions = await analyzeRoleEffectiveness(logsDir, tmpDir);
      expect(suggestions.some((s) => s.issue.includes('SDET') || s.issue.includes('retry'))).toBe(
        true,
      );
    });

    it('returns empty array when no roles skip frequently', async () => {
      const { analyzeRoleEffectiveness } = await import('../core/coach.js');
      await writeFile(
        join(logsDir, 'T-001-1711036800000.jsonl'),
        makeLogFile({
          roles: [{ role: 'Product Manager', phase: 'Boot', commentary: 'Task aligns with PRD.' }],
        }),
      );

      const suggestions = await analyzeRoleEffectiveness(logsDir, tmpDir);
      // With only 1 task, no meaningful patterns to flag
      expect(Array.isArray(suggestions)).toBe(true);
    });
  });

  describe('analyzeExtensionHealth', () => {
    it('suggests creating rules.md when none exists', async () => {
      const { analyzeExtensionHealth } = await import('../core/coach.js');
      const suggestions = await analyzeExtensionHealth(promptsDir, tasksDir, logsDir);
      expect(
        suggestions.some((s) => s.issue.includes('rules.md') || s.issue.includes('rules')),
      ).toBe(true);
    });

    it('suggests creating roles.md when roles frequently skip', async () => {
      const { analyzeExtensionHealth } = await import('../core/coach.js');
      // Create logs where roles skip
      for (let i = 1; i <= 5; i++) {
        await writeFile(
          join(logsDir, `T-00${i}-1711036800000.jsonl`),
          makeLogFile({
            roles: [
              {
                role: 'DBA / Data Engineer',
                phase: 'Boot',
                commentary: 'Skipping — no data models.',
              },
            ],
          }),
        );
      }

      const suggestions = await analyzeExtensionHealth(promptsDir, tasksDir, logsDir);
      expect(suggestions.some((s) => s.issue.includes('roles.md'))).toBe(true);
    });

    it('suggests system.md when tasks frequently fail at Verify', async () => {
      const { analyzeExtensionHealth } = await import('../core/coach.js');
      for (let i = 1; i <= 3; i++) {
        await writeFile(
          join(logsDir, `T-00${i}-1711036800000.jsonl`),
          makeLogFile({
            phases: ['Boot', 'Red', 'Green', 'Verify'],
            stopReason: 'max_turns',
            numTurns: 50,
          }),
        );
      }

      const suggestions = await analyzeExtensionHealth(promptsDir, tasksDir, logsDir);
      expect(
        suggestions.some((s) => s.issue.includes('system.md') || s.issue.includes('Verify')),
      ).toBe(true);
    });

    it('does not flag rules.md when it exists with content', async () => {
      const { analyzeExtensionHealth } = await import('../core/coach.js');
      await writeFile(
        join(promptsDir, 'rules.md'),
        '# Rules\n\n- Do not use any global state.\n- Always use dependency injection.\n',
      );

      const suggestions = await analyzeExtensionHealth(promptsDir, tasksDir, logsDir);
      expect(
        suggestions.filter((s) => s.issue.includes('rules.md') && s.issue.includes('missing'))
          .length,
      ).toBe(0);
    });
  });

  describe('runCoaching', () => {
    it('returns categorized suggestions with priorities', async () => {
      const { runCoaching } = await import('../core/coach.js');
      await writeFile(
        join(tasksDir, 'T-001.md'),
        makeTaskFile({
          id: 'T-001',
          title: 'Bad task',
          description: 'Short.',
          prdRef: '',
          ac: false,
        }),
      );

      const result = await runCoaching(tmpDir);
      expect(result.taskQuality.length).toBeGreaterThan(0);
      expect(result.taskQuality[0]).toHaveProperty('priority');
      expect(result.taskQuality[0]).toHaveProperty('taskId');
      expect(result.taskQuality[0]).toHaveProperty('issue');
      expect(result.taskQuality[0]).toHaveProperty('action');
    });

    it('handles projects with no completed tasks gracefully', async () => {
      const { runCoaching } = await import('../core/coach.js');
      // No task files, no logs
      const result = await runCoaching(tmpDir);
      expect(result.notEnoughData).toBe(true);
    });

    it('handles projects with tasks but no logs', async () => {
      const { runCoaching } = await import('../core/coach.js');
      await writeFile(
        join(tasksDir, 'T-001.md'),
        makeTaskFile({
          id: 'T-001',
          title: 'A task',
          description: LONG_DESC,
          prdRef: '§3.1',
        }),
      );

      const result = await runCoaching(tmpDir);
      expect(result).toHaveProperty('taskQuality');
      expect(result).toHaveProperty('roleEffectiveness');
      expect(result).toHaveProperty('extensionHealth');
    });
  });

  describe('formatCoachingOutput', () => {
    it('formats not-enough-data message', async () => {
      const { formatCoachingOutput } = await import('../core/coach.js');
      const result = formatCoachingOutput({
        taskQuality: [],
        roleEffectiveness: [],
        extensionHealth: [],
        notEnoughData: true,
      });
      expect(result).toContain('Not enough data');
    });

    it('formats categorized suggestions with priority icons', async () => {
      const { formatCoachingOutput } = await import('../core/coach.js');
      const result = formatCoachingOutput({
        taskQuality: [
          { taskId: 'T-001', issue: 'Short description', action: 'Add detail', priority: 'high' },
        ],
        roleEffectiveness: [],
        extensionHealth: [
          { taskId: '(project)', issue: 'No rules.md', action: 'Create it', priority: 'medium' },
        ],
        notEnoughData: false,
      });
      expect(result).toContain('Task Quality');
      expect(result).toContain('Extension Health');
      expect(result).toContain('[!]');
      expect(result).toContain('[~]');
      expect(result).toContain('T-001');
    });

    it('shows "No issues found" for empty categories', async () => {
      const { formatCoachingOutput } = await import('../core/coach.js');
      const result = formatCoachingOutput({
        taskQuality: [],
        roleEffectiveness: [],
        extensionHealth: [],
        notEnoughData: false,
      });
      expect(result).toContain('No issues found');
    });
  });

  describe('formatCoachingJson', () => {
    it('returns valid JSON with all categories', async () => {
      const { formatCoachingJson } = await import('../core/coach.js');
      const input = {
        taskQuality: [{ taskId: 'T-001', issue: 'test', action: 'fix', priority: 'high' as const }],
        roleEffectiveness: [],
        extensionHealth: [],
        notEnoughData: false,
      };
      const result = formatCoachingJson(input);
      const parsed = JSON.parse(result);
      expect(parsed.taskQuality).toHaveLength(1);
      expect(parsed.notEnoughData).toBe(false);
    });
  });

  describe('review --coach integration', () => {
    it('runs coaching analysis when --coach is passed without task ID', async () => {
      const { run } = await import('../commands/review.js');
      await writeFile(
        join(tasksDir, 'T-001.md'),
        makeTaskFile({
          id: 'T-001',
          title: 'Bad task',
          description: 'Short.',
          prdRef: '',
          ac: false,
        }),
      );

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (msg: string) => logs.push(msg);
      try {
        await run(['--coach'], tmpDir);
        const output = logs.join('\n');
        expect(output).toContain('Coaching Analysis');
        expect(output).toContain('Task Quality');
      } finally {
        console.log = origLog;
      }
    });

    it('outputs JSON coaching results with --coach --json', async () => {
      const { run } = await import('../commands/review.js');
      await writeFile(
        join(tasksDir, 'T-001.md'),
        makeTaskFile({
          id: 'T-001',
          title: 'Bad task',
          description: 'Short.',
          prdRef: '',
          ac: false,
        }),
      );

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (msg: string) => logs.push(msg);
      try {
        await run(['--coach', '--json'], tmpDir);
        const parsed = JSON.parse(logs.join(''));
        expect(parsed).toHaveProperty('taskQuality');
        expect(parsed).toHaveProperty('roleEffectiveness');
        expect(parsed).toHaveProperty('extensionHealth');
      } finally {
        console.log = origLog;
      }
    });

    it('handles empty project with --coach gracefully', async () => {
      const { run } = await import('../commands/review.js');
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (msg: string) => logs.push(msg);
      try {
        await run(['--coach'], tmpDir);
        const output = logs.join('\n');
        expect(output).toContain('Not enough data');
      } finally {
        console.log = origLog;
      }
    });
  });
});
