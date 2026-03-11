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
    expect(content).toContain('**Language**: TypeScript');
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

  it('passes database config to templates when not "none"', async () => {
    const answers: InitAnswers = { ...defaultAnswers, database: 'PostgreSQL via Docker' };
    await runInit(tmpDir, answers);
    const claudeMd = fs.readFileSync(path.join(tmpDir, '.claude', 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain('PostgreSQL via Docker');
    const task = fs.readFileSync(path.join(tmpDir, 'docs', 'tasks', 'T-000.md'), 'utf-8');
    expect(task).toContain('PostgreSQL');
  });

  it('omits database from config when "none"', async () => {
    await runInit(tmpDir, defaultAnswers);
    const claudeMd = fs.readFileSync(path.join(tmpDir, '.claude', 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).not.toContain('Database');
  });

  it('includes file naming in config when provided', async () => {
    const answers: InitAnswers = { ...defaultAnswers, fileNaming: 'kebab-case' };
    await runInit(tmpDir, answers);
    const claudeMd = fs.readFileSync(path.join(tmpDir, '.claude', 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain('**File naming**: kebab-case');
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

describe('run (CLI entry point)', () => {
  it('exports a run function', async () => {
    const mod = await import('../commands/init.js');
    expect(typeof mod.run).toBe('function');
  });
});
