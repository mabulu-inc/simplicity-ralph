import { describe, it, expect } from 'vitest';
import { dispatch, formatHelp, formatCommandHelp } from '../cli.js';

const KNOWN_COMMANDS = [
  'init',
  'loop',
  'monitor',
  'kill',
  'milestones',
  'shas',
  'cost',
  'update',
  'show',
] as const;

describe('CLI dispatch', () => {
  it('returns help action when no command is given', () => {
    const result = dispatch([]);
    expect(result).toEqual({ action: 'help' });
  });

  it('returns help action for unknown commands', () => {
    const result = dispatch(['bogus']);
    expect(result).toEqual({ action: 'help', unknown: 'bogus' });
  });

  it.each(KNOWN_COMMANDS)('dispatches known command: %s', (cmd) => {
    const result = dispatch([cmd]);
    expect(result).toEqual({ action: cmd, args: [] });
  });

  it('passes remaining args to the command', () => {
    const result = dispatch(['loop', '-n', '5', '--verbose']);
    expect(result).toEqual({ action: 'loop', args: ['-n', '5', '--verbose'] });
  });

  it('returns help action for --help flag', () => {
    const result = dispatch(['--help']);
    expect(result).toEqual({ action: 'help' });
  });

  it('returns help action for -h flag', () => {
    const result = dispatch(['-h']);
    expect(result).toEqual({ action: 'help' });
  });

  it.each(KNOWN_COMMANDS)('returns help action with command when %s --help is passed', (cmd) => {
    const result = dispatch([cmd, '--help']);
    expect(result).toEqual({ action: 'help', command: cmd });
  });

  it.each(KNOWN_COMMANDS)('returns help action with command when %s -h is passed', (cmd) => {
    const result = dispatch([cmd, '-h']);
    expect(result).toEqual({ action: 'help', command: cmd });
  });

  it('returns help action with command when --help appears among other args', () => {
    const result = dispatch(['loop', '-n', '5', '--help']);
    expect(result).toEqual({ action: 'help', command: 'loop' });
  });

  it('returns version action for --version flag', () => {
    const result = dispatch(['--version']);
    expect(result).toEqual({ action: 'version' });
  });

  it('returns version action for -V flag', () => {
    const result = dispatch(['-V']);
    expect(result).toEqual({ action: 'version' });
  });

  it('--help still works after adding --version support', () => {
    expect(dispatch(['--help'])).toEqual({ action: 'help' });
    expect(dispatch(['-h'])).toEqual({ action: 'help' });
    expect(dispatch([])).toEqual({ action: 'help' });
  });
});

describe('CLI help text', () => {
  it('formatHelp returns usage text listing all commands', () => {
    const help = formatHelp();
    expect(help).toContain('ralph');
    expect(help).toContain('Usage:');
    for (const cmd of KNOWN_COMMANDS) {
      expect(help).toContain(cmd);
    }
  });

  it('formatHelp includes unknown command warning when provided', () => {
    const help = formatHelp('bogus');
    expect(help).toContain('bogus');
    expect(help).toContain('Unknown');
  });

  it.each(KNOWN_COMMANDS)('formatCommandHelp returns help text for %s', (cmd) => {
    const help = formatCommandHelp(cmd);
    expect(help).toContain(`ralph ${cmd}`);
    expect(help).toContain('Usage:');
  });
});
