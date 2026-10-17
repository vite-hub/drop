<script setup lang="ts">
import { PLAN_AUTHORING_GUIDE } from "#shared/plan-runtime"

definePageMeta({ layout: "docs" })

const app = `publish({\n  title: "Launch board",\n  files: { "index.html": "…", "app.js": "…", "data.json": "[…]" },\n  note: "First board with the launch checklist",\n  lifetime: "temporary"\n})`
</script>

<template>
  <DocsPage title="Review and share" lead="Every drop opens full screen with its comments beside it. It stays private until you share it. Docs keep earlier versions. Apps keep only their latest file set.">
    <DocsSection id="docs" title="Docs">
      <p>Agents call <code>publish</code> with <code>markdown</code>, a self-contained HTML page (<code>html</code>), or any file up to 4 MiB (<code>file</code>), such as a screenshot. People can also upload a file from the Drops page.</p>
      <p>Images a doc embeds from Drop belong to the doc: whoever can open the doc sees them, and they live and go to the Trash with it.</p>
      <p>Markdown renders as a clean document with tables, task lists, callouts, and Mermaid diagrams. HTML renders as-is, scripts included, in a sandbox with no access to your session. Drops that set up a separate domain for apps give pages their own origin, so storage and history work there too. For rich HTML plans, agents follow these rules:</p>
      <ul>
        <li v-for="rule in PLAN_AUTHORING_GUIDE.split('\n')" :key="rule">{{ rule }}</li>
      </ul>
      <p>Docs are limited to 4 MiB.</p>
    </DocsSection>

    <DocsSection id="apps" title="Apps">
      <p>Agents publish apps with <code>publish</code> and <code>files</code>: files keyed by path, with an <code>index.html</code>. Relative links, stylesheets, ES modules, and <code>fetch("data.json")</code> resolve like on any static host.</p>
      <AgentsCodeBlock :code="app" />
      <p>An app holds up to 200 files and 4 MiB.</p>
    </DocsSection>

    <DocsSection id="comments" title="Comments">
      <p>Select text, or click an image to zoom and click a spot or drag an area. To mark part of a page, choose <strong>Comment on an area</strong> (or press <kbd>R</kbd>) and drag a rectangle. Comments stay anchored to what they point at, per page for apps. A comment's author, the drop's owner, editors, and admins can resolve it once it's addressed.</p>
      <p>Agents read the open comments with <code>read_drop</code>, or with the <code>address_feedback</code> prompt, and mark the ones they addressed resolved when they publish the next version. People can copy them as Markdown with <strong>Copy feedback for your agent</strong>.</p>
    </DocsSection>

    <DocsSection id="sharing" title="Sharing">
      <p>A drop is private until its owner shares it. A shared link grants one level:</p>
      <ul>
        <li><strong>Can view</strong>: open the drop and its versions.</li>
        <li><strong>Can comment</strong>: view and add comments.</li>
        <li><strong>Can edit</strong>: comment, and edit a Markdown doc together after signing in. Offered for Markdown docs only.</li>
      </ul>
      <p>The owner, editors, and admins can open available drops. Sharing applies to every doc version.</p>
    </DocsSection>

    <DocsSection id="edit" title="Edit together">
      <p>People who may edit a Markdown doc open it with <strong>Edit</strong> and change it together in a Notion-like editor: type <code>/</code> for blocks, select text to format it. Everyone in the doc sees the others' avatars and cursors, and each keystroke reaches them at once.</p>
      <p>The draft lives on its own until someone presses <strong>Publish</strong>, which makes it the next version. Closing the editor keeps the draft for whoever opens it next. If an agent publishes while people edit, Drop asks before putting the draft on top. Only the latest version of a doc can be edited, and docs that use Comark components stay read-only.</p>
    </DocsSection>

    <DocsSection id="versions" title="Versions">
      <p>To publish the next version, an agent calls <code>publish</code> with <code>previous</code> set to the drop's id, or puts <code>supersedes: &lt;id&gt;</code> in a doc's front matter. Every version an agent publishes carries a note saying what changed, shown in the version history. Sharing and lifetime stay the same unless the agent changes them. Earlier doc versions stay in history. An app keeps only its latest file set: the next version starts from it, the agent sends just the files it changed, and a file is deleted only when the agent names it in <code>removes</code>.</p>
      <p>Apps and HTML pages report what goes wrong while people have them open: uncaught errors, rejected promises, <code>console.error</code>, and files that fail to load. The agent reads them with <code>read_drop</code> and fixes them in the next version. When it publishes, Drop also warns it about scripts, styles, images, and links that point at files the app doesn't have.</p>
      <p>Agents publish most versions: people comment, and the agent addresses the comments in the next version. The owner's agents can publish, and so can agents of the workspace's editors and admins. People who may edit a Markdown doc can also publish one from the live editor.</p>
      <p>Any id from the chain works: the new version always lands on top of the latest. If someone else publishes at the same moment, the call fails with a conflict, and the agent reads the latest version and publishes again.</p>
    </DocsSection>

    <DocsSection id="expiry" title="Lifetime and Trash">
      <p>Whoever publishes a drop says how long it should live. Agents choose when they publish; you can change it in the drop's Details panel.</p>
      <ul>
        <li><strong>Temporary</strong>: prototypes, spikes, one-off answers. Lives 14 days after anyone last opened it.</li>
        <li><strong>Review</strong>: plans and docs going through feedback. Lives 30 days after anyone last opened it.</li>
        <li><strong>Keep</strong>: pull request assets and anything linked from somewhere that lasts. Never expires. An agent that keeps a drop has to say why, and you see the reason.</li>
      </ul>
      <p>Each visit starts the window again for every version:</p>
      <ul>
        <li>You, or anyone in the workspace, opening it while signed in.</li>
        <li>An agent reading it with <code>read_drop</code>, or publishing a new version.</li>
        <li>Someone reading a shared link in a browser, or opening its raw file directly. Link previews in Slack, Discord, or X, crawlers, and images embedded on other sites don't count.</li>
      </ul>
      <p>A drop that expires, or that you or your agent delete, goes to the <strong>Trash</strong>. Its links stop working. For 15 days you can restore it from the Trash on the Drops page; then it's deleted with its comments and files. You can also delete it for good, or empty the Trash, yourself. Agents can move drops to the Trash and restore them, but only people delete for good.</p>
      <p>Images and files a doc embeds from Drop belong to that doc: whoever can open the doc can see them, and they live and go to the Trash with it. A Drop's admin can change the 30 days, or allow only admins to keep drops.</p>
    </DocsSection>
  </DocsPage>
</template>
