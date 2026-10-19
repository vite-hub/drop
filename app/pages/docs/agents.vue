<script setup lang="ts">
import { MCP_LATEST, MCP_LEGACY } from "#shared/mcp"
import type { McpClient } from "~/utils/mcp-clients"

definePageMeta({ layout: "docs" })

const server = `${useRequestURL().origin}/mcp`
const snippets = mcpSnippets(server)
const clients = Object.keys(MCP_CLIENTS) as McpClient[]

// The MCP server's own catalog (tools, prompts, skill resources), so the docs never drift from it.
const { data: catalog } = await useApi("/api/mcp", { key: "mcp-catalog", default: () => [] })
const tools = computed(() => catalog.value.map(item => ({ name: item.uri ?? item.name, description: item.description ?? item.title ?? "", kind: item.kind })))
</script>

<template>
  <DocsPage title="Connect an agent" lead="Agents reach Drop over MCP. They sign in through your browser once; there are no keys to paste. Drop's skills come with the server.">
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

    <DocsSection id="skill" title="Skills">
      <p>Drop's skills come with the server through the MCP Skills extension (<code>skills/list</code> and <code>skill://</code> resources), so connected clients that support skills load them on their own:</p>
      <ul>
        <li><code>vitehub-drop</code> tells agents how to drop docs, publish apps, read feedback, and write documents people can review.</li>
        <li><code>pr-evidence</code> builds the before and after for a pull request that changes something visible: screenshots with hand-drawn marks and notes, dropped in Drop, with a snippet for the description.</li>
        <li><code>handoff</code> sums up the current conversation in a doc and drops it, so another agent, a colleague, or a new session picks the work up from the link.</li>
        <li><code>show-me</code> explains the current topic with diagrams and short docs in Drop. Agents use it only when you ask for it.</li>
      </ul>
      <p>The <strong>Skills</strong> page lists the skills this Drop serves, each with its source on GitHub. An admin can switch a skill off there for everyone; every way of getting skills then leaves it out.</p>
      <p>Agents that discover skills over HTTP find them at <code>/.well-known/agent-skills/index.json</code>, which follows <a href="https://github.com/cloudflare/agent-skills-discovery-rfc">Agent Skills Discovery</a> v0.2.0, and at the older <code>/.well-known/skills/</code>. Fetching Drop's home page with <code>Accept: text/markdown</code> returns the <code>vitehub-drop</code> skill.</p>
      <p>Agents that start from the web read <code>/llms.txt</code>, an index of everything below, and <code>/agents.md</code>, a start guide with this Drop's limits and the skill. Every docs page is also Markdown at its path plus <code>.md</code>, such as <code>/docs/agents.md</code>.</p>
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
      <p>Every call runs as the person who allowed the client, with their role. New drops start with the Drop's default share: Team on a team Drop, Only me on a personal one. Agents make a drop public only when you ask, or when it's meant for people outside, like pull request assets.</p>
    </DocsSection>

    <DocsSection id="folders" title="Where agents publish">
      <p>Before publishing something new, an agent calls <code>list_folders</code>. It lists every folder you can publish into, the team's first, each with its path and description. The agent passes the folder whose description fits to <code>publish</code> and follows what the description asks, such as how to name the doc. When none fits, it publishes at the top.</p>
      <p>So write a folder's description for the agent too: what goes in it, how to name it, and how to lay it out. Agents take descriptions as guidance about where things go, not as instructions for anything else. An agent can describe your own folders with <code>create_folder</code> or <code>update_drop</code> and <code>description</code>; admins describe the team's folders in the browser.</p>
    </DocsSection>

    <DocsSection id="code-images" title="Code images">
      <p><code>create_code_image</code> highlights code with Shiki and returns a framed image at a public URL that expires after five minutes. SVG works on every Drop. PNG is a Browser Run screenshot of the SVG, so only Drops on Cloudflare have it, drop.vitehub.dev included. There it's the default. On other hosts the tool renders SVG and says so in its description.</p>
    </DocsSection>

    <DocsSection id="protocol" title="Protocol">
      <p>Streamable HTTP at <code>/mcp</code>. Drop speaks MCP <code>{{ MCP_LATEST }}</code> and answers clients on {{ MCP_LEGACY.join(", ") }}. The server is <a href="https://github.com/nuxt-modules/mcp-toolkit">nitro-mcp-toolkit</a>, with one file per tool and prompt in <code>server/mcp/</code>.</p>
    </DocsSection>
  </DocsPage>
</template>
