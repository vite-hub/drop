---
name: pr-evidence
description: Builds pull-request evidence for UI changes, with before and after screenshots, hand-drawn marks, and notes written in Markdown, then drops it into Drop and returns a link and a snippet for the pull request. Use when a pull request changes something visible, when the user asks for before/after screenshots or a visual review, or when reviewers need to see what changed.
---

# Pull-request evidence

Show reviewers what changed on screen, marked up so they don't have to hunt for it. You write Markdown with comark-annotate components; Drop renders it as a page with hand-drawn marks, numbered notes, and arrows.

## Where it lives

Call `list_folders` first. If a folder's description says it's for pull request evidence, publish every screenshot and the doc into it with `folder`, and follow what its description asks; they need no `lifetime`, since they live with the folder. Otherwise pass `lifetime: "keep"` and a `keepReason` naming the pull request.

## Capture

1. Find the two states: **before** from the base branch or an open preview of it, **after** from this pull request's preview. Note both URLs.
2. Capture both at the same viewport, zoom, scroll position, and page state (same data, same open menus, popups closed). The change has to be visible in what you capture. If the data or the state can't show it, set that up first; if you can't, or the two can't be made comparable, stop and report the gap instead of publishing.
3. For every element you want to mark, measure it in the page you captured. Never estimate from the image:

   ```js
   const r = document.querySelector("SELECTOR").getBoundingClientRect();
   [(r.x / innerWidth) * 100, (r.y / innerHeight) * 100, (r.width / innerWidth) * 100, (r.height / innerHeight) * 100].map((v) => +v.toFixed(1));
   ```

4. Publish each screenshot with `publish` and `file: { name }` (`share: "public"`, plus the folder or lifetime from [Where it lives](#where-it-lives)). It answers with an `uploadUrl`; run `curl -T before.png '<uploadUrl>'`, which prints the drop with its `fileUrl`. Images already hosted elsewhere over `https` work too.

## Write

The screenshots are the evidence; the text only points into them. Pick:

- A `::compare` of before and after, when the change is the point.
- One `::screenshot`, when a single state shows it.
- Side notes (`side="top"`, `"left"`, or `"right"`) with `mark="none"` for the two or three points that matter most; other notes stay numbered under the image.

Use `red` for what was wrong, `green` for the fix, and the default blue to point something out. Every mark sits on the change, and its note says in a few words what changed or what is wrong, not just "here". Keep to about six marks per screenshot. The full syntax is in [references/annotations.md](references/annotations.md).

Above the screenshots, write one line with the steps to reach the screen. Each preview URL goes in its screenshot's `url`, not in the text. No tables or paragraphs that describe what the images show, and never a doc that explains a change it doesn't show.

## Publish

1. Publish the Markdown with `publish`: `share: "public"`, the folder or lifetime from [Where it lives](#where-it-lives), and a `note`. Open the returned page.
2. Take a screenshot of it and check that every mark sits on its target and every number matches its note. Fix and publish again with `previous` until it does. If a mark can't be verified, say so in the report.
3. Give the user the link and a snippet for the pull request body, placed where the repository's pull request rules say:

   ```md
   [Before/after on Drop](<link>)
   ```

The doc is a public link, so anyone with the pull request can open it. On some Drops public links close after a few days (`publicUntil` says when); tell the user the date if there is one.
