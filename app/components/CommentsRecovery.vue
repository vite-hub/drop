<script setup lang="ts">
const { entries, heldIds, discard, clock } = useCommentsOutbox()
const route = useRoute()
// Ticks only while something is queued: a head stuck sending shows up after 5 s.
const second = useNow({ controls: true, scheduler: (update) => useIntervalFn(update, 1000, { immediate: false }) })
watch(
  () => entries.value.length > 0,
  (queued) => (queued ? second.resume() : second.pause()),
  { immediate: true },
)
const count = computed(() => troubleCount(entries.value, clock(second.now.value.getTime())) + heldIds.value.length)
const open = ref(false)
const urls = fileUrls()
watch(
  () => route.fullPath,
  () => (open.value = false),
)
watch(entries, (saved) => urls.keep(fileKeys(saved)))
onScopeDispose(urls.clear)
const items = computed(() =>
  entries.value.map((entry) => ({
    drop: dropOf(entry),
    reply: entry.kind === "reply",
    message: {
      id: entry.id,
      body: entry.input.body,
      mentions: entry.input.mentions ?? [],
      createdAt: entry.createdAt,
    },
    delivery: entryDelivery(entry),
    files: fileKeys([entry]).map((key, index) => {
      const file = entry.files[index]!
      return {
        key,
        name: file instanceof File && file.name ? file.name : `Image ${index + 1}`,
        url: open.value ? urls.urlOf(key, file) : undefined,
      }
    }),
  })),
)
</script>

<template>
  <UModal
    v-if="count || open"
    v-model:open="open"
    title="Unsent comments"
    description="Recover comments and replies even when the original page is unavailable. Discard only removes this browser’s copy."
  >
    <UButton
      v-if="count"
      class="fixed bottom-3 left-3 z-40 shadow-sm"
      color="neutral"
      icon="i-mingcute-time-line"
      :label="`Unsent comments (${count})`"
      size="sm"
      variant="outline"
    />
    <template #body>
      <p v-if="!count" class="text-muted">No unsent comments.</p>
      <ul v-else class="divide-y divide-default">
        <li v-for="id in heldIds" :key="id" class="flex items-center gap-2 py-3 first:pt-0 last:pb-0">
          <UButton
            :to="{ path: '/signin', query: { redirect: route.path } }"
            color="neutral"
            label="Sign in to send"
            size="sm"
            variant="link"
          />
          <UButton color="neutral" label="Discard" size="sm" variant="link" @click="discard(id)" />
        </li>
        <li v-for="item in items" :key="item.message.id" class="space-y-2 py-3 first:pt-0 last:pb-0">
          <p class="text-xs text-muted">
            {{ item.reply ? "Reply" : "Comment" }}<template v-if="item.drop"> · Drop {{ item.drop }}</template>
          </p>
          <p class="text-sm whitespace-pre-wrap wrap-anywhere">{{ item.message.body }}</p>
          <a
            v-for="file in item.files"
            :key="file.key"
            class="mr-2 text-xs text-primary underline"
            :href="file.url"
            :download="file.name"
            >{{ file.name }}</a
          >
          <ViewerDeliveryStatus :message="item.message" :delivery="item.delivery" recovery />
        </li>
      </ul>
    </template>
  </UModal>
</template>
