import type { InitConfig } from './claude-md.js';

export function generateGeminiMd(config: InitConfig): string {
  const lines: string[] = [
    `# ${config.projectName} — Gemini CLI Instructions`,
    '',
    '## Project Goal',
    '',
    `Build ${config.projectName}.`,
    'Requirements are defined in `docs/PRD.md`.',
    '',
    '## Methodology',
    '',
    'Follow the Ralph Methodology defined in `docs/RALPH-METHODOLOGY.md`.',
    '',
    '## Project-Specific Config',
    '',
    `- **Language**: ${config.language}`,
  ];

  if (config.fileNaming) {
    lines.push(`- **File naming**: ${config.fileNaming}`);
  }

  lines.push(
    `- **Package manager**: ${config.packageManager}`,
    `- **Testing framework**: ${config.testingFramework}`,
    `- **Quality check**: \`${config.qualityCheck}\``,
    `- **Test command**: \`${config.testCommand}\``,
  );

  if (config.database) {
    lines.push(`- **Database**: ${config.database}`);
  }

  lines.push('');

  return lines.join('\n');
}
