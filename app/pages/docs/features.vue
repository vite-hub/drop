<script setup lang="ts">
// Every feature on one page, the ones people use daily first, each with a screenshot and a link to the page with the
// details. Screenshots live in public/docs/features/; the two that need live editing or someone else's site use the
// landing's stories instead. Search and the shortcut table live here, not on Review and share.
definePageMeta({ layout: "docs" })
</script>

<template>
  <DocsPage title="Features" lead="What Drop does, the main things first. Each part links to the page with every detail.">
    <DocsSection id="agents" title="Your agent drops, people review">
      <p>Connect Claude Code, Codex, Cursor, or any MCP client with one URL; it signs in through your browser, with no keys to paste. Ask it for a plan, a report, or a small app, and it publishes the drop and answers with the link. When people have commented, it reads the open comments, publishes the next version, and resolves what it addressed.</p>
      <DocsFigure src="/docs/features/agents.webp" alt="The Agents page: Drop's server URL, setup tabs for Claude Code, Codex, Cursor and VS Code, and the command to add it" :width="1040" :height="630" />
      <p><NuxtLink to="/docs/agents">Connect an agent</NuxtLink> has the setup for each client and every tool.</p>
    </DocsSection>

    <DocsSection id="comments" title="Comments on the exact spot">
      <p>Select a sentence, click a spot in an image, or drag a box over part of a page, and write. The pin stays on what it points at, and its thread holds the replies. Copy a thread's link to send someone straight to it, or copy every open comment as Markdown for an agent that isn't connected.</p>
      <DocsFigure src="/docs/features/comments.webp" alt="A plan with three pinned comments; one thread is open with two replies, and the Comments panel lists the rest" :width="1040" :height="760" />
      <p>More in <NuxtLink to="/docs/review#comments">Comments</NuxtLink>.</p>
    </DocsSection>

    <DocsSection id="sharing" title="Private until you share it">
      <p>A drop starts with the Drop's default: Only me on a personal Drop, the Team on a team Drop. One dialog changes it: the team can open it or edit it, or a public link lets anyone open it, and comment if you allow it.</p>
      <DocsFigure src="/docs/features/share.webp" alt="The Share dialog with five options: Only me, Team, Team can edit, Public link, and Public, anyone comments" :width="512" :height="600" class="mx-auto max-w-sm" />
      <p>More in <NuxtLink to="/docs/review#sharing">Sharing</NuxtLink>.</p>
    </DocsSection>

    <DocsSection id="edit" title="Edit together">
      <p>Everyone who may edit a Markdown doc opens it with <strong>Edit</strong> and works in the same draft, live, with each other's cursors. <strong>Publish</strong> makes the draft the next version, which the agent picks up like any other.</p>
      <DocsFigure>
        <LazyLandingDocStory hydrate-on-visible />
      </DocsFigure>
      <p>More in <NuxtLink to="/docs/review#edit">Edit together</NuxtLink>.</p>
    </DocsSection>

    <DocsSection id="versions" title="Version history">
      <p>Every version of a doc gets a number and a note on what changed. History lists them, and a click shows what a version changed against the one before. Open comments carry over to the next version, and the doc keeps one link that always opens the latest.</p>
      <DocsFigure src="/docs/features/history.webp" alt="History beside a doc: v2 compared with v1, one line added under Rollout and one rewritten under Risks" :width="1040" :height="470" />
      <p>More in <NuxtLink to="/docs/review#versions">Versions</NuxtLink>.</p>
    </DocsSection>

    <DocsSection id="apps" title="Apps that run at a link">
      <p>An agent publishes a folder of static files with an <code>index.html</code>: a prototype, a dashboard, a small game. The link runs it full screen, comments work on each of its pages, and the next version sends only the files that changed.</p>
      <DocsFigure src="/docs/features/app.webp" alt="An app drop: a launch board with To do, Doing and Done columns, running inside Drop" :width="1040" :height="470" />
      <p>More in <NuxtLink to="/docs/review#apps">Apps</NuxtLink>.</p>
    </DocsSection>

    <DocsSection id="sites" title="Review a live site">
      <p>Point a site review at your preview deploys. Reviewers press <strong>Comment</strong> on the running page and drag a box; the note lands in Drop with a screenshot, and your agent reads it and fixes the page.</p>
      <DocsFigure>
        <LazyLandingSiteStory hydrate-on-visible />
      </DocsFigure>
      <p>More in <NuxtLink to="/docs/sites">Review a live site</NuxtLink>.</p>
    </DocsSection>

    <DocsSection id="more" title="More">
      <h3 id="search" class="scroll-mt-20">Search</h3>
      <p>Press <kbd>⌘K</kbd> (<kbd>Ctrl K</kbd> on Windows and Linux), or <strong>Search</strong> in the sidebar, on any page of Drop while you're signed in. It finds drops by their title, file name, or link, and docs by the words inside their latest version. It searches your drops in every folder, then the ones shared with you. Without words, it lists your latest drops and Drop's pages.</p>
      <DocsFigure src="/docs/features/search.webp" alt="The search palette: the word invoice finds the Billing migration doc in Plans, with the matching text" :width="808" :height="488" />
      <p>The search box on the Drops page (<kbd>/</kbd> puts the cursor in it) looks inside every folder too, and a folder's page searches only what's inside it. Agents search with <code>list_drops</code> and <code>query</code>, and add <code>folder</code> to search one folder and everything below it.</p>

      <h3 id="shortcuts" class="scroll-mt-20">Keyboard shortcuts</h3>
      <p>Press <kbd>?</kbd> on any page of Drop to see them all. <strong>Keyboard shortcuts</strong> in the account menu and in <kbd>⌘K</kbd> opens the same list.</p>
      <DocsFigure src="/docs/features/shortcuts.webp" alt="The keyboard shortcuts dialog, grouped into General, In a drop, and Editing" :width="449" :height="608" class="mx-auto max-w-xs" />
      <div class="overflow-x-auto rounded-lg border border-default">
        <table>
          <thead><tr><th>Keys</th><th>What it does</th><th>Where</th></tr></thead>
          <tbody>
            <template v-for="group in SHORTCUT_GROUPS" :key="group.title">
              <tr v-for="shortcut in group.shortcuts" :key="shortcut.label">
                <td class="whitespace-nowrap"><kbd v-for="key in shortcut.keys" :key="key" class="mr-1">{{ KEY_LABELS.get(key) ?? key.toUpperCase() }}</kbd></td>
                <td>{{ shortcut.label }}</td>
                <td>{{ shortcut.where ?? group.where }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p>On Windows and Linux, use <kbd>Ctrl</kbd> for <kbd>⌘</kbd>.</p>

      <h3 id="folders" class="scroll-mt-20">Folders agents follow</h3>
      <p>A folder's description says what goes in it and how to write it, like "One doc per project. Start with the goal, then Rollout and Risks." Agents read the descriptions before they publish, put the drop in the folder that fits, and follow what it asks. On a team Drop, admins make the team's folders.</p>
      <DocsFigure src="/docs/features/folder.webp" alt="The Plans folder with four drops, and its Details panel showing the folder's description" :width="1280" :height="560" />
      <p>More in <NuxtLink to="/docs/agents#folders">Where agents publish</NuxtLink> and <NuxtLink to="/docs/review#folders">Folders</NuxtLink>.</p>

      <h3 id="skills" class="scroll-mt-20">Skills for your agent</h3>
      <p>Skills come with the server and teach your agent how to use Drop well: publishing for review, before-and-after evidence for pull requests, UI prototypes, handoffs, and visual explainers. The Skills page lists them, and an admin can switch one off for everyone.</p>
      <DocsFigure src="/docs/features/skills.webp" alt="The Skills page listing vitehub-drop, handoff, pr-evidence and prototype, each switched on" :width="1040" :height="700" />
      <p>More in <NuxtLink to="/docs/agents#skill">Skills</NuxtLink>.</p>

      <h3 id="code-images" class="scroll-mt-20">Code images</h3>
      <p>Your agent turns a snippet into a highlighted, framed image at a link that lasts five minutes, for a pull request or a post.</p>
      <DocsFigure src="/docs/features/code-image.svg" alt="A code image: a short TypeScript function on a dark card with a purple-to-blue frame" :width="501" :height="294" class="mx-auto max-w-md" />
      <p>More in <NuxtLink to="/docs/agents#code-images">Code images</NuxtLink>.</p>

      <h3 id="lifetime" class="scroll-mt-20">Lifetimes and the Trash</h3>
      <p>Each drop says how long it lives: Temporary for 14 days after anyone last opened it, Review for 30, or Keep for good. A drop that expires goes to the Trash, where you can restore it for 15 days.</p>
      <p>More in <NuxtLink to="/docs/review#expiry">Lifetime and Trash</NuxtLink>.</p>
    </DocsSection>
  </DocsPage>
</template>
