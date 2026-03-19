const COMMANDS = [
  'init',
  'loop',
  'monitor',
  'kill',
  'milestones',
  'shas',
  'cost',
  'update',
  'retry',
  'review',
  'show',
  'task',
  'migrate',
] as const;
type Command = (typeof COMMANDS)[number];

export type DispatchResult =
  | { action: 'help'; unknown?: string; command?: Command }
  | { action: 'version' }
  | { action: Command; args: string[] };

export function dispatch(argv: string[]): DispatchResult {
  const first = argv[0];

  if (!first || first === '--help' || first === '-h') {
    return { action: 'help' };
  }

  if (first === '--version' || first === '-V') {
    return { action: 'version' };
  }

  if (COMMANDS.includes(first as Command)) {
    const args = argv.slice(1);
    if (args.includes('--help') || args.includes('-h')) {
      return { action: 'help', command: first as Command };
    }
    return { action: first as Command, args };
  }

  return { action: 'help', unknown: first };
}

export function formatHelp(unknown?: string): string {
  const lines: string[] = [];

  if (unknown) {
    lines.push(`Unknown command: ${unknown}`);
    lines.push('');
  }

  lines.push('Usage: ralph <command> [options]');
  lines.push('');
  lines.push('Commands:');
  lines.push('  init        Bootstrap a new Ralph project');
  lines.push('  loop        Run the AI development loop');
  lines.push('  monitor     Show real-time progress');
  lines.push('  kill        Stop ralph and all child processes');
  lines.push('  milestones  Generate milestones summary');
  lines.push('  shas        Backfill commit SHAs in task files');
  lines.push('  cost        Calculate token usage and costs');
  lines.push('  update      (deprecated) Built-in templates are now automatic');
  lines.push('  retry       Retry BLOCKED tasks from scratch');
  lines.push('  review      Analyze task execution and diagnose failures');
  lines.push('  show        Display effective prompt content');
  lines.push('  task        Scaffold a new task file');
  lines.push('  migrate     Clean up legacy prompt files');

  return lines.join('\n');
}

const COMMAND_HELP: Record<Command, { description: string; usage: string }> = {
  init: {
    description: 'Bootstrap a new Ralph project',
    usage: 'ralph init',
  },
  loop: {
    description: 'Run the AI development loop',
    usage: 'ralph loop [options]',
  },
  monitor: {
    description: 'Show real-time progress',
    usage: 'ralph monitor',
  },
  kill: {
    description: 'Stop ralph and all child processes',
    usage: 'ralph kill',
  },
  milestones: {
    description: 'Generate milestones summary',
    usage: 'ralph milestones',
  },
  shas: {
    description: 'Backfill commit SHAs in task files',
    usage: 'ralph shas',
  },
  cost: {
    description: 'Calculate token usage and costs',
    usage: 'ralph cost',
  },
  update: {
    description: '(Deprecated) Built-in templates are now automatic',
    usage: 'ralph update',
  },
  retry: {
    description: 'Retry BLOCKED tasks from scratch',
    usage: 'ralph retry <task-id> [task-id ...]',
  },
  review: {
    description: 'Analyze task execution and diagnose failures',
    usage:
      'ralph review <task-id> [--diagnose] [--json] [--verbose] | ralph review --coach [--json]',
  },
  show: {
    description: 'Display effective prompt content',
    usage: 'ralph show <subcommand> [--json] [--built-in-only]',
  },
  task: {
    description: 'Scaffold a new task file',
    usage:
      'ralph task "Title" [--depends <ids>] [--complexity <tier>] [--milestone <name>] [--prd-ref <refs>] [--touches <paths>] [--roles <names>] [--dry-run]',
  },
  migrate: {
    description: 'Clean up legacy prompt files from pre-built-in-first projects',
    usage: 'ralph migrate [--dry-run] [--force]',
  },
};

export function formatCommandHelp(command: Command): string {
  const info = COMMAND_HELP[command];
  const lines: string[] = [];
  lines.push(info.description);
  lines.push('');
  lines.push(`Usage: ${info.usage}`);
  return lines.join('\n');
}
