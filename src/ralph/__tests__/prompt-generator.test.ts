import { describe, it, expect } from 'vitest';
import { defaultBootPromptTemplate } from '../templates/boot-prompt.js';

describe('defaultBootPromptTemplate', () => {
  it('returns a non-empty string', () => {
    const template = defaultBootPromptTemplate();
    expect(template.length).toBeGreaterThan(0);
  });

  it('contains task variable placeholders', () => {
    const template = defaultBootPromptTemplate();
    expect(template).toContain('{{task.id}}');
    expect(template).toContain('{{task.title}}');
    expect(template).toContain('{{task.description}}');
    expect(template).toContain('{{task.prdReference}}');
  });

  it('contains config variable placeholders', () => {
    const template = defaultBootPromptTemplate();
    expect(template).toContain('{{config.language}}');
    expect(template).toContain('{{config.packageManager}}');
    expect(template).toContain('{{config.testingFramework}}');
    expect(template).toContain('{{config.qualityCheck}}');
    expect(template).toContain('{{config.testCommand}}');
  });

  it('contains optional config placeholders', () => {
    const template = defaultBootPromptTemplate();
    expect(template).toContain('{{config.fileNaming}}');
    expect(template).toContain('{{config.database}}');
  });

  it('contains phase logging instructions', () => {
    const template = defaultBootPromptTemplate();
    expect(template).toContain('[PHASE]');
    expect(template).toContain('Boot');
    expect(template).toContain('Red');
    expect(template).toContain('Green');
    expect(template).toContain('Verify');
    expect(template).toContain('Commit');
  });

  it('contains TDD methodology instructions', () => {
    const template = defaultBootPromptTemplate();
    expect(template).toContain('red');
    expect(template).toContain('green');
    expect(template).toContain('TDD');
  });

  it('contains quality gate instructions', () => {
    const template = defaultBootPromptTemplate();
    expect(template.toLowerCase()).toContain('quality');
  });

  it('contains one-commit-per-task rule', () => {
    const template = defaultBootPromptTemplate();
    expect(template).toContain('ONE commit per task');
  });

  it('contains tool usage rules', () => {
    const template = defaultBootPromptTemplate();
    expect(template).toContain('Read tool');
    expect(template).toContain('Grep');
  });

  it('contains bash timeout guidance', () => {
    const template = defaultBootPromptTemplate();
    expect(template).toContain('120000ms');
    expect(template).toContain('120 seconds');
  });

  it('contains commit message format', () => {
    const template = defaultBootPromptTemplate();
    expect(template).toContain('T-NNN:');
  });

  it('contains {{project.rules}} placeholder', () => {
    const template = defaultBootPromptTemplate();
    expect(template).toContain('{{project.rules}}');
  });

  it('places {{project.rules}} after PROJECT CONFIG and before WORKFLOW', () => {
    const template = defaultBootPromptTemplate();
    const configIdx = template.indexOf('PROJECT CONFIG');
    const rulesIdx = template.indexOf('{{project.rules}}');
    const workflowIdx = template.indexOf('WORKFLOW:');
    expect(configIdx).toBeLessThan(rulesIdx);
    expect(rulesIdx).toBeLessThan(workflowIdx);
  });
});
