import { describe, expect, it } from 'vitest';
import {
  parseMarkdown,
  extractFieldFromAst,
  extractHeading,
  hasSection,
  countListItemsInSection,
  extractSectionFirstParagraph,
  findSection,
} from '../core/markdown.js';

describe('findSection', () => {
  it('returns children between the matched heading and the next same-level heading', () => {
    const tree = parseMarkdown(`# Title

## Section A

Paragraph in A.

- Item 1

## Section B

Paragraph in B.
`);
    const nodes = findSection(tree, 'Section A');
    expect(nodes.length).toBe(2);
    expect(nodes[0].type).toBe('paragraph');
    expect(nodes[1].type).toBe('list');
  });

  it('returns empty array when section not found', () => {
    const tree = parseMarkdown('# Title\n\n## Other\n\nText.');
    const nodes = findSection(tree, 'Missing');
    expect(nodes).toEqual([]);
  });

  it('supports custom depth', () => {
    const tree = parseMarkdown(`# Title

## Parent

### Subsection

Content here.

### Next Subsection

More content.
`);
    const nodes = findSection(tree, 'Subsection', 3);
    expect(nodes.length).toBe(1);
    expect(nodes[0].type).toBe('paragraph');
  });
});

describe('extractFieldFromAst with preferInlineCode', () => {
  it('returns inline code value when preferInlineCode is true', () => {
    const tree = parseMarkdown(`# Title

- **Quality check**: \`pnpm check\` (lint → format → typecheck)
`);
    const result = extractFieldFromAst(tree, 'Quality check', { preferInlineCode: true });
    expect(result).toBe('pnpm check');
  });

  it('returns plain text when no inline code and preferInlineCode is true', () => {
    const tree = parseMarkdown(`# Title

- **Language**: TypeScript (strict mode)
`);
    const result = extractFieldFromAst(tree, 'Language', { preferInlineCode: true });
    expect(result).toBe('TypeScript (strict mode)');
  });

  it('returns full text match when preferInlineCode is false', () => {
    const tree = parseMarkdown(`# Title

- **Quality check**: \`pnpm check\` (lint → format → typecheck)
`);
    const result = extractFieldFromAst(tree, 'Quality check');
    expect(result).toBe('pnpm check (lint → format → typecheck)');
  });
});

describe('extractHeading', () => {
  it('extracts the first heading at the given depth', () => {
    const tree = parseMarkdown('# Title\n\n## Sub');
    expect(extractHeading(tree, 1)).toBe('Title');
    expect(extractHeading(tree, 2)).toBe('Sub');
  });

  it('returns undefined when no heading at depth', () => {
    const tree = parseMarkdown('# Title');
    expect(extractHeading(tree, 2)).toBeUndefined();
  });
});

describe('hasSection', () => {
  it('returns true when heading exists', () => {
    const tree = parseMarkdown('# Title\n\n## Blocked\n\nText.');
    expect(hasSection(tree, 'Blocked')).toBe(true);
  });

  it('returns false when heading does not exist', () => {
    const tree = parseMarkdown('# Title\n\n## Other\n\nText.');
    expect(hasSection(tree, 'Blocked')).toBe(false);
  });
});

describe('countListItemsInSection', () => {
  it('counts list items under a section heading', () => {
    const tree = parseMarkdown(`# Title

## Produces

- Item A
- Item B
- Item C
`);
    expect(countListItemsInSection(tree, 'Produces')).toBe(3);
  });

  it('returns 0 for missing section', () => {
    const tree = parseMarkdown('# Title');
    expect(countListItemsInSection(tree, 'Produces')).toBe(0);
  });
});

describe('extractSectionFirstParagraph', () => {
  it('returns first paragraph text', () => {
    const tree = parseMarkdown(`# Title

## Description

This is the description.

More text.
`);
    expect(extractSectionFirstParagraph(tree, 'Description')).toBe('This is the description.');
  });

  it('returns empty string for missing section', () => {
    const tree = parseMarkdown('# Title');
    expect(extractSectionFirstParagraph(tree, 'Description')).toBe('');
  });
});
