import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { scanTasks, findNextTask, allDone, countByStatus } from '../../core/tasks.js';
import { readConfig } from '../../core/config.js';
import { spawnWithCapture, monitorProcess } from '../../core/process.js';
import { generateBootPrompt } from './prompt-generator.js';
import { LoopGitService } from './git-service.js';
import { scaleForComplexity, type LoopOptions } from './index.js';

export class LoopOrchestrator {
  private readonly tasksDir: string;
  private readonly logsDir: string;
  private readonly gitService: LoopGitService;

  constructor(
    private readonly projectDir: string,
    private readonly opts: LoopOptions,
  ) {
    this.tasksDir = join(projectDir, 'docs', 'tasks');
    this.logsDir = join(projectDir, '.ralph-logs');
    this.gitService = new LoopGitService(projectDir);
  }

  async execute(): Promise<void> {
    const config = await readConfig(this.projectDir);

    for (
      let iteration = 1;
      this.opts.iterations === 0 || iteration <= this.opts.iterations;
      iteration++
    ) {
      const tasks = await scanTasks(this.tasksDir);
      const counts = countByStatus(tasks);

      if (allDone(tasks)) {
        console.log('All tasks are DONE');
        return;
      }

      const nextTask = findNextTask(tasks);
      if (!nextTask) {
        console.log(
          'No eligible task found (remaining tasks may be blocked or have unmet dependencies)',
        );
        return;
      }

      const scaling = scaleForComplexity(nextTask);
      const effectiveTimeout = this.opts.timeout > 0 ? this.opts.timeout : scaling.timeout;
      const effectiveMaxTurns = this.opts.maxTurns > 0 ? this.opts.maxTurns : scaling.maxTurns;

      console.log(`[Iteration ${iteration}] Starting ${nextTask.id}: ${nextTask.title}`);
      console.log(`  Progress: ${counts.DONE}/${counts.DONE + counts.TODO} tasks done`);

      const discardError = await this.gitService.discardUnstaged();
      if (discardError) {
        console.error(
          `[Iteration ${iteration}] Warning: failed to discard unstaged changes: ${discardError}`,
        );
      }

      const headBeforeResult = await this.gitService.getHeadSha();
      if (headBeforeResult.error) {
        console.error(
          `[Iteration ${iteration}] Warning: failed to get HEAD SHA before iteration: ${headBeforeResult.error}`,
        );
      }
      const headBefore = headBeforeResult.sha;

      const prompt = generateBootPrompt(nextTask, config);

      await mkdir(this.logsDir, { recursive: true });

      const now = new Date();
      const timestamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        '-',
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
      ].join('');
      const logFile = join(this.logsDir, `${nextTask.id}-${timestamp}.jsonl`);

      const child = spawnWithCapture(
        'claude',
        [
          '--print',
          '--output-format',
          'stream-json',
          '--max-turns',
          String(effectiveMaxTurns),
          '-p',
          prompt,
        ],
        { logFile, cwd: this.projectDir },
      );

      const result = await monitorProcess(child, {
        timeoutMs: effectiveTimeout * 1000,
        onOutput: this.opts.verbose ? (data: string) => process.stdout.write(data) : undefined,
      });

      if (result.timedOut) {
        console.error(`[Iteration ${iteration}] Timed out after ${effectiveTimeout}s`);
        continue;
      }

      if (result.exitCode !== 0) {
        console.error(`[Iteration ${iteration}] Claude exited with code ${result.exitCode}`);
        continue;
      }

      const headAfterResult = await this.gitService.getHeadSha();
      if (headAfterResult.error) {
        console.error(
          `[Iteration ${iteration}] Warning: failed to get HEAD SHA after iteration: ${headAfterResult.error}`,
        );
      }
      const headAfter = headAfterResult.sha;

      if (headBefore && headAfter && headBefore !== headAfter) {
        console.log(`[Iteration ${iteration}] Commit detected: ${headAfter.slice(0, 7)}`);
      }

      if (this.opts.push) {
        const pushResult = await this.gitService.pushIfNeeded();
        if (pushResult.error) {
          console.error(`[Iteration ${iteration}] Warning: failed to push: ${pushResult.error}`);
        } else if (pushResult.pushed) {
          console.log(
            `[Iteration ${iteration}] Pushed to ${pushResult.remote}/${pushResult.branch}`,
          );
        }
      }

      if (this.opts.iterations === 0 || iteration < this.opts.iterations) {
        await new Promise((r) => setTimeout(r, this.opts.delay * 1000));
      }
    }

    console.log('Loop complete');
  }
}
