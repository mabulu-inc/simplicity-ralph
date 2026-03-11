import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';
import type { Root, Heading, List, ListItem, InlineCode } from 'mdast';

const parser = unified().use(remarkParse);

function parseMarkdown(content: string): Root {
  return parser.parse(content);
}

export interface ExtractFieldOptions {
  preferInlineCode?: boolean;
}

export function extractFieldFromAst(
  tree: Root,
  fieldName: string,
  options?: ExtractFieldOptions,
): string | undefined {
  let result: string | undefined;

  visit(tree, 'listItem', (node: ListItem) => {
    if (result !== undefined) return;

    const text = toString(node);
    const fieldPattern = new RegExp(`^${escapeRegex(fieldName)}:\\s*(.+)$`, 'm');
    const match = text.match(fieldPattern);
    if (!match) return;

    if (options?.preferInlineCode) {
      let foundField = false;
      let codeValue: string | undefined;

      visit(node, (child) => {
        if (codeValue !== undefined) return;
        if (
          (child.type === 'strong' || child.type === 'emphasis') &&
          toString(child) === fieldName
        ) {
          foundField = true;
        }
        if (foundField && child.type === 'inlineCode') {
          codeValue = (child as InlineCode).value;
        }
      });

      result = codeValue ?? match[1].trim();
    } else {
      result = match[1].trim();
    }
  });

  return result;
}

export function extractHeading(tree: Root, depth: number): string | undefined {
  let result: string | undefined;

  visit(tree, 'heading', (node: Heading) => {
    if (result !== undefined) return;
    if (node.depth === depth) {
      result = toString(node);
    }
  });

  return result;
}

export function findSection(tree: Root, headingText: string, depth: number = 2): Root['children'] {
  const children = tree.children;
  let startIdx = -1;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === 'heading' && child.depth === depth && toString(child) === headingText) {
      startIdx = i + 1;
      break;
    }
  }

  if (startIdx === -1) return [];

  const result: Root['children'] = [];
  for (let i = startIdx; i < children.length; i++) {
    const child = children[i];
    if (child.type === 'heading' && child.depth <= depth) break;
    result.push(child);
  }

  return result;
}

export function hasSection(tree: Root, headingText: string, depth: number = 2): boolean {
  let found = false;
  visit(tree, 'heading', (node: Heading) => {
    if (found) return;
    if (node.depth === depth && toString(node) === headingText) {
      found = true;
    }
  });
  return found;
}

export function countListItemsInSection(tree: Root, headingText: string): number {
  const sectionNodes = findSection(tree, headingText);
  let count = 0;
  for (const node of sectionNodes) {
    if (node.type === 'list') {
      count += (node as List).children.length;
    }
  }
  return count;
}

export function extractSectionFirstParagraph(tree: Root, headingText: string): string {
  const sectionNodes = findSection(tree, headingText);
  for (const node of sectionNodes) {
    if (node.type === 'paragraph') {
      return toString(node).trim();
    }
  }
  return '';
}

/**
 * Update or insert a bold-field value in Markdown source text.
 *
 * If a list item `- **fieldName**: …` exists, its value is replaced.
 * Otherwise, the field is inserted after the first matching anchor field
 * from `insertAfter` (tried in order). Returns content unchanged if the
 * field is absent and no anchor matches.
 */
export function updateField(
  content: string,
  fieldName: string,
  value: string,
  insertAfter?: string[],
): string {
  const tree = parseMarkdown(content);
  const lines = content.split('\n');

  // Try to find an existing list item with this field
  const fieldLine = findFieldLine(tree, fieldName, lines);
  if (fieldLine !== -1) {
    lines[fieldLine] = `- **${fieldName}**: ${value}`;
    return lines.join('\n');
  }

  // Field not found — try to insert after an anchor
  if (insertAfter) {
    for (const anchor of insertAfter) {
      const anchorLine = findFieldLine(tree, anchor, lines);
      if (anchorLine !== -1) {
        lines.splice(anchorLine + 1, 0, `- **${fieldName}**: ${value}`);
        return lines.join('\n');
      }
    }
  }

  return content;
}

function findFieldLine(tree: Root, fieldName: string, lines: string[]): number {
  const escaped = escapeRegex(fieldName);
  const pattern = new RegExp(`^-\\s+\\*\\*${escaped}\\*\\*:`);

  let result = -1;
  visit(tree, 'listItem', (node: ListItem) => {
    if (result !== -1) return;
    if (!node.position) return;
    const lineIdx = node.position.start.line - 1; // 0-based
    if (pattern.test(lines[lineIdx])) {
      result = lineIdx;
    }
  });

  return result;
}

export { parseMarkdown };

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
