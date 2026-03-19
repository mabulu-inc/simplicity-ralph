const PHASE_RE = /\[PHASE]\s*Entering:\s*(\w+)/;
const ROLE_RE = /\[ROLE:\s*([^\]]+)]\s*(.*)/s;
const BLOCKED_RE = /\[BLOCKED]\s*(.+)/;
const FAILURE_KEYWORDS = ['FAILED', 'FAIL', 'rejected', 'non-compliance'];

export interface LogEntry {
  type: 'assistant' | 'result' | 'other';
  timestamp: Date | null;
  textBlocks: string[];
  toolUses: ToolUseEntry[];
  resultData?: ResultData;
}

interface ToolUseEntry {
  name: string;
  input: Record<string, unknown>;
}

interface ResultData {
  subtype?: string;
  numTurns?: number;
  stopReason?: string;
  costUsd?: number;
  content?: string;
  usage?: Record<string, number>;
}

export interface PhaseEntry {
  phase: string;
  timestamp: Date | null;
  durationMs: number | null;
}

export interface RoleEntry {
  role: string;
  phase: string | null;
  commentary: string;
  timestamp: Date | null;
}

export interface FailureSignals {
  blocked: string | null;
  lastError: string | null;
  maxTurnsExhausted: boolean;
  timeout: boolean;
  nonZeroExit: boolean;
}

export interface CostTurnsInfo {
  numTurns: number | null;
  stopReason: string | null;
  costUsd: number | null;
  usage: Record<string, number> | null;
}

export interface FailureClassification {
  type:
    | 'timeout'
    | 'max_turns'
    | 'quality_check'
    | 'blocked_by_agent'
    | 'role_rejection'
    | 'no_commit';
  detail: string;
}

function parseTimestamp(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

export function parseLogContent(content: string): LogEntry[] {
  if (!content.trim()) return [];
  const entries: LogEntry[] = [];

  for (const rawLine of content.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const timestamp = parseTimestamp(obj.timestamp);

    if (obj.type === 'assistant') {
      const message = obj.message as Record<string, unknown> | undefined;
      const contentArr = (message?.content ?? []) as Array<Record<string, unknown>>;
      const textBlocks: string[] = [];
      const toolUses: ToolUseEntry[] = [];

      for (const block of contentArr) {
        if (block.type === 'text' && typeof block.text === 'string') {
          textBlocks.push(block.text);
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          toolUses.push({
            name: block.name,
            input: (block.input as Record<string, unknown>) ?? {},
          });
        }
      }

      entries.push({ type: 'assistant', timestamp, textBlocks, toolUses });
    } else if (obj.type === 'result') {
      entries.push({
        type: 'result',
        timestamp,
        textBlocks: [],
        toolUses: [],
        resultData: {
          subtype: typeof obj.subtype === 'string' ? obj.subtype : undefined,
          numTurns: typeof obj.num_turns === 'number' ? obj.num_turns : undefined,
          stopReason: typeof obj.stop_reason === 'string' ? obj.stop_reason : undefined,
          costUsd: typeof obj.cost_usd === 'number' ? obj.cost_usd : undefined,
          content: typeof obj.content === 'string' ? obj.content : undefined,
          usage:
            obj.usage && typeof obj.usage === 'object'
              ? (obj.usage as Record<string, number>)
              : undefined,
        },
      });
    } else {
      entries.push({ type: 'other', timestamp, textBlocks: [], toolUses: [] });
    }
  }

  return entries;
}

export function extractPhaseTimeline(entries: LogEntry[]): PhaseEntry[] {
  const phases: PhaseEntry[] = [];

  for (const entry of entries) {
    for (const text of entry.textBlocks) {
      const match = text.match(PHASE_RE);
      if (match) {
        phases.push({
          phase: match[1],
          timestamp: entry.timestamp,
          durationMs: null,
        });
      }
    }
  }

  for (let i = 0; i < phases.length - 1; i++) {
    const current = phases[i];
    const next = phases[i + 1];
    if (current.timestamp && next.timestamp) {
      current.durationMs = next.timestamp.getTime() - current.timestamp.getTime();
    }
  }

  return phases;
}

export function extractRoleCommentary(entries: LogEntry[]): RoleEntry[] {
  const roles: RoleEntry[] = [];
  let currentPhase: string | null = null;

  for (const entry of entries) {
    for (const text of entry.textBlocks) {
      const phaseMatch = text.match(PHASE_RE);
      if (phaseMatch) {
        currentPhase = phaseMatch[1];
      }

      for (const line of text.split('\n')) {
        const roleMatch = line.match(ROLE_RE);
        if (roleMatch) {
          roles.push({
            role: roleMatch[1].trim(),
            phase: currentPhase,
            commentary: roleMatch[2].trim(),
            timestamp: entry.timestamp,
          });
        }
      }
    }
  }

  return roles;
}

export function extractFilesChanged(entries: LogEntry[]): string[] {
  const files = new Set<string>();

  for (const entry of entries) {
    for (const tool of entry.toolUses) {
      if (tool.name === 'Write' || tool.name === 'Edit') {
        const filePath = tool.input.file_path;
        if (typeof filePath === 'string') {
          files.add(filePath);
        }
      }
    }
  }

  return [...files];
}

export function extractFailureSignals(entries: LogEntry[]): FailureSignals {
  let blocked: string | null = null;
  let lastError: string | null = null;
  let maxTurnsExhausted = false;
  let timeout = false;
  let nonZeroExit = false;

  for (const entry of entries) {
    for (const text of entry.textBlocks) {
      const blockedMatch = text.match(BLOCKED_RE);
      if (blockedMatch) {
        blocked = blockedMatch[1].trim();
      }
    }

    if (entry.resultData) {
      if (entry.resultData.content) {
        const content = entry.resultData.content;
        if (
          content.includes('Error') ||
          content.includes('FAIL') ||
          content.includes('error') ||
          content.includes('fail')
        ) {
          lastError = content;
          nonZeroExit = true;
        }
      }
      if (entry.resultData.stopReason === 'max_turns') {
        maxTurnsExhausted = true;
      }
      if (entry.resultData.stopReason === 'timeout') {
        timeout = true;
      }
    }
  }

  return { blocked, lastError, maxTurnsExhausted, timeout, nonZeroExit };
}

export function extractCostAndTurns(entries: LogEntry[]): CostTurnsInfo | null {
  let lastResult: CostTurnsInfo | null = null;

  for (const entry of entries) {
    if (entry.resultData) {
      lastResult = {
        numTurns: entry.resultData.numTurns ?? null,
        stopReason: entry.resultData.stopReason ?? null,
        costUsd: entry.resultData.costUsd ?? null,
        usage: entry.resultData.usage ?? null,
      };
    }
  }

  return lastResult;
}

export function classifyFailure(
  signals: FailureSignals,
  phases: PhaseEntry[],
  roles?: RoleEntry[],
): FailureClassification {
  if (signals.timeout) {
    return { type: 'timeout', detail: 'Task execution timed out' };
  }

  if (signals.maxTurnsExhausted) {
    return { type: 'max_turns', detail: 'Agent exhausted maximum allowed turns' };
  }

  if (signals.blocked) {
    return { type: 'blocked_by_agent', detail: signals.blocked };
  }

  if (roles) {
    const gateRoles = roles.filter((r) => r.phase === 'Verify' || r.phase === 'Boot');
    for (const role of gateRoles) {
      if (FAILURE_KEYWORDS.some((kw) => role.commentary.includes(kw))) {
        return {
          type: 'role_rejection',
          detail: `${role.role} flagged: ${role.commentary}`,
        };
      }
    }
  }

  const lastPhase = phases.length > 0 ? phases[phases.length - 1].phase : null;
  if (lastPhase === 'Verify' && signals.nonZeroExit) {
    return {
      type: 'quality_check',
      detail: signals.lastError ?? 'Quality check failed during Verify phase',
    };
  }

  return { type: 'no_commit', detail: 'Task completed without producing a commit' };
}

export function generateRecommendations(classification: FailureClassification): string[] {
  switch (classification.type) {
    case 'timeout':
      return [
        'Consider increasing the complexity tier from standard to heavy, or split this task into smaller subtasks.',
        'Check if the task involves long-running builds or test suites that need higher timeouts.',
      ];
    case 'max_turns':
      return [
        'Add a Hints section with implementation guidance to reduce exploration turns.',
        'Consider splitting the task into smaller, more focused subtasks.',
        'Review the task description for ambiguity that could cause the agent to explore multiple approaches.',
      ];
    case 'quality_check':
      return [
        `The verify phase failed. Detail: ${classification.detail}`,
        'Review the quality check output and add specific guidance in the task Hints section.',
        'Consider adding pre-existing lint/format fixes as a prerequisite task.',
      ];
    case 'blocked_by_agent':
      return [
        `The agent self-blocked with reason: ${classification.detail}`,
        'Review whether the blocking condition is a real constraint or a misunderstanding.',
        'Add clarification to the task description or provide a workaround in Hints.',
      ];
    case 'role_rejection':
      return [
        `A role flagged an issue during gate review: ${classification.detail}`,
        'Address the concern raised by the role before retrying.',
        'If the role feedback is overly strict, consider adjusting role definitions.',
      ];
    case 'no_commit':
      return [
        'The task completed without producing a commit. This may indicate the agent got stuck.',
        'Check if the task description is clear enough for the agent to complete.',
        'Add acceptance criteria if missing to give the agent a clear target.',
      ];
  }
}
