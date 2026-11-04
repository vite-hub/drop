---
name: prototype
description: Builds several genuinely different versions of a UI as items on one Drop canvas, side by side and live, so people compare them, comment on the one they mean, and pick one; each round of feedback becomes the next version. Use when the user asks to prototype a screen, flow, or widget, wants UI options, variants, or directions to pick from, or wants live previews (PR deployments) next to sketches on a canvas.
---

# Prototype

A prototype is throwaway code that answers one design question. You build several answers in one HTML page; Drop opens it as a canvas with every answer side by side at its real size, people comment on the items and pick one, and each round becomes the page's next version. Publishing, sharing, and reading comments work as in the `vitehub-drop` skill.

## 1. Name the question

Write the question in one sentence, such as "Which pricing card makes Team the obvious choice?" Then list what stays the same in every item (the copy, the data, the page around the part that varies) and what varies.

Done when the question fits in one sentence and you can list what stays fixed.

## 2. Pick the directions

Choose 3 to 6 directions that differ in their idea: layout, metaphor, density, interaction. Two colour schemes of one layout are one direction. Name each item `Thing · variation`, such as `Pricing card · compact` or `Hero · split image`, and give it a one-line note that says what it tries. People and agents point at items by that name ("make Hero · split image denser"), so keep names unique and sayable; `Variant B` says nothing. If two notes could swap names, replace one of them.

Done when every item has a name and a note no other item could carry.

## 3. Build one page

One self-contained HTML page. Each item is a `<section>` directly inside `<body>`:

```html
<section id="v-pricing-tiers" data-variant="Pricing · three tiers" data-note="Free, Team, Business; Team highlighted" data-width="1280">…</section>
<section id="v-pricing-mobile" data-variant="Pricing · mobile stack" data-note="One card per plan, Team first" data-width="390" data-height="844">…</section>
```

- `id` is `v-` and the name in lowercase words and dashes. Every other id inside an item starts with the item's id (`v-pricing-tiers-cta`), so each comment's anchor names its item.
- `data-width` is the item's real width in pixels (default 1280). `data-height` fixes its height and scrolls the rest; leave it out and the item is as tall as its content.
- Use the product's real copy and plausible data in every item. Lorem ipsum hides the question.
- Make the items live: real inputs, hovers, menus. Load libraries from a CDN such as `https://esm.sh/three`.
- Put everything visible inside a section. Draw no switcher, bar, or picker of your own, and paste no picker script: Drop runs its own on every page with `data-variant` items.

Canvas details (URL items for live previews, tooltips and menus Drop can hold open, animation, opting out) are in [references/canvas.md](references/canvas.md). Read it when an item shows a deployed page, has a popover, or animates.

If you can open a browser, open the page and check every item renders and the console is clean.

## 4. Publish the first round

Call `list_folders` and use the folder that fits, as `vitehub-drop` says. Publish ONE page with `publish`: `html`, a `title`, a `slug`, `lifetime: "temporary"` unless it goes in a folder, and a `note` that states the question and lists the items. Fix every warning in the answer and publish again with `previous` until there are none. One page holds every item; a doc of links or one drop per item splits the comments and the comparison.

Give the user that link first, then tell reviewers how to answer: the page opens on the canvas; click a name to copy it, double-click it (or press 1–9) to open the item full size and ← → to step, Esc to go back; comment on the parts they like or dislike, and say in a comment which item to keep or what to combine.

## 5. Read the round

Call `read_drop`. Sort every open comment into its item: an anchor shows `in #v-…`, and otherwise the quoted text or the element's first words are in that item's section of your source. A comment on the whole page that names no item gets a `reply` asking which one it means.

For each item decide: keep, drop, change, or try another. Done when every open comment sits under an item or has a question waiting for an answer.

## 6. Publish the next round

- "Change this one": edit that section in place. Keep its `id` and name, so its comments stay pinned and its spot on the canvas stays.
- "Try another": add a new section with a new `id` and name, and keep the original.
- "Drop it": remove only that section.

Publish with `previous`, a `note` that says what each reviewer's comment changed, and `resolves` with the comments you addressed. Repeat from step 5 until the user picks one.

## 7. Capture the verdict

Publish a last version, or reply in the deciding comment, with the verdict: the item chosen, why, and what was rejected. Then tell the user the verdict and what to carry into the real code. Port the idea into the codebase's own components and styles; the prototype's markup stays in Drop.

## A prototype that needs several files

Prefer one HTML page: its versions keep every round, and comments follow the items across them. When a prototype truly needs several files, publish it as an app with `files`, keep the same `<section>` items in its `index.html`, and tell the user that an app keeps only its latest version, so earlier rounds can't be reopened.

Canvas after ibelick's [create-canvas](https://github.com/ibelick/ui-skills/blob/main/skills/create-canvas/SKILL.md); rounds after Matt Pocock's [prototype](https://github.com/mattpocock/skills/blob/main/skills/engineering/prototype/SKILL.md).
