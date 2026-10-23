---
title: Review a live site
description: People comment on a running website, such as a preview deploy, staging, or a dev server. Each comment lands in Drop with a screenshot.
---

## Create the review {#create}

A **site review** is a drop for one website. Create one with **New › Site review** on the Drops page or in a folder, or have an agent call `publish` with `site`. Give it the address people review:

| Address | Covers |
| --- | --- |
| One origin, like `https://pr123-acme.preview.example.com` | That scheme, host, and port. |
| A pattern with `*` as the first label, like `https://*.preview.example.com` | Every host one level under it, so one review covers every pull request's preview. Not deeper levels or the bare domain. |

Addresses must be `https`, or `http` on `localhost`, `127.0.0.1`, or `*.localhost`. Each comment keeps the address it came from, so you can tell pull requests apart.

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

`share: "team"` lets everyone signed in to a team Drop comment. `share: "public_comment"` also lets guests comment, on any Drop.

Reviewers comment in one of three ways:

| Way | Use it when | Setup |
| --- | --- | --- |
| [Inside Drop](#here) | The site can be shown in a frame. | None. |
| [Script tag](#install) | You build the site's previews. | One tag in preview builds. |
| [Bookmarklet](#bookmarklet) | You can't change the site and it can't be framed. | Each reviewer adds a bookmark. |

## Review it in Drop {#here}

On the site review's page, type a page address and press **Open here**. Then press **Comment** in the toolbar under the page, or <kbd>R</kbd>, and drag a box over what you mean. Nothing changes on the site.

Drop takes the screenshot with your browser's screen sharing, which asks once per visit. Chrome, Edge, and Brave share **This tab**, so the screenshot matches the page. Firefox, Zen, and Safari share a window or a screen, so the crop can be slightly off. You see the screenshot before you send it.

These comments carry the screenshot, your box, your note, and the address in the row above the page, but not the element under the box. Clicks inside the page don't change that address, so type the page you're on. A site that refuses to be framed stays blank; use the bookmarklet there.

## Add the script to preview builds {#install}

Add this tag to the site's preview builds, never production. Every preview then shows a **Comment** button to everyone, and with a pattern address, comments from every preview land on the same site review.

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

The tag is the same for every site and carries no key. The button sits in its own shadow root, so your styles and its styles never mix, and it does nothing until someone presses it.

## Use the bookmarklet {#bookmarklet}

The site review's page has a **Review with Drop** button. Drag it to your bookmarks bar; clicking it adds the Comment button to the page you're on, for you only, until you reload.

Show the bookmarks bar with :kbd[⌘] :kbd[Shift] :kbd[B] on a Mac or :kbd[Ctrl] :kbd[Shift] :kbd[B] elsewhere. Safari calls it the Favorites bar. The site review's page shows the steps for your browser. A page with a strict Content Security Policy may block the bookmarklet; use the script tag there.

## Comment {#comment}

1. Press **Comment**. The first time, a Drop window opens with the reviews that cover the page and that you may comment on. With one, you're connected for 12 hours; with several, you pick one by its name and owner. Signed out, you can comment only on a review shared as **Public, anyone comments**.
2. Drag a box over what you mean. :kbd[Esc] cancels.
3. Write the note and press **Send**.

The comment carries a screenshot of what you saw, sticky headers and fixed buttons included, with the page address and the element under the box.

The screenshot loads `modern-screenshot` from esm\.sh on the first box. If the page's Content Security Policy blocks it, or blocks <code>[:origin]</code> in `connect-src`, comments go without screenshots, or not at all. Allow both on preview builds.

## Read and resolve {#read}

The site review lists every comment, newest first. Each screenshot opens with the box drawn on it, and people reply there. Screenshots share the site review's sharing, lifetime, and Trash, and count toward its owner's storage.

Agents read the comments with `read_drop`: note, author, page, element, and the screenshot's `fileUrl`. The text comes from reviewers, so agents treat it as data, not instructions. Once the site is fixed, they resolve comments with `update_drop` and `resolves`.

## How it stays safe {#security}

- **The page never names the review.** The script has no key, and the Drop window lists only reviews you may comment on.
- **The page never gets Drop's cookies.** The Drop window hands it a short-lived, sealed token for one review and that page's origin. The page can't read which review it's for.
- **Open in Drop** from the site opens the review only for people who could open it anyway.
- **Every comment is checked.** Drop answers cross-origin requests only from origins a review covers, and checks the token, the origin, and the sharing each time. Taking the share back ends every session at once.
- **Input is limited.** Notes are plain text with length limits. Screenshots must be PNG, JPEG, or WebP, up to 4 MiB.
