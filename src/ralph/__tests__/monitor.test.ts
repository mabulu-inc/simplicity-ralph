import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parsePhases,
  parseAllPhases,
  formatPhaseTimeline,
  formatProgressBar,
  formatDuration,
  detectStatus,
  findLatestLogFile,
  extractTaskIdFromLog,
  formatMonitorOutput,
  renderDashboard,
  collectMonitorData,
  run,
  parseCurrentPhase,
  parseLastLogLine,
  readLogTail,
  scanLogForPhases,
  formatElapsed,
  type RunResult,
  type PhaseTimestamp,
} from '../commands/monitor.js';

describe('parsePhases', () => {
  it('extracts phase names from log content', () => {
    const content = [
      '{"type":"text","text":"[PHASE] Entering: Boot"}',
      '{"type":"text","text":"some other output"}',
      '{"type":"text","text":"[PHASE] Entering: Red"}',
      '{"type":"text","text":"[PHASE] Entering: Green"}',
    ].join('\n');
    expect(parsePhases(content)).toEqual(['Boot', 'Red', 'Green']);
  });

  it('returns empty array when no phases found', () => {
    expect(parsePhases('no phases here')).toEqual([]);
  });

  it('handles empty content', () => {
    expect(parsePhases('')).toEqual([]);
  });

  it('extracts phases from plain text lines too', () => {
    const content = '[PHASE] Entering: Verify\n[PHASE] Entering: Commit\n';
    expect(parsePhases(content)).toEqual(['Verify', 'Commit']);
  });
});

describe('parseAllPhases', () => {
  it('extracts all phases with timestamps from JSONL content', () => {
    const content = [
      '{"type":"text","text":"[PHASE] Entering: Boot","timestamp":"2026-03-10T12:00:00Z"}',
      '{"type":"text","text":"doing boot things"}',
      '{"type":"text","text":"[PHASE] Entering: Red","timestamp":"2026-03-10T12:00:45Z"}',
      '{"type":"text","text":"[PHASE] Entering: Green","timestamp":"2026-03-10T12:02:00Z"}',
    ].join('\n');
    const result = parseAllPhases(content);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ phase: 'Boot', startedAt: new Date('2026-03-10T12:00:00Z') });
    expect(result[1]).toEqual({ phase: 'Red', startedAt: new Date('2026-03-10T12:00:45Z') });
    expect(result[2]).toEqual({ phase: 'Green', startedAt: new Date('2026-03-10T12:02:00Z') });
  });

  it('returns empty array when no phases found', () => {
    expect(parseAllPhases('no phases here')).toEqual([]);
  });

  it('handles phases without timestamps', () => {
    const content = '{"type":"text","text":"[PHASE] Entering: Boot"}\n';
    const result = parseAllPhases(content);
    expect(result).toHaveLength(1);
    expect(result[0].phase).toBe('Boot');
    expect(result[0].startedAt).toBeNull();
  });

  it('handles plain text lines with phase markers', () => {
    const content = '[PHASE] Entering: Verify\n[PHASE] Entering: Commit\n';
    const result = parseAllPhases(content);
    expect(result).toHaveLength(2);
    expect(result[0].phase).toBe('Verify');
    expect(result[1].phase).toBe('Commit');
  });
});

describe('formatDuration', () => {
  it('formats seconds only', () => {
    expect(formatDuration(45_000)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(72_000)).toBe('1m 12s');
  });

  it('formats exact minutes', () => {
    expect(formatDuration(120_000)).toBe('2m 0s');
  });

  it('formats hours', () => {
    expect(formatDuration(3_661_000)).toBe('1h 1m');
  });

  it('formats zero', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('formats sub-second as 0s', () => {
    expect(formatDuration(500)).toBe('0s');
  });
});

describe('scanLogForPhases', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ralph-scan-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads full log file to find all phase markers', async () => {
    const lines = [
      '{"type":"text","text":"[PHASE] Entering: Boot","timestamp":"2026-03-10T12:00:00Z"}',
      ...Array.from({ length: 500 }, (_, i) => `{"type":"text","text":"line ${i}"}`),
      '{"type":"text","text":"[PHASE] Entering: Red","timestamp":"2026-03-10T12:01:00Z"}',
      ...Array.from({ length: 500 }, (_, i) => `{"type":"text","text":"more ${i}"}`),
      '{"type":"text","text":"[PHASE] Entering: Green","timestamp":"2026-03-10T12:02:00Z"}',
    ];
    const logPath = join(dir, 'test.jsonl');
    await writeFile(logPath, lines.join('\n'));

    const result = await scanLogForPhases(logPath);
    expect(result).toHaveLength(3);
    expect(result[0].phase).toBe('Boot');
    expect(result[1].phase).toBe('Red');
    expect(result[2].phase).toBe('Green');
  });

  it('returns empty array for nonexistent file', async () => {
    const result = await scanLogForPhases(join(dir, 'nope.jsonl'));
    expect(result).toEqual([]);
  });

  it('returns empty array for file with no phases', async () => {
    const logPath = join(dir, 'empty.jsonl');
    await writeFile(logPath, '{"type":"text","text":"no phases"}\n');
    const result = await scanLogForPhases(logPath);
    expect(result).toEqual([]);
  });
});

describe('formatPhaseTimeline', () => {
  it('renders all phases with markers for completed ones', () => {
    const phases: PhaseTimestamp[] = [
      { phase: 'Boot', startedAt: null },
      { phase: 'Red', startedAt: null },
      { phase: 'Green', startedAt: null },
    ];
    const result = formatPhaseTimeline(phases);
    expect(result).toContain('Boot');
    expect(result).toContain('Red');
    expect(result).toContain('Green');
    expect(result).toContain('Verify');
    expect(result).toContain('Commit');
  });

  it('marks completed phases differently from pending ones', () => {
    const phases: PhaseTimestamp[] = [
      { phase: 'Boot', startedAt: null },
      { phase: 'Red', startedAt: null },
    ];
    const result = formatPhaseTimeline(phases);
    expect(result).toMatch(/[●✓].*Boot/);
    expect(result).toMatch(/[●✓].*Red/);
    expect(result).toMatch(/[○·].*Green/);
  });

  it('renders empty timeline when no phases', () => {
    const result = formatPhaseTimeline([]);
    expect(result).toContain('Boot');
    expect(result).toContain('Commit');
  });

  it('shows durations for completed phases with timestamps', () => {
    const phases: PhaseTimestamp[] = [
      { phase: 'Boot', startedAt: new Date('2026-03-10T12:00:00Z') },
      { phase: 'Red', startedAt: new Date('2026-03-10T12:00:45Z') },
      { phase: 'Green', startedAt: new Date('2026-03-10T12:01:57Z') },
    ];
    const result = formatPhaseTimeline(phases);
    // Boot took 45s (from Boot start to Red start)
    expect(result).toContain('Boot (45s)');
    // Red took 1m 12s (from Red start to Green start)
    expect(result).toContain('Red (1m 12s)');
    // Green is the active phase — no duration shown here (live timer handled separately)
  });

  it('shows live timer on active phase', () => {
    const thirtySecondsAgo = new Date(Date.now() - 30_000);
    const phases: PhaseTimestamp[] = [
      { phase: 'Boot', startedAt: new Date(Date.now() - 75_000) },
      { phase: 'Red', startedAt: thirtySecondsAgo },
    ];
    const result = formatPhaseTimeline(phases);
    // Active phase (last one) should show a live duration
    expect(result).toMatch(/Red \(\d+s\)/);
  });

  it('handles phases without timestamps gracefully', () => {
    const phases: PhaseTimestamp[] = [
      { phase: 'Boot', startedAt: null },
      { phase: 'Red', startedAt: null },
    ];
    const result = formatPhaseTimeline(phases);
    // Should not crash, just show without durations
    expect(result).toContain('● Boot');
    expect(result).toContain('● Red');
    expect(result).not.toMatch(/Boot \(/);
  });
});

describe('formatProgressBar', () => {
  it('shows 0% for no tasks done', () => {
    const result = formatProgressBar(0, 10);
    expect(result).toContain('0/10');
    expect(result).toContain('0%');
  });

  it('shows 100% when all tasks done', () => {
    const result = formatProgressBar(5, 5);
    expect(result).toContain('5/5');
    expect(result).toContain('100%');
  });

  it('shows partial progress', () => {
    const result = formatProgressBar(3, 10);
    expect(result).toContain('3/10');
    expect(result).toContain('30%');
  });

  it('handles zero total tasks', () => {
    const result = formatProgressBar(0, 0);
    expect(result).toContain('0/0');
  });
});

describe('detectStatus', () => {
  it('returns RUNNING when ralph processes exist', () => {
    expect(detectStatus([1234])).toBe('RUNNING');
  });

  it('returns STOPPED when no ralph processes exist', () => {
    expect(detectStatus([])).toBe('STOPPED');
  });
});

describe('findLatestLogFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ralph-monitor-log-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the most recent log file', async () => {
    await writeFile(join(dir, 'T-001-20260310-100000.jsonl'), '');
    await writeFile(join(dir, 'T-002-20260310-120000.jsonl'), '');
    const result = await findLatestLogFile(dir);
    expect(result).toBe('T-002-20260310-120000.jsonl');
  });

  it('returns null when no log files exist', async () => {
    const result = await findLatestLogFile(dir);
    expect(result).toBeNull();
  });

  it('returns null when directory does not exist', async () => {
    const result = await findLatestLogFile(join(dir, 'nonexistent'));
    expect(result).toBeNull();
  });
});

describe('extractTaskIdFromLog', () => {
  it('extracts task ID from log filename', () => {
    expect(extractTaskIdFromLog('T-001-20260310-120000.jsonl')).toBe('T-001');
  });

  it('extracts multi-digit task ID', () => {
    expect(extractTaskIdFromLog('T-015-20260310-120000.jsonl')).toBe('T-015');
  });

  it('returns null for non-matching filename', () => {
    expect(extractTaskIdFromLog('random-file.txt')).toBeNull();
  });
});

describe('parseCurrentPhase', () => {
  it('extracts the last phase name and timestamp from JSONL content', () => {
    const content = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"[PHASE] Entering: Boot"}]},"timestamp":"2026-03-10T12:00:00Z"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"some work"}]},"timestamp":"2026-03-10T12:01:00Z"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"[PHASE] Entering: Red"}]},"timestamp":"2026-03-10T12:02:00Z"}',
    ].join('\n');
    const result = parseCurrentPhase(content);
    expect(result).not.toBeNull();
    expect(result!.phase).toBe('Red');
    expect(result!.startedAt).toEqual(new Date('2026-03-10T12:02:00Z'));
  });

  it('returns null when no phases found', () => {
    const content = '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}\n';
    expect(parseCurrentPhase(content)).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(parseCurrentPhase('')).toBeNull();
  });

  it('falls back to null timestamp when no timestamp in JSONL entry', () => {
    const content = '{"type":"text","text":"[PHASE] Entering: Green"}\n';
    const result = parseCurrentPhase(content);
    expect(result).not.toBeNull();
    expect(result!.phase).toBe('Green');
    expect(result!.startedAt).toBeNull();
  });

  it('handles malformed JSON lines gracefully', () => {
    const content = [
      'not valid json',
      '{"type":"text","text":"[PHASE] Entering: Boot"}',
      'also not json',
    ].join('\n');
    const result = parseCurrentPhase(content);
    expect(result).not.toBeNull();
    expect(result!.phase).toBe('Boot');
  });
});

describe('parseLastLogLine', () => {
  it('extracts the last assistant text from JSONL content', () => {
    const content = [
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"first line"}]}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"second line"}]}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"last line of output"}]}}',
    ].join('\n');
    expect(parseLastLogLine(content)).toBe('last line of output');
  });

  it('returns null when no assistant text found', () => {
    const content = '{"type":"tool_use","name":"read"}\n';
    expect(parseLastLogLine(content)).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(parseLastLogLine('')).toBeNull();
  });

  it('extracts text from flat text entries too', () => {
    const content = [
      '{"type":"text","text":"some output here"}',
      '{"type":"tool_use","name":"bash"}',
    ].join('\n');
    expect(parseLastLogLine(content)).toBe('some output here');
  });

  it('truncates long lines to specified width', () => {
    const longText = 'a'.repeat(200);
    const content = `{"type":"text","text":"${longText}"}\n`;
    const result = parseLastLogLine(content, 80);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(80);
    expect(result!.endsWith('…')).toBe(true);
  });

  it('does not truncate lines within width', () => {
    const content = '{"type":"text","text":"short line"}\n';
    expect(parseLastLogLine(content, 80)).toBe('short line');
  });

  it('strips markdown formatting', () => {
    const content = '{"type":"text","text":"**bold** and _italic_ text"}\n';
    expect(parseLastLogLine(content)).toBe('bold and italic text');
  });
});

describe('readLogTail', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ralph-tail-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the tail of a log file', async () => {
    const logPath = join(dir, 'test.jsonl');
    const lines = Array.from({ length: 100 }, (_, i) => `{"line":${i}}`);
    await writeFile(logPath, lines.join('\n'));
    const content = await readLogTail(logPath, 512);
    expect(content.length).toBeLessThanOrEqual(512 + 200);
    expect(content).toContain('"line":99');
  });

  it('reads the entire file when smaller than maxBytes', async () => {
    const logPath = join(dir, 'small.jsonl');
    await writeFile(logPath, '{"line":0}\n{"line":1}\n');
    const content = await readLogTail(logPath, 8192);
    expect(content).toContain('"line":0');
    expect(content).toContain('"line":1');
  });

  it('returns empty string for nonexistent file', async () => {
    const result = await readLogTail(join(dir, 'nope.jsonl'));
    expect(result).toBe('');
  });
});

describe('formatElapsed', () => {
  it('formats seconds', () => {
    expect(formatElapsed(30_000)).toBe('30s ago');
  });

  it('formats minutes and seconds', () => {
    expect(formatElapsed(135_000)).toBe('2m 15s ago');
  });

  it('formats hours', () => {
    expect(formatElapsed(3_661_000)).toBe('1h 1m ago');
  });

  it('handles zero', () => {
    expect(formatElapsed(0)).toBe('0s ago');
  });
});

describe('formatMonitorOutput', () => {
  it('formats complete monitor display', () => {
    const output = formatMonitorOutput({
      status: 'RUNNING',
      done: 5,
      total: 10,
      currentTaskId: 'T-006',
      currentTaskTitle: 'Monitor command',
      phaseTimestamps: [
        { phase: 'Boot', startedAt: null },
        { phase: 'Red', startedAt: null },
      ],
      lastLogLine: null,
    });
    expect(output).toContain('RUNNING');
    expect(output).toContain('5/10');
    expect(output).toContain('T-006');
    expect(output).toContain('Monitor command');
    expect(output).toContain('Boot');
  });

  it('formats display with no current task when STOPPED', () => {
    const output = formatMonitorOutput({
      status: 'STOPPED',
      done: 10,
      total: 10,
      currentTaskId: null,
      currentTaskTitle: null,
      phaseTimestamps: [],
      lastLogLine: null,
    });
    expect(output).toContain('STOPPED');
    expect(output).toContain('10/10');
    // STOPPED with no phases should not show the timeline
    expect(output).not.toContain('Phases');
  });

  it('always shows phase timeline when RUNNING even with no phases', () => {
    const output = formatMonitorOutput({
      status: 'RUNNING',
      done: 3,
      total: 10,
      currentTaskId: 'T-004',
      currentTaskTitle: 'Some task',
      phaseTimestamps: [],
      lastLogLine: null,
    });
    // Should show all phases as empty when RUNNING
    expect(output).toContain('Phases:');
    expect(output).toContain('○ Boot');
    expect(output).toContain('○ Commit');
  });

  it('does not have a separate Current phase line', () => {
    const output = formatMonitorOutput({
      status: 'RUNNING',
      done: 3,
      total: 10,
      currentTaskId: 'T-004',
      currentTaskTitle: 'Some task',
      phaseTimestamps: [
        { phase: 'Boot', startedAt: new Date(Date.now() - 60_000) },
        { phase: 'Red', startedAt: new Date(Date.now() - 30_000) },
      ],
      lastLogLine: null,
    });
    expect(output).not.toContain('Current phase:');
  });

  it('shows last log line', () => {
    const output = formatMonitorOutput({
      status: 'RUNNING',
      done: 3,
      total: 10,
      currentTaskId: 'T-004',
      currentTaskTitle: 'Some task',
      phaseTimestamps: [{ phase: 'Boot', startedAt: null }],
      lastLogLine: 'Writing test file...',
    });
    expect(output).toContain('Last output: Writing test file...');
  });

  it('does not show last log line when null', () => {
    const output = formatMonitorOutput({
      status: 'RUNNING',
      done: 3,
      total: 10,
      currentTaskId: 'T-004',
      currentTaskTitle: 'Some task',
      phaseTimestamps: [{ phase: 'Boot', startedAt: null }],
      lastLogLine: null,
    });
    expect(output).not.toContain('Last output');
  });
});

describe('ralph monitor (run)', () => {
  let dir: string;
  let logsDir: string;
  let tasksDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let clearSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ralph-monitor-test-'));
    logsDir = join(dir, '.ralph-logs');
    tasksDir = join(dir, 'docs', 'tasks');
    await mkdir(logsDir, { recursive: true });
    await mkdir(tasksDir, { recursive: true });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    clearSpy = vi.spyOn(console, 'clear').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    clearSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  });

  it('shows status and progress for a project', async () => {
    await writeFile(
      join(tasksDir, 'T-001.md'),
      `# T-001: First task\n\n- **Status**: DONE\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nDone task.\n`,
    );
    await writeFile(
      join(tasksDir, 'T-002.md'),
      `# T-002: Second task\n\n- **Status**: TODO\n- **Milestone**: 1 — Setup\n- **Depends**: T-001\n- **PRD Reference**: §2\n\n## Description\n\nPending task.\n`,
    );

    await run([], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('1/2');
    expect(output).toContain('50%');
  });

  it('shows current task and phases from latest log', async () => {
    await writeFile(
      join(tasksDir, 'T-001.md'),
      `# T-001: First task\n\n- **Status**: DONE\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nDone.\n`,
    );
    await writeFile(
      join(tasksDir, 'T-002.md'),
      `# T-002: Second task\n\n- **Status**: TODO\n- **Milestone**: 1 — Setup\n- **Depends**: T-001\n- **PRD Reference**: §2\n\n## Description\n\nPending.\n`,
    );

    const logContent = [
      '{"type":"text","text":"[PHASE] Entering: Boot"}',
      '{"type":"text","text":"[PHASE] Entering: Red"}',
    ].join('\n');
    await writeFile(join(logsDir, 'T-002-20260310-120000.jsonl'), logContent);

    await run([], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('T-002');
    expect(output).toContain('Second task');
    expect(output).toContain('Boot');
  });

  it('handles missing tasks directory', async () => {
    await rm(tasksDir, { recursive: true, force: true });

    await run([], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No tasks');
  });

  it('handles empty tasks directory', async () => {
    // tasksDir exists but has no task files
    await run([], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No tasks found');
  });

  it('shows help for --help flag', async () => {
    await run(['--help'], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Usage');
  });

  it('returns watching:true with stop fn in watch mode', async () => {
    vi.useFakeTimers();

    await writeFile(
      join(tasksDir, 'T-001.md'),
      `# T-001: Task\n\n- **Status**: DONE\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nDone.\n`,
    );

    const result: RunResult = await run(['-w', '-i', '1'], dir);
    expect(result.watching).toBe(true);
    expect(result.stop).toBeTypeOf('function');

    // Advance timer to trigger one refresh
    await vi.advanceTimersByTimeAsync(1100);

    result.stop!();
    vi.useRealTimers();
  });

  it('defaults to 1 second interval when -i has no value', async () => {
    vi.useFakeTimers();

    await writeFile(
      join(tasksDir, 'T-001.md'),
      `# T-001: Task\n\n- **Status**: TODO\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nPending.\n`,
    );

    const result: RunResult = await run(['--watch'], dir);
    expect(result.watching).toBe(true);
    result.stop!();
    vi.useRealTimers();
  });

  it('clears the screen on initial render in watch mode', async () => {
    vi.useFakeTimers();

    await writeFile(
      join(tasksDir, 'T-001.md'),
      `# T-001: Task\n\n- **Status**: DONE\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nDone.\n`,
    );

    const result: RunResult = await run(['-w', '-i', '1'], dir);

    // Initial render should clear the screen
    expect(clearSpy).toHaveBeenCalledTimes(1);

    result.stop!();
    vi.useRealTimers();
  });

  it('does not clear the screen in non-watch mode', async () => {
    await writeFile(
      join(tasksDir, 'T-001.md'),
      `# T-001: Task\n\n- **Status**: DONE\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nDone.\n`,
    );

    await run([], dir);

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('renderDashboard returns formatted output for display', async () => {
    await writeFile(
      join(tasksDir, 'T-001.md'),
      `# T-001: First task\n\n- **Status**: DONE\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nDone.\n`,
    );
    await writeFile(
      join(tasksDir, 'T-002.md'),
      `# T-002: Second task\n\n- **Status**: TODO\n- **Milestone**: 1 — Setup\n- **Depends**: T-001\n- **PRD Reference**: §2\n\n## Description\n\nPending.\n`,
    );

    const output = await renderDashboard(tasksDir, logsDir);
    expect(output).toContain('1/2');
    expect(output).toContain('50%');
  });

  it('renderDashboard returns error message for missing tasks dir', async () => {
    const output = await renderDashboard(join(dir, 'nonexistent'), logsDir);
    expect(output).toBe('No tasks directory found');
  });

  it('collectMonitorData returns MonitorData object', async () => {
    await writeFile(
      join(tasksDir, 'T-001.md'),
      `# T-001: First task\n\n- **Status**: DONE\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nDone.\n`,
    );
    await writeFile(
      join(tasksDir, 'T-002.md'),
      `# T-002: Second task\n\n- **Status**: TODO\n- **Milestone**: 1 — Setup\n- **Depends**: T-001\n- **PRD Reference**: §2\n\n## Description\n\nPending.\n`,
    );

    const data = await collectMonitorData(tasksDir, logsDir);
    expect(data).not.toBeNull();
    expect(data!.done).toBe(1);
    expect(data!.total).toBe(2);
    expect(data!.status).toBe('STOPPED');
  });

  it('collectMonitorData returns null for missing tasks dir', async () => {
    const data = await collectMonitorData(join(dir, 'nonexistent'), logsDir);
    expect(data).toBeNull();
  });

  it('outputs JSON when --json flag is passed', async () => {
    await writeFile(
      join(tasksDir, 'T-001.md'),
      `# T-001: First task\n\n- **Status**: DONE\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nDone.\n`,
    );
    await writeFile(
      join(tasksDir, 'T-002.md'),
      `# T-002: Second task\n\n- **Status**: TODO\n- **Milestone**: 1 — Setup\n- **Depends**: T-001\n- **PRD Reference**: §2\n\n## Description\n\nPending.\n`,
    );

    await run(['--json'], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.status).toBe('STOPPED');
    expect(parsed.done).toBe(1);
    expect(parsed.total).toBe(2);
    expect(parsed.currentTaskId).toBeNull();
    expect(parsed.phaseTimestamps).toEqual([]);
    expect(parsed.lastLogLine).toBeNull();
  });

  it('outputs JSON with -j short flag', async () => {
    await writeFile(
      join(tasksDir, 'T-001.md'),
      `# T-001: First task\n\n- **Status**: DONE\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nDone.\n`,
    );

    await run(['-j'], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.status).toBe('STOPPED');
    expect(parsed.done).toBe(1);
    expect(parsed.total).toBe(1);
  });

  it('outputs JSONL in watch mode with --json (no screen clear)', async () => {
    vi.useFakeTimers();

    await writeFile(
      join(tasksDir, 'T-001.md'),
      `# T-001: Task\n\n- **Status**: DONE\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nDone.\n`,
    );

    const result: RunResult = await run(['-w', '-i', '1', '--json'], dir);
    expect(result.watching).toBe(true);

    // JSON watch mode should NOT clear screen
    expect(clearSpy).not.toHaveBeenCalled();

    // Initial render outputs valid JSON
    expect(logSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    const firstLine = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(firstLine);
    expect(parsed.status).toBe('STOPPED');
    expect(parsed.done).toBe(1);

    result.stop!();
    vi.useRealTimers();
  });

  it('JSON output serializes dates as ISO strings', async () => {
    await writeFile(
      join(tasksDir, 'T-001.md'),
      `# T-001: First task\n\n- **Status**: TODO\n- **Milestone**: 1 — Setup\n- **Depends**: none\n- **PRD Reference**: §1\n\n## Description\n\nPending.\n`,
    );

    const logContent = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"[PHASE] Entering: Boot"}]},"timestamp":"2026-03-10T12:00:00Z"}',
    ].join('\n');
    await writeFile(join(logsDir, 'T-001-20260310-120000.jsonl'), logContent);

    await run(['--json'], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.phaseTimestamps).toHaveLength(1);
    expect(parsed.phaseTimestamps[0].phase).toBe('Boot');
    expect(parsed.phaseTimestamps[0].startedAt).toBe('2026-03-10T12:00:00.000Z');
  });

  it('JSON output includes null for missing tasks directory', async () => {
    await rm(tasksDir, { recursive: true, force: true });

    await run(['--json'], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    const parsed = JSON.parse(output);
    expect(parsed).toBeNull();
  });

  it('--json flag is mentioned in help output', async () => {
    await run(['--help'], dir);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('--json');
  });
});
