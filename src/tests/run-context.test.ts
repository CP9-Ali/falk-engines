import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RunContextStore, type AnalysisRunContext } from '../replay/run-context';

const TEST_DIR = '.backup-runs-test';

describe('RunContextStore (§13)', () => {
  beforeAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('saves and loads run context', () => {
    const store = new RunContextStore(TEST_DIR);
    const ctx: AnalysisRunContext = {
      analysis_run_id: 'run-001',
      started_at_utc: new Date().toISOString(),
      settings_snapshot: { port: 3000, timeframes: ['1m', '5m'] },
      versions: { code_version: '1.0.0', schema_version: '1.0', policy_version: 'p1', config_version: 'c1' },
      feature_definitions: [{ feature_id: 'sma_20_1m', definition_version: '1.0.0', parameters: { period: 20 } }],
      settings_hash: RunContextStore.hashSettings({ port: 3000 }),
    };
    store.save(ctx);
    const loaded = store.load('run-001');
    expect(loaded).not.toBeNull();
    expect(loaded!.analysis_run_id).toBe('run-001');
    expect(loaded!.settings_snapshot.port).toBe(3000);
  });

  it('missing run returns null', () => {
    const store = new RunContextStore(TEST_DIR);
    expect(store.load('missing')).toBeNull();
  });

  it('settings hash is deterministic', () => {
    const s = { a: 1, b: 'x' };
    expect(RunContextStore.hashSettings(s)).toBe(RunContextStore.hashSettings(s));
  });

  it('settings hash differs when settings change', () => {
    expect(RunContextStore.hashSettings({ a: 1 })).not.toBe(RunContextStore.hashSettings({ a: 2 }));
  });

  it('generates unique run IDs', () => {
    const a = RunContextStore.newRunId();
    const b = RunContextStore.newRunId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^run-/);
  });
});