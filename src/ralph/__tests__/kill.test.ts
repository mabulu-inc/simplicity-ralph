import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as processModule from '../core/process.js';

vi.mock('../core/process.js', () => ({
  findProcessesByPattern: vi.fn(),
  killProcessTree: vi.fn(),
}));

const findProcessesByPattern = vi.mocked(processModule.findProcessesByPattern);
const killProcessTree = vi.mocked(processModule.killProcessTree);

// Dynamic import so the mock is in place
async function loadKill() {
  const mod = await import('../commands/kill.js');
  return mod.run;
}

describe('ralph kill', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('reports "Ralph is not running" when no processes found', async () => {
    findProcessesByPattern.mockResolvedValue([]);
    const run = await loadKill();
    await run([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
  });

  it('searches for ralph loop and claude patterns', async () => {
    findProcessesByPattern.mockResolvedValue([]);
    const run = await loadKill();
    await run([]);
    expect(findProcessesByPattern).toHaveBeenCalledWith('ralph loop');
    expect(findProcessesByPattern).toHaveBeenCalledWith('claude');
  });

  it('kills found processes and reports them', async () => {
    findProcessesByPattern.mockResolvedValueOnce([1234]).mockResolvedValueOnce([5678, 9012]);
    killProcessTree.mockResolvedValue(undefined);

    const run = await loadKill();
    await run([]);

    expect(killProcessTree).toHaveBeenCalledWith(1234);
    expect(killProcessTree).toHaveBeenCalledWith(5678);
    expect(killProcessTree).toHaveBeenCalledWith(9012);
    expect(killProcessTree).toHaveBeenCalledTimes(3);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Killed 3'));
  });

  it('deduplicates PIDs found by multiple patterns', async () => {
    findProcessesByPattern.mockResolvedValueOnce([1234]).mockResolvedValueOnce([1234, 5678]);
    killProcessTree.mockResolvedValue(undefined);

    const run = await loadKill();
    await run([]);

    expect(killProcessTree).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Killed 2'));
  });

  it('reports errors for individual process kills without failing', async () => {
    findProcessesByPattern.mockResolvedValueOnce([1234]).mockResolvedValueOnce([]);
    killProcessTree.mockRejectedValueOnce(new Error('EPERM'));

    const run = await loadKill();
    await run([]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('1234'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Killed 0'));
  });

  it('handles non-Error throws gracefully', async () => {
    findProcessesByPattern.mockResolvedValueOnce([999]).mockResolvedValueOnce([]);
    killProcessTree.mockRejectedValueOnce('string error');

    const run = await loadKill();
    await run([]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('string error'));
  });

  it('uses singular "process" when killing exactly one', async () => {
    findProcessesByPattern.mockResolvedValueOnce([42]).mockResolvedValueOnce([]);
    killProcessTree.mockResolvedValue(undefined);

    const run = await loadKill();
    await run([]);

    expect(logSpy).toHaveBeenCalledWith('Killed 1 process');
  });
});
