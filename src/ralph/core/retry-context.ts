import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface RetryContext {
  lastPhase: string;
  lastError: string;
  modifiedFiles: string[];
}

const MAX_RETRY_CONTEXT_LENGTH = 2000;
const PHASE_RE = /\[PHASE\]\s*Entering:\s*(\w+)/;

function extractPhases(lines: ParsedLine[]): string {
  let lastPhase = 'unknown';
  for (const line of lines) {
    if (line.type === 'text') {
      const match = line.text.match(PHASE_RE);
      if (match) {
        lastPhase = match[1];
      }
    }
  }
  return lastPhase;
}

function extractErrors(lines: ParsedLine[]): string {
  let lastError = '';
  for (const line of lines) {
    if (line.type === 'tool_result' && line.text) {
      const text = line.text;
      if (
        text.includes('Error') ||
        text.includes('FAIL') ||
        text.includes('error') ||
        text.includes('fail') ||
        text.includes('Cannot find') ||
        text.includes('TypeError') ||
        text.includes('×')
      ) {
        lastError = text;
      }
    }
  }
  return lastError;
}

function extractModifiedFiles(lines: ParsedLine[]): string[] {
  const files = new Set<string>();
  for (const line of lines) {
    if (line.type === 'tool_use' && (line.toolName === 'Write' || line.toolName === 'Edit')) {
      if (line.filePath) {
        files.add(toRelativePath(line.filePath));
      }
    }
  }
  return [...files];
}

function toRelativePath(absPath: string): string {
  const parts = absPath.split('/');
  const srcIdx = parts.indexOf('src');
  if (srcIdx !== -1) {
    return parts.slice(srcIdx).join('/');
  }
  const docsIdx = parts.indexOf('docs');
  if (docsIdx !== -1) {
    return parts.slice(docsIdx).join('/');
  }
  return parts[parts.length - 1];
}

interface ParsedLine {
  type: 'text' | 'tool_use' | 'tool_result' | 'other';
  text: string;
  toolName?: string;
  filePath?: string;
}

function parseLogLines(content: string): ParsedLine[] {
  const result: ParsedLine[] = [];
  for (const rawLine of content.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);

      if (obj.type === 'assistant' && obj.message?.content) {
        for (const block of obj.message.content) {
          if (block.type === 'text') {
            result.push({ type: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            result.push({
              type: 'tool_use',
              text: '',
              toolName: block.name,
              filePath: block.input?.file_path,
            });
          }
        }
      } else if (obj.type === 'result') {
        result.push({
          type: 'tool_result',
          text: typeof obj.content === 'string' ? obj.content : '',
          toolName: obj.tool_name,
        });
      }
    } catch {
      // skip unparseable lines
    }
  }
  return result;
}

export function extractRetryContext(logContent: string): RetryContext | null {
  if (!logContent.trim()) return null;

  const lines = parseLogLines(logContent);
  if (lines.length === 0) return null;

  const lastPhase = extractPhases(lines);
  const lastError = extractErrors(lines);
  const modifiedFiles = extractModifiedFiles(lines);

  return { lastPhase, lastError, modifiedFiles };
}

export function formatRetryContext(ctx: RetryContext | null): string {
  if (!ctx) return '';

  const sections: string[] = [];

  sections.push('RETRY CONTEXT (from previous failed attempt):');
  sections.push('');
  sections.push(`Last phase reached: ${ctx.lastPhase}`);

  if (ctx.lastError) {
    const errorTruncated =
      ctx.lastError.length > 800 ? ctx.lastError.slice(0, 800) + '\n...(truncated)' : ctx.lastError;
    sections.push('');
    sections.push('Last error output:');
    sections.push('```');
    sections.push(errorTruncated);
    sections.push('```');
  }

  if (ctx.modifiedFiles.length > 0) {
    sections.push('');
    sections.push('Files modified in previous attempt:');
    for (const f of ctx.modifiedFiles) {
      sections.push(`- ${f}`);
    }
  }

  sections.push('');
  sections.push(
    'IMPORTANT: The previous attempt failed. Avoid repeating the same approach. Focus on fixing the failure point rather than rewriting from scratch. Reference the files listed above as your starting point.',
  );

  let result = sections.join('\n');
  if (result.length > MAX_RETRY_CONTEXT_LENGTH) {
    result = result.slice(0, MAX_RETRY_CONTEXT_LENGTH - 3) + '...';
  }

  return result;
}

export async function findLatestLogForTask(
  logsDir: string,
  taskId: string,
): Promise<string | null> {
  try {
    const entries = await readdir(logsDir);
    const taskLogs = entries.filter((f) => f.startsWith(taskId) && f.endsWith('.jsonl')).sort();
    if (taskLogs.length === 0) return null;
    return join(logsDir, taskLogs[taskLogs.length - 1]);
  } catch {
    return null;
  }
}

export async function buildRetryContext(logsDir: string, taskId: string): Promise<string> {
  const logPath = await findLatestLogForTask(logsDir, taskId);
  if (!logPath) return '';

  const content = await readFile(logPath, 'utf-8');
  const ctx = extractRetryContext(content);
  return formatRetryContext(ctx);
}
