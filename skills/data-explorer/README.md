# data-explorer

An agent skill that turns a dataset, such as a CSV, a JSON export or an API, into one interactive dashboard page: findings, charts, matrices and tables behind tabs, and a filter sidebar where a click on any name filters the whole page. The page is one HTML file that opens from disk or any static host.

```sh
npx skills add vite-hub/drop --skill data-explorer
```

The [skills CLI](https://github.com/vercel-labs/skills) asks which agents to install it for. Then hand your agent some data and ask for a dashboard of it.

It needs no account. To share a page and let people comment on the numbers, publish it to [Drop](https://drop.vitehub.dev); a rebuild on new data becomes the next version at the same link.

[SKILL.md](SKILL.md) is what the agent reads. MIT licensed.
