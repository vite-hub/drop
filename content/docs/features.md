---
title: Features
description: What Drop does, the main things first. Each part links to the page with every detail.
---

## Your agent drops, people review {#agents}

Connect Claude Code, Claude, ChatGPT, Codex, Cursor, or any MCP client with one URL; it signs in through your browser, with no keys to paste. Ask it for a plan, a report, or a small app, and it publishes the drop and answers with the link. When people have commented, it reads the open comments, publishes the next version, and resolves what it addressed.

::docs-figure{src="/docs/features/agents.webp" alt="The Agents page: Drop's server URL, setup tabs for Claude Code, Claude, ChatGPT, Codex, Cursor and VS Code, and the command to add it" :width="1040" :height="630"}
::

[Connect an agent](/docs/agents) has the setup for each client and every tool.

## Comments on the exact spot {#comments}

Select a sentence, click a spot in an image, or drag a box over part of a page, and write. The pin stays on what it points at, and its thread holds the replies. Copy a thread's link to send someone straight to it, or copy every open comment as Markdown for an agent that isn't connected.

::docs-figure{src="/docs/features/comments.webp" alt="A plan with three pinned comments; one thread is open with two replies, and the Comments panel lists the rest" :width="1040" :height="760"}
::

More in [Comments](/docs/review#comments).

## Private until you share it {#sharing}

A drop starts with the Drop's default: Only me on a personal Drop, the Team on a team Drop. One dialog changes it: the team can open it or edit it, or a public link lets anyone open it, and comment if you allow it.

::docs-figure{src="/docs/features/share.webp" alt="The Share dialog with five options: Only me, Team, Team can edit, Public link, and Public, anyone comments" :width="512" :height="600" .mx-auto .max-w-sm}
::

More in [Sharing](/docs/review#sharing).

## Edit together {#edit}

Everyone who may edit a Markdown doc opens it with **Edit** and works in the same draft, live, with each other's cursors. **Publish** makes the draft the next version, which the agent picks up like any other.

:::docs-figure
::landing-doc-story
::
:::

More in [Edit together](/docs/review#edit).

## Version history {#versions}

Every version of a doc gets a number and a note on what changed. History lists them, and a click shows what a version changed against the one before. Open comments carry over to the next version, and the doc keeps one link that always opens the latest.

::docs-figure{src="/docs/features/history.webp" alt="History beside a doc: v2 compared with v1, one line added under Rollout and one rewritten under Risks" :width="1040" :height="470"}
::

More in [Versions](/docs/review#versions).

## Apps that run at a link {#apps}

An agent publishes a folder of static files with an `index.html`: a prototype, a dashboard, a small game. The link runs it full screen, comments work on each of its pages, and the next version sends only the files that changed.

::docs-figure{src="/docs/features/app.webp" alt="An app drop: a launch board with To do, Doing and Done columns, running inside Drop" :width="1040" :height="470"}
::

More in [Apps](/docs/review#apps).

## Review a live site {#sites}

Point a site review at your preview deploys. Reviewers press **Comment** on the running page and drag a box; the note lands in Drop with a screenshot, and your agent reads it and fixes the page.

:::docs-figure
::landing-site-story
::
:::

More in [Review a live site](/docs/sites).

## More {#more}

### Search {#search}

Press :kbd[⌘K] (<kbd>Ctrl K</kbd> on Windows and Linux), or **Search** in the sidebar, on any page of Drop while you're signed in. It finds drops by their title, file name, or link, and docs by the words inside their latest version. It searches your drops in every folder, then the ones shared with you. Without words, it lists your latest drops and Drop's pages.

::docs-figure{src="/docs/features/search.webp" alt="The search palette: the word invoice finds the Billing migration doc in Plans, with the matching text" :width="808" :height="488"}
::

The search box on the Drops page (<kbd>/</kbd> puts the cursor in it) looks inside every folder too, and a folder's page searches only what's inside it. Agents search with `list_drops` and `query`, and add `folder` to search one folder and everything below it.

### Keyboard shortcuts {#shortcuts}

Press :kbd[?] on any page of Drop to see them all. **Keyboard shortcuts** in the account menu and in :kbd[⌘K] opens the same list.

::docs-figure{src="/docs/features/shortcuts.webp" alt="The keyboard shortcuts dialog, grouped into General, In a drop, and Editing" :width="449" :height="608" .mx-auto .max-w-xs}
::

::shortcut-table
::

On Windows and Linux, use :kbd[Ctrl] for :kbd[⌘].

### Folders agents follow {#folders}

A folder's description says what goes in it and how to write it, like "One doc per project. Start with the goal, then Rollout and Risks." Agents read the descriptions before they publish, put the drop in the folder that fits, and follow what it asks. On a team Drop, admins make the team's folders.

::docs-figure{src="/docs/features/folder.webp" alt="The Plans folder with four drops, and its Details panel showing the folder's description" :width="1280" :height="560"}
::

More in [Where agents publish](/docs/agents#folders) and [Folders](/docs/review#folders).

### Skills for your agent {#skills}

Skills come with the server and teach your agent how to use Drop well: publishing for review, before-and-after evidence for pull requests, UI prototypes, handoffs, and visual explainers. The Skills page lists them, and an admin can switch one off for everyone.

::docs-figure{src="/docs/features/skills.webp" alt="The Skills page listing vitehub-drop, handoff, pr-evidence and prototype, each switched on" :width="1040" :height="700"}
::

More in [Skills](/docs/agents#skill).

### Code images {#code-images}

Your agent turns a snippet into a highlighted, framed image at a link that lasts five minutes, for a pull request or a post.

::docs-figure{src="/docs/features/code-image.svg" alt="A code image: a short TypeScript function on a dark card with a purple-to-blue frame" :width="501" :height="294" .mx-auto .max-w-md}
::

More in [Code images](/docs/agents#code-images).

### Lifetimes and the Trash {#lifetime}

Each drop says how long it lives: Temporary for 14 days after anyone last opened it, Review for 30, or Keep for good. A drop that expires goes to the Trash, where you can restore it for 15 days.

More in [Lifetime and Trash](/docs/review#expiry).

### Views {#views}

**Views** in a drop's Details count how often people and agents opened it, split into signed in, anonymous, and by agents. Only its owner and admins see them, and their agents get them from `read_drop`. Each viewer counts once a day, every version of a doc adds to the same count, and your own visits don't count.

Link previews and crawlers don't count. Drop tells anonymous visitors apart without cookies, by a hash of their address and browser that changes every day and is deleted the next.
