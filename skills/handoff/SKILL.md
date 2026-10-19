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

Call Drop's `list_folders` first. Then publish the document with `publish` as Markdown, with a `note`. If a folder's description fits handoffs, pass it as `folder` and follow what the description asks; otherwise publish at the top with `lifetime: "review"`. Give the user the review link it returns. It starts with the Drop's default share: the team on a team Drop, only the user otherwise. Tell the user who can open it, and to share it from Drop if someone else needs it. If you are updating an earlier handoff, pass its id as `previous` so the link keeps one history.

If Drop's tools aren't available, write the file to the system's temporary directory instead and give the user its path.
