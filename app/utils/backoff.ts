/**
 * How long a board save waits after its `failures`-th failure in a row: 5 s, doubling, at most a minute. After six it
 * stops, and the next change tries again.
 */
export const saveRetryDelay = (failures: number) =>
  failures >= 6 ? undefined : Math.min(60_000, 5000 * 2 ** (failures - 1))
