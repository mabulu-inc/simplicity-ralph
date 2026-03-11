export function defaultRulesTemplate(): string {
  return `# Project Rules

<!-- Add your project-specific rules below. These are injected into every boot prompt
     via the {{project.rules}} template variable. They apply to every task and every agent. -->

## Examples

- All production code goes under \`src/\`
- Tests go under \`src/__tests__/\`
- Do not use library X
- Prefer Y over Z for async operations
`;
}
