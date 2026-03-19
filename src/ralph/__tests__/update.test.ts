import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runUpdate, run } from '../commands/update.js';

describe('runUpdate', () => {
  it('returns a deprecation message', async () => {
    const result = await runUpdate('/tmp/fake-project');
    expect(result.deprecated).toBe(true);
    expect(result.message).toContain('no longer needed');
  });
});

describe('run', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints deprecation message to console', async () => {
    await run([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('no longer needed'));
  });
});
