import { describe, it, expect } from 'vitest';
import { generateBootPrompt } from '../commands/loop/prompt-generator.js';
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
};

const mockConfig: ProjectConfig = {
  language: 'TypeScript',
  fileNaming: 'kebab-case',
  packageManager: 'pnpm',
  testingFramework: 'Vitest',
  qualityCheck: 'pnpm check',
  testCommand: 'pnpm test',
  database: undefined,
};

describe('PromptGenerator', () => {
  describe('generateBootPrompt', () => {
    it('includes the task ID and title', () => {
      const prompt = generateBootPrompt(mockTask, mockConfig);
      expect(prompt).toContain('T-005');
      expect(prompt).toContain('Build feature X');
    });

    it('includes PRD reference', () => {
      const prompt = generateBootPrompt(mockTask, mockConfig);
      expect(prompt).toContain('§3.1');
    });

    it('includes project config values', () => {
      const prompt = generateBootPrompt(mockTask, mockConfig);
      expect(prompt).toContain('TypeScript');
      expect(prompt).toContain('pnpm');
      expect(prompt).toContain('Vitest');
      expect(prompt).toContain('pnpm check');
    });

    it('includes TDD methodology instructions', () => {
      const prompt = generateBootPrompt(mockTask, mockConfig);
      expect(prompt).toContain('red');
      expect(prompt).toContain('green');
      expect(prompt).toContain('TDD');
    });

    it('includes quality gate instructions', () => {
      const prompt = generateBootPrompt(mockTask, mockConfig);
      expect(prompt).toContain('pnpm check');
      expect(prompt.toLowerCase()).toContain('quality');
    });

    it('includes one-commit-per-task rule', () => {
      const prompt = generateBootPrompt(mockTask, mockConfig);
      expect(prompt).toContain('ONE commit per task');
    });

    it('includes task file update instructions', () => {
      const prompt = generateBootPrompt(mockTask, mockConfig);
      expect(prompt).toContain('Status');
      expect(prompt).toContain('DONE');
      expect(prompt).toContain('same commit');
    });

    it('includes commit message format', () => {
      const prompt = generateBootPrompt(mockTask, mockConfig);
      expect(prompt).toContain('T-NNN:');
    });

    it('includes tool usage rules', () => {
      const prompt = generateBootPrompt(mockTask, mockConfig);
      expect(prompt).toContain('Read tool');
      expect(prompt).toContain('Grep');
    });

    it('includes phase logging instructions', () => {
      const prompt = generateBootPrompt(mockTask, mockConfig);
      expect(prompt).toContain('[PHASE]');
      expect(prompt).toContain('Boot');
      expect(prompt).toContain('Red');
      expect(prompt).toContain('Green');
      expect(prompt).toContain('Verify');
      expect(prompt).toContain('Commit');
    });

    it('includes bash timeout guidance', () => {
      const prompt = generateBootPrompt(mockTask, mockConfig);
      expect(prompt).toContain('120000ms');
      expect(prompt).toContain('120 seconds');
      expect(prompt).toContain('timeout');
    });

    it('includes file naming when configured', () => {
      const prompt = generateBootPrompt(mockTask, mockConfig);
      expect(prompt).toContain('kebab-case');
    });

    it('excludes file naming when not configured', () => {
      const configNoNaming = { ...mockConfig, fileNaming: undefined };
      const prompt = generateBootPrompt(mockTask, configNoNaming);
      expect(prompt).not.toContain('File naming');
    });

    it('includes database when configured', () => {
      const configWithDb = { ...mockConfig, database: 'PostgreSQL' };
      const prompt = generateBootPrompt(mockTask, configWithDb);
      expect(prompt).toContain('PostgreSQL');
    });

    it('excludes database when not configured', () => {
      const prompt = generateBootPrompt(mockTask, mockConfig);
      expect(prompt).not.toContain('Database');
    });
  });
});
