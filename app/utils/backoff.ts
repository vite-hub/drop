/**
 * How long a board save waits after its `failures`-th failure in a row: 5 s, doubling, then once a minute until the
 * server answers, so edits made before an outage still save once it ends.
 */
export const saveRetryDelay = (failures: number) => Math.min(60_000, 5000 * 2 ** (failures - 1))
