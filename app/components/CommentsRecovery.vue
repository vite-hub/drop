<script setup lang="ts">
const { entries } = useCommentsOutbox()
const open = ref(false)
const urls = fileUrls()
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
    v-if="entries.length || open"
    v-model:open="open"
    title="Unsent comments"
    description="Recover comments and replies even when the original page is unavailable. Discard only removes this browser’s copy."
  >
    <UButton
      v-if="entries.length"
      class="fixed bottom-3 left-3 z-40 shadow-sm"
      color="neutral"
      icon="i-mingcute-time-line"
      :label="`Unsent comments (${entries.length})`"
      size="sm"
      variant="outline"
    />
    <template #body>
      <p v-if="!items.length" class="text-muted">No unsent comments.</p>
      <ul v-else class="divide-y divide-default">
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
