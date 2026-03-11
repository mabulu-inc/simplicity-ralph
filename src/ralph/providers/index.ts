import { registerProvider, listProviders, getProvider } from '../core/agent-provider.js';
import { claudeProvider } from './claude.js';
import { geminiProvider } from './gemini.js';

let initialized = false;

export function ensureProvidersRegistered(): void {
  if (initialized) return;
  registerProvider('claude', claudeProvider);
  registerProvider('gemini', geminiProvider);
  initialized = true;
}

export function resetProviderInit(): void {
  initialized = false;
}

export { getProvider, listProviders };
