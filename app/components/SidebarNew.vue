<script setup lang="ts">
// The + on the Drops row in the sidebar: what you make yourself, from any page. A folder, a doc, a board or a site
// review open once made; a file uploads and opens. On a team Drop admins choose whether a new folder is the team's.
// Agents make most drops, so this stays one quiet button rather than a bar of them.
const { upload, createFolder, createSite, createDoc, createBoard } = useDropActions()
const folderDialog = useFolderDialog()
const siteDialog = useSiteDialog()
const { data: me } = useMe()
const route = useRoute()
const picker = useFileDialog({ multiple: false, reset: true })
picker.onChange(async (files) => {
  const made = files?.[0] && (await upload(files[0]))
  if (made) await navigateTo(`/drops/${made.id}`)
})

async function newFolder() {
  const offerTeam = me.value?.mode === "team" && me.value.role === "admin"
  const input = await folderDialog({ offerTeam, team: offerTeam && route.query.tab === "with-me" })
  const folder =
    input && (await createFolder(input.title, undefined, { description: input.description, team: input.team }))
  if (folder) await navigateTo(`/drops/${folder.id}`)
}
async function newSite() {
  const input = await siteDialog()
  const site = input && (await createSite(input))
  if (site) await navigateTo(`/drops/${site.id}`)
}
const items = [
  [
    { label: "Folder", icon: "i-mingcute-folder-line", onSelect: () => void newFolder() },
    {
      label: "Doc",
      icon: KIND_ICONS.markdown,
      onSelect: async () => {
        const doc = await createDoc()
        if (doc) await navigateTo(`/drops/${doc.id}?edit=1`)
      },
    },
    {
      label: "Board",
      icon: "i-mingcute-drawing-board-line",
      onSelect: async () => {
        const board = await createBoard()
        if (board) await navigateTo(`/drops/${board.id}`)
      },
    },
    { label: "Site review", icon: "i-mingcute-globe-line", onSelect: () => void newSite() },
  ],
  // Opens the file picker straight from the pick, while the browser still counts it as the person's click.
  [{ label: "Upload a file", icon: "i-mingcute-upload-2-line", onSelect: () => picker.open() }],
]
</script>

<template>
  <DeferredMenu :items="items" :content="{ align: 'start', side: 'right' }">
    <UTooltip text="New drop">
      <button
        aria-label="New drop"
        class="relative grid size-6 cursor-pointer place-items-center rounded-sm text-dimmed before:absolute before:-inset-1 hover:bg-accented hover:text-highlighted"
        type="button"
      >
        <UIcon class="size-4" name="i-mingcute-add-line" />
      </button>
    </UTooltip>
  </DeferredMenu>
</template>
