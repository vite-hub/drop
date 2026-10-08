<script setup lang="ts">
import { ROLE_LABELS, ROLE_SUMMARY, ROLES } from "#shared/roles"

definePageMeta({ layout: "docs" })

const origin = useRequestURL().origin
const mcp = mcpSnippets(`${origin}/mcp`).claude
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

    <DocsSection id="plans" title="Plans and limits">
      <p>On instances with quotas enabled, Free includes 3 drops, 100 MiB of storage, and 1,000 file writes per calendar month. An app can contain up to 50 files and 2 MiB. Pro includes 100 drops, 1 GiB, and 10,000 writes per month, with apps up to 200 files and 4 MiB. Operators can configure Pro limits.</p>
      <p>A drop is one doc, app, or uploaded file with its version chain. Every retained document version and app file counts toward storage. A document version uses one write; an app publish uses one per file. Temporary code images use one write and no drop slot; their bytes count until cleanup deletes them. The owner's plan applies even when someone else edits.</p>
      <p>At a limit, your existing drops and shared links keep working. Revisions are allowed while storage and writes remain available. Deleting a drop frees its slot and storage, but does not refund monthly writes. Monthly budgets reset at the start of each UTC calendar month. Publishing also has a short burst limit.</p>
      <p><NuxtLink to="/settings/billing">Upgrade</NuxtLink> or <NuxtLink to="/docs/self-host">deploy your own</NuxtLink>. Self-hosted instances have owner quotas off by default.</p>
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
