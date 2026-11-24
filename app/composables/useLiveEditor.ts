import { promiseTimeout } from "@vueuse/core"
import * as v from "valibot"
import { draftOf } from "#shared/draft-paths"
import type { DropDetail, DropSummary, PrivateEmbed, Viewer } from "#shared/types"
import type { LiveRoom } from "~/composables/live-room"

const PublishedSchema = v.object({ id: v.string(), version: v.number(), name: v.string() })
type Published = v.InferOutput<typeof PublishedSchema>
const LintFailureSchema = v.object({
  problems: v.array(v.object({ severity: v.string(), line: v.number(), message: v.string() })),
})
const GoneSchema = v.object({ statusCode: v.literal(404) })

export function useLiveEditor(drop: Ref<DropDetail>, options: { publicView: boolean }) {
  const notify = useNotify()
  const confirm = useConfirm()
  const documentId = ref<string>()
  const opening = ref(false)
  const publishing = ref(false)
  const scope = effectScope()
  const room = shallowRef<LiveRoom>()
  const realtime = computed(() => room.value?.realtime)
  const editor = computed(() => room.value?.editor.value)
  const uploading = computed(() => room.value?.uploading.value ?? false)
  const editing = computed(() => Boolean(documentId.value))
  const people = computed(() => realtime.value?.people.value ?? [])
  const { data: me } = useNuxtData<Viewer | null>(keys.me)

  const refused = ref<number>()
  const outOfReach = computed(
    () => editing.value && refused.value === undefined && realtime.value?.status.value !== "connected",
  )
  const lookDelay = ref(5_000)
  let lookGeneration = 0
  const look = useTimeoutFn(
    async () => {
      const generation = lookGeneration
      await checkDraft(generation)
      if (generation !== lookGeneration || !outOfReach.value) return
      lookDelay.value = 30_000
      look.start()
    },
    lookDelay,
    { immediate: false },
  )
  watch(outOfReach, (away) => {
    lookGeneration++
    look.stop()
    lookDelay.value = 5_000
    if (away) look.start()
  })
  async function checkDraft(generation: number) {
    const id = documentId.value
    const draft = id ? draftOf(id) : null
    if (!draft) return
    const head = await $fetch<DropDetail>(`/api/drops/${draft.id}`).catch((error: unknown) =>
      v.is(GoneSchema, error) ? null : undefined,
    )
    if (generation !== lookGeneration || documentId.value !== id || !outOfReach.value) return
    if (head === undefined || (head && head.version === draft.version && head.canEdit)) return
    realtime.value?.provider.value?.disconnect()
    editor.value?.setEditable(false, false)
    if (head && head.version > draft.version) {
      refused.value = head.version
      notify.say(`v${head.version} was published while you were editing`, {
        icon: "i-mingcute-history-line",
        action: { label: `Open v${head.version}`, onClick: () => void openRefused() },
      })
    } else {
      refused.value = 0
      notify.say("You can't edit this drop anymore", { icon: "i-mingcute-lock-line" })
    }
  }

  watch([() => realtime.value?.readOnlyReason.value, editor], ([reason, current], [before]) => {
    if (reason !== "document") return
    current?.setEditable(false, false)
    if (reason !== before) notify.say("This doc can't be edited in Drop", { icon: "i-mingcute-lock-line" })
  })

  async function openLatest(id: string, edit = false) {
    await refreshNuxtData([keys.drop(id), keys.comments(id)])
    await navigateTo({ path: `${options.publicView ? "/d" : "/drops"}/${id}`, query: edit ? { edit: "1" } : {} })
  }

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
      room.value ??= scope.run(() => useLiveRoom(documentId, () => me.value))
      if (room.value) {
        room.value.edited.value = false
        room.value.unsaved.value = false
      }
      refused.value = undefined
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

  async function mayClose() {
    if (!room.value?.unsaved.value) return true
    return await confirm({
      title: "Your last edits haven't saved",
      description:
        refused.value === undefined
          ? "You're offline, so they're still only in this tab. Closing the editor now loses them."
          : "This draft can't save anymore, so they're only in this tab. Closing the editor now loses them.",
      confirmLabel: "Close and lose them",
      destructive: true,
    })
  }

  async function leave() {
    const kept = room.value?.edited.value && refused.value === undefined
    if (!(await mayClose())) return
    close()
    if (kept)
      notify.say("Draft kept, not published yet", {
        icon: "i-mingcute-edit-2-line",
        action: { label: "Keep editing", onClick: () => void open() },
      })
  }

  async function openRefused() {
    if (!(await mayClose())) return
    close()
    await openLatest(drop.value.id)
  }

  async function publish(force = false): Promise<void> {
    if (!editing.value || publishing.value) return
    if (uploading.value) {
      notify.say("Wait for images to finish uploading before publishing")
      return
    }
    publishing.value = true
    try {
      await realtime.value?.save()
      const next = await $fetch<DropSummary & { unchanged?: boolean; privateEmbeds?: PrivateEmbed[] }>(
        `/api/drops/${drop.value.id}/versions`,
        {
          method: "POST",
          body: { version: drop.value.version, force },
        },
      )
      if (next.unchanged) {
        notify.done("Nothing to publish: the draft matches")
        return
      }
      const awareness = realtime.value?.provider.value?.awareness
      awareness?.setLocalStateField("published", {
        id: next.id,
        version: next.version,
        name: me.value?.name ?? "Someone",
      } satisfies Published)
      notify.done(`Published v${next.version}`)
      notify.privateEmbeds(next.privateEmbeds)
      await refreshNuxtData([keys.drops, keys.tree, keys.pinned, keys.usage])
      await promiseTimeout(300)
      close()
      await openLatest(next.id)
    } catch (error) {
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
    uploading,
    people,
    status: computed(() => realtime.value?.status.value ?? "disconnected"),
    synced: computed(() => realtime.value?.synced.value ?? false),
    refused: readonly(refused),
    open,
    close,
    leave,
    openRefused,
    publish,
  }
}
