import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { scanTasks, findNextTask, allDone, countByStatus, type Task } from '../core/tasks.js';
import { readConfig, type ProjectConfig } from '../core/config.js';
import { discardUnstaged, getHeadSha, hasUnpushedCommits, pushToRemote } from '../core/git.js';
import { spawnWithCapture, monitorProcess } from '../core/process.js';
import { computeTaskComplexity, type ComplexityTier } from '../core/complexity.js';

export interface LoopOptions {
  iterations: number;
  delay: number;
  timeout: number;
  maxTurns: number;
  verbose: boolean;
  dryRun: boolean;
  push: boolean;
  db: boolean;
}

export interface PreflightResult {
  ok: boolean;
  errors: string[];
}

export interface ScalingResult {
  tier: ComplexityTier;
  maxTurns: number;
  timeout: number;
}

const TIER_SCALING: Record<ComplexityTier, { maxTurns: number; timeout: number }> = {
  light: { maxTurns: 50, timeout: 600 },
  standard: { maxTurns: 75, timeout: 900 },
  heavy: { maxTurns: 125, timeout: 1200 },
};

export function scaleForComplexity(task: Task): ScalingResult {
  const tier = computeTaskComplexity(task);
  return { tier, ...TIER_SCALING[tier] };
}

export function parseLoopOptions(args: string[]): LoopOptions {
  const opts: LoopOptions = {
    iterations: 10,
    delay: 2,
    timeout: 0,
    maxTurns: 0,
    verbose: false,
    dryRun: false,
    push: true,
    db: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '-n':
      case '--iterations':
        opts.iterations = parseInt(args[++i], 10);
        break;
      case '-d':
      case '--delay':
        opts.delay = parseInt(args[++i], 10);
        break;
      case '-t':
      case '--timeout':
        opts.timeout = parseInt(args[++i], 10);
        break;
      case '-m':
      case '--max-turns':
        opts.maxTurns = parseInt(args[++i], 10);
        break;
      case '-v':
      case '--verbose':
        opts.verbose = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--no-push':
        opts.push = false;
        break;
      case '--no-db':
        opts.db = false;
        break;
    }
  }

  return opts;
}

export async function preflightChecks(projectDir: string): Promise<PreflightResult> {
  const errors: string[] = [];

  try {
    await access(join(projectDir, 'docs', 'tasks'));
  } catch {
    errors.push('docs/tasks/ directory not found');
  }

  return { ok: errors.length === 0, errors };
}

export function generateBootPrompt(task: Task, config: ProjectConfig): string {
  return `You are in Ralph Loop iteration. Follow the Ralph Methodology.

PHASE LOGGING (MANDATORY): Before starting each phase, output a marker line EXACTLY like this:
  [PHASE] Entering: <phase name>
The phases in order are:
  1. Boot — reading task files, PRD, and existing code to understand the task
  2. Red — writing failing tests
  3. Green — implementing the minimum code to pass tests
  4. Verify — running ${config.qualityCheck} (lint, format, typecheck, build, test:coverage)
  5. Commit — staging files and committing

CURRENT TASK: ${task.id}: ${task.title}
PRD Reference: ${task.prdReference}
Description: ${task.description}

PROJECT CONFIG:
- Language: ${config.language}
- Package manager: ${config.packageManager}
- Testing framework: ${config.testingFramework}
- quality check: ${config.qualityCheck}
- Test command: ${config.testCommand}${config.fileNaming ? `\n- File naming: ${config.fileNaming}` : ''}${config.database ? `\n- Database: ${config.database}` : ''}

WORKFLOW:
1. BOOT: Read the task file and PRD sections it references. Understand the codebase.
2. EXECUTE: Implement using strict red/green TDD — write failing tests FIRST, then implement the minimum to pass. Run '${config.qualityCheck}' after each layer — do NOT wait until the end.
3. Quality gates (mandatory before commit):
   - Every line of production code must be exercised by a test. No untested code.
   - No code smells: no dead code, no commented-out blocks, no TODO/FIXME/HACK, no duplication.
   - No security vulnerabilities.
   - Run '${config.qualityCheck}' — must pass clean.
4. COMMIT: ONE commit per task. Message format 'T-NNN: description' (e.g. '${task.id}: ...').
   The task file update (Status→DONE, Completed timestamp, Commit SHA, Completion Notes) MUST be in the same commit as the code — never a separate commit.
5. TOOL USAGE (STRICT):
   - Read files: ALWAYS use the Read tool. NEVER use cat, head, tail, or sed to read files.
   - Search code: ALWAYS use Grep or Glob tools. NEVER use grep, find, or ls in Bash.
   - The ONLY acceptable Bash uses are: git, ${config.packageManager}, docker, and commands with no dedicated tool.
6. BASH TIMEOUTS: When running test/build commands via Bash, set timeout to at least 120000ms (120 seconds). TypeScript compilation and test suites need time. Never use 30000ms or less for test/build commands.
7. Do NOT push to origin — the loop handles that.
8. Complete ONE task, then STOP. Do not start a second task.`;
}

function formatDryRunConfig(
  opts: LoopOptions,
  config: ProjectConfig,
  scaling: ScalingResult,
): string {
  const effectiveTimeout = opts.timeout > 0 ? opts.timeout : scaling.timeout;
  const effectiveMaxTurns = opts.maxTurns > 0 ? opts.maxTurns : scaling.maxTurns;
  const lines = [
    'Loop configuration (dry-run):',
    `  iterations: ${opts.iterations === 0 ? 'unlimited' : opts.iterations}`,
    `  delay: ${opts.delay}s`,
    `  timeout: ${effectiveTimeout}s${opts.timeout === 0 ? ' (auto)' : ''}`,
    `  max turns: ${effectiveMaxTurns}${opts.maxTurns === 0 ? ' (auto)' : ''}`,
    `  complexity tier: ${scaling.tier}`,
    `  verbose: ${opts.verbose}`,
    `  push: ${opts.push}`,
    `  db: ${opts.db}`,
    '',
    'Project config:',
    `  language: ${config.language}`,
    `  package manager: ${config.packageManager}`,
    `  testing framework: ${config.testingFramework}`,
    `  quality check: ${config.qualityCheck}`,
    `  test command: ${config.testCommand}`,
  ];
  return lines.join('\n');
}

export async function run(args: string[], cwd?: string): Promise<void> {
  const opts = parseLoopOptions(args);
  const projectDir = cwd ?? process.cwd();

  const preflight = await preflightChecks(projectDir);
  if (!preflight.ok) {
    console.error(
      `Pre-flight checks failed:\n${preflight.errors.map((e) => `  - ${e}`).join('\n')}`,
    );
    return;
  }

  let config: ProjectConfig;
  try {
    config = await readConfig(projectDir);
  } catch (err) {
    console.error(`Failed to read config: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const tasksDir = join(projectDir, 'docs', 'tasks');

  if (opts.dryRun) {
    const tasks = await scanTasks(tasksDir);
    const nextTask = findNextTask(tasks);
    const scaling = nextTask
      ? scaleForComplexity(nextTask)
      : { tier: 'light' as ComplexityTier, maxTurns: 50, timeout: 600 };
    console.log(formatDryRunConfig(opts, config, scaling));
    return;
  }

  const logsDir = join(projectDir, '.ralph-logs');

  for (let iteration = 1; opts.iterations === 0 || iteration <= opts.iterations; iteration++) {
    const tasks = await scanTasks(tasksDir);
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
    const effectiveTimeout = opts.timeout > 0 ? opts.timeout : scaling.timeout;
    const effectiveMaxTurns = opts.maxTurns > 0 ? opts.maxTurns : scaling.maxTurns;

    console.log(`[Iteration ${iteration}] Starting ${nextTask.id}: ${nextTask.title}`);
    console.log(`  Progress: ${counts.DONE}/${counts.DONE + counts.TODO} tasks done`);

    try {
      await discardUnstaged(projectDir);
    } catch {
      // May fail if working tree is clean or not a git repo
    }

    let headBefore: string | undefined;
    try {
      headBefore = await getHeadSha(projectDir);
    } catch {
      // not a git repo
    }

    const prompt = generateBootPrompt(nextTask, config);

    await mkdir(logsDir, { recursive: true });

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
    const logFile = join(logsDir, `${nextTask.id}-${timestamp}.jsonl`);

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
      { logFile, cwd: projectDir },
    );

    const result = await monitorProcess(child, {
      timeoutMs: effectiveTimeout * 1000,
      onOutput: opts.verbose ? (data: string) => process.stdout.write(data) : undefined,
    });

    if (result.timedOut) {
      console.error(`[Iteration ${iteration}] Timed out after ${effectiveTimeout}s`);
      continue;
    }

    if (result.exitCode !== 0) {
      console.error(`[Iteration ${iteration}] Claude exited with code ${result.exitCode}`);
      continue;
    }

    let headAfter: string | undefined;
    try {
      headAfter = await getHeadSha(projectDir);
    } catch {
      // not a git repo
    }

    if (headBefore && headAfter && headBefore !== headAfter) {
      console.log(`[Iteration ${iteration}] Commit detected: ${headAfter.slice(0, 7)}`);
    }

    if (opts.push) {
      try {
        const unpushed = await hasUnpushedCommits(projectDir, 'origin', 'main');
        if (unpushed) {
          await pushToRemote(projectDir, 'origin', 'main');
          console.log(`[Iteration ${iteration}] Pushed to origin/main`);
        }
      } catch {
        // push may fail
      }
    }

    if (opts.iterations === 0 || iteration < opts.iterations) {
      await new Promise((r) => setTimeout(r, opts.delay * 1000));
    }
  }

  console.log('Loop complete');
}
