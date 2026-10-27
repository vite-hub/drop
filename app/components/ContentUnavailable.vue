<script setup lang="ts">
import { contentUnavailable, contentUnavailableIcon } from "#shared/content-unavailable"
import "../../shared/content-unavailable.css"

const props = defineProps<{ status: number; path: string; waitingForReview?: boolean }>()
// Only failed views need the account lookup; successful shared views stay on their existing request path. Behind an
// auth proxy (read at runtime, as on /signin) signing in again only returns the same account. Both requests go at once.
const [{ data: me }, { data: method }] = await Promise.all([useMe(), useSignInMethod()])
const message = computed(() =>
  contentUnavailable(props.status, props.path, me.value?.email, props.waitingForReview, Boolean(method.value?.proxy)),
)
const reportTarget = computed(() => props.path.split("?")[0]!.replace(/^\/drops\/([^/]+)\/?$/, "/d/$1"))
</script>

<template>
  <div class="content-unavailable">
    <div class="content-unavailable-panel">
      <NuxtLink to="/" class="content-unavailable-brand"><DropMark class="content-unavailable-mark" />Drop</NuxtLink>
      <section class="content-unavailable-card" aria-labelledby="content-unavailable-title">
        <span class="content-unavailable-icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path :d="contentUnavailableIcon(status, waitingForReview)" />
          </svg>
        </span>
        <h1 id="content-unavailable-title" class="content-unavailable-title">{{ message.title }}</h1>
        <p class="content-unavailable-description">{{ message.description }}</p>
        <p v-if="message.email" class="content-unavailable-account">
          Signed in as <bdi>{{ message.email }}</bdi>
        </p>
        <nav class="content-unavailable-actions" aria-label="Content recovery">
          <NuxtLink class="content-unavailable-action" :to="message.action.to" :external="message.action.to === path">
            <UIcon
              v-if="message.action.to.startsWith('/signin')"
              name="i-simple-icons-github"
              class="size-4"
              aria-hidden="true"
            />
            {{ message.action.label }}
          </NuxtLink>
          <NuxtLink
            v-if="message.email && message.action.to !== '/drops'"
            class="content-unavailable-action content-unavailable-action-secondary"
            to="/drops"
            >My drops</NuxtLink
          >
        </nav>
      </section>
      <p class="content-unavailable-footer">
        <NuxtLink
          class="content-unavailable-report"
          aria-label="Report this link"
          :to="{ path: '/report', query: { target: reportTarget } }"
          >Report</NuxtLink
        >
      </p>
    </div>
  </div>
</template>
