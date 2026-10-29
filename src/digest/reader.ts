import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type RunEvent = { at: string; job: string; status: RunStatus; owner: string | null; error?: string };

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return null; }
  if (typeof value !== 'object' || value === null) return null;
  const event = value as Record<string, unknown>;
  if (typeof event.at !== 'string' || !Number.isFinite(Date.parse(event.at)) ||
      typeof event.job !== 'string' || event.job.length === 0 ||
      !['ok', 'retry', 'fail'].includes(String(event.status)) ||
      !(event.owner === null || typeof event.owner === 'string') ||
      !(event.error === undefined || typeof event.error === 'string')) return null;
  return event as RunEvent;
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  let text: string;
  try { text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8'); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  const rows = new Map<string, DigestRow>();
  const lastErrorAt = new Map<string, number>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    const event = parseEvent(line);
    if (!event) { badLines++; continue; }
    counts[event.status]++;
    const at = Date.parse(event.at);
    const row = rows.get(event.job);
    if (!row) {
      rows.set(event.job, { job: event.job, owner: event.owner, runs: 1,
        retries: event.status === 'retry' ? 1 : 0, lastStatus: event.status,
        lastError: event.error ?? null, firstAt: event.at, lastAt: event.at });
      if (event.error !== undefined) lastErrorAt.set(event.job, at);
      continue;
    }
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (at < Date.parse(row.firstAt)) row.firstAt = event.at;
    if (at >= Date.parse(row.lastAt)) {
      row.lastAt = event.at;
      row.lastStatus = event.status;
      row.owner = event.owner;
    }
    if (event.error !== undefined && at >= (lastErrorAt.get(event.job) ?? -Infinity)) {
      row.lastError = event.error;
      lastErrorAt.set(event.job, at);
    }
  }
  return { night, rows: [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0),
    badLines, counts };
};
