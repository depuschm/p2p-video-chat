const MAX_FAILURES = 8;        // failures allowed within the window
const WINDOW_MS = 60_000;      // rolling window
const LOCKOUT_MS = 5 * 60_000; // lockout after too many failures

const state = new Map(); // ip -> { failures: number[], lockedUntil: number }

function now() {
  return Date.now();
}

export const rateLimiter = {
  check(ip) {
    const entry = state.get(ip);
    if (!entry) return { allowed: true };

    if (entry.lockedUntil && entry.lockedUntil > now()) {
      return { allowed: false, retryAfterMs: entry.lockedUntil - now() };
    }
    return { allowed: true };
  },

  recordFailure(ip) {
    const entry = state.get(ip) ?? { failures: [], lockedUntil: 0 };
    const cutoff = now() - WINDOW_MS;
    entry.failures = entry.failures.filter((t) => t > cutoff);
    entry.failures.push(now());

    if (entry.failures.length >= MAX_FAILURES) {
      entry.lockedUntil = now() + LOCKOUT_MS;
      entry.failures = [];
    }
    state.set(ip, entry);
  },

  recordSuccess(ip) {
    state.delete(ip);
  },
};

// Periodically drop stale entries so the map doesn't grow unbounded.
setInterval(() => {
  const t = now();
  for (const [ip, entry] of state) {
    const stale = (!entry.lockedUntil || entry.lockedUntil < t) &&
      entry.failures.every((f) => f < t - WINDOW_MS);
    if (stale) state.delete(ip);
  }
}, WINDOW_MS).unref();
