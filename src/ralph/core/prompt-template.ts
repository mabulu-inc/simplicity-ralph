import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Task } from './tasks.js';
import type { ProjectConfig } from './config.js';

export function interpolateTemplate(
  template: string,
  task: Task,
  config: ProjectConfig,
  projectRules = '',
): string {
  const vars: Record<string, string> = {
    'task.id': task.id,
    'task.title': task.title,
    'task.description': task.description,
    'task.prdReference': task.prdReference,
    'config.language': config.language,
    'config.packageManager': config.packageManager,
    'config.testingFramework': config.testingFramework,
    'config.qualityCheck': config.qualityCheck,
    'config.testCommand': config.testCommand,
    'config.fileNaming': config.fileNaming ?? '',
    'config.database': config.database ?? '',
    'project.rules': projectRules,
  };

  return template.replace(/\{\{(\w+\.\w+)\}\}/g, (match, key: string) => {
    return key in vars ? vars[key] : match;
  });
}

export async function loadAndInterpolate(
  projectDir: string,
  task: Task,
  config: ProjectConfig,
): Promise<string> {
  const templatePath = join(projectDir, 'docs', 'prompts', 'boot.md');
  let template: string;
  try {
    template = await readFile(templatePath, 'utf-8');
  } catch {
    throw new Error(
      `Boot prompt template not found at docs/prompts/boot.md. Run 'ralph init' to create it.`,
    );
  }

  let projectRules = '';
  try {
    const rulesPath = join(projectDir, 'docs', 'prompts', 'rules.md');
    const content = await readFile(rulesPath, 'utf-8');
    projectRules = content;
  } catch {
    // rules.md doesn't exist — resolve to empty string
  }

  return interpolateTemplate(template, task, config, projectRules);
}
