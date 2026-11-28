import { browser } from "wxt/browser"
import { checkDrop, currentDrop, DEFAULT_DROP, originPattern, type DropCheck } from "./deployment"
import { blocked, inject, markClosed, onTabLoaded, openTabs, probe, type Policy } from "./injection"
import type { Hand, LinkProblem, LinkResult, SiteState, State } from "./messages"
import { host, start } from "./host"
import { indexed, siteIndex } from "./notes"
import { syncMarker } from "./marker"
import { link, linked, unlink } from "./oauth"
import { listen, type ContentHandlers, type PageHandlers } from "./router"
import { local, trustedOnly } from "./storage"

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
  outdated: "This Drop needs an update before the extension works.",
  redirects: "That address sends visitors to another one. Use the address your Drop shows.",
  elsewhere: "That Drop lives at another address. Use the address your Drop shows.",
  "server-error": "That Drop has a problem right now. Try again later.",
}

async function remember(checked: Extract<DropCheck, { ok: true }>) {
  await local.set("hello", {
    drop: checked.drop,
    name: checked.name,
    ...(checked.content ? { content: checked.content } : {}),
  })
}

async function connect(): Promise<LinkResult> {
  const drop = await currentDrop()
  let ended: LinkProblem | undefined
  const launch = (url: string) =>
    browser.identity.launchWebAuthFlow({ url, interactive: true }).then(
      (returned) => {
        if (!returned) ended = "closed"
        else if (new URL(returned).searchParams.get("error") === "access_denied") ended = "denied"
        return returned
      },
      (error: unknown) => {
        if (error instanceof Error && /did not approve|cancel/i.test(error.message)) ended = "closed"
        throw error
      },
    )
  try {
    await link(drop, { launch, redirectUri: browser.identity.getRedirectURL() })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, problem: ended ?? "failed", detail, state: await state() }
  }
  if ((await local.get("hello"))?.drop !== drop) {
    const checked = await checkDrop(drop)
    if (checked.ok) await remember(checked)
  }
  void refreshIndex()
  await syncMarker()
  return { ok: true, state: await state() }
}

const pageHandlers: PageHandlers = {
  "state.get": ({ tabId }) => state(tabId),
  "deployment.check": ({ drop }) => checkDrop(drop),
  async "deployment.set"({ drop }) {
    const checked = await checkDrop(drop)
    if (!checked.ok) throw new Error(CHECK_ERRORS[checked.error])
    if (checked.drop !== (await currentDrop())) await unlink()
    await local.set("drop", checked.drop)
    await remember(checked)
    await syncMarker()
    return state()
  },
  async "deployment.reset"() {
    if ((await currentDrop()) !== DEFAULT_DROP) await unlink()
    await local.remove("drop")
    await syncMarker()
    return state()
  },
  "link.start": connect,
  async "link.remove"() {
    await unlink()
    await syncMarker()
    return state()
  },
  async "hand.set"({ hand }) {
    if (hand === "everywhere" && !(await browser.permissions.contains({ origins: [ALL_SITES] })))
      throw new Error("Allow Drop on every site first.")
    if (hand === "press") await browser.permissions.remove({ origins: [ALL_SITES] })
    await local.set("hand", hand)
    if (hand === "everywhere") void refreshIndex()
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
    void refreshIndex()
    return inject(tabId, await policy())
  },
}

const contentHandlers: ContentHandlers = {
  async "pill.closed"(_payload, { tabId }) {
    await markClosed(tabId)
    return null
  },
  "notes.targets": async (_payload, { origin }) => start(origin, await policy()),
  "review.host": ({ request }, from) => host(request, from),
}

async function indexedSite(origin: string) {
  const current = await linked()
  if (current?.drop !== (await currentDrop())) return false
  return indexed(await siteIndex().catch(() => undefined), origin)
}

function refreshIndex() {
  return siteIndex({ fresh: true }).catch(() => undefined)
}

async function press(tabId: number) {
  void refreshIndex()
  if (String(tabId) in (await openTabs())) {
    const shown = await browser.tabs.sendMessage(tabId, { type: "pill.toggle" }, { frameId: 0 }).catch(() => undefined)
    if (shown !== undefined) return
  }
  await inject(tabId, await policy())
}

export function startBackground() {
  void trustedOnly()
  listen({ page: pageHandlers, content: contentHandlers })

  browser.runtime.onStartup.addListener(() => void syncMarker())

  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    void syncMarker()
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
    void (async () => onTabLoaded(tabId, tab, await policy(), await settings(), indexedSite))()
  })

  browser.tabs.onRemoved.addListener((tabId) => void markClosed(tabId))
}
