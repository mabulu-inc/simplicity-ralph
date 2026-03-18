import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';

import { generateClaudeMd, type InitConfig } from '../templates/claude-md.js';
import { generateAgentsMd } from '../templates/agents-md.js';
import { generateContinueYaml } from '../templates/continue-yaml.js';
import { generateCursorRules } from '../templates/cursor-rules.js';
import { generateGeminiMd } from '../templates/gemini-md.js';
import { generateMethodology } from '../templates/methodology.js';
import { generatePrd } from '../templates/prd.js';
import { generateTask000 } from '../templates/task-000.js';
import { defaultBootPromptTemplate } from '../templates/boot-prompt.js';
import { defaultSystemPromptTemplate } from '../templates/system-prompt.js';
import { generateRules } from '../templates/rules-md.js';
import { generateRalphConfigJson } from '../templates/ralph-config-json.js';
import { generatePromptsReadme } from '../templates/prompts-readme.js';

export interface InitAnswers {
  projectName: string;
  language: string;
  packageManager: string;
  testingFramework: string;
  qualityCheck: string;
  testCommand: string;
  database: string;
  fileNaming?: string;
  agent?: string;
  model?: string;
  maxRetries?: number;
  maxCostPerTask?: number;
  maxLoopBudget?: number;
}

export type OnConflict = (relativePath: string) => Promise<boolean>;

export interface InitOptions {
  onConflict?: OnConflict;
  promptsOnly?: boolean;
}

export interface InitResult {
  created: string[];
  skipped: string[];
  overwritten: string[];
}

function isNodeLanguage(language: string): boolean {
  const lower = language.toLowerCase();
  return lower.includes('typescript') || lower.includes('javascript');
}

function buildTemplateConfig(answers: InitAnswers): InitConfig {
  const config: InitConfig = {
    projectName: answers.projectName,
    language: answers.language,
    packageManager: answers.packageManager,
    testingFramework: answers.testingFramework,
    qualityCheck: answers.qualityCheck,
    testCommand: answers.testCommand,
  };

  if (answers.fileNaming) {
    config.fileNaming = answers.fileNaming;
  }

  if (answers.database && answers.database !== 'none') {
    config.database = answers.database;
  }

  return config;
}

async function writeFile(
  rootDir: string,
  relativePath: string,
  content: string,
  onConflict: OnConflict | undefined,
  result: InitResult,
): Promise<void> {
  const fullPath = path.join(rootDir, relativePath);
  const dir = path.dirname(fullPath);

  await fs.mkdir(dir, { recursive: true });

  let existing: string | undefined;
  try {
    existing = await fs.readFile(fullPath, 'utf-8');
  } catch {
    // File doesn't exist, proceed to create
  }

  if (existing !== undefined) {
    if (existing === content) {
      result.skipped.push(relativePath);
      return;
    }

    if (onConflict) {
      const shouldOverwrite = await onConflict(relativePath);
      if (shouldOverwrite) {
        await fs.writeFile(fullPath, content);
        result.overwritten.push(relativePath);
        return;
      }
    }

    result.skipped.push(relativePath);
    return;
  }

  await fs.writeFile(fullPath, content);
  result.created.push(relativePath);
}

async function updatePackageJson(rootDir: string, answers: InitAnswers): Promise<void> {
  if (!isNodeLanguage(answers.language)) return;

  const pkgPath = path.join(rootDir, 'package.json');
  try {
    await fs.access(pkgPath);
  } catch {
    return;
  }

  const raw = await fs.readFile(pkgPath, 'utf-8');
  const pkg = JSON.parse(raw);
  pkg.scripts = pkg.scripts || {};
  pkg.scripts.ralph = 'npx @smplcty/ralph loop';
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

export async function loadExistingDefaults(rootDir: string): Promise<Partial<InitAnswers>> {
  const defaults: Partial<InitAnswers> = {};

  // Try to get projectName from package.json, then fall back to directory name
  const pkgPath = path.join(rootDir, 'package.json');
  try {
    const raw = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);
    if (pkg.name && typeof pkg.name === 'string') {
      defaults.projectName = pkg.name;
    }
  } catch {
    // No package.json — fall back to directory name
  }

  if (!defaults.projectName) {
    defaults.projectName = path.basename(rootDir);
  }

  // Load config values from ralph.config.json
  const configPath = path.join(rootDir, 'ralph.config.json');
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;

    const stringFields: (keyof InitAnswers)[] = [
      'language',
      'packageManager',
      'testingFramework',
      'qualityCheck',
      'testCommand',
      'agent',
      'model',
      'fileNaming',
      'database',
    ];

    for (const field of stringFields) {
      if (typeof config[field] === 'string') {
        (defaults as Record<string, unknown>)[field] = config[field];
      }
    }

    if (typeof config['maxRetries'] === 'number') {
      defaults.maxRetries = config['maxRetries'] as number;
    }
    if (typeof config['maxCostPerTask'] === 'number') {
      defaults.maxCostPerTask = config['maxCostPerTask'] as number;
    }
    if (typeof config['maxLoopBudget'] === 'number') {
      defaults.maxLoopBudget = config['maxLoopBudget'] as number;
    }
  } catch {
    // No ralph.config.json
  }

  return defaults;
}

export async function runInit(
  rootDir: string,
  answers: InitAnswers,
  options?: InitOptions,
): Promise<InitResult> {
  const config = buildTemplateConfig(answers);
  const onConflict = options?.onConflict;
  const promptsOnly = options?.promptsOnly ?? false;
  const result: InitResult = { created: [], skipped: [], overwritten: [] };

  if (!promptsOnly) {
    await writeFile(rootDir, 'docs/PRD.md', generatePrd(config.projectName), onConflict, result);
    await writeFile(
      rootDir,
      'docs/RALPH-METHODOLOGY.md',
      generateMethodology(),
      onConflict,
      result,
    );
    await writeFile(rootDir, 'docs/tasks/T-000.md', generateTask000(config), onConflict, result);
    const agent = answers.agent ?? 'claude';
    if (agent === 'gemini') {
      await writeFile(rootDir, 'GEMINI.md', generateGeminiMd(config), onConflict, result);
    } else if (agent === 'codex') {
      await writeFile(rootDir, 'AGENTS.md', generateAgentsMd(config), onConflict, result);
    } else if (agent === 'continue') {
      await writeFile(
        rootDir,
        '.continue/config.yaml',
        generateContinueYaml(config),
        onConflict,
        result,
      );
    } else if (agent === 'cursor') {
      await writeFile(
        rootDir,
        '.cursor/rules/ralph.md',
        generateCursorRules(config),
        onConflict,
        result,
      );
    } else {
      await writeFile(rootDir, '.claude/CLAUDE.md', generateClaudeMd(config), onConflict, result);
    }
  }

  await writeFile(rootDir, 'docs/prompts/boot.md', defaultBootPromptTemplate(), onConflict, result);
  await writeFile(
    rootDir,
    'docs/prompts/system.md',
    defaultSystemPromptTemplate(),
    onConflict,
    result,
  );
  await writeFile(rootDir, 'docs/prompts/rules.md', generateRules(config), onConflict, result);
  await writeFile(rootDir, 'docs/prompts/README.md', generatePromptsReadme(), onConflict, result);

  if (!promptsOnly) {
    await writeFile(
      rootDir,
      'ralph.config.json',
      generateRalphConfigJson(
        config,
        answers.agent ?? 'claude',
        answers.model,
        answers.maxRetries,
        answers.maxCostPerTask,
        answers.maxLoopBudget,
      ),
      onConflict,
      result,
    );

    await updatePackageJson(rootDir, answers);
  }

  return result;
}

export function prompt(
  rl: readline.Interface,
  question: string,
  defaultValue?: string,
  options?: string[],
): Promise<string> {
  let text = question;
  if (options && options.length > 0) {
    text += ` (${options.join(', ')})`;
  }
  if (defaultValue) {
    text += ` [${defaultValue}]`;
  }
  text += ': ';
  return new Promise((resolve) => {
    rl.question(text, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function promptYesNo(rl: readline.Interface, question: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(`${question} (y/N): `, (answer) => {
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

async function promptForAnswers(defaults: Partial<InitAnswers>): Promise<InitAnswers> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const projectName = await prompt(rl, 'Project name', defaults.projectName);
    const language = await prompt(rl, 'Language', defaults.language ?? 'TypeScript');
    const fileNaming = await prompt(
      rl,
      'File naming convention',
      defaults.fileNaming || 'kebab-case',
      ['kebab-case', 'snake_case', 'camelCase'],
    );
    const packageManager = await prompt(rl, 'Package manager', defaults.packageManager ?? 'pnpm');
    const testingFramework = await prompt(
      rl,
      'Test framework',
      defaults.testingFramework ?? 'Vitest',
    );
    const qualityCheck = await prompt(
      rl,
      'Check command',
      defaults.qualityCheck ?? `${packageManager} check`,
    );
    const testCommand = await prompt(
      rl,
      'Test command',
      defaults.testCommand ?? `${packageManager} test`,
    );
    const database = await prompt(rl, 'Database', defaults.database ?? 'none', [
      'PostgreSQL',
      'MySQL',
      'SQLite',
      'none',
    ]);
    const agent = await prompt(
      rl,
      'AI agent (claude, gemini, codex, continue, cursor)',
      defaults.agent ?? 'claude',
    );
    const model = await prompt(rl, 'Model (optional)', defaults.model ?? '');
    const maxRetriesStr = await prompt(
      rl,
      'Max retries per task before BLOCKED',
      String(defaults.maxRetries ?? 3),
    );
    const maxRetries = parseInt(maxRetriesStr, 10) || 3;
    const maxCostPerTaskStr = await prompt(
      rl,
      'Max cost per task in USD',
      String(defaults.maxCostPerTask ?? 10),
    );
    const maxCostPerTask = parseFloat(maxCostPerTaskStr) || 10;
    const maxLoopBudgetStr = await prompt(
      rl,
      'Max loop budget in USD',
      String(defaults.maxLoopBudget ?? 100),
    );
    const maxLoopBudget = parseFloat(maxLoopBudgetStr) || 100;

    return {
      projectName,
      language,
      fileNaming: fileNaming || undefined,
      packageManager,
      testingFramework,
      qualityCheck,
      testCommand,
      database,
      agent: agent || 'claude',
      model: model || undefined,
      maxRetries,
      maxCostPerTask,
      maxLoopBudget,
    };
  } finally {
    rl.close();
  }
}

export async function run(args: string[]): Promise<void> {
  const promptsOnly = args.includes('--prompts-only');
  const nonInteractive = args.includes('--non-interactive');

  let answers: InitAnswers;
  if (nonInteractive) {
    console.error('Error: --non-interactive requires pre-supplied answers');
    process.exitCode = 1;
    return;
  } else {
    console.log('Initializing a new Ralph project...\n');
    const cwd = process.cwd();
    const defaults = await loadExistingDefaults(cwd);
    answers = await promptForAnswers(defaults);
  }

  const cwd = process.cwd();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const onConflict: OnConflict = async (relativePath: string) => {
    const shouldOverwrite = await promptYesNo(rl, `File ${relativePath} has changed. Overwrite?`);
    return shouldOverwrite;
  };

  const result = await runInit(cwd, answers, { onConflict, promptsOnly });

  rl.close();

  console.log('');
  if (result.created.length > 0) {
    console.log('Created:');
    for (const file of result.created) {
      console.log(`  ${file}`);
    }
  }

  if (result.overwritten.length > 0) {
    console.log('Overwritten:');
    for (const file of result.overwritten) {
      console.log(`  ${file}`);
    }
  }

  if (result.skipped.length > 0) {
    console.log('Skipped (unchanged):');
    for (const file of result.skipped) {
      console.log(`  ${file}`);
    }
  }

  console.log('\nDone! Edit docs/PRD.md to define your requirements, then run `ralph loop`.');
}
