import assert from "node:assert/strict"
import { HTTPError, toResponse } from "h3"
import { beforeEach, test } from "vite-plus/test"
import { event, insertDrop, migrate, reset, state, who } from "../cost/harness.mjs"
const { default: accessMiddleware } = await import("../../server/middleware/0.drop-access.ts")
const { default: contentError } = await import("../../server/handlers/content-error.ts")
const { appPageLinks } = await import("../../shared/project-bundle.ts")

// A path under a drop's link, like the one Maxi opened as its owner: /d/<key>/docs-preview/integrations/components.
migrate()
beforeEach(() => {
  reset()
  state.who = null
})

const visit = async (path, method = "GET") => {
  const request = event(path, method)
  const answer = await accessMiddleware(request)
  return answer === undefined ? undefined : toResponse(answer, request)
}

test("a path under an app's link opens the app at that page as ?path=, with the app's query, and Drop's own outside", async () => {
  insertDrop("app1", { kind: "app", title: "Docs preview", slug: "docs-preview", share: "private" })
  state.who = who
  for (const [path, query] of [
    ["/d/app1/docs-preview/integrations/components", { path: "/integrations/components" }],
    ["/d/app1/old-slug/guide/a%20b/", { path: "/guide/a%20b/" }],
    ["/d/app1/docs-preview/search?q=a+b&tab=vue&v=2", { v: "2", path: "/search?q=a+b&tab=vue" }],
    ["/d/app1/docs-preview/about?comment=3&path=/ignored", { comment: "3", path: "/about" }],
  ]) {
    const response = await visit(path)
    assert.equal(response.status, 302, path)
    const target = new URL(response.headers.get("location"), "https://drop.example")
    assert.equal(target.pathname, "/d/app1/docs-preview", path)
    assert.deepEqual(Object.fromEntries(target.searchParams), query, path)
  }
  assert.equal((await visit("/d/app1/docs-preview/about", "HEAD")).status, 302)
  await assert.rejects(visit("/d/app1/docs-preview/about", "POST"), (error) => error.status === 404)
})

test("a path under a doc's link opens the doc", async () => {
  insertDrop("doc", { title: "The doc", share: "public" })
  const response = await visit("/d/doc/the-doc/some/page?path=/x")
  assert.equal(response.status, 302)
  assert.equal(response.headers.get("location"), "/d/doc/the-doc")
})

test("a path under a link someone can't open is the same 404 as the link itself", async () => {
  insertDrop("app1", { kind: "app", title: "Docs preview", slug: "docs-preview", share: "private" })
  state.who = { ...who, userId: "stranger", email: "stranger@example.com" }
  await assert.rejects(visit("/d/app1/docs-preview/integrations/components"), (error) => error.status === 404)
})

const errorPage = async (path, identity) => {
  state.who = identity
  const request = event(path)
  request.context.dropIdentity = Promise.resolve(identity)
  const response = await contentError(new HTTPError({ status: 404 }), request)
  return { status: response.status, html: await response.text() }
}

test("a 404 under a drop its reader may open says the address is missing, not that the account can't see it", async () => {
  insertDrop("app1", { kind: "app", title: "Docs preview", slug: "docs-preview", share: "private" })
  const owner = await errorPage("/d/app1/docs-preview/integrations/components", who)
  assert.equal(owner.status, 404)
  assert.match(owner.html, /Nothing is at this address in the drop/)
  assert.match(owner.html, /href="\/d\/app1\/docs-preview">Open the drop/)
  assert.doesNotMatch(owner.html, /available to your account|Use another account|private to its owner/)
  // Someone who can't open it learns nothing about the drop.
  const stranger = await errorPage("/d/app1/docs-preview/integrations/components", {
    ...who,
    userId: "stranger",
    email: "stranger@example.com",
  })
  assert.match(stranger.html, /available to your account/)
  assert.doesNotMatch(stranger.html, /Nothing is at this address|docs-preview">Open the drop/)
  const visitor = await errorPage("/d/app1/docs-preview/integrations/components", null)
  assert.match(visitor.html, /Sign in with GitHub/)
})

test("an app's page links open the drop at each page, and skip the pages that answer missing addresses", () => {
  const url = "https://drop.example/d/app1/docs-preview"
  assert.deepEqual(
    appPageLinks(url, [
      "404.html",
      "200.html",
      "_nuxt/a.js",
      "integrations/components.html",
      "index.html",
      "guide/index.html",
    ]),
    [
      { page: "index.html", url },
      { page: "guide/index.html", url: `${url}?path=%2Fguide%2F` },
      { page: "integrations/components.html", url: `${url}?path=%2Fintegrations%2Fcomponents` },
    ],
  )
  assert.equal(appPageLinks(`${url}?v=2`, ["index.html", "a b.html"])[1].url, `${url}?v=2&path=%2Fa+b`)
})
