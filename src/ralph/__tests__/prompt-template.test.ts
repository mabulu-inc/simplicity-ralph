import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  interpolateTemplate,
  loadAndInterpolate,
  loadLayeredPrompt,
} from '../core/prompt-template.js';
import { defaultBootPromptTemplate } from '../templates/boot-prompt.js';
import { defaultSystemPromptTemplate } from '../templates/system-prompt.js';
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
  touches: ['src/core/foo.ts', 'src/core/bar.ts'],
  hints: 'Follow the existing pattern in core/tasks.ts.',
  complexity: undefined,
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

  it('replaces task.touches with comma-separated file list', () => {
    const template = 'Touches: {{task.touches}}';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('Touches: src/core/foo.ts, src/core/bar.ts');
  });

  it('replaces task.touches with fallback when empty', () => {
    const taskNoTouches = { ...mockTask, touches: [] };
    const template = 'Touches: {{task.touches}}';
    const result = interpolateTemplate(template, taskNoTouches, mockConfig);
    expect(result).toBe('Touches: not specified');
  });

  it('replaces task.hints with hints text', () => {
    const template = 'Hints: {{task.hints}}';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('Hints: Follow the existing pattern in core/tasks.ts.');
  });

  it('replaces task.hints with empty string when no hints', () => {
    const taskNoHints = { ...mockTask, hints: '' };
    const template = 'Hints: {{task.hints}}';
    const result = interpolateTemplate(template, taskNoHints, mockConfig);
    expect(result).toBe('Hints: ');
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

  it('replaces {{project.rules}} with provided projectRules', () => {
    const template = 'Rules: {{project.rules}}';
    const result = interpolateTemplate(template, mockTask, mockConfig, '- No TodoWrite');
    expect(result).toBe('Rules: - No TodoWrite');
  });

  it('replaces {{project.rules}} with empty string when not provided', () => {
    const template = 'Rules: [{{project.rules}}]';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('Rules: []');
  });

  it('replaces {{task.prdContent}} with provided PRD content', () => {
    const template = 'PRD Content: {{task.prdContent}}';
    const result = interpolateTemplate(template, mockTask, mockConfig, '', 'Section body here');
    expect(result).toBe('PRD Content: Section body here');
  });

  it('replaces {{task.prdContent}} with empty string when not provided', () => {
    const template = 'PRD: [{{task.prdContent}}]';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('PRD: []');
  });

  it('replaces {{codebaseIndex}} with provided codebase index', () => {
    const template = 'Index:\n{{codebaseIndex}}';
    const result = interpolateTemplate(
      template,
      mockTask,
      mockConfig,
      '',
      '',
      'src/foo.ts: Foo, Bar',
    );
    expect(result).toBe('Index:\nsrc/foo.ts: Foo, Bar');
  });

  it('replaces {{codebaseIndex}} with empty string when not provided', () => {
    const template = 'Index: [{{codebaseIndex}}]';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('Index: []');
  });

  it('replaces {{retryContext}} with provided retry context', () => {
    const template = 'Retry:\n{{retryContext}}';
    const result = interpolateTemplate(
      template,
      mockTask,
      mockConfig,
      '',
      '',
      '',
      'RETRY CONTEXT: failed at Verify',
    );
    expect(result).toBe('Retry:\nRETRY CONTEXT: failed at Verify');
  });

  it('replaces {{retryContext}} with empty string when not provided', () => {
    const template = 'Retry: [{{retryContext}}]';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('Retry: []');
  });

  it('replaces {{preflightBaseline}} with provided baseline', () => {
    const template = 'Baseline:\n{{preflightBaseline}}';
    const result = interpolateTemplate(
      template,
      mockTask,
      mockConfig,
      '',
      '',
      '',
      '',
      '# Pre-existing failures\nDo not fix these.',
    );
    expect(result).toBe('Baseline:\n# Pre-existing failures\nDo not fix these.');
  });

  it('replaces {{preflightBaseline}} with empty string when not provided', () => {
    const template = 'Baseline: [{{preflightBaseline}}]';
    const result = interpolateTemplate(template, mockTask, mockConfig);
    expect(result).toBe('Baseline: []');
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

  it('uses built-in boot template as the base (no user file needed)', async () => {
    // No docs/prompts/boot.md — should still work using built-in template
    const result = await loadAndInterpolate(tmpDir, mockTask, mockConfig);
    expect(result).toContain('T-005');
    expect(result).toContain('Build feature X');
    expect(result).toContain('TypeScript');
  });

  it('appends user extension file content after separator when boot.md exists', async () => {
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await writeFile(
      join(tmpDir, 'docs', 'prompts', 'boot.md'),
      'Custom extension content for this project.',
    );

    const result = await loadAndInterpolate(tmpDir, mockTask, mockConfig);
    // Should contain built-in content
    expect(result).toContain('T-005');
    // Should contain separator
    expect(result).toContain('--- Project Extensions ---');
    // Should contain extension content
    expect(result).toContain('Custom extension content for this project.');
  });

  it('interpolates variables in both built-in and extension content', async () => {
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await writeFile(
      join(tmpDir, 'docs', 'prompts', 'boot.md'),
      'Extension for {{task.id}} using {{config.language}}.',
    );

    const result = await loadAndInterpolate(tmpDir, mockTask, mockConfig);
    // Built-in variables interpolated
    expect(result).toContain('T-005');
    // Extension variables interpolated
    expect(result).toContain('Extension for T-005 using TypeScript.');
  });

  it('reads docs/prompts/rules.md and injects as {{project.rules}}', async () => {
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await writeFile(
      join(tmpDir, 'docs', 'prompts', 'rules.md'),
      '- Do not use TodoWrite\n- All code under src/',
    );

    const result = await loadAndInterpolate(tmpDir, mockTask, mockConfig);
    expect(result).toContain('- Do not use TodoWrite');
    expect(result).toContain('- All code under src/');
  });

  it('resolves {{project.rules}} to empty string when rules.md does not exist', async () => {
    const result = await loadAndInterpolate(tmpDir, mockTask, mockConfig);
    // The built-in template has {{project.rules}} which should resolve to empty
    const builtIn = defaultBootPromptTemplate();
    expect(builtIn).toContain('{{project.rules}}');
    // In output it should be replaced with empty string
    expect(result).not.toContain('{{project.rules}}');
  });

  it('injects PRD section content when extension uses {{task.prdContent}}', async () => {
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await writeFile(
      join(tmpDir, 'docs', 'PRD.md'),
      '## 3. Commands\n\n### 3.1 Init\n\nInit details.\n\n### 3.2 Loop\n\nLoop details.\n',
    );
    await writeFile(join(tmpDir, 'docs', 'prompts', 'boot.md'), 'PRD Content: {{task.prdContent}}');

    const taskWith31 = { ...mockTask, prdReference: '§3.1' };
    const result = await loadAndInterpolate(tmpDir, taskWith31, mockConfig);
    expect(result).toContain('Init details.');
    expect(result).not.toContain('Loop details.');
  });

  it('generates and injects codebase index as {{codebaseIndex}}', async () => {
    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'helper.ts'), 'export function doStuff() {}\n');

    const result = await loadAndInterpolate(tmpDir, mockTask, mockConfig);
    expect(result).toContain('src/helper.ts');
    expect(result).toContain('doStuff');
  });

  it('injects retry context as {{retryContext}} when provided', async () => {
    const result = await loadAndInterpolate(tmpDir, mockTask, mockConfig, 'RETRY: Verify failed');
    expect(result).toContain('RETRY: Verify failed');
  });

  it('resolves {{retryContext}} to empty string on first attempt', async () => {
    const result = await loadAndInterpolate(tmpDir, mockTask, mockConfig);
    expect(result).not.toContain('{{retryContext}}');
  });

  it('skips duplicate extension when boot.md matches built-in template exactly', async () => {
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    // Write exact copy of built-in template
    await writeFile(join(tmpDir, 'docs', 'prompts', 'boot.md'), defaultBootPromptTemplate());

    const result = await loadAndInterpolate(tmpDir, mockTask, mockConfig);
    // Should NOT contain the separator since the file is a duplicate
    expect(result).not.toContain('--- Project Extensions ---');
  });
});

describe('loadLayeredPrompt', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ralph-layered-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('uses built-in system prompt as base (no user file needed)', async () => {
    const result = await loadLayeredPrompt(tmpDir, mockTask, mockConfig);
    // Should always have systemPrompt from built-in
    expect(result.systemPrompt).toBeDefined();
    expect(result.systemPrompt).toContain('[PHASE]');
    // userPrompt uses built-in boot template
    expect(result.userPrompt).toContain('T-005');
  });

  it('appends user extension content to system prompt when system.md exists', async () => {
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await writeFile(
      join(tmpDir, 'docs', 'prompts', 'system.md'),
      'Custom system extension for this project.',
    );

    const result = await loadLayeredPrompt(tmpDir, mockTask, mockConfig);
    // Built-in system content present
    expect(result.systemPrompt).toContain('[PHASE]');
    // Extension appended with separator
    expect(result.systemPrompt).toContain('--- Project Extensions ---');
    expect(result.systemPrompt).toContain('Custom system extension for this project.');
  });

  it('skips duplicate extension when system.md matches built-in template exactly', async () => {
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await writeFile(join(tmpDir, 'docs', 'prompts', 'system.md'), defaultSystemPromptTemplate());

    const result = await loadLayeredPrompt(tmpDir, mockTask, mockConfig);
    expect(result.systemPrompt).not.toContain('--- Project Extensions ---');
  });

  it('works with zero config (no user extension files)', async () => {
    const result = await loadLayeredPrompt(tmpDir, mockTask, mockConfig);
    expect(result.systemPrompt).toBeDefined();
    expect(result.userPrompt).toBeDefined();
    expect(result.userPrompt).toContain('T-005');
    expect(result.userPrompt).toContain('Build feature X');
  });

  it('passes retry context to user prompt interpolation', async () => {
    const result = await loadLayeredPrompt(tmpDir, mockTask, mockConfig, 'RETRY: failed');
    expect(result.userPrompt).toContain('RETRY: failed');
  });

  it('interpolates variables in both built-in and extension boot content', async () => {
    await mkdir(join(tmpDir, 'docs', 'prompts'), { recursive: true });
    await writeFile(join(tmpDir, 'docs', 'prompts', 'boot.md'), 'Extension task: {{task.id}}');

    const result = await loadLayeredPrompt(tmpDir, mockTask, mockConfig);
    // Built-in content interpolated
    expect(result.userPrompt).toContain('T-005');
    // Extension content interpolated
    expect(result.userPrompt).toContain('Extension task: T-005');
  });
});
