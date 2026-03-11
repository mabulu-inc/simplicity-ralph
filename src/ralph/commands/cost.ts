import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { scanTasks, type Task } from '../core/tasks.js';
import { getPricing } from '../core/defaults.js';
import { updateField } from '../core/markdown.js';

export interface TokenUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}

interface CostEntry {
  label: string;
  usage: TokenUsage;
  cost: number;
}

export function parseLogLine(line: string): TokenUsage | null {
  if (!line.trim()) return null;
  try {
    const obj = JSON.parse(line);
    if (!obj.usage) return null;
    const u = obj.usage;
    return {
      input_tokens: u.input_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
    };
  } catch {
    return null;
  }
}

export function aggregateUsage(entries: TokenUsage[]): TokenUsage {
  const result: TokenUsage = {
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
  };
  for (const e of entries) {
    result.input_tokens += e.input_tokens;
    result.cache_creation_input_tokens += e.cache_creation_input_tokens;
    result.cache_read_input_tokens += e.cache_read_input_tokens;
    result.output_tokens += e.output_tokens;
  }
  return result;
}

export function calculateCost(usage: TokenUsage): number {
  const pricing = getPricing();
  return (
    (usage.input_tokens / 1_000_000) * pricing.input +
    (usage.cache_creation_input_tokens / 1_000_000) * pricing.cacheWrite +
    (usage.cache_read_input_tokens / 1_000_000) * pricing.cacheRead +
    (usage.output_tokens / 1_000_000) * pricing.output
  );
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function formatCostTable(entries: CostEntry[]): string {
  if (entries.length === 0) return 'No log files found';

  const header = ['Label', 'Input', 'Cache Write', 'Cache Read', 'Output', 'Cost'];

  const rows: string[][] = entries.map((e) => [
    e.label,
    fmt(e.usage.input_tokens),
    fmt(e.usage.cache_creation_input_tokens),
    fmt(e.usage.cache_read_input_tokens),
    fmt(e.usage.output_tokens),
    fmtCost(e.cost),
  ]);

  if (entries.length > 1) {
    const totalUsage = aggregateUsage(entries.map((e) => e.usage));
    const totalCost = entries.reduce((sum, e) => sum + e.cost, 0);
    rows.push([
      'Total',
      fmt(totalUsage.input_tokens),
      fmt(totalUsage.cache_creation_input_tokens),
      fmt(totalUsage.cache_read_input_tokens),
      fmt(totalUsage.output_tokens),
      fmtCost(totalCost),
    ]);
  }

  const allRows = [header, ...rows];
  const colWidths = header.map((_, i) => Math.max(...allRows.map((r) => r[i].length)));

  const formatRow = (row: string[]) =>
    row
      .map((cell, i) => (i === 0 ? cell.padEnd(colWidths[i]) : cell.padStart(colWidths[i])))
      .join('  ');

  const lines = [formatRow(header), colWidths.map((w) => '-'.repeat(w)).join('  ')];

  if (entries.length > 1 && rows.length > 1) {
    for (const row of rows.slice(0, -1)) {
      lines.push(formatRow(row));
    }
    lines.push(colWidths.map((w) => '-'.repeat(w)).join('  '));
    lines.push(formatRow(rows[rows.length - 1]));
  } else {
    for (const row of rows) {
      lines.push(formatRow(row));
    }
  }

  return lines.join('\n');
}

async function parseLogFile(filePath: string): Promise<TokenUsage[]> {
  const content = await readFile(filePath, 'utf-8');
  const usages: TokenUsage[] = [];
  for (const line of content.split('\n')) {
    const usage = parseLogLine(line);
    if (usage) usages.push(usage);
  }
  return usages;
}

async function getLogFiles(logsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(logsDir);
    return entries.filter((f) => f.endsWith('.jsonl')).sort();
  } catch {
    return [];
  }
}

function extractTaskId(filename: string): string | undefined {
  const match = filename.match(/^(T-\d+)/);
  return match ? match[1] : undefined;
}

function updateCostField(content: string, cost: string): string {
  return updateField(content, 'Cost', cost, ['Commit', 'Completed', 'PRD Reference']);
}

export async function run(args: string[], cwd?: string): Promise<void> {
  const projectDir = cwd ?? process.cwd();
  const logsDir = join(projectDir, '.ralph-logs');

  if (args.length === 0) {
    console.log('Usage: ralph cost <logfile> | --task T-NNN | --all | --total | --update-tasks');
    return;
  }

  const flag = args[0];

  if (flag === '--task') {
    const taskId = args[1];
    if (!taskId) {
      console.log('Usage: ralph cost --task T-NNN');
      return;
    }
    const files = await getLogFiles(logsDir);
    if (files.length === 0) {
      console.log('No log files found');
      return;
    }
    const taskFiles = files.filter((f) => extractTaskId(f) === taskId);
    if (taskFiles.length === 0) {
      console.log(`No log files found for ${taskId}`);
      return;
    }
    const entries: CostEntry[] = [];
    for (const file of taskFiles) {
      const usages = await parseLogFile(join(logsDir, file));
      const usage = aggregateUsage(usages);
      entries.push({ label: file, usage, cost: calculateCost(usage) });
    }
    console.log(formatCostTable(entries));
    return;
  }

  if (flag === '--all') {
    const files = await getLogFiles(logsDir);
    if (files.length === 0) {
      console.log('No log files found');
      return;
    }
    const taskGroups = new Map<string, TokenUsage[]>();
    const taskOrder: string[] = [];
    for (const file of files) {
      const taskId = extractTaskId(file) ?? 'unknown';
      if (!taskGroups.has(taskId)) {
        taskOrder.push(taskId);
        taskGroups.set(taskId, []);
      }
      const usages = await parseLogFile(join(logsDir, file));
      taskGroups.get(taskId)!.push(...usages);
    }
    const entries: CostEntry[] = taskOrder.map((taskId) => {
      const usage = aggregateUsage(taskGroups.get(taskId)!);
      return { label: taskId, usage, cost: calculateCost(usage) };
    });
    console.log(formatCostTable(entries));
    return;
  }

  if (flag === '--total') {
    const files = await getLogFiles(logsDir);
    if (files.length === 0) {
      console.log('No log files found');
      return;
    }
    const allUsages: TokenUsage[] = [];
    for (const file of files) {
      allUsages.push(...(await parseLogFile(join(logsDir, file))));
    }
    const usage = aggregateUsage(allUsages);
    const cost = calculateCost(usage);
    const entry: CostEntry = { label: 'Total', usage, cost };
    console.log(formatCostTable([entry]));
    return;
  }

  if (flag === '--update-tasks') {
    const files = await getLogFiles(logsDir);
    const tasksDir = join(projectDir, 'docs', 'tasks');
    const tasks = await scanTasks(tasksDir);
    const doneTasks = tasks.filter((t: Task) => t.status === 'DONE');

    let updated = 0;
    for (const task of doneTasks) {
      const taskFiles = files.filter((f) => extractTaskId(f) === task.id);
      if (taskFiles.length === 0) continue;

      const allUsages: TokenUsage[] = [];
      for (const file of taskFiles) {
        allUsages.push(...(await parseLogFile(join(logsDir, file))));
      }
      const usage = aggregateUsage(allUsages);
      const cost = fmtCost(calculateCost(usage));

      const filePath = join(tasksDir, `${task.id}.md`);
      const content = await readFile(filePath, 'utf-8');
      const newContent = updateCostField(content, cost);
      if (newContent !== content) {
        await writeFile(filePath, newContent);
        console.log(`Updated ${task.id}: cost → ${cost}`);
        updated++;
      }
    }

    if (updated === 0) {
      console.log('No changes needed');
    } else {
      console.log(`Updated ${updated} task${updated === 1 ? '' : 's'}`);
    }
    return;
  }

  // Single log file mode
  const filePath = isAbsolute(flag) ? flag : join(projectDir, flag);
  const usages = await parseLogFile(filePath);
  const usage = aggregateUsage(usages);
  const cost = calculateCost(usage);
  const entry: CostEntry = { label: flag.split('/').pop() ?? flag, usage, cost };
  console.log(formatCostTable([entry]));
}
