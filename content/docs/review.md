---
title: Review and share
description: Every drop opens full screen with its comments beside it. Its share setting decides who else can open it.
---

## Docs {#docs}

A **doc** is Markdown, a self-contained HTML page, or any single file up to 4 MiB, such as a screenshot. Agents publish one with `publish` and `markdown`, `html`, or `file`. People upload a file from the Drops page.

Markdown renders with tables, task lists, callouts, footnotes, Mermaid diagrams, and every [comark-ui](https://comark-ui.onmax.me) block, such as tabs, steps, diffs, metrics, and charts. HTML runs as-is, scripts included, in a sandbox with no access to your session. If the Drop serves apps from a separate domain, each page gets its own origin, so storage and history work.

Images a doc embeds from Drop belong to it. Whoever can open the doc sees them, and they go to the Trash with it.

In a Markdown doc, the **#** beside a heading copies a link to that section, which opens the doc there. The address bar follows the section you open from the outline. An image's button in its corner copies the image's own address, and a video's settings copy its address at the second it's at (`#t=`) or the frame on screen.

## Videos {#videos}

A **video** you upload (MP4, WebM) plays in the viewer. Add `?t=` to its link to open it at a second: `?t=75`, `?t=1:15`, or `?t=1m15s`.

| Button in the player | What it does |
| --- | --- |
| **Comment on this frame** | Pauses the video and opens the frame still, where you click a spot or drag an area. See [Comments](#comments). |
| **Copy link** | Copies the video's link at the second it's at. |
| **Copy frame** | Copies the frame on screen as a PNG. |

## PDFs {#pdfs}

A **PDF** you upload opens in the viewer, page after page. Its text is selectable and its links work. The bar over the pages shows the page you're on (type a number to go there) and the zoom; the percentage fits the pages to the width again.

| Button in the bar | What it does |
| --- | --- |
| **Comment on page** | Opens the page you're on as a still, where you click a spot or drag an area. See [Comments](#comments). |

### Rules for HTML plans

::plan-rules
::

## Apps {#apps}

An **app** is a set of static files with an `index.html`, up to 1,000 files and 25 MiB (300 files and 10 MiB on the free plan). Agents publish a small one with `publish` and `files` keyed by path. Relative links, stylesheets, ES modules, and `fetch("data.json")` work as on any static host.

```js
publish({
  title: "Launch board",
  files: { "index.html": "…", "app.js": "…", "data.json": "[…]" },
  note: "First board with the launch checklist",
  lifetime: "temporary"
})
```

A built app, such as a Vite `dist/` folder, a prerendered Nuxt site, or a Slidev deck, goes up as one archive. The agent calls `publish` with `archive: {}`, gets an upload URL, and runs `tar -czf - -C dist . | curl -T - '<uploadUrl>'`. Fonts, images, and wasm go in as they are. The app runs at the root of its own origin, which serves its files like a static host, so build it for `/`. Each archive replaces every file of the app.

An app's link opens at any of its pages with `?path=`: `/d/<key>/<slug>?path=/guide/setup#install` opens the app at `/guide/setup`, scrolled to `#install`, and so does `/d/<key>/<slug>/guide/setup#install`. The address bar follows the app as you move through it, so **Copy link** and a copied address open the page you were on. An address the app doesn't have shows its own `404.html`, or its `index.html` for a single-page app. `publish` and `read_drop` give agents each page with its link.

To present a Slidev deck, press **Present** in the review bar at the bottom of the drop. The deck opens alone in a new window for the projector, and the drop's page turns into Slidev's presenter view, with your notes, the next slide, and a timer; it drives the other window. For any other app or HTML page, choose **Open in new window** in the command palette (**⌘K** or **Ctrl+K**), or under the review toolbar's **+** if you're signed out.

An app with server code, like API routes, sign-in, or a database, isn't a drop. Deploy it to a preview and review it as a [site](/docs/sites).

## Folders {#folders}

A **folder** groups drops that belong together, like the screenshots of one change and the doc about them. Create one with **New › Folder**, or an agent calls `create_folder` and publishes with `folder`. Folders nest up to 8 levels. Move a drop with **Move to Folder** in its menu or its Details panel.

A folder shares and lives like one drop. Sharing it shares everything inside, though a drop inside can still be shared wider. Everything in it goes to the Trash and comes back with it. Folders don't count toward your plan; the drops in them do.

An image in a folder opens with the folder's other images around it. Move between them with the arrows at its sides, the thumbnails in the bar at the bottom, <kbd>←</kbd> and <kbd>→</kbd>, or a swipe on a phone. Anyone who can open the folder sees them, at its share link too.

Each folder has a **description** in its Details, up to 2,000 characters, saying what goes in it and how to name and write it. Agents read descriptions with `list_folders` before they publish, and follow them. For example: "Notes from calls, one doc per meeting, named YYYY-MM-DD-topic. Start with who was there, then decisions, then action items."

### Team folders

On a team Drop, admins create team folders with the team switch under **New › Folder**. Everyone on the team, and their agents, adds drops to them. Each drop stays its publisher's and counts against their plan.

- Team folders never expire and can't be Only me.
- Only admins rename, describe, share, or trash them, or add subfolders.
- Anyone on the team can trash a drop in one from the browser. It goes to its owner's Trash, where the owner or an admin restores it.

To find a drop in any folder, use [Search](/docs/features#search).

## Comments {#comments}

| To comment on | Do this |
| --- | --- |
| Text | Select it and pick **Comment**. |
| Text you'd word differently | Select it and pick **Suggest**, then write the words that replace it, or clear them to suggest deleting it. The doc shows the old words struck through and the new ones after them. People who can edit the doc **Accept** it, which publishes the next version with the change and resolves it. **Undo** in the note that follows publishes the text from before and opens the suggestion again. |
| An image | In a Markdown doc or an image drop, click it to zoom, then click a spot or drag an area. In an HTML doc or an app, clicks stay the page's own, so use the Comment tool. |
| A video's frame | Press **Comment on this frame** in the player, then click a spot or drag an area on the still. A marker under the seek bar opens that frame and its thread again. The comment carries the frame as its image, so agents see it. |
| A PDF's page | Press **Comment on page** in the bar over the pages, then click a spot or drag an area on the page. Its pin stays on that page and opens the page and its thread again. The comment keeps the page's number and carries the page as its image, so agents see it. |
| An element or part of a page | Pick **Comment** in the toolbar under the page, or press :kbd[R]. Click an element to pin a comment to it, or drag a rectangle. The tool stays on for the next one. |
| Anything you'd rather draw on | Pick **Marker** in the toolbar, or press :kbd[B] while you point at it. See [Marker](#marker). |
| The whole page | Write in the box at the bottom of the Comments panel. |

A comment shows the moment you send it. If it doesn't go through, it comes back to its box with the reason.

Comments stay anchored to what they point at, per page for apps. Click a pin to open the thread; anyone who can comment can reply, and **Copy link** links straight to it. The author, the drop's owner, or an admin resolves a comment, which closes its thread.

Agents read open comments and their threads with `read_drop` or the `address_feedback` prompt, answer with `reply`, accept a suggestion as written with `accept_suggestion`, and resolve what they fixed when they publish the next version. **Copy feedback for your agent** copies them as Markdown.

**Send** hands your own agent every open thread that waits for an answer, yours and everyone else's, in one click. It sits in the toolbar under the page as **Send 3**, with the number of waiting threads, and turns into its status: Sending, Sent (or In inbox), then Working once your agent opens the handoff. A paired T3 link appears as **Open thread** while the agent works. If the send doesn't arrive, it says **Not delivered**, with **Retry**. The first Send copies a setup prompt: paste it in a T3 Code thread, or follow the [plugin's inbox setup](/docs/agents#plugin) for `/drop:feedback` in Claude Code or `$feedback` in Codex. Then confirm **Allow and send 3** in Drop. The **Agents** page shows the default destination: **Test default** checks it, and **Disconnect all** removes all of your Send destinations, including paired publishing threads.

The agent gets ids and fixed words, never what people wrote, and reads the threads through Drop's MCP as you, with `read_drop` and the send's id. A delivery names the drop and the version to build on. It includes the publishing session only when you own the drop and published the latest version; for teammates or versions with no verified publisher, `session` is `null`. Send clears when the threads it tracks have been answered or resolved: your asks if there are any, otherwise the quoted threads. For a handoff with only quotes, the feedback skill asks which threads you want addressed before acting.

Signed out, as a guest, where you can't comment, or on an individual live-site screenshot, **Copy prompt** in the review toolbar copies every open thread waiting for an answer as a prompt for any agent. It includes your threads as requests and quotes other people's threads for context.

To comment on a running website, such as a preview deploy, see [Review a live site](/docs/sites).

### Review toolbar {#toolbar}

Docs and apps show a toolbar under the page. **Comments** and the Marker sit in it; press **+** at its right end, or :kbd[I], and it grows to the right with the rest: Browse, Measure, Rulers, X-ray, the device sizes, **Edit**, the drop's details and History. A tool you leave on stays beside the **+** after it closes, so one press turns it off. Each tool has a key, which also works while the page has focus. In an app, the page keeps its own keys until a tool is on.

| Tool | Key | What it does |
| --- | --- | --- |
| Browse | :kbd[V] | The page takes its own clicks. |
| Comment | :kbd[R] | Highlights the element under the pointer. Click to pin a comment, drag for an area. |
| Marker | :kbd[B] | Freezes the page and lets you draw on it. See [Marker](#marker). |
| Measure | :kbd[S] | Shows an element's size, padding, and margin, with its font, colors, gap, and corners. Click one to pick it, then point at another to see the distance between them. |
| Rulers and guides | :kbd[U] | Pixel rulers along the top and left, on images and Markdown docs too. Drag a guide out of a ruler. Drag it back, or double-click it, to remove it. |
| X-ray | :kbd[X] | Outlines every element without moving anything. |
| Hide comments | | The eye beside **Comments**. Hides the pins and highlights while you look at the page. |

:kbd[Esc] unpicks the measured element, closes an open comment box, then returns to Browse.

**Zen** under the **+**, or :kbd[Z], is for reading: a Markdown doc loses its outline, and the toolbar folds to a small handle with Drop's mark, a count of open comments, and a dot for each person here. Press the handle to show the toolbar while you need it. Comments, editing, the Marker, and Share bring it back on their own. Press **Zen** or :kbd[Z] again, or :kbd[Esc] once nothing else is open, to leave. Drop remembers it in this browser, for every drop.

### Marker {#marker}

The Marker draws on a snapshot of the page and sends it as one comment. Press :kbd[B] while you point at what you want to mark: the page freezes as it is, an open tooltip or menu included, and the toolbar turns into the Marker's tools.

| Tool | Key | What it does |
| --- | --- | --- |
| Marker | :kbd[B] | A see-through highlighter stroke. Hold :kbd[Shift] to keep it on its line. |
| Pen | :kbd[P] | A thin line, to circle, underline, or cross out. Hold :kbd[Shift] for a straight one. |
| Arrow | :kbd[A] | Drag from where it starts to what it points at. |
| Text | :kbd[T] | Click and type a short label. :kbd[Enter], :kbd[Esc], or a click elsewhere puts it down. Click a label to change it, and pick a size or colour while it is open to restyle it. Drag a label to move it, or clear it to delete it. |
| Size | :kbd[[] :kbd[]] | Four sizes for each tool. |
| Undo | :kbd[⌘Z] | Takes back the last stroke or label. |

**Done** (:kbd[Enter], or :kbd[⌘Enter] while you type a label) opens the comment with the snapshot and your strokes attached, and the words under them quoted. The note is optional. The comment points at the part of the page you marked, and your strokes stay drawn there for everyone who opens the page. Agents read the marked words and the image with `read_drop`. :kbd[Esc] or **Cancel** throws the snapshot away.

## Sharing {#sharing}

Each drop has one **share setting**, for all its versions.

| Setting | Who opens and comments |
| --- | --- |
| Only me | The owner and admins. The owner's agents can still read it. |
| Team | Everyone signed in to this Drop. |
| Team can edit | The team, who also edit a Markdown doc, or the Markdown in a folder, together. Agents never edit through it. |
| Public link | Anyone with the link opens it, no sign-in needed. Signed-in people comment. |
| Public, anyone comments | Anyone with the link, guests included. |

Team and Team can edit exist only on team Drops. New drops start Only me on a personal Drop, like drop.vitehub.dev, and Team on a team Drop. **Shared with me** lists public links others shared that you opened while signed in. On a team Drop, the **Team** tab lists the team's folders, then teammates' drops shared with the team.

A public link closes after 7 days on a team Drop and never on a personal one, unless the operator changes it. The drop then falls back to Team, or to Only me on a personal Drop. Picking Public again restarts the window. A drop in a folder takes the widest share on its path.

## Who's here {#presence}

When others have the same drop open, their faces show next to **Share**, ringed in the color of their cursor. Someone away for a minute, or whose tab is hidden, dims. Press the faces for a list of who's here, and, on a site review, which page each person is on.

On a doc or an app, you see the cursors of the people on the same version and page, with their names. Turn **Show cursors** off in that list to hide them; the browser remembers.

Only people who could open the drop without its link join: its owner, admins, and the people a team share reaches. Someone reading a public link doesn't show up and doesn't see who else is reading. Agents never show.

## Edit together {#edit}

Anyone who may edit a Markdown doc opens it with **Edit** under the review toolbar's **+**, or :kbd[E], a Notion-like editor where everyone sees each other's avatars, cursors, and keystrokes as they happen. Type `/` for blocks, `@` to mention someone on this Drop, and `:` for an emoji.

Edits go to a draft until someone presses **Publish**, which makes it the next version. The draft stays when you close the editor. If an agent publishes meanwhile, Drop asks before putting the draft on top. Only the latest version can be edited. Components, footnotes and suggested edits stay as they are; a doc the editor couldn't save without changing how it reads stays read-only.

## Versions {#versions}

An agent publishes the next version with `publish` and `previous` set to the drop's id or link, or a `?v=` link to any of its versions. It lands on top of the latest, with a note saying what changed. Sharing and lifetime carry over unless the agent changes them. If two publish at once, one gets a conflict, reads the latest, and publishes again.

**`base`** is the version the agent read. When someone published a newer one since, Drop refuses the publish with a conflict, creates no version, and tells the agent which version is latest, so it reads the drop again instead of writing over changes and comments it never saw. Without `base`, the version goes on top of the latest, as before.

The owner's agents and admins' agents publish versions. People who may edit a Markdown doc publish from the editor.

A doc keeps one link, `/d/<key>/<slug>`, that opens its latest version, and `?v=2` pins one. The agent picks the slug, and a link with an old slug still works.

A doc's **History** lists its versions, newest first, with each note, who published it, and how many comments it got. When the publishing agent supplies them, each version also shows its model, harness, and reasoning level. An agent can also name the session it publishes from (`agent.session`: harness, thread, project, worktree, branch), identifiers only. `read_drop` lists those identifiers with the version only for the drop owner and their agents, even when the drop is shared. Older versions and browser edits have no agent metadata. Click one to see what it changed, or copy its pinned link; :kbd[Esc] goes back. Open comments carry over and keep their numbers. A comment on text the new version dropped shows under **From earlier versions**.

An app keeps only its latest file set. A built app's next archive replaces every file. With `files`, the agent sends the files it changed, and a file goes away only when the agent names it in `removes`.

Apps and HTML pages report what breaks while people have them open: uncaught errors, rejected promises, `console.error`, and files that fail to load. Agents read them with `read_drop`. On publish, Drop also warns about scripts, styles, images, and links to files the app doesn't have.

## Lifetime and Trash {#expiry}

Each drop has a **lifetime**, set by whoever publishes it. You can change it in the drop's Details panel.

| Lifetime | Agents call it | For | Goes to the Trash |
| --- | --- | --- | --- |
| 14 days | `temporary` | Prototypes, spikes, one-off answers | If nobody opens it for 14 days |
| 30 days | `review` | Plans and docs going through feedback | If nobody opens it for 30 days |
| Never delete | `keep` | Pull request assets, anything linked from somewhere that lasts | Never. An agent has to say why, and you see the reason. |

A visit is anyone who can open the drop opening it while signed in, an agent reading it with `read_drop` or `read_file` or publishing a version, or someone opening a shared link or raw file in a browser. Link previews in Slack, Discord, or X, crawlers, and images embedded on other sites don't count. A visit restarts the window for every version.

A drop that expires or is deleted goes to the **Trash**, and its links stop working. You can restore it for 15 days; then it's deleted with its comments and files. You can also delete it for good or empty the Trash yourself. Agents can trash and restore drops, but only people delete for good.

An admin can change the 30 days, or allow only admins to pick Never delete.
