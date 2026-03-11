import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';

import { generateClaudeMd, type InitConfig } from '../templates/claude-md.js';
import { generateMethodology } from '../templates/methodology.js';
import { generatePrd } from '../templates/prd.js';
import { generateTask000 } from '../templates/task-000.js';
import { defaultBootPromptTemplate } from '../templates/boot-prompt.js';

export interface InitAnswers {
  projectName: string;
  language: string;
  packageManager: string;
  testingFramework: string;
  qualityCheck: string;
  testCommand: string;
  database: string;
  fileNaming?: string;
  overwrite?: boolean;
}

export interface InitResult {
  created: string[];
  skipped: string[];
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
  overwrite: boolean,
  result: InitResult,
): Promise<void> {
  const fullPath = path.join(rootDir, relativePath);
  const dir = path.dirname(fullPath);

  await fs.mkdir(dir, { recursive: true });

  if (!overwrite) {
    try {
      await fs.access(fullPath);
      result.skipped.push(relativePath);
      return;
    } catch {
      // File doesn't exist, proceed to write
    }
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
  pkg.scripts.ralph = 'npx @simplicity/ralph loop';
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

export async function runInit(rootDir: string, answers: InitAnswers): Promise<InitResult> {
  const config = buildTemplateConfig(answers);
  const overwrite = answers.overwrite ?? false;
  const result: InitResult = { created: [], skipped: [] };

  await writeFile(rootDir, 'docs/PRD.md', generatePrd(config.projectName), overwrite, result);
  await writeFile(rootDir, 'docs/RALPH-METHODOLOGY.md', generateMethodology(), overwrite, result);
  await writeFile(rootDir, 'docs/tasks/T-000.md', generateTask000(config), overwrite, result);
  await writeFile(rootDir, '.claude/CLAUDE.md', generateClaudeMd(config), overwrite, result);
  await writeFile(rootDir, 'docs/prompts/boot.md', defaultBootPromptTemplate(), overwrite, result);

  await updatePackageJson(rootDir, answers);

  return result;
}

function prompt(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

async function promptForAnswers(): Promise<InitAnswers> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const projectName = await prompt(rl, 'Project name');
    const language = await prompt(rl, 'Language', 'TypeScript');
    const packageManager = await prompt(rl, 'Package manager', 'pnpm');
    const testingFramework = await prompt(rl, 'Test framework', 'Vitest');
    const qualityCheck = await prompt(rl, 'Check command', `${packageManager} check`);
    const testCommand = await prompt(rl, 'Test command', `${packageManager} test`);
    const database = await prompt(rl, 'Database', 'none');

    return {
      projectName,
      language,
      packageManager,
      testingFramework,
      qualityCheck,
      testCommand,
      database,
    };
  } finally {
    rl.close();
  }
}

export async function run(args: string[]): Promise<void> {
  const nonInteractive = args.includes('--non-interactive');

  let answers: InitAnswers;
  if (nonInteractive) {
    console.error('Error: --non-interactive requires pre-supplied answers');
    process.exitCode = 1;
    return;
  } else {
    console.log('Initializing a new Ralph project...\n');
    answers = await promptForAnswers();
  }

  const cwd = process.cwd();
  const result = await runInit(cwd, answers);

  console.log('');
  if (result.created.length > 0) {
    console.log('Created:');
    for (const file of result.created) {
      console.log(`  ${file}`);
    }
  }

  if (result.skipped.length > 0) {
    console.log('Skipped (already exist):');
    for (const file of result.skipped) {
      console.log(`  ${file}`);
    }
  }

  console.log('\nDone! Edit docs/PRD.md to define your requirements, then run `ralph loop`.');
}
