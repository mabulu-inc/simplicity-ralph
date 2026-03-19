import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assertSafeTaskId } from '../core/sanitize.js';
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
  type CostTurnsInfo,
} from '../core/log-analyzer.js';

interface AttemptSummary {
  file: string;
  timestamp: string;
  phases: PhaseEntry[];
  roles: RoleEntry[];
  filesChanged: string[];
  costTurns: CostTurnsInfo | null;
  status: 'success' | 'failed' | 'running';
  failureReason: string | null;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

async function findTaskLogs(taskId: string, logsDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(logsDir);
  } catch {
    return [];
  }
  const prefix = `${taskId}-`;
  return entries.filter((f) => f.startsWith(prefix) && f.endsWith('.jsonl')).sort();
}

async function analyzeAttempt(logPath: string, fileName: string): Promise<AttemptSummary> {
  const content = await readFile(logPath, 'utf-8');
  const entries = parseLogContent(content);
  const phases = extractPhaseTimeline(entries);
  const roles = extractRoleCommentary(entries);
  const filesChanged = extractFilesChanged(entries);
  const costTurns = extractCostAndTurns(entries);
  const signals = extractFailureSignals(entries);

  const timestampMatch = fileName.match(/\d{13}/);
  const timestamp = timestampMatch
    ? new Date(parseInt(timestampMatch[0], 10)).toISOString()
    : 'unknown';

  let status: 'success' | 'failed' | 'running' = 'running';
  let failureReason: string | null = null;

  if (costTurns) {
    if (costTurns.stopReason === 'end_turn' && phases.some((p) => p.phase === 'Commit')) {
      status = 'success';
    } else if (
      costTurns.stopReason === 'max_turns' ||
      signals.blocked ||
      signals.timeout ||
      signals.nonZeroExit
    ) {
      status = 'failed';
      const classification = classifyFailure(signals, phases, roles);
      failureReason = `${classification.type}: ${classification.detail}`;
    } else if (costTurns.stopReason === 'end_turn') {
      status = 'success';
    } else {
      status = 'failed';
      failureReason = 'Unknown failure';
    }
  }

  return {
    file: fileName,
    timestamp,
    phases,
    roles,
    filesChanged,
    costTurns,
    status,
    failureReason,
  };
}

function formatPhaseTimeline(phases: PhaseEntry[], _verbose: boolean): string {
  if (phases.length === 0) return '  (no phases detected)';

  return phases
    .map((p) => {
      const duration = p.durationMs !== null ? ` (${formatDuration(p.durationMs)})` : '';
      return `    ${p.phase}${duration}`;
    })
    .join('\n');
}

function formatRolesByPhase(roles: RoleEntry[], verbose: boolean): string {
  if (roles.length === 0) return '';

  const byPhase = new Map<string, RoleEntry[]>();
  for (const r of roles) {
    const key = r.phase ?? '(pre-phase)';
    const arr = byPhase.get(key) ?? [];
    arr.push(r);
    byPhase.set(key, arr);
  }

  const lines: string[] = [];
  for (const [phase, phaseRoles] of byPhase) {
    lines.push(`    ${phase}:`);
    for (const r of phaseRoles) {
      if (verbose) {
        lines.push(`      [${r.role}] ${r.commentary}`);
      } else {
        const abbreviated =
          r.commentary.length > 80 ? r.commentary.slice(0, 77) + '...' : r.commentary;
        lines.push(`      [${r.role}] ${abbreviated}`);
      }
    }
  }

  return lines.join('\n');
}

function formatAttempt(
  attempt: AttemptSummary,
  index: number,
  total: number,
  verbose: boolean,
): string {
  const lines: string[] = [];
  const label = total > 1 ? `Attempt ${index + 1} of ${total}` : 'Attempt 1';
  const statusIcon = attempt.status === 'success' ? '✓' : attempt.status === 'failed' ? '✗' : '…';

  lines.push(`── ${label} [${statusIcon} ${attempt.status}] ──`);
  lines.push(`  Timestamp: ${attempt.timestamp}`);

  if (attempt.failureReason) {
    lines.push(`  Failure: ${attempt.failureReason}`);
  }

  lines.push('  Phases:');
  lines.push(formatPhaseTimeline(attempt.phases, verbose));

  const rolesOutput = formatRolesByPhase(attempt.roles, verbose);
  if (rolesOutput) {
    lines.push('  Roles:');
    lines.push(rolesOutput);
  }

  if (attempt.costTurns) {
    const parts: string[] = [];
    if (attempt.costTurns.numTurns !== null) {
      parts.push(`${attempt.costTurns.numTurns} turns`);
    }
    if (attempt.costTurns.costUsd !== null) {
      parts.push(`$${attempt.costTurns.costUsd.toFixed(2)}`);
    }
    if (attempt.costTurns.stopReason) {
      parts.push(`stop: ${attempt.costTurns.stopReason}`);
    }
    if (parts.length > 0) {
      lines.push(`  Cost/Turns: ${parts.join(' | ')}`);
    }
  }

  if (attempt.filesChanged.length > 0) {
    lines.push('  Files changed:');
    for (const f of attempt.filesChanged) {
      lines.push(`    ${f}`);
    }
  }

  return lines.join('\n');
}

export async function formatReviewTimeline(
  taskId: string,
  logsDir: string,
  verbose = false,
): Promise<string> {
  const logFiles = await findTaskLogs(taskId, logsDir);
  if (logFiles.length === 0) {
    return `No log files found for ${taskId}`;
  }

  const attempts: AttemptSummary[] = [];
  for (const file of logFiles) {
    attempts.push(await analyzeAttempt(join(logsDir, file), file));
  }

  const lines: string[] = [];
  lines.push(`Review: ${taskId}`);
  lines.push(`Attempts: ${attempts.length}`);
  lines.push('');

  for (let i = 0; i < attempts.length; i++) {
    lines.push(formatAttempt(attempts[i], i, attempts.length, verbose));
    if (i < attempts.length - 1) lines.push('');
  }

  return lines.join('\n');
}

export async function formatDiagnosis(
  taskId: string,
  logsDir: string,
  _verbose = false,
): Promise<string> {
  const logFiles = await findTaskLogs(taskId, logsDir);
  if (logFiles.length === 0) {
    return `No log files found for ${taskId}`;
  }

  const lastFile = logFiles[logFiles.length - 1];
  const content = await readFile(join(logsDir, lastFile), 'utf-8');
  const entries = parseLogContent(content);
  const phases = extractPhaseTimeline(entries);
  const roles = extractRoleCommentary(entries);
  const signals = extractFailureSignals(entries);
  const costTurns = extractCostAndTurns(entries);
  const classification = classifyFailure(signals, phases, roles);
  const recommendations = generateRecommendations(classification);

  const lines: string[] = [];
  lines.push(`Diagnosis: ${taskId}`);
  lines.push('');
  lines.push(`Classification: ${classification.type}`);
  lines.push(`Detail: ${classification.detail}`);

  if (costTurns) {
    const parts: string[] = [];
    if (costTurns.numTurns !== null) parts.push(`${costTurns.numTurns} turns`);
    if (costTurns.stopReason) parts.push(`stop: ${costTurns.stopReason}`);
    if (parts.length > 0) lines.push(`Session: ${parts.join(' | ')}`);
  }

  const lastPhase = phases.length > 0 ? phases[phases.length - 1].phase : 'none';
  lines.push(`Last phase: ${lastPhase}`);

  if (signals.lastError) {
    const truncated =
      signals.lastError.length > 200 ? signals.lastError.slice(0, 197) + '...' : signals.lastError;
    lines.push(`Last error: ${truncated}`);
  }

  lines.push('');
  lines.push('Recommendations:');
  for (const rec of recommendations) {
    lines.push(`  • ${rec}`);
  }

  return lines.join('\n');
}

interface ReviewJsonAttempt {
  file: string;
  timestamp: string;
  status: string;
  failureReason: string | null;
  phases: Array<{ phase: string; durationMs: number | null }>;
  roles: Array<{ role: string; phase: string | null; commentary: string }>;
  filesChanged: string[];
  costTurns: CostTurnsInfo | null;
}

interface ReviewJsonOutput {
  taskId: string;
  attempts: ReviewJsonAttempt[];
  diagnosis?: {
    classification: string;
    detail: string;
    recommendations: string[];
  };
}

export async function formatReviewJson(
  taskId: string,
  logsDir: string,
  diagnose: boolean,
): Promise<string> {
  const logFiles = await findTaskLogs(taskId, logsDir);
  const output: ReviewJsonOutput = { taskId, attempts: [] };

  for (const file of logFiles) {
    const attempt = await analyzeAttempt(join(logsDir, file), file);
    output.attempts.push({
      file: attempt.file,
      timestamp: attempt.timestamp,
      status: attempt.status,
      failureReason: attempt.failureReason,
      phases: attempt.phases.map((p) => ({ phase: p.phase, durationMs: p.durationMs })),
      roles: attempt.roles.map((r) => ({
        role: r.role,
        phase: r.phase,
        commentary: r.commentary,
      })),
      filesChanged: attempt.filesChanged,
      costTurns: attempt.costTurns,
    });
  }

  if (diagnose && logFiles.length > 0) {
    const lastFile = logFiles[logFiles.length - 1];
    const content = await readFile(join(logsDir, lastFile), 'utf-8');
    const entries = parseLogContent(content);
    const phases = extractPhaseTimeline(entries);
    const roles = extractRoleCommentary(entries);
    const signals = extractFailureSignals(entries);
    const classification = classifyFailure(signals, phases, roles);
    const recommendations = generateRecommendations(classification);
    output.diagnosis = {
      classification: classification.type,
      detail: classification.detail,
      recommendations,
    };
  }

  return JSON.stringify(output, null, 2);
}

export async function run(args: string[], cwd?: string): Promise<void> {
  const taskId = args.find((a) => !a.startsWith('-'));
  if (!taskId) {
    console.error('Usage: ralph review <task ID> [--diagnose] [--json] [--verbose]');
    return;
  }

  try {
    assertSafeTaskId(taskId);
  } catch {
    console.error(`Invalid task ID: ${taskId}`);
    return;
  }

  const projectDir = cwd ?? process.cwd();
  const logsDir = join(projectDir, '.ralph-logs');

  const isJson = args.includes('--json') || args.includes('-j');
  const isDiagnose = args.includes('--diagnose') || args.includes('-d');
  const isVerbose = args.includes('--verbose') || args.includes('-v');

  if (isJson) {
    const output = await formatReviewJson(taskId, logsDir, isDiagnose);
    console.log(output);
    return;
  }

  if (isDiagnose) {
    const output = await formatDiagnosis(taskId, logsDir, isVerbose);
    console.log(output);
    return;
  }

  const output = await formatReviewTimeline(taskId, logsDir, isVerbose);
  console.log(output);
}
