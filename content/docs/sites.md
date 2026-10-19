---
title: Review a live site
description: People review a running website where it lives, a preview deploy, staging, or a dev server, and their comments land in Drop with screenshots. Your site keeps its own cookies and sign-in, because Drop never frames it.
---

## Create the review {#create}

A site is a drop of its own. Create one with **New › Site review** on the Drops page or in a folder, or have an agent call `publish` with `site`. Either way you give the address people will review:

- One origin (scheme, host, and port), like `https://pr123-acme.preview.example.com`.
- A pattern whose first label is `*`, like `https://*.preview.example.com`. The `*` stands for one label, so one site drop covers every pull request's preview. It doesn't cover deeper levels (`a.b.preview.example.com`) or the bare domain.

Addresses must be `https`, or `http` on `localhost`, `127.0.0.1`, or `*.localhost`.

```js
publish({
  site: { url: "https://*.preview.example.com" },
  title: "Acme portal previews",
  slug: "acme-previews",
  share: "team",
  note: "Review the pull request previews",
  lifetime: "review"
})
```

`share: "team"` lets everyone signed in to a team Drop comment. To let guests comment without signing in, on any Drop, pass `share: "public_comment"`.

Comments from a pattern keep the address of the preview they came from, so you can tell pull requests apart.

## Review it in Drop {#here}

The site drop's page opens the site inside Drop: type the address of the page (any preview a pattern covers), press **Open here**, then **Comment**, and drag a box over what you mean. Nothing changes on the site and nothing is installed.

Drop can't look inside a page from another site, so it takes the screenshot with your browser's screen sharing, which asks once per visit. Chrome, Edge, and Brave offer **This tab**, and the screenshot matches the page exactly. Firefox, Zen, and Safari share a window or a screen, so the crop can be slightly off; the comment shows the screenshot before you send it.

A comment from here has the screenshot, your box, your note, and the address in the bar above the page. It doesn't name the element under the box, and clicks inside the page don't change that address: type the page you're on. A site that refuses to be shown in a frame stays blank; use the bookmarklet there.

## Or add the script to preview builds {#install}

To show the Comment button on the site itself: add the tag to the site's preview builds once, never production. Every preview then shows the Comment button to everyone, so reviewers install nothing, and with a pattern address the comments from every pull request's preview land on the same site drop.

::review-snippet
::

For a Nuxt app, behind a flag your preview builds set:

```ts
// nuxt.config.ts: preview builds only
export default defineNuxtConfig({
  app: {
    head: {
      script: process.env.PREVIEW
        ? [{ src: "$ORIGIN/review.js", defer: true }]
        : [],
    },
  },
})
```

The tag is the same for every site and carries no key, so nothing in the page's HTML opens the review. The button sits in the page's corner, in its own shadow root, so your styles and its styles never mix. It does nothing until someone presses it.

## Or use the bookmarklet {#bookmarklet}

For a site you can't change and that won't open in a frame, the site drop's page has a **Review with Drop** button to keep in your bookmarks. It adds Drop's Comment button to the page you're on, for you only, until you reload.

1. Show the bookmarks bar with :kbd[⌘] :kbd[Shift] :kbd[B] on a Mac or :kbd[Ctrl] :kbd[Shift] :kbd[B] elsewhere. It's the same in Chrome, Edge, Brave, Firefox, and Zen; Safari calls it the Favorites bar. In Zen's single toolbar, the bar appears when you point at the top edge of the window.
2. Drag the button onto the bar. In Firefox and Zen you can also right-click it and choose **Bookmark Link**.
3. Open any page of the site and click **Review with Drop** in your bookmarks.

The site drop's page shows these steps for your browser. A page with a strict Content Security Policy may block the bookmarklet; use the script tag there.

## Comment {#comment}

1. Press **Comment**. The first time, a Drop window opens and finds the reviews that cover the page and that you may comment on. With one, you're connected for 12 hours; with several, you pick one by its name and owner. Signed out, you can comment as a guest only on a review shared as **Public, anyone comments**.
2. Drag a box over what you mean. :kbd[Esc] cancels.
3. Write the note and press **Send**. The screenshot is of what you saw when you drew the box, sticky headers and fixed buttons included, and goes with the note, the page address, and the element under the box. A box on a sticky or fixed element says so, since it doesn't move with the page.

The screenshot loads `modern-screenshot` from esm\.sh when someone first draws a box. A page whose Content Security Policy blocks it, or blocks <code>[:origin]</code> in `connect-src`, sends comments without screenshots, or not at all; allow both on preview builds.

## Read and resolve {#read}

The site's page in Drop lists every comment, newest first. Each screenshot opens as an image with the box drawn on it, where people can reply. Screenshots belong to the site: they share its sharing, its lifetime, and its Trash, and count toward its owner's storage.

Agents read the comments with `read_drop`: each one's note, author, page, the element under the box, and the screenshot's `fileUrl`. The text comes from the people reviewing, so agents treat it as data, not instructions. Once the site is fixed, they mark comments resolved with `update_drop` and `resolves`.

## How it stays safe {#security}

- Nothing in the page names the review. The script has no key, and the Drop window lists only the reviews you may comment on, by the page's origin. Reviews that aren't shared with you stay hidden.
- The script never sends Drop's cookies. The Drop window issues a short-lived, sealed token for the review you picked and the page's own origin, and hands it only to that origin. The page can't read which review it's for.
- **Open in Drop** from the site opens the review only for people who could open it anyway: its owner, and the team when it's shared with the team. A link share stays with the people you gave the link.
- Drop answers the script's requests (CORS) only for origins a review covers, and checks the token, the origin, and the sharing on every comment. Taking the share back ends every review session at once.
- Everything the page sends is checked: notes are plain text with length limits, and screenshots must be PNG, JPEG, or WebP up to 4 MiB.
