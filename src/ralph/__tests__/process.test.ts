import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  spawnWithCapture,
  killProcessTree,
  getChildPids,
  monitorProcess,
} from '../core/process.js';

describe('process management', () => {
  const cleanupPids: number[] = [];
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    for (const pid of cleanupPids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already dead
      }
    }
    cleanupPids.length = 0;
    for (const dir of cleanupDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    cleanupDirs.length = 0;
  });

  describe('spawnWithCapture', () => {
    it('spawns a process and captures output to a file', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'ralph-proc-'));
      cleanupDirs.push(dir);
      const logFile = join(dir, 'output.log');

      const child = spawnWithCapture('echo', ['hello world'], { logFile });
      cleanupPids.push(child.pid!);

      // Wait for process to finish
      await new Promise<void>((resolve) => {
        child.on('close', () => resolve());
      });

      const content = await readFile(logFile, 'utf-8');
      expect(content).toContain('hello world');
    });

    it('captures stderr to the same file', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'ralph-proc-'));
      cleanupDirs.push(dir);
      const logFile = join(dir, 'output.log');

      const child = spawnWithCapture('node', ['-e', 'process.stderr.write("err msg")'], {
        logFile,
      });
      cleanupPids.push(child.pid!);

      await new Promise<void>((resolve) => {
        child.on('close', () => resolve());
      });

      const content = await readFile(logFile, 'utf-8');
      expect(content).toContain('err msg');
    });

    it('passes cwd option to child process', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'ralph-proc-'));
      cleanupDirs.push(dir);
      const logFile = join(dir, 'output.log');

      const child = spawnWithCapture('pwd', [], { logFile, cwd: dir });
      cleanupPids.push(child.pid!);

      await new Promise<void>((resolve) => {
        child.on('close', () => resolve());
      });

      const content = await readFile(logFile, 'utf-8');
      // realpath resolves /tmp -> /private/tmp on macOS
      expect(content.trim()).toContain('ralph-proc-');
    });

    it('creates the parent directory of logFile if it does not exist', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'ralph-proc-'));
      cleanupDirs.push(dir);
      const logFile = join(dir, 'nested', 'deep', 'output.log');

      const child = spawnWithCapture('echo', ['dir-created'], { logFile });
      cleanupPids.push(child.pid!);

      await new Promise<void>((resolve) => {
        child.on('close', () => resolve());
      });

      const content = await readFile(logFile, 'utf-8');
      expect(content).toContain('dir-created');
    });

    it('returns a ChildProcess with a valid pid', () => {
      const child = spawnWithCapture('sleep', ['0.01'], {});
      cleanupPids.push(child.pid!);
      expect(child.pid).toBeGreaterThan(0);
    });
  });

  describe('killProcessTree', () => {
    it('kills a running process', async () => {
      const child = spawnWithCapture('sleep', ['60'], {});
      const pid = child.pid!;
      cleanupPids.push(pid);

      await killProcessTree(pid);

      // Give OS time to reap
      await new Promise((r) => setTimeout(r, 100));

      // Process should be dead
      expect(() => process.kill(pid, 0)).toThrow();
    });

    it('kills child processes (process tree)', async () => {
      const child = spawnWithCapture('sh', ['-c', 'sleep 60 & sleep 60 & wait'], {});
      const pid = child.pid!;
      cleanupPids.push(pid);

      // Give children time to start
      await new Promise((r) => setTimeout(r, 300));

      // Find child PIDs before killing
      const childPids = await getChildPids(pid);
      expect(childPids.length).toBeGreaterThan(0);
      for (const cpid of childPids) {
        cleanupPids.push(cpid);
      }

      await killProcessTree(pid);
      await new Promise((r) => setTimeout(r, 300));

      // Parent should be dead
      expect(() => process.kill(pid, 0)).toThrow();

      // All children should also be dead
      for (const cpid of childPids) {
        expect(() => process.kill(cpid, 0)).toThrow();
      }
    });

    it('kills nested grandchild processes', async () => {
      // sh spawns sh which spawns sleep — a 3-level tree
      const child = spawnWithCapture('sh', ['-c', 'sh -c "sleep 60 & wait" & wait'], {});
      const pid = child.pid!;
      cleanupPids.push(pid);

      await new Promise((r) => setTimeout(r, 300));

      // Collect all descendants
      const allDescendants = await getChildPids(pid);
      for (const cpid of allDescendants) {
        cleanupPids.push(cpid);
      }

      await killProcessTree(pid);
      await new Promise((r) => setTimeout(r, 300));

      expect(() => process.kill(pid, 0)).toThrow();
      for (const cpid of allDescendants) {
        expect(() => process.kill(cpid, 0)).toThrow();
      }
    });

    it('does not throw when process is already dead', async () => {
      const child = spawnWithCapture('echo', ['done'], {});
      const pid = child.pid!;

      await new Promise<void>((resolve) => {
        child.on('close', () => resolve());
      });

      // Should not throw
      await expect(killProcessTree(pid)).resolves.toBeUndefined();
    });

    it('sends SIGTERM first then SIGKILL after grace period', async () => {
      // Create a process that ignores SIGTERM
      const child = spawnWithCapture(
        'node',
        ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'],
        {},
      );
      const pid = child.pid!;
      cleanupPids.push(pid);

      await new Promise((r) => setTimeout(r, 100));

      // Kill with a short grace period
      await killProcessTree(pid, { gracePeriodMs: 200 });
      await new Promise((r) => setTimeout(r, 100));

      expect(() => process.kill(pid, 0)).toThrow();
    });
  });

  describe('getChildPids', () => {
    it('returns child PIDs of a process', async () => {
      const child = spawnWithCapture('sh', ['-c', 'sleep 60 & sleep 60 & wait'], {});
      const pid = child.pid!;
      cleanupPids.push(pid);

      await new Promise((r) => setTimeout(r, 300));

      const childPids = await getChildPids(pid);
      expect(childPids.length).toBeGreaterThanOrEqual(2);

      for (const cpid of childPids) {
        cleanupPids.push(cpid);
        expect(cpid).toBeGreaterThan(0);
        expect(cpid).not.toBe(pid);
      }

      // Cleanup
      await killProcessTree(pid);
    });

    it('returns empty array for a process with no children', async () => {
      const child = spawnWithCapture('sleep', ['60'], {});
      const pid = child.pid!;
      cleanupPids.push(pid);

      await new Promise((r) => setTimeout(r, 100));

      const childPids = await getChildPids(pid);
      expect(childPids).toEqual([]);

      await killProcessTree(pid);
    });

    it('returns empty array for a nonexistent PID', async () => {
      const childPids = await getChildPids(999999999);
      expect(childPids).toEqual([]);
    });
  });

  describe('monitorProcess', () => {
    it('resolves with exit code when process completes', async () => {
      const child = spawnWithCapture('echo', ['hi'], {});
      cleanupPids.push(child.pid!);

      const result = await monitorProcess(child);
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
    });

    it('resolves with non-zero exit code on failure', async () => {
      const child = spawnWithCapture('node', ['-e', 'process.exit(42)'], {});
      cleanupPids.push(child.pid!);

      const result = await monitorProcess(child);
      expect(result.exitCode).toBe(42);
      expect(result.timedOut).toBe(false);
    });

    it('kills and returns timedOut when timeout is exceeded', async () => {
      const child = spawnWithCapture('sleep', ['60'], {});
      cleanupPids.push(child.pid!);

      const result = await monitorProcess(child, { timeoutMs: 200 });
      expect(result.timedOut).toBe(true);
    });

    it('calls onOutput callback for stdout data', async () => {
      const child = spawnWithCapture('echo', ['callback-test'], {});
      cleanupPids.push(child.pid!);

      const chunks: string[] = [];
      await monitorProcess(child, {
        onOutput: (data) => chunks.push(data),
      });

      expect(chunks.join('')).toContain('callback-test');
    });
  });

  describe('timestamp injection', () => {
    it('injects a timestamp field into JSONL stdout lines', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'ralph-proc-'));
      cleanupDirs.push(dir);
      const logFile = join(dir, 'output.log');

      const jsonLine = JSON.stringify({ type: 'assistant', text: 'hello' });
      const child = spawnWithCapture(
        'node',
        ['-e', `process.stdout.write(${JSON.stringify(jsonLine + '\n')})`],
        {
          logFile,
        },
      );
      cleanupPids.push(child.pid!);

      await new Promise<void>((resolve) => {
        child.on('close', () => resolve());
      });

      const content = await readFile(logFile, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.type).toBe('assistant');
      expect(parsed.text).toBe('hello');
      expect(typeof parsed.timestamp).toBe('string');
      // Verify it's a valid ISO 8601 date
      const d = new Date(parsed.timestamp);
      expect(d.getTime()).not.toBeNaN();
    });

    it('handles multiple JSONL lines', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'ralph-proc-'));
      cleanupDirs.push(dir);
      const logFile = join(dir, 'output.log');

      const line1 = JSON.stringify({ id: 1 });
      const line2 = JSON.stringify({ id: 2 });
      const child = spawnWithCapture(
        'node',
        ['-e', `process.stdout.write(${JSON.stringify(line1 + '\n' + line2 + '\n')})`],
        { logFile },
      );
      cleanupPids.push(child.pid!);

      await new Promise<void>((resolve) => {
        child.on('close', () => resolve());
      });

      const content = await readFile(logFile, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(typeof parsed.timestamp).toBe('string');
      }
      expect(JSON.parse(lines[0]).id).toBe(1);
      expect(JSON.parse(lines[1]).id).toBe(2);
    });

    it('passes non-JSON lines through unchanged', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'ralph-proc-'));
      cleanupDirs.push(dir);
      const logFile = join(dir, 'output.log');

      const child = spawnWithCapture('node', ['-e', 'process.stdout.write("plain text line\\n")'], {
        logFile,
      });
      cleanupPids.push(child.pid!);

      await new Promise<void>((resolve) => {
        child.on('close', () => resolve());
      });

      const content = await readFile(logFile, 'utf-8');
      expect(content.trim()).toBe('plain text line');
    });

    it('passes stderr through unchanged (no timestamp injection)', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'ralph-proc-'));
      cleanupDirs.push(dir);
      const logFile = join(dir, 'output.log');

      const jsonLine = JSON.stringify({ error: true });
      const child = spawnWithCapture(
        'node',
        ['-e', `process.stderr.write(${JSON.stringify(jsonLine + '\n')})`],
        { logFile },
      );
      cleanupPids.push(child.pid!);

      await new Promise<void>((resolve) => {
        child.on('close', () => resolve());
      });

      const content = await readFile(logFile, 'utf-8');
      const parsed = JSON.parse(content.trim());
      // stderr should NOT have timestamp injected
      expect(parsed.timestamp).toBeUndefined();
      expect(parsed.error).toBe(true);
    });

    it('handles partial line buffering (data split across chunks)', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'ralph-proc-'));
      cleanupDirs.push(dir);
      const logFile = join(dir, 'output.log');

      // Write a JSON line in two separate chunks to test buffering
      const child = spawnWithCapture(
        'node',
        [
          '-e',
          "process.stdout.write('{\"par'); setTimeout(() => process.stdout.write('tial\":true}\\n'), 50)",
        ],
        { logFile },
      );
      cleanupPids.push(child.pid!);

      await new Promise<void>((resolve) => {
        child.on('close', () => resolve());
      });

      const content = await readFile(logFile, 'utf-8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.partial).toBe(true);
      expect(typeof parsed.timestamp).toBe('string');
    });

    it('uses current time for the timestamp', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'ralph-proc-'));
      cleanupDirs.push(dir);
      const logFile = join(dir, 'output.log');

      const before = Date.now();
      const jsonLine = JSON.stringify({ check: 'time' });
      const child = spawnWithCapture(
        'node',
        ['-e', `process.stdout.write(${JSON.stringify(jsonLine + '\n')})`],
        { logFile },
      );
      cleanupPids.push(child.pid!);

      await new Promise<void>((resolve) => {
        child.on('close', () => resolve());
      });
      const after = Date.now();

      const content = await readFile(logFile, 'utf-8');
      const parsed = JSON.parse(content.trim());
      const ts = new Date(parsed.timestamp).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });
});
