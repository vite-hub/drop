# Model and record formats

Each topic folder holds one `model` doc, which agents rewrite as a new version, and `record-*` docs, which agents write once. Lessons and quizzes sit in the same folder.

```text
learning/
  voidzero-devrel/
    model                          mission, concepts, pending answers
    record-2026-11-03-diagnostic   answers as they were given
    record-2026-11-05-prebundling
    diagnostic                     the quiz or lesson drops that asked the questions
    lesson-dep-prebundling
```

## Model

The `model` doc has three sections: the mission, one section per concept, and `Pending`.

```md
---
title: "Learning: VoidZero DevRel"
---

## Mission

Prepare the hiring-manager interview for the VoidZero DevRel role at Cloudflare.
Success: explains Vite, Rolldown, Oxc and Vite+ to a junior and a senior, with an example for each, in English, without notes.
By: the interview date, not set yet.
Prefers: short lessons with one worked example, questions in chat.

## dep-prebundling
Explains what Vite pre-bundles in dev and the two problems it solves.
- state: shaky
- needs: vite-unbundled-dev, esm-vs-cjs
- last: 2026-11-04
- interval: 3
- next: 2026-11-07
- misconception: thinks pre-bundling also bundles the app's own source
- evidence: record-2026-11-03-diagnostic, record-2026-11-04-prebundling

## extglob-no-undef
Explains why `no-undef` fires on an extglob pattern and how to fix it.
- state: claimed
- needs: oxlint-js-plugins
- evidence: record-2026-10-22-video

## Pending

- https://drop.vitehub.dev/d/<key>/lesson-dep-prebundling `dep-prebundling--cjs-lib`, published 2026-11-04
```

A concept's heading is its id: lowercase words joined with dashes, unique in the topic. Under it, one sentence says what knowing it means: what the user can explain or do. Then its fields:

| Field | Value |
|---|---|
| `state` | One of the states in [the grading reference](grading.md#states). Every concept starts `unseen`. |
| `needs` | Prerequisite concept ids, or `<topic>/<concept>` for one in another topic. |
| `last` | Date of the last graded answer. |
| `interval` | Days until the next review. |
| `next` | `last` plus `interval`: the date the concept is due. |
| `misconception` | The wrong idea an answer showed, in a few words. Remove it once the user answers a question aimed at it right. |
| `evidence` | The records that set the current state. |

`state`, `needs` and `evidence` exist from the start; `last`, `interval` and `next` appear after the first graded answer.

Keep the model to the current state. History lives in the records and in the model's own versions.

`Pending` and record question headings use bare question ids, without the `#` used in Markdown attributes, so they match `read_drop`'s `answers[].id`.

## Record

A record keeps one session's answers as they were given, so a later agent can regrade them. Publish it once, into the topic folder, named `record-YYYY-MM-DD-<slug>`.

```md
---
title: "Record: dep-prebundling lesson, 2026-11-04"
---

Lesson: https://drop.vitehub.dev/d/<key>/lesson-dep-prebundling
Graded by: claude-opus-5-5 in Claude Code

### dep-prebundling--cjs-lib
- source: quiz, in chat
- asked: A CommonJS package is imported from your code in dev. What does Vite do before serving it?
- answered: "It bundles it with the app code." Confidence 2.
- help: none
- grade: again
- shows: confuses dependency pre-bundling with bundling the app

### dep-prebundling--why-esbuild
- source: quiz, Drop `::question`
- asked: Why does Vite pre-bundle `lodash-es` even though it is already ESM?
- answered: picked "Its hundreds of modules would mean hundreds of requests", first try
- help: none
- grade: good
- shows: knows the request-count reason
```

Write what the user answered short and close to their words, or the option text they picked, never just its key. Name `help` when they had a hint, the answer shown, or a nudge in chat.

A correction is a new record whose first line names the record and question it corrects, and why: "Corrects record-2026-11-04-prebundling `dep-prebundling--cjs-lib`: the user said they misread the question."
