# @vite-hub/drop

Connect a Nuxt site to [Drop](https://drop.vitehub.dev). The module loads Drop's review.js, so people can comment on the site, and marks preview builds with the repository and commit they come from, for Drop's pull request reviews.

```bash
pnpm add -D @vite-hub/drop
```

```ts [nuxt.config.ts]
export default defineNuxtConfig({
  modules: ["@vite-hub/drop/nuxt"],
})
```

Nothing changes until a deployment sets these:

| Name | When | Does |
| --- | --- | --- |
| `NUXT_PUBLIC_DROP_URL` | Runtime | Drop's address, such as `https://drop.example.com`. The page loads review.js from it. Empty: no review.js. A prerendered page keeps the value it had when it was prerendered, so set it at build time for those. |
| `NUXT_PUBLIC_DROP_EDGE`, `NUXT_PUBLIC_DROP_AT`, `NUXT_PUBLIC_DROP_COLLAPSED` | Runtime | Where the toolbar starts, as review.js's `data-edge`, `data-at` and `data-collapsed`. |
| `DROP_PREVIEW=1` | Build | The page names its build in `<meta name="vitehub:build" content='{"repository":"acme/app","commit":"…"}'>`. Set it only in preview builds. |
| `VITEHUB_BUILD_REPOSITORY`, `VITEHUB_BUILD_COMMIT` | Build | The repository (`owner/name`) and full commit SHA, for builds with no CI variables or `.git`, such as a Docker build. Otherwise the module reads them from the CI or host, then Git. |

The same options go under `drop` in `nuxt.config`: `url`, `edge`, `at`, `collapsed` and `preview`.

On a pull request in GitHub Actions, pass the head commit, `${{ github.event.pull_request.head.sha }}`; `GITHUB_SHA` is the test merge commit there. The meta tag is only a claim. Drop's pull request reviews, still to come, will check it against a GitHub deployment of that commit at the page's address before they link the preview to a pull request.

## Page list for a canvas

A preview build also serves `/__canvas.json`, the app's pages, so an agent can lay out a Drop canvas with one item per page:

```json
{ "pages": [{ "path": "/", "name": "index" }, { "path": "/orders/:id", "name": "orders-id", "params": { "id": "42" } }] }
```

A route with params, such as `/orders/:id`, opens only with sample values, which the page gives in `definePageMeta`. `canvas: false` leaves a page out. Redirects and catch-all routes without sample values are left out too. An app without pages serves no file.

```vue [app/pages/orders/[id].vue]
<script setup lang="ts">
definePageMeta({ canvas: { params: { id: "42" } } })
</script>
```

The module reads `canvas` at build time, so its value has to be a plain object or `false`, not a variable. Set `canvas: false` on a page whose `redirect` is a function: Nuxt only runs it at runtime, so the list can't tell the page redirects.

With `app.baseURL`, the file and its page paths both sit under that base: `/docs/__canvas.json`, and `/about` opens at `/docs/about`.

Works with Nuxt 4 and later.
