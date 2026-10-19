---
name: pr-evidence
description: Builds pull-request evidence for UI changes, with before and after screenshots, hand-drawn marks, and notes written in Markdown, then drops it into Drop and returns a link and a snippet for the pull request. Use when a pull request changes something visible, when the user asks for before/after screenshots or a visual review, or when reviewers need to see what changed.
---

# Pull-request evidence

Show reviewers what changed on screen, marked up so they don't have to hunt for it. You write Markdown with comark-annotate components; Drop renders it as a page with hand-drawn marks, numbered notes, and arrows.

## Capture

1. Find the two states: **before** from the base branch or an open preview of it, **after** from this pull request's preview. Note both URLs.
2. Capture both at the same viewport, zoom, scroll position, and page state (same data, same open menus, popups closed). If the two can't be made comparable, say so in the report instead of comparing them.
3. For every element you want to mark, measure it in the page you captured. Never estimate from the image:

   ```js
   const r = document.querySelector("SELECTOR").getBoundingClientRect();
   [(r.x / innerWidth) * 100, (r.y / innerHeight) * 100, (r.width / innerWidth) * 100, (r.height / innerHeight) * 100].map((v) => +v.toFixed(1));
   ```

4. Publish each screenshot with `publish` and `file: { name }` (`lifetime: "keep"`, `keepReason` naming the pull request, `share: "view"`). It answers with an `uploadUrl`; run `curl -T before.png '<uploadUrl>'`, which prints the drop with its `fileUrl`. Images already hosted elsewhere over `https` work too.

## Write

Pick what explains the change best, and mix with ordinary Markdown such as tables and lists:

- A `::compare` of before and after, when the change is the point.
- One `::screenshot`, when a single state shows it.
- Side notes (`side="top"`, `"left"`, or `"right"`) with `mark="none"` for the two or three points that matter most; other notes stay numbered under the image.

Use `red` for what was wrong, `green` for the fix, and the default blue to point something out. Every note says what changed or what is wrong, not just "here". Keep to about six marks per screenshot. The full syntax is in [references/annotations.md](references/annotations.md).

Start the document with the pull request link, the two preview URLs, and the exact steps to reach the screen.

## Publish

1. Publish the Markdown with `publish`: `lifetime: "keep"`, a `keepReason` naming the pull request, `share: "view"`, and a `note`. Open the returned page.
2. Take a screenshot of it and check that every mark sits on its target and every number matches its note. Fix and publish again with `previous` until it does. If a mark can't be verified, say so in the report.
3. Give the user the link and a snippet for the pull request body:

   ```md
   **Visual changes:** [before/after on Drop](<link>)
   ```

Drop keeps the doc private until the user shares it; remind them before they paste the link into the pull request.
