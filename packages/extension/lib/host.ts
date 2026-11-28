import { browser } from "wxt/browser"
import {
  REVIEW_HOST_VERSION,
  type HostFile,
  type ReviewHostReply,
  type ReviewHostRequest,
  type ReviewTarget,
} from "../../../shared/review-host"
import { currentDrop } from "./deployment"
import { blocked, type Policy } from "./injection"
import {
  forgetSession,
  heldSession,
  indexed,
  NOTES_TARGET,
  reviewFetch,
  reviewSession,
  siteIndex,
  siteTargets,
  type HostReply,
} from "./notes"
import { linked } from "./oauth"
import { local } from "./storage"

export interface HostSender {
  origin: string
  tabId: number
  windowId: number
}

export type PillStart = { drop: string; targets: ReviewTarget[]; target?: string } | { blocked: true }

const METHODS = new Set(["GET", "POST", "PATCH"])

const answer = (status: number, body: unknown): HostReply => ({
  status,
  type: "application/json",
  text: JSON.stringify(body),
})

async function picked(origin: string) {
  return ((await local.get("picked")) ?? {})[origin]
}

async function pick(origin: string, target: string) {
  const all = (await local.get("picked")) ?? {}
  if (all[origin] !== target) await local.set("picked", { ...all, [origin]: target })
}

async function reachable(origin: string) {
  const link = await linked()
  if (!link || link.drop !== (await currentDrop())) return false
  try {
    return indexed(await siteIndex(), origin)
  } catch {
    return true
  }
}

export async function start(origin: string, policy: Policy): Promise<PillStart> {
  if (blocked(origin, policy)) return { blocked: true }
  const drop = policy.drop
  if (!(await reachable(origin))) return { drop, targets: [NOTES_TARGET] }
  const targets = await siteTargets(origin).catch(() => [NOTES_TARGET])
  const target = await picked(origin)
  return { drop, targets, ...(target && targets.some((item) => item.id === target) ? { target } : {}) }
}

const bytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))

function form(data: unknown, files: HostFile[]) {
  const body = new FormData()
  body.append("data", JSON.stringify(data))
  for (const file of files)
    body.append(
      file.field === "image" ? "image" : "screenshot",
      new Blob([bytes(file.base64)], { type: file.type }),
      file.name,
    )
  return body
}

async function capture({ tabId, windowId }: HostSender) {
  const tab = await browser.tabs.get(tabId)
  if (!tab.active) throw new Error("Show this tab to take its screenshot.")
  return { dataUrl: await browser.tabs.captureVisibleTab(windowId, { format: "png" }) }
}

const DROP_WINDOW = { "copy-link": "copy", "copy-prompt": "prompt" } as const

async function openInDrop(origin: string, target: string, what: "copy-link" | "copy-prompt" | "review") {
  const held = await reviewSession(origin, target)
  const link = await linked()
  if (!held || !link) throw new Error("Connect to Drop first.")
  const hash = `#${encodeURIComponent(held.token)}`
  if (what === "review") await browser.tabs.create({ url: `${link.drop}/review/open${hash}` })
  else
    await browser.windows.create({
      url: `${link.drop}/review/open?${DROP_WINDOW[what]}${hash}`,
      type: "popup",
      width: 420,
      height: 360,
    })
  return { opened: true }
}

type Reply = ReviewHostReply[keyof ReviewHostReply]

export async function host(request: ReviewHostRequest, from: HostSender): Promise<Reply> {
  if (request?.v !== REVIEW_HOST_VERSION || typeof request.target !== "string" || !request.target)
    throw new Error("Drop's toolbar and the extension don't match. Reload the page.")
  const { origin } = from
  const { target } = request
  switch (request.type) {
    case "session": {
      if (request.clear) {
        await forgetSession(origin, target)
        return null
      }
      if (!(await reachable(origin))) return null
      const held = await reviewSession(origin, target)
      if (held) await pick(origin, target)
      return held?.reply ?? null
    }
    case "connect": {
      if (!(await linked())) {
        await browser.tabs.create({ url: browser.runtime.getURL("/welcome.html") })
        throw new Error("Connect the extension to your Drop first.")
      }
      const held = await reviewSession(origin, target, { create: target === NOTES_TARGET.id })
      if (!held) throw new Error("Drop didn't connect.")
      await pick(origin, target)
      return held.reply
    }
    case "list":
      return reviewFetch(
        origin,
        target,
        `/api/review/comments${request.refresh ? "/refresh" : ""}?page=${encodeURIComponent(request.page)}`,
        { method: request.refresh ? "POST" : "GET" },
      )
    case "call": {
      if (!METHODS.has(request.method)) throw new Error("That request isn't part of the review API.")
      const { json } = request
      return reviewFetch(origin, target, request.path, {
        method: request.method,
        ...(json === undefined ? {} : { body: () => JSON.stringify(json), type: "application/json" }),
      })
    }
    case "upload": {
      const { data, files } = request
      return reviewFetch(origin, target, request.path, { method: "POST", body: () => form(data, files) })
    }
    case "related":
      if (request.probe && !(await heldSession(origin, target))) return answer(200, { linked: false })
      return reviewFetch(origin, target, "/api/review/related", { method: "GET" })
    case "presence":
      if (target === NOTES_TARGET.id) return answer(404, { message: "Notes are private: nobody else is here." })
      return reviewFetch(origin, target, "/api/review/presence", { method: "POST" })
    case "capture":
      return capture(from)
    case "open":
      return openInDrop(origin, target, request.what)
  }
}
