# Quizzes

A quiz finds out what the user knows, so the next lesson starts in the right place. It runs in one of two modes:

- **Review**: questions on the concepts that are due.
- **Diagnostic**: placement on a topic the user is starting, or one whose model is mostly `unseen`.

Start with the skill's steps 1 and 2.1: find the topic's model and collect its pending answers. End with step 4: one record for the session, the unanswered questions in `Pending`, and the model's new version. Then tell the user which concepts moved, the misconceptions found, and the next concept at their edge.

## 1. Pick the questions

- **Review**: one question per due concept, the most overdue first, at most 10. Put the concepts with a recorded `misconception` first.
- **Diagnostic**: start at the concepts with no `needs` and work up the prerequisite map, two or three concepts per level. After a miss, ask about that concept's `needs` before going higher. Stop a branch when most of a level is missed; leave the concepts above it `unseen`, not `gap`. Ask at most 25 questions in one sitting.

Each question tests one concept and asks the user to apply it to a case: predict what happens, explain why, or pick the fix. Write a new variant each time, never a question already in the topic's records.

Done when every question maps to one concept id and has an id of the form `<concept-id>--<variant>`.

## 2. Write the key first

Before asking, write each question's key: what a right answer must say, what else counts as right, and which misconception each likely wrong answer would show.

Done when another agent could grade any answer from the key alone.

## 3. Ask

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

## 4. Grade and give feedback

Grade each chat answer against its key with [the grading reference](grading.md), before giving feedback. Then tell the user whether it was right, the short reason, and the misconception when the answer showed one. A confident wrong answer is the one most worth correcting carefully: say what was wrong and why the right answer holds.

When an answer doesn't fit the key, grade it `hard` and quote it in the record, so the user or a later agent can regrade it.
