import type { InitConfig } from './claude-md.js';

export function generateContinueYaml(config: InitConfig): string {
  return [
    `# ${config.projectName} — Continue CLI Configuration`,
    '',
    'name: ralph',
    'customInstructions: |',
    `  Build ${config.projectName}.`,
    '  Requirements are defined in `docs/PRD.md`.',
    '  Follow the Ralph Methodology defined in `docs/RALPH-METHODOLOGY.md`.',
    '',
  ].join('\n');
}
