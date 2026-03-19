import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as readline from 'node:readline';
import { Readable, Writable } from 'node:stream';

import { runInit, loadExistingDefaults, prompt, type InitAnswers } from '../commands/init.js';

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

  it('does NOT create docs/RALPH-METHODOLOGY.md', async () => {
    await runInit(tmpDir, defaultAnswers);
    const filePath = path.join(tmpDir, 'docs', 'RALPH-METHODOLOGY.md');
    expect(fs.existsSync(filePath)).toBe(false);
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

  it('does NOT create docs/prompts/boot.md', async () => {
    await runInit(tmpDir, defaultAnswers);
    const filePath = path.join(tmpDir, 'docs', 'prompts', 'boot.md');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('does NOT create docs/prompts/system.md', async () => {
    await runInit(tmpDir, defaultAnswers);
    const filePath = path.join(tmpDir, 'docs', 'prompts', 'system.md');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('returns a summary of created files', async () => {
    const result = await runInit(tmpDir, defaultAnswers);
    expect(result.created).toContain('docs/PRD.md');
    expect(result.created).toContain('docs/tasks/T-000.md');
    expect(result.created).toContain('.claude/CLAUDE.md');
    expect(result.created).toContain('docs/prompts/rules.md');
    // Should NOT contain removed files
    expect(result.created).not.toContain('docs/RALPH-METHODOLOGY.md');
    expect(result.created).not.toContain('docs/prompts/boot.md');
    expect(result.created).not.toContain('docs/prompts/system.md');
    expect(result.created).not.toContain('docs/prompts/README.md');
    expect(result.skipped).toHaveLength(0);
    expect(result.overwritten).toHaveLength(0);
  });

  it('skips existing file with different content when no onConflict provided', async () => {
    const docsDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'PRD.md'), '# Existing PRD\n');

    const result = await runInit(tmpDir, defaultAnswers);
    expect(result.skipped).toContain('docs/PRD.md');
    expect(result.created).not.toContain('docs/PRD.md');
    expect(result.overwritten).not.toContain('docs/PRD.md');
    const content = fs.readFileSync(path.join(docsDir, 'PRD.md'), 'utf-8');
    expect(content).toBe('# Existing PRD\n');
  });

  it('skips silently when existing file content matches generated content', async () => {
    // First init to create files
    await runInit(tmpDir, defaultAnswers);
    const prdContent = fs.readFileSync(path.join(tmpDir, 'docs', 'PRD.md'), 'utf-8');

    // Second init — same answers, file content matches
    const onConflict = async () => true;
    const result = await runInit(tmpDir, defaultAnswers, { onConflict });
    // PRD.md should be skipped (unchanged), onConflict should NOT have been called for it
    expect(result.skipped).toContain('docs/PRD.md');
    expect(result.overwritten).not.toContain('docs/PRD.md');
    // Content should remain the same
    const content = fs.readFileSync(path.join(tmpDir, 'docs', 'PRD.md'), 'utf-8');
    expect(content).toBe(prdContent);
  });

  it('calls onConflict when file exists with different content', async () => {
    const docsDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'PRD.md'), '# Existing PRD\n');

    const conflictFiles: string[] = [];
    const onConflict = async (filePath: string) => {
      conflictFiles.push(filePath);
      return true;
    };

    const result = await runInit(tmpDir, defaultAnswers, { onConflict });
    expect(conflictFiles).toContain('docs/PRD.md');
    expect(result.overwritten).toContain('docs/PRD.md');
    expect(result.skipped).not.toContain('docs/PRD.md');
    const content = fs.readFileSync(path.join(docsDir, 'PRD.md'), 'utf-8');
    expect(content).toContain('# test-app');
  });

  it('skips file when onConflict returns false', async () => {
    const docsDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'PRD.md'), '# Existing PRD\n');

    const onConflict = async () => false;
    const result = await runInit(tmpDir, defaultAnswers, { onConflict });
    expect(result.skipped).toContain('docs/PRD.md');
    expect(result.overwritten).not.toContain('docs/PRD.md');
    const content = fs.readFileSync(path.join(docsDir, 'PRD.md'), 'utf-8');
    expect(content).toBe('# Existing PRD\n');
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

  it('includes maxCostPerTask in ralph.config.json when not default', async () => {
    const answers: InitAnswers = { ...defaultAnswers, maxCostPerTask: 5 };
    await runInit(tmpDir, answers);
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8'));
    expect(config.maxCostPerTask).toBe(5);
  });

  it('includes maxLoopBudget in ralph.config.json when not default', async () => {
    const answers: InitAnswers = { ...defaultAnswers, maxLoopBudget: 50 };
    await runInit(tmpDir, answers);
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8'));
    expect(config.maxLoopBudget).toBe(50);
  });

  it('omits maxCostPerTask from ralph.config.json when default (10)', async () => {
    const answers: InitAnswers = { ...defaultAnswers, maxCostPerTask: 10 };
    await runInit(tmpDir, answers);
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8'));
    expect(config.maxCostPerTask).toBeUndefined();
  });

  it('omits maxLoopBudget from ralph.config.json when default (100)', async () => {
    const answers: InitAnswers = { ...defaultAnswers, maxLoopBudget: 100 };
    await runInit(tmpDir, answers);
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8'));
    expect(config.maxLoopBudget).toBeUndefined();
  });

  it('skips unchanged ralph.config.json silently on re-init', async () => {
    await runInit(tmpDir, defaultAnswers);
    const result = await runInit(tmpDir, defaultAnswers);
    expect(result.skipped).toContain('ralph.config.json');
    expect(result.overwritten).not.toContain('ralph.config.json');
  });

  it('detects changed ralph.config.json and calls onConflict', async () => {
    fs.writeFileSync(path.join(tmpDir, 'ralph.config.json'), '{"existing": true}');
    const onConflict = async () => true;
    const result = await runInit(tmpDir, defaultAnswers, { onConflict });
    expect(result.overwritten).toContain('ralph.config.json');
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8'));
    expect(config.language).toBe('TypeScript');
  });
});

describe('loadExistingDefaults', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('returns only projectName when no ralph.config.json exists', async () => {
    const defaults = await loadExistingDefaults(tmpDir);
    expect(defaults).toEqual({ projectName: path.basename(tmpDir) });
  });

  it('loads config values from ralph.config.json', async () => {
    const config = {
      language: 'Python',
      packageManager: 'pip',
      testingFramework: 'pytest',
      qualityCheck: 'make check',
      testCommand: 'pytest',
      agent: 'gemini',
      model: 'gemini-2.5-pro',
      fileNaming: 'snake_case',
      database: 'PostgreSQL',
    };
    fs.writeFileSync(path.join(tmpDir, 'ralph.config.json'), JSON.stringify(config));

    const defaults = await loadExistingDefaults(tmpDir);
    expect(defaults.language).toBe('Python');
    expect(defaults.packageManager).toBe('pip');
    expect(defaults.testingFramework).toBe('pytest');
    expect(defaults.qualityCheck).toBe('make check');
    expect(defaults.testCommand).toBe('pytest');
    expect(defaults.agent).toBe('gemini');
    expect(defaults.model).toBe('gemini-2.5-pro');
    expect(defaults.fileNaming).toBe('snake_case');
    expect(defaults.database).toBe('PostgreSQL');
  });

  it('falls back to package.json name for projectName', async () => {
    const pkg = { name: 'my-cool-app', version: '1.0.0' };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));

    const defaults = await loadExistingDefaults(tmpDir);
    expect(defaults.projectName).toBe('my-cool-app');
  });

  it('falls back to directory name for projectName when no package.json', async () => {
    const defaults = await loadExistingDefaults(tmpDir);
    expect(defaults.projectName).toBe(path.basename(tmpDir));
  });

  it('prefers package.json name over directory name', async () => {
    const pkg = { name: 'pkg-name', version: '1.0.0' };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));

    const defaults = await loadExistingDefaults(tmpDir);
    expect(defaults.projectName).toBe('pkg-name');
  });
});

describe('promptForAnswers includes fileNaming', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('fileNaming from answers flows into ralph.config.json', async () => {
    const answers: InitAnswers = { ...defaultAnswers, fileNaming: 'snake_case' };
    await runInit(tmpDir, answers);
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8'));
    expect(config.fileNaming).toBe('snake_case');
  });

  it('fileNaming from answers flows into rules.md', async () => {
    const answers: InitAnswers = { ...defaultAnswers, fileNaming: 'camelCase' };
    await runInit(tmpDir, answers);
    const rules = fs.readFileSync(path.join(tmpDir, 'docs', 'prompts', 'rules.md'), 'utf-8');
    expect(rules).toContain('camelCase');
  });

  it('empty fileNaming is omitted from config', async () => {
    const answers: InitAnswers = { ...defaultAnswers, fileNaming: '' };
    await runInit(tmpDir, answers);
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ralph.config.json'), 'utf-8'));
    expect(config.fileNaming).toBeUndefined();
  });
});

describe('run (CLI entry point)', () => {
  it('exports a run function', async () => {
    const mod = await import('../commands/init.js');
    expect(typeof mod.run).toBe('function');
  });
});

describe('prompt helper', () => {
  function createMockRl(answer: string): readline.Interface {
    const rl = readline.createInterface({
      input: new Readable({ read() {} }),
      output: new Writable({ write() {} }),
    });
    // Override question to immediately return the answer
    rl.question = ((_q: string, cb: (answer: string) => void) => {
      cb(answer);
    }) as typeof rl.question;
    return rl;
  }

  it('formats question with default value in brackets', async () => {
    const questions: string[] = [];
    const rl = createMockRl('');
    rl.question = ((q: string, cb: (answer: string) => void) => {
      questions.push(q);
      cb('');
    }) as typeof rl.question;

    await prompt(rl, 'Database', 'none');
    expect(questions[0]).toBe('Database [none]: ');
  });

  it('formats question with options list', async () => {
    const questions: string[] = [];
    const rl = createMockRl('');
    rl.question = ((q: string, cb: (answer: string) => void) => {
      questions.push(q);
      cb('');
    }) as typeof rl.question;

    await prompt(rl, 'Database', 'none', ['PostgreSQL', 'MySQL', 'SQLite', 'none']);
    expect(questions[0]).toBe('Database (PostgreSQL, MySQL, SQLite, none) [none]: ');
  });

  it('shows options and default separately', async () => {
    const questions: string[] = [];
    const rl = createMockRl('');
    rl.question = ((q: string, cb: (answer: string) => void) => {
      questions.push(q);
      cb('');
    }) as typeof rl.question;

    await prompt(rl, 'File naming convention', 'kebab-case', [
      'kebab-case',
      'snake_case',
      'camelCase',
    ]);
    const q = questions[0];
    // Options in parentheses, default in brackets
    expect(q).toBe('File naming convention (kebab-case, snake_case, camelCase) [kebab-case]: ');
  });

  it('returns default when user presses enter', async () => {
    const rl = createMockRl('');
    const result = await prompt(rl, 'Database', 'none');
    expect(result).toBe('none');
  });

  it('returns user input when provided', async () => {
    const rl = createMockRl('PostgreSQL');
    const result = await prompt(rl, 'Database', 'none');
    expect(result).toBe('PostgreSQL');
  });

  it('shows no default suffix when no default provided', async () => {
    const questions: string[] = [];
    const rl = createMockRl('');
    rl.question = ((q: string, cb: (answer: string) => void) => {
      questions.push(q);
      cb('');
    }) as typeof rl.question;

    await prompt(rl, 'Project name');
    // Should just end with ": " — no parenthetical
    expect(questions[0]).toBe('Project name: ');
  });
});
