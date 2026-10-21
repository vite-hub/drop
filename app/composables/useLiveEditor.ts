import { promiseTimeout } from "@vueuse/core"
import * as v from "valibot"
import type { DropDetail, DropSummary } from "#shared/types"
import type { LiveRoom } from "~/utils/live-room"

// What a publishing client leaves on its awareness state. Other clients set it, so it's parsed, not trusted.
const PublishedSchema = v.object({ id: v.string(), version: v.number(), name: v.string() })
type Published = v.InferOutput<typeof PublishedSchema>

/**
 * Live editing of a Markdown drop. Everyone who opens it joins one Realtime room on the drop's draft, sees the others,
 * and types into the same text. The room saves the draft on its own; publish saves it once more and makes it the next
 * version, and the others follow. Closing keeps the draft, so the next person who opens it continues where the room left off.
 */
export function useLiveEditor(drop: Ref<DropDetail>, options: { publicView: boolean }) {
  const notify = useNotify()
  const confirm = useConfirm()
  const documentId = ref<string>()
  const opening = ref(false)
  const publishing = ref(false)
  // The room and its editor load the first time someone opens the editor (~/utils/live-room), so readers never
  // download Yjs or Tiptap. They run in a scope of this component's: leaving the page leaves the room.
  const scope = effectScope()
  const room = shallowRef<LiveRoom>()
  const realtime = computed(() => room.value?.realtime)
  const editor = computed(() => room.value?.editor.value)
  const editing = computed(() => Boolean(documentId.value))
  const people = computed(() => realtime.value?.people.value ?? [])

  const url = (id: string, edit = false) => ({
    path: `${options.publicView ? "/d" : "/drops"}/${id}`,
    query: edit ? { edit: "1" } : {},
  })

  // A teammate published: their client leaves `published` on its awareness state before it goes.
  let announced = ""
  watch(
    () => realtime.value?.provider.value,
    (provider, _, onCleanup) => {
      if (!provider) return
      const check = () => {
        for (const [clientId, state] of provider.awareness.getStates()) {
          const parsed = v.safeParse(v.object({ published: PublishedSchema }), state)
          const published = parsed.success ? parsed.output.published : undefined
          if (clientId === provider.awareness.clientID || !published || published.id === announced) continue
          announced = published.id
          notify.info({
            title: `${published.name} published v${published.version}`,
            description: "Keep editing the new version.",
            icon: "i-mingcute-arrow-right-up-line",
            actions: [
              {
                label: "Open",
                color: "neutral",
                variant: "outline",
                onClick: () => void navigateTo(url(published.id, true)),
              },
            ],
          })
        }
      }
      provider.awareness.on("change", check)
      onCleanup(() => provider.awareness.off("change", check))
    },
    { flush: "sync" },
  )

  async function open() {
    if (editing.value || opening.value || !drop.value.canEdit) return
    opening.value = true
    try {
      const [{ joinLiveRoom }, { documentId: id }] = await Promise.all([
        import("~/utils/live-room"),
        $fetch<{ documentId: string }>(`/api/drops/${drop.value.id}/edit`, { method: "POST" }),
      ])
      room.value ??= scope.run(() => joinLiveRoom(documentId))
      documentId.value = id
    } catch (error) {
      notify.fail("Couldn't open the editor", error)
    } finally {
      opening.value = false
    }
  }

  function close() {
    room.value?.editor.value?.destroy()
    if (room.value) room.value.editor.value = undefined
    documentId.value = undefined
  }

  async function publish(force = false): Promise<void> {
    if (!editing.value || publishing.value) return
    publishing.value = true
    try {
      await realtime.value?.save()
      const next = await $fetch<DropSummary & { unchanged?: boolean }>(`/api/drops/${drop.value.id}/versions`, {
        method: "POST",
        body: { force },
      })
      if (next.unchanged) {
        notify.done("Nothing to publish", "The draft matches the published version.")
        return
      }
      const awareness = realtime.value?.provider.value?.awareness
      const me = people.value.find((person) => person.clientId === awareness?.clientID)
      awareness?.setLocalStateField("published", {
        id: next.id,
        version: next.version,
        name: me?.name ?? "Someone",
      } satisfies Published)
      notify.done(`Published v${next.version}`, "The previous version stays in history.")
      // A new version adds bytes and a write, so the plan usage moves too.
      await refreshNuxtData([keys.drops, keys.usage])
      // Let the announcement reach the room before this client leaves it.
      await promiseTimeout(300)
      close()
      await navigateTo(url(next.id))
    } catch (error) {
      const head = errorData(error, v.object({ head: v.object({ id: v.string(), version: v.number() }) }))?.head
      if (!head) {
        notify.fail("Couldn't publish", error)
        return
      }
      publishing.value = false
      const replace = await confirm({
        title: `v${head.version} was published while you were editing`,
        description: `Publishing now puts your draft on top of v${head.version}, replacing its changes.`,
        confirmLabel: "Publish anyway",
        destructive: true,
      })
      // Awaited, or this call's `finally` would release the lock while the forced publish still runs.
      if (replace) return await publish(true)
      notify.info({
        title: `v${head.version} is the latest version`,
        description: "Your draft stays here until you publish it.",
        icon: "i-mingcute-history-line",
        actions: [
          {
            label: `Open v${head.version}`,
            color: "neutral",
            variant: "outline",
            onClick: () => {
              close()
              void navigateTo(url(head.id))
            },
          },
        ],
      })
    } finally {
      publishing.value = false
    }
  }

  onScopeDispose(close)

  return {
    editor,
    editing,
    opening,
    publishing,
    people,
    status: computed(() => realtime.value?.status.value ?? "disconnected"),
    synced: computed(() => realtime.value?.synced.value ?? false),
    open,
    close,
    publish,
  }
}
