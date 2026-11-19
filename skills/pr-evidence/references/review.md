# Review markup in Drop

Use these Comark blocks in the Markdown you publish to Drop. The snippets show syntax; use the actual text, file paths, screenshot URLs, and measurements from your change.

## Comments

```md
Select :suggestion[Save draft]{from="Save" note="Make it clear this does not publish."}.

The link expires after :comment[one hour]{#expiry note="Is that enough time to review?"}.

:comment{reply="expiry" note="The owner can generate another link."}
```

Use `:suggestion[new]{from="old" note="reason"}` for a replacement. Leave `from` out for an insertion; use `:suggestion[]{from="old" note="reason"}` for a deletion. Use `:comment[words]{note="question or reason"}` for feedback that does not propose a replacement. Both accept `by` for the author and `#id` to anchor a thread; a reply uses `reply="id"` without the `#`. Mark each span once in a paragraph or list item, not in a heading or table cell.

## Annotations

```md
::compare
:::screenshot{src="https://example.com/before.png" alt="Filters wrap to a second row" viewport="1440x900"}
::::annotation{x=12 y=18 w=36 h=9 color="red"}
The filters wrap and push the results down.
::::
:::

:::screenshot{src="https://example.com/after.png" alt="Filters fit on one row" viewport="1440x900"}
::::annotation{x=12 y=18 w=36 h=5 side="top" mark="none" to="24,20"}
The controls now fit on one line.
::::
:::
::
```

- Use one `::screenshot` for a single state or two nested `:::screenshot` blocks in `::compare`. The default compare is side by side; set `mode="slider"` when the images line up and the reader should drag between them. Capture both at the same viewport, crop, zoom, and scroll position.
- Each screenshot needs `src` (the uploaded image URL) and `alt`. Optional attributes include `viewport`, `title`, and `href` (the page in the screenshot).
- Put each `annotation` directly inside its screenshot, with enough colons to nest it. Measure `x`, `y`, `w`, and `h` in the actual image: subtract the capture's origin from the element's top-left, then divide the horizontal values by image width and vertical values by image height. Multiply each result by 100 and omit `%`.
- `mark` accepts `box` (default), `circle`, `underline`, `line`, `highlight`, `bracket`, `cross`, `check`, or `none`. `color` accepts `violet`, `red`, `amber`, `green`, `blue`, `gray`, or a three- or six-digit hex color.
- Use `side="top"`, `"bottom"`, `"left"`, or `"right"` for a margin note with an arrow. `mark="none"` needs a side and draws just the arrow. `at` sets the note's position along the margin as a percentage, and `to="x,y"` aims the arrow at a point in image percentages. Omit `side` for a numbered note below the image. In a side-by-side comparison, only top and bottom notes keep their arrows; slider notes are numbered.

## Diff

````md
::diff{file="src/review.ts" line=42 label="Clarify the save action"}
```ts
const label = "Save";
```
```ts
const label = "Save draft";
```
::
````

Use exactly two fenced blocks in the same language: before, then after. Set `file` to the file's path (or name it on the first fence with `[src/review.ts]`), and set `line` to the positive starting line number shared by the two snippets. For a new file, leave the first fence empty; for a deletion, leave the second empty. Show one file per block and put prose outside it. Do not put unified `diff` or `patch` text inside `::diff`.
