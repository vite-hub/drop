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
        <li><strong>Drops start with their owner, or with the team.</strong> On a personal Drop, like drop.vitehub.dev, a new drop is Only me: its owner and the admins open it. On a Drop a team runs for itself, new drops start shared with the Team.</li>
        <li><strong>People review it</strong> full screen. Select text or click a spot in an image to comment. The owner shares it with the team, who can also edit a Markdown doc together, or with anyone who has a public link.</li>
        <li><strong>The agent reads the open comments</strong> and drops the next version. Older doc versions stay in history. Apps keep only their latest file set.</li>
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
      <p>Every drop opens full screen and has its own link. Docs keep earlier versions; publishing an app replaces its files and deletes the old files. Each drop has a <NuxtLink to="/docs/review#expiry">lifetime</NuxtLink>: one nobody opens for a while goes to the Trash, unless it's kept. <NuxtLink to="/docs/review">Review and share</NuxtLink> covers comments, sharing, versions, lifetimes, and the Trash, and <NuxtLink to="/docs/features">Features</NuxtLink> shows each part of Drop with a screenshot.</p>
    </DocsSection>

    <DocsSection id="plans" title="Plans and limits">
      <p>Quotas are off unless the operator turns them on. When they're on, everyone in the Drop gets the same plan, set in the environment. Free includes 50 drops, 100 MiB of storage, and 1,000 file writes per calendar month. An app can contain up to 50 files and 2 MiB. Pro includes 100 drops, 1 GiB, and 10,000 writes per month, with apps up to 200 files and 4 MiB. Unlimited has no owner limits.</p>
      <p>A drop is one doc, app, or uploaded file with its version chain. Every retained document version and app file counts toward storage. A document version uses one write; an app publish uses one per file. Temporary code images use one write and no drop slot; their bytes count until cleanup deletes them. The owner's plan applies even when someone else edits.</p>
      <p>At a limit, your existing drops and shared links keep working. Revisions are allowed while storage and writes remain available. Moving a drop to the Trash frees its slot; its storage is freed when it's deleted for good, 15 days later or when you empty the Trash. Files a doc embeds don't take a slot. Deleting never refunds monthly writes. Monthly budgets reset at the start of each UTC calendar month. Publishing also has a short burst limit.</p>
      <p>Operators set <code>DROP_QUOTAS=true</code> to turn quotas on and <code>DROP_DEFAULT_PLAN</code> to <code>free</code>, <code>pro</code>, or <code>unlimited</code>; <code>DROP_PRO_DROPS</code>, <code>DROP_PRO_BYTES</code>, and <code>DROP_PRO_WRITES</code> change the Pro limits. Like every Drop setting, they're read at runtime, so a restart applies them. For other limits, <NuxtLink to="/docs/self-host">deploy your own</NuxtLink>.</p>
    </DocsSection>

    <DocsSection id="roles" title="Roles">
      <p>Everyone who signs in joins as a Member. The people whose emails the operator lists in <code>DROP_ADMINS</code> are Admins, whichever way they sign in. Roles come from that list, not from the Members page, where admins ban and unban members.</p>
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
