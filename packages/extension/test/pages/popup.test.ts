import { afterEach, describe, expect, test, vi } from "vite-plus/test"
import { fakeBrowser } from "wxt/testing/fake-browser"
import Options from "../../entrypoints/options/App.vue"
import Popup from "../../entrypoints/popup/App.vue"
import { linkTo } from "../fake-drop"
import { choose, DROP, press, render, settle, startBrowser } from "./browser"

afterEach(() => {
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

async function onSite(url: string) {
  const tab = await fakeBrowser.tabs.create({ url, active: true })
  // SAFETY: the fake types query() as returning void; the real API resolves to the matching tabs.
  vi.spyOn(fakeBrowser.tabs, "query").mockResolvedValue([tab] as never)
  // SAFETY: the popup injects through scripting, which the fake browser doesn't implement; the result isn't checked.
  vi.spyOn(fakeBrowser.scripting, "executeScript").mockResolvedValue([] as never)
  return tab
}

const switchFor = (wrapper: Awaited<ReturnType<typeof render>>, label: string) =>
  wrapper
    .findAll("[role=switch]")
    .find((item) => item.element.closest("div")?.parentElement?.textContent?.includes(label))!

describe("popup", () => {
  test("offers to connect, and keeps Drop on this site once the browser allows it", async () => {
    const browser = await startBrowser()
    await onSite("https://www.example.com:8443/pricing")
    const wrapper = await render(Popup)
    expect(wrapper.find("[data-testid=site]").text()).toBe("www.example.com:8443")
    expect(wrapper.text()).toContain("Connect to Drop")
    expect(wrapper.text()).toContain("Not connected")

    await switchFor(wrapper, "On this site").trigger("click")
    await settle()
    expect(browser.asked).toEqual(["https://www.example.com/*"])
    expect(await fakeBrowser.storage.local.get("kept")).toEqual({ kept: ["https://www.example.com:8443"] })
  })

  test("says so when the browser won't allow every page", async () => {
    const browser = await startBrowser()
    await onSite("https://www.example.com/")
    browser.answers.permission = false
    const wrapper = await render(Popup)
    await switchFor(wrapper, "On every page").trigger("click")
    await settle()
    expect(browser.asked).toEqual(["<all_urls>"])
    expect(wrapper.text()).toContain("Your browser said no.")
    expect(await fakeBrowser.storage.local.get("hand")).toEqual({})
  })

  test("shows the account and turns the site switch on while the hand is on every page", async () => {
    const browser = await startBrowser({ hand: "everywhere" })
    await fakeBrowser.storage.local.set({ drop: DROP })
    await linkTo(browser.drop)
    await onSite("https://www.example.com/")
    const wrapper = await render(Popup)
    expect(wrapper.find("[data-testid=account]").text()).toBe("Example Reviewer")
    expect(wrapper.text()).not.toContain("Connect to Drop")
    const site = switchFor(wrapper, "On this site")
    expect(site.attributes("aria-checked")).toBe("true")
    expect(site.attributes("disabled")).toBeDefined()
    await press(wrapper, "Settings")
    expect(fakeBrowser.runtime.openOptionsPage).toHaveBeenCalled()
  })
})

describe("options", () => {
  test("changes the Drop only after Use this Drop, and says that disconnects", async () => {
    const browser = await startBrowser()
    await fakeBrowser.storage.local.set({ drop: DROP })
    await linkTo(browser.drop)
    const wrapper = await render(Options)
    expect(wrapper.find("[data-testid=account]").text()).toBe("Connected as Example Reviewer")
    expect(wrapper.find<HTMLInputElement>("#drop-address").element.value).toBe("drop.example.com")

    await choose(wrapper, "drop.vitehub.dev")
    expect(wrapper.text()).toContain("Changing your Drop disconnects this browser.")
    await press(wrapper, "Use this Drop")
    expect(await fakeBrowser.storage.local.get("drop")).toEqual({})
    expect(wrapper.text()).toContain("Not connected")
    expect(wrapper.text()).not.toContain("Changing your Drop")
  })

  test("disconnects, saves the hand, and removes kept sites", async () => {
    const browser = await startBrowser()
    await fakeBrowser.storage.local.set({ drop: DROP, kept: ["https://www.example.com", "https://acme.example.com"] })
    browser.granted.add("https://www.example.com/*")
    await linkTo(browser.drop)
    const wrapper = await render(Options)

    await press(wrapper, "Disconnect")
    expect(await fakeBrowser.storage.local.get("link")).toEqual({})

    expect(wrapper.findAll("button").some((button) => button.text() === "Save")).toBe(false)
    await choose(wrapper, "On every page")
    await press(wrapper, "Save")
    expect(await fakeBrowser.storage.local.get("hand")).toEqual({ hand: "everywhere" })

    expect(wrapper.find("[data-testid=kept-sites]").text()).toContain("acme.example.com")
    await press(wrapper, "Remove www.example.com")
    expect(await fakeBrowser.storage.local.get("kept")).toEqual({ kept: ["https://acme.example.com"] })
    expect(browser.granted.has("https://www.example.com/*")).toBe(false)
  })

  test("shows the beta note only on a beta version", async () => {
    await startBrowser()
    vi.spyOn(fakeBrowser.runtime, "getManifest").mockReturnValue({ version: "0.1.0.7" } as never)
    const wrapper = await render(Options)
    expect(wrapper.find("[data-testid=beta]").text()).toContain("You're on the beta.")
  })
})
