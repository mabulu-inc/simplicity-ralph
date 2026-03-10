import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scanTasks, type Task } from '../core/tasks.js';
import { findCommitByMessage } from '../core/git.js';

function updateCommitField(content: string, sha: string): string {
  const commitRe = /^- \*\*Commit\*\*:\s*.+$/m;
  if (commitRe.test(content)) {
    return content.replace(commitRe, `- **Commit**: ${sha}`);
  }
  // Insert after Completed field
  const completedRe = /^(- \*\*Completed\*\*:\s*.+)$/m;
  if (completedRe.test(content)) {
    return content.replace(completedRe, `$1\n- **Commit**: ${sha}`);
  }
  // Insert after PRD Reference as fallback
  const prdRe = /^(- \*\*PRD Reference\*\*:\s*.+)$/m;
  return content.replace(prdRe, `$1\n- **Commit**: ${sha}`);
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
