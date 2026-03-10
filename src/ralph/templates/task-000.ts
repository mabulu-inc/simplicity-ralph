import type { InitConfig } from './claude-md.js';

export function generateTask000(config: InitConfig): string {
  const lines: string[] = [
    '# T-000: Infrastructure bootstrap',
    '',
    '- **Status**: TODO',
    '- **Milestone**: 0 — Infrastructure',
    '- **Depends**: none',
    '- **PRD Reference**: §1',
    '',
    '## Description',
    '',
    `Set up the ${config.language} project infrastructure with quality tooling.`,
    '',
    '**Setup:**',
    '',
    `- Initialize ${config.language} project with ${config.packageManager}`,
    `- Configure ${config.testingFramework} for testing`,
  ];

  const isNode =
    config.language.toLowerCase().includes('typescript') ||
    config.language.toLowerCase().includes('javascript');

  if (isNode) {
    lines.push(
      '- Set up ESLint for linting',
      '- Set up Prettier for formatting',
      '- Configure husky + lint-staged for pre-commit hooks',
    );
  }

  lines.push(
    `- Create \`${config.qualityCheck}\` script that runs: lint → format → typecheck → build → test:coverage`,
  );

  if (config.database) {
    lines.push(
      '',
      '**Database:**',
      '',
      `- Set up Docker Compose for ${config.database}`,
      '- Configure connection and health check',
    );
  }

  lines.push(
    '',
    '## Produces',
    '',
    '- Project configuration files',
    `- ${config.testingFramework} configuration`,
    `- Quality check script (\`${config.qualityCheck}\`)`,
  );

  if (isNode) {
    lines.push('- ESLint + Prettier configuration', '- husky + lint-staged setup');
  }

  if (config.database) {
    lines.push('- Docker Compose configuration');
  }

  lines.push('- A passing `' + config.qualityCheck + '` run', '');

  return lines.join('\n');
}
