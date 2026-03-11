import { describe, it, expect } from 'vitest';
import { geminiProvider } from '../providers/gemini.js';

describe('geminiProvider', () => {
  it('has correct binary name', () => {
    expect(geminiProvider.binary).toBe('gemini');
  });

  it('has stream-json output format', () => {
    expect(geminiProvider.outputFormat).toEqual(['--output-format', 'stream-json']);
  });

  it('does not support max turns', () => {
    expect(geminiProvider.supportsMaxTurns).toBe(false);
  });

  it('has correct instructions file', () => {
    expect(geminiProvider.instructionsFile).toBe('GEMINI.md');
  });

  it('builds args for a basic prompt', () => {
    const args = geminiProvider.buildArgs('do something', {
      outputFormat: geminiProvider.outputFormat,
    });

    expect(args).toEqual(['-p', '--output-format', 'stream-json', 'do something']);
  });

  it('builds args with model override', () => {
    const args = geminiProvider.buildArgs('task', {
      outputFormat: geminiProvider.outputFormat,
      model: 'gemini-2.5-pro',
    });

    expect(args).toContain('--model');
    expect(args).toContain('gemini-2.5-pro');
  });

  it('ignores max turns even when provided', () => {
    const args = geminiProvider.buildArgs('task', {
      outputFormat: geminiProvider.outputFormat,
      maxTurns: 75,
    });

    expect(args).not.toContain('--max-turns');
    expect(args).not.toContain('75');
  });

  it('omits model when not provided', () => {
    const args = geminiProvider.buildArgs('task', {
      outputFormat: geminiProvider.outputFormat,
    });

    expect(args).not.toContain('--model');
  });

  it('parseOutput returns raw output unchanged', () => {
    expect(geminiProvider.parseOutput('some output')).toBe('some output');
  });
});
