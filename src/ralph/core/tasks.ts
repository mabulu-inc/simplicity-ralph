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
import type { ComplexityTier } from './complexity.js';

export interface Task {
  id: string;
  number: number;
  title: string;
  status: 'TODO' | 'DONE' | 'BLOCKED';
  milestone: string;
  depends: string[];
  prdReference: string;
  touches: string[];
  hints: string;
  completed: string | undefined;
  commit: string | undefined;
  cost: string | undefined;
  complexity: ComplexityTier | undefined;
  blocked: boolean;
  blockedReason: string | undefined;
  description: string;
  producesCount: number;
}

function parseTouches(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

const VALID_COMPLEXITY_TIERS = new Set<string>(['light', 'standard', 'heavy']);

function parseComplexity(raw: string | undefined): ComplexityTier | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  return VALID_COMPLEXITY_TIERS.has(normalized) ? (normalized as ComplexityTier) : undefined;
}

const NO_DEPS_VARIANTS = new Set(['none', '(none)', '—', '–', '-']);

function parseDeps(raw: string | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed === '' || NO_DEPS_VARIANTS.has(trimmed.toLowerCase())) return [];
  return trimmed.split(',').map((d) => d.trim());
}

export function parseTaskFile(filename: string, content: string): Task {
  const tree = parseMarkdown(content);

  const heading = extractHeading(tree, 1) ?? '';
  const headingMatch = heading.match(/^(T-\d+):\s*(.+)$/);
  const id = headingMatch ? headingMatch[1] : filename.replace('.md', '');
  const title = headingMatch ? headingMatch[2].trim() : '';
  const number = parseInt(id.replace('T-', ''), 10);

  const status = (extractFieldFromAst(tree, 'Status') as 'TODO' | 'DONE' | 'BLOCKED') ?? 'TODO';
  const milestone = extractFieldFromAst(tree, 'Milestone') ?? '';
  const depends = parseDeps(extractFieldFromAst(tree, 'Depends'));
  const prdReference = extractFieldFromAst(tree, 'PRD Reference') ?? '';
  const completed = extractFieldFromAst(tree, 'Completed');
  const commit = extractFieldFromAst(tree, 'Commit');
  const cost = extractFieldFromAst(tree, 'Cost');
  const blocked = hasSection(tree, 'Blocked') || status === 'BLOCKED';
  const blockedReason = extractFieldFromAst(tree, 'Blocked reason');
  const touchesRaw = extractFieldFromAst(tree, 'Touches');
  const touches = parseTouches(touchesRaw);
  const hints = extractSectionFirstParagraph(tree, 'Hints');
  const description = extractSectionFirstParagraph(tree, 'Description');
  const producesCount = countListItemsInSection(tree, 'Produces');
  const complexityRaw = extractFieldFromAst(tree, 'Complexity');
  const complexity = parseComplexity(complexityRaw);

  return {
    id,
    number,
    title,
    status,
    milestone,
    depends,
    prdReference,
    touches,
    hints,
    completed,
    commit,
    cost,
    complexity,
    blocked,
    blockedReason,
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

export interface UnmetDep {
  depId: string;
  status: 'TODO' | 'DONE' | 'BLOCKED' | 'unknown';
}

export interface TaskDiagnostic {
  taskId: string;
  blocked: boolean;
  unmetDeps: UnmetDep[];
}

export function diagnoseIneligible(tasks: Task[]): TaskDiagnostic[] {
  const doneIds = new Set(tasks.filter((t) => t.status === 'DONE').map((t) => t.id));
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  const todoTasks = tasks.filter(
    (t) => t.status === 'TODO' && (t.blocked || !t.depends.every((dep) => doneIds.has(dep))),
  );

  return todoTasks.map((t) => {
    const unmetDeps: UnmetDep[] = t.depends
      .filter((dep) => !doneIds.has(dep))
      .map((depId) => {
        const depTask = taskMap.get(depId);
        return { depId, status: depTask ? depTask.status : 'unknown' };
      });

    return { taskId: t.id, blocked: t.blocked, unmetDeps };
  });
}

export function countByStatus(tasks: Task[]): { TODO: number; DONE: number; BLOCKED: number } {
  let todo = 0;
  let done = 0;
  let blocked = 0;
  for (const t of tasks) {
    if (t.status === 'DONE') done++;
    else if (t.status === 'BLOCKED') blocked++;
    else todo++;
  }
  return { TODO: todo, DONE: done, BLOCKED: blocked };
}

export function allDone(tasks: Task[]): boolean {
  return tasks.every((t) => t.status === 'DONE');
}
