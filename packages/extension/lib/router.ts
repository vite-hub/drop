import { browser, type Browser } from "wxt/browser"
import type { ContentRequests, Message, PageRequests } from "./messages"
import { leaks } from "./secrets"

interface ContentSender {
  origin: string
  tabId: number
}

type Payload<T, K extends keyof T> = T[K] extends [infer P, unknown] ? P : never
type Result<T, K extends keyof T> = T[K] extends [unknown, infer R] ? R : never

export type PageHandlers = {
  [K in keyof PageRequests]: (payload: Payload<PageRequests, K>) => Promise<Result<PageRequests, K>>
}
export type ContentHandlers = {
  [K in keyof ContentRequests]: (
    payload: Payload<ContentRequests, K>,
    sender: ContentSender,
  ) => Promise<Result<ContentRequests, K>>
}

type Sender = Browser.runtime.MessageSender

function contentSender(sender: Sender): ContentSender | undefined {
  if (sender.tab?.id === undefined || sender.frameId !== 0 || !sender.url) return undefined
  const url = new URL(sender.url)
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined
  return { origin: url.origin, tabId: sender.tab.id }
}

type AnyReply = { ok: true; value: unknown } | { ok: false; error: string }

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export async function route(
  message: Message,
  sender: Sender,
  handlers: { page: PageHandlers; content: ContentHandlers },
): Promise<AnyReply | undefined> {
  if (sender.id !== browser.runtime.id || typeof message?.type !== "string") return undefined
  const { type, ...payload } = message
  let run: (() => Promise<unknown>) | undefined
  if (sender.url?.startsWith(browser.runtime.getURL("/"))) {
    if (Object.hasOwn(handlers.page, type)) {
      // SAFETY: `type` is a page message, and its handler takes that message's payload.
      const handler = handlers.page[type as keyof PageHandlers] as (payload: unknown) => Promise<unknown>
      run = () => handler(payload)
    }
  } else {
    const from = contentSender(sender)
    if (from && Object.hasOwn(handlers.content, type)) {
      // SAFETY: `type` is a content message, and its handler takes that message's payload.
      const handler = handlers.content[type as keyof ContentHandlers] as (
        payload: unknown,
        sender: ContentSender,
      ) => Promise<unknown>
      run = () => handler(payload, from)
    }
  }
  if (!run) return { ok: false, error: `${type} isn't answered here.` }
  let reply: AnyReply
  try {
    reply = { ok: true, value: await run() }
  } catch (error) {
    reply = { ok: false, error: errorText(error) }
  }
  if (leaks(JSON.stringify(reply))) return { ok: false, error: "Refused: the answer held a token." }
  return reply
}

export function listen(handlers: { page: PageHandlers; content: ContentHandlers }) {
  const listener = (message: unknown, sender: Sender, sendResponse: (reply: unknown) => void) => {
    // SAFETY: route() checks the sender and the type before it uses the message.
    void route(message as Message, sender, handlers).then(sendResponse)
    return true
  }
  browser.runtime.onMessage.addListener(listener)
  return () => browser.runtime.onMessage.removeListener(listener)
}
