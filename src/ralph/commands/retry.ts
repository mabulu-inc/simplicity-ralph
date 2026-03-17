import { retryTask } from '../core/retry.js';

export async function run(args: string[], cwd?: string): Promise<void> {
  if (args.length === 0) {
    throw new Error(
      'Usage: ralph retry <task ID> [task ID ...] — at least one task ID is required',
    );
  }

  const projectDir = cwd ?? process.cwd();
  let hasError = false;

  for (const taskId of args) {
    const result = await retryTask(taskId, projectDir);

    switch (result.status) {
      case 'reset':
        console.log(result.message);
        break;
      case 'noop':
        console.log(result.message);
        break;
      case 'error':
        console.error(result.message);
        hasError = true;
        break;
    }
  }

  if (hasError) {
    process.exitCode = 1;
  }
}
