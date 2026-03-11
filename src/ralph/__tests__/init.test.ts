import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { runInit, type InitAnswers } from '../commands/init.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-init-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

const defaultAnswers: InitAnswers = {
  projectName: 'test-app',
  language: 'TypeScript',
  packageManager: 'pnpm',
  testingFramework: 'Vitest',
  qualityCheck: 'pnpm check',
  testCommand: 'pnpm test',
  database: 'none',
};

describe('runInit', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('creates docs/PRD.md', async () => {
    await runInit(tmpDir, defaultAnswers);
    const filePath = path.join(tmpDir, 'docs', 'PRD.md');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('# test-app');
  });

  it('creates docs/RALPH-METHODOLOGY.md', async () => {
    await runInit(tmpDir, defaultAnswers);
    const filePath = path.join(tmpDir, 'docs', 'RALPH-METHODOLOGY.md');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('# Ralph Methodology');
  });

  it('creates docs/tasks/T-000.md', async () => {
    await runInit(tmpDir, defaultAnswers);
    const filePath = path.join(tmpDir, 'docs', 'tasks', 'T-000.md');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('# T-000:');
    expect(content).toContain('TypeScript');
  });

  it('creates .claude/CLAUDE.md', async () => {
    await runInit(tmpDir, defaultAnswers);
    const filePath = path.join(tmpDir, '.claude', 'CLAUDE.md');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('# test-app');
    expect(content).toContain('Build test-app');
  });

  it('creates docs/prompts/rules.md', async () => {
    await runInit(tmpDir, defaultAnswers);
    const filePath = path.join(tmpDir, 'docs', 'prompts', 'rules.md');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('{{project.rules}}');
  });

  it('creates docs/prompts/boot.md', async () => {
    await runInit(tmpDir, defaultAnswers);
    const filePath = path.join(tmpDir, 'docs', 'prompts', 'boot.md');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('{{task.id}}');
    expect(content).toContain('{{config.language}}');
  });

  it('returns a summary of created files', async () => {
    const result = await runInit(tmpDir, defaultAnswers);
    expect(result.created).toContain('docs/PRD.md');
    expect(result.created).toContain('docs/RALPH-METHODOLOGY.md');
    expect(result.created).toContain('docs/tasks/T-000.md');
    expect(result.created).toContain('.claude/CLAUDE.md');
    expect(result.created).toContain('docs/prompts/boot.md');
    expect(result.created).toContain('docs/prompts/rules.md');
    expect(result.skipped).toHaveLength(0);
  });

  it('skips existing files and reports them', async () => {
    // Pre-create one of the files
    const docsDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'PRD.md'), '# Existing PRD\n');

    const result = await runInit(tmpDir, defaultAnswers);
    expect(result.skipped).toContain('docs/PRD.md');
    expect(result.created).not.toContain('docs/PRD.md');
    // The existing file should not be overwritten
    const content = fs.readFileSync(path.join(docsDir, 'PRD.md'), 'utf-8');
    expect(content).toBe('# Existing PRD\n');
  });

  it('overwrites existing files when overwrite is true', async () => {
    const docsDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'PRD.md'), '# Existing PRD\n');

    const result = await runInit(tmpDir, { ...defaultAnswers, overwrite: true });
    expect(result.created).toContain('docs/PRD.md');
    expect(result.skipped).toHaveLength(0);
    const content = fs.readFileSync(path.join(docsDir, 'PRD.md'), 'utf-8');
    expect(content).toContain('# test-app');
  });

  it('passes database config to task template when not "none"', async () => {
    const answers: InitAnswers = { ...defaultAnswers, database: 'PostgreSQL via Docker' };
    await runInit(tmpDir, answers);
    const task = fs.readFileSync(path.join(tmpDir, 'docs', 'tasks', 'T-000.md'), 'utf-8');
    expect(task).toContain('PostgreSQL');
  });

  it('creates necessary parent directories', async () => {
    await runInit(tmpDir, defaultAnswers);
    expect(fs.existsSync(path.join(tmpDir, 'docs', 'tasks'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'docs', 'prompts'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude'))).toBe(true);
  });

  it('adds ralph scripts to package.json for Node.js projects', async () => {
    // Create a package.json in tmpDir
    const pkg = { name: 'test-app', version: '1.0.0', scripts: {} };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2));

    await runInit(tmpDir, defaultAnswers);
    const updatedPkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf-8'));
    expect(updatedPkg.scripts.ralph).toBeDefined();
  });

  it('does not touch package.json for non-Node projects', async () => {
    const pkg = { name: 'test-app', version: '1.0.0', scripts: {} };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2));

    const answers: InitAnswers = { ...defaultAnswers, language: 'Python', packageManager: 'pip' };
    await runInit(tmpDir, answers);
    const updatedPkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf-8'));
    expect(updatedPkg.scripts.ralph).toBeUndefined();
  });

  it('does not fail when no package.json exists for Node.js projects', async () => {
    await runInit(tmpDir, defaultAnswers);
    // Should complete without error, just skip package.json update
    expect(fs.existsSync(path.join(tmpDir, 'docs', 'PRD.md'))).toBe(true);
  });
});

describe('runInit with gemini agent', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('creates GEMINI.md when agent is gemini', async () => {
    const answers: InitAnswers = { ...defaultAnswers, agent: 'gemini' };
    const result = await runInit(tmpDir, answers);
    const filePath = path.join(tmpDir, 'GEMINI.md');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(result.created).toContain('GEMINI.md');
  });

  it('does not create .claude/CLAUDE.md when agent is gemini', async () => {
    const answers: InitAnswers = { ...defaultAnswers, agent: 'gemini' };
    await runInit(tmpDir, answers);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'CLAUDE.md'))).toBe(false);
  });

  it('creates .claude/CLAUDE.md by default (no agent specified)', async () => {
    await runInit(tmpDir, defaultAnswers);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'CLAUDE.md'))).toBe(true);
  });

  it('creates .claude/CLAUDE.md when agent is claude', async () => {
    const answers: InitAnswers = { ...defaultAnswers, agent: 'claude' };
    await runInit(tmpDir, answers);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'CLAUDE.md'))).toBe(true);
  });

  it('GEMINI.md contains project name and goal', async () => {
    const answers: InitAnswers = { ...defaultAnswers, agent: 'gemini' };
    await runInit(tmpDir, answers);
    const content = fs.readFileSync(path.join(tmpDir, 'GEMINI.md'), 'utf-8');
    expect(content).toContain('# test-app');
    expect(content).toContain('Build test-app');
  });
});

describe('runInit with codex agent', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('creates AGENTS.md when agent is codex', async () => {
    const answers: InitAnswers = { ...defaultAnswers, agent: 'codex' };
    const result = await runInit(tmpDir, answers);
    const filePath = path.join(tmpDir, 'AGENTS.md');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(result.created).toContain('AGENTS.md');
  });

  it('does not create .claude/CLAUDE.md when agent is codex', async () => {
    const answers: InitAnswers = { ...defaultAnswers, agent: 'codex' };
    await runInit(tmpDir, answers);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'CLAUDE.md'))).toBe(false);
  });

  it('AGENTS.md contains project name and goal', async () => {
    const answers: InitAnswers = { ...defaultAnswers, agent: 'codex' };
    await runInit(tmpDir, answers);
    const content = fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('# test-app');
    expect(content).toContain('Build test-app');
  });
});

describe('runInit with continue agent', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('creates .continue/config.yaml when agent is continue', async () => {
    const answers: InitAnswers = { ...defaultAnswers, agent: 'continue' };
    const result = await runInit(tmpDir, answers);
    const filePath = path.join(tmpDir, '.continue', 'config.yaml');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(result.created).toContain('.continue/config.yaml');
  });

  it('does not create .claude/CLAUDE.md when agent is continue', async () => {
    const answers: InitAnswers = { ...defaultAnswers, agent: 'continue' };
    await runInit(tmpDir, answers);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'CLAUDE.md'))).toBe(false);
  });

  it('config.yaml contains project name and goal', async () => {
    const answers: InitAnswers = { ...defaultAnswers, agent: 'continue' };
    await runInit(tmpDir, answers);
    const content = fs.readFileSync(path.join(tmpDir, '.continue', 'config.yaml'), 'utf-8');
    expect(content).toContain('test-app');
    expect(content).toContain('RALPH-METHODOLOGY.md');
  });
});

describe('runInit with cursor agent', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('creates .cursor/rules/ralph.md when agent is cursor', async () => {
    const answers: InitAnswers = { ...defaultAnswers, agent: 'cursor' };
    const result = await runInit(tmpDir, answers);
    const filePath = path.join(tmpDir, '.cursor', 'rules', 'ralph.md');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(result.created).toContain('.cursor/rules/ralph.md');
  });

  it('does not create .claude/CLAUDE.md when agent is cursor', async () => {
    const answers: InitAnswers = { ...defaultAnswers, agent: 'cursor' };
    await runInit(tmpDir, answers);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'CLAUDE.md'))).toBe(false);
  });

  it('ralph.md contains project name and goal', async () => {
    const answers: InitAnswers = { ...defaultAnswers, agent: 'cursor' };
    await runInit(tmpDir, answers);
    const content = fs.readFileSync(path.join(tmpDir, '.cursor', 'rules', 'ralph.md'), 'utf-8');
    expect(content).toContain('# test-app');
    expect(content).toContain('Build test-app');
  });
});

describe('runInit creates ralph.config.json', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('creates ralph.config.json with all required fields', async () => {
    await runInit(tmpDir, defaultAnswers);
    const filePath = path.join(tmpDir, 'ralph.config.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(config.language).toBe('TypeScript');
    expect(config.packageManager).toBe('pnpm');
    expect(config.testingFramework).toBe('Vitest');
    expect(config.qualityCheck).toBe('pnpm check');
    expect(config.testCommand).toBe('pnpm test');
    expect(config.agent).toBe('claude');
  });

  it('includes ralph.config.json in created files list', async () => {
    const result = await runInit(tmpDir, defaultAnswers);
    expect(result.created).toContain('ralph.config.json');
  });

  it('includes agent field from answers', async () => {
    const answers: InitAnswers = { ...defaultAnswers, agent: 'gemini' };
    await runInit(tmpDir, answers);
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8'));
    expect(config.agent).toBe('gemini');
  });

  it('defaults agent to claude when not specified', async () => {
    await runInit(tmpDir, defaultAnswers);
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8'));
    expect(config.agent).toBe('claude');
  });

  it('includes optional fileNaming when provided', async () => {
    const answers: InitAnswers = { ...defaultAnswers, fileNaming: 'kebab-case' };
    await runInit(tmpDir, answers);
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8'));
    expect(config.fileNaming).toBe('kebab-case');
  });

  it('omits fileNaming when not provided', async () => {
    await runInit(tmpDir, defaultAnswers);
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8'));
    expect(config.fileNaming).toBeUndefined();
  });

  it('includes database when not "none"', async () => {
    const answers: InitAnswers = { ...defaultAnswers, database: 'PostgreSQL' };
    await runInit(tmpDir, answers);
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8'));
    expect(config.database).toBe('PostgreSQL');
  });

  it('omits database when "none"', async () => {
    await runInit(tmpDir, defaultAnswers);
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8'));
    expect(config.database).toBeUndefined();
  });

  it('includes model when provided', async () => {
    const answers: InitAnswers = { ...defaultAnswers, model: 'claude-sonnet-4-5-20250514' };
    await runInit(tmpDir, answers);
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8'));
    expect(config.model).toBe('claude-sonnet-4-5-20250514');
  });

  it('omits model when not provided', async () => {
    await runInit(tmpDir, defaultAnswers);
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8'));
    expect(config.model).toBeUndefined();
  });

  it('respects overwrite flag for ralph.config.json', async () => {
    fs.writeFileSync(path.join(tmpDir, 'ralph.config.json'), '{"existing": true}');
    const result = await runInit(tmpDir, defaultAnswers);
    expect(result.skipped).toContain('ralph.config.json');
    const content = fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8');
    expect(content).toBe('{"existing": true}');
  });

  it('overwrites ralph.config.json when overwrite is true', async () => {
    fs.writeFileSync(path.join(tmpDir, 'ralph.config.json'), '{"existing": true}');
    const result = await runInit(tmpDir, { ...defaultAnswers, overwrite: true });
    expect(result.created).toContain('ralph.config.json');
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8'));
    expect(config.language).toBe('TypeScript');
  });
});

describe('run (CLI entry point)', () => {
  it('exports a run function', async () => {
    const mod = await import('../commands/init.js');
    expect(typeof mod.run).toBe('function');
  });
});
