<script setup lang="ts">
import { PLAN_AUTHORING_GUIDE } from "#shared/plan-runtime"

definePageMeta({ layout: "docs" })

const app = `publish({\n  title: "Launch board",\n  files: { "index.html": "…", "app.js": "…", "data.json": "[…]" },\n  note: "First board with the launch checklist",\n  lifetime: "temporary"\n})`
</script>

<template>
  <DocsPage title="Review and share" lead="Every drop opens full screen with its comments beside it. Its share setting decides who else opens it. Docs keep earlier versions. Apps keep only their latest file set.">
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

    <DocsSection id="folders" title="Folders">
      <p>A folder keeps drops that belong together, like the screenshots of one change and the doc about them. Create one with <strong>New › Folder</strong> on the Drops page or in a folder, or an agent calls <code>create_folder</code> and then <code>publish</code> with <code>folder</code>. Folders hold any drop, other folders included, up to 8 levels deep. Move a drop with <strong>Move to Folder</strong> in its menu or its Details panel.</p>
      <p>A folder works like one drop for sharing and lifetime. Sharing it shares everything inside, and one drop inside can still be shared wider on its own. Everything in it lives as long as the folder, and goes to the Trash and comes back with it. Folders don't count toward your plan's drops; the drops in them do.</p>
      <p>Every folder has a description, under <strong>What goes here</strong>: what belongs in it and how to name and write it, up to 2,000 characters. For example, "Notes from calls, one doc per meeting, named YYYY-MM-DD-topic. Start with who was there, then decisions, then action items." Agents read the descriptions with <code>list_folders</code> before they publish something new, put it in the folder that fits, and follow what the description asks. You or your agent describe your own folders.</p>
      <p>On a team Drop, admins also make the team's folders, with the team's folder switch under <strong>New › Folder</strong>, and write their descriptions. Everyone on the team and their agents add drops to them; each drop stays its publisher's and counts against their plan. Team folders never expire and can't be Only me. Only admins rename, describe, share, or trash them, or add subfolders. Anyone on the team can move a drop in a team folder to the Trash from the browser; it goes to its owner's Trash, where the owner or an admin restores it.</p>
      <p>Searching on the Drops page looks inside every folder. Agents search one folder and everything below it with <code>list_drops</code> and <code>folder</code>.</p>
    </DocsSection>

    <DocsSection id="comments" title="Comments">
      <p>Select text, or click an image to zoom and click a spot or drag an area. To mark part of a page, choose <strong>Comment on an area</strong> (or press <kbd>R</kbd>) and drag a rectangle. Comments stay anchored to what they point at, per page for apps. A comment's author, the drop's owner, and admins can resolve it once it's addressed.</p>
      <p>Click a comment's pin to open its thread and reply. Anyone who can comment can reply, and resolving a comment closes its whole thread. <strong>Copy link</strong> in a thread gives a link that opens the drop with that thread showing.</p>
      <p>Agents read the open comments with <code>read_drop</code>, or with the <code>address_feedback</code> prompt, and mark the ones they addressed resolved when they publish the next version. They read each thread too, and can answer in it with <code>reply</code>. People can copy them as Markdown with <strong>Copy feedback for your agent</strong>.</p>
      <p>To comment on a running website instead, such as a preview deploy, see <NuxtLink to="/docs/sites">Review a live site</NuxtLink>.</p>
    </DocsSection>

    <DocsSection id="sharing" title="Sharing">
      <p>Each drop has one share setting, which applies to every doc version:</p>
      <ul>
        <li><strong>Only me</strong>: the owner and the Drop's admins. The owner's connected agents can still read it.</li>
        <li><strong>Team</strong>: everyone signed in to this Drop opens it and comments. Team Drops only.</li>
        <li><strong>Team can edit</strong>: the team also edits a Markdown doc, or the Markdown in a folder, together in the browser. Agents never edit through it. Team Drops only.</li>
        <li><strong>Public link</strong>: anyone with the link opens it, no sign-in needed. Signed-in people comment.</li>
        <li><strong>Public, anyone comments</strong>: anyone with the link opens it and comments, guests included.</li>
      </ul>
      <p>On a personal Drop, like drop.vitehub.dev, new drops start Only me and there is no Team option. <strong>Shared with me</strong> lists the public links others shared that you opened while signed in. On a team Drop, new drops start shared with the Team, and the <strong>Team</strong> tab lists the team's folders, then teammates' drops shared with the team.</p>
      <p>A public link stays open for a set number of days: 7 on a team Drop and no limit on a personal one, unless the operator changes it. When it closes, the drop falls back to Team on a team Drop, or Only me on a personal one. Picking Public again starts the window over. A drop in a folder takes the widest share on its path.</p>
    </DocsSection>

    <DocsSection id="edit" title="Edit together">
      <p>People who may edit a Markdown doc open it with <strong>Edit</strong> and change it together in a Notion-like editor: type <code>/</code> for blocks, select text to format it. Everyone in the doc sees the others' avatars and cursors, and each keystroke reaches them at once.</p>
      <p>The draft lives on its own until someone presses <strong>Publish</strong>, which makes it the next version. Closing the editor keeps the draft for whoever opens it next. If an agent publishes while people edit, Drop asks before putting the draft on top. Only the latest version of a doc can be edited, and docs that use Comark components stay read-only.</p>
    </DocsSection>

    <DocsSection id="versions" title="Versions">
      <p>To publish the next version, an agent calls <code>publish</code> with <code>previous</code> set to the drop's id or link, or puts <code>supersedes: &lt;id&gt;</code> in a doc's front matter. A doc keeps one link, <code>/d/&lt;key&gt;/&lt;slug&gt;</code>, that always opens its latest version; <code>?v=2</code> pins a version, and History copies one. The agent picks the slug, the readable part, and a link with an old slug still works. Every version an agent publishes carries a note saying what changed, shown in the version history. Sharing and lifetime stay the same unless the agent changes them. Earlier doc versions stay in history. An app keeps only its latest file set: the next version starts from it, the agent sends just the files it changed, and a file is deleted only when the agent names it in <code>removes</code>.</p>
      <p>Apps and HTML pages report what goes wrong while people have them open: uncaught errors, rejected promises, <code>console.error</code>, and files that fail to load. The agent reads them with <code>read_drop</code> and fixes them in the next version. When it publishes, Drop also warns it about scripts, styles, images, and links that point at files the app doesn't have.</p>
      <p>Agents publish most versions: people comment, and the agent addresses the comments in the next version. The owner's agents can publish, and so can admins' agents. People who may edit a Markdown doc can also publish one from the live editor.</p>
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
        <li>You, or anyone else who can open it, opening it while signed in.</li>
        <li>An agent reading it with <code>read_drop</code>, or publishing a new version.</li>
        <li>Someone reading a shared link in a browser, or opening its raw file directly. Link previews in Slack, Discord, or X, crawlers, and images embedded on other sites don't count.</li>
      </ul>
      <p>A drop that expires, or that you or your agent delete, goes to the <strong>Trash</strong>. Its links stop working. For 15 days you can restore it from the Trash on the Drops page; then it's deleted with its comments and files. You can also delete it for good, or empty the Trash, yourself. Agents can move drops to the Trash and restore them, but only people delete for good.</p>
      <p>Images and files a doc embeds from Drop belong to that doc: whoever can open the doc can see them, and they live and go to the Trash with it. A Drop's admin can change the 30 days, or allow only admins to keep drops.</p>
    </DocsSection>
  </DocsPage>
</template>
