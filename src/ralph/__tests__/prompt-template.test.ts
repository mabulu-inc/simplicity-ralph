import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { interpolateTemplate, loadAndInterpolate } from '../core/prompt-template.js';
import type { Task } from '../core/tasks.js';
import type { ProjectConfig } from '../core/config.js';

const mockTask: Task = {
  id: 'T-005',
  number: 5,
  title: 'Build feature X',
  status: 'TODO',
  milestone: '2 — Core',
  depends: ['T-003', 'T-004'],
  prdReference: '§3.1',
  completed: undefined,
  commit: undefined,
  cost: undefined,
  blocked: false,
  description: 'Implement feature X as described in the PRD.',
  producesCount: 2,
};

const mockConfig: ProjectConfig = {
  language: 'TypeScript',
  fileNaming: 'kebab-case',
  packageManager: 'pnpm',
  testingFramework: 'Vitest',
  qualityCheck: 'pnpm check',
  testCommand: 'pnpm test',
  database: undefined,
  agent: undefined,
  model: undefined,
};

describe('interpolateTemplate', () => {
  it('replaces task variables', () => {
    const template = 'Task: {{task.id}} — {{task.title}}';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('Task: T-005 — Build feature X');
  });

  it('replaces config variables', () => {
    const template = 'Lang: {{config.language}}, PM: {{config.packageManager}}';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('Lang: TypeScript, PM: pnpm');
  });

  it('replaces all config variables', () => {
    const template = '{{config.testingFramework}} {{config.qualityCheck}} {{config.testCommand}}';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('Vitest pnpm check pnpm test');
  });

  it('replaces task.description', () => {
    const template = 'Desc: {{task.description}}';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('Desc: Implement feature X as described in the PRD.');
  });

  it('replaces task.prdReference', () => {
    const template = 'PRD: {{task.prdReference}}';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('PRD: §3.1');
  });

  it('replaces config.fileNaming with value when set', () => {
    const template = 'Naming: {{config.fileNaming}}';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('Naming: kebab-case');
  });

  it('replaces config.fileNaming with empty string when unset', () => {
    const configNoNaming = { ...mockConfig, fileNaming: undefined };
    const template = 'Naming: {{config.fileNaming}}';
    const result = interpolateTemplate(template, mockTask, configNoNaming);
    expect(result).toBe('Naming: ');
  });

  it('replaces config.database with value when set', () => {
    const configWithDb = { ...mockConfig, database: 'PostgreSQL' };
    const template = 'DB: {{config.database}}';
    const result = interpolateTemplate(template, mockTask, configWithDb);
    expect(result).toBe('DB: PostgreSQL');
  });

  it('replaces config.database with empty string when unset', () => {
    const template = 'DB: {{config.database}}';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('DB: ');
  });

  it('leaves unknown variables as-is', () => {
    const template = 'Unknown: {{unknown.var}}';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('Unknown: {{unknown.var}}');
  });

  it('handles multiple occurrences of the same variable', () => {
    const template = '{{task.id}} and {{task.id}}';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('T-005 and T-005');
  });

  it('handles template with no variables', () => {
    const template = 'No variables here.';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('No variables here.');
  });
});

describe('loadAndInterpolate', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ralph-prompt-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loads a template file and interpolates variables', async () => {
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await writeFile(join(tmpDir, 'docs', 'prompts', 'boot.md'), 'Task {{task.id}}: {{task.title}}');

    const result = await loadAndInterpolate(tmpDir, mockTask, mockConfig);
    expect(result).toBe('Task T-005: Build feature X');
  });

  it('throws with clear error when template file is missing', async () => {
    await expect(loadAndInterpolate(tmpDir, mockTask, mockConfig)).rejects.toThrow(
      'docs/prompts/boot.md',
    );
  });
});
