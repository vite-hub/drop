<script setup lang="ts">
// A comment's words, each "@Name" of someone in this Drop marked, and yours more than the rest. Signed-out readers
// can't list the people, so they read the plain "@Name".
const props = defineProps<{ text: string }>()
const { people, me } = usePeople()
const mine = computed(() => people.value.find((person) => person.id === me.value)?.name)
const parts = computed(() =>
  mentionParts(
    props.text,
    people.value.map((person) => person.name),
  ),
)
</script>

<template>
  <p>
    <template v-for="(part, index) in parts" :key="index">
      <span
        v-if="part.mention"
        class="rounded-sm px-0.5 font-medium text-highlighted"
        :class="part.mention === mine ? 'bg-warning/25' : 'bg-accented/60'"
        >{{ part.text }}</span
      >
      <template v-else>{{ part.text }}</template>
    </template>
  </p>
</template>
