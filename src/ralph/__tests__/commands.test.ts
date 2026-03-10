import { describe, it, expect, vi } from 'vitest';
import { run as initRun } from '../commands/init.js';
import { run as loopRun } from '../commands/loop.js';
import { run as monitorRun } from '../commands/monitor.js';
import { run as milestonesRun } from '../commands/milestones.js';
import { run as shasRun } from '../commands/shas.js';
import { run as costRun } from '../commands/cost.js';

const stubs = [
  { name: 'init', run: initRun },
  { name: 'loop', run: loopRun },
  { name: 'monitor', run: monitorRun },
  { name: 'milestones', run: milestonesRun },
  { name: 'shas', run: shasRun },
  { name: 'cost', run: costRun },
] as const;

describe('command stubs', () => {
  it.each(stubs)('$name exports a run function that logs stub message', async ({ name, run }) => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining(name));
    spy.mockRestore();
  });
});
