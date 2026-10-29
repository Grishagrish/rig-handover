import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const dirs: string[] = [];
function fixture(text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  dirs.push(dir);
  writeFileSync(join(dir, '2026-10-28.jsonl'), text);
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('readNight', () => {
  it('reads the real night, retaining retries, errors, and null owners', () => {
    const digest = readNight('runs', '2026-10-28');
    expect(digest?.badLines).toBe(1);
    expect(digest?.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows.find(row => row.job === 'digest/render')?.owner).toBeNull();
    expect(digest?.rows.find(row => row.job === 'fixtures/refresh')).toMatchObject({
      runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
    });
  });

  it('distinguishes empty files, missing files, and invalid night paths', () => {
    const dir = fixture('');
    expect(readNight(dir, '2026-10-28')).toEqual({ night: '2026-10-28', rows: [],
      badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    expect(readNight(dir, '2026-10-27')).toBeNull();
    expect(readNight(dir, '../2026-10-28')).toBeNull();
  });

  it('rejects malformed records and keeps original offsets while ordering by instant', () => {
    const dir = fixture([
      JSON.stringify({ at: '2026-10-28T23:00:00+01:00', job: 'job', owner: null, status: 'ok' }),
      JSON.stringify({ at: '2026-10-28T20:00:00-01:00', job: 'job', owner: 'older', status: 'retry', error: 'old error' }),
      JSON.stringify({ at: '2026-10-28T21:30:00Z', job: 'job', owner: 'middle', status: 'fail', error: 'new error' }),
      '{', 'null', '{}', JSON.stringify({ at: 'bad', job: 'x', owner: null, status: 'ok' }), '',
    ].join('\n'));
    const digest = readNight(dir, '2026-10-28');
    expect(digest?.badLines).toBe(4);
    expect(digest?.rows).toEqual([{ job: 'job', owner: null, runs: 3, retries: 1,
      lastStatus: 'ok', lastError: 'new error', firstAt: '2026-10-28T20:00:00-01:00',
      lastAt: '2026-10-28T23:00:00+01:00' }]);
  });
});
