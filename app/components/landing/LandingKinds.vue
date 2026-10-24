<script setup lang="ts">
// What an agent can drop, as a bento: each card opens its section of the docs and shows a small drop of its kind,
// drawn in HTML so it stays sharp and follows the color mode.
const KINDS = [
  {
    key: "doc",
    name: "Plans and docs",
    detail: "Markdown with tables, Mermaid, and math. Edit it together, live.",
    to: "/docs/features#edit",
    wide: true,
  },
  {
    key: "html",
    name: "HTML pages",
    detail: "Explainers and reports with their own scripts.",
    to: "/docs/features#apps",
  },
  { key: "app", name: "Small apps", detail: "A folder of static files. The link runs it.", to: "/docs/features#apps" },
  {
    key: "pr",
    name: "Pull request evidence",
    detail: "Before and after screenshots, linked from the PR.",
    to: "/docs/agents#skill",
  },
  { key: "site", name: "Live sites", detail: "Comment on a preview deploy itself.", to: "/docs/sites" },
  {
    key: "board",
    name: "Boards",
    detail: "Excalidraw boards for flows and sketches, commented like everything else.",
    to: "/docs/features",
    wide: true,
  },
] as const

const BARS = [38, 52, 44, 70, 62, 88]
const COLUMNS = [3, 2, 1]
</script>

<template>
  <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <li v-for="kind in KINDS" :key="kind.key" :class="'wide' in kind && 'lg:col-span-2'">
      <NuxtLink
        :to="kind.to"
        class="group flex h-full flex-col rounded-xl border border-default bg-default p-2 shadow-xs outline-none transition-colors hover:border-accented focus-visible:ring-2 focus-visible:ring-(--ui-border-inverted)"
      >
        <!-- The preview: a small drop of this kind, lifting a little on hover. -->
        <div
          aria-hidden="true"
          class="relative h-40 overflow-hidden rounded-lg bg-muted bg-[radial-gradient(var(--ui-border)_1px,transparent_1px)] [background-size:14px_14px]"
        >
          <div
            class="absolute inset-x-5 top-5 bottom-0 rounded-t-lg border border-b-0 border-default bg-default p-4 shadow-sm transition-transform duration-300 ease-(--ease-out) group-hover:-translate-y-1"
          >
            <!-- A doc with one commented sentence. -->
            <template v-if="kind.key === 'doc'">
              <div class="flex gap-6">
                <div class="min-w-0 flex-1">
                  <p class="text-[11px] font-semibold text-highlighted">Launch plan</p>
                  <div class="mt-2 space-y-1.5">
                    <div class="h-1.5 w-11/12 rounded-full bg-accented" />
                    <div class="flex items-center gap-1.5">
                      <span
                        class="relative rounded-sm bg-amber-200/80 px-1 text-[10px] leading-4 text-highlighted dark:bg-amber-400/25"
                        >Public launch on Nov 4<span
                          class="absolute -top-2 -right-3 grid size-3.5 place-items-center rounded-full bg-inverted text-[8px] font-semibold text-inverted"
                          >1</span
                        ></span
                      >
                    </div>
                    <div class="h-1.5 w-3/4 rounded-full bg-accented" />
                    <div class="h-1.5 w-5/6 rounded-full bg-accented" />
                  </div>
                </div>
                <div class="hidden w-40 shrink-0 rounded-md border border-default bg-default p-2 shadow-md sm:block">
                  <p class="flex items-center gap-1 text-[10px] font-medium text-highlighted">
                    <span
                      class="grid size-3.5 place-items-center rounded-full bg-sky-100 text-[7px] text-sky-800 dark:bg-sky-400/15 dark:text-sky-200"
                      >AL</span
                    >
                    Ana
                  </p>
                  <p class="mt-1 text-[10px] leading-snug text-muted">Inside the billing freeze. Can we move it?</p>
                </div>
              </div>
            </template>

            <!-- A report with a chart. -->
            <template v-else-if="kind.key === 'html'">
              <p class="text-[11px] font-semibold text-highlighted">Pricing</p>
              <div class="mt-3 flex h-16 items-end gap-1.5">
                <div
                  v-for="(bar, i) in BARS"
                  :key="i"
                  class="flex-1 rounded-t-sm"
                  :class="i === BARS.length - 1 ? 'bg-amber-400 dark:bg-amber-300' : 'bg-accented'"
                  :style="{ height: `${bar}%` }"
                />
              </div>
            </template>

            <!-- A small app: a board with three columns. -->
            <template v-else-if="kind.key === 'app'">
              <div class="grid grid-cols-3 gap-1.5">
                <div v-for="(count, i) in COLUMNS" :key="i" class="space-y-1.5 rounded-md bg-muted p-1.5">
                  <div class="h-1 w-1/2 rounded-full bg-accented" />
                  <div
                    v-for="n in count"
                    :key="n"
                    class="h-5 rounded-sm border border-default bg-default"
                    :class="i === 1 && n === 1 && 'border-amber-300 dark:border-amber-400/40'"
                  />
                </div>
              </div>
            </template>

            <!-- Before and after, for a pull request. -->
            <template v-else-if="kind.key === 'pr'">
              <p class="flex items-center gap-1 text-[10px] text-muted">
                <UIcon name="i-simple-icons-github" class="size-3" /> PR #412
              </p>
              <div class="mt-2 grid grid-cols-2 gap-1.5">
                <div v-for="side in ['Before', 'After']" :key="side">
                  <div
                    class="flex h-12 flex-col justify-end gap-1 rounded-md border border-default p-1.5"
                    :class="side === 'After' ? 'bg-amber-50 dark:bg-amber-400/10' : 'bg-muted'"
                  >
                    <div class="h-1 w-2/3 rounded-full bg-accented" />
                    <div
                      class="h-2.5 w-1/2 rounded-sm"
                      :class="side === 'After' ? 'bg-amber-400 dark:bg-amber-300' : 'bg-accented'"
                    />
                  </div>
                  <p class="mt-1 text-[9px] text-dimmed">{{ side }}</p>
                </div>
              </div>
            </template>

            <!-- A live site with a boxed comment. -->
            <template v-else-if="kind.key === 'site'">
              <p class="truncate rounded-sm bg-muted px-1.5 font-mono text-[9px] leading-4 text-dimmed">
                preview.acme.dev
              </p>
              <div class="relative mt-2 space-y-1.5">
                <div class="h-1.5 w-1/2 rounded-full bg-accented" />
                <div class="h-6 w-full rounded-sm bg-muted" />
                <div class="h-1.5 w-2/3 rounded-full bg-accented" />
                <div class="absolute top-2.5 -left-1 h-9 w-3/5 rounded-sm border-2 border-dashed border-amber-400" />
                <span
                  class="absolute top-1 left-[56%] grid size-3.5 place-items-center rounded-full bg-inverted text-[8px] font-semibold text-inverted"
                  >1</span
                >
              </div>
            </template>

            <!-- A board: sticky notes with arrows. -->
            <template v-else>
              <div class="flex items-start gap-2">
                <div
                  class="size-16 shrink-0 -rotate-3 rounded-sm bg-amber-200 p-1.5 text-[9px] text-amber-950 shadow-sm"
                >
                  Cart
                </div>
                <UIcon name="i-mingcute-arrow-right-line" class="mt-7 size-4 shrink-0 text-dimmed" />
                <div
                  class="mt-4 size-16 shrink-0 rotate-2 rounded-sm bg-sky-200 p-1.5 text-[9px] text-sky-950 shadow-sm"
                >
                  Checkout
                </div>
                <UIcon name="i-mingcute-arrow-right-line" class="mt-7 size-4 shrink-0 text-dimmed" />
                <div
                  class="size-16 shrink-0 -rotate-1 rounded-sm bg-emerald-200 p-1.5 text-[9px] text-emerald-950 shadow-sm"
                >
                  Paid
                </div>
                <div
                  class="relative mt-5 ml-4 hidden h-12 w-28 shrink-0 rounded-md border-2 border-default bg-default p-1.5 text-[9px] text-muted sm:block"
                >
                  Retry on decline?<span
                    class="absolute -top-1.5 -right-1.5 grid size-3.5 place-items-center rounded-full bg-inverted text-[8px] font-semibold text-inverted"
                    >1</span
                  >
                </div>
              </div>
            </template>
          </div>
        </div>

        <div class="flex flex-1 flex-col px-3 pt-4 pb-3">
          <span class="flex items-center justify-between gap-2 font-medium text-highlighted"
            >{{ kind.name
            }}<UIcon
              name="i-mingcute-arrow-right-up-line"
              class="size-4 text-muted opacity-0 transition-opacity group-hover:opacity-100"
          /></span>
          <span class="mt-1 text-sm text-pretty text-muted">{{ kind.detail }}</span>
        </div>
      </NuxtLink>
    </li>
  </ul>
</template>
