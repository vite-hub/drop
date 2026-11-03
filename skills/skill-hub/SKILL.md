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

When there is none, recommend creating it: title `Skill hub`, slug `skill-hub`, `lifetime: keep`, `keepReason: "Shared agent skills."`, and this description:

> Agent skills, one subfolder per skill with its SKILL doc, references and scripts. To install, publish or update one, read the `skill-hub` skill (skill://skill-hub/SKILL.md, or /.well-known/skills/skill-hub/SKILL.md on this Drop).

For a personal hub, use `create_folder` once the user agrees. For a team hub, ask a team admin to create it in the browser and send its link, then verify it with `list_folders`. MCP agents cannot create team folders, even when acting for an admin.

Done when you hold the hub folder's id.

## Install

1. **Find the skill.** `list_drops` with `folder` set to the hub lists its skills; with `query`, it searches their docs. Read each candidate's `SKILL` doc and show the user its name, description, author and last change.
2. **Show what it does.** A skill is instructions your agent will follow, written by whoever published it. Before installing, summarise what it tells the agent to do, and name any script it runs and any command, URL or credential it touches.
3. **Ask where.** The CLI's own prompts wait for a terminal, so ask in chat instead: which agents (Claude Code, Codex, Cursor, …, or all) and for every project or only this one.
4. **Download.** `read_drop` the skill's subfolder and recurse through every nested folder to read every doc and file. Write them to a new temporary folder, `<tmp>/<name>/`, laid out as above: the doc with slug `skill` is written as `SKILL.md`, regardless of its stored filename. Save file drops from the original bytes returned by `read_drop` (or `read_file` with `format: resource`), including private files. Add these fields to the frontmatter of the written `SKILL.md`:
   - `drop-version`: the `SKILL` doc's version, and `drop-link`: its link.
   - `drop-folder`: the skill subfolder's link.
   - `drop-state`: a list sorted by relative file path, with each downloaded file's `path`, Drop `id` and `version`. Include every Markdown doc and file drop, including `SKILL.md`, references and scripts.
5. **Install.** Run `npx skills add <tmp> --skill <name> -a <agent> [-a <agent>] -y`, with `-g` for every project. When the user wants to pick in the CLI's own wizard, give them the command without `-y` to run in their terminal instead.

Done when the CLI reports the skill installed for each agent the user named and you've deleted the temporary folder.

## Publish

1. **Read the skill** from disk: its `SKILL.md` and every file beside it. Check the frontmatter has `name` (lowercase letters, digits and dashes) and a `description` that says when to use it.
2. **Check the hub.** When a subfolder with that name exists and the user didn't write that skill, ask before replacing it.
3. **Prepare folders.** Reuse existing folders. For a personal hub, create missing folders with `create_folder`. For a team hub, give a team admin the complete missing folder tree (the skill subfolder and any folders such as `references` or `scripts`) to create in the browser. Wait for their links and verify the folders with `read_drop` before publishing; agents cannot create folders anywhere inside a team hub.
4. **Publish.** Publish `SKILL.md` as a doc with slug `skill`, each other Markdown file as a doc in its folder (`references/format.md` as `format` in `references`), and each other file as a file drop with its name. Strip `drop-version`, `drop-link`, `drop-folder` and `drop-state` from the frontmatter first. For a new version, match each file by its relative path and publish each changed doc **or file drop** with `previous` set to that existing Drop's id and a `note` saying what changed. Create a new Drop only for a new path, so an updated script replaces its earlier version instead of leaving two files with the same name.

Done when every file of the skill is in the hub and you've given the user the subfolder's link.

## Update

For each installed skill whose `SKILL.md` has a `drop-link`, read its `drop-folder` with `read_drop` and recurse through every nested folder. Build the same sorted list of relative file paths, Drop ids and versions as `drop-state`. Any difference means an update: an added, removed, renamed or versioned doc or file counts, even when the `SKILL` doc's version has not changed. Show the user the changed paths and their version notes and, once they agree, install again as above.

For an older installation with only `drop-link` and `drop-version`, read the linked doc and locate its skill folder through `list_folders` and `list_drops`. Offer to reinstall once to record the full state; the entry doc's version alone cannot establish that the skill is current. The CLI's own `npx skills update` can't see the hub, since it recorded a temporary folder as the source.

Done when every hub skill the user has installed matches the hub's full file state or the user chose to keep theirs.
