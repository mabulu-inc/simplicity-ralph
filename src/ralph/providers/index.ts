import { registerProvider, listProviders, getProvider } from '../core/agent-provider.js';
import { claudeProvider } from './claude.js';

let initialized = false;

export function ensureProvidersRegistered(): void {
  if (initialized) return;
  registerProvider('claude', claudeProvider);
  initialized = true;
}

export function resetProviderInit(): void {
  initialized = false;
}

export { getProvider, listProviders };
