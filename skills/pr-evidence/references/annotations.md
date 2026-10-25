# Annotation syntax

Drop renders these components with [comark-annotate](https://comark.onmax.me/annotate/) and [comark-diff](https://comark.onmax.me/diff/).

```md
::compare
:::screenshot{src="https://example.com/before.png" alt="Filter toolbar wrapping onto a second row" viewport="1440x900" href="https://pr12.preview.example.com/plan"}
::::annotation{x=3.6 y=20.6 w=92.9 h=31.4 color="red"}
Five filters don't fit, so the toolbar wraps and pushes the table down.
::::
:::

:::screenshot{src="https://example.com/after.png" alt="Filter toolbar on one row" viewport="1440x900"}
::::annotation{x=87.6 y=24.2 w=7.4 h=9.9 mark="check" color="green"}
**Apply** lines up with the chips.
::::

::::annotation{x=66.4 y=16.4 w=29.4 h=22.2 mark="none" side="top"}
Accuracy now counts returns.
::::
:::
::
```

## `::screenshot`

| Prop | |
| --- | --- |
| `src` | Image URL. Required. |
| `alt` | What the screenshot shows. Required. |
| `title` | Heading above the image, and the title of its zoomed view. A compare labels its two sides Before and After by default. |
| `href` | The page you captured, linked by its host next to the title. |
| `viewport` | Capture size, like `1440x900`. A compare reports an issue when the two sides differ. |

Other content inside the block becomes the caption.

## `::annotation`

Direct children of a screenshot. The content is the note.

| Prop | |
| --- | --- |
| `x` `y` `w` `h` | The marked area as percentages of the image, 0 to 100. |
| `mark` | `box` (default), `circle`, `underline`, `highlight`, `cross`, `check`, or `none`. |
| `side` | `top`, `left`, or `right` puts the note outside the image with a hand-drawn arrow. Keep top notes a quarter of the image apart, left and right notes an eighth. |
| `color` | `blue` (default), `red`, `amber`, `green`, `gray`, or a hex color. |

## `::compare`

Exactly two screenshots, before then after. Numbers continue from the first to the second.

## `::diff`

Two fenced blocks, the file before and after. The first block's fence names the file.

````md
::diff{line=14}
```vue [app/pages/dashboard.vue]
<NuxtPage v-if="isChildRoute" />
<main v-show="!isChildRoute">
  <DashboardOverview />
</main>
```
```vue
<OverviewWithChild>
  <DashboardOverview />
</OverviewWithChild>
```
::
````

| Prop | |
| --- | --- |
| `line` | The line in the file where both blocks start. Without it, the diff has no line numbers. |
| `label` | A heading before the file name, such as `Suggested change`. |
| `file` | The file's path, when the fence doesn't name it. |

Leave the before block empty for a new file, or the after block for a deleted one. A block holds at most 200 lines.

When something is wrong with the document, Drop lists every problem with the block it belongs to. Fix each one and publish again.
