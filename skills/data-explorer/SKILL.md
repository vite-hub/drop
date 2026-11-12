---
name: data-explorer
description: Turns a dataset into an interactive explorer page, a dashboard of findings, graphs, matrices and tables behind tabs and filters. Use when someone hands over data, such as a CSV, a JSON export or an API, and wants to see what's in it, or asks for a dashboard of it.
license: MIT
---

# Data explorer

A data explorer is one `report.json`: the data rows, the filters, and the blocks on each tab. This skill's template draws it as an _instrument_, the way an analytics tool looks: a top bar with the tabs, a strip of numbers that stays on every tab, flat sections of charts and tables, the rows behind the numbers at the bottom, and a filter sidebar on the right where every name keeps one color across the page. You decide **what to show**; the template owns **how it looks**. You write no HTML, CSS or page script.

Words are the scarcest thing on the page. A reader scans numbers, colors and bars; prose goes in `method`. The build rejects text past its limit.

When the reader has to choose between options or approve a plan, write a `report` instead: a page with the answer first.

The block reference is [references/blocks.md](references/blocks.md); read it before step 3.

## Steps

1. **Questions.** From the request, write the 3 to 6 questions the reader wants answered. Each becomes a tab. Name each one's _shape_: change over time, share of a whole, ranking, two numbers per item, spread, two categories crossed, or a lookup of one item.
   Done when every question has a shape and none overlaps another.

2. **Profile.** Write a short script that prints, for each source file, its row count, every field with its type, range and share of nulls, and a few sample rows. Read the source's README for what each field means and how it was counted.
   Done when you can name the fields and the join keys each question needs, and the caveats the README states.

3. **Entities and filters.** Pick the one or two _entities_ the reader thinks in (customers, repositories, countries, types of work) and the period or mode they switch between. Each entity becomes a `list` filter: it gets a color that every block reuses, a row in the sidebar with its count, and a click target in every table and bar list. The period becomes a `tabs` filter. Give every dataset that should follow a filter that filter's column.
   Done when each entity and period is a filter and you know which datasets carry its column.

4. **Prep.** Write `prep.py` (or `prep.mjs`) next to the report. It reads the raw files and writes `report.json` with aggregated rows: one dataset per block shape, plus one dataset of evidence rows (the people, tickets or items behind the numbers). Every number on the page is computed here, so a rerun on new data rebuilds the report. Fold any long tail into one `Other` row.
   Done when the script runs from scratch and prints the headline numbers you'll quote.

5. **Blocks.** Put 4 to 6 numbers in `top` (a `stats` block) and the evidence rows in `bottom` (a `table` with `"style": "rows"`); both stay on every tab. On each tab, pick 2 to 6 blocks by the question's shape, using the table in [references/blocks.md](references/blocks.md), and mix them: a tab of only line charts reads as a chart dump, a tab with a table, a matrix and a bar list reads as an instrument. Open the first tab with a `facts` block: 2 or 3 numbers that answer the request, each with one sentence.
   Done when every block answers its tab's question and no two blocks show the same numbers.

6. **Words, last.** Write a short product-like `title` and a `subtitle` (the source and the date range), a `title` per block that names what is measured, and a `note` only where a block would mislead without it or says how to use it ("Click a row to filter"). Definitions, caveats and how you counted go in `method`.
   Done when no block has a sentence the numbers already show.

7. **Build and look.** Build the page as [Build it](#build-it) says, and fix every error the build prints; each one says how. Then look at it like a reader, in **every** screenshot (light, dark and phone), or without Node in your host's preview if it has one: labels collide or are cut, a block is empty or flat, colors disagree between blocks, a tab without a table or matrix, a fact the blocks don't support. Change the blocks or the prep, not the template.
   Done when the build exits 0 and you have opened every screenshot of the last build, or, without Node, when `report.json` keeps every limit and you have looked at the page.

8. **Hand back** the path to `report.html`, the screenshot folder if you built with `--shots`, and three lines: what the report answers, the most surprising finding, and anything the data couldn't answer. The page is one file that opens from disk or any static host. When the reader wants to share it, publish it to Drop as `html`, following the `vitehub-drop` skill: the link is private, a rebuild on new data becomes a new version at the same URL, and readers can comment on the numbers.

## Build it

The page is [assets/page.html](assets/page.html) with `report.json`, the template's [assets/style.css](assets/style.css) and [assets/app.js](assets/app.js) in its slots. Fill it the first way your environment allows:

1. **With Node**, run the build. It checks `report.json` against every limit and names the fix, fills the page, and screenshots every tab. Copy this skill's `scripts/` and `assets/` folders next to the report, keeping them side by side, then:

   ```sh
   node scripts/build.mjs report.json report.html --shots shots
   ```

   `--shots` needs `playwright` installed where you run it; without the flag, the build needs nothing installed. The build finds both from the folder you run it in, so install them in a scratch folder with its own `package.json` (`pnpm add --ignore-workspace vega vega-lite playwright`) and run the build from there, with paths to `scripts/build.mjs` and the report. With `vega` and `vega-lite` there too, the page carries Vega inline and opens offline. On Linux, when Playwright has no browser of its own version, the build uses the newest Chromium in `~/.cache/ms-playwright`.

2. **Without Node**, such as in a chat app's sandbox, fill [assets/page.html](assets/page.html) yourself, with any language: `report.json` goes inside `<script id="report-data">` with every `<` written as `\u003c`, `style.css` inside `<style id="rp-style">`, and `app.js` inside `<script id="rp-app">`. Set the `<title>`. When you can't read a file of this skill, leave its slot empty: the page then loads it from this skill on Drop, and loads Vega from jsDelivr, so it needs a network connection when it opens. Nothing checks the limits on this path, so compare `report.json` with the limits in [references/blocks.md](references/blocks.md) before you hand it back.

## When the blocks don't fit

Try another block, a different aggregation in the prep script, or two smaller blocks first. If the question still needs a chart the blocks can't draw, use one `vega` block with a Vega-Lite spec (see [references/blocks.md](references/blocks.md)). The build counts these, so keep them rare and say why in your hand-back.
