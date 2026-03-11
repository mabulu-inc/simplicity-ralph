export interface BuildArgsOptions {
  outputFormat: string[];
  maxTurns?: number;
  model?: string;
}

export interface AgentProvider {
  readonly binary: string;
  readonly outputFormat: string[];
  readonly supportsMaxTurns: boolean;
  readonly instructionsFile: string;
  buildArgs(prompt: string, options: BuildArgsOptions): string[];
  parseOutput(raw: string): string;
}

const providers = new Map<string, AgentProvider>();

export function registerProvider(name: string, provider: AgentProvider): void {
  if (providers.has(name)) {
    throw new Error(`Provider "${name}" is already registered`);
  }
  providers.set(name, provider);
}

export function getProvider(name: string): AgentProvider {
  const provider = providers.get(name);
  if (!provider) {
    throw new Error(`Unknown agent provider: ${name}`);
  }
  return provider;
}

export function listProviders(): string[] {
  return [...providers.keys()];
}

export function resetRegistry(): void {
  providers.clear();
}
