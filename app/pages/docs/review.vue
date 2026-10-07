<script setup lang="ts">
import { PLAN_AUTHORING_GUIDE } from "#shared/plan-runtime"

definePageMeta({ layout: "docs" })

const app = `publish_app({\n  name: "Launch board",\n  files: { "index.html": "…", "app.js": "…", "data.json": "[…]" }\n})`
</script>

<template>
  <DocsPage title="Review and share" lead="Every drop opens full screen with its comments beside it. It stays private until you share it, and every version is kept.">
    <DocsSection id="docs" title="Docs">
      <p>Agents call <code>create_doc</code> with Markdown, or with a self-contained HTML page (<code>format: "html"</code>). People can also upload a file or start a doc from the Drops page.</p>
      <p>Markdown renders as a clean document with tables, task lists, callouts, and Mermaid diagrams. HTML renders as-is, scripts included, in a sandbox with an opaque origin and no access to your session. For rich HTML plans, agents follow these rules:</p>
      <ul>
        <li v-for="rule in PLAN_AUTHORING_GUIDE.split('\n')" :key="rule">{{ rule }}</li>
      </ul>
      <p>Docs are limited to 4 MiB.</p>
    </DocsSection>

    <DocsSection id="apps" title="Apps">
      <p>Agents publish apps with <code>publish_app</code>: files keyed by path, with an <code>index.html</code>. Relative links, stylesheets, ES modules, and <code>fetch("data.json")</code> resolve like on any static host.</p>
      <AgentsCodeBlock :code="app" />
      <p>An app holds up to 200 files and 4 MiB.</p>
    </DocsSection>

    <DocsSection id="comments" title="Comments">
      <p>Select text, or click an image to zoom and pick a spot. Comments stay anchored to what they quote, per page for apps. A comment's author, the drop's owner, editors, and admins can resolve it once it's addressed.</p>
      <p>Agents read the open comments with <code>list_comments</code>, or with the <code>address_feedback</code> prompt, which reads the drop and its comments together. People can copy them as Markdown with <strong>Copy feedback for your agent</strong>.</p>
    </DocsSection>

    <DocsSection id="sharing" title="Sharing">
      <p>A drop is private until its owner shares it. A shared link grants one level, and each includes the one before:</p>
      <ul>
        <li><strong>Can view</strong>: open the drop and its versions.</li>
        <li><strong>Can comment</strong>: add comments too.</li>
        <li><strong>Can edit</strong>: change the doc or the app's files and publish a new version.</li>
      </ul>
      <p>The owner, editors, and admins can always open a drop. Sharing applies to every version of it.</p>
    </DocsSection>

    <DocsSection id="versions" title="Versions">
      <p>To publish the next version of a doc, an agent calls <code>create_doc</code> with <code>supersedes</code> set to the previous drop's id, or puts <code>supersedes: &lt;id&gt;</code> in the front matter. For an app, it calls <code>publish_app</code> with the app's <code>id</code>. The new version keeps the old one's sharing, and the old one stays one click away in history.</p>
      <p>Any id from the chain works: the new version always lands on top of the latest. If someone else publishes at the same moment, the call fails with a conflict, and the agent reads the latest version and publishes again.</p>
    </DocsSection>

    <DocsSection id="edit" title="Edit in place">
      <p>People with edit access change a doc in a Notion-like editor, or an app's files in a code view, right where they review it. Saving publishes a new version.</p>
    </DocsSection>
  </DocsPage>
</template>
