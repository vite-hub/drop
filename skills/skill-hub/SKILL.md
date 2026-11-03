---
name: skill-hub
description: Shares agent skills through a Drop folder, the hub, and installs them from it with the skills CLI, so a team or one person keeps their skills in one place across projects and agents. Use when the user wants to share, publish, find, install, or update a skill from Drop.
---

# Skill hub

The hub is a Drop folder that holds agent skills, one subfolder per skill. People publish their skills into it, and anyone with access installs them into their agents. Drop's access rules decide who sees each skill, so a private or team hub works the same as a public one.

You read the hub through Drop's MCP tools and install with the skills CLI, `npx skills add` on a local folder: it knows where each agent keeps its skills and records what it installed.

## Layout

```text
skill-hub/                       the hub
  release-notes/                 one subfolder per skill, named after it
    SKILL                        doc with the SKILL.md text, frontmatter included
    references/
      format                     references/format.md
    scripts/
      check.mjs                  a file drop: scripts/check.mjs
```

A doc becomes `<its path>/<slug>.md`, except the doc with slug `skill`, which becomes `SKILL.md`. A file drop keeps its file name. The skill's `name` in the frontmatter matches its subfolder.

## Find the hub

Call `list_folders` and look for `skill-hub`, or a folder whose description says it holds skills. On a team Drop, prefer the team's folder.

When there is none, recommend creating it and create it once the user agrees: title `Skill hub`, slug `skill-hub`, `lifetime: keep`, `keepReason: "Shared agent skills."`, and this description:

> Agent skills, one subfolder per skill with its SKILL doc, references and scripts. To install, publish or update one, read the `skill-hub` skill (skill://skill-hub/SKILL.md, or /.well-known/skills/skill-hub/SKILL.md on this Drop).

Done when you hold the hub folder's id.

## Install

1. **Find the skill.** `list_drops` with `folder` set to the hub lists its skills; with `query`, it searches their docs. Read each candidate's `SKILL` doc and show the user its name, description, author and last change.
2. **Show what it does.** A skill is instructions your agent will follow, written by whoever published it. Before installing, summarise what it tells the agent to do, and name any script it runs and any command, URL or credential it touches.
3. **Ask where.** The CLI's own prompts wait for a terminal, so ask in chat instead: which agents (Claude Code, Codex, Cursor, …, or all) and for every project or only this one.
4. **Download.** `read_drop` every doc and file in the skill's subfolder and write them to a new temporary folder, `<tmp>/<name>/`, laid out as above. Add `drop-version` with the `SKILL` doc's version and `drop-link` with its link to the frontmatter of the written `SKILL.md`; the update step reads them.
5. **Install.** Run `npx skills add <tmp> --skill <name> -a <agent> [-a <agent>] -y`, with `-g` for every project. When the user wants to pick in the CLI's own wizard, give them the command without `-y` to run in their terminal instead.

Done when the CLI reports the skill installed for each agent the user named and you've deleted the temporary folder.

## Publish

1. **Read the skill** from disk: its `SKILL.md` and every file beside it. Check the frontmatter has `name` (lowercase letters, digits and dashes) and a `description` that says when to use it.
2. **Check the hub.** When a subfolder with that name exists and the user didn't write that skill, ask before replacing it.
3. **Publish.** Create the subfolder, then publish `SKILL.md` as a doc with slug `skill`, each other Markdown file as a doc in its folder (`references/format.md` as `format` in `references`), and each other file as a file drop with its name. Strip `drop-version` and `drop-link` from the frontmatter first. For a new version, publish each changed doc with `previous` and a `note` saying what changed.

Done when every file of the skill is in the hub and you've given the user the subfolder's link.

## Update

For each installed skill whose `SKILL.md` has a `drop-link`, `read_drop` that link and compare its version with `drop-version`. When the hub is newer, show the user what changed (the version notes) and, once they agree, install again as above. The CLI's own `npx skills update` can't see the hub, since it recorded a temporary folder as the source.

Done when every hub skill the user has installed is at the hub's version or the user chose to keep theirs.
