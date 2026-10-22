import { describe, it, expect } from 'vitest';
import { HashChainAuditLog } from '../audit/audit-log';
import { SchemaValidator } from '../contracts/schema-validator';
import { SecretsManager, InMemorySecrets } from '../security/secrets';
import { ConfigChangeLog } from '../security/config-change-log';
import { BackupManager, InMemoryOffsite } from '../backup/backup-manager';
import { DataFusionEngine } from '../data-fusion/engine';
import { FeatureRegistry } from '../feature-engineering/registry';
import { FeatureEngineeringEngine } from '../feature-engineering/engine';
import { simpleReturn1h } from '../feature-engineering/examples';
import { ShadowTester } from '../feature-engineering/shadow-tester';
import { isCandleClosed } from '../core/time';
import type { RawDataPoint } from '../core/types';
import type { MessageEnvelope } from '../contracts/messages';

const T = (h: number) => new Date(Date.UTC(2025, 0, 1, h)).toISOString();

describe('Gap 2: Closed candle enforcement', () => {
  it('rejects in-progress candle', () => {
    const p: RawDataPoint = {
      sourceId: 'a', value: {}, eventTime: T(1), closedAt: T(2),
      arrivalTime: T(1), availabilityTime: T(1), version: 1, fingerprint: 'f',
    };
    expect(isCandleClosed(p, 3600_000, T(1))).toBe(false);
    expect(isCandleClosed(p, 3600_000, T(2))).toBe(true);
  });

  it('feature excludes in-progress candle', () => {
    const reg = new FeatureRegistry(); reg.register(simpleReturn1h);
    const fe = new FeatureEngineeringEngine(reg,
      { engineVersion: '1', policyVersion: 'p', configVersion: 'c' },
      new HashChainAuditLog());
    const points: RawDataPoint<{ close: number }>[] = [
      { sourceId: 'a', value: { close: 100 }, eventTime: T(0), closedAt: T(1), arrivalTime: T(1), availabilityTime: T(1), version: 1, fingerprint: 'a' },
      { sourceId: 'a', value: { close: 110 }, eventTime: T(1), closedAt: T(2), arrivalTime: T(1), availabilityTime: T(1), version: 1, fingerprint: 'b' },
    ];
    const r = fe.computeBatch({
      requestId: 'r', asOfCutoff: T(1),
      snapshotRef: { snapshotId: 's', contentFingerprint: 'c' },
      fusionPolicyVersion: 'p',
      targets: [{ featureId: 'simple_return_1h', definitionVersion: '1.0.0' }],
      inputs: new Map([['simple_return_1h', points]]),
      actor: 'test',
    }).get('simple_return_1h')!;
    expect(r.status).toBe('INSUFFICIENT_INPUTS');
  });
});

describe('Gap 4: SchemaValidator', () => {
  const validEnv: MessageEnvelope = {
    messageId: 'm1', requestId: 'r1', messageType: 'QUALITY_CHECK_REQUEST',
    sender: 'a', recipient: 'b', schemaVersion: '1.0',
    dataReference: { snapshotId: 's', contentFingerprint: 'c' },
    timeContext: { eventTime: T(0), arrivalTime: T(0), processingTime: T(0), asOfCutoff: T(0) },
    policyVersion: 'p', payload: {}, executionStatus: 'SUCCESS', traceId: 'tr',
  };

  it('accepts valid message', () => {
    expect(new SchemaValidator().validate(validEnv).valid).toBe(true);
  });

  it('rejects unknown schema version', () => {
    const r = new SchemaValidator().validate({ ...validEnv, schemaVersion: '99' });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.field === 'schemaVersion')).toBe(true);
  });

  it('rejects empty messageId', () => {
    expect(new SchemaValidator().validate({ ...validEnv, messageId: '' }).valid).toBe(false);
  });
});

describe('Gap 5: Immutable snapshots', () => {
  it('detects payload tampering', () => {
    const audit = new HashChainAuditLog();
    const off = new InMemoryOffsite();
    const mgr = new BackupManager(audit,
      { rpoMs: 1000, rtoMs: 5000, offsiteRequired: true }, off);
    const s = mgr.takeSnapshot('FULL', 'original', 'admin');
    off.store_.set(s.snapshotId, { ...s, payload: 'tampered' });
    const r = mgr.testRestore(s.snapshotId, 'admin');
    expect(r.integrityOk).toBe(false);
    expect(r.ok).toBe(false);
  });
});

describe('Gap 6: allowSourceSwitching', () => {
  const t = T(0);
  const base = (id: string, close: number) => ({
    sourceId: id, value: { close }, eventTime: t, availabilityTime: t,
    sourceVersion: 1, qualityStatus: 'PASS' as const,
  });

  it('blocks switch when policy forbids', () => {
    const audit = new HashChainAuditLog();
    const fusion = new DataFusionEngine(audit, '1.0');
    fusion.fuse([base('A', 100), base('B', 100)], {
      policyVersion: 'p', priorityOrder: ['A', 'B'],
      conflictStrategy: 'STRICT_PRIORITY', toleranceBps: 50,
      allowSourceSwitching: false,
    }, t, 'test', 'btc');
    fusion.fuse([base('B', 200)], {
      policyVersion: 'p', priorityOrder: ['A', 'B'],
      conflictStrategy: 'STRICT_PRIORITY', toleranceBps: 50,
      allowSourceSwitching: false,
    }, t, 'test', 'btc');
    const blocked = audit.readAll().some(e => e.eventType === 'FUSION_SWITCH_BLOCKED');
    expect(blocked).toBe(true);
  });
});

describe('Gap 9: ShadowTester', () => {
  it('detects identical versions', () => {
    const tester = new ShadowTester();
    const inputs: RawDataPoint<{ close: number }>[] = [
      { sourceId: 'a', value: { close: 100 }, eventTime: T(0), closedAt: T(1), arrivalTime: T(1), availabilityTime: T(1), version: 1, fingerprint: 'a' },
      { sourceId: 'a', value: { close: 105 }, eventTime: T(1), closedAt: T(2), arrivalTime: T(2), availabilityTime: T(2), version: 1, fingerprint: 'b' },
    ];
    const def = { ...simpleReturn1h, definitionVersion: '1.0.0' };
    const cmp = tester.compare(def, def, inputs, T(2),
      { snapshotId: 's', contentFingerprint: 'c' }, 'p');
    expect(cmp.match).toBe(true);
    expect(cmp.oldValue).toBe(cmp.newValue);
  });
});

describe('Gap 8: Secrets + ConfigChangeLog', () => {
  it('logs secret access without value', () => {
    const audit = new HashChainAuditLog();
    const secrets = new SecretsManager(new InMemorySecrets(), audit);
    secrets.set('api-key', 'super-secret', 'admin');
    const v = secrets.get('api-key', 'admin');
    expect(v).toBe('super-secret');
    const events = audit.readAll();
    const secretEvents = events.filter(e => e.eventType === 'SECRET_ACCESSED');
    expect(secretEvents.length).toBe(1);
    expect(JSON.stringify(secretEvents[0]!.payload)).not.toContain('super-secret');
  });

  it('logs before/after for config change', () => {
    const audit = new HashChainAuditLog();
    const log = new ConfigChangeLog(audit);
    log.record({
      key: 'fusion.toleranceBps', before: 50, after: 75,
      reason: 'market volatility increased', changedBy: 'admin',
    });
    const ev = audit.readAll().find(e => e.eventType === 'CONFIG_CHANGED');
    expect(ev).toBeDefined();
    expect(ev!.payload.before).toBe(50);
    expect(ev!.payload.after).toBe(75);
    expect(ev!.actor).toBe('admin');
  });
});