---
name: code-along
description: Turns code into one page someone works through, with a step-by-step guide beside an editor, a file tree and a live preview. Use when someone wants to learn a codebase, a concept or an API by doing, to try a prototype and change it, or to code something with you from a starting point you prepare.
license: MIT
---

# Code along

A code-along is one `lesson.md`: a guide in steps, and the files each step shows. This skill's template turns it into one HTML page with the guide on one side and, on the other, a file tree, an editor and a preview that reruns as the person types. Edits persist until Reset where the browser provides durable storage. In a sandboxed Drop without a separate content origin, on a direct HTML landing page, or when storage is blocked, edits are temporary and reloading can lose them. You write the lesson; the template owns how it looks.

It fits three asks:

| The ask | The lesson |
| --- | --- |
| Learn a codebase, a concept or an API | 3 to 6 steps. Each step shows the real code it explains, cut to the lines that matter, and asks a question the person answers by editing. |
| Try a prototype | One step that lists what to try. The files are the prototype; with no other step, the page hides the step controls. |
| Code with me | Steps from a starting point you prepare to a working result. Each step says what to change and folds the answer in a `<details>`. |

[references/example.md](references/example.md) is a whole lesson in this format, with a preview, a console and a step to solve. Read it before step 1.

## Steps

1. **Plan the steps.** Write each step's title as what the person does ("Pick the form"), and what they see or change in it. A step does one thing.
   Done when each step has a title and a change you can name.

2. **Write the files.** Start from a working first step. When the page should run, include an `index.html`; leave it out to show code without a preview, as when you explain a server. Keep files short: cut real code to the lines the step explains and mark the cut with a comment (`// …`).
   Done when the first step's files run as they are.

3. **Write the guide.** Under each `##`, two to five short paragraphs: what to look at, then what to try. Link to the code instead of repeating it: `[messages.js](src/messages.js#L6-L9)` opens the file and selects those lines. Put a task in `> [!NOTE]` and its answer in `<details>`.
   Done when every step says what to try, and every claim about the code points at its lines.

4. **Build and look.** Build the page as [Build it](#build-it) says and fix what the build prints. Open every screenshot: each step should open on the file its text is about, and its preview should show what the guide says.
   Done when the build exits 0 and you've read every screenshot.

5. **Publish** the page to Drop as `html`, following the `vitehub-drop` skill: the person comments on any step, as on any drop. A new version of the lesson goes in with `previous`, at the same link.

## The format

````md
---
title: Plurals with Intl.PluralRules
guide: left
---

Shown above the first step.

## Count the messages

[main.js](src/main.js) prints one sentence for a few counts.

```js [src/main.js]
console.log("hi")
```
````

- **A step** is each `##` heading. Its title becomes the link `#count-the-messages`.
- **A file** is a fence titled with a path in brackets: ```` ```js [src/main.js] ````. A fence without a path is code in the guide.
- **A step's files** are the step before's files plus the ones it writes. Writing a path again replaces that file from that step on. The tree marks the files a step changes.
- **Links** to a path open that file; add `#L3` or `#L3-L5` to select lines. A link whose text is a file name shows as a file chip. Every link must point to a file of its step, or the build stops.
- **The step opens** on the file its text links to first, else the first file it writes.
- **The preview** shows `index.html` in a sandboxed frame. It runs native `<script type="module">` with literal imports between lesson JavaScript files, `fetch("./file.ext")` of any lesson file, and bare imports such as `import confetti from "canvas-confetti"` from esm.sh (unless the preview supplies its own import map). Use string literals with `import()` in lesson modules. Virtual modules have `data:` URLs, not HTTP paths: use relative string `fetch` for lesson assets instead of resolving them against `import.meta.url`. Local module previews require the CDN module lexer. There is no server, so a lesson about a server shows its code without a preview.
- **The console** tab shows the preview's `console` calls and errors. The preview rejects module script tags that specify both `src` and `integrity` because it cannot preserve that integrity check when rewriting the entry.
- **Callouts** are `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and `[!CAUTION]`. Tables and `<details>` work as in GitHub.
- **Frontmatter:** `title`, and `guide: right` to put the guide on the right, as for a prototype the person tries first.

## Build it

The page is [assets/page.html](assets/page.html) with `lesson.md`, [assets/style.css](assets/style.css), [assets/lesson.js](assets/lesson.js) and [assets/app.js](assets/app.js) in its slots. Fill it the first way your environment allows:

1. **With Node**, run the build. It reads `lesson.md` with the page's own parser, stops on what the page couldn't show and names the fix, and fills the page:

   ```sh
   node <skill>/scripts/build.mjs <dir>/lesson.md <dir>/lesson.html --shots <dir>/shots
   ```

   `--shots` saves every step in light and dark and the first step on a phone, and fails when the page, the editor or a preview throws. It needs `playwright` in the folder you run it from; set one up once with `mkdir -p /tmp/ca-build && cd /tmp/ca-build && npm init -y && npm i playwright && npx playwright install chromium`, then run the build from there. Without it, drop `--shots`.

2. **Without Node**, fill [assets/page.html](assets/page.html) yourself: copy `style.css` into `<style id="ca-style">`. Encode `lesson.md`, `lesson.js`, and `app.js` each as one JSON string literal, then replace every literal `<` in the encoded string with `\u003c` (in JavaScript, `JSON.stringify(source).replaceAll("<", "\\u003c")`). Paste the resulting strings, including the surrounding quotes, into the `lesson`, `ca-lesson`, and `ca-app` script slots respectively. Set the `<title>`. When a file of this skill isn't on disk, read it as `skill://code-along/assets/app.js` from Drop's MCP server, or at `https://drop.vitehub.dev/.well-known/skills/code-along/assets/`. Nothing checks the lesson on this path, so check each link against its step's files yourself.

The page loads the editor (CodeMirror) and the Markdown parser from esm.sh and jsDelivr when it opens. Without a network, it shows the steps with a plain text editor.

## Change the template

The template is yours to change for one lesson: copy `assets/` next to the lesson, edit the copy, and build with `--assets <copy>`. Change the header, the colors in `:root` in `style.css`, or what the page does in `app.js`. Keep each file's slot and `function parseLesson` and `function mount`, which the page checks before it runs.
