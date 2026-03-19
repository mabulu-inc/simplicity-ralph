import { readdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { scanTasks, type Task } from './tasks.js';
import { getTierScaling } from './defaults.js';
import {
  parseLogContent,
  extractPhaseTimeline,
  extractRoleCommentary,
  extractCostAndTurns,
  type RoleEntry,
  type CostTurnsInfo,
} from './log-analyzer.js';
import type { ComplexityTier } from './complexity.js';

export type SuggestionPriority = 'high' | 'medium' | 'low';

export interface CoachSuggestion {
  taskId: string;
  issue: string;
  action: string;
  priority: SuggestionPriority;
}

export interface CoachingResult {
  taskQuality: CoachSuggestion[];
  roleEffectiveness: CoachSuggestion[];
  extensionHealth: CoachSuggestion[];
  notEnoughData: boolean;
}

const MIN_DESCRIPTION_WORDS = 50;
const HIGH_TURN_THRESHOLD = 0.8;
const LOW_TURN_THRESHOLD = 0.3;
const SKIP_RE = /\bskipping\b/i;
const SKIP_ROLE_THRESHOLD = 0.8;
const MIN_TASKS_FOR_PATTERN = 3;

interface TaskLogSummary {
  taskId: string;
  roles: RoleEntry[];
  costTurns: CostTurnsInfo | null;
  phases: string[];
  stopReason: string | null;
}

async function getLogFiles(logsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(logsDir);
    return entries.filter((f) => f.endsWith('.jsonl')).sort();
  } catch {
    return [];
  }
}

function extractTaskIdFromFilename(filename: string): string | null {
  const match = filename.match(/^(T-\d+)-/);
  return match ? match[1] : null;
}

async function parseLogSummary(logPath: string, taskId: string): Promise<TaskLogSummary> {
  const content = await readFile(logPath, 'utf-8');
  const entries = parseLogContent(content);
  const phases = extractPhaseTimeline(entries);
  const roles = extractRoleCommentary(entries);
  const costTurns = extractCostAndTurns(entries);

  return {
    taskId,
    roles,
    costTurns,
    phases: phases.map((p) => p.phase),
    stopReason: costTurns?.stopReason ?? null,
  };
}

async function loadAllLogSummaries(logsDir: string): Promise<TaskLogSummary[]> {
  const files = await getLogFiles(logsDir);
  const summaries: TaskLogSummary[] = [];

  for (const file of files) {
    const taskId = extractTaskIdFromFilename(file);
    if (!taskId) continue;
    summaries.push(await parseLogSummary(join(logsDir, file), taskId));
  }

  return summaries;
}

function getMaxTurns(complexity: ComplexityTier | undefined): number {
  const scaling = getTierScaling();
  const tier = complexity ?? 'standard';
  return scaling[tier].maxTurns;
}

export async function analyzeTaskQuality(
  tasksDir: string,
  logsDir: string,
): Promise<CoachSuggestion[]> {
  let tasks: Task[];
  try {
    tasks = await scanTasks(tasksDir);
  } catch {
    return [];
  }

  const suggestions: CoachSuggestion[] = [];

  // Build touches map for overlap detection
  const touchesMap = new Map<string, string[]>();
  for (const task of tasks) {
    for (const file of task.touches) {
      const existing = touchesMap.get(file) ?? [];
      existing.push(task.id);
      touchesMap.set(file, existing);
    }
  }

  for (const task of tasks) {
    // Check short description
    const wordCount = task.description.split(/\s+/).filter((w) => w.length > 0).length;
    if (wordCount < MIN_DESCRIPTION_WORDS) {
      suggestions.push({
        taskId: task.id,
        issue: `Short description (${wordCount} words, minimum ${MIN_DESCRIPTION_WORDS})`,
        action: 'Add more detail to the task description to reduce agent ambiguity',
        priority: 'medium',
      });
    }

    // Check missing PRD reference
    if (!task.prdReference || task.prdReference.trim() === '') {
      suggestions.push({
        taskId: task.id,
        issue: 'Missing PRD Reference',
        action: 'Add a PRD Reference to link the task to product requirements',
        priority: 'low',
      });
    }

    // Check missing AC section (inferred from description containing no acceptance criteria)
    // The task parser doesn't expose AC directly, but we can check the raw description
    // We check if the task has an AC section by re-reading the file
    try {
      const content = await readFile(join(tasksDir, `${task.id}.md`), 'utf-8');
      if (!content.includes('## AC') && !content.includes('## Acceptance Criteria')) {
        suggestions.push({
          taskId: task.id,
          issue: 'Missing AC section',
          action: 'Add acceptance criteria to give the agent a clear definition of done',
          priority: 'high',
        });
      }
    } catch {
      // File might not exist by that name pattern
    }

    // Check missing Depends when Touches overlap
    if (task.status === 'TODO') {
      for (const file of task.touches) {
        const tasksWithFile = touchesMap.get(file) ?? [];
        const others = tasksWithFile.filter((id) => id !== task.id);
        for (const otherId of others) {
          const hasDep = task.depends.includes(otherId);
          const otherTask = tasks.find((t) => t.id === otherId);
          const otherHasDep = otherTask?.depends.includes(task.id) ?? false;
          if (!hasDep && !otherHasDep) {
            suggestions.push({
              taskId: task.id,
              issue: `Touches overlap with ${otherId} on ${file} but no Depends declared`,
              action: `Add Depends on ${otherId} or vice versa to prevent merge conflicts`,
              priority: 'medium',
            });
          }
        }
      }
    }
  }

  // Analyze completed tasks for tier mismatches
  const logSummaries = await loadAllLogSummaries(logsDir);
  const doneTasks = tasks.filter((t) => t.status === 'DONE');

  for (const task of doneTasks) {
    const taskLogs = logSummaries.filter((s) => s.taskId === task.id);
    if (taskLogs.length === 0) continue;

    const lastLog = taskLogs[taskLogs.length - 1];
    const numTurns = lastLog.costTurns?.numTurns;
    if (numTurns === null || numTurns === undefined) continue;

    const maxTurns = getMaxTurns(task.complexity);

    if (numTurns > maxTurns * HIGH_TURN_THRESHOLD) {
      suggestions.push({
        taskId: task.id,
        issue: `Used ${numTurns}/${maxTurns} turns (${Math.round((numTurns / maxTurns) * 100)}%) — near turn limit`,
        action: `Consider upgrading complexity tier from ${task.complexity ?? 'standard'} to reduce risk of hitting turn limit`,
        priority: 'high',
      });
    } else if (numTurns < maxTurns * LOW_TURN_THRESHOLD) {
      suggestions.push({
        taskId: task.id,
        issue: `Used ${numTurns}/${maxTurns} turns (${Math.round((numTurns / maxTurns) * 100)}%) — well below limit`,
        action: `Consider downgrading complexity tier from ${task.complexity ?? 'standard'} to save budget`,
        priority: 'low',
      });
    }

    // Check if task was retried
    if (taskLogs.length > 1) {
      const failedAttempts = taskLogs.slice(0, -1);
      const hadVerifyFailure = failedAttempts.some(
        (log) => log.phases.includes('Verify') && log.stopReason !== 'end_turn',
      );
      if (hadVerifyFailure && !task.hints) {
        suggestions.push({
          taskId: task.id,
          issue: `Task was retried ${taskLogs.length} times — earlier attempts failed`,
          action: 'Add Hints section with implementation guidance to prevent retries',
          priority: 'medium',
        });
      }
    }
  }

  return suggestions;
}

export async function analyzeRoleEffectiveness(
  logsDir: string,
  projectDir: string,
): Promise<CoachSuggestion[]> {
  const summaries = await loadAllLogSummaries(logsDir);
  if (summaries.length < MIN_TASKS_FOR_PATTERN) return [];

  const suggestions: CoachSuggestion[] = [];

  // Group by task to get unique tasks
  const taskIds = new Set(summaries.map((s) => s.taskId));
  const taskCount = taskIds.size;
  if (taskCount < MIN_TASKS_FOR_PATTERN) return [];

  // Count role skip frequency
  const roleSkipCounts = new Map<string, number>();
  const roleAppearanceCounts = new Map<string, number>();

  for (const taskId of taskIds) {
    const taskLogs = summaries.filter((s) => s.taskId === taskId);
    // Use the last log for each task
    const lastLog = taskLogs[taskLogs.length - 1];
    const seenRoles = new Set<string>();

    for (const role of lastLog.roles) {
      if (seenRoles.has(role.role)) continue;
      seenRoles.add(role.role);

      roleAppearanceCounts.set(role.role, (roleAppearanceCounts.get(role.role) ?? 0) + 1);

      if (SKIP_RE.test(role.commentary)) {
        roleSkipCounts.set(role.role, (roleSkipCounts.get(role.role) ?? 0) + 1);
      }
    }
  }

  // Flag roles that skip > 80% of the time
  for (const [role, skipCount] of roleSkipCounts) {
    const appearances = roleAppearanceCounts.get(role) ?? 0;
    if (appearances >= MIN_TASKS_FOR_PATTERN && skipCount / appearances > SKIP_ROLE_THRESHOLD) {
      suggestions.push({
        taskId: '(all)',
        issue: `${role} skips on ${Math.round((skipCount / appearances) * 100)}% of tasks (${skipCount}/${appearances})`,
        action: `Consider disabling ${role} via docs/prompts/roles.md to reduce noise`,
        priority: 'medium',
      });
    }
  }

  // Detect roles whose Verify commentary is followed by retries
  const taskRetryRoles = new Map<string, Set<string>>();
  for (const taskId of taskIds) {
    const taskLogs = summaries.filter((s) => s.taskId === taskId);
    if (taskLogs.length < 2) continue;

    // Check failed attempts for Verify phase role commentary
    for (let i = 0; i < taskLogs.length - 1; i++) {
      const log = taskLogs[i];
      const verifyRoles = log.roles.filter((r) => r.phase === 'Verify');
      for (const role of verifyRoles) {
        const roles = taskRetryRoles.get(role.role) ?? new Set();
        roles.add(taskId);
        taskRetryRoles.set(role.role, roles);
      }
    }
  }

  for (const [role, taskSet] of taskRetryRoles) {
    if (taskSet.size >= 2) {
      suggestions.push({
        taskId: '(all)',
        issue: `${role} Verify commentary was followed by a retry in ${taskSet.size} tasks`,
        action: `Refine ${role} review criteria via Override in docs/prompts/roles.md`,
        priority: 'high',
      });
    }
  }

  // Check for unused custom roles
  const promptsDir = join(projectDir, 'docs', 'prompts');
  try {
    const rolesContent = await readFile(join(promptsDir, 'roles.md'), 'utf-8');
    const addMatches = rolesContent.matchAll(/^## Add:\s+(.+)$/gm);
    for (const match of addMatches) {
      const roleName = match[1].trim();
      const isReferenced = summaries.some((s) => s.roles.some((r) => r.role === roleName));
      if (!isReferenced) {
        suggestions.push({
          taskId: '(all)',
          issue: `Custom role "${roleName}" defined in roles.md but never appears in any task log`,
          action: `Remove the unused role definition or assign it to tasks via the Roles field`,
          priority: 'low',
        });
      }
    }
  } catch {
    // No roles.md — that's fine
  }

  return suggestions;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fileHasContent(path: string): Promise<boolean> {
  try {
    const content = await readFile(path, 'utf-8');
    const stripped = content.replace(/^#[^\n]*\n/gm, '').trim();
    return stripped.length > 20;
  } catch {
    return false;
  }
}

export async function analyzeExtensionHealth(
  promptsDir: string,
  tasksDir: string,
  logsDir: string,
): Promise<CoachSuggestion[]> {
  const suggestions: CoachSuggestion[] = [];

  // Check rules.md
  const rulesPath = join(promptsDir, 'rules.md');
  const rulesExists = await fileExists(rulesPath);
  const rulesHasContent = rulesExists && (await fileHasContent(rulesPath));

  if (!rulesExists) {
    suggestions.push({
      taskId: '(project)',
      issue: 'No rules.md extension file found — missing project-specific rules',
      action: 'Create docs/prompts/rules.md with project-specific coding rules and constraints',
      priority: 'medium',
    });
  } else if (!rulesHasContent) {
    suggestions.push({
      taskId: '(project)',
      issue: 'rules.md exists but contains only default scaffold content',
      action: 'Add project-specific rules to docs/prompts/rules.md based on common patterns',
      priority: 'medium',
    });
  }

  // Check roles.md when roles frequently skip
  const rolesPath = join(promptsDir, 'roles.md');
  const rolesExists = await fileExists(rolesPath);

  const summaries = await loadAllLogSummaries(logsDir);
  const skipCount = summaries.reduce((count, s) => {
    return count + s.roles.filter((r) => SKIP_RE.test(r.commentary)).length;
  }, 0);
  const totalRoleComments = summaries.reduce((count, s) => count + s.roles.length, 0);

  if (!rolesExists && totalRoleComments > 0 && skipCount / totalRoleComments > 0.3) {
    suggestions.push({
      taskId: '(project)',
      issue: 'No roles.md exists but roles frequently skip — consider disabling unused roles',
      action: 'Create docs/prompts/roles.md with Disable directives for roles that always skip',
      priority: 'medium',
    });
  }

  // Check for system.md when tasks frequently fail at Verify
  const systemPath = join(promptsDir, 'system.md');
  const systemExists = await fileExists(systemPath);

  const verifyFailures = summaries.filter(
    (s) => s.phases.includes('Verify') && s.stopReason !== 'end_turn' && s.stopReason !== null,
  );

  if (!systemExists && verifyFailures.length >= 2) {
    suggestions.push({
      taskId: '(project)',
      issue: `${verifyFailures.length} task attempts failed at Verify — no system.md extension for quality guidance`,
      action:
        'Create docs/prompts/system.md with project-specific quality guidelines to improve Verify pass rate',
      priority: 'high',
    });
  }

  return suggestions;
}

export async function runCoaching(projectDir: string): Promise<CoachingResult> {
  const tasksDir = join(projectDir, 'docs', 'tasks');
  const logsDir = join(projectDir, '.ralph-logs');
  const promptsDir = join(projectDir, 'docs', 'prompts');

  let tasks: Task[];
  try {
    tasks = await scanTasks(tasksDir);
  } catch {
    tasks = [];
  }

  const logFiles = await getLogFiles(logsDir);

  if (tasks.length === 0 && logFiles.length === 0) {
    return {
      taskQuality: [],
      roleEffectiveness: [],
      extensionHealth: [],
      notEnoughData: true,
    };
  }

  const [taskQuality, roleEffectiveness, extensionHealth] = await Promise.all([
    analyzeTaskQuality(tasksDir, logsDir),
    analyzeRoleEffectiveness(logsDir, projectDir),
    analyzeExtensionHealth(promptsDir, tasksDir, logsDir),
  ]);

  return {
    taskQuality,
    roleEffectiveness,
    extensionHealth,
    notEnoughData: false,
  };
}

export function formatCoachingOutput(result: CoachingResult): string {
  if (result.notEnoughData) {
    return 'Not enough data for coaching analysis. Complete some tasks first, then run again.';
  }

  const lines: string[] = [];
  lines.push('Coaching Analysis');
  lines.push('═'.repeat(40));

  const sections: Array<{ title: string; suggestions: CoachSuggestion[] }> = [
    { title: 'Task Quality', suggestions: result.taskQuality },
    { title: 'Role Effectiveness', suggestions: result.roleEffectiveness },
    { title: 'Extension Health', suggestions: result.extensionHealth },
  ];

  for (const section of sections) {
    lines.push('');
    lines.push(`── ${section.title} ──`);

    if (section.suggestions.length === 0) {
      lines.push('  No issues found.');
      continue;
    }

    // Sort by priority: high > medium > low
    const priorityOrder: Record<SuggestionPriority, number> = { high: 0, medium: 1, low: 2 };
    const sorted = [...section.suggestions].sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
    );

    for (const s of sorted) {
      const icon = s.priority === 'high' ? '!' : s.priority === 'medium' ? '~' : '.';
      lines.push(`  [${icon}] ${s.taskId}: ${s.issue}`);
      lines.push(`      → ${s.action}`);
    }
  }

  return lines.join('\n');
}

export function formatCoachingJson(result: CoachingResult): string {
  return JSON.stringify(result, null, 2);
}
