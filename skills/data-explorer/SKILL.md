---
name: data-explorer
description: Turns a dataset into an interactive explorer page, a dashboard of findings, graphs, matrices and tables behind tabs and filters. Use when someone hands over data, such as a CSV, a JSON export or an API, and wants to see what's in it, or asks for a dashboard of it.
license: MIT
---

# Data explorer

A data explorer is one `report.json`: the data rows, the filters, and the blocks on each tab. This skill's template draws it like an analytics tool: tabs in a top bar, a strip of numbers (`top`) and a list of evidence rows (`bottom`) that stay on every tab, the blocks of the tab between them, and a filter sidebar where every name keeps one color across the page. You decide **what to show**; the template owns **how it looks**. You write no HTML, CSS or page script.

Words are the scarcest thing on the page. A reader scans numbers, colors and bars; prose goes in `method`.

When the reader has to choose between options or approve a plan, write a `report` instead: a page with the answer first.

The block reference is [references/blocks.md](references/blocks.md); read it before step 3.

## Steps

1. **Questions.** From the request, write the 3 to 6 questions the reader wants answered. Each becomes a tab. Name each one's _shape_ from the first column of [Which block for which question](references/blocks.md#which-block-for-which-question).
   Done when every question has a shape and none overlaps another.

2. **Profile.** Write a short script that prints, for each source file, its row count, every field with its type, range and share of nulls, and a few sample rows. Read the source's README for what each field means and how it was counted.
   Done when you can name the fields and the join keys each question needs, and the caveats the README states.

3. **Entities and filters.** Pick the one or two _entities_ the reader thinks in (customers, repositories, countries, types of work) and the period or mode they switch between. Each entity becomes a `list` filter, and the period a `tabs` filter. A filter's `field` is the link: every dataset with a column of that name follows the filter, and every block that shows that column (a chart's `series` or `x`, a bar list's `label`, a matrix's `x` or `y`, an `entity` table column) colors each name the same way and filters the page when clicked. So name those columns after the filter's field, in every dataset.
   Done when each entity and period is a filter and you know which datasets carry its column.

4. **Prep.** Write `prep.py` (or `prep.mjs`) next to the report. It reads the raw files and writes `report.json` with aggregated rows: one dataset per block shape, plus one dataset of evidence rows (the people, tickets or items behind the numbers). Every number on the page is computed here, so a rerun on new data rebuilds the report. Fold any long tail into one row named `Other …` and keep missing values as `Not set` or `Unknown`: the template sorts those last and grays them. Two rules keep the numbers honest:
   - **Exclusions apply everywhere.** Filter an account `method` says is left out (a bot, a test user) from the source rows once, before any aggregation, so no ranking, "top" column or fact can pick it, not only the main lists.
   - **No partial period against a full one.** When the data stops mid-period (2026 to November 11), give that period no change against the last full one: a cut-short year reads as a collapse. Compare a trailing full window instead, like the last 12 months against the full year before, and leave partial periods out of year-over-year return rates.
   Done when the script runs from scratch, an excluded account appears in no dataset, and it prints the headline numbers you'll quote.

5. **Blocks.** Put 4 to 6 numbers in `top` (a `stats` block) and the evidence rows in `bottom` (a `table` with `"style": "rows"`); both stay on every tab. On each tab, pick 2 to 6 blocks by the question's shape, using the table in [references/blocks.md](references/blocks.md), and mix them: a tab of only line charts reads as a chart dump, a tab with a table, a matrix and a bar list reads as an instrument. Open the first tab with a `facts` block: 2 or 3 numbers that answer the request, each with one sentence.
   Done when every block answers its tab's question and no two blocks show the same numbers.

6. **Words, last.** Write a short product-like `title` and a `subtitle` (the source and the date range), a `title` per block that names what is measured, and a `note` only where a block would mislead without it or says how to use it ("Click a row to filter"). A partial period is labeled as one ("2026 to Nov 11"), and a fact that compares periods names two of the same length. Definitions, caveats and how you counted go in `method`.
   Done when no block has a sentence the numbers already show.

7. **Build and look.** Build the page as [Build it](#build-it) says, and fix every error and warning the build prints; each says how. Then look at it like a reader, in **every** screenshot (light, dark and phone), or without Node in your host's preview if it has one: labels collide or are cut, a block is empty or flat, colors disagree between blocks, a tab without a table or matrix, a fact the blocks don't support. Change the blocks or the prep, not the template.
   Done when the build exits 0 and you have opened every screenshot of the last build, or, without Node, when `report.json` keeps every limit and you have looked at the page.

8. **Hand back** the path to `report.html`, the screenshot folder if you built with `--shots`, and three lines: what the report answers, the most surprising finding, and anything the data couldn't answer. The page is one file that opens from disk or any static host. When the reader wants to share it, publish it to Drop as `html`, following the `vitehub-drop` skill: the link is private, a rebuild on new data becomes a new version at the same URL, and readers can comment on the numbers.

## Build it

The page is [assets/page.html](assets/page.html) with `report.json`, [assets/style.css](assets/style.css) and [assets/app.js](assets/app.js) in its slots. Fill it the first way your environment allows:

1. **With Node**, run the build. It checks `report.json` against every limit and names the fix, fills the page, and with `--shots` screenshots every view. It needs this skill's `scripts/` and `assets/` folders side by side; when the skill isn't on disk, copy both. It loads packages from the folder you run it in, so set one up once:

   ```sh
   mkdir de-build && cd de-build && npm init -y && npm i vega vega-lite playwright
   npx playwright install chromium
   node <skill>/scripts/build.mjs <dir>/report.json <dir>/report.html --shots <dir>/shots
   ```

   Without `playwright`, drop `--shots`. Without `vega` and `vega-lite`, the page loads Vega from jsDelivr when it opens, so it needs a network connection.

2. **Without Node**, such as in a chat app's sandbox, fill [assets/page.html](assets/page.html) yourself, with any language: `report.json` goes inside `<script id="report-data">` with every `<` written as `\u003c`, `style.css` inside `<style id="rp-style">`, and `app.js` inside `<script id="rp-app">`. Set the `<title>`. When you can't read a file of this skill, leave its slot empty: the page then loads it from Drop, and Vega from jsDelivr, so it needs a network connection. Nothing checks the limits on this path, so compare `report.json` with the limits in [references/blocks.md](references/blocks.md) before you hand it back.

## When the blocks don't fit

Try another block, a different aggregation in the prep script, or two smaller blocks first. If the question still needs a chart the blocks can't draw, use one `vega` block with a Vega-Lite spec (see [references/blocks.md](references/blocks.md)). The build counts these, so keep them rare and say why in your hand-back.
