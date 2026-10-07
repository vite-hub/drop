<script setup lang="ts">
import { MCP_LATEST, MCP_LEGACY } from "#shared/mcp"
import type { McpClient } from "~/utils/mcp-clients"

definePageMeta({ layout: "docs" })

const origin = useSiteOrigin()
const server = computed(() => `${origin.value}/mcp`)
const snippets = computed(() => mcpSnippets(server.value))
const clients = Object.keys(MCP_CLIENTS) as McpClient[]

// The MCP server's own catalog (tools, prompts, skill resources), so the docs never drift from it.
const { data: catalog } = await useFetch("/api/mcp", { key: "mcp-catalog", default: () => [] })
const tools = computed(() => catalog.value.map(item => ({ name: item.uri ?? item.name, description: item.description ?? item.title ?? "", kind: item.kind })))
</script>

<template>
  <DocsPage title="Connect an agent" lead="Agents reach Drop over MCP. They sign in through your browser once; there are no keys to paste. The Drop skill comes with the server.">
    <DocsSection id="add-the-server" title="Add the server">
      <p>Drop's MCP server is at <code>{{ server }}</code>. Add it to your client:</p>
      <template v-for="client in clients" :key="client">
        <h3>{{ MCP_CLIENTS[client] }}</h3>
        <AgentsCodeBlock :code="snippets[client]" />
        <p>{{ MCP_HINTS[client] }}</p>
      </template>
      <p>Signed in, the Agents page lists the clients you've connected, and disconnecting one revokes its access.</p>
    </DocsSection>

    <DocsSection id="sign-in" title="How sign-in works">
      <p>Drop is an OAuth 2.1 authorization server for its own MCP endpoint. When a client first connects:</p>
      <ol>
        <li><code>/mcp</code> answers <code>401</code> and points the client at <code>/.well-known/oauth-protected-resource/mcp</code>, which names Drop as the authorization server.</li>
        <li>The client registers itself (dynamic client registration) and opens Drop's consent page in your browser, with PKCE.</li>
        <li>You sign in with GitHub if you haven't, and allow the client.</li>
        <li>The client keeps a token that only works for this Drop's <code>/mcp</code>, and the agent acts as you. Drops it makes show the client's name, like "Claude Code".</li>
      </ol>
      <p>Clients that discover the issuer directly find it at <code>/.well-known/oauth-authorization-server/api/auth</code>.</p>
    </DocsSection>

    <DocsSection id="skill" title="The skill">
      <p>The <code>vitehub-drop</code> skill tells agents how to drop docs, publish apps, read feedback, and write documents people can review. It comes with the server through the MCP Skills extension (<code>skills/list</code> and <code>skill://</code> resources), so connected clients that support skills load it on their own.</p>
      <p>Agents that discover skills over HTTP find it at <code>/.well-known/agent-skills/index.json</code>, which follows <a href="https://github.com/cloudflare/agent-skills-discovery-rfc">Agent Skills Discovery</a> v0.2.0, and at the older <code>/.well-known/skills/</code>. Fetching Drop's home page with <code>Accept: text/markdown</code> returns the skill too.</p>
    </DocsSection>

    <DocsSection id="tools" title="Tools and prompts">
      <p>What the server offers, read from the server itself:</p>
      <div class="overflow-x-auto rounded-lg border border-default">
        <table class="table-fixed">
          <thead>
            <tr><th class="w-36 sm:w-44">Name</th><th>What it does</th><th class="hidden w-24 sm:table-cell">Kind</th></tr>
          </thead>
          <tbody>
            <tr v-for="tool in tools" :key="tool.name">
              <td class="font-mono text-xs break-words">{{ tool.name }}</td>
              <td>{{ tool.description }}</td>
              <td class="hidden font-mono text-xs sm:table-cell">{{ tool.kind }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>Every call runs as the person who allowed the client, with their role. New drops start private.</p>
    </DocsSection>

    <DocsSection id="code-images" title="Code images">
      <p><code>create_code_image</code> highlights code with Shiki and returns a framed image at a public URL that expires after five minutes. SVG works on every Drop. PNG is a Browser Run screenshot of the SVG, so only Drops on Cloudflare have it, drop.vitehub.dev included. There it's the default. On other hosts the tool renders SVG and says so in its description.</p>
    </DocsSection>

    <DocsSection id="protocol" title="Protocol">
      <p>Streamable HTTP at <code>/mcp</code>. Drop speaks MCP <code>{{ MCP_LATEST }}</code> and answers clients on {{ MCP_LEGACY.join(", ") }}. The server is <a href="https://github.com/nuxt-modules/mcp-toolkit">nitro-mcp-toolkit</a>, with one file per tool and prompt in <code>server/mcp/</code>.</p>
    </DocsSection>
  </DocsPage>
</template>
