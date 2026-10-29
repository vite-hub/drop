---
name: prototype
description: Prototypes a UI several radically different ways on one Drop page with a shared picker, so people switch between them, comment, and pick one; each round of feedback becomes the next version. Use when the user asks to prototype a screen, section, flow, or widget, compare design directions, or try a UI several ways.
---

# Prototype

A prototype is throwaway code that answers one design question. You build several answers to it in one HTML page, people compare them in Drop and comment, and each round of feedback becomes the page's next version. Publishing, sharing, and reading comments work as in the `vitehub-drop` skill.

## 1. Name the question

Write the question in one sentence, such as "Which hero makes the forecasting idea obvious in five seconds?" Then decide what stays the same in every variant (the copy, the data, the rest of the page) and what varies. A variant is only worth comparing when everything else is equal.

Done when the question fits in one sentence and you can list what stays fixed.

## 2. Pick the directions

Choose 3 to 6 directions that differ in their idea: layout, metaphor, density, interaction. Two colour schemes of one layout are one direction. Give each a short label and a one-line note that says what it tries, such as "Prism: demand splits into three outputs". If two notes could swap labels, replace one of them.

Done when every variant has a label and a note that no other variant could carry.

## 3. Build one page

Build a single self-contained HTML page. Each variant is a `<section>` directly inside `<body>`:

```html
<section id="v-prism" data-variant="Prism" data-note="Demand splits into three outputs">…</section>
<section id="v-glyphs" data-variant="Glyphs" data-note="ASCII density field that ripples on hover">…</section>
```

- `id` is `v-` and the label in lowercase words and dashes. Every other id inside a variant starts with the variant's id (`v-prism-pricing`), so each comment's anchor names its variant.
- Use the same real content in every variant: the product's copy, plausible data, the page around the part that varies. Lorem ipsum hides the question.
- Load libraries from a CDN URL such as `https://esm.sh/three`. A variant that animates listens for `variantchange` on `document` and runs only while `event.detail.visible` includes its id.
- End `<body>` with a `<script>` holding [assets/picker.js](assets/picker.js), copied unchanged. It shows one variant at a time, switches with the ← and → keys or 1–9, opens the variant in the URL hash (`#v-…`), and remembers the last one. Every prototype gets the same picker, so reviewers learn it once.
- Draw no picker, bar, or variant switcher of your own; the sections are all you declare. Opened on its own, the page shows the picker's bar at the bottom. In Drop, Drop's bottom bar lists the variants instead, next to its review tools, and Drop runs its current picker in place of the copy you pasted.
- When the variants should be compared side by side at their real sizes (a phone beside a desktop, or more than four variants), give each section a size and open the page in the canvas. See [references/canvas.md](references/canvas.md).

If you can open a browser, open the page locally and step through every variant: each renders, the console is clean, and the picker's bar lists them all.

## 4. Publish the first round

Call `list_folders` and use the folder that fits, as `vitehub-drop` says. Publish with `publish`: `html`, a `title`, a `slug`, `lifetime: "temporary"` unless it goes in a folder, and a `note` that states the question and lists the variants. Fix every warning in the answer and publish again with `previous` until there are none.

Give the user the link and tell reviewers how to answer: switch with the variants in Drop's bottom bar, ← and →, or 1–9, comment on the parts they like or dislike, and say in a comment which variant to keep or what to combine.

## 5. Read the round

Call `read_drop`. Sort every open comment into its variant: an anchor shows `in #v-…`, and otherwise the quoted text or the element's first words are in that variant's section of your source. A comment on the whole page that names no variant gets a `reply` asking which one it means.

For each variant decide: keep, drop, or merge into another. Done when every open comment sits under a variant or has a question waiting for an answer.

## 6. Publish the next round

Publish the next version with `previous`, a `note` that says what each reviewer's comment changed, and `resolves` with the comments you addressed. Keep the `id` of every variant you keep, so its comments stay pinned; remove the dropped ones and add merged ones as new variants. Repeat from step 5 until the user picks one.

## 7. Capture the verdict

Publish a last version, or reply in the deciding comment, with the verdict: the variant chosen, why, and what was rejected. Then tell the user the verdict and what to carry into the real code. Port the idea into the codebase's own components and styles; the prototype's markup stays in Drop.

## A prototype that needs several files

Prefer one HTML page: its versions keep every round, and comments follow the variants across them. When a prototype truly needs several files, publish it as an app with `files`, keep the same `<section>` structure and picker in its `index.html`, and tell the user that an app keeps only its latest version, so earlier rounds can't be reopened.

Inspired by Matt Pocock's [prototype skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/prototype/SKILL.md).
