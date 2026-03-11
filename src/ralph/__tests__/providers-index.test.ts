import { describe, it, expect, beforeEach } from 'vitest';
import { resetRegistry, getProvider, listProviders } from '../core/agent-provider.js';
import { ensureProvidersRegistered, resetProviderInit } from '../providers/index.js';
import { claudeProvider } from '../providers/claude.js';

describe('ensureProvidersRegistered', () => {
  beforeEach(() => {
    resetRegistry();
    resetProviderInit();
  });

  it('registers the claude provider', () => {
    ensureProvidersRegistered();
    expect(getProvider('claude')).toBe(claudeProvider);
  });

  it('is idempotent — calling twice does not throw', () => {
    ensureProvidersRegistered();
    ensureProvidersRegistered();
    expect(listProviders()).toEqual(['claude']);
  });

  it('claude is the only built-in provider', () => {
    ensureProvidersRegistered();
    expect(listProviders()).toEqual(['claude']);
  });
});
