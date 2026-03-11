import { describe, expect, it } from 'vitest';
import {
  parseMarkdown,
  extractFieldFromAst,
  extractHeading,
  hasSection,
  countListItemsInSection,
  extractSectionFirstParagraph,
  findSection,
  updateField,
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

describe('updateField', () => {
  it('replaces an existing field value', () => {
    const content = `# T-001: Test

- **Status**: DONE
- **Milestone**: 1 — Setup
- **Commit**: old-sha

## Description

Test.
`;
    const result = updateField(content, 'Commit', 'new-sha');
    expect(result).toContain('- **Commit**: new-sha');
    expect(result).not.toContain('old-sha');
  });

  it('inserts a new field after the first matching anchor', () => {
    const content = `# T-001: Test

- **Status**: DONE
- **Milestone**: 1 — Setup
- **Completed**: 2026-03-10 12:00 (5m duration)

## Description

Test.
`;
    const result = updateField(content, 'Commit', 'abc1234', ['Completed', 'PRD Reference']);
    expect(result).toContain('- **Commit**: abc1234');
    const lines = result.split('\n');
    const completedIdx = lines.findIndex((l) => l.includes('**Completed**'));
    const commitIdx = lines.findIndex((l) => l.includes('**Commit**'));
    expect(commitIdx).toBe(completedIdx + 1);
  });

  it('falls back to second anchor when first is missing', () => {
    const content = `# T-001: Test

- **Status**: DONE
- **Milestone**: 1 — Setup
- **PRD Reference**: §1

## Description

Test.
`;
    const result = updateField(content, 'Cost', '$1.50', ['Commit', 'Completed', 'PRD Reference']);
    expect(result).toContain('- **Cost**: $1.50');
    const lines = result.split('\n');
    const prdIdx = lines.findIndex((l) => l.includes('**PRD Reference**'));
    const costIdx = lines.findIndex((l) => l.includes('**Cost**'));
    expect(costIdx).toBe(prdIdx + 1);
  });

  it('returns content unchanged when field not found and no anchors match', () => {
    const content = `# T-001: Test

## Description

Test.
`;
    const result = updateField(content, 'Cost', '$1.50', ['NonExistent']);
    expect(result).toBe(content);
  });

  it('returns content unchanged when field not found and no anchors given', () => {
    const content = `# T-001: Test

## Description

Test.
`;
    const result = updateField(content, 'Cost', '$1.50');
    expect(result).toBe(content);
  });

  it('preserves surrounding content when replacing', () => {
    const content = `# T-001: Test

- **Status**: DONE
- **Cost**: $0.00
- **Milestone**: 1 — Setup

## Description

Test.
`;
    const result = updateField(content, 'Cost', '$5.00');
    expect(result).toContain('- **Status**: DONE');
    expect(result).toContain('- **Cost**: $5.00');
    expect(result).toContain('- **Milestone**: 1 — Setup');
  });
});
