<script setup lang="ts">
import { PLAN_AUTHORING_GUIDE } from "#shared/plan-runtime"

definePageMeta({ layout: "docs" })

const app = `publish({\n  title: "Launch board",\n  files: { "index.html": "…", "app.js": "…", "data.json": "[…]" },\n  note: "First board with the launch checklist",\n  lifetime: "temporary"\n})`
</script>

<template>
  <DocsPage title="Review and share" lead="Every drop opens full screen with its comments beside it. Its share setting decides who else can open it.">
    <DocsSection id="docs" title="Docs">
      <p>A <strong>doc</strong> is Markdown, a self-contained HTML page, or any single file up to 4 MiB, such as a screenshot. Agents publish one with <code>publish</code> and <code>markdown</code>, <code>html</code>, or <code>file</code>. People upload a file from the Drops page.</p>
      <p>Markdown renders with tables, task lists, callouts, and Mermaid diagrams. HTML runs as-is, scripts included, in a sandbox with no access to your session. If the Drop serves apps from a separate domain, each page gets its own origin, so storage and history work.</p>
      <p>Images a doc embeds from Drop belong to it. Whoever can open the doc sees them, and they go to the Trash with it.</p>
      <h3>Rules for HTML plans</h3>
      <ul>
        <li v-for="rule in PLAN_AUTHORING_GUIDE.split('\n')" :key="rule">{{ rule }}</li>
      </ul>
    </DocsSection>

    <DocsSection id="apps" title="Apps">
      <p>An <strong>app</strong> is a set of static files with an <code>index.html</code>, up to 200 files and 4 MiB. Agents publish one with <code>publish</code> and <code>files</code> keyed by path. Relative links, stylesheets, ES modules, and <code>fetch("data.json")</code> work as on any static host.</p>
      <AgentsCodeBlock :code="app" />
    </DocsSection>

    <DocsSection id="folders" title="Folders">
      <p>A <strong>folder</strong> groups drops that belong together, like the screenshots of one change and the doc about them. Create one with <strong>New › Folder</strong>, or an agent calls <code>create_folder</code> and publishes with <code>folder</code>. Folders nest up to 8 levels. Move a drop with <strong>Move to Folder</strong> in its menu or its Details panel.</p>
      <p>A folder shares and lives like one drop. Sharing it shares everything inside, though a drop inside can still be shared wider. Everything in it goes to the Trash and comes back with it. Folders don't count toward your plan; the drops in them do.</p>
      <p>Each folder has a <strong>description</strong> in its Details, up to 2,000 characters, saying what goes in it and how to name and write it. Agents read descriptions with <code>list_folders</code> before they publish, and follow them. For example: "Notes from calls, one doc per meeting, named YYYY-MM-DD-topic. Start with who was there, then decisions, then action items."</p>
      <h3>Team folders</h3>
      <p>On a team Drop, admins create team folders with the team switch under <strong>New › Folder</strong>. Everyone on the team, and their agents, adds drops to them. Each drop stays its publisher's and counts against their plan.</p>
      <ul>
        <li>Team folders never expire and can't be Only me.</li>
        <li>Only admins rename, describe, share, or trash them, or add subfolders.</li>
        <li>Anyone on the team can trash a drop in one from the browser. It goes to its owner's Trash, where the owner or an admin restores it.</li>
      </ul>
      <p>To find a drop in any folder, use <NuxtLink to="/docs/features#search">Search</NuxtLink>.</p>
    </DocsSection>

    <DocsSection id="comments" title="Comments">
      <div class="overflow-x-auto rounded-lg border border-default">
        <table>
          <thead><tr><th>To comment on</th><th>Do this</th></tr></thead>
          <tbody>
            <tr><td>Text</td><td>Select it.</td></tr>
            <tr><td>An image</td><td>Click it to zoom, then click a spot or drag an area.</td></tr>
            <tr><td>Part of a page</td><td>Press <kbd>R</kbd> (<strong>Comment on an area</strong>) and drag a rectangle.</td></tr>
            <tr><td>The whole page</td><td>Write in the box at the bottom of the Comments panel.</td></tr>
          </tbody>
        </table>
      </div>
      <p>Comments stay anchored to what they point at, per page for apps. Click a pin to open the thread; anyone who can comment can reply, and <strong>Copy link</strong> links straight to it. The author, the drop's owner, or an admin resolves a comment, which closes its thread.</p>
      <p>Agents read open comments and their threads with <code>read_drop</code> or the <code>address_feedback</code> prompt, answer with <code>reply</code>, and resolve what they fixed when they publish the next version. <strong>Copy feedback for your agent</strong> copies them as Markdown.</p>
      <p>To comment on a running website, such as a preview deploy, see <NuxtLink to="/docs/sites">Review a live site</NuxtLink>.</p>
    </DocsSection>

    <DocsSection id="sharing" title="Sharing">
      <p>Each drop has one <strong>share setting</strong>, for all its versions.</p>
      <div class="overflow-x-auto rounded-lg border border-default">
        <table>
          <thead><tr><th>Setting</th><th>Who opens and comments</th></tr></thead>
          <tbody>
            <tr><td>Only me</td><td>The owner and admins. The owner's agents can still read it.</td></tr>
            <tr><td>Team</td><td>Everyone signed in to this Drop.</td></tr>
            <tr><td>Team can edit</td><td>The team, who also edit a Markdown doc, or the Markdown in a folder, together. Agents never edit through it.</td></tr>
            <tr><td>Public link</td><td>Anyone with the link opens it, no sign-in needed. Signed-in people comment.</td></tr>
            <tr><td>Public, anyone comments</td><td>Anyone with the link, guests included.</td></tr>
          </tbody>
        </table>
      </div>
      <p>Team and Team can edit exist only on team Drops. New drops start Only me on a personal Drop, like drop.vitehub.dev, and Team on a team Drop. <strong>Shared with me</strong> lists public links others shared that you opened while signed in. On a team Drop, the <strong>Team</strong> tab lists the team's folders, then teammates' drops shared with the team.</p>
      <p>A public link closes after 7 days on a team Drop and never on a personal one, unless the operator changes it. The drop then falls back to Team, or to Only me on a personal Drop. Picking Public again restarts the window. A drop in a folder takes the widest share on its path.</p>
    </DocsSection>

    <DocsSection id="edit" title="Edit together">
      <p>Anyone who may edit a Markdown doc opens it with <strong>Edit</strong>, a Notion-like editor where everyone sees each other's avatars, cursors, and keystrokes as they happen. Type <code>/</code> for blocks, <code>@</code> to mention someone on this Drop, and <code>:</code> for an emoji.</p>
      <p>Edits go to a draft until someone presses <strong>Publish</strong>, which makes it the next version. The draft stays when you close the editor. If an agent publishes meanwhile, Drop asks before putting the draft on top. Only the latest version can be edited, and docs that use Comark components stay read-only.</p>
    </DocsSection>

    <DocsSection id="versions" title="Versions">
      <p>An agent publishes the next version with <code>publish</code> and <code>previous</code> set to any id or link in the chain, or with <code>supersedes: &lt;id&gt;</code> in a doc's front matter. It lands on top of the latest, with a note saying what changed. Sharing and lifetime carry over unless the agent changes them. If two publish at once, one gets a conflict, reads the latest, and publishes again.</p>
      <p>The owner's agents and admins' agents publish versions. People who may edit a Markdown doc publish from the editor.</p>
      <p>A doc keeps one link, <code>/d/&lt;key&gt;/&lt;slug&gt;</code>, that opens its latest version, and <code>?v=2</code> pins one. The agent picks the slug, and a link with an old slug still works.</p>
      <p>A doc's <strong>History</strong> lists its versions, newest first, with each note, who published it, and how many comments it got. Click one to see what it changed, or copy its pinned link; <kbd>Esc</kbd> goes back. Open comments carry over and keep their numbers. A comment on text the new version dropped shows under <strong>From earlier versions</strong>.</p>
      <p>An app keeps only its latest file set. The agent sends the files it changed, and a file goes away only when the agent names it in <code>removes</code>.</p>
      <p>Apps and HTML pages report what breaks while people have them open: uncaught errors, rejected promises, <code>console.error</code>, and files that fail to load. Agents read them with <code>read_drop</code>. On publish, Drop also warns about scripts, styles, images, and links to files the app doesn't have.</p>
    </DocsSection>

    <DocsSection id="expiry" title="Lifetime and Trash">
      <p>Each drop has a <strong>lifetime</strong>, set by whoever publishes it. You can change it in the drop's Details panel.</p>
      <div class="overflow-x-auto rounded-lg border border-default">
        <table>
          <thead><tr><th>Lifetime</th><th>For</th><th>Expires</th></tr></thead>
          <tbody>
            <tr><td>Temporary</td><td>Prototypes, spikes, one-off answers</td><td>14 days after the last visit</td></tr>
            <tr><td>Review</td><td>Plans and docs going through feedback</td><td>30 days after the last visit</td></tr>
            <tr><td>Keep</td><td>Pull request assets, anything linked from somewhere that lasts</td><td>Never. An agent has to say why, and you see the reason.</td></tr>
          </tbody>
        </table>
      </div>
      <p>A visit is anyone who can open the drop opening it while signed in, an agent reading it with <code>read_drop</code> or publishing a version, or someone opening a shared link or raw file in a browser. Link previews in Slack, Discord, or X, crawlers, and images embedded on other sites don't count. A visit restarts the window for every version.</p>
      <p>A drop that expires or is deleted goes to the <strong>Trash</strong>, and its links stop working. You can restore it for 15 days; then it's deleted with its comments and files. You can also delete it for good or empty the Trash yourself. Agents can trash and restore drops, but only people delete for good.</p>
      <p>An admin can change the 30 days, or allow only admins to keep drops.</p>
    </DocsSection>
  </DocsPage>
</template>
