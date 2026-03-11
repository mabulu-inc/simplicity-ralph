export interface InitConfig {
  projectName: string;
  language: string;
  packageManager: string;
  testingFramework: string;
  qualityCheck: string;
  testCommand: string;
  fileNaming?: string;
  database?: string;
}

export function generateClaudeMd(config: InitConfig): string {
  return [
    `# ${config.projectName} — Claude Code Instructions`,
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
  ].join('\n');
}
