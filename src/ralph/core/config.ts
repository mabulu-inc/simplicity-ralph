import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Root } from 'mdast';
import { parseMarkdown, findSection, extractFieldFromAst } from './markdown.js';

export interface ProjectConfig {
  language: string;
  fileNaming: string | undefined;
  packageManager: string;
  testingFramework: string;
  qualityCheck: string;
  testCommand: string;
  database: string | undefined;
}

function parseConfigSection(content: string): Root {
  const tree = parseMarkdown(content);
  const sectionChildren = findSection(tree, 'Project-Specific Config');

  if (sectionChildren.length === 0) {
    throw new Error('Missing "## Project-Specific Config" section in CLAUDE.md');
  }

  return { type: 'root', children: sectionChildren };
}

function extractConfigField(sectionTree: Root, fieldName: string): string | undefined {
  return extractFieldFromAst(sectionTree, fieldName, { preferInlineCode: true });
}

function requireField(sectionTree: Root, field: string, label: string): string {
  const value = extractConfigField(sectionTree, field);
  if (!value) {
    throw new Error(`${label} is required in Project-Specific Config`);
  }
  return value;
}

export function parseConfig(content: string): ProjectConfig {
  const sectionTree = parseConfigSection(content);

  return {
    language: requireField(sectionTree, 'Language', 'Language'),
    fileNaming: extractConfigField(sectionTree, 'File naming'),
    packageManager: requireField(sectionTree, 'Package manager', 'Package manager'),
    testingFramework: requireField(sectionTree, 'Testing framework', 'Testing framework'),
    qualityCheck: requireField(sectionTree, 'Quality check', 'Quality check'),
    testCommand: requireField(sectionTree, 'Test command', 'Test command'),
    database: extractConfigField(sectionTree, 'Database'),
  };
}

export async function readConfig(projectDir: string): Promise<ProjectConfig> {
  const configPath = join(projectDir, '.claude', 'CLAUDE.md');
  let content: string;
  try {
    content = await readFile(configPath, 'utf-8');
  } catch {
    throw new Error(`Cannot read CLAUDE.md at ${configPath}`);
  }
  return parseConfig(content);
}
