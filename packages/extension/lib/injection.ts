import { browser, type Browser } from "wxt/browser"
import { matchesContentOrigin } from "./deployment"
import type { Hand, InjectResult } from "./messages"
import { session } from "./storage"

export const REVIEW_SCRIPT = "/content-scripts/review.js"

export interface Policy {
  drop: string
  content?: string
}

export function blocked(url: string, policy: Policy): "drop" | "unsupported" | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return "unsupported"
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "unsupported"
  if (parsed.origin === policy.drop || matchesContentOrigin(parsed.origin, policy.content)) return "drop"
  return undefined
}

export async function probe(tabId: number) {
  try {
    const [result] = await browser.scripting.executeScript({ target: { tabId }, func: () => location.href })
    return typeof result?.result === "string" ? result.result : undefined
  } catch {
    return undefined
  }
}

export async function openTabs() {
  return (await session.get("open")) ?? {}
}

export async function markClosed(tabId: number) {
  const { [String(tabId)]: _closed, ...rest } = await openTabs()
  await session.set("open", rest)
}

async function markOpen(tabId: number, origin: string) {
  await session.set("open", { ...(await openTabs()), [String(tabId)]: origin })
}

export async function inject(tabId: number, policy: Policy): Promise<InjectResult> {
  const url = await probe(tabId)
  if (!url) return { ok: false, reason: "no-grant" }
  const reason = blocked(url, policy)
  if (reason) return { ok: false, reason: reason === "drop" ? "blocked" : "unsupported" }
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [REVIEW_SCRIPT] })
  } catch (error) {
    return { ok: false, reason: "failed", error: error instanceof Error ? error.message : String(error) }
  }
  const origin = new URL(url).origin
  await markOpen(tabId, origin)
  return { ok: true, origin }
}

export interface Settings {
  hand: Hand
  kept: string[]
}

function originOf(url: string | undefined) {
  if (!url) return undefined
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

export async function onTabLoaded(
  tabId: number,
  tab: Pick<Browser.tabs.Tab, "url">,
  policy: Policy,
  settings: Settings,
) {
  const wasOpen = String(tabId) in (await openTabs())
  const origin = originOf(tab.url)
  const kept = origin !== undefined && settings.kept.includes(origin)
  const everywhere = async () =>
    settings.hand === "everywhere" &&
    origin !== undefined &&
    (await browser.permissions.contains({ origins: ["<all_urls>"] }))
  if (!wasOpen && !kept && !(await everywhere())) return undefined
  const result = await inject(tabId, policy)
  if (!result.ok) await markClosed(tabId)
  return result
}
