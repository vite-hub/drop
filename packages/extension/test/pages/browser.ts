import ui from "@nuxt/ui/vue-plugin"
import { flushPromises, mount } from "@vue/test-utils"
import { expect, vi } from "vite-plus/test"
import type { Component } from "vue"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { createFakeDrop, DROP, REDIRECT } from "../fake-drop"

export { DROP }

const page = { id: "test-extension-id", url: "chrome-extension://test-extension-id/welcome.html" }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const others: Record<string, (path: string) => Response> = {
  "https://www.example.com": () => new Response("<!doctype html><title>Example</title>", { status: 200 }),
  "https://old.example.com": (path) =>
    path === "/.well-known/oauth-authorization-server"
      ? json({ authorization_endpoint: "https://old.example.com/api/auth/oauth2/authorize" })
      : json({ error: "not found" }, 404),
  "https://go.example.com": () => new Response(null, { status: 301, headers: { location: `${DROP}/` } }),
  "https://acme.example.com": () => json({ drop: DROP, name: "Example Drop", version: "0.1.0" }),
}

export type Consent = "approve" | "close" | "cancel" | "deny"

export async function startBrowser(options: { hand?: "everywhere" } = {}) {
  const drop = createFakeDrop()
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const other = others[url.origin]
    return other ? Promise.resolve(other(url.pathname)) : drop.fetch(input, init)
  })

  const granted = new Set<string>()
  const asked: string[] = []
  const answers = { permission: true, consent: "approve" as Consent }
  // SAFETY: the fake types these as returning void; the real APIs resolve to a boolean.
  vi.spyOn(fakeBrowser.permissions, "request").mockImplementation((async ({ origins = [] }) => {
    asked.push(...origins)
    if (answers.permission) for (const origin of origins) granted.add(origin)
    return answers.permission
  }) as never)
  vi.spyOn(fakeBrowser.permissions, "contains").mockImplementation((async ({ origins = [] }) =>
    origins.every((origin) => granted.has(origin))) as never)
  vi.spyOn(fakeBrowser.permissions, "remove").mockImplementation((async ({ origins = [] }) => {
    for (const origin of origins) granted.delete(origin)
    return true
  }) as never)

  vi.spyOn(fakeBrowser.identity, "getRedirectURL").mockReturnValue(REDIRECT)
  vi.spyOn(fakeBrowser.identity, "launchWebAuthFlow").mockImplementation(async ({ url }) => {
    if (answers.consent === "close") throw new Error("The user did not approve access.")
    if (answers.consent === "cancel") return undefined as never
    if (answers.consent === "approve") return drop.approve(url)
    const back = new URL(REDIRECT)
    back.searchParams.set("error", "access_denied")
    back.searchParams.set("state", new URL(url).searchParams.get("state") ?? "")
    return back.href
  })
  // SAFETY: the fake types getAll() as returning void; the real API resolves to the commands.
  vi.spyOn(fakeBrowser.commands, "getAll").mockResolvedValue([
    { name: "toggle-pill", shortcut: "Alt+Shift+D", description: "" },
  ] as never)
  vi.spyOn(fakeBrowser.contextMenus.onClicked, "addListener").mockImplementation(() => undefined)
  vi.spyOn(fakeBrowser.commands.onCommand, "addListener").mockImplementation(() => undefined)
  vi.spyOn(fakeBrowser.runtime, "openOptionsPage").mockResolvedValue(undefined)
  vi.spyOn(fakeBrowser.runtime, "getManifest").mockReturnValue({ manifest_version: 3, name: "Drop", version: "0.1.0" })

  if (options.hand) {
    granted.add("<all_urls>")
    await fakeBrowser.storage.local.set({ hand: options.hand })
  }

  const { startBackground } = await import("../../lib/background")
  startBackground()
  vi.spyOn(fakeBrowser.runtime, "sendMessage").mockImplementation(
    (message: unknown) =>
      new Promise((resolve) => void fakeBrowser.runtime.onMessage.trigger(message, page, resolve)) as never,
  )

  return { drop, granted, asked, answers }
}

export async function render(component: Component) {
  const wrapper = mount(component, { attachTo: document.body, global: { plugins: [ui] } })
  await settle()
  return wrapper
}

export async function settle() {
  for (let round = 0; round < 10; round++) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

export async function press(wrapper: ReturnType<typeof mount>, label: string | RegExp) {
  const button = wrapper.findAll("button").find((item) => {
    const text = item.text().trim() || (item.attributes("aria-label") ?? "")
    return typeof label === "string" ? text === label : label.test(text)
  })
  expect(button, `a button labelled ${label}`).toBeDefined()
  await button!.trigger("click")
  await settle()
}

export async function choose(wrapper: ReturnType<typeof mount>, label: string) {
  const option = wrapper.findAll("label").find((item) => item.text().includes(label))
  expect(option, `an option labelled ${label}`).toBeDefined()
  await option!.find("[role=radio]").trigger("click")
  await settle()
}

export async function type(wrapper: ReturnType<typeof mount>, selector: string, value: string) {
  await wrapper.find(selector).setValue(value)
  await settle()
}
