import { promiseTimeout } from "@vueuse/core"
import * as v from "valibot"
import type { DropDetail, DropSummary } from "#shared/types"
import type { LiveRoom } from "~/composables/live-room"

// What a publishing client leaves on its awareness state. Other clients set it, so it's parsed, not trusted.
const PublishedSchema = v.object({ id: v.string(), version: v.number(), name: v.string() })
type Published = v.InferOutput<typeof PublishedSchema>
const LintFailureSchema = v.object({
  problems: v.array(v.object({ severity: v.string(), line: v.number(), message: v.string() })),
})

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
  // The room and its editor load the first time someone opens the editor (~/composables/live-room), so readers never
  // download Yjs or Tiptap. They run in a scope of this component's: leaving the page leaves the room.
  const scope = effectScope()
  const room = shallowRef<LiveRoom>()
  const realtime = computed(() => room.value?.realtime)
  const editor = computed(() => room.value?.editor.value)
  const editing = computed(() => Boolean(documentId.value))
  const people = computed(() => realtime.value?.people.value ?? [])

  // A new version keeps the drop's id, so the page reloads the drop's data rather than finding a new address.
  async function openLatest(id: string, edit = false) {
    await refreshNuxtData([keys.drop(id), keys.comments(id)])
    await navigateTo({ path: `${options.publicView ? "/d" : "/drops"}/${id}`, query: edit ? { edit: "1" } : {} })
  }

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
          if (clientId === provider.awareness.clientID || !published) continue
          const key = `${published.id}@${published.version}`
          if (key === announced) continue
          announced = key
          notify.say(`${published.name} published v${published.version}`, {
            icon: "i-mingcute-arrow-right-up-line",
            action: { label: "Open", onClick: () => void openLatest(published.id, true) },
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
      const [{ useLiveRoom }, { documentId: id }] = await Promise.all([
        import("~/composables/live-room"),
        $fetch<{ documentId: string }>(`/api/drops/${drop.value.id}/edit`, { method: "POST" }),
      ])
      room.value ??= scope.run(() => useLiveRoom(documentId))
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
        body: { version: drop.value.version, force },
      })
      if (next.unchanged) {
        notify.done("Nothing to publish: the draft matches")
        return
      }
      const awareness = realtime.value?.provider.value?.awareness
      const me = people.value.find((person) => person.clientId === awareness?.clientID)
      awareness?.setLocalStateField("published", {
        id: next.id,
        version: next.version,
        name: me?.name ?? "Someone",
      } satisfies Published)
      notify.done(`Published v${next.version}`)
      // A new version adds bytes and a write, so the plan usage moves too.
      await refreshNuxtData([keys.drops, keys.tree, keys.usage])
      // Let the announcement reach the room before this client leaves it.
      await promiseTimeout(300)
      close()
      await openLatest(next.id)
    } catch (error) {
      // The Markdown has Comark errors (requirePublishableMarkdown): the first few, by line, rather than the whole list.
      const errors = errorData(error, LintFailureSchema)?.problems.filter((problem) => problem.severity === "error")
      if (errors?.length) {
        notify.alert(
          errors.length === 1 ? "Couldn't publish: fix this line" : `Couldn't publish: fix ${errors.length} problems`,
          errors
            .slice(0, 3)
            .map((problem) => `Line ${problem.line}: ${problem.message}`)
            .join(" "),
        )
        return
      }
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
      notify.say(`v${head.version} is the latest version. Your draft stays here`, {
        icon: "i-mingcute-history-line",
        action: {
          label: `Open v${head.version}`,
          onClick: () => {
            close()
            void openLatest(head.id)
          },
        },
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
