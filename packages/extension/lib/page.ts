import { ref, type Ref } from "vue"
import { browser } from "wxt/browser"
import { DEFAULT_DROP, normalizeDrop, originPattern } from "./deployment"
import { send, type Hand, type LinkProblem, type RequestType, type Requests, type State } from "./messages"

const ALL_SITES = "<all_urls>"

export { DEFAULT_DROP }

export function allowOrigin(origin: string) {
  return browser.permissions.request({ origins: [originPattern(origin)] })
}

function allowDrop(input: string) {
  const drop = normalizeDrop(input)
  return drop ? allowOrigin(drop) : Promise.resolve(false)
}

function allowEverywhere() {
  return browser.permissions.request({ origins: [ALL_SITES] })
}

export function hasOrigin(origin: string) {
  return browser.permissions.contains({ origins: [originPattern(origin)] })
}

export async function releaseOrigin(origin: string, state: State | undefined) {
  const pattern = originPattern(origin)
  const used = [state?.drop ?? DEFAULT_DROP, ...(state?.kept ?? [])].some((item) => originPattern(item) === pattern)
  if (!used) await browser.permissions.remove({ origins: [pattern] }).catch(() => false)
}

export const hostOf = (origin: string) => (URL.canParse(origin) ? new URL(origin).host : origin)

export function useBackground() {
  const state = ref<State>()
  const error = ref<string>()
  const busy = ref<RequestType>()

  async function act<K extends RequestType>(type: K, payload: Requests[K][0]) {
    busy.value = type
    error.value = undefined
    try {
      const value = await send(type, payload)
      // SAFETY: callers pass only messages that answer with State; the others go through send() directly.
      state.value = value as State
      return true
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
      return false
    } finally {
      busy.value = undefined
    }
  }

  return { state, error, busy, act }
}

export type ConnectProblem = "permission" | LinkProblem

export function useConnect(state: Ref<State | undefined>) {
  const problem = ref<ConnectProblem>()
  const detail = ref("")
  const connecting = ref(false)

  function connect(): Promise<boolean> {
    problem.value = undefined
    const drop = state.value?.drop
    if (!drop) return Promise.resolve(false)
    connecting.value = true
    return allowDrop(drop)
      .then(async (granted) => {
        if (!granted) {
          problem.value = "permission"
          return false
        }
        const result = await send("link.start", {})
        state.value = result.state
        if (result.ok) return true
        problem.value = result.problem
        detail.value = result.detail
        return false
      })
      .catch((caught: unknown) => {
        problem.value = "failed"
        detail.value = caught instanceof Error ? caught.message : String(caught)
        return false
      })
      .finally(() => {
        connecting.value = false
      })
  }

  return { problem, detail, connecting, connect }
}

export type HandOutcome = "saved" | "denied" | "failed"

export function setHand(
  next: Hand,
  current: Hand | undefined,
  act: (type: "hand.set", payload: { hand: Hand }) => Promise<boolean>,
): Promise<HandOutcome> {
  const save = async () => ((await act("hand.set", { hand: next })) ? "saved" : "failed")
  if (next === current) return Promise.resolve("saved")
  if (next === "press") return save()
  return allowEverywhere().then((granted) => (granted ? save() : "denied"))
}

export async function shortcutKeys() {
  const commands = await browser.commands.getAll().catch(() => [])
  const shortcut = commands.find((command) => command.name === "toggle-pill")?.shortcut
  if (!shortcut) return []
  return shortcut.includes("+") ? shortcut.split("+") : shortcut.split("")
}

export const isFirefox = browser.runtime.getURL("/").startsWith("moz-extension:")

export const isBeta = (version: string) => version.split(".").length > 3
