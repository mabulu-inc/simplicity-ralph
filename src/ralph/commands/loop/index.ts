import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { readConfig } from '../../core/config.js';
import { scanTasks, findNextTask, type Task } from '../../core/tasks.js';
import { computeTaskComplexity, type ComplexityTier } from '../../core/complexity.js';
import { getTierScaling } from '../../core/defaults.js';
import { LoopOrchestrator } from './orchestrator.js';

export { LoopGitService } from './git-service.js';
export { LoopOrchestrator } from './orchestrator.js';

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

export function scaleForComplexity(task: Task): ScalingResult {
  const tier = computeTaskComplexity(task);
  const tierScaling = getTierScaling();
  return { tier, ...tierScaling[tier] };
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

  try {
    await access(join(projectDir, 'docs', 'prompts', 'boot.md'));
  } catch {
    errors.push('docs/prompts/boot.md not found');
  }

  return { ok: errors.length === 0, errors };
}

function formatDryRunConfig(
  opts: LoopOptions,
  config: {
    language: string;
    packageManager: string;
    testingFramework: string;
    qualityCheck: string;
    testCommand: string;
  },
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

  let config;
  try {
    config = await readConfig(projectDir);
  } catch (err) {
    console.error(`Failed to read config: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (opts.dryRun) {
    const tasksDir = join(projectDir, 'docs', 'tasks');
    const tasks = await scanTasks(tasksDir);
    const nextTask = findNextTask(tasks);
    const scaling = nextTask
      ? scaleForComplexity(nextTask)
      : { tier: 'light' as ComplexityTier, maxTurns: 50, timeout: 600 };
    console.log(formatDryRunConfig(opts, config, scaling));
    return;
  }

  const orchestrator = new LoopOrchestrator(projectDir, opts);
  await orchestrator.execute();
}
