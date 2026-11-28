const held = new Set<string>()

export function hold(...values: (string | undefined)[]) {
  for (const value of values) if (value) held.add(value)
}

export function release(...values: (string | undefined)[]) {
  for (const value of values) if (value) held.delete(value)
}

export function leaks(serialized: string) {
  for (const value of held) if (serialized.includes(value)) return true
  return false
}
