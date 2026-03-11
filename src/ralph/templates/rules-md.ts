import type { InitConfig } from './claude-md.js';

export function generateRules(config: InitConfig): string {
  const lines: string[] = [
    '# Project Rules',
    '',
    '<!-- These rules are injected into every boot prompt via {{project.rules}}.',
    '     They apply to every task and every agent. Edit freely. -->',
    '',
  ];

  lines.push('- Do NOT use TodoWrite — it wastes turns and provides no value in a stateless loop');
  lines.push(`- All production code goes under \`src/\``);
  lines.push(`- Tests go under \`src/__tests__/\``);

  if (config.fileNaming) {
    lines.push(`- File naming: ${config.fileNaming}`);
  }

  if (config.language.toLowerCase().includes('typescript')) {
    lines.push(
      '- Do NOT explore library internals (node_modules) unless a specific error requires it',
    );
  }

  if (!config.database) {
    lines.push('- No database required');
  }

  lines.push('');

  return lines.join('\n');
}

/** @deprecated Use generateRules(config) instead */
export function defaultRulesTemplate(): string {
  return generateRules({
    projectName: 'my-project',
    language: 'TypeScript',
    packageManager: 'pnpm',
    testingFramework: 'Vitest',
    qualityCheck: 'pnpm check',
    testCommand: 'pnpm test',
  });
}
