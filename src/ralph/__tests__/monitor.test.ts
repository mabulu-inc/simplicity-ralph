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
  parseLastLogLineWithTimestamp,
  extractLastToolUse,
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
      '{"type":"assistant","message":{"content":[{"type":"text","text":"[PHASE] Entering: Boot"}]},"timestamp":"2026-03-10T12:00:00Z"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"doing boot things"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"[PHASE] Entering: Red"}]},"timestamp":"2026-03-10T12:00:45Z"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"[PHASE] Entering: Green"}]},"timestamp":"2026-03-10T12:02:00Z"}',
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
    const content =
      '{"type":"assistant","message":{"content":[{"type":"text","text":"[PHASE] Entering: Boot"}]}}\n';
    const result = parseAllPhases(content);
    expect(result).toHaveLength(1);
    expect(result[0].phase).toBe('Boot');
    expect(result[0].startedAt).toBeNull();
  });

  it('handles plain text lines with phase markers', () => {
    const content =
      '{"type":"assistant","message":{"content":[{"type":"text","text":"[PHASE] Entering: Verify"}]}}\n{"type":"assistant","message":{"content":[{"type":"text","text":"[PHASE] Entering: Commit"}]}}\n';
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
      '{"type":"assistant","message":{"content":[{"type":"text","text":"[PHASE] Entering: Boot"}]},"timestamp":"2026-03-10T12:00:00Z"}',
      ...Array.from(
        { length: 500 },
        (_, i) => `{"type":"assistant","message":{"content":[{"type":"text","text":"line ${i}"}]}}`,
      ),
      '{"type":"assistant","message":{"content":[{"type":"text","text":"[PHASE] Entering: Red"}]},"timestamp":"2026-03-10T12:01:00Z"}',
      ...Array.from(
        { length: 500 },
        (_, i) => `{"type":"assistant","message":{"content":[{"type":"text","text":"more ${i}"}]}}`,
      ),
      '{"type":"assistant","message":{"content":[{"type":"text","text":"[PHASE] Entering: Green"}]},"timestamp":"2026-03-10T12:02:00Z"}',
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

  it('uses 32KB default tail window', async () => {
    const logPath = join(dir, 'large.jsonl');
    // Create a file larger than 32KB
    const line = `{"type":"text","text":"${'x'.repeat(100)}"}\n`;
    const lineCount = Math.ceil(40_000 / line.length);
    const content = line.repeat(lineCount);
    await writeFile(logPath, content);
    // Default should read 32KB, not 8KB
    const tail = await readLogTail(logPath);
    // The tail should be roughly 32KB (minus the first partial line)
    expect(tail.length).toBeGreaterThan(8192);
    expect(tail.length).toBeLessThanOrEqual(32768 + 200);
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

describe('parseLastLogLineWithTimestamp', () => {
  it('returns text and timestamp from the last text entry', () => {
    const content = [
      '{"type":"text","text":"first line","timestamp":"2026-03-10T12:00:00Z"}',
      '{"type":"text","text":"second line","timestamp":"2026-03-10T12:01:00Z"}',
    ].join('\n');
    const result = parseLastLogLineWithTimestamp(content);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('second line');
    expect(result!.timestamp).toEqual(new Date('2026-03-10T12:01:00Z'));
  });

  it('returns null when no text entries found', () => {
    const content = '{"type":"tool_use","name":"read"}\n';
    expect(parseLastLogLineWithTimestamp(content)).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(parseLastLogLineWithTimestamp('')).toBeNull();
  });

  it('returns text with null timestamp when timestamp missing', () => {
    const content = '{"type":"text","text":"hello world"}\n';
    const result = parseLastLogLineWithTimestamp(content);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('hello world');
    expect(result!.timestamp).toBeNull();
  });

  it('strips markdown and takes last line of multiline text', () => {
    const content =
      '{"type":"text","text":"**bold** heading\\nactual last line","timestamp":"2026-03-10T12:00:00Z"}\n';
    const result = parseLastLogLineWithTimestamp(content);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('actual last line');
  });

  it('truncates long text to specified maxWidth', () => {
    const longText = 'a'.repeat(200);
    const content = `{"type":"text","text":"${longText}","timestamp":"2026-03-10T12:00:00Z"}\n`;
    const result = parseLastLogLineWithTimestamp(content, 80);
    expect(result).not.toBeNull();
    expect(result!.text.length).toBeLessThanOrEqual(80);
    expect(result!.text.endsWith('…')).toBe(true);
  });
});

describe('extractLastToolUse', () => {
  it('extracts tool name from tool_use content block', () => {
    const content = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"src/foo.ts"}}]},"timestamp":"2026-03-10T12:00:00Z"}',
    ].join('\n');
    const result = extractLastToolUse(content);
    expect(result).not.toBeNull();
    expect(result!.tool).toBe('Read');
    expect(result!.detail).toBe('src/foo.ts');
    expect(result!.timestamp).toEqual(new Date('2026-03-10T12:00:00Z'));
  });

  it('extracts tool name from top-level tool_use type', () => {
    const content =
      '{"type":"tool_use","name":"Bash","input":{"command":"pnpm test"},"timestamp":"2026-03-10T12:01:00Z"}\n';
    const result = extractLastToolUse(content);
    expect(result).not.toBeNull();
    expect(result!.tool).toBe('Bash');
    expect(result!.detail).toBe('pnpm test');
  });

  it('returns the last tool_use when multiple exist', () => {
    const content = [
      '{"type":"tool_use","name":"Read","input":{"file_path":"a.ts"},"timestamp":"2026-03-10T12:00:00Z"}',
      '{"type":"tool_use","name":"Edit","input":{"file_path":"b.ts"},"timestamp":"2026-03-10T12:01:00Z"}',
    ].join('\n');
    const result = extractLastToolUse(content);
    expect(result).not.toBeNull();
    expect(result!.tool).toBe('Edit');
    expect(result!.detail).toBe('b.ts');
  });

  it('returns null when no tool_use entries found', () => {
    const content = '{"type":"text","text":"hello"}\n';
    expect(extractLastToolUse(content)).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(extractLastToolUse('')).toBeNull();
  });

  it('truncates long command details', () => {
    const longCmd = 'x'.repeat(200);
    const content = `{"type":"tool_use","name":"Bash","input":{"command":"${longCmd}"},"timestamp":"2026-03-10T12:00:00Z"}\n`;
    const result = extractLastToolUse(content);
    expect(result).not.toBeNull();
    expect(result!.detail!.length).toBeLessThanOrEqual(80);
    expect(result!.detail!.endsWith('…')).toBe(true);
  });

  it('extracts tool_use from nested content array', () => {
    const content =
      '{"type":"assistant","message":{"content":[{"type":"text","text":"doing stuff"},{"type":"tool_use","name":"Grep","input":{"pattern":"foo"}}]},"timestamp":"2026-03-10T12:00:00Z"}\n';
    const result = extractLastToolUse(content);
    expect(result).not.toBeNull();
    expect(result!.tool).toBe('Grep');
  });

  it('returns null detail when no relevant input fields', () => {
    const content =
      '{"type":"tool_use","name":"SomeTool","input":{"random":"value"},"timestamp":"2026-03-10T12:00:00Z"}\n';
    const result = extractLastToolUse(content);
    expect(result).not.toBeNull();
    expect(result!.tool).toBe('SomeTool');
    expect(result!.detail).toBeNull();
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
      lastOutputTimestamp: null,
      lastActivity: null,
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
      lastOutputTimestamp: null,
      lastActivity: null,
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
      lastOutputTimestamp: null,
      lastActivity: null,
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
      lastOutputTimestamp: null,
      lastActivity: null,
    });
    expect(output).not.toContain('Current phase:');
  });

  it('shows last log line with staleness when timestamp present', () => {
    const twoMinutesAgo = new Date(Date.now() - 133_000);
    const output = formatMonitorOutput({
      status: 'RUNNING',
      done: 3,
      total: 10,
      currentTaskId: 'T-004',
      currentTaskTitle: 'Some task',
      phaseTimestamps: [{ phase: 'Boot', startedAt: null }],
      lastLogLine: 'Writing test file...',
      lastOutputTimestamp: twoMinutesAgo,
      lastActivity: null,
    });
    expect(output).toMatch(/Last output \(2m \d+s ago\): Writing test file\.\.\./);
  });

  it('shows last log line without staleness when no timestamp', () => {
    const output = formatMonitorOutput({
      status: 'RUNNING',
      done: 3,
      total: 10,
      currentTaskId: 'T-004',
      currentTaskTitle: 'Some task',
      phaseTimestamps: [{ phase: 'Boot', startedAt: null }],
      lastLogLine: 'Writing test file...',
      lastOutputTimestamp: null,
      lastActivity: null,
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
      lastOutputTimestamp: null,
      lastActivity: null,
    });
    expect(output).not.toContain('Last output');
  });

  it('shows activity line when lastActivity is present', () => {
    const fourteenSecondsAgo = new Date(Date.now() - 14_000);
    const output = formatMonitorOutput({
      status: 'RUNNING',
      done: 3,
      total: 10,
      currentTaskId: 'T-004',
      currentTaskTitle: 'Some task',
      phaseTimestamps: [{ phase: 'Boot', startedAt: null }],
      lastLogLine: 'Some old text',
      lastOutputTimestamp: new Date(Date.now() - 120_000),
      lastActivity: { tool: 'Bash', detail: 'pnpm test', timestamp: fourteenSecondsAgo },
    });
    expect(output).toMatch(/Activity: Bash — pnpm test \(\d+s ago\)/);
  });

  it('shows activity without detail when detail is null', () => {
    const output = formatMonitorOutput({
      status: 'RUNNING',
      done: 3,
      total: 10,
      currentTaskId: 'T-004',
      currentTaskTitle: 'Some task',
      phaseTimestamps: [{ phase: 'Boot', startedAt: null }],
      lastLogLine: null,
      lastOutputTimestamp: null,
      lastActivity: { tool: 'Read', detail: null, timestamp: new Date(Date.now() - 5_000) },
    });
    expect(output).toMatch(/Activity: Read \(\d+s ago\)/);
    expect(output).not.toContain('—');
  });

  it('shows activity without timestamp when timestamp is null', () => {
    const output = formatMonitorOutput({
      status: 'RUNNING',
      done: 3,
      total: 10,
      currentTaskId: 'T-004',
      currentTaskTitle: 'Some task',
      phaseTimestamps: [{ phase: 'Boot', startedAt: null }],
      lastLogLine: null,
      lastOutputTimestamp: null,
      lastActivity: { tool: 'Grep', detail: null, timestamp: null },
    });
    expect(output).toContain('Activity: Grep');
    expect(output).not.toContain('ago');
  });

  it('freezes last output staleness timer when STOPPED', () => {
    // Output was 30s before activity; activity is the latest timestamp
    const activityTime = new Date('2026-03-10T12:05:00Z');
    const outputTime = new Date('2026-03-10T12:04:30Z');
    const output = formatMonitorOutput({
      status: 'STOPPED',
      done: 5,
      total: 10,
      currentTaskId: 'T-005',
      currentTaskTitle: 'Some task',
      phaseTimestamps: [],
      lastLogLine: 'Final output',
      lastOutputTimestamp: outputTime,
      lastActivity: { tool: 'Bash', detail: 'pnpm test', timestamp: activityTime },
    });
    // Should show 30s ago (frozen relative to activity time), not growing
    expect(output).toContain('Last output (30s ago): Final output');
  });

  it('freezes activity staleness timer when STOPPED', () => {
    // Activity is 10s after output; output timestamp is frozen reference
    const outputTime = new Date('2026-03-10T12:04:30Z');
    const activityTime = new Date('2026-03-10T12:04:40Z');
    const output = formatMonitorOutput({
      status: 'STOPPED',
      done: 5,
      total: 10,
      currentTaskId: 'T-005',
      currentTaskTitle: 'Some task',
      phaseTimestamps: [],
      lastLogLine: 'Final output',
      lastOutputTimestamp: outputTime,
      lastActivity: { tool: 'Read', detail: 'src/foo.ts', timestamp: activityTime },
    });
    // Activity is the latest timestamp, so 0s ago relative to itself
    expect(output).toContain('Activity: Read — src/foo.ts (0s ago)');
  });

  it('freezes phase timeline active timer when STOPPED', () => {
    const bootStart = new Date('2026-03-10T12:00:00Z');
    const redStart = new Date('2026-03-10T12:00:45Z');
    // Last activity is the latest timestamp — 30s after Red started
    const activityTime = new Date('2026-03-10T12:01:15Z');
    const output = formatMonitorOutput({
      status: 'STOPPED',
      done: 5,
      total: 10,
      currentTaskId: 'T-005',
      currentTaskTitle: 'Some task',
      phaseTimestamps: [
        { phase: 'Boot', startedAt: bootStart },
        { phase: 'Red', startedAt: redStart },
      ],
      lastLogLine: null,
      lastOutputTimestamp: null,
      lastActivity: { tool: 'Bash', detail: null, timestamp: activityTime },
    });
    // Boot duration: 45s (Boot→Red), Red active duration frozen at 30s (Red→activity)
    expect(output).toContain('Boot (45s)');
    expect(output).toContain('Red (30s)');
  });

  it('does not freeze timers when RUNNING', () => {
    const fiveSecondsAgo = new Date(Date.now() - 5_000);
    const output = formatMonitorOutput({
      status: 'RUNNING',
      done: 3,
      total: 10,
      currentTaskId: 'T-004',
      currentTaskTitle: 'Some task',
      phaseTimestamps: [],
      lastLogLine: 'Some output',
      lastOutputTimestamp: fiveSecondsAgo,
      lastActivity: { tool: 'Read', detail: null, timestamp: fiveSecondsAgo },
    });
    // Should show ~5s ago (live, computed from Date.now())
    expect(output).toMatch(/Last output \(5s ago\)/);
    expect(output).toMatch(/Activity: Read \(5s ago\)/);
  });

  it('freezes timers using output timestamp when no activity timestamp', () => {
    const outputTime = new Date('2026-03-10T12:04:30Z');
    const output = formatMonitorOutput({
      status: 'STOPPED',
      done: 5,
      total: 10,
      currentTaskId: 'T-005',
      currentTaskTitle: 'Some task',
      phaseTimestamps: [],
      lastLogLine: 'Final output',
      lastOutputTimestamp: outputTime,
      lastActivity: null,
    });
    // Output staleness frozen at 0s (output is the latest timestamp)
    expect(output).toContain('Last output (0s ago): Final output');
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
      '{"type":"assistant","message":{"content":[{"type":"text","text":"[PHASE] Entering: Boot"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"[PHASE] Entering: Red"}]}}',
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
