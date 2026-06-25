import { describe, it, expect } from 'vitest';
import { ActionLog } from '../src/actionLog.js';

describe('ActionLog', () => {
  it('records and returns events oldest-first', () => {
    const log = new ActionLog(10);
    log.record({ ts: 1, kind: 'click' });
    log.record({ ts: 2, kind: 'fill' });
    expect(log.entries().map((e) => e.kind)).toEqual(['click', 'fill']);
  });

  it('evicts oldest events past capacity (FIFO)', () => {
    const log = new ActionLog(3);
    for (let i = 0; i < 5; i++) log.record({ ts: i, kind: `k${i}` });
    expect(log.entries().map((e) => e.ts)).toEqual([2, 3, 4]);
  });

  it('recent(n) returns the last n events', () => {
    const log = new ActionLog(10);
    for (let i = 0; i < 5; i++) log.record({ ts: i, kind: `k${i}` });
    expect(log.recent(2).map((e) => e.ts)).toEqual([3, 4]);
  });

  it('entries() returns a copy (mutating it does not affect the log)', () => {
    const log = new ActionLog();
    log.record({ ts: 1, kind: 'click' });
    const copy = log.entries();
    copy.push({ ts: 99, kind: 'rogue' });
    expect(log.entries()).toHaveLength(1);
  });

  it('clear() empties the buffer', () => {
    const log = new ActionLog();
    log.record({ ts: 1, kind: 'click' });
    log.clear();
    expect(log.entries()).toEqual([]);
  });

  it('rejects a capacity below 1', () => {
    expect(() => new ActionLog(0)).toThrow(/capacity/);
  });
});
