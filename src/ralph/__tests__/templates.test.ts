import { describe, expect, it } from 'vitest';

import { generateClaudeMd } from '../templates/claude-md.js';
import { generateMethodology } from '../templates/methodology.js';
import { generatePrd } from '../templates/prd.js';
import { generateTask000 } from '../templates/task-000.js';

interface TemplateConfig {
  projectName: string;
  language: string;
  packageManager: string;
  testingFramework: string;
  qualityCheck: string;
  testCommand: string;
  fileNaming?: string;
  database?: string;
}

const tsConfig: TemplateConfig = {
  projectName: 'my-app',
  language: 'TypeScript',
  packageManager: 'pnpm',
  testingFramework: 'Vitest',
  qualityCheck: 'pnpm check',
  testCommand: 'pnpm test',
  fileNaming: 'kebab-case',
};

const pyConfig: TemplateConfig = {
  projectName: 'data-pipeline',
  language: 'Python',
  packageManager: 'pip',
  testingFramework: 'pytest',
  qualityCheck: 'make check',
  testCommand: 'pytest',
  database: 'PostgreSQL via Docker',
};

describe('generateClaudeMd', () => {
  it('includes project name in heading', () => {
    const result = generateClaudeMd(tsConfig);
    expect(result).toContain('# my-app');
  });

  it('includes methodology reference', () => {
    const result = generateClaudeMd(tsConfig);
    expect(result).toContain('docs/RALPH-METHODOLOGY.md');
  });

  it('includes all required config fields', () => {
    const result = generateClaudeMd(tsConfig);
    expect(result).toContain('**Language**: TypeScript');
    expect(result).toContain('**Package manager**: pnpm');
    expect(result).toContain('**Testing framework**: Vitest');
    expect(result).toContain('**Quality check**: `pnpm check`');
    expect(result).toContain('**Test command**: `pnpm test`');
  });

  it('includes optional file naming when provided', () => {
    const result = generateClaudeMd(tsConfig);
    expect(result).toContain('**File naming**: kebab-case');
  });

  it('omits file naming when not provided', () => {
    const result = generateClaudeMd(pyConfig);
    expect(result).not.toContain('File naming');
  });

  it('includes database when provided', () => {
    const result = generateClaudeMd(pyConfig);
    expect(result).toContain('**Database**: PostgreSQL via Docker');
  });

  it('omits database when not provided', () => {
    const result = generateClaudeMd(tsConfig);
    expect(result).not.toContain('Database');
  });

  it('has Project-Specific Config section header', () => {
    const result = generateClaudeMd(tsConfig);
    expect(result).toContain('## Project-Specific Config');
  });

  it('is parseable by the existing config parser', async () => {
    const { parseConfig } = await import('../core/config.js');
    const content = generateClaudeMd(tsConfig);
    const config = parseConfig(content);
    expect(config.language).toBe('TypeScript');
    expect(config.packageManager).toBe('pnpm');
    expect(config.testingFramework).toBe('Vitest');
    expect(config.qualityCheck).toBe('pnpm check');
    expect(config.testCommand).toBe('pnpm test');
    expect(config.fileNaming).toBe('kebab-case');
    expect(config.database).toBeUndefined();
  });

  it('is parseable with database config', async () => {
    const { parseConfig } = await import('../core/config.js');
    const content = generateClaudeMd(pyConfig);
    const config = parseConfig(content);
    expect(config.database).toBe('PostgreSQL via Docker');
  });
});

describe('generateMethodology', () => {
  it('includes Ralph Methodology heading', () => {
    const result = generateMethodology();
    expect(result).toContain('# Ralph Methodology');
  });

  it('includes How It Works section', () => {
    const result = generateMethodology();
    expect(result).toContain('## How It Works');
  });

  it('includes task file format', () => {
    const result = generateMethodology();
    expect(result).toContain('## Task File Format');
  });

  it('includes the loop diagram', () => {
    const result = generateMethodology();
    expect(result).toContain('Boot');
    expect(result).toContain('Execute');
  });

  it('includes quality gates', () => {
    const result = generateMethodology();
    expect(result).toContain('## Quality Gates');
  });

  it('includes rules section', () => {
    const result = generateMethodology();
    expect(result).toContain('## Rules');
  });
});

describe('generatePrd', () => {
  it('includes project name in heading', () => {
    const result = generatePrd('my-app');
    expect(result).toContain('# my-app');
  });

  it('includes numbered sections', () => {
    const result = generatePrd('my-app');
    expect(result).toMatch(/## 1\./);
    expect(result).toMatch(/## 2\./);
    expect(result).toMatch(/## 3\./);
  });

  it('includes placeholder content for sections', () => {
    const result = generatePrd('my-app');
    expect(result).toContain('TODO');
  });

  it('works with different project names', () => {
    const result = generatePrd('data-pipeline');
    expect(result).toContain('# data-pipeline');
  });
});

describe('generateTask000', () => {
  it('includes T-000 heading', () => {
    const result = generateTask000(tsConfig);
    expect(result).toContain('# T-000:');
  });

  it('has TODO status', () => {
    const result = generateTask000(tsConfig);
    expect(result).toContain('**Status**: TODO');
  });

  it('has no dependencies', () => {
    const result = generateTask000(tsConfig);
    expect(result).toContain('**Depends**: none');
  });

  it('references the project language', () => {
    const result = generateTask000(tsConfig);
    expect(result).toContain('TypeScript');
  });

  it('references the package manager', () => {
    const result = generateTask000(tsConfig);
    expect(result).toContain('pnpm');
  });

  it('references the testing framework', () => {
    const result = generateTask000(tsConfig);
    expect(result).toContain('Vitest');
  });

  it('references the quality check command', () => {
    const result = generateTask000(tsConfig);
    expect(result).toContain('pnpm check');
  });

  it('includes database setup for projects with database', () => {
    const result = generateTask000(pyConfig);
    expect(result).toContain('PostgreSQL');
    expect(result).toContain('Docker');
  });

  it('omits database setup for projects without database', () => {
    const result = generateTask000(tsConfig);
    expect(result).not.toContain('Docker Compose');
  });

  it('produces section', () => {
    const result = generateTask000(tsConfig);
    expect(result).toContain('## Produces');
  });

  it('adapts linting tools for TypeScript', () => {
    const result = generateTask000(tsConfig);
    expect(result).toContain('ESLint');
    expect(result).toContain('Prettier');
  });

  it('adapts tooling for Python', () => {
    const result = generateTask000(pyConfig);
    expect(result).toContain('Python');
  });
});
