---
name: handoff
description: Compacts the current conversation into a handoff document and drops it into Drop, so another agent, a colleague, or a new session can pick the work up from a link. Use when the work has to travel to another harness, directory, repo, person, or a forked side task, or when the user asks for a handoff.
---

# Handoff

Write a handoff document so a fresh agent or person can continue the work, then drop it into Drop and return the link. A handoff exists so the work can travel: to another harness, another directory or repo, a colleague, or a side task forked off this one. If nothing is travelling, say so and suggest compacting the session instead.

If the user said what the next session is for, write the document for that purpose.

## What goes in

Keep it to what the next reader needs to act. Use these sections, in this order, and skip a section only when it has nothing true to say:

```md
---
title: Handoff: <what the work is>
---

# Handoff: <what the work is>

**Focus:** <what the next session is for, in one or two sentences>

## Current state
## Done so far
## Decisions and constraints
## Open questions
## Next steps
## References
## Suggested skills

_Generated <YYYY-MM-DD> from <harness or agent>._
```

- **Current state** says where things stand right now: branch, what runs, what is broken.
- **Next steps** are ordered and concrete enough to start on without asking.
- **References** link files by path and work by URL: specs, plans, ADRs, issues, pull requests, commits, drops. Never paste their content; link it, so the detail lives in one place.
- **Suggested skills** name the skills the next agent should load, and why.

## Redact

Before publishing, remove secrets and personal data: tokens, keys, passwords, cookies, connection strings, private URLs with credentials, email addresses, and anything a teammate shouldn't see. Write `<redacted>` in their place. When unsure, leave it out.

## Publish

Drop the document with Drop's `create_doc` tool as Markdown, and give the user the review link it returns. It starts private; tell the user to share it from Drop when it's ready for someone else. If you are updating an earlier handoff, pass its id as `supersedes` so the link keeps one history.

If Drop's tools aren't available, write the file to the system's temporary directory instead and give the user its path.

Adapted from Matt Pocock's [handoff skill](https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md) (MIT).
