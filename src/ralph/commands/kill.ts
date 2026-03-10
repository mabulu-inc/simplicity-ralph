import { findProcessesByPattern, killProcessTree } from '../core/process.js';

const SEARCH_PATTERNS = ['ralph loop', 'claude'];

export async function run(_args: string[]): Promise<void> {
  const allPids = new Set<number>();

  for (const pattern of SEARCH_PATTERNS) {
    const pids = await findProcessesByPattern(pattern);
    for (const pid of pids) {
      allPids.add(pid);
    }
  }

  if (allPids.size === 0) {
    console.log('Ralph is not running');
    return;
  }

  let killed = 0;
  for (const pid of allPids) {
    try {
      await killProcessTree(pid);
      killed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to kill process ${pid}: ${message}`);
    }
  }

  console.log(`Killed ${killed} process${killed === 1 ? '' : 'es'}`);
}
