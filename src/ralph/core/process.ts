import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function injectTimestamp(line: string): string {
  try {
    const obj = JSON.parse(line);
    if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
      obj.timestamp = new Date().toISOString();
      return JSON.stringify(obj);
    }
  } catch {
    // Not valid JSON — return as-is
  }
  return line;
}

function pipeStdoutWithTimestamps(child: ChildProcess, stream: WriteStream): void {
  let buffer = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      stream.write(injectTimestamp(line) + '\n');
    }
  });
  child.stdout?.on('end', () => {
    if (buffer.length > 0) {
      stream.write(injectTimestamp(buffer) + '\n');
    }
  });
}

export interface SpawnOptions {
  logFile?: string;
  cwd?: string;
}

export interface MonitorResult {
  exitCode: number | null;
  timedOut: boolean;
}

export interface MonitorOptions {
  timeoutMs?: number;
  onOutput?: (data: string) => void;
}

export interface KillOptions {
  gracePeriodMs?: number;
}

export function spawnWithCapture(
  command: string,
  args: string[],
  options: SpawnOptions,
): ChildProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (options.logFile) {
    mkdirSync(dirname(options.logFile), { recursive: true });
    const stream = createWriteStream(options.logFile, { flags: 'a' });
    pipeStdoutWithTimestamps(child, stream);
    child.stderr?.pipe(stream);
    child.on('close', () => stream.end());
  }

  return child;
}

/**
 * Recursively find all descendant PIDs of a given process.
 */
export async function getChildPids(pid: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-P', String(pid)]);
    const directChildren = stdout
      .trim()
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => parseInt(line.trim(), 10))
      .filter((p) => !isNaN(p));

    const allDescendants: number[] = [];
    for (const childPid of directChildren) {
      allDescendants.push(childPid);
      const grandchildren = await getChildPids(childPid);
      allDescendants.push(...grandchildren);
    }
    return allDescendants;
  } catch {
    return [];
  }
}

export async function killProcessTree(pid: number, options?: KillOptions): Promise<void> {
  const gracePeriodMs = options?.gracePeriodMs ?? 5000;

  // Check if process is alive
  try {
    process.kill(pid, 0);
  } catch {
    return; // already dead
  }

  // Collect all descendant PIDs before sending signals
  const descendants = await getChildPids(pid);

  // All PIDs to kill: descendants first (bottom-up), then the root
  const allPids = [...descendants.reverse(), pid];

  // Send SIGTERM to all
  for (const p of allPids) {
    try {
      process.kill(p, 'SIGTERM');
    } catch {
      // already dead
    }
  }

  // Wait for graceful shutdown or force kill each
  for (const p of allPids) {
    const dead = await waitForDeath(p, gracePeriodMs);
    if (!dead) {
      try {
        process.kill(p, 'SIGKILL');
      } catch {
        // already dead
      }
      await waitForDeath(p, 1000);
    }
  }
}

async function waitForDeath(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

export async function monitorProcess(
  child: ChildProcess,
  options?: MonitorOptions,
): Promise<MonitorResult> {
  return new Promise<MonitorResult>((resolve) => {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (options?.onOutput) {
      const cb = options.onOutput;
      child.stdout?.on('data', (data: Buffer) => cb(data.toString()));
    }

    if (options?.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child.pid!, { gracePeriodMs: 500 });
      }, options.timeoutMs);
    }

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: code, timedOut });
    });
  });
}
