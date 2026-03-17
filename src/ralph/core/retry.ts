import { readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { parseTaskFile } from './tasks.js';

export interface RetryResult {
  taskId: string;
  status: 'reset' | 'noop' | 'error';
  message: string;
}

export async function retryTask(taskId: string, projectDir: string): Promise<RetryResult> {
  const tasksDir = join(projectDir, 'docs', 'tasks');
  const logsDir = join(projectDir, '.ralph-logs');
  const taskFile = join(tasksDir, `${taskId}.md`);

  let content: string;
  try {
    content = await readFile(taskFile, 'utf-8');
  } catch {
    return { taskId, status: 'error', message: `Task file ${taskId}.md not found` };
  }

  const task = parseTaskFile(`${taskId}.md`, content);

  if (task.status === 'TODO') {
    return { taskId, status: 'noop', message: `${taskId} is already TODO` };
  }

  if (task.status !== 'BLOCKED') {
    return {
      taskId,
      status: 'error',
      message: `${taskId} has status ${task.status} — only BLOCKED tasks can be retried`,
    };
  }

  // Reset status to TODO and remove Blocked reason
  const updatedContent = resetTaskContent(content);
  await writeFile(taskFile, updatedContent);

  // Archive log files
  await archiveLogs(taskId, logsDir);

  return { taskId, status: 'reset', message: `${taskId} reset to TODO` };
}

function resetTaskContent(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    if (/^-\s+\*\*Status\*\*:/.test(line)) {
      result.push('- **Status**: TODO');
    } else if (/^-\s+\*\*Blocked reason\*\*:/.test(line)) {
      // Remove this line entirely
      continue;
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

async function archiveLogs(taskId: string, logsDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(logsDir);
  } catch {
    return; // No logs dir, nothing to archive
  }

  const pattern = new RegExp(`^${escapeRegex(taskId)}-.*\\.jsonl$`);
  const matching = entries.filter((f) => pattern.test(f));

  if (matching.length === 0) return;

  const resetsDir = join(logsDir, `${taskId}-resets`);
  await mkdir(resetsDir, { recursive: true });

  for (const file of matching) {
    await rename(join(logsDir, file), join(resetsDir, file));
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
