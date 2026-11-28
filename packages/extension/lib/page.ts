import { ref } from "vue"
import { browser } from "wxt/browser"
import { normalizeDrop, originPattern } from "./deployment"
import { send, type RequestType, type Requests, type State } from "./messages"

const ALL_SITES = "<all_urls>"

export function allowOrigin(origin: string) {
  return browser.permissions.request({ origins: [originPattern(origin)] })
}

export function allowDrop(input: string) {
  const drop = normalizeDrop(input)
  return drop ? allowOrigin(drop) : Promise.resolve(false)
}

export function allowEverywhere() {
  return browser.permissions.request({ origins: [ALL_SITES] })
}

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

export const shortcut = "Alt+Shift+D"
