export const saveRetryDelay = (failures: number) => Math.min(60_000, 5000 * 2 ** (failures - 1))
