import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Task {
  id: string;
  number: number;
  title: string;
  status: 'TODO' | 'DONE';
  milestone: string;
  depends: string[];
  prdReference: string;
  completed: string | undefined;
  commit: string | undefined;
  cost: string | undefined;
  blocked: boolean;
  description: string;
}

function extractField(content: string, field: string): string | undefined {
  const re = new RegExp(`^- \\*\\*${field}\\*\\*:\\s*(.+)$`, 'm');
  const match = content.match(re);
  return match ? match[1].trim() : undefined;
}

function parseDeps(raw: string | undefined): string[] {
  if (!raw || raw.toLowerCase() === 'none') return [];
  return raw.split(',').map((d) => d.trim());
}

function extractDescription(content: string): string {
  const descMatch = content.match(/^## Description\s*\n([\s\S]*?)(?=\n##|\n*$)/m);
  if (!descMatch) return '';
  return descMatch[1].trim().split('\n\n')[0].trim();
}

export function parseTaskFile(filename: string, content: string): Task {
  const headingMatch = content.match(/^# (T-\d+):\s*(.+)$/m);
  const id = headingMatch ? headingMatch[1] : filename.replace('.md', '');
  const title = headingMatch ? headingMatch[2].trim() : '';
  const number = parseInt(id.replace('T-', ''), 10);

  const status = (extractField(content, 'Status') as 'TODO' | 'DONE') ?? 'TODO';
  const milestone = extractField(content, 'Milestone') ?? '';
  const depends = parseDeps(extractField(content, 'Depends'));
  const prdReference = extractField(content, 'PRD Reference') ?? '';
  const completed = extractField(content, 'Completed');
  const commit = extractField(content, 'Commit');
  const cost = extractField(content, 'Cost');
  const blocked = /^## Blocked/m.test(content);
  const description = extractDescription(content);

  return {
    id,
    number,
    title,
    status,
    milestone,
    depends,
    prdReference,
    completed,
    commit,
    cost,
    blocked,
    description,
  };
}

const TASK_FILE_RE = /^T-\d+\.md$/;

export async function scanTasks(dir: string): Promise<Task[]> {
  const entries = await readdir(dir);
  const taskFiles = entries.filter((f) => TASK_FILE_RE.test(f)).sort();

  const tasks: Task[] = [];
  for (const file of taskFiles) {
    const content = await readFile(join(dir, file), 'utf-8');
    tasks.push(parseTaskFile(file, content));
  }

  return tasks.sort((a, b) => a.number - b.number);
}

export function findNextTask(tasks: Task[]): Task | undefined {
  const doneIds = new Set(tasks.filter((t) => t.status === 'DONE').map((t) => t.id));

  return tasks.find(
    (t) => t.status === 'TODO' && !t.blocked && t.depends.every((dep) => doneIds.has(dep)),
  );
}

export function countByStatus(tasks: Task[]): { TODO: number; DONE: number } {
  let todo = 0;
  let done = 0;
  for (const t of tasks) {
    if (t.status === 'DONE') done++;
    else todo++;
  }
  return { TODO: todo, DONE: done };
}

export function allDone(tasks: Task[]): boolean {
  return tasks.every((t) => t.status === 'DONE');
}
