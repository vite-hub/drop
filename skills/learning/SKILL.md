---
name: learning
description: Keeps a learner model of the user in Drop, which records what they know, half-know, and get wrong per topic, with the evidence behind each claim and when to review it, so the next lesson starts where their knowledge stops. Use when teaching the user anything, before and after, when they ask to be quizzed or reviewed, or when they ask what they know or what to learn next.
---

# Learning

The learner model is a set of Drop docs that records what the user knows, topic by topic. Teaching agents read it before a lesson, so the lesson starts at the user's **edge**: the first concepts they don't know yet whose prerequisites they do. They write to it after the user answers a question, so the next agent starts from there.

Coverage is not learning. A lesson read or a video watched changes nothing in the model; only an answer does.

The model records what the user knows. How agents should work goes in agent memory and `AGENTS.md`, never here.

This skill works through Drop's MCP tools (`list_folders`, `create_folder`, `read_drop`, `list_drops`, `publish`, `update_drop`). Follow the `vitehub-drop` skill for publishing. The doc formats are in [the model reference](references/model.md), and grades and states in [the grading reference](references/grading.md). When the user asks to be quizzed, or a step below calls for a diagnostic or a review, follow [the quiz reference](references/quiz.md).

## 1. Find the model

Call `list_folders` and look for the `learning` folder. When several Drop connections are available, use the user's personal Drop, and ask if more than one has a `learning` folder.

When there is none, this is the first run. Recommend this layout to the user, with the descriptions below, and create it once they agree:

| Folder | Settings | Description |
|---|---|---|
| `learning` | `share: private`, `lifetime: keep`, `keepReason: "The user's learner model, kept across projects."` | The user's learner model: one subfolder per topic. Before teaching, quizzing or writing here, read the `learning` skill (skill://learning/SKILL.md, or /.well-known/skills/learning/SKILL.md on this Drop). |
| `learning/<topic>` | inside `learning` | What the user is learning about `<topic>` and why. `model` is the current state; `record-*` docs are answers as they were given; lessons and quizzes published here feed them. Follow the `learning` skill. |

A topic slug is short and stable: `voidzero-devrel`, `thai`, `public-speaking`. Create a topic folder when its first lesson or diagnostic starts, without asking again.

Done when you hold the topic folder's id and its `model` doc, or the user declined the setup. Without a model, teach as you would have and say that nothing was recorded.

## 2. Before teaching

1. **Collect pending answers.** The model's `Pending` section lists questions published to Drop that the user hasn't been graded on. For each one, `read_drop` the lesson or quiz and take the user's answer for that question id from `answers`. Grade it with [the grading reference](references/grading.md), then record it as in step 4. An entry with no answer yet stays pending.
2. **Read the model.** Read the mission and every concept. A topic with no model needs one first: write the mission with the user (why they learn it, what success looks like, by when), map the concepts, and run a [diagnostic](references/quiz.md).
3. **Pick what to teach.**
   - When five or more concepts are due (`next` on or before today), offer a [review](references/quiz.md) before anything new.
   - Otherwise open with one or two due concepts as warm-up questions, each a new variant of the question.
   - Then teach one concept at the edge: its state is `unseen`, `claimed`, `gap` or `shaky`, and every concept in its `needs` is `solid` or `durable`. Among those, prefer the one the mission needs most, then `gap` over `shaky` over `claimed` over `unseen`.
   - When a prerequisite's state rests on thin evidence (only `claimed`, or one answer long ago), check it with one quick question before building on it.

Done when you can name to the teaching skill the concept to teach, its warm-ups, and any recorded `misconception`. Make that misconception one of the lesson's wrong options.

## 3. While teaching

Give every `::question` and `::recall` an id that starts with its concept id: `#dep-prebundling--cjs-lib` in Markdown attributes. Store the bare id `dep-prebundling--cjs-lib` in `Pending` and records, matching `answers[].id` from `read_drop`. Use a new id each time a question is asked again, even reworded: Drop keeps a user's answers per id and doc across versions, so a reused id brings back the old answer instead of a new one.

Publish lessons and quizzes into the topic folder, a new drop for each session. Answers disappear with their drop, so a lesson elsewhere with a short lifetime loses them.

## 4. After teaching

1. **Grade** every answer the user gave in chat, using [the grading reference](references/grading.md). Grade the first answer, before any feedback or hint.
2. **Record the answers.** Publish one `record-YYYY-MM-DD-<slug>` doc per session into the topic folder, in [the record format](references/model.md#record). A record is written once and never rewritten; a correction is a new record that names the one it corrects.
3. **List what's still out.** Each question published to Drop and not yet answered goes in the model's `Pending` section with its drop link and id.
4. **Update the model.** Apply the grades to each concept's state, interval and `next` date, add or clear `misconception` lines, and add concepts the lesson revealed with `state: unseen`.

Done when every answer from the session is in a record, every unanswered question is in `Pending`, and the model's new version is published.

## Writing the model

Drop rejects a publish if another write commits between its internal read and commit, but `previous` identifies a drop, not an expected version. There is no lock between your `read_drop` and `publish`. When publishing the model:

1. `read_drop` it again and compare its version with the one you started from. When it moved, merge the other agent's changes into yours. Keep a copy of the source and version you are about to publish against.
2. `publish` with `previous` set to the model and a `note` naming the concepts that changed, like "dep-prebundling: gap → shaky (record-2026-11-04-vite)".
3. If `publish` fails with a concurrent-update `409` (such as "This drop was published by someone else"), it created no version. Keep your intended changes and return to 1: re-read the latest model, merge its changes with yours, and retry. Do not resend the old source unchanged. If the retry also conflicts, keep the session's record and tell the user the model update is still pending.
4. On success, check that the version `publish` returned is the one you read plus one. If it skipped versions, another update landed after your read but before `publish` read the head. Use `read_drop` on the model's link with `?v=<version>` to read every intervening version, from the one you read plus one through the returned version minus one. Compare them with your saved source and recover changes to the mission, concepts, evidence and `Pending`. Retain the recovered changes when returning to 1 before publishing again. Reading only your own new version does not recover the overwritten changes.

Records preserve the answer evidence for rebuilding concept states when merging concurrent updates. For overlapping grades, replay their records in answer-date order, counting each answer once; a correction replaces the entry it names.

## Corrections

The user can comment on the model or a record: "I knew that already" or "that grade is wrong". Treat it as a correction to apply, not to argue with: write a record noting the correction and update the model. For a comment on the model, pass its comment number in `publish.resolves` when publishing the model's next version. For a comment on a separate record, after the model update succeeds call `update_drop` with that record's id and `resolves: [<comment number>]`. This resolves the comment without publishing a new version of the immutable record; publishing the model cannot resolve a comment on another drop.
