import { afterEach, describe, expect, test, vi } from "vite-plus/test"
import { fakeBrowser } from "wxt/testing/fake-browser"
import Welcome from "../../entrypoints/welcome/App.vue"
import { choose, DROP, press, render, settle, startBrowser, type } from "./browser"

afterEach(() => {
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

const status = (wrapper: Awaited<ReturnType<typeof render>>) => wrapper.find("[data-testid=drop-status]").text()
const heading = (wrapper: Awaited<ReturnType<typeof render>>) => wrapper.find("h1").text()

async function atStep2() {
  const browser = await startBrowser()
  const wrapper = await render(Welcome)
  await press(wrapper, "Get started")
  return { browser, wrapper }
}

async function checkOwn(address: string) {
  const { browser, wrapper } = await atStep2()
  await choose(wrapper, "My own Drop")
  await type(wrapper, "#drop-address", address)
  await wrapper.find("form").trigger("submit")
  await settle()
  return { browser, wrapper }
}

async function atConnect() {
  const found = await checkOwn("drop.example.com")
  await press(found.wrapper, "Continue")
  return found
}

const continueButton = (wrapper: Awaited<ReturnType<typeof render>>) =>
  wrapper.findAll("button").find((button) => button.text() === "Continue")!

describe("welcome", () => {
  test("step 1 says what Drop does and moves focus to each step's heading", async () => {
    await startBrowser()
    const wrapper = await render(Welcome)
    expect(heading(wrapper)).toBe("Comment on any website")
    expect(wrapper.find("[data-testid=step]").text()).toBe("Step 1 of 5")
    await press(wrapper, "Get started")
    expect(heading(wrapper)).toBe("Where is your Drop?")
    expect(document.activeElement).toBe(wrapper.find("h1").element)
  })

  test("step 2 picks drop.vitehub.dev without asking the browser anything", async () => {
    const { browser, wrapper } = await atStep2()
    expect(wrapper.find("[role=radio][aria-checked=true]").exists()).toBe(true)
    expect(continueButton(wrapper).attributes("disabled")).toBeUndefined()
    await press(wrapper, "Continue")
    expect(browser.asked).toEqual([])
    expect(heading(wrapper)).toBe("Connect to your Drop")
    expect(wrapper.text()).toContain("drop.vitehub.dev")
  })

  test("step 2 finds an own Drop after the browser allows it", async () => {
    const { browser, wrapper } = await checkOwn("drop.example.com")
    expect(browser.asked).toEqual(["https://drop.example.com/*"])
    expect(status(wrapper)).toBe("Found Example Drop at drop.example.com.")
    await press(wrapper, "Continue")
    expect(await fakeBrowser.storage.local.get("drop")).toEqual({ drop: DROP })
    expect(heading(wrapper)).toBe("Connect to your Drop")
    expect(wrapper.text()).toContain("One window comes next.")
    expect(wrapper.text()).not.toContain("Your browser asks first")
  })

  test("step 2 explains the browser's prompt before it shows", async () => {
    const { wrapper } = await atStep2()
    await choose(wrapper, "My own Drop")
    expect(status(wrapper)).toContain("your browser asks to let Drop talk to this address. Choose Allow.")
    expect(continueButton(wrapper).attributes("disabled")).toBeDefined()
  })

  test.each([
    ["a typo", "not an address", "That isn't a web address. It looks like drop.example.com."],
    ["plain http", "http://drop.example.com", "Use an address that starts with https://."],
    ["an address nothing answers at", "drop.exmaple.com", "Nothing answers at drop.exmaple.com. Check the spelling"],
    ["a site that isn't a Drop", "www.example.com", "www.example.com is a website, but not a Drop."],
    ["a Drop that needs an update", "old.example.com", "This Drop needs an update before the extension works."],
    ["an address that redirects", "go.example.com", "go.example.com sends visitors on to another address."],
  ])("step 2 explains %s", async (_name, address, message) => {
    const { browser, wrapper } = await checkOwn(address)
    expect(status(wrapper)).toContain(message)
    expect(wrapper.find("[role=alert]").exists()).toBe(true)
    expect(continueButton(wrapper).attributes("disabled")).toBeDefined()
    expect(browser.granted.size).toBe(0)
  })

  test("step 2 offers the address a Drop says it lives at, and asks for it again", async () => {
    const { browser, wrapper } = await checkOwn("acme.example.com")
    expect(status(wrapper)).toContain("This Drop lives at drop.example.com. Use it?")
    await press(wrapper, "Use drop.example.com")
    expect(browser.asked).toEqual(["https://acme.example.com/*", "https://drop.example.com/*"])
    expect(status(wrapper)).toBe("Found Example Drop at drop.example.com.")
    expect(wrapper.find<HTMLInputElement>("#drop-address").element.value).toBe("drop.example.com")
  })

  test("step 2 says so when the browser doesn't allow the check", async () => {
    const browser = await startBrowser()
    browser.answers.permission = false
    const wrapper = await render(Welcome)
    await press(wrapper, "Get started")
    await choose(wrapper, "My own Drop")
    await type(wrapper, "#drop-address", "drop.example.com")
    await wrapper.find("form").trigger("submit")
    await settle()
    expect(status(wrapper)).toContain("Your browser didn't let Drop check drop.example.com.")
  })

  test("step 3 connects and shows the account", async () => {
    const { wrapper } = await atConnect()
    await press(wrapper, "Connect")
    expect(heading(wrapper)).toBe("You're connected")
    expect(wrapper.find("[data-testid=account]").text()).toBe("Connected as Example Reviewer")
    expect(wrapper.text()).toContain("reviewer@example.com · drop.example.com")
  })

  test("step 3 on drop.vitehub.dev explains both windows and asks the browser first", async () => {
    const { browser, wrapper } = await atStep2()
    await press(wrapper, "Continue")
    expect(wrapper.text()).toContain("Two windows come next.")
    expect(wrapper.text()).toContain("It asks to let Drop talk to drop.vitehub.dev. Choose Allow.")
    browser.answers.permission = false
    await press(wrapper, "Connect")
    expect(browser.asked).toEqual(["https://drop.vitehub.dev/*"])
    expect(wrapper.find("[data-testid=connect-problem]").text()).toBe(
      "Your browser didn't let Drop talk to drop.vitehub.dev, so it can't connect. Press Connect and choose Allow.",
    )
  })

  test.each([
    ["close", "The Drop window closed before you chose Allow. Press Connect to try again."],
    ["cancel", "The Drop window closed before you chose Allow. Press Connect to try again."],
    ["deny", "You chose not to connect this browser in Drop. Press Connect if you change your mind."],
  ] as const)("step 3 explains a sign-in that ends with %s", async (consent, message) => {
    const { browser, wrapper } = await atConnect()
    browser.answers.consent = consent
    await press(wrapper, "Connect")
    expect(heading(wrapper)).toBe("Connect to your Drop")
    expect(wrapper.find("[data-testid=connect-problem]").text()).toBe(message)
  })

  test("step 3 can be skipped, and step 5 offers to connect", async () => {
    const { wrapper } = await atConnect()
    await press(wrapper, "Skip for now")
    expect(heading(wrapper)).toBe("Where should the hand show?")
    await press(wrapper, "Continue")
    expect(heading(wrapper)).toBe("Try it")
    expect(wrapper.text()).toContain("Not connected yet.")
    await press(wrapper, "Connect")
    expect(wrapper.text()).not.toContain("Not connected yet.")
  })

  test("step 4 keeps the hand on the button unless the browser allows every page", async () => {
    const { browser, wrapper } = await atConnect()
    await press(wrapper, "Skip for now")
    expect(wrapper.find("[data-testid=hand-warning]").exists()).toBe(false)
    await choose(wrapper, "On every page")
    expect(wrapper.find("[data-testid=hand-warning]").text()).toContain("read and change all your data")
    browser.answers.permission = false
    await press(wrapper, "Continue")
    expect(heading(wrapper)).toBe("Where should the hand show?")
    expect(wrapper.find("[data-testid=hand-denied]").exists()).toBe(true)
    expect(wrapper.find("[role=radio][aria-checked=true]").element.closest("label")?.textContent).toContain(
      "Only when I press",
    )
    expect(await fakeBrowser.storage.local.get("hand")).toEqual({})

    browser.answers.permission = true
    await choose(wrapper, "On every page")
    await press(wrapper, "Continue")
    expect(browser.asked.at(-1)).toBe("<all_urls>")
    expect(await fakeBrowser.storage.local.get("hand")).toEqual({ hand: "everywhere" })
    expect(heading(wrapper)).toBe("Try it")
    expect(wrapper.text()).toContain("The hand now waits in the bottom corner of every page.")
  })

  test("step 5 shows the shortcut and opens example.com", async () => {
    const { wrapper } = await atConnect()
    await press(wrapper, "Connect")
    await press(wrapper, "Continue")
    await press(wrapper, "Continue")
    expect(wrapper.find("[data-testid=shortcut]").text()).toMatch(/Or press\s+Alt\s*Shift\s*D\s+on any page\./)
    const opened = vi.spyOn(fakeBrowser.tabs, "create")
    await press(wrapper, "Try it on example.com")
    expect(opened).toHaveBeenCalledWith({ url: "https://example.com/" })
    expect(wrapper.find("[role=status]").text()).toBe("Opened example.com in a new tab")
  })

  test("Back keeps the Drop that step 2 found", async () => {
    const { wrapper } = await atConnect()
    await press(wrapper, "Back")
    expect(status(wrapper)).toBe("Found Example Drop at drop.example.com.")
    expect(continueButton(wrapper).attributes("disabled")).toBeUndefined()
  })
})
