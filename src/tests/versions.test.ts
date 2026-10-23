import { describe, it, expect } from 'vitest';
import { ENGINE_VERSIONS, FALK_CODE_VERSION, engineVersion, versionBundle, VERSION_HISTORY } from '../core/versions';

describe('Versions (§2.8)', () => {
  it('every engine has a version', () => {
    for (const key of Object.keys(ENGINE_VERSIONS)) {
      expect(ENGINE_VERSIONS[key as keyof typeof ENGINE_VERSIONS]).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('engineVersion returns correct string', () => {
    expect(engineVersion('fusion')).toBe('1.0.0');
    expect(engineVersion('normalization')).toBe('1.0.0');
  });

  it('versionBundle has code + engines', () => {
    const b = versionBundle();
    expect(b.code).toBe(FALK_CODE_VERSION);
    expect(b.engines.ingestion).toBe('1.0.0');
  });

  it('VERSION_HISTORY has every engine', () => {
    const engines = VERSION_HISTORY.map(v => v.engine);
    for (const key of Object.keys(ENGINE_VERSIONS)) {
      expect(engines).toContain(key);
    }
  });
});