---
title: Review and share
description: Every drop opens full screen with its comments beside it. Its share setting decides who else can open it.
---

## Docs {#docs}

A **doc** is Markdown, a self-contained HTML page, or any single file up to 4 MiB, such as a screenshot. Agents publish one with `publish` and `markdown`, `html`, or `file`. People upload a file from the Drops page.

Markdown renders with tables, task lists, callouts, footnotes, and Mermaid diagrams. HTML runs as-is, scripts included, in a sandbox with no access to your session. If the Drop serves apps from a separate domain, each page gets its own origin, so storage and history work.

Images a doc embeds from Drop belong to it. Whoever can open the doc sees them, and they go to the Trash with it.

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

To present a Slidev deck, press **Present** in the drop's header. The deck opens alone in a new window for the projector, and the drop's page turns into Slidev's presenter view, with your notes, the next slide, and a timer; it drives the other window. Any other app or HTML page opens alone with **Open in new window** in **More**.

An app with server code, like API routes, sign-in, or a database, isn't a drop. Deploy it to a preview and review it as a [site](/docs/sites).

## Folders {#folders}

A **folder** groups drops that belong together, like the screenshots of one change and the doc about them. Create one with **New › Folder**, or an agent calls `create_folder` and publishes with `folder`. Folders nest up to 8 levels. Move a drop with **Move to Folder** in its menu or its Details panel.

A folder shares and lives like one drop. Sharing it shares everything inside, though a drop inside can still be shared wider. Everything in it goes to the Trash and comes back with it. Folders don't count toward your plan; the drops in them do.

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
| Text | Select it. |
| An image | In a Markdown doc or an image drop, click it to zoom, then click a spot or drag an area. In an HTML doc or an app, clicks stay the page's own, so use an area. |
| Part of a page | Press :kbd[R] (**Comment on an area**) and drag a rectangle. |
| The whole page | Write in the box at the bottom of the Comments panel. |

Comments stay anchored to what they point at, per page for apps. Click a pin to open the thread; anyone who can comment can reply, and **Copy link** links straight to it. The author, the drop's owner, or an admin resolves a comment, which closes its thread.

Agents read open comments and their threads with `read_drop` or the `address_feedback` prompt, answer with `reply`, and resolve what they fixed when they publish the next version. **Copy feedback for your agent** copies them as Markdown.

To comment on a running website, such as a preview deploy, see [Review a live site](/docs/sites).

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

## Edit together {#edit}

Anyone who may edit a Markdown doc opens it with **Edit**, a Notion-like editor where everyone sees each other's avatars, cursors, and keystrokes as they happen. Type `/` for blocks, `@` to mention someone on this Drop, and `:` for an emoji.

Edits go to a draft until someone presses **Publish**, which makes it the next version. The draft stays when you close the editor. If an agent publishes meanwhile, Drop asks before putting the draft on top. Only the latest version can be edited, and docs that use Comark components or footnotes stay read-only.

## Versions {#versions}

An agent publishes the next version with `publish` and `previous` set to any id or link in the chain, or with `supersedes: <id>` in a doc's front matter. It lands on top of the latest, with a note saying what changed. Sharing and lifetime carry over unless the agent changes them. If two publish at once, one gets a conflict, reads the latest, and publishes again.

The owner's agents and admins' agents publish versions. People who may edit a Markdown doc publish from the editor.

A doc keeps one link, `/d/<key>/<slug>`, that opens its latest version, and `?v=2` pins one. The agent picks the slug, and a link with an old slug still works.

A doc's **History** lists its versions, newest first, with each note, who published it, and how many comments it got. Click one to see what it changed, or copy its pinned link; :kbd[Esc] goes back. Open comments carry over and keep their numbers. A comment on text the new version dropped shows under **From earlier versions**.

An app keeps only its latest file set. A built app's next archive replaces every file. With `files`, the agent sends the files it changed, and a file goes away only when the agent names it in `removes`.

Apps and HTML pages report what breaks while people have them open: uncaught errors, rejected promises, `console.error`, and files that fail to load. Agents read them with `read_drop`. On publish, Drop also warns about scripts, styles, images, and links to files the app doesn't have.

## Lifetime and Trash {#expiry}

Each drop has a **lifetime**, set by whoever publishes it. You can change it in the drop's Details panel.

| Lifetime | For | Expires |
| --- | --- | --- |
| Temporary | Prototypes, spikes, one-off answers | 14 days after the last visit |
| Review | Plans and docs going through feedback | 30 days after the last visit |
| Keep | Pull request assets, anything linked from somewhere that lasts | Never. An agent has to say why, and you see the reason. |

A visit is anyone who can open the drop opening it while signed in, an agent reading it with `read_drop` or publishing a version, or someone opening a shared link or raw file in a browser. Link previews in Slack, Discord, or X, crawlers, and images embedded on other sites don't count. A visit restarts the window for every version.

A drop that expires or is deleted goes to the **Trash**, and its links stop working. You can restore it for 15 days; then it's deleted with its comments and files. You can also delete it for good or empty the Trash yourself. Agents can trash and restore drops, but only people delete for good.

An admin can change the 30 days, or allow only admins to keep drops.
