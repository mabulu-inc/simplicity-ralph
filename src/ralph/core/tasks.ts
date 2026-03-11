import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseMarkdown,
  extractFieldFromAst,
  extractHeading,
  hasSection,
  countListItemsInSection,
  extractSectionFirstParagraph,
} from './markdown.js';

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
  producesCount: number;
}

function parseDeps(raw: string | undefined): string[] {
  if (!raw || raw.toLowerCase() === 'none') return [];
  return raw.split(',').map((d) => d.trim());
}

export function parseTaskFile(filename: string, content: string): Task {
  const tree = parseMarkdown(content);

  const heading = extractHeading(tree, 1) ?? '';
  const headingMatch = heading.match(/^(T-\d+):\s*(.+)$/);
  const id = headingMatch ? headingMatch[1] : filename.replace('.md', '');
  const title = headingMatch ? headingMatch[2].trim() : '';
  const number = parseInt(id.replace('T-', ''), 10);

  const status = (extractFieldFromAst(tree, 'Status') as 'TODO' | 'DONE') ?? 'TODO';
  const milestone = extractFieldFromAst(tree, 'Milestone') ?? '';
  const depends = parseDeps(extractFieldFromAst(tree, 'Depends'));
  const prdReference = extractFieldFromAst(tree, 'PRD Reference') ?? '';
  const completed = extractFieldFromAst(tree, 'Completed');
  const commit = extractFieldFromAst(tree, 'Commit');
  const cost = extractFieldFromAst(tree, 'Cost');
  const blocked = hasSection(tree, 'Blocked');
  const description = extractSectionFirstParagraph(tree, 'Description');
  const producesCount = countListItemsInSection(tree, 'Produces');

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
    producesCount,
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
