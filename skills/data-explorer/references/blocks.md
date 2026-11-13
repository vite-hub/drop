# report.json reference

```json
{
  "title": "shoplens",
  "subtitle": "Till exports · Jan 2024 to Jun 2026",
  "intro": "What sells, where, and whether customers come back. Data from the till exports.",
  "source": { "label": "Till exports", "url": "https://example.com/exports" },
  "updated": "2026-07-01",
  "search": "Search titles",
  "filters": [
    { "field": "period", "type": "tabs", "options": ["12 months", "30 days", "All time"] },
    { "field": "store", "type": "list", "label": "Stores", "count": "sales" },
    { "field": "genre", "type": "list", "label": "Genres", "count": "sales" },
    { "field": "gift", "type": "toggle", "label": "Include gift cards" }
  ],
  "data": {
    "totals": [{ "period": "12 months", "store": "North", "revenue": 41800, "orders": 2210 }],
    "byStore": [{ "period": "12 months", "store": "North", "fiction": 1840, "nonfiction": 960, "end": "2,800 · 66% fiction" }],
    "sales": [{ "period": "12 months", "date": "2026-06-28", "store": "North", "genre": "Fiction", "title": "The Long Way", "copies": 3, "gift": false }]
  },
  "top": [{ "type": "stats", "items": [{ "label": "revenue", "value": { "data": "totals", "field": "revenue" }, "format": "money", "hint": "in this period" }] }],
  "views": [
    {
      "id": "overview",
      "label": "Overview",
      "blocks": [
        { "type": "facts", "items": [{ "value": "66%", "text": "of copies sold are fiction, up from 58% last year." }] },
        { "type": "bars", "title": "Copies by store", "data": "byStore", "label": "store", "segments": ["fiction", "nonfiction"], "names": { "fiction": "Fiction", "nonfiction": "Non-fiction" }, "end": "end" }
      ]
    }
  ],
  "bottom": [{ "type": "table", "style": "rows", "title": "Sales", "data": "sales", "columns": [{ "field": "date", "format": "date" }, { "field": "store", "format": "entity" }, { "field": "genre", "format": "entity" }, { "field": "title", "truncate": true }, { "field": "copies" }], "sort": "date", "limit": 20, "more": 50 }],
  "method": "Markdown: paragraphs, `- ` lists, **bold**, `code`, [links](https://…)."
}
```

## Limits

| Text | Limit |
| --- | --- |
| `title` | 40 characters |
| `subtitle` | 60 characters |
| `intro` | 280 characters, two sentences (shown on the Method tab) |
| tab `label` | 22 characters |
| tab `summary` (optional) | 140 characters, one sentence |
| block `title` | 60 characters |
| block `note` | 120 characters, one sentence |
| fact `text` | 110 characters, one sentence |
| `method` | 1,600 characters |
| stat `label` | 28 characters |
| stat `hint` | 32 characters |
| tabs 7, blocks per tab 8, series per chart 12, table columns 9, `top` 2 blocks, `bottom` 1 block |
| `stats` 6 items, `facts` 4 items |
| `bars` 30 rows and bar charts 40 bars, unless `limit` keeps fewer; matrix 24 columns, or swap `x` and `y` |
| data 3 MB in all |

A view `id` is kebab-case, and `method` is taken by the Method tab. A key the reference doesn't list is an error. Notes, fact `text`, tab `summary`, `intro` and `method` take `**bold**`, `` `code` `` and links; titles and labels print as written.

## Which block for which question

| Question shape | Block |
| --- | --- |
| Headline numbers | `stats` in `top` |
| The answer to the request | `facts`, first tab |
| A number over time | `chart` `line`; `bar` for one series with 15 periods or fewer |
| Share of a whole over time | `chart` `stacked` with `"stack": "percent"`, or `area` |
| Ranking of names, or a whole split per name | `bars` (one `value`, or `segments` that add up) |
| Many numbers per name | `table` with `entity`, `bar`, `stack`, `chips` and `percent` columns |
| Two categories crossed (customer × type, cohort × year) | `matrix` |
| Two numbers per item | `chart` `scatter`, `logX`/`logY` when values span 100× or more |
| Spread of one number | `chart` `histogram`, `logToggle` when it's skewed |
| A lookup of one item | `table` with `search: true`, or the report's `search` |
| The rows behind the numbers | `table` with `"style": "rows"` in `bottom` |

## Layout

Blocks sit in two columns. Charts and `bars` take half a row, so put related ones next to each other; tables, `stats` and `facts` take the full row. A matrix takes the full row unless it fits in half, so a small grid sits next to the block after it. A half block left alone in its row grows to the full row. `"wide": true` or `"half": true` fixes a block's width.

## Colors

Every value of a `list` filter gets one color, wherever its field appears (SKILL.md step 3). Catch-all values (`Not set`, `Unknown`, `None`, `No …`, `Other …`, `Rest of …`) sort last and stay gray, so name a folded tail that way, and rename a real name that looks like one. For anything else, `tones` sets colors in order: `good`, `fair`, `warn`, `bad`, `muted`, `accent`, a palette index, or a `#hex`. Use the semantic tones for scales that run from good to bad (answered → only the team knows).

## Blocks

Every block takes `title` and `note` (a `note` needs a `title`), and every block but `stats` and `facts` takes `wide` and `half`.

**stats** (in `top`): `items` of `{ label, value, format, unit, delta, deltaFormat, good, hint }`. `value` and `delta` are a number, or `{ "data", "field", "agg", "where" }` computed on the filtered rows; `agg` is `sum` (default), `count` (counts the rows when there's no `field`), `mean`, `min`, `max`, `first`, `last`. A trailing unit (`%`, `K`, `h`) prints small. `format: "percent"` takes a 0–1 value. `delta` prints signed, green when up unless `"good": "down"`, as a percent of a 0–1 change unless `deltaFormat` says otherwise (`number`, `integer`, `compact`, `money`).

**facts**: 2 to 4 `items` of `{ value, text }`. `value` is a short string ("53%", "10 of 19", "1.4 h") or a number with `format`; `text` is one sentence that says what it means.

**bars**: horizontal bars in HTML, one row per `label`. Either `value` (one number) or `segments` (fields that add up to the bar, with `names` and `tones`, and a legend). `end` is a field printed after the bar, like `"55 · 47% today"`, built in the prep script; without it the total prints. `percent: true` makes every bar full width. Sorted by total unless `"sort": "data"`; `limit` keeps the top N.

**matrix**: `x`, `y`, `value`. Cells tint by their share of the largest value (`"scale": "row"` compares within a row). A cell filters by both its row and column when both are filters' fields. `tint`: `single` (default), `columns` (each column in its entity color), `rows`. Long column names rotate. Rows and columns keep the data's order, or list `columns`.

**chart**: `chart` is one of:

- `line`, `area`: `x` (a year, an ISO date, or a category), `y`, optional `series`; or wide rows with `"y": ["fix", "feat"]` and `names`. Lines are named at their end; `endValues: true` adds the last value. `emphasis` draws one series (a total, "All") in the text color and thicker. `points: true` marks every value. `area` stacks with a series; `"stack": "percent"` on an `area` makes shares.
- `bar`, `stacked`, `grouped`: `x` the category, `y` the value, optional `series`. `horizontal: true` sorts by value; `limit` keeps the top N; `"stack": "percent"` turns stacked bars (`stacked`, or `bar` with a `series`) into shares.
- `scatter`: `x`, `y`, optional `size`, `series`, `label` (names the top `labelTop` points, moved apart so they don't overlap). `logX`/`logY` keep points at 0 on the axis. When `label` isn't a filter's field and the report has `search`, a click on a point searches for its `label`.
- `histogram`: `x` only; `bins` (default 30). With `logToggle` on log, values at or below 0 are left out.

A click on a chart filters by its `series`, or else by its `x`, when that is a `list` filter's field; a second click clears it.

Options for any chart: `format` (`number`, `integer`, `compact`, `percent` for 0–1 values, `money` in US dollars), `height` (default 240), `highlight` (one series in color, the rest gray), `tones`, `logToggle`, `xTitle`, `yTitle`.

**table**: `data`, `columns` of `{ field, label, format, number }`, `sort` (a field, descending), `limit` (rows shown, default 12), `more` (rows each "Show more" adds), `search: true`, `rank: false`. `"style": "rows"` is the dense evidence list: no rank, no header, and its title shows the matching count. Past 5 columns or with 2 number columns it keeps the header, so give every column a `label`. Column `format`:

- `entity`: a colored dot and the name, for a list filter's field. Rows click to filter.
- `bar`: inline bar and number; `heat`: tinted cell; `delta`: signed and colored, a 0–1 change printed as a percent, empty on a period `updated` cuts short (SKILL.md step 4); `number`/`integer`/`compact`/`percent`/`money`. On `bar`, `heat`, `delta` and `stack`, the column's `number` sets how the number prints.
- `stack`: a small bar split by `fields` (with `names`, `tones`), for a mix per row. Give it any `field` name as its key.
- `chips`: an array of strings or `[label, count]` pairs, as pills, like the two things a customer most needs.
- `text` (`truncate: true` cuts it to the cell), `date`, `user` (GitHub avatar), `country` (flag from an ISO code), `link`. `suffix` prints another field after a number, small.

**vega** (escape hatch): `{ "type": "vega", "title", "spec": { …Vega-Lite…, "data": { "name": "<dataset>" } } }`.

## Filters

Set `type` on every filter: without it, a filter with more than 5 `options` becomes a `list`.

- `tabs`: periods or modes in the sidebar, one always on (`default`, or the first option). More than 5 options become a dropdown. Every dataset that follows it carries one set of rows per option.
- `list`: the entity list in the sidebar, each name with its color and a count of rows in `count` (a dataset name; `countField` sums a field instead). Click to filter every dataset with that field; click again to clear. `colors` maps a value to a tone (`{ "Bug": "bad" }`) when its meaning has a color.
- `toggle`: a checkbox in the top bar. Rows whose field is true are hidden until it's checked, like "Include thanks and scheduling".
- `search` (report level, the placeholder text): filters every `table`.

Datasets without a filter's field ignore it.
