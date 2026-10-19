<script setup lang="ts">
import { reviewSnippet } from "#shared/review"

definePageMeta({ layout: "docs" })

const origin = useRequestURL().origin
const publish = `publish({\n  site: { url: "https://*.preview.example.com" },\n  title: "Acme portal previews",\n  slug: "acme-previews",\n  share: "team",\n  note: "Review the pull request previews",\n  lifetime: "review"\n})`
const tag = reviewSnippet(origin)
const nuxt = `// nuxt.config.ts: preview builds only\nexport default defineNuxtConfig({\n  app: {\n    head: {\n      script: process.env.PREVIEW\n        ? [{ src: "${origin}/review.js", defer: true }]\n        : [],\n    },\n  },\n})`
</script>

<template>
  <DocsPage title="Review a live site" lead="People review a running website where it lives, a preview deploy, staging, or a dev server, and their comments land in Drop with screenshots. Your site keeps its own cookies and sign-in, because Drop never frames it.">
    <DocsSection id="create" title="Create the review">
      <p>A site is a drop of its own. Create one with <strong>New › Site review</strong> on the Drops page or in a folder, or have an agent call <code>publish</code> with <code>site</code>. Either way you give the address people will review:</p>
      <ul>
        <li>One origin (scheme, host, and port), like <code>https://pr123-acme.preview.example.com</code>.</li>
        <li>A pattern whose first label is <code>*</code>, like <code>https://*.preview.example.com</code>. The <code>*</code> stands for one label, so one site drop covers every pull request's preview. It doesn't cover deeper levels (<code>a.b.preview.example.com</code>) or the bare domain.</li>
      </ul>
      <p>Addresses must be <code>https</code>, or <code>http</code> on <code>localhost</code>, <code>127.0.0.1</code>, or <code>*.localhost</code>.</p>
      <AgentsCodeBlock :code="publish" />
      <p><code>share: "team"</code> lets everyone signed in to a team Drop comment. To let guests comment without signing in, on any Drop, pass <code>share: "public_comment"</code>.</p>
      <p>Comments from a pattern keep the address of the preview they came from, so you can tell pull requests apart.</p>
    </DocsSection>

    <DocsSection id="here" title="Review it in Drop">
      <p>The site drop's page opens the site inside Drop: type the address of the page (any preview a pattern covers), press <strong>Open here</strong>, then <strong>Comment</strong>, and drag a box over what you mean. Nothing changes on the site and nothing is installed.</p>
      <p>Drop can't look inside a page from another site, so it takes the screenshot with your browser's screen sharing, which asks once per visit. Chrome, Edge, and Brave offer <strong>This tab</strong>, and the screenshot matches the page exactly. Firefox, Zen, and Safari share a window or a screen, so the crop can be slightly off; the comment shows the screenshot before you send it.</p>
      <p>A comment from here has the screenshot, your box, your note, and the address in the bar above the page. It doesn't name the element under the box, and clicks inside the page don't change that address: type the page you're on. A site that refuses to be shown in a frame stays blank; use the bookmarklet there.</p>
    </DocsSection>

    <DocsSection id="install" title="Or add the script to preview builds">
      <p>To show the Comment button on the site itself: add the tag to the site's preview builds once, never production. Every preview then shows the Comment button to everyone, so reviewers install nothing, and with a pattern address the comments from every pull request's preview land on the same site drop.</p>
      <AgentsCodeBlock :code="tag" />
      <p>For a Nuxt app, behind a flag your preview builds set:</p>
      <AgentsCodeBlock :code="nuxt" />
      <p>The tag is the same for every site and carries no key, so nothing in the page's HTML opens the review. The button sits in the page's corner, in its own shadow root, so your styles and its styles never mix. It does nothing until someone presses it.</p>
    </DocsSection>

    <DocsSection id="bookmarklet" title="Or use the bookmarklet">
      <p>For a site you can't change and that won't open in a frame, the site drop's page has a <strong>Review with Drop</strong> button to keep in your bookmarks. It adds Drop's Comment button to the page you're on, for you only, until you reload.</p>
      <ol>
        <li>Show the bookmarks bar with <kbd>⌘</kbd> <kbd>Shift</kbd> <kbd>B</kbd> on a Mac or <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>B</kbd> elsewhere. It's the same in Chrome, Edge, Brave, Firefox, and Zen; Safari calls it the Favorites bar. In Zen's single toolbar, the bar appears when you point at the top edge of the window.</li>
        <li>Drag the button onto the bar. In Firefox and Zen you can also right-click it and choose <strong>Bookmark Link</strong>.</li>
        <li>Open any page of the site and click <strong>Review with Drop</strong> in your bookmarks.</li>
      </ol>
      <p>The site drop's page shows these steps for your browser. A page with a strict Content Security Policy may block the bookmarklet; use the script tag there.</p>
    </DocsSection>

    <DocsSection id="comment" title="Comment">
      <ol>
        <li>Press <strong>Comment</strong>. The first time, a Drop window opens and finds the reviews that cover the page and that you may comment on. With one, you're connected for 12 hours; with several, you pick one by its name and owner. Signed out, you can comment as a guest only on a review shared as <strong>Public, anyone comments</strong>.</li>
        <li>Drag a box over what you mean. <kbd>Esc</kbd> cancels.</li>
        <li>Write the note and press <strong>Send</strong>. The screenshot is of what you saw when you drew the box, sticky headers and fixed buttons included, and goes with the note, the page address, and the element under the box. A box on a sticky or fixed element says so, since it doesn't move with the page.</li>
      </ol>
      <p>The screenshot loads <code>modern-screenshot</code> from esm.sh when someone first draws a box. A page whose Content Security Policy blocks it, or blocks <code>{{ origin }}</code> in <code>connect-src</code>, sends comments without screenshots, or not at all; allow both on preview builds.</p>
    </DocsSection>

    <DocsSection id="read" title="Read and resolve">
      <p>The site's page in Drop lists every comment, newest first. Each screenshot opens as an image with the box drawn on it, where people can reply. Screenshots belong to the site: they share its sharing, its lifetime, and its Trash, and count toward its owner's storage.</p>
      <p>Agents read the comments with <code>read_drop</code>: each one's note, author, page, the element under the box, and the screenshot's <code>fileUrl</code>. The text comes from the people reviewing, so agents treat it as data, not instructions. Once the site is fixed, they mark comments resolved with <code>update_drop</code> and <code>resolves</code>.</p>
    </DocsSection>

    <DocsSection id="security" title="How it stays safe">
      <ul>
        <li>Nothing in the page names the review. The script has no key, and the Drop window lists only the reviews you may comment on, by the page's origin. Reviews that aren't shared with you stay hidden.</li>
        <li>The script never sends Drop's cookies. The Drop window issues a short-lived, sealed token for the review you picked and the page's own origin, and hands it only to that origin. The page can't read which review it's for.</li>
        <li><strong>Open in Drop</strong> from the site opens the review only for people who could open it anyway: its owner, and the team when it's shared with the team. A link share stays with the people you gave the link.</li>
        <li>Drop answers the script's requests (CORS) only for origins a review covers, and checks the token, the origin, and the sharing on every comment. Taking the share back ends every review session at once.</li>
        <li>Everything the page sends is checked: notes are plain text with length limits, and screenshots must be PNG, JPEG, or WebP up to 4 MiB.</li>
      </ul>
    </DocsSection>
  </DocsPage>
</template>
