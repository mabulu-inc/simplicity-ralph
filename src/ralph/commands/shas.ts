import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scanTasks, type Task } from '../core/tasks.js';
import { findCommitByMessage } from '../core/git.js';
import { updateField } from '../core/markdown.js';

function updateCommitField(content: string, sha: string): string {
  return updateField(content, 'Commit', sha, ['Completed', 'PRD Reference']);
}

export async function run(args: string[], cwd?: string): Promise<void> {
  const projectDir = cwd ?? process.cwd();
  const tasksDir = join(projectDir, 'docs', 'tasks');
  const tasks = await scanTasks(tasksDir);
  const doneTasks = tasks.filter((t: Task) => t.status === 'DONE');

  let updated = 0;

  for (const task of doneTasks) {
    const filePath = join(tasksDir, `${task.id}.md`);
    const commit = await findCommitByMessage(projectDir, `${task.id}:`);

    if (!commit) {
      console.log(`Warning: No commit found for ${task.id}`);
      continue;
    }

    if (task.commit === commit.sha) {
      continue;
    }

    const content = await readFile(filePath, 'utf-8');
    const newContent = updateCommitField(content, commit.sha);
    await writeFile(filePath, newContent);

    const action = task.commit ? 'corrected' : 'added';
    console.log(`Updated ${task.id}: ${action} commit SHA → ${commit.sha.slice(0, 7)}`);
    updated++;
  }

  if (updated === 0) {
    console.log('No changes needed');
  } else {
    console.log(`Updated ${updated} task${updated === 1 ? '' : 's'}`);
  }
}
