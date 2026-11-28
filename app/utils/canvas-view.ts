const VERSIONED = /^#?(@.+),v(\d+)$/

export const canvasViewHash = (view: string, version: number) => (view ? `#${view},v${version}` : "")

export function canvasViewOn(hash: string, version: number) {
  let text = hash
  try {
    text = decodeURIComponent(hash)
  } catch {}
  const match = VERSIONED.exec(text)
  return match && Number(match[2]) === version ? `#${match[1]}` : null
}
