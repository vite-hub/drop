<script setup lang="ts">
// The drop viewer (T3 Code's layout): a main column with its own header, and one panel with tabs (Comments,
// Details) that floats over the content, Mesurer-style. Docs and apps share it. People review and comment, agents
// publish new versions, and people who may edit a Markdown doc edit it together live (useLiveEditor). State lives in
// composables (useDrop, useViewerPanel, useAppFiles, useViewerFrame, useViewerAnnotations, useLiveEditor); this file
// wires them up.
import { expiryLabel } from "#shared/expiry"
import { dropPath } from "#shared/links"
import { videoType } from "#shared/plans"
import { resourceLabel } from "#shared/resources"
import { SHARE_ICONS } from "#shared/share"
import type { CommandPaletteItem } from "@nuxt/ui"
import type { DropComment, DropVersion } from "#shared/types"
import { AvatarStack } from "vite-hub/ui/avatar-stack"
import { ConnectionStatus, ConnectionStatusLabel, type ConnectionStatusState } from "vite-hub/ui/connection-status"
import type { SideTab } from "~/utils/viewer"

const { publicView = false } = defineProps<{ publicView?: boolean }>()

const state = injectDrop()!
const drop = computed(() => state.drop.data.value!)
const comments = computed(() => state.comments.data.value)

const route = useRoute()
const notify = useNotify()
const { copy, copyLoading, copied } = useCopy()
const { remove, restore } = useDropActions()
const [DefineSide, ReuseSide] = createReusableTemplate()
const { width: windowWidth } = useWindowSize()

const isApp = computed(() => drop.value.kind === "app")
const video = computed(() => (drop.value.kind === "file" ? videoType(drop.value.filename) : undefined))
// The owner gets their controls on the public link too: it is where they land after sharing it.
const owner = computed(() => drop.value.isOwner)
// Signed-in people read a public link inside the app, sidebar included (pages/d/[id]/[[slug]].vue); visitors see it alone.
const { data: me } = useMe()
const visitor = computed(() => publicView && !me.value)
const openCount = computed(() => comments.value.filter((comment) => !comment.resolved).length)
const link = useShareUrl(drop)
const now = useRelativeNow()
const trashed = computed(() => drop.value.trashedAt !== null)
// A doc's link opens its latest version. Someone reading an earlier one, pinned (`?v=`) or from History, can go to the
// latest; someone whose old link moved them to the latest (`?from=`) can go back to the version they were sent.
const latest = computed(() => drop.value.versions[0] ?? drop.value)
const older = computed(() => latest.value.id !== drop.value.id)
const latestTo = computed(() => (publicView ? dropPath(drop.value) : `/drops/${latest.value.id}`))
const sentVersion = computed(() => {
  const version = Number(route.query.from)
  return publicView && !older.value && version > 0 && version < drop.value.version ? version : 0
})
const sentNotice = ref(true)
const restoring = ref(false)
async function restoreDrop() {
  restoring.value = true
  await restore(drop.value)
  restoring.value = false
}

// A folder's description (what goes in it) is in Details, for everyone signed in who adds to it.
const details = computed(
  () => owner.value || (drop.value.kind === "folder" && Boolean(drop.value.note && me.value) && !publicView),
)
const panel = useViewerPanel({
  details,
  openCount,
  versions: computed(() => drop.value.versions.length),
  comments: computed(() => drop.value.kind !== "folder"),
})
const { wide, sideOpen, mobileSide, tabs, tab } = panel
const app = useAppFiles(drop)
const { pages, page } = app

const live = useLiveEditor(drop, { publicView: publicView })
const editing = live.editing
// ConnectionStatus waits 1.5 s before it says Reconnecting: a dropped socket usually comes back sooner, and Yjs keeps
// the edits meanwhile.
const liveLabels = { connecting: "Connecting", connected: "Live", reconnecting: "Reconnecting" } as const
const liveLabel = (status: ConnectionStatusState) =>
  live.publishing.value && status === "connected" ? "Publishing" : liveLabels[status]

const annotations = useViewerAnnotations({ drop, editing, wide, mobileSide })
const { selection, lightbox, popover, areaMode, canDrawArea, imageDraft, toggleArea, commentOnSelection, pickImage } =
  annotations
function closeLightbox() {
  lightbox.value = null
  popover.value = null
}
const popoverRef = useTemplateRef<{ fail: (reason?: string) => void; sent: () => Promise<void> }>("popoverRef")
const shareOpen = ref(false)

function startEdit() {
  popover.value = selection.value = null
  void live.open()
}
// Both pages key this viewer by the drop's id, so another version (a teammate's "Open", the sidebar) mounts a new one;
// the old one leaves its draft's room as it unmounts (useLiveEditor).
onMounted(() => {
  if (route.query.edit === "1" && drop.value.canEdit) startEdit()
})

const pageComments = computed(() =>
  isApp.value
    ? comments.value.filter(
        (comment) => comment.page === page.value || (!comment.page && page.value === pages.value[0]),
      )
    : comments.value,
)

// Open comments carry over from earlier versions (server/utils/comments.ts). One is outdated when this version no
// longer has what it pointed at: the frame couldn't find its text or element (it says which), or the drop is an image,
// where every version is a new picture.
// TODO(apps): apps replace their files in place, so their comments all count as this version's and never go
// outdated. That needs app versions kept (see publishApp in server/utils/drops.ts).
const replaced = (comment: DropComment) => drop.value.kind === "image" && comment.version < drop.value.version
// Comments on the whole page have nothing in it to pin to; they live in the panel.
const pinned = computed(() => pageComments.value.filter((comment) => !replaced(comment) && comment.kind !== "page"))

const panelOpen = computed(() => (wide.value ? sideOpen.value : mobileSide.value))
// Comments has its own button in the header: it opens the panel there, and closes it once open. History and Details
// open from More, the panel's tabs, or H and I.
const has = (value: SideTab) => tabs.value.some((item) => item.value === value)
const showing = (value: SideTab) => panelOpen.value && tab.value === value
const toggleTab = (value: SideTab) => (showing(value) ? panel.close() : panel.show(value))
// A `?changes=` link opens with History beside the diff, as if the version had been picked there.
if (route.query.changes && has("history")) {
  tab.value = "history"
  sideOpen.value = true
}
// A folder someone else shares with you, with no description, has no tab to show (no comments, no Details), so no panel either.
const floating = computed(() => sideOpen.value && wide.value && !editing.value && tabs.value.length > 0)
/** The floating card is 22.5rem wide, 0.75rem from the edge, with 1rem of air before the page's text. */
const FLOATING_INSET = 16 * (22.5 + 0.75 + 1)
const inset = computed(() => (floating.value ? FLOATING_INSET : 0))

const frame = useTemplateRef<HTMLIFrameElement>("frame")
const { srcdoc, contentOrigin, frameSrc, frameKey, ready, send, unplaced } = useViewerFrame({
  drop,
  frame,
  app,
  pinned,
  inset,
  annotations,
})

const outdated = computed(
  () =>
    new Set(
      comments.value
        .filter(
          (comment) => comment.version < drop.value.version && (replaced(comment) || unplaced.value.has(comment.id)),
        )
        .map((comment) => comment.id),
    ),
)
/**
 * The version whose changes show in place of the document (ViewerDiff), and the one before it. It lives in the address
 * (`?changes=<n>`), so the link opens the same diff and the browser's Back returns to the document.
 */
const router = useRouter()
const setQuery = useSetQuery()
const shownVersion = computed(() => {
  const n = Number(route.query.changes)
  return (n && drop.value.versions.find((item) => item.version === n)) || null
})
const previousVersion = computed(() =>
  shownVersion.value
    ? (drop.value.versions[drop.value.versions.findIndex((item) => item.id === shownVersion.value!.id) + 1] ?? null)
    : null,
)
// Opening a diff from the document adds a history entry; moving between versions replaces it, so one Back always
// lands on the document. Closing steps back over that entry rather than adding another one.
let pushedChanges = false
watch(shownVersion, (value) => !value && (pushedChanges = false))
/** Picking the open version again goes back to the document. Below `lg` the panel is a slideover, so it steps aside. */
function showVersion(version: DropVersion) {
  if (shownVersion.value?.id === version.id) return closeChanges()
  const opening = !shownVersion.value
  void setQuery({ changes: version.version }, { push: opening })
  if (opening) pushedChanges = true
  if (!wide.value) mobileSide.value = false
}
function closeChanges() {
  if (!shownVersion.value) return
  if (pushedChanges) return router.back()
  void setQuery({ changes: undefined })
}
// The diff belongs to History: another tab goes back to the document.
watch(tab, (value) => value !== "history" && closeChanges())

defineShortcuts({
  c: () => !editing.value && panel.show("comments"),
  e: () => !editing.value && drop.value.canEdit && startEdit(),
  h: () => !editing.value && has("history") && panel.show("history"),
  i: () => !editing.value && has("details") && panel.show("details"),
  r: toggleArea,
  l: () => !editing.value && copyLink("Link copied"),
  m: () => !editing.value && copiesMarkdown.value && void copyMarkdown("Markdown copied"),
  meta_s: { usingInput: true, handler: () => editing.value && void live.publish() },
  escape: () => {
    closeChanges()
    annotations.dismiss()
  },
})

// The version on screen, as the server converts it (server/middleware/0.09.drop-markdown.ts): the same text agents get.
const copiesMarkdown = computed(() => drop.value.kind === "markdown" || drop.value.kind === "html")
const copyMarkdown = (announce?: string) =>
  copyLoading(
    $fetch<string>(`${dropPath(drop.value)}.md`, { query: { v: drop.value.version }, responseType: "text" }),
    { key: "markdown", announce },
  )
const copyFeedback = () =>
  copy(feedbackMarkdown(drop.value.title, link.value, comments.value, drop.value.version), { key: "feedback" })
// A private drop has no working link yet, so its owner gets Share instead; a teammate's still copies.
function copyLink(announce?: string) {
  if (owner.value && drop.value.share === "private") shareOpen.value = true
  else void copy(link.value, { key: "link", announce })
}
// The header keeps Edit, Comments and Copy link; the rest lives in More, each with its key. The menu closes on copy, so
// a toast says it worked.
const moreMenu = computed(() =>
  [
    [
      ...(canDrawArea.value
        ? [
            {
              label: areaMode.value ? "Stop commenting on an area" : "Comment on an area",
              icon: "i-mingcute-message-1-line",
              kbds: ["r"],
              onSelect: toggleArea,
            },
          ]
        : []),
      ...(has("history")
        ? [
            {
              label: "History",
              icon: "i-mingcute-history-line",
              kbds: ["h"],
              onSelect: () => panel.show("history"),
            },
          ]
        : []),
      ...(has("details")
        ? [
            {
              label: "Details",
              icon: "i-mingcute-information-line",
              kbds: ["i"],
              onSelect: () => panel.show("details"),
            },
          ]
        : []),
    ],
    ...(copiesMarkdown.value
      ? [
          [
            {
              label: "Copy as Markdown",
              icon: "i-mingcute-markdown-line",
              kbds: ["m"],
              onSelect: () => void copyMarkdown("Markdown copied"),
            },
          ],
        ]
      : []),
    // Strangers report through the abuse queue; teammates can talk to the owner, so they don't get it.
    ...(visitor.value
      ? [
          [
            {
              label: "Report",
              icon: "i-mingcute-flag-1-line",
              to: { path: "/report", query: { target: `/d/${drop.value.link}` } },
            },
          ],
        ]
      : []),
  ].filter((group) => group.length),
)
const moreActive = computed(() => areaMode.value || showing("history") || showing("details"))

async function submit(body: string) {
  if (popover.value?.type !== "new") return
  const sent = await state.addComment({ ...popover.value.pending, ...(isApp.value ? { page: page.value } : {}) }, body)
  if (!("value" in sent)) return popoverRef.value?.fail(sent.error)
  popover.value = null
  send({ type: "clear-selection" })
}

/** A comment on the page as a whole, from the box at the bottom of the Comments panel. On an app, the page showing. */
const addPageComment = (body: string) =>
  state.addComment(
    { kind: "page", selector: "", ox: 0, oy: 0, ow: 0, oh: 0, ...(isApp.value ? { page: page.value } : {}) },
    body,
  )

async function resolve(id: string, resolved: boolean) {
  popover.value = null
  await state.resolveComment(id, resolved)
}

async function removeComment(id: string) {
  popover.value = null
  await state.removeComment(id)
}

async function reply(id: string, body: string) {
  const sent = await state.addReply(id, body)
  if ("value" in sent) await popoverRef.value?.sent()
  else popoverRef.value?.fail(sent.error)
}

// A comment's link opens the drop with its thread showing (?comment=<n>, read below). It's the drop's own link, so
// it works for whoever can open the drop. The menu that copied it closes, so a toast says it was copied.
function copyCommentLink(comment: DropComment) {
  const url = new URL(link.value)
  url.searchParams.set("comment", String(comment.n))
  void copy(url.href, { announce: "Link to the comment copied" })
}
/** The drop's link with the diff showing: it opens the same changes, History beside them. */
function copyChangesLink(version: DropVersion) {
  const url = new URL(link.value)
  url.searchParams.set("changes", String(version.version))
  void copy(url.href, { key: "changes", announce: "Link to the changes copied" })
}

/**
 * Scroll the document to the comment and open its thread there: the frame reports the pin, like a click on it. A comment
 * on the whole page has no pin: its thread opens beside its row in the panel (`row`), or at the top of the page.
 */
async function focusComment(comment: DropComment, row?: DOMRect) {
  if (isApp.value && comment.page && comment.page !== page.value) {
    page.value = comment.page
    // The new page reloads the frame; focus once it says it's ready rather than after a guessed delay.
    await nextTick()
    await until(ready).toBe(true, { timeout: 5000 })
  }
  if (!wide.value) mobileSide.value = false
  if (comment.kind !== "page") return send({ type: "focus", id: comment.id, open: true })
  // 352px wide (ViewerCommentPopover), so it sits just left of the panel.
  const top = frame.value?.getBoundingClientRect()
  popover.value =
    row && wide.value
      ? { type: "thread", id: comment.id, x: row.left - 360, y: row.top - 8 }
      : { type: "thread", id: comment.id, x: (top?.left ?? 0) + 16, y: (top?.top ?? 48) + 8 }
}

// `?comment=<n>` from a copied link: once the frame has placed the pins, open that thread with the comments showing.
onMounted(async () => {
  const n = Number(route.query.comment)
  if (!n || !["markdown", "image", "html", "app"].includes(drop.value.kind)) return
  await until(ready).toBe(true, { timeout: 10000 })
  const comment = comments.value.find((item) => item.n === n)
  if (!comment)
    return notify.info({
      title: `Comment #${n} isn't on this version`,
      icon: "i-mingcute-chat-1-line",
      color: "neutral",
    })
  if (wide.value && has("comments")) panel.show("comments")
  void focusComment(comment)
})

async function deleteDrop() {
  if (await remove(drop.value)) await navigateTo("/drops")
}

// The folders above, as breadcrumbs: in the app for people signed in, at their share links on a public page.
const moveTo = useMoveDialog()
const crumbTo = (crumb: { id: string; link: string; slug: string }) =>
  publicView ? dropPath(crumb) : `/drops/${crumb.id}`

// ⌘K lists what you can do with this drop, under its title: the More menu, the header's buttons, and Details' actions.
offerToPalette("drop", () => {
  if (visitor.value) return null
  if (editing.value)
    return {
      title: drop.value.title,
      items: [
        {
          label: "Publish the draft",
          icon: "i-mingcute-upload-line",
          kbds: ["meta", "s"],
          onSelect: () => void live.publish(),
        },
      ],
    }
  if (trashed.value)
    return {
      title: drop.value.title,
      items: owner.value
        ? [{ label: "Restore", icon: "i-mingcute-back-2-line", onSelect: () => void restoreDrop() }]
        : [],
    }
  const items: CommandPaletteItem[] = [
    ...(drop.value.canEdit
      ? [{ label: "Edit together", icon: "i-mingcute-edit-2-line", kbds: ["e"], onSelect: startEdit }]
      : []),
    ...(has("comments")
      ? [{ label: "Comments", icon: "i-mingcute-chat-1-line", kbds: ["c"], onSelect: () => panel.show("comments") }]
      : []),
    ...(canDrawArea.value
      ? [
          {
            label: areaMode.value ? "Stop commenting on an area" : "Comment on an area",
            icon: "i-mingcute-message-1-line",
            kbds: ["r"],
            onSelect: toggleArea,
          },
        ]
      : []),
    ...(has("history")
      ? [{ label: "History", icon: "i-mingcute-history-line", kbds: ["h"], onSelect: () => panel.show("history") }]
      : []),
    ...(has("details")
      ? [{ label: "Details", icon: "i-mingcute-information-line", kbds: ["i"], onSelect: () => panel.show("details") }]
      : []),
    { label: "Copy link", icon: "i-mingcute-link-line", kbds: ["l"], onSelect: () => copyLink("Link copied") },
    ...(drop.value.resources ?? []).map((resource) => ({
      label: `Open ${resourceLabel(resource)}`,
      icon: "i-mingcute-external-link-line",
      to: resource.url,
      target: "_blank",
    })),
    ...(copiesMarkdown.value
      ? [
          {
            label: "Copy as Markdown",
            icon: "i-mingcute-markdown-line",
            kbds: ["m"],
            onSelect: () => void copyMarkdown("Markdown copied"),
          },
        ]
      : []),
    ...(owner.value
      ? [{ label: "Share…", icon: SHARE_ICONS[drop.value.share], onSelect: () => (shareOpen.value = true) }]
      : []),
    ...(owner.value
      ? [
          {
            label: "Move to folder",
            icon: "i-mingcute-new-folder-line",
            onSelect: () => void moveTo({ drop: drop.value }),
          },
        ]
      : []),
    ...(drop.value.canTrash
      ? [{ label: "Move to Trash", icon: "i-mingcute-delete-2-line", onSelect: () => void deleteDrop() }]
      : []),
  ]
  return { title: drop.value.title, items }
})

// Areas drawn over an image in the page anchor to that image, so the lightbox shows them too.
const imageComments = computed(() =>
  lightbox.value
    ? pageComments.value.filter(
        (comment) =>
          comment.kind !== "text" && comment.selector === lightbox.value!.selector && !outdated.value.has(comment.id),
      )
    : [],
)
const threadComment = computed(() => {
  const open = popover.value
  return open?.type === "thread" ? comments.value.find((comment) => comment.id === open.id) : undefined
})
// The open thread stays in the address (`?comment=<n>`, read above), so it can be shared from the address bar too.
watch(
  () => threadComment.value?.n,
  (n) => textValue(route.query.comment) !== (n ? String(n) : undefined) && void setQuery({ comment: n }),
)
</script>

<template>
  <DefineSide>
    <div class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-default pr-2 pl-2">
      <UTabs v-model="tab" class="min-w-0" color="neutral" :content="false" :items="tabs" size="sm">
        <template #trailing="{ item }">
          <span v-if="item.count" class="font-mono text-[11px] text-dimmed tabular-nums">{{ item.count }}</span>
        </template>
      </UTabs>
      <div class="flex items-center gap-1">
        <UButton
          v-if="tab === 'comments' && comments.length"
          aria-label="Copy feedback for your agent"
          color="neutral"
          :icon="copied('feedback') ? 'i-mingcute-check-line' : 'i-mingcute-sparkles-line'"
          size="sm"
          title="Copy feedback for your agent"
          variant="ghost"
          @click="copyFeedback"
        />
        <UButton
          aria-label="Close panel"
          color="neutral"
          icon="i-mingcute-close-line"
          size="sm"
          variant="ghost"
          @click="panel.close"
        />
      </div>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <ViewerComments
        v-if="tab === 'comments'"
        :can-comment="drop.canComment"
        :can-manage="drop.isOwner"
        :comments="comments"
        :add-page-comment="addPageComment"
        :outdated="outdated"
        :version="drop.version"
        :versions="drop.versions"
        @focus="focusComment"
        @resolve="resolve"
      />
      <ViewerHistory
        v-else-if="tab === 'history'"
        :comments="comments"
        :drop="drop"
        :selected="shownVersion?.id"
        @open="showVersion"
      />

      <ViewerOverview v-else :drop="drop" @share="shareOpen = true">
        <template #actions>
          <ViewerAction
            :icon="copied('link') ? 'i-mingcute-check-line' : 'i-mingcute-link-line'"
            :label="copied('link') ? 'Link copied' : 'Copy link'"
            @click="copyLink()"
          />
          <ViewerAction
            v-if="drop.url"
            icon="i-mingcute-download-2-line"
            label="Download original"
            @click="navigateTo(drop.url, { external: true, open: { target: '_blank' } })"
          />
          <ViewerAction
            v-if="owner && !trashed"
            icon="i-mingcute-new-folder-line"
            label="Move to folder"
            @click="moveTo({ drop })"
          />
          <ViewerAction
            v-if="drop.canTrash && !trashed"
            destructive
            icon="i-mingcute-delete-2-line"
            label="Move to Trash"
            @click="deleteDrop"
          />
        </template>
      </ViewerOverview>
    </div>
  </DefineSide>

  <UDashboardPanel id="drop-main" :ui="{ body: 'p-0 sm:p-0 gap-0 overflow-hidden' }">
    <template #header>
      <UDashboardNavbar :toggle="!visitor" :ui="{ root: 'h-12 gap-2 px-2 sm:px-3', left: 'min-w-0', title: 'min-w-0' }">
        <template #leading>
          <SidebarExpand v-if="!visitor" />
          <NuxtLink v-if="visitor" aria-label="Drop" class="grid size-8 place-items-center" to="/"
            ><DropMark class="h-4 w-6"
          /></NuxtLink>
          <UButton
            v-else-if="drop.ancestors.length"
            :aria-label="`Back to ${drop.ancestors.at(-1)!.title}`"
            color="neutral"
            icon="i-mingcute-arrow-left-line"
            size="sm"
            variant="ghost"
            :to="crumbTo(drop.ancestors.at(-1)!)"
          />
          <UButton
            v-else
            aria-label="Back to drops"
            color="neutral"
            icon="i-mingcute-arrow-left-line"
            size="sm"
            variant="ghost"
            to="/drops"
          />
        </template>
        <template #title>
          <span class="flex min-w-0 items-center gap-2">
            <nav
              v-if="drop.ancestors.length"
              aria-label="Folders"
              class="hidden min-w-0 shrink items-center gap-1 text-sm text-muted sm:flex"
            >
              <template v-for="crumb in drop.ancestors" :key="crumb.id">
                <NuxtLink class="max-w-40 truncate transition-colors hover:text-highlighted" :to="crumbTo(crumb)">{{
                  crumb.title
                }}</NuxtLink>
                <UIcon name="i-mingcute-right-line" class="size-3 shrink-0 text-dimmed" />
              </template>
            </nav>
            <span class="truncate text-sm font-medium">{{ drop.title }}</span>
            <ConnectionStatus
              v-if="editing"
              class="label-mono shrink-0 data-[status=reconnecting]:text-error"
              :status="live.status.value"
            >
              <ConnectionStatusLabel v-slot="{ state: connection }">{{ liveLabel(connection) }}</ConnectionStatusLabel>
            </ConnectionStatus>
          </span>
        </template>
        <!-- After the title, not in it: the heading stays the drop's name. -->
        <template v-if="drop.resources && !editing" #trailing>
          <ViewerResources :resources="drop.resources" />
        </template>
        <template v-if="editing" #right>
          <AvatarStack
            v-if="live.people.value.length"
            class="mr-1"
            :max="5"
            :people="live.people.value"
            :style="{ '--vh-avatar-size': '1.25rem' }"
            variant="outline"
          />
          <UButton color="neutral" label="Close" size="sm" variant="ghost" @click="live.close" />
          <UButton
            color="neutral"
            :disabled="!live.synced.value"
            label="Publish"
            :loading="live.publishing.value"
            size="sm"
            @click="live.publish()"
          />
        </template>
        <!-- Three tools at hand and More for the rest: icons only, shortcuts in the tooltips and the menu. -->
        <template v-else #right>
          <UTooltip
            v-if="drop.canEdit || drop.editNote"
            :kbds="drop.canEdit ? ['E'] : undefined"
            :text="drop.editNote ?? 'Edit together'"
          >
            <UButton
              aria-label="Edit together"
              color="neutral"
              :disabled="!drop.canEdit"
              icon="i-mingcute-pencil-line"
              :loading="live.opening.value"
              size="sm"
              variant="ghost"
              @click="startEdit"
            />
          </UTooltip>
          <UTooltip v-if="has('comments')" :kbds="['C']" text="Comments">
            <UButton
              :aria-label="openCount ? `Comments, ${openCount} open` : 'Comments'"
              :aria-pressed="showing('comments')"
              color="neutral"
              icon="i-mingcute-chat-3-line"
              :label="openCount ? String(openCount) : undefined"
              size="sm"
              :ui="{ label: 'font-mono text-xs tabular-nums' }"
              :variant="showing('comments') ? 'soft' : 'ghost'"
              @click="toggleTab('comments')"
            />
          </UTooltip>
          <UTooltip :kbds="['L']" text="Copy link">
            <UButton
              aria-label="Copy link"
              color="neutral"
              :icon="copied('link') ? 'i-mingcute-check-line' : 'i-mingcute-link-line'"
              size="sm"
              variant="ghost"
              @click="copyLink()"
            />
          </UTooltip>
          <UDropdownMenu v-if="moreMenu.length" :content="{ align: 'end' }" :items="moreMenu">
            <UButton
              aria-label="More"
              :aria-pressed="moreActive"
              color="neutral"
              icon="i-mingcute-more-1-line"
              size="sm"
              :variant="moreActive ? 'soft' : 'ghost'"
            />
          </UDropdownMenu>
          <!-- No right margin: the ghost buttons after it pad themselves, and more air cut the share button off the tools. -->
          <USeparator v-if="owner || visitor" class="ml-1 h-4" orientation="vertical" />
          <UButton
            v-if="owner"
            color="neutral"
            :icon="SHARE_ICONS[drop.share]"
            :label="drop.share === 'private' && !drop.shareReview ? 'Share' : shareStatus(drop, now)"
            size="sm"
            :variant="drop.share === 'private' ? 'solid' : 'ghost'"
            @click="shareOpen = true"
          />
          <UButton
            v-else-if="visitor"
            class="hidden sm:inline-flex"
            color="neutral"
            label="Make Your Own"
            size="sm"
            to="/"
            variant="outline"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert
        v-if="owner && trashed"
        :actions="[
          {
            label: 'Restore',
            color: 'error',
            variant: 'outline',
            size: 'sm',
            loading: restoring,
            onClick: restoreDrop,
          },
        ]"
        class="rounded-none border-0 border-b border-default"
        color="error"
        :description="
          drop.trashReason === 'expired'
            ? 'Nobody opened it for a while, so its link stopped working. Only you and admins can see it until you restore it.'
            : 'Its link stopped working. Only you and admins can see it until you restore it.'
        "
        icon="i-mingcute-delete-2-line"
        orientation="horizontal"
        :title="expiryLabel(drop, now)"
        variant="subtle"
      />
      <UAlert
        v-else-if="older"
        :actions="[
          { label: `Open v${latest.version}`, color: 'neutral', variant: 'outline', size: 'sm', to: latestTo },
        ]"
        class="rounded-none border-0 border-b border-default"
        color="neutral"
        :description="`v${latest.version} is the latest version.`"
        icon="i-mingcute-history-line"
        orientation="horizontal"
        :title="`You're reading v${drop.version}`"
        variant="subtle"
      />
      <UAlert
        v-else-if="sentVersion && sentNotice"
        :actions="[
          {
            label: `View v${sentVersion}`,
            color: 'neutral',
            variant: 'outline',
            size: 'sm',
            to: dropPath(drop, sentVersion),
          },
        ]"
        class="rounded-none border-0 border-b border-default"
        close
        color="neutral"
        :description="`The link you opened pointed at v${sentVersion}. This is v${drop.version}, the latest.`"
        icon="i-mingcute-arrow-right-up-line"
        orientation="horizontal"
        title="Updated since this link was shared"
        variant="subtle"
        @update:open="sentNotice = $event"
      />
      <div v-if="isApp" class="flex h-9 shrink-0 items-center gap-2 border-b border-default px-3">
        <span
          class="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-elevated px-2.5 py-1 font-mono text-xs text-muted"
        >
          <UIcon :name="SHARE_ICONS[drop.share]" class="size-3 shrink-0" />
          <span class="truncate">{{ drop.slug || drop.link }}/{{ page === "index.html" ? "" : page }}</span>
        </span>
        <USelect v-if="pages.length > 1" v-model="page" class="w-40 font-mono" :items="pages" size="xs" />
      </div>

      <div class="relative flex min-h-0 flex-1 flex-col">
        <LazyViewerEditor v-if="editing" :editor="live.editor.value" :synced="live.synced.value" />
        <!-- The grid keeps clear of the floating panel, like a doc's text (FLOATING_INSET). -->
        <ViewerFolder
          v-else-if="drop.kind === 'folder'"
          :class="floating && 'pr-96'"
          :drop="drop"
          :public-view="publicView"
        />
        <ViewerSite
          v-else-if="drop.kind === 'site'"
          :drop="drop"
          :inset="floating ? FLOATING_INSET : 0"
          :public-view="publicView"
        />
        <LazyViewerBoard
          v-else-if="drop.kind === 'board'"
          :key="drop.id"
          :drop="drop"
          :inset="floating ? FLOATING_INSET : 0"
        />
        <ViewerVideo v-else-if="video && drop.url" :inset="inset" :src="drop.url" :title="drop.title" :type="video" />
        <!-- A file with html is a spreadsheet the server rendered; it shows in the frame like a doc. -->
        <div v-else-if="drop.kind === 'file' && !drop.html" class="grid flex-1 place-items-center p-10 text-center">
          <div>
            <UIcon name="i-mingcute-file-line" class="size-8 text-dimmed" />
            <p class="mt-3 font-mono text-sm">{{ drop.filename }}</p>
            <p class="mt-1 text-sm text-muted">No preview for this file type.</p>
            <UButton
              v-if="drop.url"
              class="mt-4"
              color="neutral"
              icon="i-mingcute-download-2-line"
              label="Download"
              :to="drop.url"
              external
              target="_blank"
              variant="outline"
            />
          </div>
        </div>
        <iframe
          v-else-if="contentOrigin"
          :key="frameKey"
          ref="frame"
          class="block min-h-0 w-full flex-1 bg-default [color-scheme:light]"
          :allow="frameAllow(drop.kind)"
          :sandbox="CONTENT_SANDBOX"
          :src="frameSrc"
          :title="drop.title"
        />
        <!-- [color-scheme:light] on both frames matches a blank or light document, so the browser paints no opaque white
             backdrop behind it in dark mode. -->
        <!-- Hydration mismatch reason: server and client bundlers format srcdoc's embedded app resolver differently. -->
        <iframe
          v-else-if="srcdoc"
          ref="frame"
          class="block min-h-0 w-full flex-1 bg-default [color-scheme:light]"
          data-allow-mismatch="attribute"
          :allow="frameAllow(drop.kind)"
          :sandbox="PREVIEW_SANDBOX"
          :srcdoc="srcdoc"
          :title="drop.title"
        />

        <ViewerDiff
          v-if="shownVersion && !editing"
          :key="shownVersion.id"
          :inset="floating ? FLOATING_INSET : 0"
          :previous="previousVersion"
          :copied="copied('changes')"
          :version="shownVersion"
          @close="closeChanges"
          @copy-link="copyChangesLink(shownVersion)"
        />

        <!-- As tall as its content, so a quiet drop gets a small card. Markdown docs make room for it (FLOATING_INSET). -->
        <aside
          v-if="floating"
          class="absolute top-3 right-3 z-20 flex max-h-[calc(100%-1.5rem)] w-[22.5rem] origin-top-right flex-col overflow-hidden rounded-lg border border-default bg-default shadow-md [animation:pop-in_160ms_var(--ease-out)]"
        >
          <ReuseSide />
        </aside>
      </div>
    </template>
  </UDashboardPanel>
  <USlideover
    v-if="!wide && !editing"
    v-model:open="mobileSide"
    side="right"
    :ui="{ content: 'max-w-md' }"
    title="Drop panel"
  >
    <template #content>
      <div class="flex h-full flex-col"><ReuseSide /></div>
    </template>
  </USlideover>

  <div
    v-if="selection && !popover"
    class="fixed z-30 -translate-x-1/2 -translate-y-full"
    :style="{
      left: `${Math.min(Math.max(60, (selection.rect.left + selection.rect.right) / 2), windowWidth - 60)}px`,
      top: `${Math.max(56, selection.rect.top - 8)}px`,
    }"
  >
    <div
      class="flex origin-bottom items-center rounded-md border border-default bg-default p-0.5 shadow-sm [animation:pop-in_140ms_var(--ease-out)]"
    >
      <UButton
        color="neutral"
        icon="i-mingcute-chat-1-line"
        label="Comment"
        size="sm"
        variant="ghost"
        @click="commentOnSelection"
        @mousedown.prevent
      />
    </div>
  </div>

  <ViewerLightbox
    v-if="lightbox"
    :alt="lightbox.alt"
    :can-comment="drop.canComment"
    :comments="imageComments"
    :draft="imageDraft"
    :from="lightbox.from"
    :src="lightbox.src"
    @close="closeLightbox"
    @pick="pickImage"
    @thread="(id, x, y) => (popover = { type: 'thread', id, x, y })"
  />

  <ViewerCommentPopover
    v-if="popover"
    ref="popoverRef"
    :can-manage="drop.isOwner"
    :comment="threadComment"
    :pending="popover.type === 'new' ? popover.pending : undefined"
    :x="popover.x"
    :y="popover.y"
    :can-reply="drop.canComment"
    @cancel="popover = null"
    @copy-link="copyCommentLink"
    @delete="removeComment"
    @delete-reply="(id, replyId) => state.removeReply(id, replyId)"
    @reply="reply"
    @resolve="resolve"
    @submit="submit"
  />

  <ViewerShareModal v-if="owner" v-model:open="shareOpen" :drop="drop" />
</template>
