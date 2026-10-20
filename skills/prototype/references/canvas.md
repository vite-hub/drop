# Canvas

The picker shows one variant at a time. The canvas shows every variant side by side, at its real size, on a plane people pan and zoom. Both come from the same page and the same [picker.js](../assets/picker.js); readers switch with the Canvas button or the C key.

## When to open in the canvas

Open the page in the canvas when the comparison needs it:

- Size matters: a phone layout beside a desktop one, or a card at its real width.
- There are more than four variants, and flipping through them hides the differences.
- The question is answered at a glance: density, rhythm, how much fits above the fold.

Keep the picker for full-page variants that each fill the screen, or when one variant should get the reader's full attention.

## Declare the items

Each variant is still a `<section>` directly inside `<body>`, with `id`, `data-variant`, and `data-note` as in the skill. Two attributes set its size on the canvas:

```html
<body data-layout="canvas">
  <section id="v-tiers" data-variant="Pricing · three tiers" data-note="Free, Team, Business; Team highlighted" data-width="1280">…</section>
  <section id="v-mobile" data-variant="Pricing · mobile stack" data-note="One card per plan, Team first" data-width="390" data-height="844">…</section>
</body>
```

- `data-width` is the width in pixels. The default is 1280.
- `data-height` fixes the height and scrolls the rest inside the section. Leave it out and the section is as tall as its content.
- `data-layout="canvas"` on `<body>` opens the canvas first. A reader's own choice wins after that.
- Put everything visible inside a section. On the canvas, content outside the sections sits under them.
- In the canvas every variant is visible at once, so `variantchange` lists them all in `event.detail.visible`. A variant that animates checks `visible.includes(its id)`, not `id`.

## Name each item so people can say it

The name is how people and agents point at an item: "make Pricing · mobile stack denser". Write it as `Thing · variation`, such as `Pricing card · compact` or `Hero · split image`. Keep every name unique on the page, and keep it readable. `v-2` or `Variant B` says nothing.

Clicking a name copies it. Reviewers paste it into chat, or comment on the item in Drop.

## Change the page between rounds

- "Try another version" adds a new section with a new `id` and a new name. Keep the original.
- "Change this one" edits that section in place. Keep its `id` and name unless asked to rename it.
- "Remove it" deletes only that section.
- When the variants compare one thing, keep the copy, data, and sizes the same in all of them.

The canvas remembers each reader's camera and positions by section `id`. Keeping ids keeps both, and Drop keeps each comment pinned to the section it was left on.

## Read the comments

A comment left on an item anchors inside its section, so its anchor shows `in #v-…`. Sort the comments by that id, as step 5 of the skill says.

Inspired by ibelick's [create-canvas](https://github.com/ibelick/ui-skills/blob/main/skills/create-canvas/SKILL.md) skill.
