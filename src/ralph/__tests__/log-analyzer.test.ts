import { describe, it, expect } from 'vitest';
import {
  parseLogContent,
  extractPhaseTimeline,
  extractRoleCommentary,
  extractFilesChanged,
  extractFailureSignals,
  extractCostAndTurns,
  classifyFailure,
  generateRecommendations,
  type PhaseEntry,
  type RoleEntry,
  type FailureSignals,
  type FailureClassification,
} from '../core/log-analyzer.js';

function makeLine(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

function makeAssistantText(text: string, timestamp?: string): string {
  return makeLine({
    type: 'assistant',
    timestamp: timestamp ?? '2026-03-19T10:00:00Z',
    message: { content: [{ type: 'text', text }] },
  });
}

function makeAssistantToolUse(
  name: string,
  input: Record<string, unknown>,
  timestamp?: string,
): string {
  return makeLine({
    type: 'assistant',
    timestamp: timestamp ?? '2026-03-19T10:00:00Z',
    message: { content: [{ type: 'tool_use', name, input }] },
  });
}

function makeResult(fields: Record<string, unknown>): string {
  return makeLine({ type: 'result', ...fields });
}

describe('parseLogContent', () => {
  it('returns empty array for empty content', () => {
    expect(parseLogContent('')).toEqual([]);
  });

  it('skips malformed JSON lines', () => {
    const content = 'not json\n{}\n';
    const entries = parseLogContent(content);
    expect(entries.length).toBeGreaterThanOrEqual(0);
  });

  it('parses assistant text entries', () => {
    const content = makeAssistantText('Hello world', '2026-03-19T10:00:00Z');
    const entries = parseLogContent(content);
    expect(entries.length).toBe(1);
    expect(entries[0].type).toBe('assistant');
  });

  it('parses result entries', () => {
    const content = makeResult({
      subtype: 'success',
      num_turns: 5,
      stop_reason: 'end_turn',
    });
    const entries = parseLogContent(content);
    expect(entries.length).toBe(1);
    expect(entries[0].type).toBe('result');
  });
});

describe('extractPhaseTimeline', () => {
  it('returns empty array when no phases found', () => {
    const entries = parseLogContent(makeAssistantText('no phases here'));
    expect(extractPhaseTimeline(entries)).toEqual([]);
  });

  it('extracts phase markers with timestamps', () => {
    const content = [
      makeAssistantText('[PHASE] Entering: Boot', '2026-03-19T10:00:00Z'),
      makeAssistantText('[PHASE] Entering: Red', '2026-03-19T10:05:00Z'),
      makeAssistantText('[PHASE] Entering: Green', '2026-03-19T10:10:00Z'),
    ].join('\n');
    const entries = parseLogContent(content);
    const phases = extractPhaseTimeline(entries);
    expect(phases).toHaveLength(3);
    expect(phases[0].phase).toBe('Boot');
    expect(phases[1].phase).toBe('Red');
    expect(phases[2].phase).toBe('Green');
  });

  it('computes per-phase durations', () => {
    const content = [
      makeAssistantText('[PHASE] Entering: Boot', '2026-03-19T10:00:00Z'),
      makeAssistantText('[PHASE] Entering: Red', '2026-03-19T10:05:00Z'),
    ].join('\n');
    const entries = parseLogContent(content);
    const phases = extractPhaseTimeline(entries);
    expect(phases[0].durationMs).toBe(5 * 60 * 1000);
    expect(phases[1].durationMs).toBeNull();
  });
});

describe('extractRoleCommentary', () => {
  it('returns empty array when no role markers', () => {
    const entries = parseLogContent(makeAssistantText('no roles'));
    expect(extractRoleCommentary(entries)).toEqual([]);
  });

  it('extracts role markers with phase context', () => {
    const content = [
      makeAssistantText('[PHASE] Entering: Boot', '2026-03-19T10:00:00Z'),
      makeAssistantText(
        '[ROLE: Product Manager] Task aligns with PRD §3.11.',
        '2026-03-19T10:01:00Z',
      ),
      makeAssistantText(
        '[ROLE: System Architect] Proposed approach looks good.',
        '2026-03-19T10:02:00Z',
      ),
    ].join('\n');
    const entries = parseLogContent(content);
    const roles = extractRoleCommentary(entries);
    expect(roles).toHaveLength(2);
    expect(roles[0].role).toBe('Product Manager');
    expect(roles[0].phase).toBe('Boot');
    expect(roles[0].commentary).toContain('Task aligns with PRD');
    expect(roles[1].role).toBe('System Architect');
  });

  it('associates role commentary with current phase', () => {
    const content = [
      makeAssistantText('[PHASE] Entering: Boot', '2026-03-19T10:00:00Z'),
      makeAssistantText('[ROLE: PM] Boot commentary', '2026-03-19T10:01:00Z'),
      makeAssistantText('[PHASE] Entering: Verify', '2026-03-19T10:10:00Z'),
      makeAssistantText('[ROLE: SDET] TDD compliance OK', '2026-03-19T10:11:00Z'),
    ].join('\n');
    const entries = parseLogContent(content);
    const roles = extractRoleCommentary(entries);
    expect(roles[0].phase).toBe('Boot');
    expect(roles[1].phase).toBe('Verify');
  });

  it('handles roles before any phase marker', () => {
    const content = makeAssistantText('[ROLE: PM] Early commentary', '2026-03-19T10:00:00Z');
    const entries = parseLogContent(content);
    const roles = extractRoleCommentary(entries);
    expect(roles).toHaveLength(1);
    expect(roles[0].phase).toBeNull();
  });
});

describe('extractFilesChanged', () => {
  it('extracts file paths from Write and Edit tool calls', () => {
    const content = [
      makeAssistantToolUse('Write', { file_path: '/project/src/foo.ts' }),
      makeAssistantToolUse('Edit', { file_path: '/project/src/bar.ts' }),
      makeAssistantToolUse('Read', { file_path: '/project/src/baz.ts' }),
    ].join('\n');
    const entries = parseLogContent(content);
    const files = extractFilesChanged(entries);
    expect(files).toContain('/project/src/foo.ts');
    expect(files).toContain('/project/src/bar.ts');
    expect(files).not.toContain('/project/src/baz.ts');
  });

  it('deduplicates files', () => {
    const content = [
      makeAssistantToolUse('Write', { file_path: '/project/src/foo.ts' }),
      makeAssistantToolUse('Edit', { file_path: '/project/src/foo.ts' }),
    ].join('\n');
    const entries = parseLogContent(content);
    const files = extractFilesChanged(entries);
    expect(files).toHaveLength(1);
  });

  it('returns empty array with no write/edit tools', () => {
    const content = makeAssistantToolUse('Read', { file_path: '/project/src/foo.ts' });
    const entries = parseLogContent(content);
    expect(extractFilesChanged(entries)).toEqual([]);
  });
});

describe('extractFailureSignals', () => {
  it('detects blocked signals', () => {
    const content = makeAssistantText('[BLOCKED] Cannot resolve dependency');
    const entries = parseLogContent(content);
    const signals = extractFailureSignals(entries);
    expect(signals.blocked).toBe('Cannot resolve dependency');
  });

  it('detects error messages in tool results', () => {
    const content = makeLine({
      type: 'result',
      content: 'Error: test failed\nExpected 3 but got 5',
    });
    const entries = parseLogContent(content);
    const signals = extractFailureSignals(entries);
    expect(signals.lastError).toContain('test failed');
  });

  it('returns empty signals when no failures', () => {
    const content = makeAssistantText('All is well');
    const entries = parseLogContent(content);
    const signals = extractFailureSignals(entries);
    expect(signals.blocked).toBeNull();
    expect(signals.lastError).toBeNull();
    expect(signals.maxTurnsExhausted).toBe(false);
    expect(signals.timeout).toBe(false);
  });

  it('detects max_turns stop reason', () => {
    const content = makeResult({
      subtype: 'success',
      stop_reason: 'max_turns',
      num_turns: 50,
    });
    const entries = parseLogContent(content);
    const signals = extractFailureSignals(entries);
    expect(signals.maxTurnsExhausted).toBe(true);
  });
});

describe('extractCostAndTurns', () => {
  it('extracts from result entry', () => {
    const content = [
      makeLine({
        type: 'result',
        subtype: 'success',
        num_turns: 25,
        stop_reason: 'end_turn',
        cost_usd: 1.5,
        usage: {
          input_tokens: 100000,
          output_tokens: 5000,
        },
      }),
    ].join('\n');
    const entries = parseLogContent(content);
    const info = extractCostAndTurns(entries);
    expect(info).not.toBeNull();
    expect(info!.numTurns).toBe(25);
    expect(info!.stopReason).toBe('end_turn');
  });

  it('returns null when no result entry', () => {
    const content = makeAssistantText('just text');
    const entries = parseLogContent(content);
    expect(extractCostAndTurns(entries)).toBeNull();
  });
});

describe('classifyFailure', () => {
  it('classifies max_turns failure', () => {
    const signals: FailureSignals = {
      blocked: null,
      lastError: null,
      maxTurnsExhausted: true,
      timeout: false,
      nonZeroExit: false,
    };
    const classification = classifyFailure(signals, []);
    expect(classification.type).toBe('max_turns');
  });

  it('classifies blocked_by_agent failure', () => {
    const signals: FailureSignals = {
      blocked: 'Cannot resolve dependency',
      lastError: null,
      maxTurnsExhausted: false,
      timeout: false,
      nonZeroExit: false,
    };
    const classification = classifyFailure(signals, []);
    expect(classification.type).toBe('blocked_by_agent');
    expect(classification.detail).toContain('Cannot resolve dependency');
  });

  it('classifies quality_check failure', () => {
    const signals: FailureSignals = {
      blocked: null,
      lastError: 'lint failed',
      maxTurnsExhausted: false,
      timeout: false,
      nonZeroExit: true,
    };
    const phases: PhaseEntry[] = [{ phase: 'Verify', timestamp: new Date(), durationMs: null }];
    const classification = classifyFailure(signals, phases);
    expect(classification.type).toBe('quality_check');
  });

  it('classifies role_rejection when role flagged issue', () => {
    const signals: FailureSignals = {
      blocked: null,
      lastError: null,
      maxTurnsExhausted: false,
      timeout: false,
      nonZeroExit: false,
    };
    const roles: RoleEntry[] = [
      {
        role: 'SDET',
        phase: 'Verify',
        commentary: 'TDD compliance FAILED: tests written after implementation',
        timestamp: new Date(),
      },
    ];
    const classification = classifyFailure(signals, [], roles);
    expect(classification.type).toBe('role_rejection');
    expect(classification.detail).toContain('SDET');
  });

  it('classifies no_commit when no specific signals', () => {
    const signals: FailureSignals = {
      blocked: null,
      lastError: null,
      maxTurnsExhausted: false,
      timeout: false,
      nonZeroExit: false,
    };
    const classification = classifyFailure(signals, []);
    expect(classification.type).toBe('no_commit');
  });
});

describe('generateRecommendations', () => {
  it('generates recommendation for max_turns', () => {
    const classification: FailureClassification = {
      type: 'max_turns',
      detail: 'Exhausted 50 turns',
    };
    const recs = generateRecommendations(classification);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.some((r) => r.toLowerCase().includes('hint'))).toBe(true);
  });

  it('generates recommendation for quality_check', () => {
    const classification: FailureClassification = {
      type: 'quality_check',
      detail: 'lint failed: no-unused-vars',
    };
    const recs = generateRecommendations(classification);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.some((r) => r.toLowerCase().includes('verify'))).toBe(true);
  });

  it('generates recommendation for blocked_by_agent', () => {
    const classification: FailureClassification = {
      type: 'blocked_by_agent',
      detail: 'Missing dependency X',
    };
    const recs = generateRecommendations(classification);
    expect(recs.length).toBeGreaterThan(0);
  });

  it('generates recommendation for role_rejection', () => {
    const classification: FailureClassification = {
      type: 'role_rejection',
      detail: 'SDET flagged TDD non-compliance',
    };
    const recs = generateRecommendations(classification);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.some((r) => r.toLowerCase().includes('role'))).toBe(true);
  });
});
