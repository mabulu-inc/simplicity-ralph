import type { InitConfig } from './claude-md.js';

export function generateCursorRules(config: InitConfig): string {
  return [
    `# ${config.projectName} — Cursor CLI Instructions`,
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
