import { browser } from "wxt/browser"
import { checkDrop, currentDrop, originPattern, type DropCheck } from "./deployment"
import { blocked, inject, markClosed, onTabLoaded, openTabs, probe, type Policy } from "./injection"
import type { Hand, SiteState, State } from "./messages"
import { notesIndex, notesTargets, reviewFetch, reviewSession } from "./notes"
import { link, linked, unlink } from "./oauth"
import { listen, type ContentHandlers, type PageHandlers } from "./router"
import { local } from "./storage"

const MENU_ID = "drop-comment"
const ALL_SITES = "<all_urls>"

async function policy(): Promise<Policy> {
  const drop = await currentDrop()
  const hello = await local.get("hello")
  return { drop, ...(hello?.drop === drop && hello.content ? { content: hello.content } : {}) }
}

async function settings() {
  const hand: Hand = (await local.get("hand")) ?? "press"
  return { hand, kept: (await local.get("kept")) ?? [] }
}

function siteOrigin(input: string) {
  try {
    const url = new URL(input)
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined
    return url.origin === input ? url.origin : undefined
  } catch {
    return undefined
  }
}

async function siteState(tabId: number, kept: string[]): Promise<SiteState | undefined> {
  const tab = await browser.tabs.get(tabId).catch(() => undefined)
  const url = tab?.url ?? (await probe(tabId))
  if (!url) return undefined
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    return undefined
  }
  const reason = blocked(url, await policy())
  return { origin, kept: kept.includes(origin), ...(reason ? { blocked: reason } : {}) }
}

async function state(tabId?: number): Promise<State> {
  const drop = await currentDrop()
  const hello = await local.get("hello")
  const current = await linked()
  const { hand, kept } = await settings()
  const site = tabId === undefined ? undefined : await siteState(tabId, kept)
  return {
    drop,
    hand,
    kept,
    ...(hello?.drop === drop ? { dropName: hello.name } : {}),
    ...(current?.drop === drop
      ? {
          account: {
            ...(current.name ? { name: current.name } : {}),
            ...(current.email ? { email: current.email } : {}),
          },
        }
      : {}),
    ...(site ? { site } : {}),
  }
}

const CHECK_ERRORS: Record<Extract<DropCheck, { ok: false }>["error"], string> = {
  "invalid-address": "That isn't a Drop address. Use https://, or http:// on this computer.",
  unreachable: "Couldn't reach that address.",
  "not-a-drop": "That address answered, but it isn't a Drop.",
  "server-error": "That Drop has a problem right now. Try again later.",
}

const pageHandlers: PageHandlers = {
  "state.get": ({ tabId }) => state(tabId),
  "deployment.check": ({ drop }) => checkDrop(drop),
  async "deployment.set"({ drop }) {
    const checked = await checkDrop(drop)
    if (!checked.ok) throw new Error(CHECK_ERRORS[checked.error])
    if (checked.drop !== (await currentDrop())) await unlink()
    await local.set("drop", checked.drop)
    await local.set("hello", {
      drop: checked.drop,
      name: checked.name,
      ...(checked.content ? { content: checked.content } : {}),
    })
    return state()
  },
  async "link.start"() {
    await link(await currentDrop())
    return state()
  },
  async "link.remove"() {
    await unlink()
    return state()
  },
  async "hand.set"({ hand }) {
    if (hand === "everywhere" && !(await browser.permissions.contains({ origins: [ALL_SITES] })))
      throw new Error("Allow Drop on every site first.")
    if (hand === "press") await browser.permissions.remove({ origins: [ALL_SITES] })
    await local.set("hand", hand)
    return state()
  },
  async "site.keep"({ origin: input, keep }) {
    const origin = siteOrigin(input)
    if (!origin) throw new Error("That isn't a site Drop can run on.")
    const pattern = originPattern(origin)
    const { kept } = await settings()
    if (keep) {
      if (!(await browser.permissions.contains({ origins: [pattern] })))
        throw new Error("Allow Drop on this site first.")
      if (!kept.includes(origin)) await local.set("kept", [...kept, origin])
      return state()
    }
    const rest = kept.filter((item) => item !== origin)
    await local.set("kept", rest)
    const needed =
      rest.some((item) => originPattern(item) === pattern) || originPattern(await currentDrop()) === pattern
    if (!needed) await browser.permissions.remove({ origins: [pattern] })
    return state()
  },
  async "tab.inject"({ tabId }) {
    return inject(tabId, await policy())
  },
}

const contentHandlers: ContentHandlers = {
  async "pill.closed"(_payload, { tabId }) {
    await markClosed(tabId)
    return null
  },
  async "review.session"({ target, create }, { origin }) {
    const { expires } = await reviewSession(origin, { ...(target ? { target } : {}), ...(create ? { create } : {}) })
    return { expires }
  },
  "review.fetch": (request, { origin }) => reviewFetch(origin, request),
  async "review.presence"({ target }, { origin }) {
    const reply = await reviewFetch(origin, {
      path: "/api/review/presence",
      method: "POST",
      ...(target ? { target } : {}),
    })
    if (reply.status !== 200 || reply.text === undefined) throw new Error(`Presence answered ${reply.status}.`)
    const ticket: unknown = JSON.parse(reply.text)
    return ticket
  },
  "notes.index": () => notesIndex(),
  "notes.targets": (_payload, { origin }) => notesTargets(origin),
}

async function press(tabId: number) {
  if (String(tabId) in (await openTabs())) {
    const shown = await browser.tabs.sendMessage(tabId, { type: "pill.toggle" }, { frameId: 0 }).catch(() => undefined)
    if (shown !== undefined) return
  }
  await inject(tabId, await policy())
}

export function startBackground() {
  listen({ page: pageHandlers, content: contentHandlers })

  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    await browser.contextMenus.removeAll()
    browser.contextMenus.create({
      id: MENU_ID,
      title: "Comment with Drop",
      contexts: ["page", "selection", "image", "link"],
      documentUrlPatterns: ["https://*/*", "http://*/*"],
    })
    if (reason === "install" && !(await local.get("welcomed"))) {
      await local.set("welcomed", true)
      await browser.tabs.create({ url: browser.runtime.getURL("/welcome.html") })
    }
  })

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID && tab?.id !== undefined) void press(tab.id)
  })

  browser.commands.onCommand.addListener((command, tab) => {
    if (command === "toggle-pill" && tab?.id !== undefined) void press(tab.id)
  })

  browser.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status !== "complete") return
    void (async () => onTabLoaded(tabId, tab, await policy(), await settings()))()
  })

  browser.tabs.onRemoved.addListener((tabId) => void markClosed(tabId))
}
