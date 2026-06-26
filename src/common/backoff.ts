export interface BackoffOptions {
  baseMs: number;
  capMs: number;
}

// "Full jitter" exponential backoff (AWS Architecture Blog): pick a uniformly random
// delay in [0, min(cap, base * 2^(attempt-1))). Spreads retries to avoid thundering herds.
// `attempt` is 1-based (the delay to wait before attempt N+1 is computed from attempt N).
export const fullJitterDelayMs = (
  attempt: number,
  { baseMs, capMs }: BackoffOptions,
  random: () => number = Math.random,
): number => {
  const exponential = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * exponential);
};
