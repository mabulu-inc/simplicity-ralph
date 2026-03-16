import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scanTasks, findNextTask, allDone, countByStatus } from '../../core/tasks.js';
import { readConfig } from '../../core/config.js';
import { getProvider, type AgentProvider } from '../../core/agent-provider.js';
import { ensureProvidersRegistered } from '../../providers/index.js';
import { spawnWithCapture, monitorProcess } from '../../core/process.js';
import { writePidFile, removePidFile } from '../../core/pid-file.js';
import { loadLayeredPrompt } from '../../core/prompt-template.js';
import { buildRetryContext, extractBlockedSignal } from '../../core/retry-context.js';
import {
  runPreflightCheck,
  formatPreflightBaseline,
  buildPreflightLogEntry,
} from '../../core/preflight.js';
import { updateField } from '../../core/markdown.js';
import { parseSessionResult } from '../../core/jsonl-result.js';
import { calculateTaskCost, calculateLogFileCost } from '../../core/cost-tracker.js';
import { run as runShas } from '../shas.js';
import { run as runCost } from '../cost.js';
import { run as runMilestones } from '../milestones.js';
import { LoopGitService } from './git-service.js';
import { scaleForComplexity, type LoopOptions } from './index.js';

export class LoopOrchestrator {
  private readonly tasksDir: string;
  private readonly logsDir: string;
  private readonly gitService: LoopGitService;
  private readonly provider: AgentProvider;

  constructor(
    private readonly projectDir: string,
    private readonly opts: LoopOptions,
  ) {
    this.tasksDir = join(projectDir, 'docs', 'tasks');
    this.logsDir = join(projectDir, '.ralph-logs');
    this.gitService = new LoopGitService(projectDir);
    ensureProvidersRegistered();
    this.provider = getProvider(opts.agent);
  }

  async execute(): Promise<void> {
    const config = await readConfig(this.projectDir);
    const pidPath = join(this.logsDir, 'ralph.pid');

    await mkdir(this.logsDir, { recursive: true });
    await writePidFile(pidPath, process.pid);

    let preflightBaseline = '';
    try {
      const preflightResult = await runPreflightCheck(config.qualityCheck, {
        cwd: this.projectDir,
      });
      const logEntry = buildPreflightLogEntry(preflightResult);
      await appendFile(join(this.logsDir, 'preflight.jsonl'), logEntry + '\n');

      if (preflightResult.timedOut) {
        console.log('Preflight: timed out — proceeding without baseline');
      } else if (preflightResult.passed) {
        console.log('Preflight: passed clean');
      } else if (this.opts.allowDirty) {
        console.log('Preflight: pre-existing failures detected');
        preflightBaseline = formatPreflightBaseline(preflightResult);
      } else {
        console.error(`Preflight: quality check failed — aborting loop\n${preflightResult.output}`);
        process.exitCode = 1;
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Preflight: failed to run — ${msg}`);
    }

    try {
      await this.executeLoop(config, preflightBaseline);
    } finally {
      await removePidFile(pidPath);
    }
  }

  private async writeLoopStartSnapshot(): Promise<void> {
    const tasks = await scanTasks(this.tasksDir);
    const counts = countByStatus(tasks);
    const snapshot = {
      doneAtStart: counts.DONE,
      total: counts.DONE + counts.TODO,
      startedAt: new Date().toISOString(),
    };
    await writeFile(join(this.logsDir, 'loop-start.json'), JSON.stringify(snapshot));
  }

  private async executeLoop(
    config: Awaited<ReturnType<typeof readConfig>>,
    preflightBaseline = '',
  ): Promise<void> {
    await this.writeLoopStartSnapshot();

    let lastFailedTaskId: string | undefined;
    let loopSpend = 0;

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

      const attempts = await this.countTaskAttempts(nextTask.id);
      if (attempts >= config.maxRetries) {
        const reason = `Failed ${attempts} times — exceeded max retries (${config.maxRetries})`;
        await this.markTaskBlocked(nextTask.id, reason);
        console.log(
          `[Iteration ${iteration}] ${nextTask.id} BLOCKED after ${attempts} failures (max ${config.maxRetries})`,
        );
        continue;
      }

      const taskCost = await calculateTaskCost(this.logsDir, nextTask.id);
      if (taskCost >= config.maxCostPerTask) {
        const reason = `cost limit exceeded ($${taskCost.toFixed(2)} >= $${config.maxCostPerTask.toFixed(2)})`;
        await this.markTaskBlocked(nextTask.id, reason);
        console.log(`[Iteration ${iteration}] ${nextTask.id} BLOCKED: ${reason}`);
        continue;
      }

      const scaling = scaleForComplexity(nextTask);
      const effectiveTimeout = this.opts.timeout > 0 ? this.opts.timeout : scaling.timeout;
      const effectiveMaxTurns = this.opts.maxTurns > 0 ? this.opts.maxTurns : scaling.maxTurns;

      console.log(`[Iteration ${iteration}] Starting ${nextTask.id}: ${nextTask.title}`);
      console.log(`  Progress: ${counts.DONE}/${counts.DONE + counts.TODO} tasks done`);
      console.log(
        `  Complexity: ${scaling.tier} [${scaling.source}] (${effectiveMaxTurns} turns, ${effectiveTimeout}s timeout)`,
      );

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

      let retryContext = '';
      if (lastFailedTaskId === nextTask.id) {
        retryContext = await buildRetryContext(this.logsDir, nextTask.id);
      }

      const layered = await loadLayeredPrompt(
        this.projectDir,
        nextTask,
        config,
        retryContext,
        preflightBaseline,
      );

      let prompt: string;
      let systemPromptForArgs: string | undefined;

      if (this.provider.supportsSystemPrompt && layered.systemPrompt) {
        prompt = layered.userPrompt;
        systemPromptForArgs = layered.systemPrompt;
      } else if (layered.systemPrompt) {
        prompt = layered.systemPrompt + '\n\n' + layered.userPrompt;
      } else {
        prompt = layered.userPrompt;
      }

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

      const buildArgsOptions: {
        outputFormat: string[];
        maxTurns?: number;
        model?: string;
        systemPrompt?: string;
      } = {
        outputFormat: this.provider.outputFormat,
      };

      if (this.provider.supportsMaxTurns) {
        buildArgsOptions.maxTurns = effectiveMaxTurns;
      }

      if (systemPromptForArgs) {
        buildArgsOptions.systemPrompt = systemPromptForArgs;
      }

      const agentArgs = this.provider.buildArgs(prompt, buildArgsOptions);

      const child = spawnWithCapture(this.provider.binary, agentArgs, {
        logFile,
        cwd: this.projectDir,
      });

      const result = await monitorProcess(child, {
        timeoutMs: effectiveTimeout * 1000,
        onOutput: this.opts.verbose ? (data: string) => process.stdout.write(data) : undefined,
      });

      const iterationCost = await calculateLogFileCost(logFile);
      loopSpend += iterationCost;

      if (loopSpend >= config.maxLoopBudget) {
        console.log(
          `[Iteration ${iteration}] loop budget exceeded ($${loopSpend.toFixed(2)} >= $${config.maxLoopBudget.toFixed(2)}) — stopping`,
        );
        return;
      }

      if (result.timedOut) {
        console.error(`[Iteration ${iteration}] Timed out after ${effectiveTimeout}s`);
        lastFailedTaskId = nextTask.id;
        continue;
      }

      const blockedReason = await this.checkBlockedSignal(logFile);
      if (blockedReason) {
        await this.markTaskBlocked(nextTask.id, blockedReason);
        console.log(`[Iteration ${iteration}] ${nextTask.id} BLOCKED by agent: ${blockedReason}`);
        lastFailedTaskId = nextTask.id;
        continue;
      }

      if (result.exitCode !== 0) {
        const sessionResult = await parseSessionResult(logFile);
        if (sessionResult?.subtype === 'error_max_turns') {
          const turns = sessionResult.numTurns ?? effectiveMaxTurns;
          console.error(
            `[Iteration ${iteration}] ${nextTask.id} exhausted all ${turns} turns (${scaling.tier} tier) without completing. Consider increasing --max-turns or splitting the task.`,
          );
        } else {
          console.error(`[Iteration ${iteration}] Claude exited with code ${result.exitCode}`);
        }
        lastFailedTaskId = nextTask.id;
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
        const sessionResult = await parseSessionResult(logFile);
        const turnsInfo =
          sessionResult?.numTurns !== undefined
            ? ` (used ${sessionResult.numTurns}/${effectiveMaxTurns} turns)`
            : '';
        console.log(
          `[Iteration ${iteration}] Commit detected: ${headAfter.slice(0, 7)}${turnsInfo}`,
        );
        lastFailedTaskId = undefined;

        await this.postIterationUpdates(iteration);
      } else {
        lastFailedTaskId = nextTask.id;
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

  private async checkBlockedSignal(logFile: string): Promise<string | null> {
    try {
      const content = await readFile(logFile, 'utf-8');
      return extractBlockedSignal(content);
    } catch {
      return null;
    }
  }

  private async countTaskAttempts(taskId: string): Promise<number> {
    try {
      const entries = await readdir(this.logsDir);
      const prefix = `${taskId}-`;
      return entries.filter((f) => f.startsWith(prefix) && f.endsWith('.jsonl')).length;
    } catch {
      return 0;
    }
  }

  private async markTaskBlocked(taskId: string, reason: string): Promise<void> {
    const filePath = join(this.tasksDir, `${taskId}.md`);
    let content = await readFile(filePath, 'utf-8');
    content = updateField(content, 'Status', 'BLOCKED');
    content = updateField(content, 'Blocked reason', reason, ['Status']);
    await writeFile(filePath, content);
  }

  private async postIterationUpdates(iteration: number): Promise<void> {
    const updates = [
      { name: 'shas', fn: () => runShas([], this.projectDir) },
      { name: 'cost', fn: () => runCost(['--update-tasks'], this.projectDir) },
      { name: 'milestones', fn: () => runMilestones([], this.projectDir) },
    ];

    for (const update of updates) {
      try {
        await update.fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[Iteration ${iteration}] Warning: post-iteration ${update.name} failed: ${msg}`,
        );
      }
    }

    const commitResult = await this.gitService.commitMetadata(
      ['docs/tasks', 'docs/MILESTONES.md'],
      'Update task metadata',
    );
    if (commitResult.sha) {
      console.log(`[Iteration ${iteration}] Metadata commit: ${commitResult.sha.slice(0, 7)}`);
    } else if (commitResult.skipped) {
      console.log(`[Iteration ${iteration}] Metadata: no changes to commit`);
    } else if (commitResult.error) {
      console.error(
        `[Iteration ${iteration}] Warning: metadata commit failed: ${commitResult.error}`,
      );
    }
  }
}
