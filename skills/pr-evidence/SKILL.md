---
name: pr-evidence
description: Builds pull-request evidence for UI changes, with before and after screenshots, hand-drawn marks, and notes written in Markdown, then drops it into Drop and comments its link on the pull request. Use when a pull request changes something visible, when the user asks for before/after screenshots or a visual review, or when reviewers need to see what changed.
---

# Pull-request evidence

Show reviewers what changed on screen, marked up so they don't have to hunt for it. You write Markdown with comark-annotate components; Drop renders it as a page with hand-drawn marks, numbered notes, and arrows.

## Where it lives

Call `list_folders` first. If a folder's description says it's for pull request evidence, publish every screenshot and the doc into it with `folder`, and follow what its description asks; they need no `lifetime`, since they live with the folder. Otherwise pass `lifetime: "keep"` and a `keepReason` naming the pull request.

## Capture

1. Find the two states: **after** from this pull request's preview, **before** from any running deploy that still has the old behavior, such as another open pull request's preview that doesn't touch this change. Note both URLs.
2. Capture both at the same viewport, zoom, scroll position, and page state (same data, same open menus, popups closed). The change has to be visible in what you capture. If the data or the state can't show it, set that up first. A compare shows each image at under half the page width, where a full-page capture's text is too small to read, so clip both to the same region around the change, such as Playwright's `screenshot({ clip })`. A doc with only one of the two states, or a description in place of a screenshot, isn't evidence: if you can't capture both comparably, publish nothing: no new drop and no new version of an existing one. Your final answer says what blocked you.
3. For every element you want to mark, measure it in the page you captured. Never estimate from the image:

   ```js
   const r = document.querySelector("SELECTOR").getBoundingClientRect();
   [(r.x / innerWidth) * 100, (r.y / innerHeight) * 100, (r.width / innerWidth) * 100, (r.height / innerHeight) * 100].map((v) => +v.toFixed(1));
   ```

   For a clipped capture, subtract the clip's `x` and `y` and divide by its `width` and `height`.

4. Publish each screenshot with `publish` and `file: { name }` (`share: "public"`, plus the folder or lifetime from [Where it lives](#where-it-lives)). It answers with an `uploadUrl`; run `curl -T before.png '<uploadUrl>'`, which prints the drop with its `fileUrl`. Images already hosted elsewhere over `https` work too.

## Write

The screenshots are the evidence; the text only points into them. Pick:

- A `::compare` of before and after, when the change is the point.
- One `::screenshot`, when a single state shows it.
- Side notes (`side="top"`, `"left"`, or `"right"`) with `mark="none"` for the two or three points that matter most; other notes stay numbered under the image.

Use `red` for what was wrong, `green` for the fix, and the default blue to point something out. Mark the change at its own size: the bar, field, or label that changed. What stayed the same goes unmarked; the steps line says how the screen was set up. Keep to about six marks per screenshot, fewer in a compare. Each note says in a few words what changed or what is wrong, in the words the screen shows, so the reader can check it against the image; a value the screenshot doesn't show stays out of the note. The full syntax is in [references/annotations.md](references/annotations.md).

Above the screenshots, write one line with the steps to reach the screen. Each preview URL goes in its screenshot's `href`, not in the text. No tables or paragraphs that describe what the images show, and never a doc that explains a change it doesn't show.

The doc shows the change; how the work went (the checks you ran, retries, CI counts, who has reviewed) belongs in your report to the user. When you're asked to put that report in the doc, end it with one `## For <name>` section of at most five bullets: the verdict first (ready, or blocked and why), the cause in one sentence, each decision they have to make as a question, and anything you couldn't check. A side question gets its answer in one line there.

## Publish

1. Write the doc from these rules and fresh captures each time. For a next version, read the earlier one only for its open comments; don't start from its text or its conclusions. Each version replaces the whole doc, and its `note` says what changed. Publish the Markdown with `publish`: `share: "public"`, the folder or lifetime from [Where it lives](#where-it-lives), a `note`, and `resources`: the pull request's URL with the title `PR #<number>`, and the after preview's URL with the title `Preview`. They show with their sites' icons at the top of the page. Pass them again with each version; one already there isn't added twice. Open the returned page.
2. Take a screenshot of it and check that every mark sits on its target and every number matches its note. Fix and publish again with `previous` until it does. If a mark can't be verified, say so in the report.
3. Comment the link on the pull request, so the pull request leads to the doc as the doc leads to it:

   ```md
   [Before/after on Drop](<link>)
   ```

   Read its description and comments first. If the link is already there, as after an earlier version, leave it: it always opens the latest version. If the repository's pull request rules say where evidence goes, such as the description, put it there instead. Post with `gh pr comment <pull request URL> --body '<snippet>'` or the GitHub tool you have; if you can't post, give the user the snippet. Tell the user where it went.

The doc is a public link, so anyone with the pull request can open it. On some Drops public links close after a few days (`publicUntil` says when); tell the user the date if there is one.
