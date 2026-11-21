# code-along

An agent skill that turns code into one page someone works through: a step-by-step guide beside a file tree, an editor and a live preview. Use it to learn a codebase or a concept, to try a prototype, or to code something together from a starting point the agent prepares. The page is one HTML file that opens from disk or any static host.

```sh
npx skills add vite-hub/drop --skill code-along
```

The [skills CLI](https://github.com/vercel-labs/skills) asks which agents to install it for. Then ask your agent to walk you through some code.

It needs no account. To comment on a step and get the next version at the same link, publish the page to [Drop](https://drop.vitehub.dev).

[SKILL.md](SKILL.md) is what the agent reads. MIT licensed.
