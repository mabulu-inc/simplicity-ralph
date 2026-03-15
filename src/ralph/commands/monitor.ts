import { createReadStream } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { scanTasks, countByStatus, type Task } from '../core/tasks.js';
import { readPidFile } from '../core/pid-file.js';

const ALL_PHASES = ['Boot', 'Red', 'Green', 'Verify', 'Commit'] as const;

const PHASE_RE = /\[PHASE]\s*Entering:\s*(\w+)/g;

export interface PhaseInfo {
  phase: string;
  startedAt: Date | null;
}

export interface PhaseTimestamp {
  phase: string;
  startedAt: Date | null;
}

export function parsePhases(content: string): string[] {
  const phases: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = PHASE_RE.exec(content)) !== null) {
    phases.push(match[1]);
  }
  PHASE_RE.lastIndex = 0;
  return phases;
}

function extractTextFromJsonLine(line: string): string | null {
  try {
    const obj = JSON.parse(line);
    if (obj.type === 'text' && typeof obj.text === 'string') {
      return obj.text;
    }
    const content = obj.message?.content ?? obj.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          return block.text;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function extractTimestampFromJsonLine(line: string): Date | null {
  try {
    const obj = JSON.parse(line);
    if (typeof obj.timestamp === 'string') {
      const d = new Date(obj.timestamp);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  } catch {
    return null;
  }
}

const PHASE_INLINE_RE = /\[PHASE]\s*Entering:\s*(\w+)/;

export function parseAllPhases(content: string): PhaseTimestamp[] {
  if (!content) return [];
  const results: PhaseTimestamp[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type !== 'assistant') continue;
    } catch {
      continue;
    }
    const text = extractTextFromJsonLine(line);
    if (text) {
      const match = text.match(PHASE_INLINE_RE);
      if (match) {
        results.push({
          phase: match[1],
          startedAt: extractTimestampFromJsonLine(line),
        });
      }
    }
  }

  return results;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function formatPhaseTimeline(phases: PhaseTimestamp[], now?: number): string {
  const referenceTime = now ?? Date.now();
  const phaseMap = new Map<string, PhaseTimestamp>();
  for (const p of phases) {
    phaseMap.set(p.phase, p);
  }

  return ALL_PHASES.map((name) => {
    const entry = phaseMap.get(name);
    if (!entry) return `○ ${name}`;

    // Find the index in the phases array
    const phaseIdx = phases.findIndex((p) => p.phase === name);
    const isLast = phaseIdx === phases.length - 1;

    if (isLast) {
      // Active phase: show live timer if we have a timestamp
      if (entry.startedAt) {
        const elapsed = referenceTime - entry.startedAt.getTime();
        return `● ${name} (${formatDuration(elapsed)})`;
      }
      return `● ${name}`;
    }

    // Completed phase: show duration if both this and next phase have timestamps
    const nextPhase = phases[phaseIdx + 1];
    if (entry.startedAt && nextPhase?.startedAt) {
      const duration = nextPhase.startedAt.getTime() - entry.startedAt.getTime();
      return `● ${name} (${formatDuration(duration)})`;
    }

    return `● ${name}`;
  }).join(' → ');
}

export function formatProgressBar(done: number, total: number, width = 20): string {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const filled = total === 0 ? 0 : Math.round((done / total) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `[${bar}] ${done}/${total} (${pct}%)`;
}

export function detectStatus(ralphPids: number[]): 'RUNNING' | 'STOPPED' {
  return ralphPids.length > 0 ? 'RUNNING' : 'STOPPED';
}

export async function findLatestLogFile(logsDir: string): Promise<string | null> {
  try {
    const entries = await readdir(logsDir);
    const logFiles = entries.filter((f) => f.endsWith('.jsonl')).sort();
    return logFiles.length > 0 ? logFiles[logFiles.length - 1] : null;
  } catch {
    return null;
  }
}

export function extractTaskIdFromLog(filename: string): string | null {
  const match = filename.match(/^(T-\d+)/);
  return match ? match[1] : null;
}

export async function readLogTail(filePath: string, maxBytes = 32768): Promise<string> {
  try {
    const stats = await stat(filePath);
    const fileSize = stats.size;
    if (fileSize === 0) return '';

    const fh = await open(filePath, 'r');
    try {
      if (fileSize <= maxBytes) {
        const buf = Buffer.alloc(fileSize);
        await fh.read(buf, 0, fileSize, 0);
        return buf.toString('utf-8');
      }
      const offset = fileSize - maxBytes;
      const buf = Buffer.alloc(maxBytes);
      await fh.read(buf, 0, maxBytes, offset);
      const raw = buf.toString('utf-8');
      const firstNewline = raw.indexOf('\n');
      return firstNewline === -1 ? raw : raw.slice(firstNewline + 1);
    } finally {
      await fh.close();
    }
  } catch {
    return '';
  }
}

export async function scanLogForPhases(filePath: string): Promise<PhaseTimestamp[]> {
  try {
    await stat(filePath);
  } catch {
    return [];
  }

  return new Promise((resolve) => {
    const results: PhaseTimestamp[] = [];
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (!line.includes('[PHASE]')) return;
      try {
        const obj = JSON.parse(line);
        if (obj.type !== 'assistant') return;
      } catch {
        return;
      }
      const text = extractTextFromJsonLine(line);
      if (text) {
        const match = text.match(PHASE_INLINE_RE);
        if (match) {
          results.push({
            phase: match[1],
            startedAt: extractTimestampFromJsonLine(line),
          });
        }
      }
    });

    rl.on('close', () => resolve(results));
    rl.on('error', () => resolve([]));
  });
}

export function parseCurrentPhase(content: string): PhaseInfo | null {
  if (!content) return null;
  const lines = content.split('\n');
  let lastPhase: string | null = null;
  let lastTimestamp: Date | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const text = extractTextFromJsonLine(line);
    if (text) {
      const match = text.match(PHASE_INLINE_RE);
      if (match) {
        lastPhase = match[1];
        lastTimestamp = extractTimestampFromJsonLine(line);
      }
    } else {
      const match = line.match(PHASE_INLINE_RE);
      if (match) {
        lastPhase = match[1];
        lastTimestamp = null;
      }
    }
  }

  return lastPhase ? { phase: lastPhase, startedAt: lastTimestamp } : null;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1');
}

export function parseLastLogLine(content: string, maxWidth = 0): string | null {
  const result = parseLastLogLineWithTimestamp(content, maxWidth);
  return result ? result.text : null;
}

export interface LastLogLineResult {
  text: string;
  timestamp: Date | null;
}

export function parseLastLogLineWithTimestamp(
  content: string,
  maxWidth = 0,
): LastLogLineResult | null {
  if (!content) return null;
  const lines = content.split('\n');
  let lastText: string | null = null;
  let lastTimestamp: Date | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const text = extractTextFromJsonLine(line);
    if (text && text.trim()) {
      lastText = text.trim();
      lastTimestamp = extractTimestampFromJsonLine(line);
    }
  }

  if (!lastText) return null;

  lastText = stripMarkdown(lastText);

  const textLines = lastText.split('\n').filter((l) => l.trim());
  if (textLines.length > 0) {
    lastText = textLines[textLines.length - 1].trim();
  }

  if (maxWidth > 0 && lastText.length > maxWidth) {
    lastText = lastText.slice(0, maxWidth - 1) + '…';
  }

  return { text: lastText, timestamp: lastTimestamp };
}

export interface ToolUseInfo {
  tool: string;
  detail: string | null;
  timestamp: Date | null;
}

function extractToolUseFromJsonLine(line: string): ToolUseInfo | null {
  try {
    const obj = JSON.parse(line);
    const timestamp = extractTimestampFromJsonLine(line);

    // Top-level tool_use
    if (obj.type === 'tool_use' && typeof obj.name === 'string') {
      return { tool: obj.name, detail: extractToolDetail(obj.input), timestamp };
    }

    // Nested in content array
    const content = obj.message?.content ?? obj.content;
    if (Array.isArray(content)) {
      let lastToolUse: ToolUseInfo | null = null;
      for (const block of content) {
        if (block.type === 'tool_use' && typeof block.name === 'string') {
          lastToolUse = { tool: block.name, detail: extractToolDetail(block.input), timestamp };
        }
      }
      return lastToolUse;
    }

    return null;
  } catch {
    return null;
  }
}

function extractToolDetail(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const inp = input as Record<string, unknown>;

  const raw =
    typeof inp.file_path === 'string'
      ? inp.file_path
      : typeof inp.command === 'string'
        ? inp.command
        : typeof inp.pattern === 'string'
          ? inp.pattern
          : null;

  if (!raw) return null;
  return raw.length > 79 ? raw.slice(0, 79) + '…' : raw;
}

export function extractLastToolUse(content: string): ToolUseInfo | null {
  if (!content) return null;
  const lines = content.split('\n');
  let last: ToolUseInfo | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const info = extractToolUseFromJsonLine(line);
    if (info) {
      last = info;
    }
  }

  return last;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s ago`;
  }
  return `${seconds}s ago`;
}

function computeFrozenNow(data: MonitorData): number {
  const candidates: number[] = [];
  if (data.lastOutputTimestamp) {
    candidates.push(data.lastOutputTimestamp.getTime());
  }
  if (data.lastActivity?.timestamp) {
    candidates.push(data.lastActivity.timestamp.getTime());
  }
  for (const p of data.phaseTimestamps) {
    if (p.startedAt) {
      candidates.push(p.startedAt.getTime());
    }
  }
  return candidates.length > 0 ? Math.max(...candidates) : Date.now();
}

export interface MonitorData {
  status: 'RUNNING' | 'STOPPED';
  done: number;
  total: number;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  phaseTimestamps: PhaseTimestamp[];
  lastLogLine: string | null;
  lastOutputTimestamp: Date | null;
  lastActivity: ToolUseInfo | null;
}

export function formatMonitorOutput(data: MonitorData): string {
  const lines: string[] = [];
  lines.push(`Status: ${data.status}`);
  lines.push(`Progress: ${formatProgressBar(data.done, data.total)}`);

  // When STOPPED, freeze all "ago" timers at the last known timestamp
  // instead of letting them tick up from Date.now()
  const now = data.status === 'STOPPED' ? computeFrozenNow(data) : Date.now();

  if (data.currentTaskId) {
    const title = data.currentTaskTitle ? `: ${data.currentTaskTitle}` : '';
    lines.push(`Current task: ${data.currentTaskId}${title}`);
  }

  if (data.phaseTimestamps.length > 0 || data.status === 'RUNNING') {
    lines.push(`Phases: ${formatPhaseTimeline(data.phaseTimestamps, now)}`);
  }

  if (data.lastLogLine) {
    if (data.lastOutputTimestamp) {
      const staleness = now - data.lastOutputTimestamp.getTime();
      lines.push(`Last output (${formatElapsed(staleness)}): ${data.lastLogLine}`);
    } else {
      lines.push(`Last output: ${data.lastLogLine}`);
    }
  }

  if (data.lastActivity) {
    let activityLine = `Activity: ${data.lastActivity.tool}`;
    if (data.lastActivity.detail) {
      activityLine += ` — ${data.lastActivity.detail}`;
    }
    if (data.lastActivity.timestamp) {
      const elapsed = now - data.lastActivity.timestamp.getTime();
      activityLine += ` (${formatElapsed(elapsed)})`;
    }
    lines.push(activityLine);
  }

  return lines.join('\n');
}

export interface RunResult {
  watching: boolean;
  stop?: () => void;
}

export async function collectMonitorData(
  tasksDir: string,
  logsDir: string,
): Promise<MonitorData | null> {
  let tasks: Task[];
  try {
    tasks = await scanTasks(tasksDir);
  } catch {
    return null;
  }

  const counts = countByStatus(tasks);
  const total = counts.DONE + counts.TODO;

  const pidPath = join(tasksDir, '..', '..', '.ralph-logs', 'ralph.pid');
  const ralphPid = await readPidFile(pidPath);
  const status = detectStatus(ralphPid !== null ? [ralphPid] : []);

  let currentTaskId: string | null = null;
  let currentTaskTitle: string | null = null;
  let phaseTimestamps: PhaseTimestamp[] = [];
  let lastLogLine: string | null = null;
  let lastOutputTimestamp: Date | null = null;
  let lastActivity: ToolUseInfo | null = null;

  const latestLog = await findLatestLogFile(logsDir);
  if (latestLog) {
    currentTaskId = extractTaskIdFromLog(latestLog);
    if (currentTaskId) {
      const task = tasks.find((t) => t.id === currentTaskId);
      if (task) {
        currentTaskTitle = task.title;
      }
    }

    const logPath = join(logsDir, latestLog);
    phaseTimestamps = await scanLogForPhases(logPath);

    const logContent = await readLogTail(logPath);
    if (logContent) {
      const termWidth = process.stdout.columns || 80;
      const lastLogResult = parseLastLogLineWithTimestamp(logContent, termWidth);
      if (lastLogResult) {
        lastLogLine = lastLogResult.text;
        lastOutputTimestamp = lastLogResult.timestamp;
      }
      lastActivity = extractLastToolUse(logContent);
    }
  }

  return {
    status,
    done: counts.DONE,
    total,
    currentTaskId,
    currentTaskTitle,
    phaseTimestamps,
    lastLogLine,
    lastOutputTimestamp,
    lastActivity,
  };
}

export async function renderDashboard(tasksDir: string, logsDir: string): Promise<string> {
  const data = await collectMonitorData(tasksDir, logsDir);
  if (!data) {
    return 'No tasks directory found';
  }
  if (data.done === 0 && data.total === 0) {
    return 'No tasks found';
  }
  return formatMonitorOutput(data);
}

export async function run(args: string[], cwd?: string): Promise<RunResult> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: ralph monitor [-w|--watch] [-i|--interval <seconds>] [-j|--json]');
    return { watching: false };
  }

  const projectDir = cwd ?? process.cwd();
  const tasksDir = join(projectDir, 'docs', 'tasks');
  const logsDir = join(projectDir, '.ralph-logs');
  const isJson = args.includes('--json') || args.includes('-j');
  const isWatch = args.includes('-w') || args.includes('--watch');

  if (isJson) {
    const data = await collectMonitorData(tasksDir, logsDir);
    console.log(JSON.stringify(data));

    if (isWatch) {
      const intervalIdx =
        args.indexOf('-i') !== -1 ? args.indexOf('-i') : args.indexOf('--interval');
      const intervalSec = intervalIdx !== -1 ? parseInt(args[intervalIdx + 1], 10) || 1 : 1;

      const refresh = async () => {
        const refreshData = await collectMonitorData(tasksDir, logsDir);
        console.log(JSON.stringify(refreshData));
      };

      const intervalId = setInterval(refresh, intervalSec * 1000);

      const stop = () => {
        clearInterval(intervalId);
      };

      process.on('SIGINT', () => {
        stop();
        process.exit(0);
      });

      return { watching: true, stop };
    }

    return { watching: false };
  }

  const output = await renderDashboard(tasksDir, logsDir);

  if (isWatch) {
    console.clear();
    console.log(output);

    const intervalIdx = args.indexOf('-i') !== -1 ? args.indexOf('-i') : args.indexOf('--interval');
    const intervalSec = intervalIdx !== -1 ? parseInt(args[intervalIdx + 1], 10) || 1 : 1;

    const refresh = async () => {
      const refreshOutput = await renderDashboard(tasksDir, logsDir);
      console.clear();
      console.log(refreshOutput);
    };

    const intervalId = setInterval(refresh, intervalSec * 1000);

    const stop = () => {
      clearInterval(intervalId);
    };

    process.on('SIGINT', () => {
      stop();
      process.exit(0);
    });

    return { watching: true, stop };
  }

  console.log(output);
  return { watching: false };
}
