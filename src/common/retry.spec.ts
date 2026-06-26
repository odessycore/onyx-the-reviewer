import { retryWithBackoff } from './retry';

const noSleep = (): Promise<void> => Promise.resolve();

describe('retryWithBackoff', () => {
  it('returns immediately on success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(
      retryWithBackoff(fn, { maxAttempts: 3, baseMs: 1, capMs: 1, sleep: noSleep }),
    ).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until it succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue('ok');
    await expect(
      retryWithBackoff(fn, { maxAttempts: 5, baseMs: 1, capMs: 1, sleep: noSleep }),
    ).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after exhausting attempts', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always'));
    await expect(
      retryWithBackoff(fn, { maxAttempts: 3, baseMs: 1, capMs: 1, sleep: noSleep }),
    ).rejects.toThrow('always');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry when shouldRetry returns false', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fatal'));
    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 5,
        baseMs: 1,
        capMs: 1,
        sleep: noSleep,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
