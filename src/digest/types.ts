export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  night: string;
  rows: DigestRow[];
  badLines: number;
  counts: Record<RunStatus, number>;
};

// null means the night has no file; an existing empty file has rows: [].
// The implementation lives in reader.ts; every consumer shares this contract.
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
