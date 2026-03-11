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

export { parseMarkdown };

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
