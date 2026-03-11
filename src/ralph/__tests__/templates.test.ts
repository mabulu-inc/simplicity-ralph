import { describe, expect, it } from 'vitest';

import { generateClaudeMd } from '../templates/claude-md.js';
import { generateGeminiMd } from '../templates/gemini-md.js';
import { generateAgentsMd } from '../templates/agents-md.js';
import { generateCursorRules } from '../templates/cursor-rules.js';
import { generateContinueYaml } from '../templates/continue-yaml.js';
import { generateMethodology } from '../templates/methodology.js';
import { generatePrd } from '../templates/prd.js';
import { generateTask000 } from '../templates/task-000.js';
import { defaultBootPromptTemplate } from '../templates/boot-prompt.js';
import { generateRules } from '../templates/rules-md.js';

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

  it('does not include Project-Specific Config section', () => {
    const result = generateClaudeMd(tsConfig);
    expect(result).not.toContain('Project-Specific Config');
  });

  it('does not include config fields like Language or Package manager', () => {
    const result = generateClaudeMd(tsConfig);
    expect(result).not.toContain('**Language**');
    expect(result).not.toContain('**Package manager**');
    expect(result).not.toContain('**Testing framework**');
  });

  it('includes project goal', () => {
    const result = generateClaudeMd(tsConfig);
    expect(result).toContain('Build my-app');
    expect(result).toContain('docs/PRD.md');
  });
});

describe('generateGeminiMd (slimmed)', () => {
  it('includes project name and goal', () => {
    const result = generateGeminiMd(tsConfig);
    expect(result).toContain('# my-app');
    expect(result).toContain('Build my-app');
  });

  it('does not include Project-Specific Config section', () => {
    const result = generateGeminiMd(tsConfig);
    expect(result).not.toContain('Project-Specific Config');
    expect(result).not.toContain('**Language**');
  });

  it('includes methodology reference', () => {
    const result = generateGeminiMd(tsConfig);
    expect(result).toContain('docs/RALPH-METHODOLOGY.md');
  });
});

describe('generateAgentsMd (slimmed)', () => {
  it('includes project name and goal', () => {
    const result = generateAgentsMd(tsConfig);
    expect(result).toContain('# my-app');
    expect(result).toContain('Build my-app');
  });

  it('does not include Project-Specific Config section', () => {
    const result = generateAgentsMd(tsConfig);
    expect(result).not.toContain('Project-Specific Config');
    expect(result).not.toContain('**Language**');
  });
});

describe('generateCursorRules (slimmed)', () => {
  it('includes project name and goal', () => {
    const result = generateCursorRules(tsConfig);
    expect(result).toContain('# my-app');
    expect(result).toContain('Build my-app');
  });

  it('does not include Project-Specific Config section', () => {
    const result = generateCursorRules(tsConfig);
    expect(result).not.toContain('Project-Specific Config');
    expect(result).not.toContain('**Language**');
  });
});

describe('generateContinueYaml (slimmed)', () => {
  it('includes project name', () => {
    const result = generateContinueYaml(tsConfig);
    expect(result).toContain('my-app');
  });

  it('does not include config comments', () => {
    const result = generateContinueYaml(tsConfig);
    expect(result).not.toContain('# Project Config');
    expect(result).not.toContain('#   Language:');
  });

  it('includes methodology reference', () => {
    const result = generateContinueYaml(tsConfig);
    expect(result).toContain('RALPH-METHODOLOGY.md');
  });
});

describe('generateRules', () => {
  it('returns a non-empty string', () => {
    const result = generateRules(tsConfig);
    expect(result.length).toBeGreaterThan(0);
  });

  it('contains a comment explaining purpose', () => {
    const result = generateRules(tsConfig);
    expect(result).toContain('{{project.rules}}');
  });

  it('includes file naming when provided', () => {
    const result = generateRules({ ...tsConfig, fileNaming: 'kebab-case' });
    expect(result).toContain('kebab-case');
  });

  it('omits file naming when not provided', () => {
    const { fileNaming: _, ...noFileNaming } = tsConfig;
    const result = generateRules(noFileNaming);
    expect(result).not.toContain('File naming');
  });

  it('includes no-database rule when database is absent', () => {
    const result = generateRules(tsConfig);
    expect(result).toContain('No database');
  });

  it('omits no-database rule when database is set', () => {
    const result = generateRules({ ...tsConfig, database: 'PostgreSQL' });
    expect(result).not.toContain('No database');
  });

  it('includes node_modules warning for TypeScript', () => {
    const result = generateRules(tsConfig);
    expect(result).toContain('node_modules');
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

describe('defaultBootPromptTemplate', () => {
  it('is a non-empty string with template variables', () => {
    const template = defaultBootPromptTemplate();
    expect(template.length).toBeGreaterThan(0);
    expect(template).toContain('{{task.id}}');
    expect(template).toContain('{{config.language}}');
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
