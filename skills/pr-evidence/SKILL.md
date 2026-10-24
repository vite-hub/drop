---
name: pr-evidence
description: Builds pull-request evidence in Markdown, with before and after screenshots for UI changes or changed lines for code changes, then drops it into Drop and comments its link on the pull request. Use when a pull request changes something visible, when the user asks for before/after screenshots or a visual review, or when reviewers need to see what changed.
---

# Pull-request evidence

Show reviewers what changed, marked up so they don't have to hunt for it. You write Markdown with comark-annotate components; Drop renders it as a page with hand-drawn marks, numbered notes, and arrows. When nothing changes on screen, as in a refactor, skip [Capture](#capture) and show the code as a [code change](#code-changes).

## Where it lives

Call `list_folders` first. If a folder's description says it's for pull request evidence, publish every screenshot and the doc into it with `folder`, and follow what its description asks; they need no `lifetime`, since they live with the folder. Otherwise pass `lifetime: "keep"` and a `keepReason` naming the pull request.

## Capture

1. Find the two states: **after** from this pull request's preview, **before** from any running deploy that still has the old behavior, such as another open pull request's preview that doesn't touch this change. Note both URLs.
2. Capture both at the same viewport, zoom, scroll position, and page state (same data, same open menus, popups closed). The change has to be visible in what you capture. If the data or the state can't show it, set that up first. A compare shows each image at under half the page width, where a full-page capture's text is too small to read, so clip both to the same region around the change, such as Playwright's `screenshot({ clip })`. A doc with only one of the two states, or a description in place of a screenshot, isn't evidence: if you can't capture both comparably, publish nothing: no new drop and no new version of an existing one. Your final answer says what blocked you.
3. For every element you want to mark, measure it in the page you captured. Never estimate from the image:

   ```js
   const r = document.querySelector("SELECTOR").getBoundingClientRect();
   [(r.x / innerWidth) * 100, (r.y / innerHeight) * 100, (r.width / innerWidth) * 100, (r.height / innerHeight) * 100].map((v) => +v.toFixed(1));
   ```

   For a clipped capture, subtract the clip's `x` and `y` and divide by its `width` and `height`. An arrow's `to` is one point from the same numbers: the left middle of a label is `x` and `y + h / 2`, the middle of a button `x + w / 2` and `y + h / 2`.

4. Publish each screenshot with `publish` and `file: { name }` (`share: "public"`, plus the folder or lifetime from [Where it lives](#where-it-lives)). It answers with an `uploadUrl`; run `curl -T before.png '<uploadUrl>'`, which prints the drop with its `fileUrl`. Images already hosted elsewhere over `https` work too.

## Write

The screenshots are the evidence for UI changes; the text only points into them. Mark them up the way a designer marks up a review board: one ink, notes in the margin, and arrows that land on the exact spot, so the screenshot reads without a key. For code changes, the diff is the evidence; show the changed lines as described in [Code changes](#code-changes).

Split the change into boards, one per thing a reviewer should notice. Each board is:

- a `##` heading that says what the change does, as a claim: "Lead with what actually failed.", not "Error screen";
- a `::compare` of before and after, or one `::screenshot` when a single state shows it;
- a `::diff`, when the code is the point. See [Code changes](#code-changes).
- inside each screenshot, after its annotations, one sentence on the state it shows, which becomes its caption.

Leave `color` and `ink` off: the default violet reads on light and dark screenshots alike, and one ink is the point. Each annotation is a side note in the margin above or below the image, `side="top"` or `"bottom"`, whichever is nearer its point. Use `mark="none"` with `to` on the exact spot, so the arrow does the pointing and nothing covers the screen. Set the note off with `at`, a tenth of the image or more from its point, so its arrow sweeps in; a top or bottom note reads away from its point, so give it room on that side. Use `mark="bracket"` for a run of rows or a group, and `circle` or `underline` only when the area itself is the point. Left and right notes only work on a single screenshot; in a compare they fall back to the numbered list.

Two or three notes per screenshot. Write the notes of a compare as a pair that makes the case: the before says what's wrong, in the words the screen shows ("The type gets the headline…", "…but the useful message is down here."), and the after says what the change does about it ("The message becomes the starting point."). A value the screenshot doesn't show stays out of the note. Mark the change at its own size; what stayed the same goes unmarked.

```md
## Lead with what actually failed.

::compare
:::screenshot{src="<before fileUrl>" alt="Error screen with the type as its heading" viewport="1280x900" href="https://main.preview.example.com/errors"}
::::annotation{x=9 y=16 w=11 h=4 mark="none" side="top" at=36 to="12.3,18.3"}
The type gets the headline…
::::

::::annotation{x=9 y=22 w=42 h=3 mark="underline" side="bottom" at=62 to="40,25.5"}
…but the useful message is down here.
::::

The error type is the heading; the message follows under it.
:::

:::screenshot{src="<after fileUrl>" alt="Error screen with the message as its heading" viewport="1280x900" href="https://pr12.preview.example.com/errors" title="Proposed"}
::::annotation{x=12 y=13 w=40 h=5 mark="none" side="top" at=24 to="12.3,15.6"}
The message becomes the starting point.
::::

The message is the heading, with one source excerpt under it.
:::
::
```

Before writing a mark, read [references/annotations.md](references/annotations.md) for the syntax used by the comark-annotate version Drop renders with.

Above the first board, write one line with the steps to reach the screen. Each preview URL goes in its screenshot's `href`, not in the text. Beyond the headings and captions, no tables or paragraphs that describe what the images show, and never a doc that explains a change it doesn't show.

The doc shows the change; how the work went (the checks you ran, retries, CI counts, who has reviewed) belongs in your report to the user. When you're asked to put that report in the doc, end it with one `## For <name>` section of at most five bullets: the verdict first (ready, or blocked and why), the cause in one sentence, each decision they have to make as a question, and anything you couldn't check. A side question gets its answer in one line there.

### Code changes

A `::diff` shows one file's lines before and after, the way a review shows a suggested change. Copy the lines from the pull request's diff, a few around the change, and set `line` to where they start in the file, so a reviewer can find them. One diff shows one file: a change that adds a component and uses it is two diffs, the new file first with an empty before block. When the same change repeats across files, show one of them and name the others in the line above it, like "The same change in Forecast, Alerts, and 11 more pages." That line also says what the change does. The syntax is in [references/annotations.md](references/annotations.md#diff).

## Publish

1. Write the doc from these rules and fresh captures each time. For a next version, read the earlier one only for its open comments; don't start from its text or its conclusions. Each version replaces the whole doc, and its `note` says what changed. Publish the Markdown with `publish`: `share: "public"`, the folder or lifetime from [Where it lives](#where-it-lives), a `note`, and `resources`: the pull request's URL with the title `PR #<number>`, and the after preview's URL with the title `Preview`. They show with their sites' icons at the top of the page. Pass them again with each version; one already there isn't added twice. Open the returned page.
2. Take a screenshot of it and check that every arrow lands on its point, every mark sits on its target, and no note runs off the page or over another. Fix and publish again with `previous` until it does. If a mark can't be verified, say so in the report.
3. Comment the link on the pull request, so the pull request leads to the doc as the doc leads to it:

   ```md
   [Before/after on Drop](<link>)
   ```

   Read its description and comments first. If the link is already there, as after an earlier version, leave it: it always opens the latest version. If the repository's pull request rules say where evidence goes, such as the description, put it there instead. Post with `gh pr comment <pull request URL> --body '<snippet>'` or the GitHub tool you have; if you can't post, give the user the snippet. Tell the user where it went.

The doc is a public link, so anyone with the pull request can open it. On some Drops public links close after a few days (`publicUntil` says when); tell the user the date if there is one.
