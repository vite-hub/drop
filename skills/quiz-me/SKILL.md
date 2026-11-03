---
name: quiz-me
description: Quizzes the user on a topic, in chat or as a Drop doc, either to place them on a new topic or to review what is due, and records each answer in their learner model. Use when the user asks to be quizzed, tested, or reviewed, or when the learning skill calls for a diagnostic or a review.
---

# Quiz me

A quiz finds out what the user knows, so the next lesson starts in the right place. Every answer becomes evidence in the learner model that the `learning` skill keeps. Read that skill first: this one uses its model, its question ids, and [its grading reference](skill://learning/references/grading.md) (`/.well-known/skills/learning/references/grading.md` on this Drop).

A quiz runs in one of two modes:

- **Review**: questions on the concepts that are due.
- **Diagnostic**: placement on a topic the user is starting, or one whose model is mostly `unseen`.

## 1. Load the model

Follow the `learning` skill's first two steps: find the topic's model and collect its pending answers.

Done when the pending answers are graded or still pending, and you know the topic's concepts with their states and `needs`.

## 2. Pick the questions

- **Review**: one question per due concept, the most overdue first, at most 10. Add the concepts with a recorded `misconception` first.
- **Diagnostic**: start at the concepts with no `needs` and work up the prerequisite map, two or three concepts per level. After a miss, ask about that concept's `needs` before going higher. Stop a branch when most of a level is missed; mark the concepts above it `unseen`, not `gap`. Ask at most 25 questions in one sitting.

Each question tests one concept and asks the user to apply it to a case: predict what happens, explain why, or pick the fix. Write a new variant each time, never a question already in the topic's records.

Done when every question maps to one concept id and has an id of the form `<concept-id>--<variant>`.

## 3. Write the key first

Before asking, write each question's key: what a right answer must say, what else counts as right, and which misconception each likely wrong answer would show.

Done when another agent could grade any answer from the key alone.

## 4. Ask

Ask in chat when the user is here to answer. Chat collects what Drop can't: an answer in the user's own words and how sure they are.

- One question at a time. Ask for the answer and a confidence: 1 guessing, 2 unsure, 3 sure.
- Give no hint, option, or feedback until the user has answered.

Publish a Drop doc when the user wants to answer later or on their phone:

- Publish a new drop into the topic folder for each quiz, never a new version of an old one: Drop keeps answers per id across versions, so the old answers would come back.
- Use a `::question` for each concept, with three or four options. Make every wrong option a real misconception, starting with the one recorded on the concept, and add "I don't know yet" as an option. Put a `>` reason under every option, as the `vitehub-drop` skill's quiz blocks ask.
- Leave out `#hint` in a diagnostic.
- Use a `::recall` only for a fact or a definition: Drop records only whether the user said they knew it.
- Tell the user to answer while signed in, since Drop keeps only signed-in answers.

Done when every question has a first answer in chat, or sits in the model's `Pending` section with the drop's link and the question id.

## 5. Grade and give feedback

Grade each chat answer against its key with [the grading reference](skill://learning/references/grading.md), before giving feedback. Then tell the user whether it was right, the short reason, and the misconception when the answer showed one. A confident wrong answer is the one most worth correcting carefully: say what was wrong and why the right answer holds.

When an answer doesn't fit the key, grade it `hard` and quote it in the record, so the user or a later agent can regrade it.

## 6. Record

Follow the `learning` skill's fourth step: one record for the session, the unanswered questions in `Pending`, and the model's new version.

Done when the model is published and you've told the user which concepts moved, the misconceptions found, and the next concept at their edge.
