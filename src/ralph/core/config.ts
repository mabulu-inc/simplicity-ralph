import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { toString } from 'mdast-util-to-string';
import { visit } from 'unist-util-visit';
import type { Root, ListItem, InlineCode } from 'mdast';

export interface ProjectConfig {
  language: string;
  fileNaming: string | undefined;
  packageManager: string;
  testingFramework: string;
  qualityCheck: string;
  testCommand: string;
  database: string | undefined;
}

const parser = unified().use(remarkParse);

function parseConfigSection(content: string): Root {
  const tree = parser.parse(content);
  const children = tree.children;

  // Find "Project-Specific Config" heading
  let startIdx = -1;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (
      child.type === 'heading' &&
      child.depth === 2 &&
      toString(child) === 'Project-Specific Config'
    ) {
      startIdx = i + 1;
      break;
    }
  }

  if (startIdx === -1) {
    throw new Error('Missing "## Project-Specific Config" section in CLAUDE.md');
  }

  // Collect nodes until next ## heading
  const sectionChildren: Root['children'] = [];
  for (let i = startIdx; i < children.length; i++) {
    const child = children[i];
    if (child.type === 'heading' && child.depth <= 2) break;
    sectionChildren.push(child);
  }

  return { type: 'root', children: sectionChildren };
}

function extractConfigField(sectionTree: Root, fieldName: string): string | undefined {
  let result: string | undefined;

  visit(sectionTree, 'listItem', (node: ListItem) => {
    if (result !== undefined) return;

    const text = toString(node);
    const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedField}:\\s*(.+)$`, 'm');
    const match = text.match(pattern);
    if (!match) return;

    // Check for inline code value
    let foundField = false;
    let codeValue: string | undefined;

    visit(node, (child) => {
      if (codeValue !== undefined) return;
      if ((child.type === 'strong' || child.type === 'emphasis') && toString(child) === fieldName) {
        foundField = true;
      }
      if (foundField && child.type === 'inlineCode') {
        codeValue = (child as InlineCode).value;
      }
    });

    result = codeValue ?? match[1].trim();
  });

  return result;
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
