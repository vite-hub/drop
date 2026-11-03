# Grading and states

## Sources

Where an answer comes from limits how far it can raise a concept:

| Source | What it is | Can raise the state to |
|---|---|---|
| `diagnostic` | A placement question, answered without looking anything up | `solid` |
| `quiz` | A question after a lesson or in a review, in chat or in Drop | `solid`, `durable` |
| `real-world` | Something the user did alone: a talk, a pull request, an interview answer | `solid`, `durable` |
| `recall` | A Drop `::recall` card the user marked "knew" | `shaky` |
| `conversation` | Something the user said in passing | `claimed`; it can lower any state |
| `self-report` | "I already know this" | `claimed` |

## Grades

Grade the first answer, before any feedback, hint or second try. A later right answer after the explanation is learning, not evidence.

| Grade | When | New interval (days) |
|---|---|---|
| `again` | Wrong, or "I don't know" | 1 |
| `hard` | Right but with confidence 1 or 2, with help, or half right | interval × 1.2, at least 2 |
| `good` | Right, unaided | interval × 2.5, at least 3 |
| `easy` | Right, confidence 3, and the user explained why or applied it to a new case | interval × 4, at least 7 |

A picked option is at most `good`: choosing is easier than producing. When an answer is borderline and the key doesn't settle it, grade `hard` and say why in `shows`.

These intervals are a rule of thumb from SM-2, not a tuned scheduler. Change them when the user's reviews show they're off.

## Drop answers

`read_drop` lists the answers people gave in a doc under `answers`, one per question id. Use only `userAnswer`, the user's own; the counts are everyone's.

| Block | What Drop keeps | Grade |
|---|---|---|
| `::question` | `first` and `latest` option keys, and `attempts` | From `first`: right is `good`, wrong is `again`. Record the option text, and make the wrong option the `misconception`. |
| `::recall` | `revealed`, `knew` or `missed`; the first is always `revealed` | From `latest`: `knew` is `hard` with source `recall`, `missed` is `again`. |
| `::poll` | The current vote | Not a grade. |

Drop stores neither free text, nor confidence, nor whether the user opened a hint, and it records only signed-in answers. `userAnswer.at` is the time of the latest answer, not the first. So a Drop answer is weaker evidence than one in chat: when a concept rests only on Drop answers, prefer a chat question at its next review.

An empty `answers`, or no `userAnswer` for an id, means no answer yet. Leave the question in `Pending`; it is not a wrong answer.

## States

| State | Meaning |
|---|---|
| `unseen` | In the map, no evidence yet |
| `claimed` | The user says they know it, or did it with help; not tested unaided |
| `gap` | The last unaided answer was wrong, or the user didn't know |
| `shaky` | Right but unsure or with help, or right once and wrong later |
| `solid` | Right, unaided, on a question the user hadn't seen |
| `durable` | Right again at least 21 days after the previous right answer |

After grading, set `last` to the answer's date and `next` to `last` plus the new interval, then set the state:

- `again` sets `gap`, or `shaky` when the concept was `solid` or `durable`.
- `hard` sets `shaky`.
- `good` and `easy` set `solid`, or `durable` when at least 21 days passed since the previous `last` that was right.

Cap each result at what its source allows.
