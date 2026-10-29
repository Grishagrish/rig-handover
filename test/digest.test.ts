import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const tempDirs: string[] = [];
const configBase = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
};

function runsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  tempDirs.push(dir);
  return dir;
}

function writeNight(dir: string, night: string, contents: string): void {
  writeFileSync(join(dir, `${night}.jsonl`), contents, 'utf8');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('digest routes', () => {
  it('returns JSON and renders the same sorted rows, including missing owners and warnings', async () => {
    const dir = runsDir();
    const night = '2026-10-28';
    writeNight(
      dir,
      night,
      [
        JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: 'zeta', status: 'ok', owner: 'sam' }),
        JSON.stringify({ at: '2026-10-28T01:01:00+01:00', job: 'alpha', status: 'retry', owner: null }),
        'this is not json',
        JSON.stringify({ at: '2026-10-28T01:02:00+01:00', job: 'alpha', status: 'retry', owner: null }),
        JSON.stringify({ at: '2026-10-28T01:03:00+01:00', job: 'alpha', status: 'retry', owner: null }),
        JSON.stringify({ at: '2026-10-28T01:04:00+01:00', job: 'alpha', status: 'fail', owner: null, error: '<script>alert(1)</script>' }),
      ].join('\n'),
    );
    const app = createApp({ ...configBase, runsDir: dir });

    const jsonResponse = await app.request(`/api/digest/${night}`);
    const pageResponse = await app.request(`/digest/${night}`);
    const payload = await jsonResponse.json();
    const html = await pageResponse.text();

    expect(jsonResponse.status).toBe(200);
    expect(pageResponse.status).toBe(200);
    expect(payload).toMatchObject({ night, badLines: 1 });
    expect(payload.rows.map((row: { job: string }) => row.job)).toEqual(['alpha', 'zeta']);
    expect(payload.rows[0]).toMatchObject({
      job: 'alpha',
      owner: null,
      runs: 4,
      retries: 3,
      lastStatus: 'fail',
      lastError: '<script>alert(1)</script>',
      firstAt: '2026-10-28T01:01:00+01:00',
      lastAt: '2026-10-28T01:04:00+01:00',
    });

    const jobOrder = payload.rows.map((row: { job: string }) => row.job);
    const pageOrder = jobOrder.map((job: string) => html.indexOf(job));
    expect(pageOrder.every((position: number) => position >= 0)).toBe(true);
    expect(pageOrder).toEqual([...pageOrder].sort((a: number, b: number) => a - b));
    expect(html).toContain('—');
    expect(html).toContain('class="warn"');
    expect(html).toContain('retries');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('returns 404 when the requested night file is missing', async () => {
    const app = createApp({ ...configBase, runsDir: runsDir() });

    expect((await app.request('/digest/2026-10-27')).status).toBe(404);
    expect((await app.request('/api/digest/2026-10-27')).status).toBe(404);
  });

  it('renders an existing empty night as nothing ran', async () => {
    const dir = runsDir();
    writeNight(dir, '2026-10-28', '');
    const app = createApp({ ...configBase, runsDir: dir });

    const pageResponse = await app.request('/digest/2026-10-28');
    const jsonResponse = await app.request('/api/digest/2026-10-28');

    expect(pageResponse.status).toBe(200);
    expect(await pageResponse.text()).toContain('nothing ran');
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toMatchObject({ night: '2026-10-28', rows: [], badLines: 0 });
  });

  it('counts malformed lines while still returning and rendering valid rows', async () => {
    const dir = runsDir();
    writeNight(
      dir,
      '2026-10-28',
      [
        JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: 'valid-job', status: 'ok', owner: 'lee' }),
        '{broken json',
      ].join('\n'),
    );
    const app = createApp({ ...configBase, runsDir: dir });

    const pageResponse = await app.request('/digest/2026-10-28');
    const jsonResponse = await app.request('/api/digest/2026-10-28');

    expect(pageResponse.status).toBe(200);
    expect(await pageResponse.text()).toContain('valid-job');
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toMatchObject({
      badLines: 1,
      rows: [{ job: 'valid-job', runs: 1, lastStatus: 'ok' }],
    });
  });
});
