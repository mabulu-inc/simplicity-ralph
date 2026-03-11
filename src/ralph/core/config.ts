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
  agent: string | undefined;
  model: string | undefined;
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
    agent: undefined,
    model: undefined,
  };
}

interface RalphConfigJsonData {
  language: string;
  packageManager: string;
  testingFramework: string;
  qualityCheck: string;
  testCommand: string;
  agent?: string;
  model?: string;
  fileNaming?: string;
  database?: string;
}

const REQUIRED_JSON_FIELDS: (keyof RalphConfigJsonData)[] = [
  'language',
  'packageManager',
  'testingFramework',
  'qualityCheck',
  'testCommand',
];

function parseConfigJson(raw: string): ProjectConfig {
  const data = JSON.parse(raw) as Record<string, unknown>;

  for (const field of REQUIRED_JSON_FIELDS) {
    if (!data[field] || typeof data[field] !== 'string') {
      throw new Error(`"${field}" is required in ralph.config.json`);
    }
  }

  const typed = data as unknown as RalphConfigJsonData;
  return {
    language: typed.language,
    fileNaming: typed.fileNaming ?? undefined,
    packageManager: typed.packageManager,
    testingFramework: typed.testingFramework,
    qualityCheck: typed.qualityCheck,
    testCommand: typed.testCommand,
    database: typed.database ?? undefined,
    agent: typed.agent ?? undefined,
    model: typed.model ?? undefined,
  };
}

export async function readConfig(projectDir: string): Promise<ProjectConfig> {
  const jsonPath = join(projectDir, 'ralph.config.json');
  try {
    const raw = await readFile(jsonPath, 'utf-8');
    return parseConfigJson(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  const mdPath = join(projectDir, '.claude', 'CLAUDE.md');
  let content: string;
  try {
    content = await readFile(mdPath, 'utf-8');
  } catch {
    throw new Error(`Cannot find ralph.config.json or .claude/CLAUDE.md in ${projectDir}`);
  }
  return parseConfig(content);
}
