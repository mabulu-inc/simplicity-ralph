import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowPath = resolve(import.meta.dirname, '../../../.github/workflows/ci.yml');

function loadWorkflow(): Record<string, unknown> {
  const content = readFileSync(workflowPath, 'utf-8');
  return parse(content) as Record<string, unknown>;
}

describe('CI workflow', () => {
  it('is valid YAML', () => {
    expect(() => loadWorkflow()).not.toThrow();
  });

  it('has a descriptive name', () => {
    const workflow = loadWorkflow();
    expect(workflow.name).toBe('CI');
  });

  it('triggers on push to main', () => {
    const workflow = loadWorkflow();
    const on = workflow.on as Record<string, unknown>;
    const push = on.push as Record<string, unknown>;
    expect(push.branches).toContain('main');
  });

  it('triggers on pull requests', () => {
    const workflow = loadWorkflow();
    const on = workflow.on as Record<string, unknown>;
    expect(on.pull_request).toBeDefined();
  });

  it('has a single ci job', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    expect(jobs.ci).toBeDefined();
  });

  it('runs on ubuntu-latest', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    const ci = jobs.ci as Record<string, unknown>;
    expect(ci['runs-on']).toBe('ubuntu-latest');
  });

  it('uses Node.js 20', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    const ci = jobs.ci as Record<string, unknown>;
    const steps = ci.steps as Record<string, unknown>[];

    const setupNode = steps.find(
      (s) => typeof s.uses === 'string' && s.uses.includes('setup-node'),
    );
    expect(setupNode).toBeDefined();
    const nodeWith = setupNode!.with as Record<string, unknown>;
    expect(String(nodeWith['node-version'])).toBe('24');
  });

  it('installs pnpm', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    const ci = jobs.ci as Record<string, unknown>;
    const steps = ci.steps as Record<string, unknown>[];

    const pnpmStep = steps.find(
      (s) => typeof s.uses === 'string' && s.uses.includes('pnpm/action-setup'),
    );
    expect(pnpmStep).toBeDefined();
  });

  it('runs pnpm install with frozen lockfile', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    const ci = jobs.ci as Record<string, unknown>;
    const steps = ci.steps as Record<string, unknown>[];

    const installStep = steps.find(
      (s) => typeof s.run === 'string' && s.run.includes('pnpm install'),
    );
    expect(installStep).toBeDefined();
    expect(installStep!.run as string).toContain('--frozen-lockfile');
  });

  it('runs pnpm check', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    const ci = jobs.ci as Record<string, unknown>;
    const steps = ci.steps as Record<string, unknown>[];

    const checkStep = steps.find((s) => typeof s.run === 'string' && s.run.includes('pnpm check'));
    expect(checkStep).toBeDefined();
  });

  it('checks out code first', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    const ci = jobs.ci as Record<string, unknown>;
    const steps = ci.steps as Record<string, unknown>[];

    const checkoutStep = steps[0] as Record<string, unknown>;
    expect(typeof checkoutStep.uses === 'string' && checkoutStep.uses.includes('checkout')).toBe(
      true,
    );
  });
});
