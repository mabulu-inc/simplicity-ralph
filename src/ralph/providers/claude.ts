import type { AgentProvider, BuildArgsOptions } from '../core/agent-provider.js';

export const claudeProvider: AgentProvider = {
  binary: 'claude',
  outputFormat: ['--output-format', 'stream-json'],
  supportsMaxTurns: true,
  instructionsFile: '.claude/CLAUDE.md',

  buildArgs(prompt: string, options: BuildArgsOptions): string[] {
    const args = [
      '--print',
      '--verbose',
      ...options.outputFormat,
      '--dangerously-skip-permissions',
    ];

    if (options.maxTurns !== undefined) {
      args.push('--max-turns', String(options.maxTurns));
    }

    if (options.model) {
      args.push('--model', options.model);
    }

    args.push('-p', prompt);
    return args;
  },

  parseOutput(raw: string): string {
    return raw;
  },
};
