import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowPath = resolve(import.meta.dirname, '../../../.github/workflows/publish.yml');

function loadWorkflow(): Record<string, unknown> {
  const content = readFileSync(workflowPath, 'utf-8');
  return parse(content) as Record<string, unknown>;
}

describe('Publish workflow', () => {
  it('is valid YAML', () => {
    expect(() => loadWorkflow()).not.toThrow();
  });

  it('has a descriptive name', () => {
    const workflow = loadWorkflow();
    expect(workflow.name).toBe('Publish');
  });

  it('triggers on push of version tags', () => {
    const workflow = loadWorkflow();
    const on = workflow.on as Record<string, unknown>;
    const push = on.push as Record<string, unknown>;
    const tags = push.tags as string[];
    expect(tags).toContain('v*');
  });

  it('has a publish job', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    expect(jobs.publish).toBeDefined();
  });

  it('runs on ubuntu-latest', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    const publish = jobs.publish as Record<string, unknown>;
    expect(publish['runs-on']).toBe('ubuntu-latest');
  });

  it('checks out code first', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    const publish = jobs.publish as Record<string, unknown>;
    const steps = publish.steps as Record<string, unknown>[];

    const checkoutStep = steps[0] as Record<string, unknown>;
    expect(typeof checkoutStep.uses === 'string' && checkoutStep.uses.includes('checkout')).toBe(
      true,
    );
  });

  it('installs pnpm', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    const publish = jobs.publish as Record<string, unknown>;
    const steps = publish.steps as Record<string, unknown>[];

    const pnpmStep = steps.find(
      (s) => typeof s.uses === 'string' && s.uses.includes('pnpm/action-setup'),
    );
    expect(pnpmStep).toBeDefined();
  });

  it('uses Node.js 20 with npm registry', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    const publish = jobs.publish as Record<string, unknown>;
    const steps = publish.steps as Record<string, unknown>[];

    const setupNode = steps.find(
      (s) => typeof s.uses === 'string' && s.uses.includes('setup-node'),
    );
    expect(setupNode).toBeDefined();
    const nodeWith = setupNode!.with as Record<string, unknown>;
    expect(String(nodeWith['node-version'])).toBe('20');
    expect(nodeWith['registry-url']).toBe('https://registry.npmjs.org');
  });

  it('runs pnpm install with frozen lockfile', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    const publish = jobs.publish as Record<string, unknown>;
    const steps = publish.steps as Record<string, unknown>[];

    const installStep = steps.find(
      (s) => typeof s.run === 'string' && s.run.includes('pnpm install'),
    );
    expect(installStep).toBeDefined();
    expect(installStep!.run as string).toContain('--frozen-lockfile');
  });

  it('runs pnpm check before publishing', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    const publish = jobs.publish as Record<string, unknown>;
    const steps = publish.steps as Record<string, unknown>[];

    const checkStep = steps.find((s) => typeof s.run === 'string' && s.run.includes('pnpm check'));
    expect(checkStep).toBeDefined();
  });

  it('runs pnpm publish with correct flags', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    const publish = jobs.publish as Record<string, unknown>;
    const steps = publish.steps as Record<string, unknown>[];

    const publishStep = steps.find(
      (s) => typeof s.run === 'string' && s.run.includes('pnpm publish'),
    );
    expect(publishStep).toBeDefined();
    const run = publishStep!.run as string;
    expect(run).toContain('--access public');
    expect(run).toContain('--no-git-checks');
  });

  it('uses NPM_TOKEN for authentication', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    const publish = jobs.publish as Record<string, unknown>;
    const steps = publish.steps as Record<string, unknown>[];

    const publishStep = steps.find(
      (s) => typeof s.run === 'string' && s.run.includes('pnpm publish'),
    );
    expect(publishStep).toBeDefined();
    const env = publishStep!.env as Record<string, unknown>;
    expect(env.NODE_AUTH_TOKEN).toBe('${{ secrets.NPM_TOKEN }}');
  });

  it('runs pnpm check before pnpm publish', () => {
    const workflow = loadWorkflow();
    const jobs = workflow.jobs as Record<string, unknown>;
    const publish = jobs.publish as Record<string, unknown>;
    const steps = publish.steps as Record<string, unknown>[];

    const checkIndex = steps.findIndex(
      (s) => typeof s.run === 'string' && s.run.includes('pnpm check'),
    );
    const publishIndex = steps.findIndex(
      (s) => typeof s.run === 'string' && s.run.includes('pnpm publish'),
    );
    expect(checkIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(checkIndex);
  });
});
