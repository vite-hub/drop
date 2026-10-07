<script setup lang="ts">
import { MCP_LATEST, MCP_LEGACY } from "#shared/mcp"
import { PLAN_AUTHORING_GUIDE } from "#shared/plan-runtime"

definePageMeta({ layout: "dashboard", middleware: "auth" })
useSeoMeta({ title: "Docs" })

const origin = useRequestURL().origin

const SECTIONS = [
  ["overview", "Overview"],
  ["connect", "Connect an agent"],
  ["mcp", "MCP server"],
  ["docs", "Drop a doc"],
  ["upload", "Upload API"],
  ["apps", "Drop an app"],
  ["review", "Comments and review"],
  ["sharing", "Sharing and access"],
  ["self-host", "Self-host"],
] as const

// The MCP server's own catalog (tools, prompts, skill resources), so the docs never drift from it.
const { data: catalog } = await useFetch("/api/mcp", { key: "mcp-catalog", default: () => [] })
const tools = computed(() => catalog.value.map(item => ({ name: item.uri ?? item.name, description: item.description ?? item.title ?? "", args: item.kind })))

const code = "rounded bg-elevated px-1 py-0.5 font-mono text-[12px] text-highlighted"
const link = "text-highlighted underline underline-offset-4"

const snippets = {
  mcp: `claude mcp add --transport http --scope user drop ${origin}/mcp \\\n  --header "Authorization: Bearer $DROP_API_KEY"`,
  upload: `curl -fsS -H "x-api-key: $DROP_API_KEY" -F file=@plan.md ${origin}/api/files`,
  uploadResponse: `{\n  "id": "3f2c…",\n  "url": "${origin}/f/8a1e….md",\n  "page": "${origin}/d/3f2c…",\n  "visibility": "private",\n  "version": 1\n}`,
  revise: `curl -fsS -H "x-api-key: $DROP_API_KEY" \\\n  -F file=@plan.md -F supersedes=3f2c… ${origin}/api/files`,
  frontMatter: `---\nsupersedes: 3f2c…\n---\n\n# Plan, revised`,
  app: `curl -fsS -H "x-api-key: $DROP_API_KEY" -H "content-type: application/json" \\\n  -d '{ "name": "Launch board", "files": { "index.html": "…", "app.js": "…", "data.json": "[…]" } }' \\\n  ${origin}/api/apps`,
  clone: "git clone https://github.com/vite-hub/drop my-drop\ncd my-drop && pnpm install",
  env: `# GitHub OAuth app, callback ${origin}/api/auth/callback/github\nGITHUB_CLIENT_ID=\nGITHUB_CLIENT_SECRET=\n# openssl rand -base64 32\nBETTER_AUTH_SECRET=\n# Your GitHub user id (gh api users/<login> --jq .id); comma-separate several admins\nDROP_ADMINS=\n# wrangler d1 create vitehub-drop\nCLOUDFLARE_D1_DATABASE_ID=\nCLOUDFLARE_D1_DATABASE_NAME=vitehub-drop`,
}
</script>

<template>
  <PageShell id="docs" title="Docs" description="How agents drop docs and apps, and how you review and share them." wide>
    <div class="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_11rem]">
      <div class="space-y-8">
        <DocsSection id="overview" title="Overview">
          <p>A <strong>drop</strong> is something an agent (or you) published for review: a <strong>doc</strong> (Markdown or HTML) or an <strong>app</strong> (a folder of static files). Every drop starts private, renders full screen, and keeps every version.</p>
          <p>You share a drop with a link, collect comments on the exact text or image, and hand the feedback back to the agent, which drops the next version.</p>
        </DocsSection>

        <DocsSection id="connect" title="Connect an agent">
          <p>Both ways start on the <NuxtLink :class="link" to="/agents">Agents</NuxtLink> page:</p>
          <ul class="list-disc space-y-1 pl-5">
            <li><strong>MCP</strong>: register Drop's server in Claude Code, Codex, Cursor, or VS Code. Recommended.</li>
            <li><strong>API key + skill</strong>: <code :class="code">npx skills add {{ origin }}</code> and a key in <code :class="code">DROP_API_KEY</code>.</li>
          </ul>
          <p>Name each key after the agent that uses it, like “Claude Code” or “Codex”. Drops made with a key show that name and the agent's logo. <strong>Agent Auth</strong>, where each agent gets its own identity and you approve what it may do, is coming.</p>
        </DocsSection>

        <DocsSection id="mcp" title="MCP server">
          <p>Streamable HTTP at <code :class="code">{{ origin }}/mcp</code>. Speaks MCP <code :class="code">{{ MCP_LATEST }}</code> and answers clients on {{ MCP_LEGACY.join(", ") }}. Authenticate with a Drop API key: <code :class="code">Authorization: Bearer drop_…</code>.</p>
          <p>It also serves the <code :class="code">vitehub-drop</code> skill through the MCP Skills extension (<code :class="code">skills/list</code>, <code :class="code">skill://</code> resources), and at <code :class="code">/.well-known/agent-skills/</code> for agents that discover skills over HTTP.</p>
          <AgentsCodeBlock :code="snippets.mcp" />
          <div class="overflow-hidden rounded-lg border border-default">
            <table class="w-full table-fixed text-left text-sm">
              <thead>
                <tr class="border-b border-default text-xs text-muted">
                  <th class="w-32 px-3 py-2 font-medium sm:w-44">Name</th>
                  <th class="px-3 py-2 font-medium">What it does</th>
                  <th class="hidden w-24 px-3 py-2 font-medium sm:table-cell">Kind</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="tool in tools" :key="tool.name">
                  <td class="px-3 py-2.5 align-top font-mono text-xs break-words text-highlighted">{{ tool.name }}</td>
                  <td class="px-3 py-2.5 align-top text-muted">{{ tool.description }}</td>
                  <td class="hidden px-3 py-2.5 align-top font-mono text-xs text-muted sm:table-cell">{{ tool.args }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </DocsSection>

        <DocsSection id="docs" title="Drop a doc">
          <p>Markdown renders as a clean document with tables, task lists, callouts, and Mermaid diagrams. HTML renders as-is, scripts included, in a sandbox with no access to your session.</p>
          <p>To publish a revision, call <code :class="code">create_doc</code> with <code :class="code">supersedes</code>, or add <code :class="code">supersedes:</code> to the front matter. For rich HTML docs, follow the template:</p>
          <ul class="list-disc space-y-1 pl-5">
            <li v-for="rule in PLAN_AUTHORING_GUIDE.split('\n')" :key="rule">{{ rule }}</li>
          </ul>
        </DocsSection>

        <DocsSection id="upload" title="Upload API">
          <p>Without MCP, agents upload one file per request to <code :class="code">POST /api/files</code> with their key in <code :class="code">x-api-key</code>. Markdown and HTML become docs; images and other files are served as they are. Up to 4 MiB per file.</p>
          <AgentsCodeBlock :code="snippets.upload" />
          <p>It returns the new drop. <code :class="code">url</code> serves the raw file under <code :class="code">/f/</code> (old <code :class="code">/i/</code> links redirect there), and <code :class="code">page</code> opens it for review.</p>
          <AgentsCodeBlock :code="snippets.uploadResponse" />
          <p>To publish the next version, send <code :class="code">supersedes</code> with the previous drop's id, as a form field or in the front matter. The old version stays in history.</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <AgentsCodeBlock :code="snippets.revise" />
            <AgentsCodeBlock :code="snippets.frontMatter" />
          </div>
        </DocsSection>

        <DocsSection id="apps" title="Drop an app">
          <p>Agents publish apps through MCP (<code :class="code">publish_app</code>) or <code :class="code">POST /api/apps</code> with <code :class="code">{ name, files, id? }</code>. Send files keyed by path with an <code :class="code">index.html</code>; relative links, stylesheets, ES modules, and <code :class="code">fetch("data.json")</code> resolve like on any static host.</p>
          <AgentsCodeBlock :code="snippets.app" />
          <p>Publishing with an existing <code :class="code">id</code> creates the next version. People with edit access can change files in the browser and publish too. Up to 200 files and 4 MiB per app.</p>
        </DocsSection>

        <DocsSection id="review" title="Comments and review">
          <p>Select text, or click an image to zoom and pick a spot. Comments stay anchored to what they quote, per page for apps.</p>
          <p>Agents read open comments with <code :class="code">list_comments</code>. People can copy them as Markdown with <strong>Copy Feedback</strong>.</p>
        </DocsSection>

        <DocsSection id="sharing" title="Sharing and access">
          <p>A drop is private until you share it. A shared link grants one level, and each includes the one before: <strong>Can view</strong>, <strong>Can comment</strong>, <strong>Can edit</strong>. Editors publish new versions; the old ones stay in history.</p>
        </DocsSection>

        <DocsSection id="self-host" title="Self-host">
          <p>Drop is a ViteHub template. Fork it and deploy it to your Cloudflare account.</p>
          <AgentsCodeBlock :code="snippets.clone" />
          <p>Create a GitHub OAuth app with the callback URL <code :class="code">{{ origin }}/api/auth/callback/github</code>, then fill in <code :class="code">.env</code>:</p>
          <AgentsCodeBlock :code="snippets.env" />
          <p>Deploy with <code :class="code">pnpm run deploy</code>. It builds, applies the D1 migrations, and ships the Worker.</p>
          <p><strong>Anyone with a GitHub account can sign in</strong> and joins as a Member. The accounts in <code :class="code">DROP_ADMINS</code> join as Admin, and admins promote people on <NuxtLink :class="link" to="/members">Members</NuxtLink>. To change sign-in providers, edit <code :class="code">server/auth.ts</code> (Better Auth).</p>
        </DocsSection>
      </div>

      <nav class="hidden lg:block" aria-label="On this page">
        <div class="sticky top-8 space-y-1">
          <p class="label-mono mb-2">On this page</p>
          <a v-for="[id, title] in SECTIONS" :key="id" class="block py-0.5 text-[13px] text-muted transition-colors hover:text-highlighted" :href="`#${id}`">{{ title }}</a>
        </div>
      </nav>
    </div>
  </PageShell>
</template>
