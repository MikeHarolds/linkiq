import { computeVisitorHash } from './visitor-hash';

const SALT = 'test-salt';

describe('computeVisitorHash', () => {
  it('is deterministic for identical inputs', () => {
    const day = new Date('2026-01-15T10:00:00.000Z');
    const a = computeVisitorHash('1.2.3.4', 'Mozilla/5.0', day, SALT);
    const b = computeVisitorHash('1.2.3.4', 'Mozilla/5.0', day, SALT);
    expect(a).toBe(b);
  });

  it('produces the same hash for two events on the same UTC day, different times', () => {
    const morning = new Date('2026-01-15T01:00:00.000Z');
    const evening = new Date('2026-01-15T23:59:00.000Z');
    const a = computeVisitorHash('1.2.3.4', 'Mozilla/5.0', morning, SALT);
    const b = computeVisitorHash('1.2.3.4', 'Mozilla/5.0', evening, SALT);
    expect(a).toBe(b);
  });

  it('produces a different hash on a different UTC day (by design)', () => {
    const day1 = new Date('2026-01-15T23:59:00.000Z');
    const day2 = new Date('2026-01-16T00:00:01.000Z');
    const a = computeVisitorHash('1.2.3.4', 'Mozilla/5.0', day1, SALT);
    const b = computeVisitorHash('1.2.3.4', 'Mozilla/5.0', day2, SALT);
    expect(a).not.toBe(b);
  });

  it('produces a different hash for a different IP', () => {
    const day = new Date('2026-01-15T10:00:00.000Z');
    const a = computeVisitorHash('1.2.3.4', 'Mozilla/5.0', day, SALT);
    const b = computeVisitorHash('5.6.7.8', 'Mozilla/5.0', day, SALT);
    expect(a).not.toBe(b);
  });

  it('produces a different hash for a different user agent', () => {
    const day = new Date('2026-01-15T10:00:00.000Z');
    const a = computeVisitorHash('1.2.3.4', 'Mozilla/5.0 Chrome', day, SALT);
    const b = computeVisitorHash('1.2.3.4', 'Mozilla/5.0 Safari', day, SALT);
    expect(a).not.toBe(b);
  });

  it('produces a different hash under a different salt (rotation changes future hashes)', () => {
    const day = new Date('2026-01-15T10:00:00.000Z');
    const a = computeVisitorHash('1.2.3.4', 'Mozilla/5.0', day, 'salt-a');
    const b = computeVisitorHash('1.2.3.4', 'Mozilla/5.0', day, 'salt-b');
    expect(a).not.toBe(b);
  });

  it('never contains the raw IP address in its output', () => {
    const day = new Date('2026-01-15T10:00:00.000Z');
    const hash = computeVisitorHash('192.168.1.100', 'Mozilla/5.0', day, SALT);
    expect(hash).not.toContain('192.168.1.100');
  });

  it('produces a 64-character hex SHA-256 digest', () => {
    const hash = computeVisitorHash('1.2.3.4', 'Mozilla/5.0', new Date(), SALT);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
