import { fullJitterDelayMs } from './backoff';

describe('fullJitterDelayMs', () => {
  const opts = { baseMs: 1000, capMs: 30000 };

  it('returns 0 when random is 0', () => {
    expect(fullJitterDelayMs(1, opts, () => 0)).toBe(0);
    expect(fullJitterDelayMs(5, opts, () => 0)).toBe(0);
  });

  it('scales exponentially with attempt at the random ceiling', () => {
    const atCeiling = () => 0.999999;
    expect(fullJitterDelayMs(1, opts, atCeiling)).toBeLessThan(1000);
    expect(fullJitterDelayMs(2, opts, atCeiling)).toBeLessThan(2000);
    expect(fullJitterDelayMs(2, opts, atCeiling)).toBeGreaterThanOrEqual(1900);
    expect(fullJitterDelayMs(3, opts, atCeiling)).toBeGreaterThanOrEqual(3900);
  });

  it('never exceeds the cap', () => {
    const delay = fullJitterDelayMs(50, opts, () => 0.999999);
    expect(delay).toBeLessThan(opts.capMs);
    expect(delay).toBeGreaterThanOrEqual(opts.capMs - 1);
  });

  it('stays within [0, ceiling) for random values', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
      const delay = fullJitterDelayMs(3, opts, () => r);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(4000);
    }
  });
});
