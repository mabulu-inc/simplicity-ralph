import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
  version: string;
};
const BIN = resolve(ROOT, 'dist', 'ralph', 'bin.js');

describe('ralph --version (built binary)', () => {
  it('prints the package version for --version flag', () => {
    const output = execFileSync('node', [BIN, '--version'], {
      cwd: ROOT,
      encoding: 'utf-8',
    }).trim();
    expect(output).toBe(pkg.version);
  });

  it('prints the package version for -V flag', () => {
    const output = execFileSync('node', [BIN, '-V'], {
      cwd: ROOT,
      encoding: 'utf-8',
    }).trim();
    expect(output).toBe(pkg.version);
  });

  it('exits with code 0 for --version', () => {
    expect(() =>
      execFileSync('node', [BIN, '--version'], {
        cwd: ROOT,
        encoding: 'utf-8',
      }),
    ).not.toThrow();
  });
});
