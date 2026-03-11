import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerProvider,
  getProvider,
  listProviders,
  resetRegistry,
  type AgentProvider,
} from '../core/agent-provider.js';

describe('agent-provider registry', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('registers and retrieves a provider by name', () => {
    const provider: AgentProvider = {
      binary: 'test-agent',
      outputFormat: ['--json'],
      supportsMaxTurns: false,
      instructionsFile: 'TEST.md',
      buildArgs: () => [],
      parseOutput: (raw) => raw,
    };

    registerProvider('test', provider);
    expect(getProvider('test')).toBe(provider);
  });

  it('throws when retrieving an unregistered provider', () => {
    expect(() => getProvider('nonexistent')).toThrow('Unknown agent provider: nonexistent');
  });

  it('throws when registering a duplicate provider name', () => {
    const provider: AgentProvider = {
      binary: 'test-agent',
      outputFormat: [],
      supportsMaxTurns: false,
      instructionsFile: 'TEST.md',
      buildArgs: () => [],
      parseOutput: (raw) => raw,
    };

    registerProvider('test', provider);
    expect(() => registerProvider('test', provider)).toThrow(
      'Provider "test" is already registered',
    );
  });

  it('lists all registered provider names', () => {
    const provider: AgentProvider = {
      binary: 'a',
      outputFormat: [],
      supportsMaxTurns: false,
      instructionsFile: 'A.md',
      buildArgs: () => [],
      parseOutput: (raw) => raw,
    };

    registerProvider('alpha', provider);
    registerProvider('beta', { ...provider, binary: 'b' });

    const names = listProviders();
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    expect(names).toHaveLength(2);
  });

  it('resetRegistry clears all providers', () => {
    const provider: AgentProvider = {
      binary: 'test',
      outputFormat: [],
      supportsMaxTurns: false,
      instructionsFile: 'T.md',
      buildArgs: () => [],
      parseOutput: (raw) => raw,
    };

    registerProvider('test', provider);
    resetRegistry();
    expect(() => getProvider('test')).toThrow();
    expect(listProviders()).toHaveLength(0);
  });
});

describe('AgentProvider interface', () => {
  it('buildArgs produces correct args structure', () => {
    const provider: AgentProvider = {
      binary: 'my-agent',
      outputFormat: ['--output-format', 'json'],
      supportsMaxTurns: true,
      instructionsFile: '.my-agent/config.md',
      buildArgs: (prompt, options) => {
        const args = ['-p', prompt, ...options.outputFormat];
        if (options.maxTurns !== undefined) {
          args.push('--max-turns', String(options.maxTurns));
        }
        if (options.model) {
          args.push('--model', options.model);
        }
        return args;
      },
      parseOutput: (raw) => raw,
    };

    const args = provider.buildArgs('do stuff', {
      outputFormat: ['--output-format', 'json'],
      maxTurns: 50,
      model: 'my-model',
    });

    expect(args).toEqual([
      '-p',
      'do stuff',
      '--output-format',
      'json',
      '--max-turns',
      '50',
      '--model',
      'my-model',
    ]);
  });

  it('parseOutput passes through raw output', () => {
    const provider: AgentProvider = {
      binary: 'agent',
      outputFormat: [],
      supportsMaxTurns: false,
      instructionsFile: 'AGENT.md',
      buildArgs: () => [],
      parseOutput: (raw) => `parsed: ${raw}`,
    };

    expect(provider.parseOutput('hello')).toBe('parsed: hello');
  });
});
