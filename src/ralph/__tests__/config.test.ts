import { describe, expect, it } from 'vitest';
import { parseConfig, readConfig } from '../core/config.js';

// --- Fixtures ---

const FULL_CONFIG = `# @smplcty/ralph — Claude Code Instructions

## Project Goal

Build a CLI tool.

## Methodology

Follow the Ralph Methodology defined in \`docs/RALPH-METHODOLOGY.md\`.

## Project-Specific Config

- **Language**: TypeScript (strict mode)
- **File naming**: kebab-case
- **Package manager**: pnpm
- **Testing framework**: Vitest
- **Quality check**: \`pnpm check\` (lint → format → typecheck → build → test:coverage)
- **Test command**: \`pnpm test\`
- **Database**: PostgreSQL via Docker on port 5433

## Project-Specific Rules

- Some rules here
`;

const MINIMAL_CONFIG = `# Project

## Project-Specific Config

- **Language**: Python
- **Package manager**: pip
- **Testing framework**: pytest
- **Quality check**: \`make check\`
- **Test command**: \`pytest\`
`;

const MISSING_REQUIRED = `# Project

## Project-Specific Config

- **Language**: Go
- **Package manager**: go
- **Testing framework**: go test
`;

const NO_CONFIG_SECTION = `# Project

## Some Other Section

Just some text.
`;

const BACKTICK_VALUES = `# Project

## Project-Specific Config

- **Language**: Rust
- **Package manager**: cargo
- **Testing framework**: cargo test
- **Quality check**: \`cargo clippy && cargo test\`
- **Test command**: \`cargo test\`
`;

// --- Tests ---

describe('parseConfig', () => {
  it('extracts all fields from a full config', () => {
    const config = parseConfig(FULL_CONFIG);
    expect(config).toEqual({
      language: 'TypeScript (strict mode)',
      fileNaming: 'kebab-case',
      packageManager: 'pnpm',
      testingFramework: 'Vitest',
      qualityCheck: 'pnpm check',
      testCommand: 'pnpm test',
      database: 'PostgreSQL via Docker on port 5433',
      agent: undefined,
      model: undefined,
      maxRetries: 3,
      maxCostPerTask: 10,
      maxLoopBudget: 100,
    });
  });

  it('parses minimal config with only required fields', () => {
    const config = parseConfig(MINIMAL_CONFIG);
    expect(config).toEqual({
      language: 'Python',
      fileNaming: undefined,
      packageManager: 'pip',
      testingFramework: 'pytest',
      qualityCheck: 'make check',
      testCommand: 'pytest',
      database: undefined,
      agent: undefined,
      model: undefined,
      maxRetries: 3,
      maxCostPerTask: 10,
      maxLoopBudget: 100,
    });
  });

  it('extracts command values from backticks', () => {
    const config = parseConfig(BACKTICK_VALUES);
    expect(config.qualityCheck).toBe('cargo clippy && cargo test');
    expect(config.testCommand).toBe('cargo test');
  });

  it('returns undefined optional fields when not present', () => {
    const config = parseConfig(MINIMAL_CONFIG);
    expect(config.fileNaming).toBeUndefined();
    expect(config.database).toBeUndefined();
  });

  it('throws when quality check is missing', () => {
    expect(() => parseConfig(MISSING_REQUIRED)).toThrow('Quality check');
  });

  it('throws when test command is missing', () => {
    const content = `# Project

## Project-Specific Config

- **Language**: Go
- **Package manager**: go
- **Testing framework**: go test
- **Quality check**: \`go vet\`
`;
    expect(() => parseConfig(content)).toThrow('Test command');
  });

  it('throws when no Project-Specific Config section exists', () => {
    expect(() => parseConfig(NO_CONFIG_SECTION)).toThrow('Project-Specific Config');
  });

  it('throws when language is missing', () => {
    const content = `# Project

## Project-Specific Config

- **Package manager**: npm
- **Testing framework**: jest
- **Quality check**: \`npm run check\`
- **Test command**: \`npm test\`
`;
    expect(() => parseConfig(content)).toThrow('Language');
  });

  it('throws when package manager is missing', () => {
    const content = `# Project

## Project-Specific Config

- **Language**: TypeScript
- **Testing framework**: jest
- **Quality check**: \`npm run check\`
- **Test command**: \`npm test\`
`;
    expect(() => parseConfig(content)).toThrow('Package manager');
  });

  it('throws when testing framework is missing', () => {
    const content = `# Project

## Project-Specific Config

- **Language**: TypeScript
- **Package manager**: npm
- **Quality check**: \`npm run check\`
- **Test command**: \`npm test\`
`;
    expect(() => parseConfig(content)).toThrow('Testing framework');
  });

  it('parses config with single asterisks (non-bold)', () => {
    const content = `# Project

## Project-Specific Config

- *Language*: Python
- *Package manager*: pip
- *Testing framework*: pytest
- *Quality check*: \`make check\`
- *Test command*: \`pytest\`
`;
    const config = parseConfig(content);
    expect(config.language).toBe('Python');
    expect(config.packageManager).toBe('pip');
    expect(config.testingFramework).toBe('pytest');
    expect(config.qualityCheck).toBe('make check');
    expect(config.testCommand).toBe('pytest');
  });

  it('parses config with extra whitespace', () => {
    const content = `# Project

## Project-Specific Config

-  **Language**:   TypeScript
-  **Package manager**:   pnpm
-  **Testing framework**:   Vitest
-  **Quality check**:   \`pnpm check\`
-  **Test command**:   \`pnpm test\`
`;
    const config = parseConfig(content);
    expect(config.language).toBe('TypeScript');
    expect(config.packageManager).toBe('pnpm');
    expect(config.testingFramework).toBe('Vitest');
    expect(config.qualityCheck).toBe('pnpm check');
    expect(config.testCommand).toBe('pnpm test');
  });

  it('parses config with underscore bold syntax', () => {
    const content = `# Project

## Project-Specific Config

- __Language__: Go
- __Package manager__: go
- __Testing framework__: go test
- __Quality check__: \`go vet && go test\`
- __Test command__: \`go test\`
`;
    const config = parseConfig(content);
    expect(config.language).toBe('Go');
    expect(config.packageManager).toBe('go');
    expect(config.testingFramework).toBe('go test');
    expect(config.qualityCheck).toBe('go vet && go test');
    expect(config.testCommand).toBe('go test');
  });
});

describe('readConfig', () => {
  it('reads from ralph.config.json when it exists', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = await mkdtemp(join(tmpdir(), 'ralph-config-'));
    const configData = {
      language: 'Go',
      packageManager: 'go',
      testingFramework: 'go test',
      qualityCheck: 'go vet && go test',
      testCommand: 'go test',
      agent: 'gemini',
    };
    await writeFile(join(dir, 'ralph.config.json'), JSON.stringify(configData));

    try {
      const config = await readConfig(dir);
      expect(config.language).toBe('Go');
      expect(config.packageManager).toBe('go');
      expect(config.testingFramework).toBe('go test');
      expect(config.qualityCheck).toBe('go vet && go test');
      expect(config.testCommand).toBe('go test');
      expect(config.agent).toBe('gemini');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('includes optional fields from ralph.config.json', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = await mkdtemp(join(tmpdir(), 'ralph-config-'));
    const configData = {
      language: 'TypeScript',
      packageManager: 'pnpm',
      testingFramework: 'Vitest',
      qualityCheck: 'pnpm check',
      testCommand: 'pnpm test',
      agent: 'claude',
      model: 'claude-sonnet-4-5-20250514',
      fileNaming: 'kebab-case',
      database: 'PostgreSQL',
    };
    await writeFile(join(dir, 'ralph.config.json'), JSON.stringify(configData));

    try {
      const config = await readConfig(dir);
      expect(config.fileNaming).toBe('kebab-case');
      expect(config.database).toBe('PostgreSQL');
      expect(config.agent).toBe('claude');
      expect(config.model).toBe('claude-sonnet-4-5-20250514');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to .claude/CLAUDE.md when ralph.config.json does not exist', async () => {
    const { mkdtemp, writeFile, rm, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = await mkdtemp(join(tmpdir(), 'ralph-config-'));
    const claudeDir = join(dir, '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, 'CLAUDE.md'), MINIMAL_CONFIG);

    try {
      const config = await readConfig(dir);
      expect(config.language).toBe('Python');
      expect(config.packageManager).toBe('pip');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws when neither ralph.config.json nor CLAUDE.md exist', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = await mkdtemp(join(tmpdir(), 'ralph-config-'));
    try {
      await expect(readConfig(dir)).rejects.toThrow(/ralph\.config\.json.*CLAUDE\.md|config/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads maxRetries from ralph.config.json', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = await mkdtemp(join(tmpdir(), 'ralph-config-'));
    const configData = {
      language: 'TypeScript',
      packageManager: 'pnpm',
      testingFramework: 'Vitest',
      qualityCheck: 'pnpm check',
      testCommand: 'pnpm test',
      maxRetries: 5,
    };
    await writeFile(join(dir, 'ralph.config.json'), JSON.stringify(configData));

    try {
      const config = await readConfig(dir);
      expect(config.maxRetries).toBe(5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('defaults maxRetries to 3 when not set in ralph.config.json', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = await mkdtemp(join(tmpdir(), 'ralph-config-'));
    const configData = {
      language: 'TypeScript',
      packageManager: 'pnpm',
      testingFramework: 'Vitest',
      qualityCheck: 'pnpm check',
      testCommand: 'pnpm test',
    };
    await writeFile(join(dir, 'ralph.config.json'), JSON.stringify(configData));

    try {
      const config = await readConfig(dir);
      expect(config.maxRetries).toBe(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads maxCostPerTask from ralph.config.json', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = await mkdtemp(join(tmpdir(), 'ralph-config-'));
    const configData = {
      language: 'TypeScript',
      packageManager: 'pnpm',
      testingFramework: 'Vitest',
      qualityCheck: 'pnpm check',
      testCommand: 'pnpm test',
      maxCostPerTask: 5,
    };
    await writeFile(join(dir, 'ralph.config.json'), JSON.stringify(configData));

    try {
      const config = await readConfig(dir);
      expect(config.maxCostPerTask).toBe(5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads maxLoopBudget from ralph.config.json', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = await mkdtemp(join(tmpdir(), 'ralph-config-'));
    const configData = {
      language: 'TypeScript',
      packageManager: 'pnpm',
      testingFramework: 'Vitest',
      qualityCheck: 'pnpm check',
      testCommand: 'pnpm test',
      maxLoopBudget: 50,
    };
    await writeFile(join(dir, 'ralph.config.json'), JSON.stringify(configData));

    try {
      const config = await readConfig(dir);
      expect(config.maxLoopBudget).toBe(50);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('defaults maxCostPerTask to 10 when not set', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = await mkdtemp(join(tmpdir(), 'ralph-config-'));
    const configData = {
      language: 'TypeScript',
      packageManager: 'pnpm',
      testingFramework: 'Vitest',
      qualityCheck: 'pnpm check',
      testCommand: 'pnpm test',
    };
    await writeFile(join(dir, 'ralph.config.json'), JSON.stringify(configData));

    try {
      const config = await readConfig(dir);
      expect(config.maxCostPerTask).toBe(10);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('defaults maxLoopBudget to 100 when not set', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = await mkdtemp(join(tmpdir(), 'ralph-config-'));
    const configData = {
      language: 'TypeScript',
      packageManager: 'pnpm',
      testingFramework: 'Vitest',
      qualityCheck: 'pnpm check',
      testCommand: 'pnpm test',
    };
    await writeFile(join(dir, 'ralph.config.json'), JSON.stringify(configData));

    try {
      const config = await readConfig(dir);
      expect(config.maxLoopBudget).toBe(100);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('validates required fields in ralph.config.json', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = await mkdtemp(join(tmpdir(), 'ralph-config-'));
    const configData = { language: 'Go' };
    await writeFile(join(dir, 'ralph.config.json'), JSON.stringify(configData));

    try {
      await expect(readConfig(dir)).rejects.toThrow(/packageManager|required/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
