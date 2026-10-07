<script setup lang="ts">
import { ROLE_LABELS, ROLE_SUMMARY, ROLES } from "#shared/roles"

definePageMeta({ layout: "docs" })

const origin = useSiteOrigin()
const mcp = computed(() => mcpSnippets(`${origin.value}/mcp`).claude)
</script>

<template>
  <DocsPage title="Introduction" lead="Drop is where your agents put their plans, docs, and small apps for you to review. You comment on the exact spot, share the ones worth sharing, and the agent reads your feedback and drops the next version.">
    <DocsSection id="how-it-works" title="How it works">
      <ol>
        <li><strong>Agents drop their work</strong> over MCP: a plan in Markdown, an HTML report, or a small static app made of files.</li>
        <li><strong>Every drop starts private.</strong> Only its owner, and the workspace's editors and admins, can open it.</li>
        <li><strong>People review it</strong> full screen. Select text or click a spot in an image to comment. The owner shares a link that can view, comment, or edit.</li>
        <li><strong>The agent reads the open comments</strong> and drops the next version. Older versions stay in history.</li>
      </ol>
    </DocsSection>

    <DocsSection id="get-started" title="Get started">
      <ol>
        <li>Sign in at <a :href="origin">{{ origin.replace(/^https?:\/\//, "") }}</a> with GitHub. Anyone with a GitHub account can.</li>
        <li>
          <p>Add Drop's MCP server to your agent. With Claude Code:</p>
          <AgentsCodeBlock :code="mcp" />
          <p>The first time it connects, the client opens Drop in your browser. Allow it, and the agent acts as you. <NuxtLink to="/docs/agents">Connect an agent</NuxtLink> has the setup for Codex, Cursor, VS Code, and other clients.</p>
        </li>
        <li>Ask your agent to drop a plan, for example "Write a plan for the billing migration and drop it for review." It answers with the review link.</li>
      </ol>
    </DocsSection>

    <DocsSection id="drops" title="What a drop is">
      <p>A drop is something an agent, or you, published for review:</p>
      <ul>
        <li>A <strong>doc</strong>: Markdown, or a self-contained HTML page. Markdown renders with tables, task lists, callouts, and Mermaid diagrams. HTML runs as-is, scripts included, in a sandbox.</li>
        <li>An <strong>app</strong>: a folder of static files with an <code>index.html</code>, like a prototype or a dashboard.</li>
        <li>A <strong>file</strong> you upload: an image, a PDF, a log.</li>
      </ul>
      <p>Every drop opens full screen, keeps every version, and has its own link. <NuxtLink to="/docs/review">Review and share</NuxtLink> covers comments, sharing, and versions.</p>
    </DocsSection>

    <DocsSection id="roles" title="Roles">
      <p>Everyone who signs in joins as a Member. The GitHub accounts a Drop's owner lists as admins join as Admin, and admins change roles on the Members page.</p>
      <div class="overflow-x-auto rounded-lg border border-default">
        <table>
          <thead><tr><th>Role</th><th>What they can do</th></tr></thead>
          <tbody>
            <tr v-for="role in ROLES" :key="role"><td>{{ ROLE_LABELS[role] }}</td><td>{{ ROLE_SUMMARY[role] }}</td></tr>
          </tbody>
        </table>
      </div>
    </DocsSection>

    <DocsSection id="your-own" title="Use ours or run your own">
      <p><a href="https://drop.vitehub.dev">drop.vitehub.dev</a> is one Drop anyone can use. Drop is open source and built on <a href="https://vitehub.dev">ViteHub</a>, so you can run your own on Cloudflare, Vercel, Netlify, Deno Deploy, or a server of yours. <NuxtLink to="/docs/self-host">Host it yourself</NuxtLink> compares them.</p>
    </DocsSection>
  </DocsPage>
</template>
