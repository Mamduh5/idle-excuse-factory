export type OfflineEarningsResult = {
  cappedSeconds: number;
  coins: number;
  totalAwaySeconds: number;
};

export const offlineEarningsCapMs = 2 * 60 * 60 * 1000;
export const offlineEarningsMinimumAwayMs = 30 * 1000;
const offlineCoinsPerMinute = 5;

export function calculateOfflineEarnings(lastActiveAtMs: number | undefined, nowMs = Date.now()): OfflineEarningsResult | undefined {
  if (!isValidTimestamp(lastActiveAtMs) || !isValidTimestamp(nowMs)) {
    return undefined;
  }

  const awayMs = nowMs - lastActiveAtMs;
  if (!Number.isFinite(awayMs) || awayMs < offlineEarningsMinimumAwayMs) {
    return undefined;
  }

  const cappedMs = Math.min(awayMs, offlineEarningsCapMs);
  const cappedSeconds = Math.floor(cappedMs / 1000);
  const totalAwaySeconds = Math.floor(awayMs / 1000);
  // MVP formula: fixed passive factory income of 5 coins per counted offline minute.
  const coins = sanitizeCoins((cappedSeconds / 60) * offlineCoinsPerMinute);

  if (coins <= 0) {
    return undefined;
  }

  return {
    cappedSeconds,
    coins,
    totalAwaySeconds,
  };
}

function isValidTimestamp(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function sanitizeCoins(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
