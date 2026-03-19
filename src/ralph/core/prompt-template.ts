import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Task } from './tasks.js';
import type { ProjectConfig } from './config.js';
import { extractPrdSections } from './prd-extractor.js';
import { generateCodebaseIndex } from './codebase-index.js';
import { defaultBootPromptTemplate } from '../templates/boot-prompt.js';
import { defaultSystemPromptTemplate } from '../templates/system-prompt.js';

export function interpolateTemplate(
  template: string,
  task: Task,
  config: ProjectConfig,
  projectRules = '',
  prdContent = '',
  codebaseIndex = '',
  retryContext = '',
  preflightBaseline = '',
): string {
  const vars: Record<string, string> = {
    'task.id': task.id,
    'task.title': task.title,
    'task.description': task.description,
    'task.prdReference': task.prdReference,
    'task.prdContent': prdContent,
    'task.touches': task.touches.length > 0 ? task.touches.join(', ') : 'not specified',
    'task.hints': task.hints,
    'config.language': config.language,
    'config.packageManager': config.packageManager,
    'config.testingFramework': config.testingFramework,
    'config.qualityCheck': config.qualityCheck,
    'config.testCommand': config.testCommand,
    'config.fileNaming': config.fileNaming ?? '',
    'config.database': config.database ?? '',
    'project.rules': projectRules,
    codebaseIndex,
    retryContext,
    preflightBaseline,
  };

  return template.replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (match, key: string) => {
    return key in vars ? vars[key] : match;
  });
}

function isDuplicateOfBuiltIn(userContent: string, builtInContent: string): boolean {
  return userContent.replace(/\s+/g, '') === builtInContent.replace(/\s+/g, '');
}

function appendExtension(base: string, extension: string): string {
  return `${base}\n\n--- Project Extensions ---\n\n${extension}`;
}

async function readExtensionFile(filePath: string, builtIn: string): Promise<string | undefined> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
  if (isDuplicateOfBuiltIn(content, builtIn)) {
    return undefined;
  }
  return content;
}

export async function loadAndInterpolate(
  projectDir: string,
  task: Task,
  config: ProjectConfig,
  retryContext = '',
  preflightBaseline = '',
): Promise<string> {
  const builtInBoot = defaultBootPromptTemplate();

  const extensionPath = join(projectDir, 'docs', 'prompts', 'boot.md');
  const extension = await readExtensionFile(extensionPath, builtInBoot);

  const template = extension ? appendExtension(builtInBoot, extension) : builtInBoot;

  let projectRules = '';
  try {
    const rulesPath = join(projectDir, 'docs', 'prompts', 'rules.md');
    const content = await readFile(rulesPath, 'utf-8');
    projectRules = content;
  } catch {
    // rules.md doesn't exist — resolve to empty string
  }

  let prdContent = '';
  if (task.prdReference) {
    try {
      const prdPath = join(projectDir, 'docs', 'PRD.md');
      const prdText = await readFile(prdPath, 'utf-8');
      prdContent = extractPrdSections(prdText, task.prdReference);
    } catch {
      // PRD.md doesn't exist — resolve to empty string
    }
  }

  const codebaseIndex = await generateCodebaseIndex(projectDir, config.language, task.touches);

  return interpolateTemplate(
    template,
    task,
    config,
    projectRules,
    prdContent,
    codebaseIndex,
    retryContext,
    preflightBaseline,
  );
}

export interface LayeredPrompt {
  systemPrompt?: string;
  userPrompt: string;
}

export async function loadLayeredPrompt(
  projectDir: string,
  task: Task,
  config: ProjectConfig,
  retryContext = '',
  preflightBaseline = '',
): Promise<LayeredPrompt> {
  const builtInSystem = defaultSystemPromptTemplate();

  const extensionPath = join(projectDir, 'docs', 'prompts', 'system.md');
  const extension = await readExtensionFile(extensionPath, builtInSystem);

  const systemPrompt = extension ? appendExtension(builtInSystem, extension) : builtInSystem;

  const userPrompt = await loadAndInterpolate(
    projectDir,
    task,
    config,
    retryContext,
    preflightBaseline,
  );

  return { systemPrompt, userPrompt };
}
