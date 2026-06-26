import { BackoffOptions, fullJitterDelayMs } from './backoff';

export interface RetryOptions extends BackoffOptions {
  maxAttempts: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Runs `fn`, retrying transient failures with full-jitter exponential backoff.
// Used to wrap outbound GitHub / LLM / embedding API calls.
export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { maxAttempts, shouldRetry = () => true, onRetry, sleep = defaultSleep } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error)) {
        break;
      }
      const delayMs = fullJitterDelayMs(attempt, options);
      onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastError;
}
