import { describe, it, expect } from 'vitest';
import { ConnectorManager } from '../ingestion/connector-manager';

describe('ConnectorManager (§5)', () => {
  it('registers connector with DISCONNECTED state', () => {
    const cm = new ConnectorManager();
    cm.register({ source_id: 'test', start: async () => {}, stop: () => {} });
    const h = cm.health('test');
    expect(h?.state).toBe('DISCONNECTED');
    expect(h?.consecutive_failures).toBe(0);
  });

  it('markConnected resets failures', () => {
    const cm = new ConnectorManager();
    cm.register({ source_id: 'test', start: async () => {}, stop: () => {} });
    cm.markFailed('test', 'err1');
    cm.markFailed('test', 'err2');
    cm.markConnected('test');
    expect(cm.health('test')?.state).toBe('CONNECTED');
    expect(cm.health('test')?.consecutive_failures).toBe(0);
  });

  it('markFailed increments failures', () => {
    const cm = new ConnectorManager();
    cm.register({ source_id: 'test', start: async () => {}, stop: () => {} });
    cm.markFailed('test', 'boom');
    expect(cm.health('test')?.consecutive_failures).toBe(1);
    expect(cm.health('test')?.last_error).toBe('boom');
  });

  it('startAll calls all connectors', async () => {
    const cm = new ConnectorManager();
    let s1 = false, s2 = false;
    cm.register({ source_id: 'a', start: async () => { s1 = true; }, stop: () => {} });
    cm.register({ source_id: 'b', start: async () => { s2 = true; }, stop: () => {} });
    await cm.startAll();
    expect(s1).toBe(true);
    expect(s2).toBe(true);
    expect(cm.health('a')?.state).toBe('CONNECTED');
  });

  it('isHealthy respects maxFailures', () => {
    const cm = new ConnectorManager();
    cm.register({ source_id: 'test', start: async () => {}, stop: () => {} });
    cm.markConnected('test');
    expect(cm.isHealthy('test')).toBe(true);
    for (let i = 0; i < 5; i++) cm.markFailed('test', 'e');
    expect(cm.isHealthy('test')).toBe(false);
  });
});